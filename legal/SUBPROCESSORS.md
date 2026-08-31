# Subprocessors

**Status: FACTUAL — derived from the codebase, not from documentation.**
Every row below carries a `file:line`-level citation to where the integration
actually lives. Verified 2026-08-25 against the repository.

This list forms part of the [Privacy Policy](PRIVACY-POLICY.md). We will update
it before adding a new subprocessor that processes personal data.

---

## Infrastructure

| Provider | Role | Personal data it receives | Evidence |
|---|---|---|---|
| **Supabase** (Ireland, `eu-west-1`) | Database, authentication, file storage, edge functions | All account, profile, workspace, content, brand kit, upload, token and ledger data | `.env.example` (`NEXT_PUBLIC_SUPABASE_URL`), [supabase/functions/](../supabase/functions/), 100 migrations in [supabase/migrations/](../supabase/migrations/) |
| **Vercel** ({{VERCEL_REGION}}) | Application hosting and edge network | IP address, user agent, request logs | [vercel.json](../vercel.json) |
| **Fly.io** (London, `lhr` — United Kingdom) | Video processing worker host | Video source media, job metadata | [video-worker/fly.toml:47](../video-worker/fly.toml#L47), [video-worker/Dockerfile](../video-worker/Dockerfile) |

## AI model providers

These receive **prompt text, brand kit content, and reference or source media**
needed to produce Output.

| Provider | Role | What it receives | Evidence |
|---|---|---|---|
| **Anthropic** (Claude) | Primary text generation — captions, plans, briefs, titles | Prompts, brand kit text, post content | [supabase/functions/_shared/llm.ts](../supabase/functions/_shared/llm.ts); `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| **Groq** | Fallback text generation | Same as above, when the primary provider fails | [supabase/functions/_shared/llm.ts](../supabase/functions/_shared/llm.ts); `GROQ_API_KEY` |
| **fal.ai** | Image generation, image editing, upscaling, video generation | Prompts, reference and uploaded images, source video | [supabase/functions/_shared/fal.service.ts](../supabase/functions/_shared/fal.service.ts), [generateImage](../supabase/functions/generateImage/index.ts), [editImage](../supabase/functions/editImage/index.ts), [generateVideo](../supabase/functions/generateVideo/index.ts), [upscaleImage](../supabase/functions/upscaleImage/index.ts) |

**Training and retention posture**, verified against each provider's published
terms on 2026-08-25:

| Provider | Trains on your inputs? | Retention |
|---|---|---|
| **Anthropic** | **No** — the Commercial Services Agreement prohibits training on API inputs and outputs | Deleted within 30 days; up to 2 years if flagged for a usage-policy violation. Zero-retention available to qualifying accounts |
| **Groq** | **No** — contractually prohibited from using inputs or outputs for training or fine-tuning | No retention of inference inputs/outputs by default; troubleshooting logs up to 30 days, opt-out available in Data Controls |
| **fal.ai** | **Unknown — its privacy policy is silent on model training** | Generated media held on fal.ai's CDN for a minimum of 7 days; controllable per request via the `X-Fal-Object-Lifecycle-Preference` header |

> **Action required before publishing.** The fal.ai position is a genuine gap, not
> a drafting one. fal.ai receives the most sensitive material in the product —
> uploaded reference images, brand assets, and source video. Either obtain written
> confirmation of their training posture and sign their
> [Data Processing Addendum](https://fal.ai/legal/data-processing-addendum), or
> leave the Privacy Policy's honest "we don't know" language in place. Do not
> replace it with an assumption.

## Publishing

| Provider | Role | What it receives | Evidence |
|---|---|---|---|
| **Zernio** | Social publishing API — connects accounts and delivers posts to platforms | Connected account authorisation, post text, media, scheduling metadata | [supabase/functions/_shared/zernio.service.ts](../supabase/functions/_shared/zernio.service.ts), [publish-post](../supabase/functions/publish-post/index.ts), [connectionService.js](../src/services/platforms/connectionService.js) |

Platforms reachable through this provider, per the caption specs the code
enforces: Facebook, Instagram, LinkedIn, Pinterest, Threads, TikTok, X, YouTube
— [src/services/platforms/platformCaptionSpecs.js](../src/services/platforms/platformCaptionSpecs.js).

## Operations

| Provider | Role | What it receives | Evidence |
|---|---|---|---|
| **Resend** | Transactional email | Email address, message content | [supabase/functions/_shared/mail.ts](../supabase/functions/_shared/mail.ts); `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |
| **Sentry** | Error monitoring and performance tracing | Stack traces, breadcrumbs, request context, user identifiers | [sentry.server.config.ts](../sentry.server.config.ts), [sentry.edge.config.ts](../sentry.edge.config.ts), [instrumentation.ts](../instrumentation.ts), [supabase/functions/_shared/sentry.ts](../supabase/functions/_shared/sentry.ts) |
| **Paystack** | Payment processing and billing | Card details (direct to processor), billing address, transaction records | **Decided, not yet integrated.** The code still carries a Stripe checkout — [src/pages/Billing/BillingPage.jsx](../src/pages/Billing/BillingPage.jsx), `STRIPE_SECRET_KEY`. See BUILD-TASKS item 7 |

## Not present

Verified absent from the codebase on 2026-08-25:

- **No analytics or product-telemetry provider.** No PostHog, Mixpanel, Google
  Analytics, `gtag`, or Plausible anywhere under [src/](../src/).
- **No advertising or marketing-attribution pixel.**
- **No session-replay tool.**
- **No CRM or customer-messaging widget.**

If any of these is added, this file and the Privacy Policy cookie section must be
updated in the same change.

## Third-party media retrieval

The video pipeline retrieves media from URLs users supply, using `yt-dlp`
— [video-worker/stages/download.py](../video-worker/stages/download.py).
This is **not** a subprocessor relationship: no personal data of ours is sent to
the source site beyond the request itself. It is a terms-of-service and copyright
exposure, addressed in Terms of Service section 8.
