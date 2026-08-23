# video-worker/stages/download.py
# Downloads source video and extracts audio for transcription.
# Supports YouTube, Twitter/X, and direct Supabase Storage uploads.
# Stage 3 full implementation.

import asyncio
import math
import os
import re

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
    # Resilience for large sources. A 20-minute video failed mid-transfer with
    # "The read operation timed out. Giving up after 3 retries" (2026-08-23),
    # while the same video downloaded in 15s on retest — so this was a
    # transient stall, NOT a systematic limit. That is exactly what retries and
    # a patient socket exist for: a 30-second read timeout treats a normal
    # network hiccup on an 80MB transfer as a fatal error, burns the user's
    # job, and makes them resubmit.
    'socket_timeout': 120,
    'retries': 10,
    'fragment_retries': 10,
    'quiet': True,
    'no_warnings': False,
    'extract_flat': False,
    'merge_output_format': 'mp4',
    # Detecting a JS runtime is not the same as being allowed to use one.
    # yt-dlp enables only Deno by default (it sandboxes); node must be named
    # explicitly or the challenge solver stays dark and YouTube returns no
    # format URLs. Measured on Fly 2026-08-22, same video, same cookies:
    #   without this -> 0 usable formats
    #   with this    -> 49 formats, 38 downloadable video
    'js_runtimes': {'node': {}},
    # NOTE: this used to say the iOS client "bypasses YouTube's bot detection on
    # server IPs without requiring cookies". That stopped being true. Tested from
    # the Fly host on 2026-08-22: ios, web AND android all returned "Sign in to
    # confirm you're not a bot". The client list is still worth keeping — it
    # costs nothing and helps on some sources — but it is NOT a substitute for
    # WORKER_YOUTUBE_COOKIES, and believing it was is why cookies were never set.
    'extractor_args': {
        # Client choice decides BOTH reliability and quality, and the previous
        # list ['tv','ios','web'] was quietly terrible at both. Measured on the
        # same video, same moment, 2026-08-23:
        #
        #   tv+ios+web    5 formats, max height  360p   <- what we were shipping
        #   mweb        166 formats, max height 2160p
        #   web_safari  143 formats, max height 1080p
        #   tv_embedded 119 formats
        #
        # Five formats is why an intermittent SABR sweep could wipe out every
        # option and fail the job, and 360p is why rendered clips looked soft —
        # the pipeline was never given anything better to work with. The rich
        # clients pick 1080p and leave ~160 fallbacks if some are poisoned.
        'youtube': {'player_client': ['mweb', 'web_safari', 'tv_embedded', 'web']},
        # Script-mode PO-token provider (see Dockerfile). Without a token,
        # requests from this flagged datacenter IP get bot-checked regardless
        # of cookies or the solved JS challenge; with one, guest access is
        # usually restored. Harmless when the script is absent - the plugin
        # logs and falls through.
        'youtubepot-bgutilscript': {'script_path': ['/opt/bgutil/server/build/generate_once.js']},
    },
}


# Fallback ladder. YouTube's SABR enforcement is applied PER REQUEST, not per
# video: the same source succeeded at 11:31, failed at 11:52, and succeeded
# again at 13:10 with identical code. A single client set therefore cannot be
# "the right one" — resilience comes from having somewhere else to go when the
# current one comes back empty. Each rung uses a different mix so a sweep that
# poisons one is unlikely to poison the next.
CLIENT_LADDER = [
    ['mweb', 'web_safari', 'tv_embedded', 'web'],   # richest format lists
    ['web_safari', 'mweb'],
    ['tv_embedded', 'web'],
    ['tv', 'ios', 'web'],                            # the old default, last
]

# Errors that mean "this client came back with nothing usable" rather than
# "this video cannot be downloaded at all". Only these are worth another rung;
# a private or deleted video is not.
_RETRYABLE_MARKERS = (
    'requested format is not available',
    'page needs to be reloaded',
    'no video formats',
    'unable to extract',
)


def _is_retryable_format_error(err: str) -> bool:
    low = err.lower()
    return any(m in low for m in _RETRYABLE_MARKERS)


def _opts_with_clients(base: dict, clients: list) -> dict:
    """Copy opts with the youtube player_client replaced. Deep enough that the
    module-level YTDLP_BASE_OPTIONS is never mutated by a retry."""
    opts = dict(base)
    extractor_args = {k: dict(v) for k, v in (base.get('extractor_args') or {}).items()}
    yt = dict(extractor_args.get('youtube') or {})
    yt['player_client'] = clients
    extractor_args['youtube'] = yt
    opts['extractor_args'] = extractor_args
    return opts


def calculate_credits(duration_secs: int) -> int:
    """
    Calculate credit cost from video duration.
    One credit per minute, rounded up, with a minimum charge.
    """
    minutes = math.ceil(duration_secs / 60)
    return max(minutes * CREDITS_PER_MINUTE, MIN_CREDITS_REQUIRED)


def _repair_cookie_newlines(raw: str) -> str:
    """
    Netscape cookie files are newline-delimited, but the Fly secrets dashboard
    (and many secret UIs) strip newlines out of a pasted multi-line value — the
    whole file arrives as ONE line with the tabs intact. The Netscape parser
    then sees a single malformed line and loads zero cookies, and YouTube says
    "sign in" exactly as if no cookies were set at all. Measured 2026-08-23: a
    correctly-exported 24-row cookie file pasted into the Fly dashboard arrived
    as 1 line / 144 tabs, and the pipeline failed with a message telling the
    user to set the variable they had just set.

    Every data row has the shape:
        domain \t flag \t path \t flag \t expiry \t name \t value
    optionally prefixed with '#HttpOnly_' on the domain. Values never contain
    tabs (the format forbids it), so "domain TAB TRUE|FALSE TAB" is reliably a
    row start and never occurs inside a value. If the input already has real
    newlines this is a no-op; otherwise the rows are rebuilt, so a mangled
    paste self-heals instead of silently downgrading to guest access.
    """
    if raw.count("\n") > 3:
        return raw  # already multi-line, nothing to fix

    # Sometimes newlines survive as the literal two-character sequence \n.
    unescaped = raw.replace("\\n", "\n").replace("\\t", "\t")
    if unescaped.count("\n") > 3:
        return unescaped

    # Newlines were deleted outright: rebuild the rows.
    body = raw.replace("# Netscape HTTP Cookie File", "")
    body = re.sub(r"#\s*https?://\S+", "", body)
    rebuilt = re.sub(
        r"(#HttpOnly_)?(\.?[A-Za-z0-9.-]+)\t(TRUE|FALSE)\t",
        lambda m: "\n" + (m.group(1) or "") + m.group(2) + "\t" + m.group(3) + "\t",
        body,
    ).strip()
    rows = [ln for ln in rebuilt.splitlines() if ln.strip() and "\t" in ln]
    return "# Netscape HTTP Cookie File\n" + "\n".join(rows) + "\n"


def _write_cookies_file(temp_dir: str) -> str | None:
    """Write WORKER_YOUTUBE_COOKIES to a temp file for yt-dlp, repairing a
    newline-stripped paste first (see _repair_cookie_newlines)."""
    if not config.youtube_cookies:
        return None
    content = _repair_cookie_newlines(config.youtube_cookies)

    rows = [ln for ln in content.splitlines() if "\t" in ln and not ln.startswith("#")]
    if not rows:
        # Refuse loudly rather than hand yt-dlp a file it will parse to zero
        # cookies — that failure reads as "sign in required" and points the
        # user everywhere except at the actual export.
        log.warning(
            "youtube_cookies_unparseable",
            message="WORKER_YOUTUBE_COOKIES contains no valid cookie rows even "
                    "after repair — the export is malformed. Proceeding as guest.",
        )
        return None
    log.info("youtube_cookies_loaded", rows=len(rows))

    cookies_path = os.path.join(temp_dir, "yt_cookies.txt")
    with open(cookies_path, "w") as f:
        f.write(content)
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

    # Walk the ladder on "came back with nothing usable" errors. The last rung
    # re-raises so the classifier below still produces a real user-facing
    # message rather than a generic retry failure.
    last_error = None
    for rung, clients in enumerate(CLIENT_LADDER):
        try:
            probe = _opts_with_clients(opts, clients)
            with yt_dlp.YoutubeDL(probe) as ydl:
                info = ydl.extract_info(url, download=False)
            if info and info.get('duration') is not None:
                log.info(
                    "preflight_success",
                    title=info.get('title', 'Untitled Video'),
                    duration_secs=int(info['duration']),
                    clients='+'.join(clients),
                    rung=rung,
                )
                return {
                    "title": info.get('title', 'Untitled Video'),
                    "duration_secs": int(info['duration']),
                }
        except Exception as e:  # noqa: BLE001 - classified below
            last_error = e
            if not _is_retryable_format_error(str(e)):
                break
            log.warning(
                "metadata_client_rung_failed",
                rung=rung,
                clients='+'.join(clients),
                error=str(e)[:100],
            )

    # Every rung exhausted (or a non-retryable error): fall through to the
    # original path so the error classifier produces the right message.
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

        # Bot detection first, because it MASQUERADES as other failures. On a
        # datacenter IP YouTube returns a challenge instead of a format list,
        # yt-dlp then reports "Requested format is not available", and the real
        # cause never reaches the user. Verified on Fly 2026-08-22: every player
        # client (ios, web, android) got "Sign in to confirm you're not a bot",
        # while the job record said the format was wrong.
        if 'not a bot' in error_str or 'sign in to confirm' in error_str or 'confirm you' in error_str:
            # Measured 2026-08-23 on this IP: with PO tokens + the EJS solver,
            # SOME videos extract as a guest, but most still demand a login.
            # Cookies exported from a browser session that stays open get
            # ROTATED by YouTube within hours and die silently — which is what
            # happened to the first cookie export this worker was given. The
            # message must teach the correct procedure, not just name the var.
            raise DownloadError(
                "YouTube asked this worker to sign in. Set or REFRESH "
                "WORKER_YOUTUBE_COOKIES: export cookies from a logged-in "
                "private/incognito window and close that window immediately "
                "afterwards — cookies from a browser session that stays open "
                "are rotated by YouTube within hours and stop working. "
                "Alternatively, upload the video file directly.",
                job_id,
            )

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

    # Same ladder as the metadata probe. A client set that answered the probe
    # can still come back empty seconds later, so the download gets its own
    # walk. Only `opts` is advanced here — the real download happens once,
    # below, with whichever rung proved it can see usable formats.
    for rung, clients in enumerate(CLIENT_LADDER[1:], start=1):
        try:
            with yt_dlp.YoutubeDL({**opts, 'skip_download': True, 'quiet': True}) as probe:
                info = probe.extract_info(url, download=False)
            if info and any(f.get('url') for f in (info.get('formats') or [])):
                break  # this rung can see real formats; download with it
            raise RuntimeError('no video formats with URLs')
        except Exception as e:  # noqa: BLE001 - classified by the handler below
            if not _is_retryable_format_error(str(e)):
                break
            log.warning(
                "download_client_rung_retry",
                job_id=job_id,
                next_rung=rung,
                clients='+'.join(clients),
                error=str(e)[:100],
            )
            opts = _opts_with_clients(opts, clients)

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
        error_str = str(e).lower()
        # Same classification as the metadata handler above. This is the path
        # that actually fired on 2026-08-22 and reported "Requested format is not
        # available" — a format selector failing because the challenge response
        # carried no formats, which reads as a bug in our selector rather than a
        # missing credential.
        if 'not a bot' in error_str or 'sign in to confirm' in error_str or 'confirm you' in error_str:
            raise DownloadError(
                "YouTube blocked this download as automated traffic. The worker runs on a "
                "datacenter IP, which YouTube challenges by default. Set WORKER_YOUTUBE_COOKIES "
                "to a valid cookie export to authenticate these requests.",
                job_id,
            )
        if 'requested format is not available' in error_str:
            raise DownloadError(
                "No usable video format was returned for this URL. This is usually YouTube "
                "refusing an unauthenticated datacenter request rather than a genuine format "
                "problem — check WORKER_YOUTUBE_COOKIES before investigating the selector.",
                job_id,
            )
        raise DownloadError(f"Download failed: {str(e)[:300]}", job_id)


def _resolve_worker_upload(job: dict) -> str:
    """
    Resolve a `worker://{user_id}/{upload_id}` source that the browser uploaded
    straight onto this machine's volume (LOCK L7.4, see uploads.py).

    Nothing is downloaded — the file is already here. That is the whole point:
    Supabase Storage on this project caps uploads at 50MB, which is far below a
    real long-form source, and the volume this worker already pays for does not.
    """
    from uploads import local_path_for, upload_dir  # local import: avoids a cycle

    ref = job["source_url"][len("worker://"):]
    if "/" not in ref:
        raise DownloadError("Malformed upload reference on this job.", job["id"])
    user_id, upload_id = ref.split("/", 1)

    user_dir = os.path.join(upload_dir(), user_id)
    if os.path.isdir(user_dir):
        for name in sorted(os.listdir(user_dir)):
            if name.startswith(upload_id):
                candidate = os.path.join(user_dir, name)
                if os.path.getsize(candidate) > 0:
                    log.info(
                        "worker_upload_resolved",
                        job_id=job["id"],
                        size_mb=round(os.path.getsize(candidate) / (1024 * 1024), 1),
                    )
                    return candidate

    # The volume is scratch space, not durable storage. A machine replacement,
    # or the orphan reaper after 24h, removes uploads — so say what happened
    # rather than reporting a generic missing file.
    raise DownloadError(
        "The uploaded file is no longer on the worker. Uploads are held for 24 hours "
        "and are cleared when the worker is redeployed — please upload it again.",
        job["id"],
    )


def _download_uploaded_file(job: dict, temp_dir: str) -> str:
    """
    Download a user-uploaded file from Supabase Storage.
    Returns the local file path.

    Retained for sources uploaded through Supabase (<=50MB). Files sent straight
    to the worker use the worker:// scheme and _resolve_worker_upload instead.
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
            if str(source_url).startswith('worker://'):
                # Already on this machine's volume — no fetch, no egress, no
                # 50MB ceiling.
                video_path = await asyncio.to_thread(_resolve_worker_upload, job)
            else:
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
