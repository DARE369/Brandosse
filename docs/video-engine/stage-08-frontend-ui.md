# Stage 8 - Frontend UI

Last updated: 2026-05-10 13:32 +01:00

Stage 8 adds the user-facing video engine experience: submit form, live status, results gallery, downloads, job history, and credits dashboard.

## Runtime Adaptation

The packet described a Next.js App Router frontend. This repository currently runs Vite + React Router, so the implementation uses the existing authenticated app shell.

Implemented routes:

- `/app/video/new`
- `/app/video/jobs`
- `/app/video/jobs/:id`
- `/app/billing/credits`

The isolated public lab route remains:

- `/video-engine`

## What Exists

- `src/hooks/video-engine/useJobRealtime.js`
- `src/hooks/video-engine/useClipDownload.js`
- `src/services/videoEngineApi.js`
- `src/services/videoEngineData.js`
- `src/components/video-engine/SubmitForm.jsx`
- `src/components/video-engine/JobStatusPipeline.jsx`
- `src/components/video-engine/ClipsGallery.jsx`
- `src/components/video-engine/ClipCard.jsx`
- `src/components/video-engine/ClipPreviewModal.jsx`
- `src/components/video-engine/JobsList.jsx`
- `src/components/video-engine/JobCard.jsx`
- `src/components/video-engine/CreditDashboard.jsx`
- `src/components/video-engine/CreditPackageCard.jsx`
- `src/components/video-engine/videoEngine.css`
- Vite pages under `src/pages/VideoEngine/`

Navigation now includes:

- sidebar Videos link
- sidebar Credits link
- navbar credit balance pill

## Realtime Behavior

`useJobRealtime()` subscribes to:

- `video_jobs` updates filtered by job id
- `video_clips` inserts filtered by job id
- `video_clips` updates filtered by job id

Supabase Realtime must be manually enabled for `video_jobs` and `video_clips` in the Supabase dashboard.

## API Behavior

Frontend API calls use `videoEngineFetch()`, which attaches the current Supabase access token as a Bearer token. This matches the Packet 7 auth helper.

Routes called by the UI:

- `POST /api/video/submit`
- `DELETE /api/video/jobs/:id`
- `GET /api/video/clips/:id/refresh-url`
- `GET /api/credits/balance`
- `POST /api/credits/purchase`

Important: the repo still needs a runtime that actually serves the Packet 7 API routes. Until then, these calls are correctly wired but cannot complete in Vite-only dev mode.

## Verification

- `npm run build` passed.
- `npm run check:status-literals` passed.
- `npm run check:ui-consistency` passed with 0 findings.

## Manual Checks Remaining

- Enable Supabase Realtime on `video_jobs`.
- Enable Supabase Realtime on `video_clips`.
- Run the Python worker after Python 3.12 setup.
- Serve the Packet 7 API routes through Next.js or an equivalent server layer.
- Submit a real job and verify live stage updates.
- Verify clip preview, refresh URL, download, and copy-caption behavior with rendered clips.
- Keep `VIDEO_ENGINE_USE_MOCK_PAYMENTS=true` until Stripe test payments are intentionally enabled.
