"""
scene_classifier.py
────────────────────
Classifies a video clip as one of three scene types:
  - TALKING_HEAD : person fills most of the frame, speaking to camera
  - SPLIT        : screen recording with PiP webcam overlay in a corner
  - SCREEN_ONLY  : no visible face, screen/slides/code content only

Two signals are used for classification:

  Signal 1 — Laplacian variance (screen content detection)
  ─────────────────────────────────────────────────────────
  Screen recordings (code, browser, slides) have very high Laplacian variance
  because text and UI elements produce sharp, pixel-perfect intensity changes.
  Camera-captured talking heads have much lower variance because skin tones and
  soft backgrounds produce smooth gradients.

  Source: Patent US11399187 "Screen content detection for adaptive encoding";
          PyImageSearch blur detection research (2024).

  Signal 2 — MediaPipe face bounding box size + position (face type detection)
  ─────────────────────────────────────────────────────────────────────────────
  Talking head: face bounding box.width > PIP_FACE_WIDTH_THRESHOLD (face fills
                a significant portion of the frame). Person is the primary subject.
  PiP webcam:   face bounding box.width ≤ threshold AND face centre in corner
                quadrant. Small webcam bubble tucked in the corner of a screen.

  Source: MediaPipe official documentation; industry PiP recording documentation.

Thread safety:
  Each call to classify_clip creates its own MediaPipe detector instance using
  the context manager. Safe for parallel clip rendering (asyncio.gather with up
  to 3 concurrent jobs). A module-level singleton is NOT used — MediaPipe does
  not document thread safety for concurrent .process() calls on the same object.

Performance:
  Frames are resized to ANALYSIS_WIDTH pixels wide before Laplacian computation
  (~10× fewer pixels for a 1920px source). The same resized frame is reused for
  face detection. Sampling every 15 frames at 30 FPS = 2 samples/second.
"""

import cv2
import numpy as np
from collections import Counter
from typing import Callable, Optional


# ── Scene type constants ───────────────────────────────────────────────────────

TALKING_HEAD = "TALKING_HEAD"
SPLIT        = "SPLIT"
SCREEN_ONLY  = "SCREEN_ONLY"


# ── Classification thresholds ─────────────────────────────────────────────────
# These are calibrated starting points. Log actual Laplacian variance values
# from real production videos (via the debug_log_fn) and adjust if needed.
#
# Observed typical ranges:
#   Talking head, blurred background:  50–300
#   Mixed content, visible room:       200–600
#   Browser / code editor recording:   800–5000+
#   Code editor with syntax highlight: 2000–8000+

# Laplacian variance above this → screen-like content detected.
SCREEN_LAPLACIAN_THRESHOLD = 800.0

# Face bounding box width (normalised 0–1) at or below this → face is small
# relative to the frame, likely a PiP webcam overlay.
PIP_FACE_WIDTH_THRESHOLD = 0.12

# Face centre x or y must be in the outer margin of the frame to qualify as
# "in a corner". PiP webcams are always in corners; distant speakers are centred.
CORNER_MARGIN = 0.30

# Resize to this width before Laplacian computation and MediaPipe detection.
# 640px wide → ~10× fewer pixels than a 1920px source with negligible loss
# in variance signal or detection accuracy.
ANALYSIS_WIDTH = 640

# Process every Nth frame from the clip time range.
# Every 15 frames at 30 FPS = 2 samples/second.
# Coarser than Pack 5's face tracker (every 10 frames) because we only need
# the dominant type, not a movement trajectory.
DEFAULT_SAMPLE_INTERVAL = 15

# Fall back to TALKING_HEAD if fewer than this fraction of frames agree.
# A low confidence score indicates an ambiguous clip (mixed content, transitions).
MIN_CONFIDENCE = 0.40


# ── Public API ─────────────────────────────────────────────────────────────────

def classify_clip(
    video_path:      str,
    clip_start_secs: float,
    clip_end_secs:   float,
    sample_every:    int             = DEFAULT_SAMPLE_INTERVAL,
    min_confidence:  float           = MIN_CONFIDENCE,
    debug_log_fn:    Optional[Callable] = None,
) -> dict:
    """
    Classify a clip segment into TALKING_HEAD, SPLIT, or SCREEN_ONLY.

    This function is synchronous and blocking. It MUST be called via
    asyncio.to_thread() from async render contexts:

        scene = await asyncio.to_thread(
            classify_clip, video_path, clip_start_secs, clip_end_secs,
            debug_log_fn=lambda msg, **kw: log.debug(msg, **kw),
        )

    Parameters
    ----------
    video_path       : Path to the source video file (local filesystem).
    clip_start_secs  : Clip start in seconds from the start of the video.
    clip_end_secs    : Clip end in seconds from the start of the video.
    sample_every     : Process every Nth frame (default: 15).
    min_confidence   : Minimum fraction of frames that must agree (0.0–1.0).
    debug_log_fn     : Optional structured log callable for variance values.
                       Signature: (msg: str, **kwargs) → None.

    Returns
    -------
    dict:
      "dominant"    : str   — TALKING_HEAD | SPLIT | SCREEN_ONLY
      "confidence"  : float — fraction of sampled frames that voted dominant
      "frame_count" : int   — number of frames actually sampled
      "vote_counts" : dict  — {scene_type: count} breakdown
    """
    try:
        import mediapipe as mp
    except ImportError:
        # MediaPipe installed in Pack 5 — should not reach here in production.
        return _fallback(TALKING_HEAD, "mediapipe_not_installed")

    # ── 1. Open video ──────────────────────────────────────────────────────────

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return _fallback(TALKING_HEAD, "video_not_opened")

    try:
        fps          = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        start_frame = int(clip_start_secs * fps)
        end_frame   = min(int(clip_end_secs * fps), total_frames - 1)

        if start_frame >= total_frames:
            return _fallback(TALKING_HEAD, "start_beyond_video_end")

        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

        # ── 2. Sample frames, classify each one ────────────────────────────────

        frame_labels:    list[str]   = []
        variance_samples: list[float] = []

        # One detector per call — safe for parallel renders; see module docstring.
        with mp.solutions.face_detection.FaceDetection(
            model_selection=1,           # full-range (≤5 m); camera distance unknown
            min_detection_confidence=0.5,
        ) as detector:

            current_frame = start_frame

            while current_frame <= end_frame:
                ret, frame = cap.read()
                if not ret:
                    break

                if (current_frame - start_frame) % sample_every == 0:
                    label, lap_var = _classify_frame(frame, detector)
                    frame_labels.append(label)
                    variance_samples.append(lap_var)

                current_frame += 1

    except Exception as exc:
        return _fallback(TALKING_HEAD, f"detection_error:{str(exc)[:80]}")
    finally:
        cap.release()

    # ── 3. Log variance distribution for threshold calibration ─────────────────

    if debug_log_fn and variance_samples:
        arr = np.array(variance_samples)
        debug_log_fn(
            "scene_variance_distribution",
            mean   = round(float(arr.mean()),   1),
            median = round(float(np.median(arr)), 1),
            min    = round(float(arr.min()),    1),
            max    = round(float(arr.max()),    1),
            clip_start = clip_start_secs,
        )

    # ── 4. Majority vote ───────────────────────────────────────────────────────

    if not frame_labels:
        return _fallback(TALKING_HEAD, "no_frames_sampled")

    vote_counts                    = dict(Counter(frame_labels))
    dominant_type, dominant_count  = Counter(frame_labels).most_common(1)[0]
    confidence                     = dominant_count / len(frame_labels)

    # Low confidence → clip is ambiguous (transitions, mixed content).
    # Default to TALKING_HEAD — always produces a visible output even if the
    # face tracker finds no face (it falls back to centre crop).
    if confidence < min_confidence:
        dominant_type = TALKING_HEAD
        confidence    = 0.0

    return {
        "dominant":    dominant_type,
        "confidence":  round(confidence, 3),
        "frame_count": len(frame_labels),
        "vote_counts": vote_counts,
    }


# ── Private: classify a single frame ──────────────────────────────────────────

def _classify_frame(frame_bgr, detector) -> tuple[str, float]:
    """
    Classify one BGR video frame.

    Returns (scene_type, laplacian_variance).

    Logic
    ─────
    1. Resize to ANALYSIS_WIDTH for faster processing.
    2. Compute Laplacian variance on the grayscale version → screen content signal.
    3. Run MediaPipe face detection on the same resized frame.
    4. Apply classification rules:
       - Large face (width > threshold) → TALKING_HEAD, regardless of screen content.
         (Person speaking in front of a visible monitor is still TALKING_HEAD.)
       - Small face in a corner + high variance → SPLIT (PiP webcam).
       - No face + high variance → SCREEN_ONLY.
       - Everything else → TALKING_HEAD (safest default).
    """
    h_orig, w_orig = frame_bgr.shape[:2]

    # ── Signal 1: Laplacian variance ──────────────────────────────────────────

    # cv2.INTER_AREA: averaging downscale. Preserves variance statistics better
    # than INTER_NEAREST (which aliases) or INTER_LINEAR (which blurs edges).
    scale = ANALYSIS_WIDTH / w_orig
    small = cv2.resize(frame_bgr, None, fx=scale, fy=scale,
                       interpolation=cv2.INTER_AREA)

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

    # cv2.CV_64F prevents saturation on very high-contrast screen content.
    # .var() gives the variance of the full Laplacian response image.
    laplacian_var      = cv2.Laplacian(gray, cv2.CV_64F).var()
    has_screen_content = laplacian_var > SCREEN_LAPLACIAN_THRESHOLD

    # ── Signal 2: MediaPipe face detection ────────────────────────────────────

    # BGR → RGB (MediaPipe trained on RGB; swapped channels degrade accuracy).
    # writeable=False: MediaPipe skips an internal buffer copy before inference.
    small_rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
    small_rgb.flags.writeable = False
    results = detector.process(small_rgb)
    small_rgb.flags.writeable = True

    # ── Apply classification rules ─────────────────────────────────────────────

    if not results.detections:
        # No face detected in this frame.
        return (SCREEN_ONLY if has_screen_content else TALKING_HEAD, laplacian_var)

    best = max(results.detections, key=lambda d: d.score[0])
    bbox = best.location_data.relative_bounding_box

    face_w  = bbox.width
    face_cx = max(0.0, min(1.0, bbox.xmin + bbox.width  / 2.0))
    face_cy = max(0.0, min(1.0, bbox.ymin + bbox.height / 2.0))

    is_large_face = face_w > PIP_FACE_WIDTH_THRESHOLD

    # A face is "in a corner" when BOTH x and y centres are near an edge.
    is_in_corner = (
        (face_cx < CORNER_MARGIN or face_cx > 1.0 - CORNER_MARGIN)
        and
        (face_cy < CORNER_MARGIN or face_cy > 1.0 - CORNER_MARGIN)
    )

    if is_large_face:
        # Person is the primary subject. Even if a monitor is visible behind
        # them, we crop to their face — this is TALKING_HEAD.
        return (TALKING_HEAD, laplacian_var)

    if not is_large_face and is_in_corner and has_screen_content:
        # Small face tucked in a corner AND strong screen content → PiP webcam.
        return (SPLIT, laplacian_var)

    # Everything else (small centred face, small cornered face with no screen
    # content, etc.) defaults to TALKING_HEAD — face tracker will handle it
    # and fall back to centre crop if detection fails.
    return (TALKING_HEAD, laplacian_var)


# ── Private: uniform fallback dict ────────────────────────────────────────────

def _fallback(scene_type: str, reason: str = "") -> dict:
    """Return a zero-confidence fallback result for error/edge cases."""
    return {
        "dominant":    scene_type,
        "confidence":  0.0,
        "frame_count": 0,
        "vote_counts": {scene_type: 0},
        "_fallback":   reason,
    }
