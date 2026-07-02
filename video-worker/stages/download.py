# video-worker/stages/download.py
# Downloads source video and extracts audio for transcription.
# Supports YouTube, Twitter/X, and direct Supabase Storage uploads.
# Stage 3 full implementation.

import asyncio
import math
import os

import yt_dlp

from config import config
from database import deduct_credits, download_from_supabase_storage, update_job_source_info, update_job_progress
from errors import DownloadError
from logger import log
from utils.ffmpeg_utils import extract_audio_for_transcription, get_video_duration
from utils.url_validator import validate_url_for_platform

MAX_DURATION_SECS = 180 * 60
CREDITS_PER_MINUTE = 1
MIN_CREDITS_REQUIRED = 5

YTDLP_BASE_OPTIONS = {
    # iOS player serves combined mp4 streams — don't restrict by ext so the
    # selector works across both iOS and web player clients.
    'format': 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
    'no_playlist': True,
    'socket_timeout': 30,
    'retries': 3,
    'fragment_retries': 3,
    'quiet': True,
    'no_warnings': False,
    'extract_flat': False,
    'merge_output_format': 'mp4',
    # Use iOS player client — bypasses YouTube's bot detection on server IPs
    # without requiring cookies. Falls back to web if iOS is unavailable.
    'extractor_args': {'youtube': {'player_client': ['ios', 'web']}},
}


def calculate_credits(duration_secs: int) -> int:
    """
    Calculate credit cost from video duration.
    One credit per minute, rounded up, with a minimum charge.
    """
    minutes = math.ceil(duration_secs / 60)
    return max(minutes * CREDITS_PER_MINUTE, MIN_CREDITS_REQUIRED)


def _write_cookies_file(temp_dir: str) -> str | None:
    """Write WORKER_YOUTUBE_COOKIES env var to a temp file for yt-dlp."""
    if not config.youtube_cookies:
        return None
    cookies_path = os.path.join(temp_dir, "yt_cookies.txt")
    with open(cookies_path, "w") as f:
        f.write(config.youtube_cookies)
    return cookies_path


def _get_video_metadata(url: str, platform: str, job_id: str, cookies_path: str | None = None) -> dict:
    """
    Fetch video metadata without downloading the file.
    Returns dict with keys: title, duration_secs.
    """
    log.info("preflight_metadata_check", url=url, platform=platform)

    opts = {
        **YTDLP_BASE_OPTIONS,
        'skip_download': True,
    }
    if cookies_path:
        opts['cookiefile'] = cookies_path

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)

            if info is None:
                raise DownloadError(
                    "Could not retrieve video information. The video may be private or deleted.",
                    job_id,
                )

            title = info.get('title', 'Untitled Video')
            duration = info.get('duration')

            if duration is None:
                raise DownloadError(
                    "Could not determine video duration. Live streams are not supported.",
                    job_id,
                )

            duration = int(duration)

            log.info(
                "preflight_success",
                title=title,
                duration_secs=duration,
                duration_minutes=round(duration / 60, 1),
            )

            return {
                "title": title,
                "duration_secs": duration,
            }

    except yt_dlp.utils.DownloadError as e:
        error_str = str(e).lower()

        if 'private video' in error_str:
            raise DownloadError("This video is private and cannot be accessed.", job_id)
        if 'video unavailable' in error_str or 'has been removed' in error_str:
            raise DownloadError("This video is unavailable. It may have been deleted.", job_id)
        if 'age' in error_str and 'restrict' in error_str:
            raise DownloadError("This video is age-restricted and cannot be processed.", job_id)
        if 'copyright' in error_str:
            raise DownloadError("This video has been blocked due to copyright restrictions.", job_id)
        if 'geo' in error_str or 'not available in your country' in error_str:
            raise DownloadError("This video is not available in the server's region.", job_id)
        if 'unable to extract' in error_str:
            raise DownloadError(
                "Could not process this URL. The platform may have changed. Please try again later.",
                job_id,
            )

        raise DownloadError(f"Failed to retrieve video: {str(e)[:200]}", job_id)


def _download_with_ytdlp(url: str, output_path_template: str, job_id: str, cookies_path: str | None = None) -> str:
    """
    Download a video using yt-dlp.
    Returns the actual final file path after download.
    Tracks download progress and updates database.
    """
    last_progress = [0]  # Track last logged progress to avoid excessive DB updates

    def progress_hook(d):
        try:
            if d['status'] == 'downloading':
                if '_total_bytes' in d and d['_total_bytes'] > 0:
                    percent = (d['downloaded_bytes'] / d['_total_bytes']) * 100
                    # Only update DB if progress changed by 5% or more
                    if abs(percent - last_progress[0]) >= 5:
                        update_job_progress(job_id, percent)
                        last_progress[0] = percent
        except Exception as e:
            # Silently fail on progress updates - don't crash the download
            log.warning("progress_hook_error", job_id=job_id, error=str(e))

    opts = {
        **YTDLP_BASE_OPTIONS,
        'outtmpl': output_path_template,
        'progress_hooks': [progress_hook],
    }
    if cookies_path:
        opts['cookiefile'] = cookies_path

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)

            if info is None:
                raise DownloadError("Download completed but no file information returned.", job_id)

            actual_path = ydl.prepare_filename(info)
            base_path = actual_path.rsplit('.', 1)[0]

            for ext in ['mp4', 'webm', 'mkv', 'avi']:
                candidate = f"{base_path}.{ext}"
                if os.path.exists(candidate) and os.path.getsize(candidate) > 0:
                    return candidate

            temp_dir = os.path.dirname(actual_path)
            for filename in os.listdir(temp_dir):
                if filename.startswith('source') and not filename.endswith('.wav'):
                    candidate = os.path.join(temp_dir, filename)
                    if os.path.getsize(candidate) > 0:
                        return candidate

            raise DownloadError("Download appeared to succeed but output file not found.", job_id)

    except yt_dlp.utils.DownloadError as e:
        raise DownloadError(f"Download failed: {str(e)[:300]}", job_id)


def _download_uploaded_file(job: dict, temp_dir: str) -> str:
    """
    Download a user-uploaded file from Supabase Storage.
    Returns the local file path.
    """
    storage_path = job["source_url"]
    local_path = os.path.join(temp_dir, "source.mp4")

    success, result = download_from_supabase_storage(storage_path, local_path)

    if not success:
        raise DownloadError(f"Failed to retrieve your uploaded file: {result}", job["id"])

    return local_path


async def run_download(job: dict, temp_dir: str) -> dict:
    """
    Download source video and extract audio.

    Pipeline:
    1. Validate source format for claimed platform.
    2. Pre-flight metadata for YouTube/Twitter.
    3. Validate duration against maximum limit.
    4. Calculate and deduct credits.
    5. Download the full video file.
    6. Extract 16kHz mono WAV audio for WhisperX.
    7. Update job record with title, duration, and credits.
    """
    job_id = job["id"]
    user_id = job["user_id"]
    source_url = job["source_url"]
    platform = job["source_platform"]
    credits_to_consume = 0
    credits_deducted = False

    log.info("download_start", job_id=job_id, platform=platform, url=source_url[:80])

    is_valid, validation_error = validate_url_for_platform(source_url, platform)
    if not is_valid:
        raise DownloadError(f"Invalid URL: {validation_error}", job_id)

    try:
        cookies_path = _write_cookies_file(temp_dir)

        if platform in ['youtube', 'twitter']:
            metadata = await asyncio.to_thread(_get_video_metadata, source_url, platform, job_id, cookies_path)
            title = metadata["title"]
            duration_secs = metadata["duration_secs"]
            video_path = None

        elif platform == 'upload':
            log.info("upload_download_start", job_id=job_id)
            video_path = await asyncio.to_thread(_download_uploaded_file, job, temp_dir)

            duration_secs_raw = await asyncio.to_thread(get_video_duration, video_path)
            if duration_secs_raw is None:
                raise DownloadError(
                    "Could not determine the duration of your uploaded file. Ensure it is a valid video.",
                    job_id,
                )

            duration_secs = int(duration_secs_raw)
            title = "Uploaded Video"

        else:
            raise DownloadError(f"Unsupported platform: {platform}", job_id)

        if duration_secs > MAX_DURATION_SECS:
            duration_minutes = round(duration_secs / 60)
            raise DownloadError(
                f"Video is {duration_minutes} minutes long. Maximum supported duration is 180 minutes.",
                job_id,
            )

        log.info(
            "duration_validated",
            job_id=job_id,
            duration_secs=duration_secs,
            duration_minutes=round(duration_secs / 60, 1),
        )

        credits_to_consume = calculate_credits(duration_secs)
        log.info("credit_calculation", job_id=job_id, credits_required=credits_to_consume)

        success, new_balance = deduct_credits(user_id, job_id, credits_to_consume)

        if not success:
            raise DownloadError(
                f"Insufficient credits. This video requires {credits_to_consume} credits. "
                "Please purchase more credits to continue.",
                job_id,
            )

        credits_deducted = True

        log.info(
            "credits_deducted_for_job",
            job_id=job_id,
            credits=credits_to_consume,
            remaining_balance=new_balance,
        )

        update_job_source_info(job_id, title, duration_secs, credits_to_consume)

        if platform in ['youtube', 'twitter']:
            output_template = os.path.join(temp_dir, 'source.%(ext)s')
            log.info("full_download_start", job_id=job_id, platform=platform)

            video_path = await asyncio.to_thread(
                _download_with_ytdlp,
                source_url,
                output_template,
                job_id,
                cookies_path,
            )

            log.info(
                "full_download_complete",
                job_id=job_id,
                video_path=video_path,
                size_mb=round(os.path.getsize(video_path) / (1024 * 1024), 2),
            )

        audio_path = os.path.join(temp_dir, "audio.wav")
        log.info("audio_extraction_start", job_id=job_id)

        success, result = await asyncio.to_thread(
            extract_audio_for_transcription,
            video_path,
            audio_path,
        )

        if not success:
            raise DownloadError(f"Audio extraction failed: {result}", job_id)

        audio_size_mb = round(os.path.getsize(audio_path) / (1024 * 1024), 2)
        log.info(
            "audio_extraction_complete",
            job_id=job_id,
            audio_path=audio_path,
            audio_size_mb=audio_size_mb,
        )

        return {
            "video_path": video_path,
            "audio_path": audio_path,
            "title": title,
            "duration_secs": duration_secs,
            "credits_to_consume": credits_to_consume,
        }

    except DownloadError as e:
        if credits_deducted and credits_to_consume > 0 and e.credits_to_refund == 0:
            e.credits_to_refund = credits_to_consume
        raise
