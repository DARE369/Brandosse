# video-worker/poller.py
# Background loop that polls Supabase for queued jobs.
# Runs in a separate asyncio task alongside the FastAPI server.

import asyncio
import os
import time
import urllib.request

from config import config
from database import claim_next_job, update_job_status
from job_runner import process_job
from logger import log

# Tracks how many jobs are currently being processed
_active_jobs: set[str] = set()

# ── Keep the machine alive while a job is running ───────────────────────────
# Fly's proxy auto-stops this machine when it sees no edge traffic for a few
# minutes. A 15-minute render is pure internal work — zero proxied requests —
# so the proxy concluded the machine was idle and SIGTERMed it MID-JOB
# (observed 2026-08-23: graceful shutdown at 11:35 with two clips half-done,
# job stranded in 'rendering'). Pinging our own public URL routes one request
# through the proxy and resets its idle clock. Only while jobs are active, so
# scale-to-zero still works the moment we are genuinely idle.
# 20s, not 60. At 60s Fly still autostopped a machine mid-render with "App has
# excess capacity" — one request a minute reads as an idle machine to the proxy.
# Three pings a minute is negligible traffic and keeps the machine plainly in
# use while real work is running.
_KEEPALIVE_INTERVAL_SECS = 20
_last_keepalive = 0.0


def _keepalive_ping() -> None:
    app_name = os.environ.get("FLY_APP_NAME")
    if not app_name:
        return  # not on Fly (local dev) — nothing to keep alive
    try:
        urllib.request.urlopen(f"https://{app_name}.fly.dev/health", timeout=10)
        log.info("keepalive_ping", active_jobs=len(_active_jobs))
    except Exception as exc:
        # Best effort. A failed ping must never take down the pipeline the
        # ping exists to protect.
        log.warning("keepalive_ping_failed", error=str(exc)[:80])


async def _maybe_keepalive() -> None:
    global _last_keepalive
    if not _active_jobs:
        return
    now = time.monotonic()
    if now - _last_keepalive >= _KEEPALIVE_INTERVAL_SECS:
        _last_keepalive = now
        await asyncio.to_thread(_keepalive_ping)


async def poll_loop() -> None:
    """
    Continuously poll for new jobs and process them.
    Respects MAX_CONCURRENT_JOBS limit.
    Runs until the process is killed.
    """
    log.info("poller_started", interval_seconds=config.poll_interval_seconds, max_concurrent=config.max_concurrent_jobs)
    
    while True:
        try:
            # The hourly clip-expiry sweep used to run here. Removed 2026-09-01:
            # clips are kept until the user deletes them, so there is nothing to
            # expire. See video-worker/retention.py for what replaced it.

            # While work is in flight, stop Fly's proxy from idle-stopping us.
            await _maybe_keepalive()

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
    except asyncio.CancelledError:
        # Shutdown interrupted this job (Fly stop, deploy, crash-restart).
        # Put it BACK IN THE QUEUE rather than stranding it in a non-terminal
        # state: analyze deletes any existing clips for the job before
        # inserting, so a rerun is idempotent. Without this, the job sat in
        # 'rendering' forever waiting for the startup reaper's threshold.
        try:
            update_job_status(job_id, "queued")
            log.warning("job_requeued_on_shutdown", job_id=job_id)
        except Exception as exc:
            log.error("job_requeue_failed", job_id=job_id, error=str(exc)[:100])
        raise
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
