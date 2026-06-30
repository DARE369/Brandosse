# Video Engine Setup

Last updated: 2026-05-10 00:28 +01:00

## Local Requirements

The worker uses Python and free local media tools.

- Python 3.12 for the worker venv
- `video-worker/venv`
- FFmpeg and ffprobe on PATH
- FFmpeg build with `libass` enabled for caption burn-in
- Supabase project URL and service role key
- private Supabase Storage buckets:
  - `video-clips`
  - `video-source-cache`
- mock flags enabled for paid services while building:
  - `WORKER_USE_MOCK_REPLICATE=true`
  - `WORKER_USE_MOCK_ANTHROPIC=true`
  - `VIDEO_ENGINE_USE_MOCK_PAYMENTS=true`

## Install FFmpeg On Windows

Current local status: FFmpeg and ffprobe are installed and available on PATH. The installed build is `8.1.1-essentials_build-www.gyan.dev` and includes `--enable-libass`.

1. Download a Windows build from `https://ffmpeg.org/download.html`.
2. Extract it somewhere stable, for example `C:\ffmpeg`.
3. Add `C:\ffmpeg\bin` to your Windows PATH.
4. Open a new PowerShell window and verify:

```powershell
ffmpeg -version
ffprobe -version
```

Both commands must print version information. The worker will refuse to start if either tool is missing.

For Stage 6 captions, also check that FFmpeg includes libass:

```powershell
ffmpeg -version
```

Look for `--enable-libass` in the configuration output. If it is missing, burned captions may fail. Do not run `--enable-libass` as its own PowerShell command; it is a build flag inside FFmpeg's version output.

## Python Worker Setup

Use Python 3.12 for this worker. The pinned `pydantic==2.8.2`
dependency pulls `pydantic-core==2.20.1`, which does not support Python
3.14 in this stack and tries to compile Rust code locally. On a low-end
machine, that is slow and can fail.

Current local status: `py -0p` only shows Python 3.14, and `python3 --version`
falls through to the Microsoft Store alias. Install Python 3.12 before
recreating the worker venv.

Install Python 3.12 from `python.org` and enable the Python launcher option.
Then recreate the worker venv from the project root:

```powershell
py -3.12 --version
cd video-worker
Remove-Item -Recurse -Force venv
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
copy .env.template .env
```

Do not use `PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1` as the normal fix for
local development. Use Python 3.12 instead so pip can use compatible wheels.

If the venv was already created with Python 3.12, the shorter command is:

```powershell
cd video-worker
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Then fill `video-worker/.env`:

```env
WORKER_SUPABASE_URL=
WORKER_SUPABASE_SERVICE_KEY=
WORKER_WEBHOOK_SECRET=
WORKER_USE_MOCK_ANTHROPIC=true
WORKER_USE_MOCK_REPLICATE=true
```

Use the Supabase service role key, not the anon key. Keep `video-worker/.env` out of git.

## Stage 4 Mock Transcription

Stage 4 can run without a Replicate token while mock mode is enabled:

```env
WORKER_USE_MOCK_REPLICATE=true
WORKER_REPLICATE_API_TOKEN=
```

Do not disable mock mode until you intentionally want to run paid Replicate transcription.

## Stage 5 Mock Scoring

Stage 5 can run without an Anthropic key while mock mode is enabled:

```env
WORKER_USE_MOCK_ANTHROPIC=true
WORKER_ANTHROPIC_API_KEY=
```

Do not disable mock mode until you intentionally want paid Claude scoring.

## Stage 7 API Layer Setup

Packet 7 adds Next.js App Router API files under `src/app/api/...`. This repo is still running Vite, so the files are implemented but need a Next runtime before they can serve HTTP requests.

Add these server-only values to `.env.local` before testing the API layer:

```env
SUPABASE_SERVICE_ROLE_KEY=
WORKER_WEBHOOK_URL=http://localhost:8001
VIDEO_WORKER_WEBHOOK_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3000
VIDEO_ENGINE_USE_MOCK_PAYMENTS=true
```

Only add Stripe test keys when you intentionally test payments:

```env
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
```

Keep `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` server-only. They must never be imported into browser code.

## Low-End Machine Testing

Use the lightest checks first:

```powershell
python -m py_compile config.py database.py errors.py job_runner.py logger.py main.py poller.py stages\download.py utils\url_validator.py utils\ffmpeg_utils.py
```

Only run live downloads after syntax checks pass and FFmpeg is installed. Use a very short video first, ideally under 30 seconds.

Parser-only Stage 4 check:

```powershell
python -m py_compile stages\transcribe.py utils\transcript_parser.py utils\ffmpeg_utils.py
```

Parser and selector checks for Stage 5:

```powershell
python -m py_compile stages\analyze.py utils\llm_client.py utils\clip_selector.py
```

Stage 6 render utility checks:

```powershell
python -m py_compile stages\render.py utils\caption_generator.py utils\video_reframer.py utils\storage_uploader.py utils\ffmpeg_utils.py
```

Stage 7 TypeScript check after the app has a Next/TypeScript setup:

```powershell
npx tsc --noEmit
```
