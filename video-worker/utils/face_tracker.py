"""
face_tracker.py
───────────────
MediaPipe BlazeFace face tracking for video clips.

Replaces the broken OpenCV Haar cascade detector that was previously used.

Why MediaPipe over Haar cascades:
  - Haar cascades: 46–77% accuracy under challenging conditions (side profiles,
    poor lighting, glasses). Designed in 2001 for frontal faces only.
  - MediaPipe BlazeFace: purpose-built for video, handles side profiles,
    variable lighting, and partial occlusion. Runs in real-time on CPU.

Thread safety:
  Each call to compute_crop_trajectory creates its own MediaPipe detector
  instance using the context manager pattern. This is safe for parallel clip
  processing (multiple clips in the same job running simultaneously via
  asyncio.gather). A module-level singleton is NOT used because MediaPipe
  does not document thread safety for concurrent .process() calls on the
  same detector object.

Usage from async context (mandatory — this module is synchronous and blocking):
  trajectory = await asyncio.to_thread(
      compute_crop_trajectory,
      video_path, clip_start_secs, clip_end_secs, video_width, target_width
  )
  crop_x = median_crop_x(trajectory)
"""

import cv2
import statistics
from typing import Optional

from logger import log


# ── Constants ─────────────────────────────────────────────────────────────────

# EMA smoothing factor.
# α = 0.12 → time constant ≈ 2.7 s at 3 samples/s (every 10 frames at 30 FPS).
# This follows the speaker with a gentle lag that eliminates jitter while still
# tracking genuine movement across the frame.
# Increase α if crops feel too slow to follow; decrease if they feel jittery.
DEFAULT_EMA_ALPHA = 0.12

# Process one frame every N frames.
# At 30 FPS, N=10 → ~3 samples/s. Good balance: captures sub-second movement,
# completes ~10× faster than per-frame detection.
DEFAULT_SAMPLE_INTERVAL = 10


# ── Public API ─────────────────────────────────────────────────────────────────

def compute_crop_trajectory(
    video_path: str,
    clip_start_secs: float,
    clip_end_secs: float,
    video_width: int,
    target_width: int,
    sample_every: int     = DEFAULT_SAMPLE_INTERVAL,
    ema_alpha: float      = DEFAULT_EMA_ALPHA,
    min_confidence: float = 0.5,
) -> list[dict]:
    """
    Detect face position across a clip's time range and return a smoothed
    crop trajectory.

    MUST be called via asyncio.to_thread() from async contexts:

        trajectory = await asyncio.to_thread(
            compute_crop_trajectory,
            video_path, clip_start_secs, clip_end_secs, video_width, target_width
        )

    Parameters
    ----------
    video_path        : Path to the source video file (local filesystem path).
    clip_start_secs   : Clip start in seconds from the start of the video.
    clip_end_secs     : Clip end in seconds from the start of the video.
    video_width       : Source video width in pixels (e.g. 1920 for 1080p).
    target_width      : Output crop width in pixels (e.g. 607 for 9:16 from 1080p).
    sample_every      : Process every Nth frame (default: 10).
    ema_alpha         : EMA smoothing factor — 0.0 = never moves, 1.0 = no smoothing.
    min_confidence    : Minimum MediaPipe detection confidence (0.0–1.0).

    Returns
    -------
    List of dicts: [{"t": float, "x": int}, ...]
      "t" is seconds from clip start (0.0 = first frame of the clip).
      "x" is the pixel x position of the LEFT EDGE of the crop window.
    Returns [] if the video cannot be opened or no faces were detected.
    """
    try:
        import mediapipe as mp
    except ImportError:
        raise RuntimeError(
            "MediaPipe is not installed. Run: pip install mediapipe>=0.10.0"
        )

    # ── 1. Open video and validate ────────────────────────────────────────────

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        log.warning("face_tracker_video_open_failed", video_path=video_path)
        return []

    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        if fps <= 0:
            fps = 30.0

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        start_frame = int(clip_start_secs * fps)
        end_frame   = int(clip_end_secs   * fps)

        if start_frame >= total_frames:
            return []
        end_frame = min(end_frame, total_frames - 1)

        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

        # ── 2. Sample frames and detect faces ──────────────────────────────────

        # Each entry: (timestamp_from_clip_start, face_center_x_ratio_or_None)
        raw_positions: list[tuple[float, Optional[float]]] = []

        # One detector per call — thread safe for parallel renders.
        # model_selection=1: full-range (≤5 m); chosen over model=0 (≤2 m) because
        # we cannot know the camera distance from metadata.
        with mp.solutions.face_detection.FaceDetection(
            model_selection=1,
            min_detection_confidence=min_confidence,
        ) as detector:

            current_frame = start_frame

            while current_frame <= end_frame:
                ret, frame = cap.read()
                if not ret:
                    break

                if (current_frame - start_frame) % sample_every == 0:
                    t = (current_frame - start_frame) / fps
                    center_x = _detect_face_center_x(detector, frame)
                    raw_positions.append((t, center_x))

                current_frame += 1

    except Exception as exc:
        log.warning("face_tracker_detection_error", error=str(exc)[:120])
        return []
    finally:
        cap.release()

    if not raw_positions:
        return []

    # ── 3. Interpolate over frames where no face was detected ─────────────────

    filled = _interpolate_missing(raw_positions)
    if not filled:
        # All sampled frames had no face — return empty so caller uses centre crop
        log.debug(
            "face_tracker_no_detections",
            video_path=video_path,
            clip_start=clip_start_secs,
            clip_end=clip_end_secs,
        )
        return []

    # ── 4. Convert normalized face-centre ratios to pixel crop_x values ───────
    # crop_x = LEFT EDGE of the crop window so the face is centred horizontally.
    # Formula: face_center_px - target_width/2, clamped to [0, video_width - target_width]

    max_crop_x = max(0, video_width - target_width)

    pixel_positions: list[tuple[float, int]] = []
    for (t, center_x_ratio) in filled:
        face_center_px = int(center_x_ratio * video_width)
        crop_x = face_center_px - target_width // 2
        crop_x = max(0, min(max_crop_x, crop_x))
        pixel_positions.append((t, crop_x))

    # ── 5. EMA smoothing ───────────────────────────────────────────────────────

    smoothed = _apply_ema(pixel_positions, ema_alpha)

    log.debug(
        "face_tracker_complete",
        clip_start=clip_start_secs,
        clip_end=clip_end_secs,
        samples=len(smoothed),
    )

    return [{"t": t, "x": x} for (t, x) in smoothed]


def median_crop_x(trajectory: list[dict]) -> Optional[int]:
    """
    Return the median crop_x from a trajectory list.

    The median (not mean) is used so the result represents where the speaker
    spent most of their time rather than being pulled toward brief excursions
    to the edges of the frame.

    Returns None for an empty trajectory — caller should fall back to centre crop.
    """
    if not trajectory:
        return None
    return int(statistics.median(entry["x"] for entry in trajectory))


def get_video_dimensions(video_path: str) -> dict:
    """
    Return {"width": int, "height": int, "fps": float} for a video file.

    Falls back to 1920×1080 at 30 FPS if the video cannot be opened, so
    callers can always use the return value without None checks.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        log.warning("face_tracker_dimensions_open_failed", video_path=video_path)
        return {"width": 1920, "height": 1080, "fps": 30.0}

    width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps    = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cap.release()

    return {"width": width, "height": height, "fps": fps}


# ── Private helpers ────────────────────────────────────────────────────────────

def _detect_face_center_x(
    detector,
    frame_bgr,
) -> Optional[float]:
    """
    Run MediaPipe face detection on a single BGR frame.

    Returns the normalized x-coordinate (0.0–1.0) of the face centre,
    or None if no face was detected above the confidence threshold.

    When multiple faces are present, the one with the highest confidence is
    used — this is almost always the speaker in a tutorial video.

    Why BGR → RGB:
    OpenCV reads video frames in BGR order. MediaPipe was trained on RGB.
    Passing BGR frames degrades detection accuracy because red and blue channels
    are swapped. All official MediaPipe examples include this conversion.

    Why flags.writeable = False:
    MediaPipe's C++ preprocessing avoids an internal copy when it sees the
    buffer is not writeable. Saves one memcpy per sampled frame. Restored after
    the call in case the caller reuses the frame array.
    """
    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

    frame_rgb.flags.writeable = False
    results = detector.process(frame_rgb)
    frame_rgb.flags.writeable = True

    # results.detections is None (not []) when no faces are found.
    # `if not results.detections` handles both None and empty-list safely.
    if not results.detections:
        return None

    best = max(results.detections, key=lambda d: d.score[0])

    bbox = best.location_data.relative_bounding_box
    center_x = bbox.xmin + bbox.width / 2

    # Clamp: MediaPipe can occasionally return coordinates slightly outside [0, 1]
    # due to detection uncertainty at frame edges.
    return max(0.01, min(0.99, center_x))


def _interpolate_missing(
    positions: list[tuple[float, Optional[float]]],
) -> list[tuple[float, float]]:
    """
    Fill None values with linear interpolation between neighbouring valid positions.

    Two-pass approach:
    - Forward pass: fill using the nearest known value before each gap.
    - Backward pass: fill any remaining None at the start using the first valid value.

    Returns [] if all positions are None (no valid detections in the entire clip).
    """
    if not positions:
        return []

    has_any = any(v is not None for _, v in positions)
    if not has_any:
        return []

    result = list(positions)

    # Forward pass — propagate last known value into subsequent None slots
    last_valid: Optional[float] = None
    for i, (t, v) in enumerate(result):
        if v is not None:
            last_valid = v
        elif last_valid is not None:
            result[i] = (t, last_valid)

    # Backward pass — fill any remaining None at the start
    last_valid = None
    for i in range(len(result) - 1, -1, -1):
        t, v = result[i]
        if v is not None:
            last_valid = v
        elif last_valid is not None:
            result[i] = (t, last_valid)

    return [(t, v) for (t, v) in result if v is not None]


def _apply_ema(
    positions: list[tuple[float, int]],
    alpha: float,
) -> list[tuple[float, int]]:
    """
    Apply Exponential Moving Average smoothing to (timestamp, crop_x) pairs.

    Formula: y[i] = y[i-1] + α × (x[i] - y[i-1])
    Equivalent form: y[i] = α·x[i] + (1-α)·y[i-1]
    The first form is used — one fewer multiplication per iteration.

    Initialises with the first raw value so the EMA starts at the actual
    first detected position rather than at zero or centre.
    """
    if not positions:
        return []

    ema = float(positions[0][1])
    smoothed = [(positions[0][0], int(ema))]

    for t, x in positions[1:]:
        ema = ema + alpha * (float(x) - ema)
        smoothed.append((t, int(ema)))

    return smoothed
