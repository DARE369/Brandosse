# video-worker/utils/video_reframer.py
# Calculates static 9:16 crop coordinates for a source video clip.

import json
import os
import subprocess
from typing import Optional

from logger import log


OUTPUT_WIDTH = 1080
OUTPUT_HEIGHT = 1920
TARGET_ASPECT = OUTPUT_WIDTH / OUTPUT_HEIGHT
SAMPLE_FRAME_COUNT = 12
FACE_HORIZONTAL_POSITION = 0.4


def _get_video_dimensions(video_path: str) -> tuple[int, int]:
    """
    Get source video width and height using ffprobe.
    """
    if not os.path.exists(video_path):
        return 1920, 1080

    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_streams",
                video_path,
            ],
            capture_output=True,
            text=True,
            timeout=15,
        )
        data = json.loads(result.stdout)
        for stream in data.get("streams", []):
            if stream.get("codec_type") == "video":
                return int(stream["width"]), int(stream["height"])
    except Exception as e:
        log.warning("ffprobe_dimensions_failed", video_path=video_path, error=str(e))

    return 1920, 1080


def _calculate_crop_for_face_position(
    source_w: int,
    crop_w: int,
    face_center_relative: Optional[float],
) -> tuple[int, str]:
    """
    Calculate crop_x from face position, or return center fallback.
    """
    center_x = max(0, (source_w - crop_w) // 2)
    max_x = max(0, source_w - crop_w)

    if face_center_relative is None:
        return center_x, "center_fallback"

    face_pixel_x = int(face_center_relative * source_w)
    crop_x = int(face_pixel_x - (crop_w * FACE_HORIZONTAL_POSITION))
    crop_x = max(0, min(crop_x, max_x))
    return crop_x, "face_detected"


def _extract_sample_frames(
    video_path: str,
    clip_start_secs: float,
    clip_duration_secs: float,
    output_dir: str,
) -> list[str]:
    """
    Extract up to 12 evenly spaced sample frames from the clip.
    """
    if not os.path.exists(video_path) or clip_duration_secs <= 0:
        return []

    frames = []
    interval = clip_duration_secs / (SAMPLE_FRAME_COUNT + 1)

    for index in range(1, SAMPLE_FRAME_COUNT + 1):
        timestamp = clip_start_secs + (interval * index)
        frame_path = os.path.join(output_dir, f"sample_frame_{index}.jpg")

        try:
            result = subprocess.run(
                [
                    "ffmpeg",
                    "-ss",
                    str(timestamp),
                    "-i",
                    video_path,
                    "-vframes",
                    "1",
                    "-vf",
                    "scale=480:-1",
                    "-q:v",
                    "5",
                    "-y",
                    frame_path,
                ],
                capture_output=True,
                text=True,
                timeout=15,
            )

            if result.returncode == 0 and os.path.exists(frame_path):
                frames.append(frame_path)
        except subprocess.TimeoutExpired:
            log.warning("frame_extraction_timeout", timestamp=timestamp)
        except Exception as e:
            log.warning("frame_extraction_error", timestamp=timestamp, error=str(e))

    return frames


def _detect_face_center_x(frame_paths: list[str]) -> Optional[float]:
    """
    Detect faces and return average relative X center across frames.
    """
    try:
        import cv2

        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        if not os.path.exists(cascade_path):
            log.warning("haar_cascade_not_found", path=cascade_path)
            return None

        face_cascade = cv2.CascadeClassifier(cascade_path)
        detected_centers = []

        for frame_path in frame_paths:
            if not os.path.exists(frame_path):
                continue

            image = cv2.imread(frame_path)
            if image is None:
                continue

            frame_width = image.shape[1]
            grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            faces = face_cascade.detectMultiScale(
                grey,
                scaleFactor=1.1,
                minNeighbors=5,
                minSize=(30, 30),
                flags=cv2.CASCADE_SCALE_IMAGE,
            )

            if len(faces) > 0:
                x, _, width, height = max(faces, key=lambda face: face[2] * face[3])
                detected_centers.append((x + width / 2) / frame_width)

        if not detected_centers:
            return None

        average_center = sum(detected_centers) / len(detected_centers)
        log.info(
            "face_detection_result",
            frames_with_face=len(detected_centers),
            total_frames=len(frame_paths),
            avg_face_center_x=round(average_center, 3),
        )
        return average_center

    except ImportError:
        log.warning("opencv_not_available", message="pip install opencv-python-headless")
        return None
    except Exception as e:
        log.warning("face_detection_error", error=str(e))
        return None
    finally:
        for frame_path in frame_paths:
            try:
                if os.path.exists(frame_path):
                    os.remove(frame_path)
            except Exception:
                pass


def calculate_crop_coordinates(
    video_path: str,
    clip_start_secs: float,
    clip_duration_secs: float,
    temp_dir: str,
) -> dict:
    """
    Calculate static 9:16 crop coordinates for one clip.

    Never raises. Returns center/hardcoded fallback on error.
    """
    try:
        source_w, source_h = _get_video_dimensions(video_path)
        crop_h = source_h
        crop_w = max(1, int(source_h * (9 / 16)))
        crop_y = 0

        frames = _extract_sample_frames(video_path, clip_start_secs, clip_duration_secs, temp_dir)
        face_center_relative = _detect_face_center_x(frames) if frames else None
        crop_x, method = _calculate_crop_for_face_position(
            source_w,
            crop_w,
            face_center_relative,
        )

        log.info(
            "crop_coordinates_calculated",
            method=method,
            source_w=source_w,
            source_h=source_h,
            crop_x=crop_x,
            crop_w=crop_w,
            crop_h=crop_h,
        )

        return {
            "crop_x": crop_x,
            "crop_y": crop_y,
            "crop_w": crop_w,
            "crop_h": crop_h,
            "source_w": source_w,
            "source_h": source_h,
            "method": method,
        }

    except Exception as e:
        log.warning("crop_calculation_failed_using_center", error=str(e), video_path=video_path)
        return {
            "crop_x": 656,
            "crop_y": 0,
            "crop_w": 608,
            "crop_h": 1080,
            "source_w": 1920,
            "source_h": 1080,
            "method": "hardcoded_fallback",
        }
