# Video Engine User Actions

Last updated: 2026-05-10 13:32 +01:00

This file lists the things you must do outside the codebase. Anything paid or metered is kept optional until final MVP/proof-of-concept validation.

## Do Now

### 1. Install Python 3.12

The current worker venv was created with Python 3.14, which breaks the pinned `pydantic-core` dependency stack. As of 2026-05-09 23:24 +01:00, `py -0p` only shows Python 3.14 on this machine.

1. Go to `https://www.python.org/downloads/release/python-312/`.
2. Download the Windows installer for Python 3.12.
3. During install, enable the Python launcher option.
4. Open a new PowerShell window and run:

```powershell
py -3.12 --version
```

Expected result: a Python 3.12 version number.

### 2. Recreate The Worker Virtual Environment

Run from the project root:

```powershell
cd video-worker
Remove-Item -Recurse -Force venv
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Do not use `PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1` as the normal fix.

### 3. FFmpeg Status

Completed on 2026-05-09. FFmpeg and ffprobe are available on PATH:

- `ffmpeg version 8.1.1-essentials_build-www.gyan.dev`
- `ffprobe version 8.1.1-essentials_build-www.gyan.dev`
- FFmpeg configuration includes `--enable-libass`

The `--enable-libass` text is not a command to run by itself. It is a flag shown inside the `ffmpeg -version` output, and it confirms caption burn-in support.

Verification commands:

```powershell
ffmpeg -version
ffprobe -version
```

Both commands currently print version information.

### 4. Create Worker Environment File

Create `video-worker/.env` from `video-worker/.env.template`.

Required for worker startup:

```env
WORKER_SUPABASE_URL=
WORKER_SUPABASE_SERVICE_KEY=
WORKER_WEBHOOK_SECRET=
WORKER_USE_MOCK_REPLICATE=true
WORKER_USE_MOCK_ANTHROPIC=true
```

Use the Supabase service role key only in the worker `.env`. Never expose it in browser code.

### 5. Confirm Supabase Manual Setup

In the Supabase dashboard:

1. Confirm the Stage 1 SQL has been run.
2. Confirm private bucket `video-clips` exists.
3. Confirm private bucket `video-source-cache` exists.
4. Confirm test users have a `user_credits` row.
5. Confirm the `video-clips` bucket accepts files large enough for 90-second 1080x1920 MP4 outputs.

### 6. Add API Layer Environment Variables

Add these to `.env.local` before testing Packet 7 routes:

```env
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
WORKER_WEBHOOK_URL=http://localhost:8001
VIDEO_WORKER_WEBHOOK_SECRET=the_same_secret_from_video-worker_env
NEXT_PUBLIC_APP_URL=http://localhost:3000
VIDEO_ENGINE_USE_MOCK_PAYMENTS=true
```

Do not put the Supabase service role key in any browser-facing file or client component.

### 7. Decide How The Next API Routes Will Run

The route files are implemented in Next.js App Router format, but the current app uses Vite. Before live route testing, choose one path:

1. Migrate/enable the app as a Next.js app so `src/app/api/...` routes are served by Next.
2. Keep Vite for the frontend and move these handlers behind a separate server layer.

Until that runtime decision is made, use the docs and source files as the backend contract for Packet 8.

### 8. Enable Supabase Realtime For Stage 8

In the Supabase dashboard:

1. Open your project.
2. Go to Database.
3. Open Replication.
4. Enable realtime/replication for `video_jobs`.
5. Enable realtime/replication for `video_clips`.
6. Save the changes.

Without this, the job status page can load initial data but will not update live when the worker changes the database.

## Do After Python 3.12 Setup

Install the new Stage 6 dependencies:

```powershell
cd video-worker
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Then check OpenCV:

```powershell
python -c "import cv2; print(cv2.__version__)"
```

## Do Later, When Enabling Paid Transcription

Replicate is treated as paid/metered and should remain mocked for now.

To enable real transcription later:

1. Create/sign in to a Replicate account at `https://replicate.com`.
2. Go to Account Settings, then API tokens.
3. Create a token and copy it.
4. Add it to `video-worker/.env`:

```env
WORKER_REPLICATE_API_TOKEN=r8_your_token_here
WORKER_USE_MOCK_REPLICATE=false
```

5. Open `video-worker/stages/transcribe.py`.
6. Replace `PASTE_YOUR_VERSION_HASH_HERE` in `WHISPERX_MODEL_VERSION` with the verified WhisperX model version hash.
7. Run a very short test job first.

## Do Later, When Enabling Paid LLM Scoring

Anthropic is implemented for Stage 5 but remains mocked until the MVP path is proven.

When ready:

1. Create/sign in to an Anthropic account at `https://console.anthropic.com`.
2. Add billing only when you intentionally want real scoring.
3. Open API Keys and create a key.
4. Add it to worker env only:

```env
WORKER_ANTHROPIC_API_KEY=
WORKER_USE_MOCK_ANTHROPIC=false
```

Keep browser-facing env files free of paid secret keys.

5. Run a short test video first.
6. Read the resulting clip titles, captions, scores, and transcript excerpts before trusting the prompt on longer videos.

## Do Later, When Enabling Stripe Test Payments

Keep `VIDEO_ENGINE_USE_MOCK_PAYMENTS=true` until you intentionally test payments.

When ready:

1. Go to `https://dashboard.stripe.com`.
2. Switch to Test Mode.
3. Open Developers, then API keys.
4. Copy the test secret key and publishable key into `.env.local`:

```env
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
VIDEO_ENGINE_USE_MOCK_PAYMENTS=false
```

5. Open Developers, then Webhooks.
6. Add endpoint `http://localhost:3000/api/webhooks/stripe`.
7. Select the `checkout.session.completed` event.
8. Copy the webhook signing secret:

```env
STRIPE_WEBHOOK_SECRET=whsec_...
```

9. Use Stripe CLI for local webhook forwarding when testing locally.
