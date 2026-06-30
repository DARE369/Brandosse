# video-worker/poller.py
# Background loop that polls Supabase for queued jobs.
# Runs in a separate asyncio task alongside the FastAPI server.

import asyncio
from config import config
from database import claim_next_job
from job_runner import process_job
from logger import log

# Tracks how many jobs are currently being processed
_active_jobs: set[str] = set()


async def poll_loop() -> None:
    """
    Continuously poll for new jobs and process them.
    Respects MAX_CONCURRENT_JOBS limit.
    Runs until the process is killed.
    """
    log.info("poller_started", interval_seconds=config.poll_interval_seconds, max_concurrent=config.max_concurrent_jobs)
    
    while True:
        try:
            # Only poll if we have capacity for more jobs
            if len(_active_jobs) < config.max_concurrent_jobs:
                job = claim_next_job()
                
                if job:
                    job_id = job["id"]
                    _active_jobs.add(job_id)
                    log.info("poller_dispatching_job", job_id=job_id, active_count=len(_active_jobs))
                    
                    # Process job in background — do not await here
                    # This allows the poller to pick up the next job immediately
                    asyncio.create_task(_run_and_cleanup(job))
                    
            await asyncio.sleep(config.poll_interval_seconds)
            
        except asyncio.CancelledError:
            log.info("poller_stopped")
            break
        except Exception as e:
            log.error("poller_unexpected_error", error=str(e))
            await asyncio.sleep(config.poll_interval_seconds)


async def _run_and_cleanup(job: dict) -> None:
    """Wraps process_job to remove job from active set when done."""
    job_id = job["id"]
    try:
        await process_job(job)
    finally:
        _active_jobs.discard(job_id)
        log.info("poller_job_slot_freed", job_id=job_id, active_count=len(_active_jobs))


async def trigger_poll() -> dict:
    """
    Immediately trigger one poll cycle.
    Called by the webhook endpoint when Next.js submits a new job.
    Returns current status of the poller.
    """
    if len(_active_jobs) < config.max_concurrent_jobs:
        job = claim_next_job()
        if job:
            job_id = job["id"]
            _active_jobs.add(job_id)
            asyncio.create_task(_run_and_cleanup(job))
            return {"triggered": True, "job_id": job_id}
    
    return {"triggered": False, "reason": "at_capacity", "active_jobs": len(_active_jobs)}
