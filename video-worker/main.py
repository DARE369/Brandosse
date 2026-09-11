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
from uploads import (
    assert_disk_headroom, local_path_for, max_upload_bytes,
    reap_orphaned_uploads, verify_ticket,
)
from logger import log

# ─────────────────────────────────────────────
# STARTUP + SHUTDOWN
# ─────────────────────────────────────────────

async def _reaper_loop() -> None:
    """
    Re-run crash recovery on a timer, not just at startup.

    Startup-only recovery assumes a stranded job is always accompanied by a
    restart that happens AFTER the staleness threshold. Neither half holds: a
    job task can die while the worker stays up, and a stopped machine can be
    woken by traffic minutes after the stop, run the reaper too early, skip the
    job, and then idle with it stranded.
    """
    while True:
        try:
            await asyncio.sleep(config.reaper_interval_seconds)
            reset = await asyncio.to_thread(
                reset_stuck_jobs, config.stuck_job_threshold_minutes
            )
            if reset:
                log.warning("reaper_reset_jobs", count=reset)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.error("reaper_loop_error", error=str(exc)[:120])


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Runs on startup and shutdown."""
    # Startup
    log.info("worker_starting", port=config.port, temp_dir=config.temp_dir)

    # Fail fast on missing credentials for enabled stages (LOCK L1.4 / L0.6).
    # A worker that boots without a Groq key accepts jobs and fails every one
    # of them at transcription — the exact state the audit found in production.
    # Refuse to start instead, the same way the ffmpeg check below does.
    config.validate_runtime_credentials()
    log.info("credentials_verified",
             mock_anthropic=config.use_mock_anthropic,
             mock_replicate=config.use_mock_replicate)

    for warning in config.warn_on_degraded_config():
        log.warning("degraded_config", detail=warning)

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
    reaper_task = asyncio.create_task(_reaper_loop())
    log.info("worker_ready")
    
    yield  # Server is running
    
    # Shutdown
    poll_task.cancel()
    reaper_task.cancel()
    for task in (poll_task, reaper_task):
        try:
            await task
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
    # Was ["http://localhost:5173"] — the Vite dev server, which this app has
    # not used since the Next.js migration. Browsers now upload source video
    # directly to this service, so the real app origins have to be here or every
    # upload is blocked by CORS before a byte is sent.
    allow_origins=[
        o.strip() for o in (
            os.environ.get("WORKER_ALLOWED_ORIGINS")
            or "http://localhost:3000,http://localhost:3001"
        ).split(",") if o.strip()
    ],
    # Vercel mints a NEW hostname for every single deployment
    # (brandosse-2ge025g4x-dare369s-projects.vercel.app), so an exact-match list
    # is stale the moment anything is pushed — which is exactly how the first
    # real upload attempt failed. A regex is the only thing that keeps up.
    #
    # Deliberately NOT `.*\.vercel\.app`: that would let any Vercel project on
    # the internet post files to this worker. Scoped to this account's project
    # namespace instead.
    allow_origin_regex=os.environ.get(
        "WORKER_ALLOWED_ORIGIN_REGEX",
        r"^https://brandosse[a-z0-9-]*-dare369s-projects\.vercel\.app$",
    ),
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
        # The commit actually running. "1.0.0" above is a static label and
        # has never changed; this is the field that answers "is the latest
        # code live?" without inferring it from deploy timestamps.
        "git_sha": config.git_sha,
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


@app.post("/upload")
async def upload_source(
    request: Request,
    x_upload_user: str = Header(None),
    x_upload_id: str = Header(None),
    x_upload_expires: str = Header(None),
    x_upload_signature: str = Header(None),
    x_upload_ext: str = Header(None),
):
    """
    Accept a source video straight from the user's browser onto the volume.

    Authenticated by a signed ticket rather than the shared worker secret,
    because the caller is a browser and the secret must never reach one. See
    uploads.py for the reasoning and the signature contract.

    The body is streamed to disk in chunks. A 2GB file read into memory would
    OOM a 4GB machine that is also running two ffmpeg renders — and the OOM
    killer would take the renders, not just the upload.
    """
    try:
        expires_at = int(x_upload_expires or 0)
    except ValueError:
        raise HTTPException(status_code=400, detail="Malformed ticket expiry")

    verify_ticket(x_upload_user, x_upload_id, expires_at, x_upload_signature)

    limit = max_upload_bytes()
    declared = int(request.headers.get("content-length") or 0)
    if declared > limit:
        raise HTTPException(
            status_code=413,
            detail=f"File is larger than the {limit / 1e9:.1f}GB limit for this worker.",
        )
    assert_disk_headroom(declared or 0)

    path = local_path_for(x_upload_user, x_upload_id, (x_upload_ext or "mp4").lower())
    written = 0

    try:
        with open(path, "wb") as handle:
            async for chunk in request.stream():
                written += len(chunk)
                # Content-Length is a claim by the client. Enforce the real
                # limit against what actually arrives, or a lying header walks
                # straight past the check above.
                if written > limit:
                    raise HTTPException(status_code=413, detail="Upload exceeded the size limit.")
                handle.write(chunk)
    except HTTPException:
        if os.path.exists(path):
            os.remove(path)
        raise
    except Exception as exc:
        if os.path.exists(path):
            os.remove(path)
        log.error("upload_failed", upload_id=str(x_upload_id)[:8], error=str(exc)[:120])
        raise HTTPException(status_code=500, detail="Upload failed while writing to disk.")

    if written == 0:
        os.remove(path)
        raise HTTPException(status_code=400, detail="Uploaded file was empty.")

    log.info(
        "upload_stored",
        upload_id=str(x_upload_id)[:8],
        user_id=str(x_upload_user)[:8],
        size_mb=round(written / (1024 * 1024), 1),
    )

    # The job's source_url. download.py recognises this scheme and skips
    # fetching entirely — the file is already on the machine that needs it.
    return {"ok": True, "source_url": f"worker://{x_upload_user}/{x_upload_id}", "bytes": written}


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
    # Railway injects PORT; fall back to WORKER_PORT / default 8001
    port = int(os.environ.get("PORT", config.port))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        log_level=config.log_level.lower(),
        reload=False  # Never use reload in production
    )
