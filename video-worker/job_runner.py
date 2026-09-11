# video-worker/job_runner.py
# Orchestrates the full pipeline for a single job.
# Called by the poller with one job dict.
# All exception handling lives here — stages just raise, this catches.
# Pack 5: Added asyncio.wait_for timeout to prevent hung jobs from blocking slots.

import os
import shutil
import asyncio
from config import config
from database import (
    update_job_status,
    update_job_source_info,
    fail_job,
    get_transcript_word_segments,
    get_clips_for_job,
    touch_job,
)
from stages.download import run_download
from stages.transcribe import run_transcribe
from stages.analyze import run_analyze
from stages.render import run_render
from stages.stitch import run_stitch
from errors import VideoEngineError
from logger import log

# Pack 5: Hard timeout prevents stuck jobs from blocking concurrent job slots forever.
# Most jobs complete in 5-10 minutes. 90 minutes covers even the longest videos
# (3 hours × 0.5 processing ratio) with buffer. Adjust if your typical videos are longer.
JOB_TIMEOUT_SECONDS = 90 * 60  # 90 minutes


async def _run_pipeline_stages(job: dict, temp_dir: str) -> tuple[int, int]:
    """
    The actual pipeline stages (extracted from process_job for timeout wrapper).
    Returns (credits_consumed, clips_produced).
    """
    job_id = job["id"]
    user_id = job["user_id"]
    credits_consumed = 0

    try:
        # ── Setup temp directory ──────────────────────────────────
        os.makedirs(temp_dir, exist_ok=True)
        log.info("temp_dir_created", job_id=job_id, path=temp_dir)
        
        # ── Stage 1: Download ─────────────────────────────────────
        # Status already set to 'downloading' by claim_next_job()
        log.info("stage_start", job_id=job_id, stage="download")
        download_result = await run_download(job, temp_dir)
        
        credits_consumed = download_result["credits_to_consume"]
        update_job_source_info(
            job_id,
            download_result["title"],
            download_result["duration_secs"],
            credits_consumed
        )
        log.info("stage_complete", job_id=job_id, stage="download", duration=download_result["duration_secs"])
        
        # ── Stage 2: Transcribe ───────────────────────────────────
        # RESUME: a transcript already in the database is finished work. Redoing
        # it costs a Groq call and 1-3 minutes for a byte-identical result.
        update_job_status(job_id, "transcribing")
        existing_words = get_transcript_word_segments(job_id)
        if existing_words:
            log.info(
                "stage_resumed",
                job_id=job_id,
                stage="transcribe",
                words=len(existing_words),
                message="transcript already saved — skipping",
            )
            transcript_data = {
                "word_segments": existing_words,
                "language": None,
                "full_text": "",
                "duration": download_result["duration_secs"],
            }
        else:
            log.info("stage_start", job_id=job_id, stage="transcribe")
            transcript_data = await run_transcribe(job, download_result["audio_path"])
            log.info("stage_complete", job_id=job_id, stage="transcribe",
                     language=transcript_data["language"])

        # ── Stage 3: Analyze ──────────────────────────────────────
        # run_analyze persists each clip to video_clips itself as it scores them.
        # RESUME: clips already scored are finished work, and re-running analyze
        # deletes them (analyze.py clears the job's clips before inserting), so
        # a restart would discard scoring the user already paid Claude for.
        update_job_status(job_id, "analyzing")
        existing_clips = get_clips_for_job(job_id)
        if existing_clips:
            log.info(
                "stage_resumed",
                job_id=job_id,
                stage="analyze",
                clips=len(existing_clips),
                message="clips already scored — skipping",
            )
            selected_clips = existing_clips
        else:
            log.info("stage_start", job_id=job_id, stage="analyze")
            selected_clips = await run_analyze(job, transcript_data)

        log.info("stage_complete", job_id=job_id, stage="analyze", clips_selected=len(selected_clips))
        
        # ── Stage 4: Render ───────────────────────────────────────
        update_job_status(job_id, "rendering")
        log.info("stage_start", job_id=job_id, stage="render")

        rendered_clips = await run_render(job, download_result["video_path"], selected_clips, temp_dir)

        log.info("stage_complete", job_id=job_id, stage="render", clips_rendered=len(rendered_clips))

        # ── Stage 5: Stitch ───────────────────────────────────────
        update_job_status(job_id, "stitching")
        log.info("stage_start", job_id=job_id, stage="stitch")

        # Stitching is a CONVENIENCE, not the deliverable. The clips are the
        # product, they are already rendered, uploaded and marked complete by
        # this point, and the user can see them.
        #
        # Observed 2026-08-24: a job produced 5 of 5 clips with thumbnails in
        # 5.2 minutes and then reported FAILED, because concatenating those
        # clips into one reel exceeded Supabase's 50MB free-plan object limit
        # (HTTP 413). Five good clips sat in storage behind a page that said
        # the job had failed — the worst kind of wrong, because the work was
        # done and only the reporting lied.
        #
        # A failure here is now recorded and moved past. Anything that can
        # actually break the deliverable still fails the job loudly.
        try:
            stitched_url = await run_stitch(job, rendered_clips, temp_dir)
            log.info("stage_complete", job_id=job_id, stage="stitch", url=stitched_url)
        except Exception as stitch_error:
            stitched_url = None
            log.warning(
                "stitch_failed_clips_unaffected",
                job_id=job_id,
                clips_delivered=len(rendered_clips),
                error=str(stitch_error)[:200],
                message="Combined reel unavailable; individual clips are complete.",
            )

        # ── Complete ──────────────────────────────────────────────
        update_job_status(job_id, "complete")
        log.info("pipeline_complete", job_id=job_id, user_id=user_id, clips_produced=len(rendered_clips))

        return credits_consumed, len(rendered_clips)

    except VideoEngineError as e:
        log.error(
            "pipeline_failed_known_error",
            job_id=job_id,
            stage=e.stage,
            error=e.message,
            should_refund=e.should_refund
        )
        fail_job(
            job_id=job_id,
            user_id=user_id,
            error_message=e.message,
            error_stage=e.stage,
            should_refund=e.should_refund,
            credits_to_refund=e.credits_to_refund or (credits_consumed if e.should_refund else 0)
        )
        return credits_consumed, 0

    except Exception as e:
        log.error("pipeline_failed_unexpected_error", job_id=job_id, error=str(e), exc_info=True)
        fail_job(
            job_id=job_id,
            user_id=user_id,
            error_message=f"Unexpected error: {str(e)}",
            error_stage="unknown",
            should_refund=True,
            credits_to_refund=credits_consumed
        )
        return credits_consumed, 0


def _job_is_terminal(job_id: str) -> bool:
    """
    True when the job has reached a state that will not run again.

    Only then may its working files be deleted. A job sitting back in 'queued'
    after an interruption still needs whatever survived on disk.
    """
    try:
        from database import supabase
        row = supabase.table("video_jobs").select("status").eq("id", job_id).single().execute()
        return (row.data or {}).get("status") in ("complete", "failed")
    except Exception as e:
        # If we cannot tell, clean up. Leaking disk on a 3GB volume is a worse
        # failure than losing a resume opportunity.
        log.warning("terminal_check_failed_cleaning", job_id=job_id, error=str(e)[:80])
        return True


# How often a running job says it is still alive. Must be comfortably shorter
# than WORKER_STUCK_JOB_THRESHOLD_MINUTES, or a healthy job reaps itself.
HEARTBEAT_INTERVAL_SECONDS = 60


async def _heartbeat(job_id: str) -> None:
    """Move the job's updated_at forward every minute until cancelled."""
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
            await asyncio.to_thread(touch_job, job_id)
    except asyncio.CancelledError:
        raise


async def process_job(job: dict) -> None:
    """
    Full pipeline orchestrator for one video job with timeout protection.

    Pack 5: Wrapped with asyncio.wait_for to prevent hung jobs from blocking
    concurrent job slots. If a job exceeds JOB_TIMEOUT_SECONDS, it is marked failed
    and its slot is released for the next queued job.

    Pipeline:
    1. Setup temp directory
    2. Download + extract audio  → status: downloading
    3. Transcribe audio          → status: transcribing
    4. Analyze + score clips     → status: analyzing
    5. Render + upload clips     → status: rendering
    6. Mark complete             → status: complete

    Any failure in any stage:
    - Catches exception
    - Calls fail_job() with correct error info and refund flag
    - Cleans up temp directory
    - Returns without raising (poller continues to next job)
    """
    job_id = job["id"]
    user_id = job["user_id"]
    temp_dir = os.path.join(config.temp_dir, job_id)

    log.info("pipeline_start", job_id=job_id, user_id=user_id, source_url=job["source_url"])

    try:
        # ── Setup temp directory ──────────────────────────────────
        os.makedirs(temp_dir, exist_ok=True)
        log.info("temp_dir_created", job_id=job_id, path=temp_dir)

        # ── Run pipeline with timeout ─────────────────────────────
        # The heartbeat runs alongside the pipeline so the row keeps saying
        # "alive" through the long silent stages (transcribe, render). Started
        # here rather than inside a stage so no stage can forget to.
        heartbeat_task = asyncio.create_task(_heartbeat(job_id))
        try:
            credits_consumed, clips_produced = await asyncio.wait_for(
                _run_pipeline_stages(job, temp_dir),
                timeout=JOB_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            log.error(
                "job_timeout",
                job_id=job_id,
                timeout_minutes=JOB_TIMEOUT_SECONDS // 60,
            )
            fail_job(
                job_id=job_id,
                user_id=user_id,
                error_message=f"Job timed out after {JOB_TIMEOUT_SECONDS // 60} minutes. "
                                f"This may indicate a video that is too complex or a system issue.",
                    error_stage="timeout",
                should_refund=True,
                credits_to_refund=0,  # refund logic in _run_pipeline_stages failed job path
            )
        finally:
            heartbeat_task.cancel()

    except asyncio.CancelledError:
        # Shutdown interrupted this job. The poller requeues it — so KEEP the
        # temp directory. Deleting it is what turned a resumable interruption
        # into a full restart: observed 2026-08-23, a job that had already
        # downloaded, transcribed and scored 11 clips was interrupted during
        # render, lost its source file to this cleanup, restarted from stage 1,
        # and then FAILED re-downloading a video it no longer needed. The work
        # was all still in the database; only the file was gone.
        log.warning("temp_dir_preserved_for_resume", job_id=job_id, path=temp_dir)
        raise

    finally:
        # ── Clean up temp files on TERMINAL outcomes only ─────────
        # A requeued job re-enters this function and reuses what survived.
        if _job_is_terminal(job_id) and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
            log.info("temp_dir_cleaned", job_id=job_id, path=temp_dir)
