# video-worker/uploads.py
#
# LOCK L7.4 — direct browser -> worker upload, so source video never touches
# Supabase Storage.
#
# ── Why this exists ─────────────────────────────────────────────────────────
# Supabase Storage on this project refuses any bucket limit above 50MB (the
# free-plan ceiling; 1024/500/200MB were all rejected with HTTP 413). A
# 60-minute 1080p podcast — the product's actual use case — is 1-3GB. So the
# Supabase upload path works only for the wrong size of video, and raising the
# ceiling is a paid plan, not a code change.
#
# The worker already has a 25GB volume mounted at /data that is paid for and
# almost empty. Uploading straight to it costs nothing extra, removes the size
# limit, and removes a download hop: the file is already on the machine that
# needs it.
#
# ── Why a signed ticket, and not the shared secret ──────────────────────────
# Every other worker endpoint authenticates with WORKER_WEBHOOK_SECRET in a
# header. A browser cannot hold that: shipping it to the client would hand every
# visitor the ability to submit and cancel anyone's jobs.
#
# So the app mints a short-lived ticket instead. It is an HMAC over
# (user_id, upload_id, expiry) keyed with the same shared secret, produced
# server-side by an authenticated Next.js route. The worker verifies the
# signature and expiry without needing to talk to the app or hold any user
# state. The secret never leaves a server; the ticket is useless after it
# expires; and it is bound to one user and one upload, so it cannot be replayed
# against a different account.

import hashlib
import hmac
import os
import re
import shutil
import time

from fastapi import HTTPException

from config import config
from logger import log

# Uploads live beside the worker's scratch space, on the mounted volume.
UPLOAD_SUBDIR = "uploads"

# A ticket is good for 60 minutes. Long enough that a 2GB upload on a slow
# connection does not expire mid-flight; short enough that a leaked ticket is
# not a standing invitation.
TICKET_TTL_SECONDS = 60 * 60

# Refuse rather than fill the disk. Two concurrent jobs plus ffmpeg
# intermediates need real headroom on a 25GB volume, and a full disk fails
# every in-flight render, not just the upload that caused it.
MIN_FREE_BYTES_AFTER_UPLOAD = 6 * 1024 * 1024 * 1024  # 6GB

MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024  # 4GB

_SAFE_ID = re.compile(r'^[A-Za-z0-9_-]{8,64}$')
_SAFE_EXT = re.compile(r'^[a-z0-9]{2,5}$')


def sign_ticket(user_id: str, upload_id: str, expires_at: int) -> str:
    """
    Deterministic signature over the three things that must not be forgeable.

    Kept in exact step with the app's minting route — see
    app/api/video/upload-ticket/route.ts. If either side changes the payload
    shape, every upload fails closed rather than silently accepting anything.
    """
    payload = f'{user_id}:{upload_id}:{expires_at}'.encode('utf-8')
    return hmac.new(config.webhook_secret.encode('utf-8'), payload, hashlib.sha256).hexdigest()


def verify_ticket(user_id: str, upload_id: str, expires_at: int, signature: str) -> None:
    """Raise 401/403 unless this ticket is genuine, current, and well-formed."""
    if not _SAFE_ID.match(user_id or '') or not _SAFE_ID.match(upload_id or ''):
        # Both become path segments below. Rejecting them here is what stops
        # "../../etc" ever reaching the filesystem.
        raise HTTPException(status_code=400, detail="Malformed upload identifiers")

    if expires_at < int(time.time()):
        raise HTTPException(status_code=403, detail="Upload ticket has expired. Reload and try again.")

    if expires_at > int(time.time()) + TICKET_TTL_SECONDS + 60:
        # An expiry further out than the app is allowed to mint means someone
        # is choosing their own, which only matters if they can also sign it —
        # but refuse anyway rather than trust the signature alone.
        raise HTTPException(status_code=403, detail="Upload ticket expiry is out of range")

    expected = sign_ticket(user_id, upload_id, expires_at)
    # compare_digest, not ==, so a wrong signature cannot be discovered one
    # byte at a time through timing.
    if not hmac.compare_digest(expected, signature or ''):
        log.warning("upload_ticket_invalid", user_id=user_id[:8], upload_id=upload_id[:8])
        raise HTTPException(status_code=401, detail="Invalid upload ticket")


def upload_dir() -> str:
    path = os.path.join(config.temp_dir, UPLOAD_SUBDIR)
    os.makedirs(path, exist_ok=True)
    return path


def local_path_for(user_id: str, upload_id: str, ext: str) -> str:
    if not _SAFE_EXT.match(ext or ''):
        ext = 'mp4'
    user_dir = os.path.join(upload_dir(), user_id)
    os.makedirs(user_dir, exist_ok=True)
    return os.path.join(user_dir, f'{upload_id}.{ext}')


def assert_disk_headroom(incoming_bytes: int) -> None:
    """
    Check BEFORE writing, not after. A disk that fills mid-write takes down
    every concurrent render on the machine, not just this upload.
    """
    usage = shutil.disk_usage(config.temp_dir)
    projected_free = usage.free - incoming_bytes
    if projected_free < MIN_FREE_BYTES_AFTER_UPLOAD:
        log.warning(
            "upload_rejected_disk",
            free_gb=round(usage.free / 1e9, 1),
            incoming_gb=round(incoming_bytes / 1e9, 2),
        )
        raise HTTPException(
            status_code=507,
            detail=(
                "The worker does not have room for this file right now. "
                "Wait for current jobs to finish, or upload a smaller file."
            ),
        )


def cleanup_upload(user_id: str, upload_id: str) -> None:
    """Delete a source file once its job is done. Nothing here is durable."""
    user_dir = os.path.join(upload_dir(), user_id)
    if not os.path.isdir(user_dir):
        return
    for name in os.listdir(user_dir):
        if name.startswith(upload_id):
            try:
                os.remove(os.path.join(user_dir, name))
                log.info("upload_cleaned", upload_id=upload_id[:8])
            except OSError as exc:
                log.warning("upload_cleanup_failed", upload_id=upload_id[:8], error=str(exc)[:80])


def reap_orphaned_uploads(max_age_seconds: int = 24 * 60 * 60) -> int:
    """
    Delete uploads that never became a job.

    Someone picks a file, the upload completes, and they close the tab before
    submitting — that file would otherwise sit on the volume forever. Unbounded
    growth on a 25GB disk is the same class of failure as the non-terminal job
    states L2.3 had to reap.
    """
    root = upload_dir()
    cutoff = time.time() - max_age_seconds
    removed = 0
    for user_id in os.listdir(root):
        user_dir = os.path.join(root, user_id)
        if not os.path.isdir(user_dir):
            continue
        for name in os.listdir(user_dir):
            full = os.path.join(user_dir, name)
            try:
                if os.path.getmtime(full) < cutoff:
                    os.remove(full)
                    removed += 1
            except OSError:
                continue
    if removed:
        log.info("orphaned_uploads_reaped", count=removed)
    return removed
