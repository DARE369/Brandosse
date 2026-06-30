# video-worker/main.py
# Entry point for the worker service.
# Starts the FastAPI HTTP server and the background polling loop together.

import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
from config import config
from database import reset_stuck_jobs
from poller import poll_loop, trigger_poll
from logger import log

# ─────────────────────────────────────────────
# STARTUP + SHUTDOWN
# ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Runs on startup and shutdown."""
    # Startup
    log.info("worker_starting", port=config.port, temp_dir=config.temp_dir)
    
    # Ensure temp directory exists
    os.makedirs(config.temp_dir, exist_ok=True)

    # Verify ffmpeg is installed before accepting jobs.
    from utils.ffmpeg_utils import check_ffmpeg_available
    ffmpeg_ok, ffmpeg_info = check_ffmpeg_available()
    if not ffmpeg_ok:
        log.error("startup_failed_ffmpeg_missing", reason=ffmpeg_info)
        raise RuntimeError(f"Worker cannot start: {ffmpeg_info}")
    log.info("ffmpeg_verified", version=ffmpeg_info[:60])
    
    # Crash recovery — reset any jobs stuck from a previous crash
    reset_count = reset_stuck_jobs(config.stuck_job_threshold_minutes)
    log.info("crash_recovery_complete", jobs_reset=reset_count)
    
    # Start background polling loop
    poll_task = asyncio.create_task(poll_loop())
    log.info("worker_ready")
    
    yield  # Server is running
    
    # Shutdown
    poll_task.cancel()
    try:
        await poll_task
    except asyncio.CancelledError:
        pass
    log.info("worker_shutdown_complete")


# ─────────────────────────────────────────────
# FASTAPI APP
# ─────────────────────────────────────────────

app = FastAPI(
    title="Video Engine Worker",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None,  # Disable Swagger UI in production
    redoc_url=None
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def verify_webhook_secret(x_worker_secret: str = Header(None)) -> None:
    """Verify the shared webhook secret on every inbound request."""
    if x_worker_secret != config.webhook_secret:
        log.warning("webhook_secret_mismatch", received=x_worker_secret[:8] if x_worker_secret else "None")
        raise HTTPException(status_code=401, detail="Unauthorized")


# ─────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """
    Public health endpoint.
    Returns 200 if the worker is running.
    No authentication required — used by monitoring tools.
    """
    return {
        "status": "healthy",
        "service": "video-engine-worker",
        "version": "1.0.0",
        "temp_dir_exists": os.path.exists(config.temp_dir)
    }


@app.get("/status")
async def worker_status(x_worker_secret: str = Header(None)):
    """
    Authenticated status endpoint.
    Returns detailed worker state including active job count.
    """
    verify_webhook_secret(x_worker_secret)
    
    from poller import _active_jobs
    return {
        "active_jobs": len(_active_jobs),
        "max_concurrent_jobs": config.max_concurrent_jobs,
        "active_job_ids": list(_active_jobs),
        "poll_interval_seconds": config.poll_interval_seconds
    }


@app.post("/webhook/job-submitted")
async def on_job_submitted(request: Request, x_worker_secret: str = Header(None)):
    """
    Called by Next.js immediately after a job is inserted into the database.
    Triggers an immediate poll cycle instead of waiting for the next interval.
    This reduces job start latency from up to 5 seconds to near-instant.
    """
    verify_webhook_secret(x_worker_secret)
    
    body = await request.json()
    job_id = body.get("job_id")
    
    log.info("job_submitted", job_id=job_id)
    
    result = await trigger_poll()
    return {"received": True, "job_id": job_id, "poll_result": result}


@app.post("/webhook/cancel-job")
async def on_cancel_job(request: Request, x_worker_secret: str = Header(None)):
    """
    Called by Next.js when a user cancels a queued job.
    If the job is still queued (not yet claimed), marks it as failed.
    If already being processed, logs the cancel request — 
    actual cancellation mid-render is handled in Stage 6.
    """
    verify_webhook_secret(x_worker_secret)
    
    body = await request.json()
    job_id = body.get("job_id")
    user_id = body.get("user_id")
    credits_to_refund = body.get("credits_to_refund", 0)
    
    log.info("cancel_job", job_id=job_id)
    
    from database import fail_job
    fail_job(
        job_id=job_id,
        user_id=user_id,
        error_message="Cancelled by user",
        error_stage="queued",
        should_refund=True,
        credits_to_refund=credits_to_refund
    )
    
    return {"received": True, "job_id": job_id, "action": "cancelled"}


# ─────────────────────────────────────────────
# ENTRYPOINT
# ─────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=config.port,
        log_level=config.log_level.lower(),
        reload=False  # Never use reload in production
    )
