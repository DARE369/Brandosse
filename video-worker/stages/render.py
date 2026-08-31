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
from brand_kit import load_brand_kit, screen_hook_title
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


# Below this, hook text stops being readable on a phone and the words should be
# dropped instead of shrunk further.
HOOK_MIN_FONTSIZE = 15
HOOK_MAX_FONTSIZE = 30


def _fitted_fontsize(text: str, frame_w: int) -> int:
    """
    Largest readable drawtext size for `text` on a `frame_w`-wide frame.

    drawtext cannot wrap, so the only fit control is size. Assumes ~0.6 x
    fontsize average glyph width and targets 90% of the frame.
    """
    if not text:
        return HOOK_MAX_FONTSIZE
    raw = int(0.9 * frame_w / (0.6 * len(text)))
    return max(HOOK_MIN_FONTSIZE, min(HOOK_MAX_FONTSIZE, raw))


def _build_hook_text_filter(ai_title, frame_w: int = 608) -> str:
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

    # A hook is 5-7 punchy words, not a full sentence. The first real render
    # burned "...rem Explained in Plain English (No M..." across the top of a
    # 404px-wide clip — the title was wider than the frame, so the centred
    # drawtext overflowed BOTH edges and read as garbage. Truncating by words
    # keeps whatever survives coherent; truncating by pixels would not.
    # Trim only as far as readability requires, not to a fixed word count.
    # A hard 7-word cap was sized for a 404px frame and cut "He sent 50
    # DOPPELGANGERS to trap 100 cops" to "...to trap 100" — losing the noun and
    # the joke. Sources now arrive at 1080p, so frames are wider and the font
    # auto-fits: start with the whole title and drop trailing words only while
    # the fitted size would fall below the readable floor.
    words = str(ai_title).strip().split()
    hook_text = " ".join(words[:12])
    while len(words) > 3 and _fitted_fontsize(hook_text, frame_w) <= HOOK_MIN_FONTSIZE:
        words = words[:-1]
        hook_text = " ".join(words)

    escaped = _escape_drawtext_text(hook_text)
    if not escaped:
        return ""

    # Size the text to the frame it will actually be drawn on. drawtext cannot
    # wrap, so the only way to guarantee fit is to shrink: aim for ~90% of the
    # frame width at ~0.6 x fontsize average glyph width, clamped to stay
    # readable (14px floor) and tasteful (30px ceiling). frame_w must be the
    # OUTPUT width — the filter runs after scaling.
    fontsize = _fitted_fontsize(escaped, frame_w)

    return (
        f"drawtext="
        f"text='{escaped}'"
        f":x=(w-text_w)/2"
        f":y=50"
        f":fontsize={fontsize}"
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

    hook_filter = _build_hook_text_filter(clip.get("ai_title") if clip else None, frame_w=out_w)

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
            # Crop a window that ALREADY has the output aspect ratio, then scale
            # it. Both numbers must fit inside the source frame.
            #
            # This was `target_w = min(out_w, video_width)` with crop_height set
            # to out_h — i.e. it asked for a 608x1080 crop out of a 1280x720
            # screencast. 1080 > 720, so ffmpeg's crop filter refused, the video
            # stream produced no packets, and every clip failed with
            # "return code -22 (Invalid argument)" and frame=0 while the audio
            # encoded perfectly. Two mistakes in one: out_h is the OUTPUT height,
            # not the source's, and cropping 608 wide then scaling to 608x1080
            # would have stretched the picture vertically even where it fitted.
            target_h = make_even(video_height)
            target_w = make_even(int(round(target_h * out_w / out_h)))
            if target_w > video_width:
                target_w = make_even(video_width)
                target_h = make_even(int(round(target_w * out_h / out_w)))

            # Centre the window vertically when it is shorter than the frame.
            # Zero would crop the top and drop whatever is at the bottom, which
            # on a screencast is usually the thing being pointed at.
            crop_y_centred = max(0, (video_height - target_h) // 2)

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
                    "crop_y": crop_y_centred,
                    "crop_width": target_w,
                    "crop_height": target_h,
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
                    "crop_y": crop_y_centred,
                    "crop_width": target_w,
                    "crop_height": target_h,
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
                    "crop_y": crop_y_centred,
                    "crop_width": target_w,
                    "crop_height": target_h,
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

        # The output frame is the crop's native width (ffmpeg_utils caps the
        # render there unless WORKER_ALLOW_UPSCALE). If upscaling is on, the
        # hook comes out slightly small on the bigger canvas — never oversized.
        hook_frame_w = crop_coords.get("crop_width") or 608
        hook_filter = _build_hook_text_filter(clip_score_data.get("ai_title"), frame_w=hook_frame_w)

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

    # ── Brand screening of hook titles ───────────────────────────────────────
    # The hook title is written by an LLM in the analyze stage and burned into
    # H.264 further down this file. Until 2026-08-31 nothing checked it against
    # the user's own `forbidden_phrases`, so a brand could ship a clip whose
    # overlay violates its own guidelines — and unlike a caption, burned-in
    # pixels cannot be corrected without paying to re-render.
    #
    # Screened once here, at the single point where titles enter the render
    # path, so every downstream use inherits the result rather than each call
    # site having to remember. A blocked title is dropped, not rewritten: the
    # clip still ships with its captions, just without a hook card.
    # Both title sources must be screened. `db_clips` feeds the split-layout
    # path and `clips` (the analyze stage's score data) feeds the single-clip
    # path at the other _build_hook_text_filter call site — screening only one
    # would leave the other rendering unchecked text into pixels.
    brand = load_brand_kit(user_id)
    blocked_titles = 0
    for record in [*db_clips, *clips]:
        if not isinstance(record, dict):
            continue
        safe_title, violations = screen_hook_title(
            record.get("ai_title"), brand, job_id=job_id
        )
        if violations:
            blocked_titles += 1
            record["ai_title"] = None
    if blocked_titles:
        log.warning(
            "hook_titles_blocked",
            job_id=job_id,
            blocked=blocked_titles,
            total=len(db_clips),
            message="Hook overlays omitted on these clips — the generated title "
                    "contained a phrase the brand kit forbids.",
        )

    # ── Launch clip renders with bounded concurrency ─────────────────────────────
    # Limit to 2 simultaneous renders. Running all clips at once hammers the same
    # source file from N ffmpeg processes concurrently, causing disk I/O thrash that
    # turns a 5-minute job into hours. 2 at a time keeps I/O sane while still
    # overlapping MediaPipe + encode work across clips.
    # ONE render at a time on this machine size. This was 2, and on the
    # shared-cpu-1x box two ffmpeg encodes thrash a single vCPU so hard that
    # neither finishes before Fly's idle-stop kills the machine (observed
    # 2026-08-23: two 3-minute clips, 15+ minutes, zero completed). Sequential
    # is the same total CPU but each clip COMMITS as it finishes, so an
    # interruption loses at most one clip of progress instead of all of them.
    # Raise this only together with the machine size (L7.5).
    MAX_CONCURRENT_RENDERS = 1
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
    already_complete = []

    for index, clip_score_data in enumerate(clips):
        clip_index = clip_score_data.get("clip_index", index)
        db_row = next(
            (row for row in db_clips if row["clip_index"] == clip_index),
            db_clips[index] if index < len(db_clips) else None,
        )

        if db_row is None:
            log.error("no_db_row_for_clip", job_id=job_id, clip_index=clip_index)
            continue

        # RESUME: a clip already rendered and uploaded is finished work. Each
        # clip commits itself as it completes, so an interrupted job comes back
        # with some already done. Re-encoding them wastes the scarcest resource
        # this worker has — a single shared vCPU — and on an 11-clip job that
        # difference decides whether the retry finishes at all.
        if db_row.get("render_status") == "complete" and db_row.get("storage_path"):
            log.info(
                "clip_render_skipped_already_complete",
                job_id=job_id,
                clip_index=clip_index,
            )
            already_complete.append(db_row)
            continue

        render_tasks.append(_render_with_semaphore(db_row, clip_score_data))

    if not render_tasks:
        raise RenderError("No clips could be rendered", job_id)

    results = await asyncio.gather(*render_tasks, return_exceptions=True)

    # Tally results
    # Clips that survived a previous attempt count as rendered.
    rendered_clips = list(already_complete)
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
