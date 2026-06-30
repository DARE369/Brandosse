"""
cursor_tracker.py
─────────────────
Detects mouse cursor position in screen recording clips using frame
differencing. Produces a smoothed crop trajectory for the SCREEN_ONLY
render path.

Method: frame differencing
──────────────────────────
Screen recordings use near-lossless compression. Unchanged pixels between
consecutive frames have diff = 0. Changed pixels (the cursor moving, UI
animations) have diff >> 0. We threshold the diff image, find connected blobs,
and filter by area to identify cursor-sized blobs (5–400 pixels).

Why not optical flow?
Lucas-Kanade and Farneback optical flow track all moving pixels — including
text being typed, scrolling, animations, and video playback within the
recording. They are over-engineered for cursor tracking. Frame differencing
with blob detection is more targeted and runs 5–10× faster.

Thread safety:
  This module is stateless — compute_cursor_trajectory() creates no shared
  state and is safe to call from multiple threads simultaneously.
"""

import cv2
import statistics
from typing import Optional


# ── Constants ──────────────────────────────────────────────────────────────────

# Blob area filter (pixels). The mouse cursor on a 1920×1080 recording
# typically produces a 50–250 pixel blob. The bounds allow for:
#   - Small/minimal cursors (macOS pointer, accessibility invisible cursor): 5px
#   - Large cursors with shadows, highlights, or animation: 400px
CURSOR_MIN_AREA = 5
CURSOR_MAX_AREA = 400

# Pixel difference threshold for binary change mask.
# Screen recordings use lossless/near-lossless compression:
#   - Unchanged pixels: diff = 0
#   - Changed pixels: diff typically >> 20
# 20 is chosen to catch even compressed-artefact-free recordings.
DIFF_THRESHOLD = 20

# Sample every N frames.
# At 30 FPS, interval=10 = 3 samples/second. Same as face_tracker.py.
DEFAULT_SAMPLE_INTERVAL = 10

# EMA smoothing factor. Slightly higher than Pack 5 face tracker (0.12)
# because cursors move more suddenly than faces.
# α=0.15 → time constant ≈ 2.2s at 3 samples/second.
DEFAULT_EMA_ALPHA = 0.15


# ── Main public function ───────────────────────────────────────────────────────

def compute_cursor_trajectory(
    video_path:      str,
    clip_start_secs: float,
    clip_end_secs:   float,
    video_width:     int,
    target_width:    int,
    sample_every:    int   = DEFAULT_SAMPLE_INTERVAL,
    ema_alpha:       float = DEFAULT_EMA_ALPHA,
) -> list:
    """
    Detect cursor position across a SCREEN_ONLY clip and return a smoothed
    crop trajectory.

    This function is synchronous and blocking. Call via asyncio.to_thread():

        trajectory = await asyncio.to_thread(
            compute_cursor_trajectory,
            video_path, clip_start, clip_end, video_width, target_width
        )

    Parameters
    ----------
    video_path      : Path to the source video file.
    clip_start_secs : Start of the clip in seconds from video start.
    clip_end_secs   : End of the clip in seconds from video start.
    video_width     : Full source video width in pixels.
    target_width    : Width of the output crop in pixels.
    sample_every    : Sample every Nth frame (default 10 = 3 samples/s at 30fps).
    ema_alpha       : EMA smoothing factor (0=no follow, 1=no smoothing).

    Returns
    -------
    List of dicts: [{"t": float, "x": int}, ...]
      "t" is seconds from clip start (0.0 = clip_start_secs).
      "x" is the LEFT EDGE of the crop window in pixels.
    Returns empty list if no cursor was detected or video cannot be opened.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return []

    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        start_frame = int(clip_start_secs * fps)
        end_frame   = min(int(clip_end_secs * fps), total_frames - 1)

        if start_frame >= total_frames:
            return []

        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

        # ── Sample frames and detect cursor ───────────────────────────────────

        raw_positions = []
        # (timestamp_from_clip_start_secs, cursor_center_x_ratio or None)

        prev_gray     = None    # grayscale of previous sampled frame
        prev_cursor_x = None    # x pixel of cursor in previous sample
        current_frame = start_frame

        while current_frame <= end_frame:
            ret, frame = cap.read()
            if not ret:
                break

            if (current_frame - start_frame) % sample_every == 0:
                t = (current_frame - start_frame) / fps

                # Resize to analysis width for speed (same technique as scene_classifier)
                analysis_w = min(640, frame.shape[1])
                scale = analysis_w / frame.shape[1]
                small = cv2.resize(
                    frame, None, fx=scale, fy=scale,
                    interpolation=cv2.INTER_AREA,
                )
                curr_gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

                if prev_gray is not None:
                    cursor_x_norm = _detect_cursor_x(
                        prev_gray, curr_gray,
                        prev_cursor_x, frame_width=small.shape[1],
                    )
                    raw_positions.append((t, cursor_x_norm))

                    if cursor_x_norm is not None:
                        prev_cursor_x = cursor_x_norm * small.shape[1]
                    # else: keep prev_cursor_x unchanged so tracking can recover
                else:
                    # No previous frame yet — first sample has no diff
                    raw_positions.append((t, None))

                prev_gray = curr_gray

            current_frame += 1

    finally:
        cap.release()

    if not raw_positions:
        return []

    # ── Fill gaps (frames with no cursor detected) ─────────────────────────────
    filled = _interpolate_missing(raw_positions)
    if not filled:
        return []

    # ── Convert normalised cursor centre → crop_x pixel values ────────────────
    max_crop_x = max(0, video_width - target_width)
    pixel_positions = []

    for (t, cursor_x_ratio) in filled:
        cursor_px = int(cursor_x_ratio * video_width)
        crop_x    = cursor_px - target_width // 2
        crop_x    = max(0, min(max_crop_x, crop_x))
        pixel_positions.append((t, crop_x))

    # ── EMA smoothing ──────────────────────────────────────────────────────────
    smoothed = _apply_ema(pixel_positions, ema_alpha)

    return [{"t": t, "x": x} for (t, x) in smoothed]


def median_crop_x(trajectory: list) -> Optional[int]:
    """
    Return the median crop_x from a trajectory.
    Returns None if trajectory is empty.
    """
    if not trajectory:
        return None
    return int(statistics.median(e["x"] for e in trajectory))


# ── Private helpers ────────────────────────────────────────────────────────────

def _detect_cursor_x(
    prev_gray,
    curr_gray,
    prev_cursor_x_pixels: Optional[float],
    frame_width: int,
) -> Optional[float]:
    """
    Detect cursor horizontal position using frame differencing.

    Returns normalised cursor centre X (0.0–1.0) or None if not detected.

    Algorithm:
      1. Compute absolute pixel difference between frames.
      2. Threshold to binary: changed (255) vs unchanged (0).
      3. Find connected components (blobs of changed pixels).
      4. Filter by area (CURSOR_MIN_AREA ≤ area ≤ CURSOR_MAX_AREA).
      5. Among candidates, select closest to prev_cursor_x_pixels (tracking
         continuity). If no previous position, select largest blob.
    """
    diff = cv2.absdiff(prev_gray, curr_gray)

    # DIFF_THRESHOLD=20: lossless recordings have diff=0 for unchanged pixels;
    # changed pixels are well above 20. Threshold removes noise.
    _, thresh = cv2.threshold(diff, DIFF_THRESHOLD, 255, cv2.THRESH_BINARY)

    # connectivity=8: diagonal neighbours count as connected
    n_labels, _labels, stats, centroids = cv2.connectedComponentsWithStats(
        thresh, connectivity=8,
    )

    # Label 0 is background — skip it
    candidates = []  # [(centroid_x_pixels, area)]
    for i in range(1, n_labels):
        area = int(stats[i, cv2.CC_STAT_AREA])
        if CURSOR_MIN_AREA <= area <= CURSOR_MAX_AREA:
            candidates.append((float(centroids[i][0]), area))

    if not candidates:
        return None

    if prev_cursor_x_pixels is not None and len(candidates) > 1:
        # Tracking mode: closest blob to previous cursor position
        best_cx = min(candidates, key=lambda c: abs(c[0] - prev_cursor_x_pixels))[0]
    else:
        # Initialisation or single candidate: use largest blob
        best_cx = max(candidates, key=lambda c: c[1])[0]

    return best_cx / frame_width


def _interpolate_missing(
    positions: list,
) -> list:
    """
    Fill None values using forward-then-backward propagation.
    Returns empty list if all values are None.
    Mirrors the same function in face_tracker.py.
    """
    if not positions:
        return []

    has_valid = any(v is not None for _, v in positions)
    if not has_valid:
        return []

    result = list(positions)

    # Forward pass: propagate last known value into subsequent None slots
    last_valid = None
    for i, (t, v) in enumerate(result):
        if v is not None:
            last_valid = v
        elif last_valid is not None:
            result[i] = (t, last_valid)

    # Backward pass: fill any leading Nones with the first known value
    last_valid = None
    for i in range(len(result) - 1, -1, -1):
        t, v = result[i]
        if v is not None:
            last_valid = v
        elif last_valid is not None:
            result[i] = (t, last_valid)

    return [(t, v) for (t, v) in result if v is not None]


def _apply_ema(
    positions: list,
    alpha: float,
) -> list:
    """
    Apply Exponential Moving Average smoothing to (timestamp, crop_x) pairs.
    Formula: y[i] = y[i-1] + α × (x[i] - y[i-1])
    Mirrors the same function in face_tracker.py.
    """
    if not positions:
        return []

    current = float(positions[0][1])
    smoothed = [(positions[0][0], int(current))]

    for t, x in positions[1:]:
        current = current + alpha * (float(x) - current)
        smoothed.append((t, int(current)))

    return smoothed
