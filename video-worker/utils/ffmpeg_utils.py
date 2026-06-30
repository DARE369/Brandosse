# video-worker/utils/ffmpeg_utils.py
# FFmpeg and ffprobe helper functions.
# Used by Stage 3 (audio extraction) and Stage 6 (video rendering).
# All functions are synchronous and called with asyncio.to_thread() in async contexts.

import json
import os
import subprocess
from typing import Optional

from logger import log

OUTPUT_WIDTH = 1080
OUTPUT_HEIGHT = 1920


def check_ffmpeg_available() -> tuple[bool, str]:
    """
    Verify ffmpeg and ffprobe are installed and accessible.
    Returns (True, version_string) or (False, error_message).
    Called once at worker startup.
    """
    try:
        result = subprocess.run(
            ['ffmpeg', '-version'],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return False, "ffmpeg returned non-zero exit code"

        probe_result = subprocess.run(
            ['ffprobe', '-version'],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if probe_result.returncode != 0:
            return False, "ffprobe not available"

        version_line = result.stdout.split('\n')[0]
        return True, version_line

    except FileNotFoundError:
        return False, "ffmpeg not found. Install FFmpeg and add ffmpeg/ffprobe to PATH."
    except subprocess.TimeoutExpired:
        return False, "ffmpeg check timed out"
    except Exception as e:
        return False, f"Unexpected error checking ffmpeg: {str(e)}"


def get_video_duration(file_path: str) -> Optional[float]:
    """
    Get the duration of a video file in seconds using ffprobe.
    Returns float seconds or None if the file cannot be probed.
    """
    try:
        result = subprocess.run(
            [
                'ffprobe',
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                file_path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode != 0:
            log.error("ffprobe_failed", file_path=file_path, stderr=result.stderr)
            return None

        data = json.loads(result.stdout)

        if 'format' in data and 'duration' in data['format']:
            return float(data['format']['duration'])

        for stream in data.get('streams', []):
            if stream.get('codec_type') == 'video' and 'duration' in stream:
                return float(stream['duration'])

        return None

    except (json.JSONDecodeError, KeyError, ValueError) as e:
        log.error("ffprobe_parse_failed", file_path=file_path, error=str(e))
        return None
    except subprocess.TimeoutExpired:
        log.error("ffprobe_timeout", file_path=file_path)
        return None
    except Exception as e:
        log.error("ffprobe_unexpected_error", file_path=file_path, error=str(e))
        return None


def extract_audio_for_transcription(video_path: str, output_path: str) -> tuple[bool, str]:
    """
    Extract audio from a video file optimized for WhisperX transcription.

    Specification:
    - Format: WAV (PCM 16-bit)
    - Sample rate: 16000 Hz
    - Channels: 1 (mono)

    Returns (True, output_path) on success, (False, error_message) on failure.
    """
    try:
        result = subprocess.run(
            [
                'ffmpeg',
                '-i', video_path,
                '-vn',
                '-acodec', 'pcm_s16le',
                '-ar', '16000',
                '-ac', '1',
                '-y',
                output_path,
            ],
            capture_output=True,
            text=True,
            timeout=600,
        )

        if result.returncode != 0:
            log.error(
                "audio_extraction_failed",
                video_path=video_path,
                stderr=result.stderr[-500:],
            )
            return False, f"FFmpeg audio extraction failed: {result.stderr[-200:]}"

        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            return False, "Audio extraction produced empty file"

        file_size_mb = os.path.getsize(output_path) / (1024 * 1024)
        log.info("audio_extracted", output_path=output_path, size_mb=round(file_size_mb, 2))

        return True, output_path

    except subprocess.TimeoutExpired:
        return False, "Audio extraction timed out after 10 minutes"
    except Exception as e:
        return False, f"Unexpected error during audio extraction: {str(e)}"


def extract_thumbnail(video_path: str, output_path: str, timestamp_secs: float = 5.0) -> tuple[bool, str]:
    """
    Extract a single frame from a video as a JPEG thumbnail.
    Used in Stage 6 to generate clip thumbnails.

    Returns (True, output_path) on success, (False, error_message) on failure.
    """
    try:
        result = subprocess.run(
            [
                'ffmpeg',
                '-ss', str(timestamp_secs),
                '-i', video_path,
                '-vframes', '1',
                '-vf', 'scale=360:-2',
                '-q:v', '2',
                '-y',
                output_path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode != 0 or not os.path.exists(output_path):
            return False, f"Thumbnail extraction failed: {result.stderr[-200:]}"

        return True, output_path

    except Exception as e:
        return False, f"Thumbnail extraction error: {str(e)}"


def compress_audio_for_upload(wav_path: str, output_path: str) -> tuple[bool, str]:
    """
    Compress a WAV audio file to MP3 for upload to Replicate.

    Specification:
    - Format: MP3
    - Bitrate: 64kbps
    - Sample rate: 16000 Hz
    - Channels: 1

    Returns (True, output_path) on success, (False, error_message) on failure.
    """
    try:
        result = subprocess.run(
            [
                'ffmpeg',
                '-i', wav_path,
                '-codec:a', 'libmp3lame',
                '-b:a', '64k',
                '-ar', '16000',
                '-ac', '1',
                '-y',
                output_path,
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )

        if result.returncode != 0:
            return False, f"Audio compression failed: {result.stderr[-200:]}"

        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            return False, "Compression produced empty file"

        original_mb = os.path.getsize(wav_path) / (1024 * 1024)
        compressed_mb = os.path.getsize(output_path) / (1024 * 1024)
        reduction_pct = 0.0
        if original_mb > 0:
            reduction_pct = round((1 - compressed_mb / original_mb) * 100, 1)

        log.info(
            "audio_compressed",
            original_mb=round(original_mb, 2),
            compressed_mb=round(compressed_mb, 2),
            reduction_pct=reduction_pct,
            output_path=output_path,
        )

        return True, output_path

    except subprocess.TimeoutExpired:
        return False, "Audio compression timed out after 5 minutes"
    except Exception as e:
        return False, f"Unexpected compression error: {str(e)}"


def render_with_tracking(
    source_video_path: str,
    start_time_secs: float,
    end_time_secs: float,
    crop_coords: dict,
    ass_caption_path: Optional[str],
    output_path: str,
    hook_text_filter: str = "",
) -> tuple[bool, str]:
    """
    Render a clip with face tracking-compatible crop coordinates.

    Converts face_tracker coordinate format to render_clip_to_file format.
    hook_text_filter: optional FFmpeg drawtext filter string appended to the
    vf chain after captions. Pass _build_hook_text_filter() output here.
    """
    duration_secs = end_time_secs - start_time_secs

    # Normalize parameter names
    normalized_coords = {
        "crop_x": crop_coords.get("crop_x", 0),
        "crop_y": crop_coords.get("crop_y", 0),
        "crop_w": crop_coords.get("crop_width", 607),
        "crop_h": crop_coords.get("crop_height", 1080),
    }

    return render_clip_to_file(
        source_video_path=source_video_path,
        start_time_secs=start_time_secs,
        duration_secs=duration_secs,
        crop_coords=normalized_coords,
        ass_caption_path=ass_caption_path,
        output_path=output_path,
        hook_text_filter=hook_text_filter,
    )


def render_clip_to_file(
    source_video_path: str,
    start_time_secs: float,
    duration_secs: float,
    crop_coords: dict,
    ass_caption_path: Optional[str],
    output_path: str,
    hook_text_filter: str = "",
) -> tuple[bool, str]:
    """
    Render a single clip to a 1080x1920 MP4 with optional burned captions.

    Returns (True, output_path) on success, (False, error_message) on failure.
    hook_text_filter: optional FFmpeg drawtext expression appended at the end
    of the vf chain (after captions) so it appears on all rendered frames.
    """
    crop_x = crop_coords["crop_x"]
    crop_y = crop_coords["crop_y"]
    crop_w = crop_coords["crop_w"]
    crop_h = crop_coords["crop_h"]

    hook_suffix = f",{hook_text_filter}" if hook_text_filter else ""

    if ass_caption_path and os.path.exists(ass_caption_path):
        escaped_ass = ass_caption_path.replace("\\", "/").replace(":", "\\:")
        vf_chain = (
            f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y},"
            f"scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT},"
            f"ass={escaped_ass}"
            f"{hook_suffix}"
        )
    else:
        vf_chain = (
            f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y},"
            f"scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}"
            f"{hook_suffix}"
        )

    codec_attempts = [
        ("h264_nvenc", ["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", "23"]),
        ("libx264", ["-c:v", "libx264", "-preset", "fast", "-crf", "23"]),
    ]

    last_error = "All codec attempts failed"

    for codec, codec_args in codec_attempts:
        cmd = [
            "ffmpeg",
            "-y",
            "-ss",
            str(start_time_secs),
            "-i",
            source_video_path,
            "-t",
            str(duration_secs),
            "-vf",
            vf_chain,
            *codec_args,
            "-threads", "4",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            "-avoid_negative_ts",
            "make_zero",
            output_path,
        ]

        try:
            log.debug(
                "ffmpeg_render_command",
                codec=codec,
                cmd=" ".join(str(part) for part in cmd),
            )
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600,
            )

            if (
                result.returncode == 0
                and os.path.exists(output_path)
                and os.path.getsize(output_path) > 0
            ):
                file_size_mb = os.path.getsize(output_path) / (1024 * 1024)
                log.info(
                    "clip_render_complete",
                    output_path=output_path,
                    codec=codec,
                    size_mb=round(file_size_mb, 2),
                    duration_secs=duration_secs,
                )
                return True, output_path

            last_error = f"FFmpeg render failed: {result.stderr[-300:]}"
            if codec == "h264_nvenc":
                log.info("nvenc_not_available_falling_back_to_libx264")
                continue

            return False, last_error

        except subprocess.TimeoutExpired:
            last_error = f"Render timed out after 10 minutes for clip starting at {start_time_secs}s"
            if codec == "h264_nvenc":
                continue
            return False, last_error
        except Exception as e:
            last_error = f"Unexpected render error: {str(e)}"
            if codec == "h264_nvenc":
                continue
            return False, last_error

    return False, last_error
