# Stage 7 - Next.js API Layer

Last updated: 2026-05-10 00:28 +01:00

Stage 7 adds the server-side API contract that the Packet 8 frontend will call. It is written in Next.js App Router style under `src/app/api/...`.

## What Exists

- Supabase service-role admin client: `src/lib/video-engine/supabase-admin.ts`
- Protected route auth helper: `src/lib/video-engine/auth-helpers.ts`
- Worker webhook client: `src/lib/video-engine/worker-client.ts`
- Database-backed submission rate limiter: `src/lib/video-engine/rate-limiter.ts`
- Credit package definitions: `src/lib/video-engine/credit-packages.ts`
- Video submit route: `POST /api/video/submit`
- Jobs list route: `GET /api/video/jobs`
- Job detail and delete route: `GET` and `DELETE /api/video/jobs/[id]`
- Clip signed URL refresh route: `GET /api/video/clips/[id]/refresh-url`
- Credit balance route: `GET /api/credits/balance`
- Credit purchase route: `POST /api/credits/purchase`
- Stripe webhook route: `POST /api/webhooks/stripe`

The older `src/api/video/...` placeholder files now re-export the App Router handlers so no stale 501 placeholder remains there.

## Authentication Model

Every protected route calls `getAuthenticatedUser(request)` first. Unauthenticated requests return:

```json
{ "error": "Unauthorized", "code": "AUTH_REQUIRED" }
```

The helper accepts a Bearer token in the `Authorization` header and also tries common Supabase auth cookie formats. The current app is still Vite-based, so Packet 8 should pass the active Supabase access token explicitly when calling these API routes unless the app is migrated fully to Next SSR auth cookies.

## Paid Service Safety

Stripe is available, but payment calls are mockable:

```env
VIDEO_ENGINE_USE_MOCK_PAYMENTS=true
```

With mock payments enabled, `POST /api/credits/purchase` returns a local mock checkout URL and does not call Stripe. To use Stripe test mode later, set the mock flag to `false` and configure:

```env
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Worker Communication

The submit and delete routes call the Python worker through:

```env
WORKER_WEBHOOK_URL=http://localhost:8001
VIDEO_WORKER_WEBHOOK_SECRET=
```

Worker webhook calls are best-effort and have a 3-second timeout. A failed worker notification does not fail job creation because the worker poller can still pick up queued jobs.

## Important Limit

This repository is currently a Vite React app, not a complete Next.js app. The Stage 7 route files are scaffolded in Next App Router format, but they need a Next runtime, `next/server` types, and path alias support before they can run as HTTP API routes.

## Verification Checklist

- [x] `stripe` and `zod` resolve from `node_modules`.
- [x] Targeted TypeScript check passed for Stage 7 files.
- [x] Vite production build still passes.
- [ ] Install or enable the Next.js server runtime if this app is moving from Vite to Next.
- [ ] Confirm `SUPABASE_SERVICE_ROLE_KEY` is present only in server env.
- [ ] Confirm protected routes return `401 AUTH_REQUIRED` without a session.
- [ ] Submit a valid job and confirm a `video_jobs` row is created.
- [ ] Confirm worker notification is logged when the worker is running.
- [ ] Confirm job list/detail routes only return the authenticated user's data.
- [ ] Keep `VIDEO_ENGINE_USE_MOCK_PAYMENTS=true` until Stripe test mode is intentionally enabled.
- [ ] In real Stripe mode, verify webhook signature rejection and successful credit purchase.
