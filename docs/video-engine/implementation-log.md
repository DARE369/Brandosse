# Video Engine Implementation Log

## 2026-05-10 13:32 +01:00 - Stage 8 Frontend UI

### Implemented

- Added authenticated Vite routes for `/app/video/new`, `/app/video/jobs`, `/app/video/jobs/:id`, and `/app/billing/credits`.
- Added Supabase Realtime hook for job and clip updates.
- Added clip download hook that refreshes signed URLs before downloading.
- Added submit form, job status pipeline, clip gallery, clip cards, preview modal, jobs list, job cards, credits dashboard, and credit package cards.
- Added client data helpers for video jobs, credits, transactions, and authenticated API calls.
- Integrated Videos and Credits links into the user sidebar.
- Added a live credit balance pill to the user navbar.
- Reworked `VideoEngineLab.css` to use design tokens so the UI guardrail passes.
- Added `docs/video-engine/stage-08-frontend-ui.md`.

### How It Was Implemented

- The packet assumed Next.js App Router pages, but this repo currently uses Vite and React Router. The UI was implemented in the existing runtime instead of adding unusable Next page files.
- The pages use the existing `ProtectedRoute`, `UserNavbar`, `UserSidebar`, and `supabase` browser client.
- API calls attach the current Supabase access token as a Bearer token so they match the Packet 7 auth helper.
- Realtime updates subscribe directly through the existing browser Supabase client.

### Issues Or Not Completed

- Supabase Realtime still needs to be enabled manually for `video_jobs` and `video_clips`.
- Packet 7 API routes still need an actual server runtime before submit/delete/refresh/purchase calls can succeed outside a Next environment.
- Live end-to-end testing has not been run because the worker/API runtime is not fully running locally yet.

### Verification

- `npm run build` passed.
- `npm run check:status-literals` passed.
- `npm run check:ui-consistency` passed with 0 findings.

### User Manual Steps

1. Enable Supabase Realtime on `video_jobs` and `video_clips`.
2. Start the frontend and open `/app/video/new`.
3. Start the API/runtime layer for Packet 7 before testing submit, delete, refresh URL, or purchase calls.
4. Keep Stripe mocked until ready to test payments.

## 2026-05-10 00:28 +01:00 - Stage 7 Next.js API Layer

### Implemented

- Installed and recorded `stripe` and `zod` as app dependencies.
- Added server-only Supabase admin client.
- Added protected route auth helper with standard `AUTH_REQUIRED` response.
- Added worker webhook client for job submitted, job cancelled, and worker health checks.
- Added database-backed rate limiter for active job and hourly submission limits.
- Added credit package definitions.
- Added Next App Router handlers for video submit, job list, job detail/delete, clip URL refresh, credit balance, credit purchase, and Stripe webhook.
- Replaced old `src/api/video/...` 501 placeholders with compatibility re-exports to the new App Router handlers.
- Updated `.env.video-engine.template` with worker URL and app URL entries.
- Added `docs/video-engine/stage-07-nextjs-api.md` and updated the checklist, setup, user actions, mock policy, decisions, and overview.

### How It Was Implemented

- Protected routes authenticate before reading request bodies or doing database work.
- The submit route validates input with Zod, checks platform/url compatibility, checks credits, checks rate limits, creates a queued job, and best-effort notifies the worker.
- Job routes enforce ownership through `user_id` and use the service role client server-side.
- Signed URL refresh uses the private `video-clips` bucket and updates the clip row.
- Purchase route supports real Stripe Checkout, but respects `VIDEO_ENGINE_USE_MOCK_PAYMENTS=true` to avoid paid/payment flows during buildout.
- Stripe webhook reads the raw request body for signature verification and ignores duplicate payment IDs.

### Issues Or Not Completed

- This repository is still Vite-based and does not currently include a full Next.js runtime.
- `next/server` imports therefore require a Next setup before these API routes can run as HTTP endpoints.
- Project-level TypeScript checking is not configured in this repo yet; `npx tsc --noEmit` tries to fetch the unrelated `tsc` package because local `typescript` is not installed.
- Live authenticated route tests, worker notification tests, and Stripe webhook tests were not run.

### Verification

- `stripe` and `zod` resolve from `node_modules`.
- Targeted TypeScript check passed for the new Stage 7 files using a temporary TypeScript compiler.
- `npm run build` passed through the existing Vite build.
- `npm run check:status-literals` passed.
- `npm run check:ui-consistency` exited successfully but reported 43 existing raw-color findings in `src/pages/VideoEngine/VideoEngineLab.css`.

### User Manual Steps

1. Add `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_WEBHOOK_URL`, `VIDEO_WORKER_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`, and `VIDEO_ENGINE_USE_MOCK_PAYMENTS=true` to `.env.local`.
2. Decide whether the app is moving to Next.js or whether these handlers should be hosted in a separate server layer.
3. Keep Stripe mocked until ready to test payments.
4. When enabling Stripe test mode, add test keys and webhook secret, then use Stripe CLI to forward webhooks locally.

## 2026-05-09 23:24 +01:00 - Local Environment Verification

### Verified

- `npm run check:ui-consistency` passed with 0 findings.
- `npm run check:status-literals` passed.
- `ffmpeg -version` works from PowerShell.
- FFmpeg version is `8.1.1-essentials_build-www.gyan.dev`.
- `ffprobe -version` works from PowerShell.
- FFmpeg configuration includes `--enable-libass`, so Stage 6 caption burn-in support is present.

### Issues Or Not Completed

- `python3 --version` is not available on this Windows shell.
- `py -0p` currently shows only Python 3.14.
- Python 3.12 is still required before recreating `video-worker/venv` and installing worker requirements.
- Chocolatey reported a lock/permission failure during `choco install ffmpeg`, but FFmpeg is nevertheless available on PATH now.

### User Manual Steps

1. Install Python 3.12 from python.org with the Python launcher enabled.
2. Open a new PowerShell window and confirm `py -3.12 --version`.
3. Recreate `video-worker/venv` using Python 3.12.
4. Run `pip install -r requirements.txt` inside the new venv.

## 2026-05-09 13:56 +01:00 - Stage 6 Rendering, Captions, Reframing, And Upload

### Implemented

- Added `opencv-python-headless==4.10.0.84` and `numpy==1.26.4` to worker requirements.
- Added `video-worker/utils/caption_generator.py` for ASS caption generation.
- Added `video-worker/utils/video_reframer.py` for 9:16 crop coordinate calculation with OpenCV face-detection fallback.
- Added `video-worker/utils/storage_uploader.py` for Supabase Storage upload and signed URLs.
- Added `render_clip_to_file()` to `video-worker/utils/ffmpeg_utils.py`.
- Added `get_clips_for_job()`, `get_transcript_word_segments()`, and `mark_clip_render_failed()` to `video-worker/database.py`.
- Replaced `video-worker/stages/render.py` with the Stage 6 per-clip render pipeline.
- Added `docs/video-engine/stage-06-rendering.md`.
- Updated setup, user actions, decisions, checklist, README, and this log.

### How It Was Implemented

- Captions are generated from transcript word segments, converted to clip-relative timestamps, grouped into 3-word ASS dialogue events, and styled for 1080x1920 mobile output.
- The reframer samples frames from each clip, attempts Haar Cascade face detection, and returns one static 9:16 crop. Missing OpenCV, missing frames, or any error falls back safely.
- FFmpeg rendering fast-seeks with `-ss`, uses `-t`, crops before scaling, burns ASS captions after scaling, normalizes audio, applies `+faststart`, tries NVENC first, and falls back to libx264.
- Each clip renders inside its own try/except. Successful clips are uploaded and marked complete. Failed clips are marked failed.
- The stage raises `RenderError` only when all clips fail.

### Issues Or Not Completed

- Live FFmpeg rendering was not run on this machine.
- OpenCV and NumPy were not installed because the worker venv still needs Python 3.12.
- Supabase Storage upload and signed URL access were not live-tested.
- FFmpeg libass support was later confirmed locally at 2026-05-09 23:24 +01:00.
- Dynamic tracking and parallel clip rendering are deferred.

### User Manual Steps

1. Install Python 3.12 and recreate the worker venv.
2. Run `pip install -r requirements.txt`.
3. Install FFmpeg and confirm `ffmpeg -version`, `ffprobe -version`, and `--enable-libass`.
4. Confirm Supabase `video-clips` bucket exists, is private, and can accept rendered clip sizes.
5. Run the lightweight Stage 6 checks in `stage-06-rendering.md`.
6. Only after those pass, run a short end-to-end job.

## 2026-05-09 13:38 +01:00 - Stage 5 Mock-First LLM Scoring Engine

### Implemented

- Added `anthropic==0.34.2` and `tiktoken==0.7.0` to worker requirements.
- Added `video-worker/utils/llm_client.py` for Anthropic client creation, mock scoring, retry handling, token estimation, and transcript chunking.
- Added `video-worker/utils/clip_selector.py` for JSON parsing, clip validation, overlap deduplication, score filtering, and final selection.
- Replaced `video-worker/stages/analyze.py` with the Stage 5 scoring engine.
- Added `docs/video-engine/stage-05-llm-scoring.md`.
- Updated the build checklist, setup guide, user actions, decisions, mock policy, and overview.

### How It Was Implemented

- The scoring stage formats the parsed Stage 4 transcript using `get_transcript_for_llm()`.
- The LLM client estimates token count and chunks long transcripts above the configured threshold.
- The default mock path returns deterministic Claude-style JSON so the pipeline can validate scoring behavior without paid calls.
- The real Anthropic path is guarded by `WORKER_USE_MOCK_ANTHROPIC=false` and validates the API key/package before attempting a live call.
- The clip selector enforces required fields, score ranges, duration bounds, platform targets, overlap dedupe, minimum quality thresholds, max 8 clips, and sequential re-indexing.

### Issues Or Not Completed

- Real Anthropic scoring was not tested because paid services are intentionally deferred.
- Prompt quality has not been evaluated against real content yet.
- The current database schema does not store `quotability_score` or `reasoning` as dedicated columns.
- Python dependencies were not installed because the worker venv still needs Python 3.12.
- Full worker pipeline was not run because local Python 3.12 and FFmpeg setup are still pending.

### User Manual Steps

1. Keep `WORKER_USE_MOCK_ANTHROPIC=true` for now.
2. Install Python 3.12 and recreate the worker venv.
3. Run `pip install -r requirements.txt`.
4. Install FFmpeg and confirm `ffmpeg -version` plus `ffprobe -version`.
5. Only enable Anthropic later after adding billing/key and testing the prompt on short videos.

## 2026-05-09 13:23 +01:00 - Stage 4 Mock-First Transcription And Documentation System

### Implemented

- Added `replicate==0.34.1` to worker requirements for later real transcription mode.
- Added `compress_audio_for_upload()` to `video-worker/utils/ffmpeg_utils.py`.
- Added `video-worker/utils/transcript_parser.py` as the Stage 4 to Stage 5 transcript contract.
- Replaced `video-worker/stages/transcribe.py` with mock-first transcription.
- Kept real Replicate transcription behind `WORKER_USE_MOCK_REPLICATE=false`.
- Added `build-checklist.md`, `user-actions.md`, `decisions.md`, and `stage-04-transcription.md`.
- Updated the overview, setup guide, and API-key/mock policy.

### How It Was Implemented

- Mock mode validates the local audio file, creates a WhisperX-style payload with phrase segments, speakers, word-level timestamps, language, and raw transcript metadata, then runs it through the shared parser.
- Real mode is scaffolded but guarded. It validates the Replicate token and model version before compressing audio, uploading to Replicate, polling a prediction, and parsing the returned transcript.
- The parser detects repeated transcript hallucinations and enforces word-level timestamps before returning data to the rest of the pipeline.
- Documentation now follows a practical subset of the uploaded software launch research: checklist, user actions, decisions, implementation log, setup, API/mock policy, and stage notes.

### Issues Or Not Completed

- Real Replicate transcription was not tested because paid services are intentionally deferred.
- Python dependencies were not installed because the current local venv still needs to be recreated with Python 3.12.
- FFmpeg and ffprobe still need to be installed locally before the worker can start.
- Live Supabase save behavior was not verified in this pass.

### User Manual Steps

1. Install Python 3.12 and recreate `video-worker/venv`.
2. Run `pip install -r requirements.txt` inside the Python 3.12 venv.
3. Install FFmpeg and confirm `ffmpeg -version` and `ffprobe -version`.
4. Keep `WORKER_USE_MOCK_REPLICATE=true` until you intentionally enable paid transcription.
5. Review `user-actions.md` and `build-checklist.md` before the next implementation stage.

## 2026-05-09 - Stage 3 Download And Audio Extraction

### Implemented

- Added `yt-dlp==2024.12.13` to the worker requirements.
- Added URL validation utilities for YouTube, Twitter/X, and upload storage paths.
- Added FFmpeg utilities for startup checks, duration probing, audio extraction, and thumbnail extraction.
- Added worker database helpers for credit deduction and Supabase Storage source downloads.
- Replaced the Stage 2 download stub with the Stage 3 implementation.
- Added FFmpeg startup verification to the worker lifespan flow.
- Added mock-mode env placeholders for paid future services.
- Added this documentation set under `docs/video-engine/`.

### How It Was Implemented

- YouTube and Twitter/X use yt-dlp for metadata pre-flight and full download.
- Uploaded sources use Supabase Storage path download through the service role worker client.
- Audio extraction uses FFmpeg to produce 16kHz mono PCM WAV for WhisperX compatibility.
- Credit deduction happens after duration is known and before full download.
- Download-stage failures after successful deduction pass the refund amount through `DownloadError` so `job_runner.py` can refund correctly.

### Issues Or Not Completed

- Python dependencies were not installed, per prior packet instructions and because this machine is low-end.
- FFmpeg and ffprobe are not currently available in PATH on this machine.
- Live video download tests were not run.
- `video-worker/.env` was not created because it needs local secrets.
- Supabase Storage buckets still need to be confirmed or created in the Supabase dashboard.

### User Manual Steps

1. Install FFmpeg and confirm `ffmpeg -version` and `ffprobe -version`.
2. Activate the worker venv and run `pip install -r requirements.txt`.
3. Create `video-worker/.env` from `.env.template`.
4. Fill Supabase worker URL, service key, and webhook secret.
5. Keep mock flags set to `true` for paid future services until you intentionally enable them.
6. Run the light tests in `stage-03-download-audio.md` before attempting a live job.

## 2026-05-09 - Isolated Dev Route And Python Install Fix

### Implemented

- Added an isolated public frontend route at `/video-engine` for video-engine development status.
- Identified that the worker install failure came from Python 3.14 attempting to build `pydantic-core==2.20.1`.
- Updated setup guidance to require a Python 3.12 worker venv for this pinned dependency stack.

### How It Was Implemented

- The dev route should stay outside the protected `/app` shell and off the main navigation.
- The worker health check should call only public `/health`; protected status commands remain manual so secrets are never exposed in the browser.
- Python setup now recreates `video-worker/venv` with `py -3.12 -m venv venv`.

### Issues Or Not Completed

- The current local venv is Python 3.14.4, so `pip install -r requirements.txt` fails while building `pydantic-core`.
- Python 3.12 is not installed on this machine yet according to `py -0p`.
- FFmpeg and ffprobe are still not available in PATH.

### User Manual Steps

1. Install Python 3.12 from `python.org` with the Python launcher enabled.
2. Run:

```powershell
py -3.12 --version
cd video-worker
Remove-Item -Recurse -Force venv
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

3. Install FFmpeg and confirm `ffmpeg -version` and `ffprobe -version`.
