# video-worker/stages/render.py
# Renders selected clips to 1080x1920 MP4 files with burned captions.
# Pack 5: All clips render in parallel using asyncio.gather for ~3x speedup.

import asyncio
import cv2
import os
import subprocess
from datetime import datetime

from database import (
    get_clips_for_job,
    get_transcript_word_segments,
    mark_clip_render_failed,
    update_clip_render_complete,
)
from errors import RenderError
from logger import log
from utils.caption_generator import generate_karaoke_captions
from utils.ffmpeg_utils import extract_thumbnail, render_clip_to_file, render_with_tracking
from utils.storage_uploader import upload_and_sign
from utils.face_tracker import compute_crop_trajectory, get_video_dimensions, median_crop_x
from utils.scene_classifier import classify_clip, TALKING_HEAD, SPLIT, SCREEN_ONLY


def _get_job_field(job, field, fallback=None):
    """Safe field reader that handles dict, object, and None job values."""
    if job is None:
        return fallback
    if isinstance(job, dict):
        return job.get(field, fallback)
    return getattr(job, field, fallback)


# ── Pack 7: aspect-ratio dimensions ──────────────────────────────────────────

RATIO_MAP: dict = {
    "9:16": (608,  1080),
    "4:5":  (864,  1080),
    "1:1":  (1080, 1080),
    "16:9": (1920, 1080),
    "3:4":  (810,  1080),
}


def make_even(n: int) -> int:
    return n - (n % 2)


def calculate_output_dimensions(aspect_ratio: str) -> tuple:
    return RATIO_MAP.get(aspect_ratio, RATIO_MAP["9:16"])


def detect_pip_region(
    video_path: str,
    timestamp_secs: float,
    video_width: int,
    video_height: int,
):
    """
    Detect PiP webcam bounding box in a single frame at timestamp_secs.

    Returns (x, y, w, h) — all even-integer pixel coords — or None if no
    small-corner face is found. Expands the raw MediaPipe bbox by 2.5× and
    caps the result at 35% of the frame width; crops square.
    """
    try:
        import mediapipe as mp
    except ImportError:
        return None

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return None

    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(timestamp_secs * fps))
        ret, frame = cap.read()
    finally:
        cap.release()

    if not ret:
        return None

    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    frame_rgb.flags.writeable = False

    with mp.solutions.face_detection.FaceDetection(
        model_selection=1, min_detection_confidence=0.5
    ) as detector:
        results = detector.process(frame_rgb)

    if not results.detections:
        return None

    pip_face = None
    for det in results.detections:
        bbox    = det.location_data.relative_bounding_box
        face_w  = bbox.width
        face_cx = max(0.0, min(1.0, bbox.xmin + face_w / 2.0))
        face_cy = max(0.0, min(1.0, bbox.ymin + bbox.height / 2.0))

        is_small  = face_w <= 0.12
        is_corner = (
            (face_cx < 0.30 or face_cx > 0.70)
            and (face_cy < 0.30 or face_cy > 0.70)
        )
        if is_small and is_corner:
            pip_face = det
            break

    if pip_face is None:
        return None

    bbox     = pip_face.location_data.relative_bounding_box
    raw_px_w = int(bbox.width * video_width)
    center_x = int((bbox.xmin + bbox.width  / 2.0) * video_width)
    center_y = int((bbox.ymin + bbox.height / 2.0) * video_height)

    max_side = int(video_width * 0.35)
    side     = make_even(min(int(raw_px_w * 2.5), max_side))

    x = make_even(max(0, min(video_width  - side, center_x - side // 2)))
    y = make_even(max(0, min(video_height - side, center_y - side // 2)))

    return (x, y, side, side)


def _escape_drawtext_text(text: str) -> str:
    """
    Escape a string for use in the FFmpeg drawtext filter's text= option.

    Order matters: backslash MUST be escaped first so that subsequent
    replacements don't double-escape already-escaped characters.

    Apostrophes (') are replaced with the typographic RIGHT SINGLE QUOTATION
    MARK (U+2019) rather than escaped as \' because FFmpeg's level-2 filter
    chain parser treats \' as "backslash then end-of-single-quote" — it does
    NOT treat \ as an escape character inside single-quoted option values at
    the filter-chain level. A premature closing quote then leaves enable=
    'between(t,0,5)' unquoted, causing the commas to split the filter chain
    and FFmpeg to error with "No such filter: '0'".
    """
    if not text:
        return ""

    text = text.replace("\\", "\\\\")  # MUST be first
    text = text.replace(":",  "\\:")
    text = text.replace("'",  "’")  # typographic apostrophe — safe in FFmpeg filters

    text = " ".join(text.split())  # collapse whitespace / control chars

    if len(text) > 80:
        text = text[:77] + "..."

    return text


def _build_hook_text_filter(ai_title) -> str:
    """
    Build an FFmpeg drawtext filter string for the hook text overlay.

    Returns an empty string when ai_title is falsy — callers should check
    before appending to avoid an empty filter expression in the vf chain.

    The text appears at the top-centre of the frame for the first 5 seconds.
    Single quotes around between(t,0,5) prevent FFmpeg's filter parser from
    treating the commas as chain separators.
    """
    if not ai_title or not str(ai_title).strip():
        return ""

    escaped = _escape_drawtext_text(str(ai_title).strip())
    if not escaped:
        return ""

    return (
        f"drawtext="
        f"text='{escaped}'"
        f":x=(w-text_w)/2"
        f":y=50"
        f":fontsize=22"
        f":fontcolor=white"
        f":box=1"
        f":boxcolor=black@0.55"
        f":boxborderw=12"
        f":enable='between(t,0,5)'"
    )


async def _render_split_layout(
    job,
    clip: dict,
    video_path: str,
    video_width: int,
    video_height: int,
    out_w: int,
    out_h: int,
    pip_region,
    captions_file,
    output_path: str,
) -> str:
    """
    Render a SPLIT-scene clip as a stacked or side-by-side layout.

    Portrait  (out_h >= out_w): top 65% screen, bottom 35% webcam — vstack
    Landscape (out_w  > out_h): left 65% screen, right  35% webcam — hstack

    Falls back to a full-frame scale when no PiP region was detected.
    Returns output_path so the caller can verify the file exists.
    """
    job_id      = _get_job_field(job, "id") or "unknown"
    start       = float(clip["start_time_secs"])
    end         = float(clip["end_time_secs"])
    is_portrait = out_h >= out_w

    if is_portrait:
        screen_h    = make_even(int(out_h * 0.65))
        pip_panel_h = out_h - screen_h

        if pip_region:
            px, py, pw, ph = pip_region
            vf = [
                "[0:v]split=2[A][B]",
                f"[A]scale={out_w}:{screen_h}:flags=lanczos,format=yuv420p[screen]",
                (
                    f"[B]crop={pw}:{ph}:{px}:{py},"
                    f"scale=-2:{pip_panel_h},"
                    f"pad={out_w}:{pip_panel_h}:-1:-1:color=black,"
                    f"format=yuv420p[pip]"
                ),
                "[screen][pip]vstack=inputs=2[stacked]",
            ]
        else:
            vf = [f"[0:v]scale={out_w}:{out_h}:flags=lanczos,format=yuv420p[stacked]"]

    else:
        screen_w    = make_even(int(out_w * 0.65))
        pip_panel_w = out_w - screen_w

        if pip_region:
            px, py, pw, ph = pip_region
            vf = [
                "[0:v]split=2[A][B]",
                f"[A]scale={screen_w}:{out_h}:flags=lanczos,format=yuv420p[screen]",
                (
                    f"[B]crop={pw}:{ph}:{px}:{py},"
                    f"scale=-2:{out_h},"
                    f"pad={pip_panel_w}:{out_h}:-1:-1:color=black,"
                    f"format=yuv420p[pip]"
                ),
                "[screen][pip]hstack=inputs=2[stacked]",
            ]
        else:
            vf = [f"[0:v]scale={out_w}:{out_h}:flags=lanczos,format=yuv420p[stacked]"]

    hook_filter = _build_hook_text_filter(clip.get("ai_title") if clip else None)

    if captions_file:
        captions_escaped = captions_file.replace("\\", "/").replace(":", "\\:")
        if hook_filter:
            vf.append(f"[stacked]ass={captions_escaped}[capped]")
            vf.append(f"[capped]{hook_filter}[out]")
        else:
            vf.append(f"[stacked]ass={captions_escaped}[out]")
        map_label = "[out]"
    elif hook_filter:
        vf.append(f"[stacked]{hook_filter}[out]")
        map_label = "[out]"
    else:
        map_label = "[stacked]"

    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start),
        "-to", str(end),
        "-i",  video_path,
        "-filter_complex", ";".join(vf),
        "-map", map_label,
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf",    "23",
        "-c:a",    "aac",
        "-b:a",    "128k",
        output_path,
    ]

    log.info(
        "split_layout_render_start",
        job_id=job_id,
        out_w=out_w,
        out_h=out_h,
        pip_detected=pip_region is not None,
        is_portrait=is_portrait,
    )

    proc = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True)

    if proc.returncode != 0:
        log.error("split_layout_ffmpeg_failed", job_id=job_id, stderr=proc.stderr[-800:])
        raise RenderError(
            f"Split layout FFmpeg failed (exit {proc.returncode}): {proc.stderr[-200:]}",
            job_id,
        )

    log.info("split_layout_render_complete", job_id=job_id, output_path=output_path)
    return output_path


async def _render_single_clip(
    clip_db_row: dict,
    clip_score_data: dict,
    source_video_path: str,
    word_segments: list[dict],
    temp_dir: str,
    job_id: str,
    user_id: str,
    job: dict = None,
) -> dict:
    """
    Render and upload one clip independently.

    Never raises exceptions — catches all errors internally and marks clips as failed.
    This allows parallel renders to complete independently even if some fail.
    Cleans up temp files immediately after each clip finishes (success or failure).
    """
    clip_id = clip_db_row["id"]
    clip_index = clip_db_row["clip_index"]
    result = {**clip_db_row, "render_status": "failed"}

    # Temp file paths — cleaned up in finally block
    ass_path = None
    output_path = None
    thumb_path = None

    try:
        # ── Read job-level preferences ────────────────────────────────────────
        caption_style = _get_job_field(job, 'caption_style') or 'karaoke'
        aspect_ratio  = _get_job_field(job, 'aspect_ratio')  or '9:16'
        log.debug(
            "clip_settings_read",
            job_id=job_id,
            caption_style=caption_style,
            aspect_ratio=aspect_ratio,
        )
        out_w, out_h  = calculate_output_dimensions(aspect_ratio)

        start_secs = float(clip_score_data["start_time_secs"])
        end_secs = float(clip_score_data["end_time_secs"])
        duration_secs = end_secs - start_secs

        if duration_secs <= 0:
            raise RenderError(f"Clip {clip_index} has invalid duration {duration_secs}", job_id)

        log.info(
            "clip_render_start",
            job_id=job_id,
            clip_index=clip_index,
            clip_id=clip_id,
            start=round(start_secs, 1),
            end=round(end_secs, 1),
            duration=round(duration_secs, 1),
        )

        # Pre-allocate temp file paths (cleaned up in finally block)
        output_path = os.path.join(temp_dir, f"clip_{clip_id}_final.mp4")
        thumb_path = os.path.join(temp_dir, f"clip_{clip_id}_thumb.jpg")

        ass_path = await asyncio.to_thread(
            generate_karaoke_captions,
            word_segments,
            start_secs,
            end_secs,
            os.path.join(temp_dir, f"captions_{job_id}_{clip_id}.ass"),
            caption_style,
            out_w,
            out_h,
        )

        if ass_path:
            log.info("captions_ready", job_id=job_id, clip_index=clip_index)
        else:
            log.warning("captions_skipped_no_words", job_id=job_id, clip_index=clip_index)

        # Get video dimensions for face tracking
        vid_dims = await asyncio.to_thread(get_video_dimensions, source_video_path)
        video_width = vid_dims["width"]
        video_height = vid_dims["height"]

        # Check if video is already vertical (skip reframing)
        is_vertical = video_height > video_width
        split_rendered = False

        if not is_vertical:
            target_w = min(out_w, video_width)

            # ── Scene classification — runs BEFORE face tracker ───────────────
            # classify_clip is synchronous (MediaPipe + NumPy). asyncio.to_thread
            # offloads it so the event loop remains responsive.
            #
            # Running classification first lets us skip the face tracker entirely
            # for SCREEN_ONLY clips where there is no face to track (saves 2–5 s).
            scene = await asyncio.to_thread(
                classify_clip,
                source_video_path,
                start_secs,
                end_secs,
                debug_log_fn=lambda msg, **kw: log.debug(
                    msg, job_id=job_id, clip_index=clip_index, **kw
                ),
            )

            log.info(
                "scene_classified",
                job_id=job_id,
                clip_index=clip_index,
                clip_start=start_secs,
                dominant=scene["dominant"],
                confidence=scene["confidence"],
                frame_count=scene["frame_count"],
                vote_counts=scene["vote_counts"],
            )

            # ── TALKING_HEAD: face tracking (Pack 5) ──────────────────────────
            # Person fills the frame. Centre crop on the detected face with EMA
            # smoothing; falls back to centre crop if no face found.

            if scene["dominant"] == TALKING_HEAD:
                trajectory = await asyncio.to_thread(
                    compute_crop_trajectory,
                    source_video_path,
                    start_secs,
                    end_secs,
                    video_width,
                    target_w,
                )
                crop_x = median_crop_x(trajectory)
                if crop_x is None:
                    crop_x = max(0, (video_width - target_w) // 2)
                    log.warning(
                        "talking_head_no_face_centre_crop",
                        job_id=job_id,
                        clip_index=clip_index,
                    )
                else:
                    log.debug(
                        "face_tracked_crop",
                        job_id=job_id,
                        clip_index=clip_index,
                        crop_x=crop_x,
                        trajectory_samples=len(trajectory),
                    )
                crop_coords = {
                    "crop_x": crop_x,
                    "crop_y": 0,
                    "crop_width": target_w,
                    "crop_height": out_h,
                    "method": "talking_head",
                }

            # ── SPLIT: screen + PiP webcam (Pack 7) ──────────────────────────
            # Screen recording with a small webcam overlay in the corner.
            # detect_pip_region locates the webcam bubble; _render_split_layout
            # builds the stacked / side-by-side FFmpeg filtergraph.

            elif scene["dominant"] == SPLIT:
                pip_ts     = start_secs + (end_secs - start_secs) * 0.10
                pip_region = await asyncio.to_thread(
                    detect_pip_region,
                    source_video_path,
                    pip_ts,
                    video_width,
                    video_height,
                )
                log.info(
                    "split_pip_detected",
                    job_id=job_id,
                    clip_index=clip_index,
                    pip_region=pip_region,
                )
                await _render_split_layout(
                    job=job,
                    clip=clip_score_data,
                    video_path=source_video_path,
                    video_width=video_width,
                    video_height=video_height,
                    out_w=out_w,
                    out_h=out_h,
                    pip_region=pip_region,
                    captions_file=ass_path,
                    output_path=output_path,
                )
                split_rendered = True

            # ── SCREEN_ONLY: cursor tracking (Pack 8) ────────────────────────
            # Pure screen/slides/code content. Frame differencing detects the
            # mouse cursor; crops to keep it visible. Falls back to centre crop
            # when no cursor movement is detected (static screens, hidden cursor).

            elif scene["dominant"] == SCREEN_ONLY:
                from utils.cursor_tracker import (
                    compute_cursor_trajectory as _compute_cursor_trajectory,
                    median_crop_x as _cursor_median_crop_x,
                )

                cursor_trajectory = await asyncio.to_thread(
                    _compute_cursor_trajectory,
                    source_video_path,
                    start_secs,
                    end_secs,
                    video_width,
                    target_w,
                )

                crop_x = _cursor_median_crop_x(cursor_trajectory)

                if crop_x is not None:
                    log.info(
                        "screen_only_cursor_tracked",
                        job_id=job_id,
                        clip_index=clip_index,
                        crop_x=crop_x,
                        trajectory_samples=len(cursor_trajectory),
                    )
                else:
                    crop_x = max(0, (video_width - target_w) // 2)
                    log.info(
                        "screen_only_no_cursor_centre_crop",
                        job_id=job_id,
                        clip_index=clip_index,
                    )

                crop_coords = {
                    "crop_x": crop_x,
                    "crop_y": 0,
                    "crop_width": target_w,
                    "crop_height": out_h,
                    "method": "screen_only",
                }

            else:
                # Safety net — should not occur with the current classifier.
                log.error(
                    "unexpected_scene_type",
                    job_id=job_id,
                    clip_index=clip_index,
                    scene=scene["dominant"],
                )
                crop_x = max(0, (video_width - target_w) // 2)
                crop_coords = {
                    "crop_x": crop_x,
                    "crop_y": 0,
                    "crop_width": target_w,
                    "crop_height": out_h,
                    "method": scene["dominant"].lower(),
                }

        else:
            # Already vertical - no reframing needed
            crop_coords = {
                "crop_x": 0,
                "crop_y": 0,
                "crop_width": video_width,
                "crop_height": video_height,
                "method": "vertical_passthrough",
            }
            log.info(
                "video_already_vertical",
                job_id=job_id,
                clip_index=clip_index,
                width=video_width,
                height=video_height,
            )

        hook_filter = _build_hook_text_filter(clip_score_data.get("ai_title"))

        if not split_rendered:
            render_ok, render_result = await asyncio.to_thread(
                render_with_tracking,
                source_video_path,
                start_secs,
                end_secs,
                crop_coords,
                ass_path,
                output_path,
                hook_filter,
            )

            if not render_ok:
                raise RenderError(f"Clip {clip_index} render failed: {render_result}", job_id)

        log.info(
            "clip_mp4_rendered",
            job_id=job_id,
            clip_index=clip_index,
            output_path=output_path,
        )

        thumb_ok, thumb_result = await asyncio.to_thread(
            extract_thumbnail,
            output_path,
            thumb_path,
            1.0,
        )

        if not thumb_ok:
            log.warning(
                "thumbnail_failed_continuing",
                job_id=job_id,
                clip_index=clip_index,
                error=thumb_result,
            )
            thumb_path = None

        clip_storage_path = f"{user_id}/{job_id}/clip_{clip_index}.mp4"
        clip_ok, clip_storage, clip_url = await asyncio.to_thread(
            upload_and_sign,
            output_path,
            clip_storage_path,
            "video/mp4",
        )

        if not clip_ok:
            # upload_and_sign returns (False, "", error_message) on failure, so
            # the error text is in clip_url, not clip_storage.
            raise RenderError(f"Clip {clip_index} upload failed: {clip_url}", job_id)

        log.info(
            "clip_uploaded",
            job_id=job_id,
            clip_index=clip_index,
            storage_path=clip_storage_path,
        )

        thumb_storage_path = None
        thumb_url = None

        if thumb_path and os.path.exists(thumb_path):
            requested_thumb_path = f"{user_id}/{job_id}/clip_{clip_index}_thumb.jpg"
            thumb_ok, thumb_storage, signed_thumb_url = await asyncio.to_thread(
                upload_and_sign,
                thumb_path,
                requested_thumb_path,
                "image/jpeg",
            )

            if thumb_ok:
                thumb_storage_path = thumb_storage
                thumb_url = signed_thumb_url
            else:
                # upload_and_sign returns (False, "", error_message) on failure, so
                # the error text is in signed_thumb_url, not thumb_storage.
                log.warning(
                    "thumbnail_upload_failed_continuing",
                    job_id=job_id,
                    clip_index=clip_index,
                    error=signed_thumb_url,
                )

        update_clip_render_complete(
            clip_id=clip_id,
            storage_path=clip_storage_path,
            public_url=clip_url,
            thumbnail_path=thumb_storage_path,
            thumbnail_url=thumb_url,
        )

        log.info("clip_render_complete", job_id=job_id, clip_index=clip_index, clip_id=clip_id)

        result["render_status"] = "complete"
        result["storage_path"] = clip_storage_path
        result["public_url"] = clip_url
        result["thumbnail_path"] = thumb_storage_path
        result["thumbnail_url"] = thumb_url
        result["local_path"] = output_path  # kept alive for stitch stage; temp_dir cleanup handles final deletion

    except Exception as e:
        log.error(
            "clip_render_failed",
            job_id=job_id,
            clip_index=clip_index,
            clip_id=clip_id,
            error=str(e),
            exc_info=True,
        )
        mark_clip_render_failed(clip_id, str(e))
        result["render_status"] = "failed"
        result["render_error"] = str(e)

    finally:
        # ── Clean up temp files immediately after clip finishes (success or failure) ──
        # output_path is intentionally excluded: the stitch stage needs the MP4
        # files on disk. The outer shutil.rmtree(temp_dir) in process_job handles
        # final deletion after stitching completes.
        for temp_file in [ass_path, thumb_path]:
            if temp_file and os.path.exists(temp_file):
                try:
                    os.remove(temp_file)
                    log.debug("temp_file_cleaned", job_id=job_id, path=temp_file)
                except OSError as e:
                    log.warning("temp_file_cleanup_failed", job_id=job_id, path=temp_file, error=str(e))

    return result


async def run_render(
    job: dict,
    video_path: str,
    clips: list[dict],
    temp_dir: str,
) -> list[dict]:
    """
    Render all selected clips in parallel and upload them to Supabase Storage.

    Pack 5 feature: clips render simultaneously using asyncio.gather.
    This collapses 4 minutes (sequential 4×60s) into ~75 seconds (parallel 1.1×60s).
    Failed clips do not cancel others — job completes as long as ≥1 clip succeeds.
    Each clip updates the DB and Realtime subscribers immediately after it finishes,
    so the frontend's ClipsGallery progressively fills with cards.
    """
    job_id = job["id"]
    user_id = job["user_id"]

    log.info(
        "render_stage_start",
        job_id=job_id,
        clip_count=len(clips),
        video_path=video_path,
    )

    if not clips:
        # No clips to render — mark job complete
        return []

    if not os.path.exists(video_path):
        raise RenderError(
            f"Source video file not found at {video_path}. Ensure download stage completed.",
            job_id,
        )

    db_clips = get_clips_for_job(job_id)
    if not db_clips:
        raise RenderError(
            f"No clip records found in database for job {job_id}. Ensure analyze stage saved clips.",
            job_id,
        )

    if len(db_clips) != len(clips):
        log.warning(
            "clip_count_mismatch",
            job_id=job_id,
            db_count=len(db_clips),
            score_count=len(clips),
        )

    word_segments = get_transcript_word_segments(job_id)
    if word_segments:
        log.info("word_segments_loaded", job_id=job_id, word_count=len(word_segments))
    else:
        log.warning(
            "word_segments_missing",
            job_id=job_id,
            message="Captions will be skipped for all clips",
        )

    # ── Launch clip renders with bounded concurrency ─────────────────────────────
    # Limit to 2 simultaneous renders. Running all clips at once hammers the same
    # source file from N ffmpeg processes concurrently, causing disk I/O thrash that
    # turns a 5-minute job into hours. 2 at a time keeps I/O sane while still
    # overlapping MediaPipe + encode work across clips.
    MAX_CONCURRENT_RENDERS = 2
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_RENDERS)

    async def _render_with_semaphore(db_row, clip_score_data):
        async with semaphore:
            return await _render_single_clip(
                clip_db_row=db_row,
                clip_score_data=clip_score_data,
                source_video_path=video_path,
                word_segments=word_segments,
                temp_dir=temp_dir,
                job_id=job_id,
                user_id=user_id,
                job=job,
            )

    render_tasks = []

    for index, clip_score_data in enumerate(clips):
        clip_index = clip_score_data.get("clip_index", index)
        db_row = next(
            (row for row in db_clips if row["clip_index"] == clip_index),
            db_clips[index] if index < len(db_clips) else None,
        )

        if db_row is None:
            log.error("no_db_row_for_clip", job_id=job_id, clip_index=clip_index)
            continue

        render_tasks.append(_render_with_semaphore(db_row, clip_score_data))

    if not render_tasks:
        raise RenderError("No clips could be rendered", job_id)

    results = await asyncio.gather(*render_tasks, return_exceptions=True)

    # Tally results
    rendered_clips = []
    success_count = 0
    failed_count = 0

    for result in results:
        if isinstance(result, Exception):
            log.warning("clip_render_exception", job_id=job_id, error=str(result))
            failed_count += 1
        elif isinstance(result, dict) and result.get("render_status") == "complete":
            rendered_clips.append(result)
            success_count += 1
        else:
            rendered_clips.append(result)
            failed_count += 1

    log.info(
        "render_stage_complete",
        job_id=job_id,
        total_clips=len(clips),
        successful=success_count,
        failed=failed_count,
    )

    if success_count == 0:
        error_details = "; ".join(
            clip.get("render_error", "unknown error")
            for clip in rendered_clips
            if clip.get("render_status") == "failed"
        )
        raise RenderError(
            f"All {len(clips)} clips failed to render. Errors: {error_details[:400]}",
            job_id,
        )

    if failed_count > 0:
        log.warning(
            "partial_render_success",
            job_id=job_id,
            successful=success_count,
            failed=failed_count,
        )

    return rendered_clips
