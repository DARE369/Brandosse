# API Keys And Mock Policy

Last updated: 2026-05-10 00:28 +01:00

## Free Tools Used So Far

Stage 3 does not need paid API calls.

- FFmpeg and ffprobe: free open-source system tools.
- yt-dlp: free open-source Python package, installed from `requirements.txt`.
- YouTube/Twitter/X download support: handled by yt-dlp, no official platform API key is required for this stage.
- The Replicate Python package is free to install, but live Replicate usage is paid or metered.
- The Anthropic Python package and token estimator are free to install, but live Claude API usage is paid or metered.
- OpenCV and NumPy are free local packages used for Stage 6 face-aware reframing.
- Stage 6 rendering uses local FFmpeg and Supabase Storage. Supabase itself may count storage/bandwidth against your plan, but no separate rendering API key is needed.
- Stage 7 API routes use the Supabase service role key server-side and local worker webhooks. Stripe can remain mocked.

## Paid Or Metered Services

These services may cost money or affect live payment flows:

- Anthropic API: used later for LLM scoring.
- Replicate API: used later for WhisperX transcription.
- Stripe or Paystack: payment providers; use sandbox/mock behavior until intentionally enabled.
- Supabase: the package is free, but project usage may count against your Supabase plan.

## Mock Mode Defaults

Paid services should be configured but mocked by default until the stage explicitly needs real calls.

Worker env:

```env
WORKER_USE_MOCK_ANTHROPIC=true
WORKER_USE_MOCK_REPLICATE=true
```

App-side template env:

```env
VIDEO_ENGINE_USE_MOCK_ANTHROPIC=true
VIDEO_ENGINE_USE_MOCK_REPLICATE=true
VIDEO_ENGINE_USE_MOCK_PAYMENTS=true
```

Future stages should check these flags before calling paid APIs. Setting a real API key must not be enough by itself to make paid calls.

## Current Stage 3 Behavior

Stage 3 uses real local download and audio extraction behavior because those tools are free and are the point of this stage. It does not call Anthropic, Replicate, Stripe, or Paystack.

## Current Stage 4 Behavior

Stage 4 is mock-first. It produces a realistic WhisperX-style transcript contract but does not call Replicate while:

```env
WORKER_USE_MOCK_REPLICATE=true
```

Real Replicate mode is deferred until final MVP/proof-of-concept validation. To enable it later, set `WORKER_USE_MOCK_REPLICATE=false`, add `WORKER_REPLICATE_API_TOKEN`, and replace the WhisperX model version placeholder in `video-worker/stages/transcribe.py`.

## Current Stage 5 Behavior

Stage 5 is mock-first. It runs the full analysis pipeline with deterministic Claude-style JSON while:

```env
WORKER_USE_MOCK_ANTHROPIC=true
```

Real Anthropic mode is deferred until final MVP/proof-of-concept validation. To enable it later, set `WORKER_USE_MOCK_ANTHROPIC=false` and add `WORKER_ANTHROPIC_API_KEY`.

The code must not treat the presence of an API key alone as permission to spend money.

## Current Stage 6 Behavior

Stage 6 uses local rendering tools and Supabase Storage. It does not call Replicate, Anthropic, Stripe, or another paid AI service.

Required secrets are still worker-only:

```env
WORKER_SUPABASE_URL=
WORKER_SUPABASE_SERVICE_KEY=
```

The Supabase service role key must never be exposed to the browser.

## Current Stage 7 Behavior

The API layer is implemented in Next App Router style. Protected routes require an authenticated Supabase user and server-side access to:

```env
SUPABASE_SERVICE_ROLE_KEY=
WORKER_WEBHOOK_URL=http://localhost:8001
VIDEO_WORKER_WEBHOOK_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Stripe payments stay mockable:

```env
VIDEO_ENGINE_USE_MOCK_PAYMENTS=true
```

When this flag is true, the purchase route does not call Stripe. To test real Stripe sandbox payments later, set it to `false` and add:

```env
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
```
