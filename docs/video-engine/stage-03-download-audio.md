# Stage 3 - Video Download And Audio Extraction

## What Was Added

Stage 3 replaces the worker download stub with a real pipeline:

- validates submitted source strings against the claimed platform
- runs yt-dlp metadata pre-flight before YouTube/Twitter/X downloads
- rejects videos over 180 minutes
- calculates credits from duration with a 5-credit minimum
- deducts credits before full download
- downloads YouTube/Twitter/X sources with yt-dlp
- downloads uploaded sources from Supabase Storage
- extracts 16kHz mono PCM WAV audio for Stage 4 transcription
- verifies FFmpeg and ffprobe at worker startup

## Data Flow

1. `poller.py` claims a queued job and marks it `downloading`.
2. `job_runner.py` calls `stages.download.run_download(job, temp_dir)`.
3. `run_download()` validates source format and determines duration.
4. The worker deducts credits and writes a `credit_transactions` consumption row.
5. The worker downloads the source and extracts `audio.wav`.
6. The download result is passed to the Stage 4 transcription stub.
7. `job_runner.py` cleans the temp directory in `finally`.

## Refund Safety

The original packet expects the Stage 2 failure handler to refund credits after download failures. Because credits are deducted inside `run_download()`, the implementation carries the deducted amount on `DownloadError` if a later download or audio extraction step fails. `job_runner.py` reads that amount and passes it to `fail_job()`.

Insufficient-credit failures do not request a refund because no deduction happened.

## Manual Verification Checklist

Before live jobs:

- `ffmpeg -version` works.
- `ffprobe -version` works.
- `pip install -r requirements.txt` has completed inside `video-worker/venv`.
- `video-worker/.env` has Supabase worker values and webhook secret.
- Supabase Storage has private `video-source-cache` and `video-clips` buckets.

Light tests:

```powershell
cd video-worker
.\venv\Scripts\Activate.ps1
python -c "from utils.url_validator import detect_platform; print(detect_platform('https://youtu.be/dQw4w9WgXcQ'))"
python -c "from stages.download import calculate_credits; print(calculate_credits(3661))"
python -c "from utils.ffmpeg_utils import check_ffmpeg_available; print(check_ffmpeg_available())"
```

Expected credit checks:

- `calculate_credits(30)` returns `5`
- `calculate_credits(60)` returns `5`
- `calculate_credits(300)` returns `5`
- `calculate_credits(360)` returns `6`
- `calculate_credits(3600)` returns `60`
- `calculate_credits(3661)` returns `62`

Live test:

- use a very short public YouTube video
- give the test user at least 100 credits
- insert a queued `video_jobs` row
- confirm source title, duration, credit transaction, status transitions, and temp cleanup
