# video-worker/retention.py
#
# Storage cleanup for clips a user has explicitly deleted.
#
# ── The automatic 7-day expiry was REMOVED on 2026-09-01 (founder decision) ──
# Clips used to be swept 7 days after a job reached a terminal state. That is
# gone: users keep their clips until they choose to delete them.
#
# Why it was removed rather than lengthened: a deliverable that expires is not a
# deliverable. The countdown existed to bound storage cost, but it bounded it by
# destroying work the user had paid to produce, and no window is defensible to
# someone on a paid plan who comes back a fortnight later.
#
# What this means, stated plainly because it is now unbounded: clip storage grows
# with usage and nothing reclaims it automatically. The cost ledger (L5.14) is
# where storage-per-user becomes visible, and a per-user storage ceiling — not a
# time limit — is the right control if one is ever needed.
#
# What remains here is deletion the USER asked for: database.delete_clips_for_job
# removes rows and calls purge_job_clips to remove the files, which was itself a
# fix — rows were being deleted while the files were left behind forever.

from database import supabase
from logger import log

CLIPS_BUCKET = "video-clips"


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
