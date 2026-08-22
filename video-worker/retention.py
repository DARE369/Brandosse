# video-worker/retention.py
#
# LOCK L7.4 — bound what clipping costs to store.
#
# ── The problem this closes ─────────────────────────────────────────────────
# Rendered clips go to the Supabase `video-clips` bucket and nothing ever
# removed them. Files were deleted only when a user explicitly deleted a job
# (app/api/video/jobs/[id]/route.ts:115). There was no expiry, no sweep, and no
# ceiling.
#
# At 1080p vertical a 30-60s clip is 5-15MB, and one video commonly yields 8
# clips — 40-120MB per video. Against a 1GB free-tier bucket that is 8-25 videos
# before the product stops working, and the failure would arrive as a render
# that uploads nothing.
#
# ── And a leak that made it worse ───────────────────────────────────────────
# database.delete_clips_for_job() deleted ROWS and left the FILES. It runs at
# the start of every analysis, including every crash-recovery retry, so each
# reprocessed job orphaned its previous clips permanently — storage that grows
# with nothing referencing it and nothing able to find it again.
#
# ── Why expiry is correct, not a compromise ─────────────────────────────────
# Clip URLs have always been signed with a 48-hour expiry
# (utils/storage_uploader.py:11). Whoever wrote that already treated clips as
# deliverables — you generate them, download them, post them. Keeping the bytes
# forever was never the design; nobody finished the thought.
#
# Retention makes the storage bill a function of RECENT activity rather than
# TOTAL activity, which is what lets clipping run at any volume on a free plan.

import os
import time
from datetime import datetime, timedelta, timezone

from database import supabase
from logger import log

CLIPS_BUCKET = "video-clips"

# Verified against the live check constraint on 2026-08-22, by attempting an
# insert of each candidate: "complete" and "failed" are accepted; "completed",
# "cancelled" and "canceled" are all REJECTED.
#
# This is not pedantry. The first version of this filtered on "completed", which
# the constraint does not allow — so it matched failed jobs and never once
# matched a successful one. Successful jobs are precisely the ones that produce
# clips and therefore the only ones whose storage actually accumulates, so the
# sweep would have run forever, reported success, and freed almost nothing.
TERMINAL_STATUSES = ["complete", "failed"]

# Generous against a 48-hour signed URL: a user who generates on Friday and
# posts the following week still finds their files.
RETENTION_DAYS = int(os.environ.get("WORKER_CLIP_RETENTION_DAYS", "7"))

# The sweep is cheap but not free, and nothing here is urgent to the minute.
SWEEP_INTERVAL_SECONDS = 60 * 60

_last_sweep_at = 0.0


def _remove_prefix(prefix: str) -> int:
    """
    Delete every object under a storage prefix.

    Listing the prefix rather than deleting the paths recorded on clip rows is
    deliberate: it also collects files whose rows are already gone, which is
    exactly the orphan case that produced unreferenced storage in the first
    place.
    """
    try:
        entries = supabase.storage.from_(CLIPS_BUCKET).list(prefix)
    except Exception as exc:
        log.warning("retention_list_failed", prefix=prefix, error=str(exc)[:100])
        return 0

    if not entries:
        return 0

    paths = [f"{prefix}/{entry['name']}" for entry in entries if entry.get("name")]
    if not paths:
        return 0

    try:
        supabase.storage.from_(CLIPS_BUCKET).remove(paths)
        return len(paths)
    except Exception as exc:
        log.warning("retention_remove_failed", prefix=prefix, error=str(exc)[:100])
        return 0


def purge_job_clips(job_id: str, user_id: str) -> int:
    """
    Remove a job's clip FILES. Callers that also want the rows gone should call
    database.delete_clips_for_job afterwards.

    Split from the row delete on purpose: files and rows fail independently, and
    deleting rows first would lose the only record of what to delete.
    """
    return _remove_prefix(f"{user_id}/{job_id}")


def reap_expired_clips(retention_days: int = RETENTION_DAYS) -> dict:
    """
    Delete clips older than the retention window, files first, then rows.

    Only touches jobs in a terminal state. A job still working is not old, it is
    slow, and removing its output mid-render would be the worst possible bug to
    introduce in the name of tidiness.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    cutoff_iso = cutoff.isoformat()

    try:
        jobs = (
            supabase.table("video_jobs")
            .select("id,user_id")
            .lt("updated_at", cutoff_iso)
            .in_("status", TERMINAL_STATUSES)
            .limit(200)
            .execute()
        ).data or []
    except Exception as exc:
        log.warning("retention_query_failed", error=str(exc)[:120])
        return {"jobs": 0, "files": 0}

    files_removed = 0
    jobs_swept = 0

    for job in jobs:
        removed = purge_job_clips(job["id"], job["user_id"])
        if removed:
            files_removed += removed
        try:
            supabase.table("video_clips").delete().eq("job_id", job["id"]).execute()
        except Exception as exc:
            log.warning("retention_row_delete_failed", job_id=job["id"], error=str(exc)[:80])
            continue
        jobs_swept += 1

    if files_removed or jobs_swept:
        log.info(
            "clip_retention_swept",
            jobs=jobs_swept,
            files=files_removed,
            retention_days=retention_days,
        )

    return {"jobs": jobs_swept, "files": files_removed}


def maybe_sweep() -> None:
    """
    Called from the poller. Rate-limited so a 5-second poll loop does not run a
    storage sweep 720 times an hour.

    Deliberately never raises: retention failing is a cost problem, and a cost
    problem must not take down the pipeline that earns the money.
    """
    global _last_sweep_at
    now = time.time()
    if now - _last_sweep_at < SWEEP_INTERVAL_SECONDS:
        return
    _last_sweep_at = now

    try:
        reap_expired_clips()
    except Exception as exc:
        log.warning("retention_sweep_failed", error=str(exc)[:120])
