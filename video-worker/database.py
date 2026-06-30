# video-worker/database.py
# All Supabase read/write operations for the worker.
# Uses the service role key — bypasses RLS.
# This is the ONLY file that talks directly to Supabase.

import os
import shutil
from datetime import datetime, timezone, timedelta
from typing import Optional
from supabase import create_client, Client
from config import config
from logger import log

def get_supabase_client() -> Client:
    return create_client(config.supabase_url, config.supabase_service_key)

supabase: Client = get_supabase_client()

# ─────────────────────────────────────────────
# JOB OPERATIONS
# ─────────────────────────────────────────────

def claim_next_job() -> Optional[dict]:
    """
    Atomically claim the next queued job.
    Returns the job dict if claimed, None if no jobs available.
    Uses conditional update to prevent two workers claiming the same job.
    Retries on transient network errors.
    """
    max_retries = 2
    for attempt in range(max_retries):
        try:
            # Find the oldest queued job
            result = supabase.table("video_jobs")\
                .select("*")\
                .eq("status", "queued")\
                .order("created_at", desc=False)\
                .limit(1)\
                .execute()

            if not result.data:
                return None

            job = result.data[0]
            job_id = job["id"]

            # Atomically claim it by updating status only if it's still queued
            # If another worker already claimed it, this update affects 0 rows
            claim_result = supabase.table("video_jobs")\
                .update({
                    "status": "downloading",
                    "processing_started_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat()
                })\
                .eq("id", job_id)\
                .eq("status", "queued")\
                .execute()

            if not claim_result.data:
                # Another worker claimed it between our SELECT and UPDATE
                log.info("job_claim_race", job_id=job_id, result="lost_to_another_worker")
                return None

            log.info("job_claimed", job_id=job_id, user_id=job["user_id"])
            return claim_result.data[0]

        except Exception as e:
            error_msg = str(e)
            is_network_error = "10054" in error_msg or "forcibly closed" in error_msg
            is_last_attempt = attempt == max_retries - 1

            if is_network_error and not is_last_attempt:
                log.warning("job_claim_network_error_retry", error=error_msg, attempt=attempt + 1)
                import time
                time.sleep(0.5)  # Brief delay before retry
                continue

            log.error("job_claim_failed", error=error_msg, attempt=attempt + 1)
            return None


def update_job_status(job_id: str, status: str, error_message: str = None, error_stage: str = None) -> bool:
    """Update job status and optionally set error details."""
    try:
        update_data = {
            "status": status,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        
        if status == "complete":
            update_data["processing_ended_at"] = datetime.now(timezone.utc).isoformat()
        
        if error_message:
            update_data["error_message"] = error_message
        
        if error_stage:
            update_data["error_stage"] = error_stage
            
        supabase.table("video_jobs").update(update_data).eq("id", job_id).execute()
        log.info("job_status_updated", job_id=job_id, status=status)
        return True
        
    except Exception as e:
        log.error("job_status_update_failed", job_id=job_id, status=status, error=str(e))
        return False


def update_job_source_info(job_id: str, title: str, duration_secs: int, credits_consumed: int) -> bool:
    """Update job with source video metadata after download."""
    try:
        supabase.table("video_jobs").update({
            "source_title": title,
            "source_duration_secs": duration_secs,
            "credits_consumed": credits_consumed,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", job_id).execute()
        return True
    except Exception as e:
        log.error("job_source_info_update_failed", job_id=job_id, error=str(e))
        return False


def update_job_progress(job_id: str, progress_percent: float) -> bool:
    """Update job download progress (0-100)."""
    try:
        supabase.table("video_jobs").update({
            "download_progress": round(progress_percent, 1),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", job_id).execute()
        return True
    except Exception as e:
        log.warning("job_progress_update_failed", job_id=job_id, progress=progress_percent, error=str(e))
        return False


def fail_job(job_id: str, user_id: str, error_message: str, error_stage: str, should_refund: bool, credits_to_refund: int = 0) -> None:
    """
    Mark a job as failed and optionally refund credits.
    These two operations are performed in sequence.
    If credit refund fails, job is still marked failed and error is logged.
    """
    # Step 1: Mark job as failed
    update_job_status(job_id, "failed", error_message, error_stage)
    
    # Step 2: Refund credits if applicable
    if should_refund and credits_to_refund > 0:
        try:
            refund_credits(user_id, job_id, credits_to_refund, f"Refund for failed job: {error_stage}")
            log.info("job_credits_refunded", job_id=job_id, user_id=user_id, amount=credits_to_refund)
        except Exception as e:
            log.error(
                "credit_refund_failed_manual_review_required",
                job_id=job_id,
                user_id=user_id,
                amount=credits_to_refund,
                error=str(e)
            )


# ─────────────────────────────────────────────
# CREDIT OPERATIONS
# ─────────────────────────────────────────────

def get_user_credits(user_id: str) -> int:
    """Get current credit balance for a user. Returns 0 if not found."""
    try:
        result = supabase.table("user_credits")\
            .select("balance")\
            .eq("user_id", user_id)\
            .single()\
            .execute()
        return result.data["balance"] if result.data else 0
    except Exception as e:
        log.error("get_user_credits_failed", user_id=user_id, error=str(e))
        return 0


def refund_credits(user_id: str, job_id: str, amount: int, description: str) -> bool:
    """
    Refund credits to a user and log the transaction.
    Updates balance and lifetime_consumed atomically via RPC.
    """
    try:
        # Get current balance
        current = supabase.table("user_credits")\
            .select("balance, lifetime_consumed")\
            .eq("user_id", user_id)\
            .single()\
            .execute()
        
        if not current.data:
            log.error("refund_user_not_found", user_id=user_id)
            return False
        
        new_balance = current.data["balance"] + amount
        new_lifetime_consumed = max(0, current.data["lifetime_consumed"] - amount)
        
        # Update credit balance
        supabase.table("user_credits").update({
            "balance": new_balance,
            "lifetime_consumed": new_lifetime_consumed,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }).eq("user_id", user_id).execute()
        
        # Log the transaction
        supabase.table("credit_transactions").insert({
            "user_id": user_id,
            "job_id": job_id,
            "amount": amount,
            "balance_after": new_balance,
            "transaction_type": "refund",
            "description": description
        }).execute()
        
        return True
        
    except Exception as e:
        log.error("refund_credits_failed", user_id=user_id, amount=amount, error=str(e))
        return False


# ─────────────────────────────────────────────
# CRASH RECOVERY
# ─────────────────────────────────────────────

def reset_stuck_jobs(threshold_minutes: int) -> int:
    """
    On worker startup, reset jobs stuck in non-terminal states.
    A job is considered stuck if updated_at is older than threshold_minutes.
    Returns the number of jobs reset.
    """
    try:
        cutoff_time = (
            datetime.now(timezone.utc) - timedelta(minutes=threshold_minutes)
        ).isoformat()
        
        stuck_statuses = ["downloading", "transcribing", "analyzing", "rendering", "stitching"]
        
        result = supabase.table("video_jobs")\
            .update({
                "status": "queued",
                "error_message": None,
                "error_stage": None,
                "processing_started_at": None,
                "updated_at": datetime.now(timezone.utc).isoformat()
            })\
            .in_("status", stuck_statuses)\
            .lt("updated_at", cutoff_time)\
            .execute()
        
        count = len(result.data) if result.data else 0
        if count > 0:
            log.warning("stuck_jobs_reset", count=count, threshold_minutes=threshold_minutes)
        return count
        
    except Exception as e:
        log.error("reset_stuck_jobs_failed", error=str(e))
        return 0


# ─────────────────────────────────────────────
# TRANSCRIPT + CLIP WRITES (used by stages 4-6)
# ─────────────────────────────────────────────

def save_transcript(job_id: str, user_id: str, raw_transcript: dict, word_segments: list, speaker_segments: list, detected_language: str) -> bool:
    """Save WhisperX transcript output to the database."""
    try:
        supabase.table("video_transcripts").insert({
            "job_id": job_id,
            "user_id": user_id,
            "raw_transcript": raw_transcript,
            "word_segments": word_segments,
            "speaker_segments": speaker_segments,
            "detected_language": detected_language
        }).execute()
        return True
    except Exception as e:
        log.error("save_transcript_failed", job_id=job_id, error=str(e))
        return False


def save_clips(job_id: str, user_id: str, clips: list[dict]) -> bool:
    """Save the list of scored clips to the database."""
    try:
        rows = []
        for i, clip in enumerate(clips):
            rows.append({
                "job_id": job_id,
                "user_id": user_id,
                "clip_index": i,
                "ai_title": clip.get("title"),
                "ai_caption": clip.get("caption"),
                "hook_score": clip.get("hook_score"),
                "content_score": clip.get("content_score"),
                "overall_score": clip.get("overall_score"),
                "start_time_secs": clip["start_time_secs"],
                "end_time_secs": clip["end_time_secs"],
                "duration_secs": clip["end_time_secs"] - clip["start_time_secs"],
                "transcript_excerpt": clip.get("transcript_excerpt"),
                "platform_target": clip.get("platform_target", "universal"),
                "render_status": "pending"
            })
        
        supabase.table("video_clips").insert(rows).execute()
        return True
    except Exception as e:
        log.error("save_clips_failed", job_id=job_id, error=str(e))
        return False


def update_clip_render_complete(clip_id: str, storage_path: str, public_url: str, thumbnail_path: str, thumbnail_url: str) -> bool:
    """Update a clip record after rendering completes."""
    try:
        supabase.table("video_clips").update({
            "storage_path": storage_path,
            "public_url": public_url,
            "thumbnail_path": thumbnail_path,
            "thumbnail_url": thumbnail_url,
            "render_status": "complete",
            "updated_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", clip_id).execute()
        return True
    except Exception as e:
        log.error("update_clip_render_failed", clip_id=clip_id, error=str(e))
        return False


def deduct_credits(user_id: str, job_id: str, amount: int) -> tuple[bool, int]:
    """
    Deduct credits from a user's balance for a job.

    Returns:
        (True, new_balance) on success
        (False, current_balance) if insufficient credits or error

    This is called after the pre-flight metadata check, when the worker knows
    the exact duration and therefore the exact credit cost.
    """
    try:
        current = supabase.table("user_credits")\
            .select("balance, lifetime_consumed")\
            .eq("user_id", user_id)\
            .single()\
            .execute()

        if not current.data:
            log.error("deduct_credits_user_not_found", user_id=user_id)
            return False, 0

        current_balance = current.data["balance"]

        if current_balance < amount:
            log.warning(
                "deduct_credits_insufficient",
                user_id=user_id,
                required=amount,
                available=current_balance,
            )
            return False, current_balance

        new_balance = current_balance - amount
        new_lifetime_consumed = current.data["lifetime_consumed"] + amount

        supabase.table("user_credits").update({
            "balance": new_balance,
            "lifetime_consumed": new_lifetime_consumed,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("user_id", user_id).execute()

        supabase.table("credit_transactions").insert({
            "user_id": user_id,
            "job_id": job_id,
            "amount": -amount,
            "balance_after": new_balance,
            "transaction_type": "consumption",
            "description": "Video processing job",
        }).execute()

        log.info("credits_deducted", user_id=user_id, amount=amount, new_balance=new_balance)
        return True, new_balance

    except Exception as e:
        log.error("deduct_credits_failed", user_id=user_id, amount=amount, error=str(e))
        return False, 0


def download_from_supabase_storage(storage_path: str, local_path: str) -> tuple[bool, str]:
    """
    Download a file from Supabase Storage to a local path.
    Used when source_platform is 'upload'.

    Returns (True, local_path) on success, (False, error_message) on failure.
    """
    try:
        bucket = "video-source-cache"
        response = supabase.storage.from_(bucket).download(storage_path)

        with open(local_path, 'wb') as f:
            f.write(response)

        if not os.path.exists(local_path) or os.path.getsize(local_path) == 0:
            return False, "Downloaded file is empty"

        log.info(
            "storage_download_complete",
            storage_path=storage_path,
            local_path=local_path,
            size_mb=round(os.path.getsize(local_path) / (1024 * 1024), 2),
        )
        return True, local_path

    except Exception as e:
        log.error("storage_download_failed", storage_path=storage_path, error=str(e))
        return False, f"Storage download failed: {str(e)}"


def delete_clips_for_job(job_id: str) -> int:
    """
    Delete all existing clip rows for a job before re-analyzing.

    Called at the start of run_analyze so that crash-recovered jobs
    (status reset to queued by reset_stuck_jobs) don't accumulate duplicate
    clip rows from previous attempts.  Returns the number of rows deleted.
    """
    try:
        result = supabase.table("video_clips").delete().eq("job_id", job_id).execute()
        count = len(result.data) if result.data else 0
        if count > 0:
            log.info("old_clips_deleted", job_id=job_id, count=count)
        return count
    except Exception as e:
        log.warning("delete_clips_failed", job_id=job_id, error=str(e))
        return 0


def get_clips_for_job(job_id: str) -> list[dict]:
    """
    Retrieve video_clips rows for a job, ordered by clip_index.
    """
    try:
        result = supabase.table("video_clips")\
            .select("*")\
            .eq("job_id", job_id)\
            .order("clip_index", desc=False)\
            .execute()

        return result.data if result.data else []

    except Exception as e:
        log.error("get_clips_for_job_failed", job_id=job_id, error=str(e))
        return []


def get_transcript_word_segments(job_id: str) -> list[dict]:
    """
    Retrieve transcript word_segments for a job.
    """
    try:
        result = supabase.table("video_transcripts")\
            .select("word_segments")\
            .eq("job_id", job_id)\
            .single()\
            .execute()

        if result.data and result.data.get("word_segments"):
            return result.data["word_segments"]
        return []

    except Exception as e:
        log.error("get_transcript_word_segments_failed", job_id=job_id, error=str(e))
        return []


def update_job_stitched_url(job_id: str, storage_path: str, signed_url: str) -> bool:
    """Persist the stitched output URL on the video_jobs row."""
    try:
        supabase.table("video_jobs").update({
            "stitched_output_url": signed_url,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
        log.info("job_stitched_url_saved", job_id=job_id, storage_path=storage_path)
        return True
    except Exception as e:
        log.error("update_job_stitched_url_failed", job_id=job_id, error=str(e))
        return False


def mark_clip_render_failed(clip_id: str, error_message: str = None) -> None:
    """Mark a single clip's render_status as failed, with an optional error message."""
    try:
        update_data = {
            "render_status": "failed",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if error_message:
            update_data["error_message"] = error_message[:500]

        supabase.table("video_clips").update(update_data).eq("id", clip_id).execute()
    except Exception as e:
        log.error("mark_clip_render_failed_db_error", clip_id=clip_id, error=str(e))
