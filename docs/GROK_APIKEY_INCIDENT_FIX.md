# Grok API Key Incident Fix

## What Went Wrong

1. The generation pipeline called only the Groq endpoint (`api.groq.com`) via `src/services/groqClient.js`.
2. Your environment had a Grok/xAI key, but no valid Groq key, so every generation request failed with `401 invalid_api_key`.
3. KPI loading requested `profiles.credits_remaining` directly. On schemas where that column does not exist, Supabase returned `400` on every fetch.
4. Carousel planning edge function (`supabase/functions/generateCarouselPlan`) was Groq-only and required `GROQ_API_KEY`, so Grok-only deployments would fail there too.
5. On this machine specifically, `.env` used `VITE_GROK_API_KEY` + `VITE_LLM_PROVIDER=grok`, which routed requests to `https://api.x.ai/v1/chat/completions` and produced `400 Bad Request` with a Groq key.

## What Was Fixed

### 1) Frontend LLM provider failover
- File: `src/services/groqClient.js`
- Added provider failover logic:
  - Primary: Groq (`VITE_GROQ_API_KEY`)
  - Fallback: Grok/xAI (`VITE_GROK_API_KEY`, endpoint `https://api.x.ai/v1/chat/completions`)
- Updated all generation-related calls (`callGroqContentPlan`, `callGroqRevision`, `callGroqJSON`, `enhancePromptWithBrand`) to use the failover path.

### 2) Profiles query compatibility
- File: `src/hooks/useRealtimeKPIs.js`
- Replaced risky `select('credits, credits_remaining')` with `select('*')` for the profile row.
- KPI mapping still prefers `credits_remaining` when present and falls back to `credits`.
- This removes the recurring `400` errors on projects that do not have `credits_remaining`.

### 3) Carousel plan edge function failover
- File: `supabase/functions/generateCarouselPlan/index.ts`
- Added provider failover on the server function:
  - Uses `GROQ_API_KEY` if available
  - Falls back to `GROK_API_KEY` or `XAI_API_KEY`
- Added clear error when neither provider key exists.

## Required Integration / Setup

## IDE / Local `.env`
Set at least one key:

```env
VITE_GROK_API_KEY=your_xai_key_here
# Optional if you also want Groq
# VITE_GROQ_API_KEY=your_groq_key_here
# Optional model override
# VITE_GROK_MODEL=grok-beta
```

Restart Vite after changing env vars.

If you are using Groq only, use this shape instead:

```env
VITE_GROQ_API_KEY=your_groq_key_here
VITE_LLM_PROVIDER=groq
```

## Supabase Edge Function Secrets
If you use carousel generation (or any server-side Grok call), set one of:

```bash
supabase secrets set GROK_API_KEY=your_xai_key_here
# optional
supabase secrets set XAI_API_KEY=your_xai_key_here
# optional
supabase secrets set GROQ_API_KEY=your_groq_key_here
```

Then redeploy functions:

```bash
supabase functions deploy generateCarouselPlan
```

## Database
No mandatory migration is required for this incident fix.

Optional:
- If you want explicit remaining-credit tracking, add/maintain `profiles.credits_remaining`.
- If you do not use that column, the app now works without it.

## Verification

1. Run app with only `VITE_GROK_API_KEY` set.
2. Generate image/video from the Generate page.
3. Confirm there are no blocking `401 invalid_api_key` errors and generation proceeds.
4. Open dashboard and confirm no recurring `profiles ... 400` errors.
