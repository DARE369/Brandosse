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
    fail_job
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
        update_job_status(job_id, "transcribing")
        log.info("stage_start", job_id=job_id, stage="transcribe")
        
        transcript_data = await run_transcribe(job, download_result["audio_path"])
        log.info("stage_complete", job_id=job_id, stage="transcribe", language=transcript_data["language"])

        # ── Stage 3: Analyze ──────────────────────────────────────
        # run_analyze persists each clip to video_clips itself as it scores them.
        update_job_status(job_id, "analyzing")
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

        stitched_url = await run_stitch(job, rendered_clips, temp_dir)

        log.info("stage_complete", job_id=job_id, stage="stitch", url=stitched_url)

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
        # ── Always clean up temp files ────────────────────────────
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
            log.info("temp_dir_cleaned", job_id=job_id, path=temp_dir)
