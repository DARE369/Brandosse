# Video Engine Decision Log

Last updated: 2026-05-10 00:28 +01:00

This captures decisions that affect future implementation.

## 2026-05-09 - Paid Services Stay Mocked Until MVP Proof

Replicate, Anthropic, and payment providers are treated as paid or metered services. Setting an API key is not enough to trigger a live call. Each service must also have its mock flag disabled intentionally.

Default worker flags:

```env
WORKER_USE_MOCK_REPLICATE=true
WORKER_USE_MOCK_ANTHROPIC=true
```

## 2026-05-09 - Stage 4 Uses Mock-First Transcription

Stage 4 now owns the WhisperX-style transcript contract but does not call Replicate by default. This lets the pipeline continue to Stage 5 and Stage 6 stubs without spending money.

The real Replicate path remains in code but is guarded by:

- `WORKER_USE_MOCK_REPLICATE=false`
- valid `WORKER_REPLICATE_API_TOKEN`
- verified `WHISPERX_MODEL_VERSION`

## 2026-05-09 - Stage 5 Uses Mock-First LLM Scoring

Stage 5 implements the real scoring architecture, prompt, JSON parser, chunking, and clip selector. Anthropic calls remain mocked until the final MVP/proof-of-concept stage.

Real scoring requires:

- `WORKER_USE_MOCK_ANTHROPIC=false`
- valid `WORKER_ANTHROPIC_API_KEY`
- real-video prompt quality testing before production use

The scoring prompt is treated as product code. Changes must be tested against real content before paid mode is trusted.

## 2026-05-09 - Stage 6 Uses Per-Clip Render Resilience

Rendering is allowed to partially succeed. A failed clip marks only that clip as failed and does not abort the rest of the job. The render stage raises only when every clip fails.

This is a user-experience decision: receiving six working clips is better than receiving none because one clip failed.

## 2026-05-09 - Stage 6 Uses Static Crop For MVP

The reframer samples frames and calculates one crop position for the whole clip. Per-frame dynamic tracking is deferred because it adds render complexity and CPU cost.

## 2026-05-10 - Stage 7 API Is Auth-First And Best-Effort Worker Notify

Every protected API route authenticates before reading request bodies or touching database state. Worker webhook calls are best-effort with a short timeout, so a temporary worker outage does not prevent job creation.

## 2026-05-10 - Stripe Stays Mockable

The credit purchase route supports real Stripe Checkout, but `VIDEO_ENGINE_USE_MOCK_PAYMENTS=true` keeps paid payment flows disabled during MVP buildout.

## 2026-05-10 - API Layer Needs A Next Runtime

Packet 7 route files are implemented in Next.js App Router format under `src/app/api`. The current project still runs Vite. Running these routes in development requires either migrating this app to Next.js or adding an equivalent server/runtime layer.

## 2026-05-09 - Python 3.12 Is The Worker Runtime

The pinned dependency stack fails under Python 3.14 because `pydantic-core==2.20.1` attempts a Rust build that does not support that interpreter version. Use Python 3.12 for the worker venv.

## 2026-05-09 - Local Preview Route Stays Isolated

The video engine lab lives at `/video-engine` on the Vite dev server. It is public, lazy-loaded, and not included in main navigation. It is a development dashboard, not a customer-facing production feature.

## 2026-05-09 - Documentation Set Is Practical, Not Exhaustive

The uploaded software documentation research highlights many documentation categories. For this staged build, the required set is:

- overview and setup guide
- build checklist
- implementation log
- user/manual actions
- decision log
- stage-specific technical notes
- mock/API key policy

Full compliance, deployment, rollback, and support documentation will be expanded closer to production launch.
