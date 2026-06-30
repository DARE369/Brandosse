# Freepik + Supabase Integration Setup Guide

This project now uses Freepik through Supabase Edge Functions for:
- image generation (`generateImage`)
- image editing (`editImage`)
- video generation (`generateVideo`)
- video polling/status (`videoStatus`)

It also includes:
- async video processing modal + minimized status bar UI
- edit-mode input panel
- brand asset upload progress bars
- storage bucket migration to fix `bucket not found`

## Directory Mapping

Requested structure is implemented with Supabase conventions:
- frontend service layer: `src/services/freepik.service.js` (client-to-edge calls)
- edge function entrypoints:
  - `supabase/functions/generateImage/index.ts`
  - `supabase/functions/editImage/index.ts`
  - `supabase/functions/generateVideo/index.ts`
  - `supabase/functions/videoStatus/index.ts`
- shared edge modules:
  - `supabase/functions/_shared/freepik.service.ts`
  - `supabase/functions/_shared/storage.ts`

## 1. Required Secrets

Run these from the project root after linking Supabase CLI to your project:

```bash
supabase secrets set FREEPIK_API_KEY="your_api_key"
supabase secrets set MYGROK_KEY="your_api_key"
```

Notes:
- Edge functions read env vars using runtime env resolution (`process.env` fallback + `Deno.env`).
- `MYGROK_KEY` is provisioned for optional prompt-enrichment workflows.

## 2. Apply Database + Storage Migrations

This repo includes:
- `supabase/migrations/20260220041938_brand_kit.sql`
- `supabase/migrations/20260222013000_storage_buckets_and_policies.sql`

Apply migrations:

```bash
supabase db push
```

What the storage migration does:
- creates/updates `brand_assets` bucket (private)
- creates/updates `generated_assets` bucket (public)
- adds per-user storage object policies for both buckets
- fixes the Brand Kit uploader `bucket not found` issue

## 3. Deploy Edge Functions

Deploy all required functions:

```bash
supabase functions deploy generateImage
supabase functions deploy editImage
supabase functions deploy generateVideo
supabase functions deploy videoStatus
```

If you want one command:

```bash
supabase functions deploy generateImage editImage generateVideo videoStatus
```

## 4. Frontend Environment

Frontend must use only anon credentials:

`.env`
```bash
VITE_SUPABASE_URL="https://<your-project-ref>.supabase.co"
VITE_SUPABASE_ANON_KEY="<your-anon-key>"
```

No service-role key should exist in frontend env.

## 5. New/Updated Code Paths

Backend:
- `supabase/functions/generateImage/index.ts`
- `supabase/functions/editImage/index.ts`
- `supabase/functions/generateVideo/index.ts`
- `supabase/functions/videoStatus/index.ts`
- `supabase/functions/_shared/freepik.service.ts`
- `supabase/functions/_shared/storage.ts`

Frontend:
- `src/services/freepik.service.js`
- `src/stores/SessionStore.js`
- `src/components/Generate/ImageEditPanel.jsx`
- `src/components/Generate/VideoProcessingModal.jsx`
- `src/components/Generate/GenerationCanvas.jsx`
- `src/pages/GeneratePage/GeneratePageV2.jsx`
- `src/components/Generate/BatchGenerationGrid.jsx`
- `src/components/BrandKit/AssetUploader.jsx`
- `src/stores/BrandKitStore.js`
- `src/styles/GenerateV2.css`
- `src/styles/BrandKit.css`

## 6. How the Flows Work

### Image Generation
1. Frontend sends prompt + optional brand kit to `generateImage`.
2. Function creates Freepik task, polls to completion, uploads to `generated_assets`.
3. Function returns Supabase public URL.

### Image Edit
1. User enters Edit mode and picks source image.
2. Source image is uploaded to `generated_assets`.
3. Frontend sends instruction + source image URL to `editImage`.
4. Function runs Freepik edit task, uploads result to `generated_assets`, returns URL.

### Video Generation (Async)
1. Frontend calls `generateVideo`, receives `jobId`.
2. Frontend creates a processing generation row and opens processing modal.
3. Frontend polls `videoStatus` with `jobId` (+ generation id).
4. When Freepik completes, `videoStatus` uploads video to `generated_assets`, updates generation row, returns final public URL.
5. UI modal transitions to completed state and video becomes available in canvas.

## 7. Upload Progress Bar (Brand Kit Assets)

Brand Kit uploads now use direct Storage REST upload with progress events.
- You get per-file progress percentage.
- Errors are surfaced inline.
- `bucket not found` is mapped to a clear setup error.

## 8. Smoke Test Checklist

1. Brand Kit > Assets upload starts and progress bars move from 0% to 100%.
2. No `bucket not found` errors during Brand Kit upload.
3. Generate Image returns completed image cards from Freepik.
4. Edit mode appears in Generate UI and can produce edited image result.
5. Video generation opens modal immediately after submit.
6. Modal updates progress while polling and resolves to completed/failed.
7. Completed video appears in generation grid and can be opened in post-production.

## 9. Troubleshooting

### `Missing FREEPIK_API_KEY`
- Run `supabase secrets set FREEPIK_API_KEY="..."` and redeploy functions.

### `Unauthorized` from Edge Function
- Ensure user is logged in and frontend sends Supabase auth session.

### `Storage bucket ... not found`
- Run `supabase db push` so `20260222013000_storage_buckets_and_policies.sql` is applied.

### Video stuck in processing
- Check function logs:
```bash
supabase functions logs videoStatus
```
- Verify Freepik job id exists in generation metadata (`freepik_job_id`).

### Rate-limit / quota issues
- UI now surfaces quota-specific toast messaging for Freepik responses (including HTTP 429).
