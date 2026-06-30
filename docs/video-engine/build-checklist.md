# Video Engine Build Checklist

Last updated: 2026-05-10 13:32 +01:00

This checklist tracks the video engine from the first implementation packet through the current Stage 8 frontend UI work.

## Status Key

- Done: implemented in the repo.
- Manual required: you must complete this in Supabase, your local machine, or a service dashboard.
- Deferred: intentionally left for a later stage.
- Not verified: code exists, but a live/local check has not run yet.

## Local Environment Checks

- [x] Done - UI consistency guardrail passed with 0 findings.
- [x] Done - Status literal guardrail passed.
- [x] Done - FFmpeg is available on PATH: `8.1.1-essentials_build-www.gyan.dev`.
- [x] Done - ffprobe is available on PATH: `8.1.1-essentials_build-www.gyan.dev`.
- [x] Done - FFmpeg includes `--enable-libass`, so caption burn-in support is present.
- [ ] Manual required - Install Python 3.12. Current Python launcher list only shows Python 3.14.

## Stage 1 - Database Foundation And Project Architecture

- [x] Done - Combined Stage 1 SQL schema file created at `supabase/video-engine-stage-1-schema.sql`.
- [x] Done - SQL includes video jobs, clips, transcripts, user credits, and credit transactions.
- [x] Done - SQL enables Row Level Security on the new video engine tables.
- [x] Done - SQL includes storage policies and performance indexes.
- [x] Done - Frontend scaffolding folders and placeholder video pages exist under `src/app`.
- [x] Done - Video engine TypeScript model helpers exist under `src/lib/video-engine`.
- [x] Done - Legacy placeholder API route files under `src/api/video` now re-export the Stage 7 App Router handlers.
- [x] Done - Schema health-check route exists under `src/app/api/health/video-schema`.
- [x] Done - `.env.video-engine.template` exists for documentation.
- [x] Manual required - Confirm existing Supabase table names before running the schema.
- [x] Manual required - Run the SQL manually in the Supabase SQL Editor.
- [ ] Manual required - Create private Supabase Storage buckets `video-clips` and `video-source-cache`.
- [ ] Not verified - Health-check route has not been validated against a live Supabase schema.

## Stage 2 - Python Worker Skeleton

- [x] Done - `video-worker/` worker directory exists.
- [x] Done - Worker requirements, config, logger, errors, database helpers, poller, job runner, FastAPI app, Dockerfile, and README exist.
- [x] Done - Worker uses service-role Supabase access server-side only.
- [x] Done - Worker webhook secret stays in server/worker env files only.
- [x] Done - `.gitignore` includes worker venv/cache/env/log paths.
- [ ] Manual required - Install Python 3.12 locally.
- [ ] Manual required - Recreate `video-worker/venv` with Python 3.12.
- [ ] Manual required - Create `video-worker/.env` from `.env.template`.
- [ ] Not verified - Worker dependencies have not installed successfully yet because the current venv uses Python 3.14.

## Stage 3 - Video Download And Audio Extraction

- [x] Done - `yt-dlp==2024.12.13` is in worker requirements.
- [x] Done - URL validation utility exists for YouTube, Twitter/X, and uploads.
- [x] Done - FFmpeg utilities exist for startup checks, duration probing, audio extraction, and thumbnails.
- [x] Done - Download stage performs pre-flight metadata checks for supported URL platforms.
- [x] Done - Download stage validates 180-minute maximum duration.
- [x] Done - Download stage calculates and deducts credits after pre-flight.
- [x] Done - Uploaded files download from Supabase Storage path instead of public URLs.
- [x] Done - Worker startup refuses to run when FFmpeg/ffprobe are missing.
- [x] Done - FFmpeg and ffprobe are installed and available on PATH.
- [ ] Not verified - Live YouTube/Twitter/upload download tests have not run locally.
- [ ] Not verified - Credit deduction/refund has not been verified against a live Supabase project.

## Isolated Local Dev Route

- [x] Done - Public Vite route exists at `http://localhost:5173/video-engine`.
- [x] Done - Route is outside the protected `/app` shell.
- [x] Done - Route is lazy-loaded and not added to the main app navigation.
- [x] Done - Worker `/health` check is safe and does not expose secrets.
- [x] Done - Worker CORS allows local Vite origins for public health checks.

## Stage 4 - Mock-First Transcription

- [x] Done - `replicate==0.34.1` added to worker requirements for later real mode.
- [x] Done - `compress_audio_for_upload()` added to FFmpeg utilities.
- [x] Done - `utils/transcript_parser.py` created as the Stage 4 to Stage 5 transcript contract.
- [x] Done - `stages/transcribe.py` replaced with mock-first transcription.
- [x] Done - Mock mode returns raw transcript, phrase segments, word-level timestamps, speakers, language, and parsed transcript data.
- [x] Done - Real Replicate mode is guarded by `WORKER_USE_MOCK_REPLICATE=false`.
- [x] Done - Real mode validates API token and model version before making a paid call.
- [x] Done - Real mode imports Replicate lazily so mock mode does not depend on live service setup.
- [ ] Deferred - Real Replicate token and model hash are not required until final MVP/proof-of-concept validation.
- [ ] Not verified - Real Replicate transcription has not been tested and should remain disabled for now.

## Stage 5 - Mock-First LLM Scoring Engine

- [x] Done - `anthropic==0.34.2` and `tiktoken==0.7.0` added to worker requirements.
- [x] Done - Anthropic client wrapper exists in `video-worker/utils/llm_client.py`.
- [x] Done - Token estimation and transcript chunking utilities exist.
- [x] Done - Clip JSON parser, schema validation, score filtering, overlap dedupe, and final cap exist in `video-worker/utils/clip_selector.py`.
- [x] Done - `video-worker/stages/analyze.py` replaced with Stage 5 implementation.
- [x] Done - Virality scoring system prompt exists with hook, content, and quotability scoring dimensions.
- [x] Done - Malformed LLM JSON triggers one corrective retry before raising `AnalysisError`.
- [x] Done - Mock Anthropic mode is default through `WORKER_USE_MOCK_ANTHROPIC=true`.
- [x] Done - Real Anthropic mode validates package install and API key before making paid calls.
- [x] Done - Final returned clips are compatible with `save_clips()`.
- [ ] Deferred - Real Anthropic key is not required until final MVP/proof-of-concept validation.
- [ ] Deferred - Prompt quality testing against real videos is still required before paid mode.
- [ ] Not verified - Live Claude API calls have not been run.

## Stage 6 - Rendering, Captions, Reframing, And Upload

- [x] Done - `opencv-python-headless==4.10.0.84` and `numpy==1.26.4` added to worker requirements.
- [x] Done - Caption generator creates ASS subtitles from word-level transcript segments.
- [x] Done - Caption timestamps are relative to clip start.
- [x] Done - Captions use 75pt white text, black outline, bottom-center alignment, and 150px bottom margin.
- [x] Done - Video reframer calculates static 9:16 crop coordinates with face-detection fallback.
- [x] Done - Reframer returns safe center/hardcoded fallback without raising.
- [x] Done - FFmpeg render function crops, scales to 1080x1920, optionally burns captions, normalizes audio, uses faststart, tries NVENC then libx264.
- [x] Done - Storage uploader targets private `video-clips` bucket and creates 48-hour signed URLs.
- [x] Done - Database helpers fetch clip rows and mark individual render failures.
- [x] Done - Render stage renders each clip independently.
- [x] Done - If at least one clip succeeds, render stage returns normally.
- [x] Done - If all clips fail, render stage raises `RenderError`.
- [x] Done - FFmpeg with libass support is installed and available on PATH.
- [ ] Manual required - Install Python dependencies after recreating Python 3.12 venv.
- [ ] Manual required - Confirm Supabase `video-clips` bucket exists and file-size limit can accept rendered clips.
- [ ] Not verified - Live FFmpeg render has not been run.
- [ ] Not verified - Supabase Storage upload and signed URL access have not been tested.

## Stage 7 - Next.js API Layer

- [x] Done - `stripe` and `zod` are installed and listed in `package.json`.
- [x] Done - Supabase service-role admin client added at `src/lib/video-engine/supabase-admin.ts`.
- [x] Done - Protected route auth helper added at `src/lib/video-engine/auth-helpers.ts`.
- [x] Done - Worker webhook client added at `src/lib/video-engine/worker-client.ts`.
- [x] Done - Database-backed submission rate limiter added at `src/lib/video-engine/rate-limiter.ts`.
- [x] Done - Credit package definitions added at `src/lib/video-engine/credit-packages.ts`.
- [x] Done - `POST /api/video/submit` route added under `src/app/api/video/submit`.
- [x] Done - `GET /api/video/jobs` route added under `src/app/api/video/jobs`.
- [x] Done - `GET` and `DELETE /api/video/jobs/[id]` route added.
- [x] Done - Clip URL refresh route added under `src/app/api/video/clips/[id]/refresh-url`.
- [x] Done - Credit balance and purchase routes added under `src/app/api/credits`.
- [x] Done - Stripe webhook route added under `src/app/api/webhooks/stripe`.
- [x] Done - `.env.video-engine.template` includes worker URL and app URL entries.
- [ ] Manual required - Add `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_WEBHOOK_URL`, `VIDEO_WORKER_WEBHOOK_SECRET`, and app URL to `.env.local`.
- [ ] Deferred - Keep real Stripe payment flow disabled while `VIDEO_ENGINE_USE_MOCK_PAYMENTS=true`.
- [x] Done - Targeted TypeScript check passed for the new Stage 7 files using a temporary TypeScript compiler.
- [ ] Not verified - The repo is still Vite-based; these Next App Router routes need a Next runtime before live HTTP testing.
- [ ] Not verified - Project-level `npx tsc --noEmit` is not configured because the repo does not have local TypeScript or a `tsconfig.json`.

## Stage 8 - Frontend UI

- [x] Done - Vite/React Router pages added for video submit, jobs list, job detail, and credits dashboard.
- [x] Done - Submit form detects YouTube and Twitter/X URLs and shows inline validation.
- [x] Done - Submit form shows credit balance and insufficient-credit messaging.
- [x] Done - Job realtime hook subscribes to job and clip changes and removes the channel on unmount.
- [x] Done - Job status pipeline displays queue, download, transcription, analysis, rendering, and complete states.
- [x] Done - Pipeline active stage uses animated progress feedback and completed stages show checkmarks.
- [x] Done - Clip gallery sorts clips by overall score.
- [x] Done - Clip cards show thumbnail fallback, title, platform, duration, score, preview, download, copy caption, and failed/rendering states.
- [x] Done - Preview modal supports Escape close, outside click close, video playback, and signed URL refresh on video error.
- [x] Done - Jobs history page lists jobs, active statuses, clip counts, and delete confirmation.
- [x] Done - Credits dashboard shows balance, packages, checkout redirect behavior, success/cancel banners, and transactions.
- [x] Done - Sidebar navigation includes Videos and Credits links.
- [x] Done - Navbar shows a live credit balance pill.
- [x] Done - UI consistency guardrail passes with 0 findings.
- [x] Done - Vite production build passes.
- [ ] Manual required - Enable Supabase Realtime for `video_jobs` and `video_clips`.
- [ ] Not verified - Live API calls need the Packet 7 API runtime to be served.
- [ ] Not verified - End-to-end submit/status/render/results flow has not been run.

## Documentation System

- [x] Done - Video engine documentation folder exists.
- [x] Done - Implementation log tracks stage work, issues, and user actions.
- [x] Done - API key and mock policy document exists.
- [x] Done - Setup guide documents Python 3.12 and low-end machine testing.
- [x] Done - Stage 3 technical page exists.
- [x] Done - Stage 4 technical page exists.
- [x] Done - Stage 5 technical page exists.
- [x] Done - Stage 6 technical page exists.
- [x] Done - Stage 7 technical page exists.
- [x] Done - Stage 8 technical page exists.
- [x] Done - Build checklist, user action guide, and decision log exist.
- [ ] Ongoing - Update docs after every new stage.
