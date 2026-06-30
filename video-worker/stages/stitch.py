# video-worker/stages/stitch.py
# Stage 5: concatenate all rendered clip MP4s into a single stitched output.
# Uses FFmpeg stream-copy (no re-encode) — fast because render.py produces
# clips with identical codec (libx264), pixel format (yuv420p), and
# resolution (per-job aspect ratio), which is the stream-copy precondition.

import asyncio
import os
import shutil
import subprocess

from database import update_job_stitched_url
from errors import StitchError
from logger import log
from utils.storage_uploader import upload_and_sign


def _ffmpeg_concat(concat_list_path: str, output_path: str) -> tuple[bool, str]:
    cmd = [
        "ffmpeg", "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", concat_list_path,
        "-c", "copy",
        "-movflags", "+faststart",
        output_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            return False, result.stderr[-400:]
        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            return False, "Concat produced an empty output file"
        size_mb = os.path.getsize(output_path) / (1024 * 1024)
        log.info("stitch_ffmpeg_complete", output_path=output_path, size_mb=round(size_mb, 2))
        return True, output_path
    except subprocess.TimeoutExpired:
        return False, "Stitch timed out after 5 minutes"
    except Exception as e:
        return False, f"Unexpected stitch error: {str(e)}"


async def run_stitch(job: dict, rendered_clips: list[dict], temp_dir: str) -> str:
    """
    Stage 5: concatenate rendered clips into one stitched MP4.

    Collects the local_path left on disk by each successful render, then either
    copies it directly (single clip) or runs FFmpeg stream-copy concat (multi-clip).
    Uploads the result to video-clips storage and persists the URL on video_jobs.

    Returns the signed URL of the stitched file. Raises StitchError on failure.
    """
    job_id = job["id"]
    user_id = job["user_id"]

    local_paths = [
        c["local_path"] for c in rendered_clips
        if c.get("render_status") == "complete"
        and c.get("local_path")
        and os.path.exists(c["local_path"])
    ]

    if not local_paths:
        raise StitchError("No rendered clip files available for stitching", job_id)

    log.info("stitch_stage_start", job_id=job_id, clip_count=len(local_paths))

    stitched_path = os.path.join(temp_dir, "stitched.mp4")

    if len(local_paths) == 1:
        shutil.copy2(local_paths[0], stitched_path)
        log.info("stitch_single_clip_copy", job_id=job_id)
    else:
        concat_list_path = os.path.join(temp_dir, "concat_list.txt")
        with open(concat_list_path, "w") as f:
            for path in local_paths:
                f.write(f"file '{path.replace(chr(92), '/')}'\n")

        stitch_ok, stitch_result = await asyncio.to_thread(
            _ffmpeg_concat, concat_list_path, stitched_path
        )

        if not stitch_ok:
            raise StitchError(f"FFmpeg concat failed: {stitch_result}", job_id)

    storage_path = f"{user_id}/{job_id}/stitched.mp4"
    ok, upload_result, signed_url = await asyncio.to_thread(
        upload_and_sign, stitched_path, storage_path, "video/mp4"
    )

    if not ok:
        # upload_and_sign returns (False, "", error_message) on failure, so the
        # error text is in the signed_url slot, not upload_result.
        raise StitchError(f"Stitched video upload failed: {signed_url}", job_id)

    log.info(
        "stitch_stage_complete",
        job_id=job_id,
        storage_path=storage_path,
        clip_count=len(local_paths),
    )

    update_job_stitched_url(job_id, storage_path, signed_url or storage_path)
    return signed_url or storage_path
