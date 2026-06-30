# Environment And Secrets Organization

This project uses three local env locations:

- `.env.local`: local Next.js app values. This includes browser-safe `NEXT_PUBLIC_*` values and server-only API route secrets.
- `.env`: local tooling only, currently `DATABASE_URL`.
- `video-worker/.env`: Python video worker secrets and runtime flags.

Only variables prefixed with `NEXT_PUBLIC_` are bundled for the browser. Do not add provider API keys, service-role keys, webhook secrets, database URLs, or admin passwords with a `NEXT_PUBLIC_` prefix.

## Browser-Safe

These are allowed in frontend code:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_ENABLE_PROMPT_SUGGESTIONS_EDGE_IN_DEV`
- `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLIC_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

## Next.js Server-Only

Keep these in `.env.local` and read them only from API routes or server-only modules:

- `SUPABASE_SERVICE_ROLE_KEY`
- `GROQ_API_KEY`
- `GROK_API_KEY`
- `XAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `REPLICATE_API_TOKEN`
- `FREEPIK_API_KEY`
- `RESEND_API_KEY`
- `CRON_SECRET`
- `VIDEO_WORKER_WEBHOOK_SECRET`
- `WORKER_WEBHOOK_URL`
- `PAYSTACK_SECRET_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PRICE_MANAGEMENT_PASSWORD`

## Worker-Only

Keep these in `video-worker/.env`:

- `WORKER_SUPABASE_URL`
- `WORKER_SUPABASE_SERVICE_KEY`
- `WORKER_WEBHOOK_SECRET`
- `WORKER_ANTHROPIC_API_KEY`
- `WORKER_REPLICATE_API_TOKEN`
- `WORKER_USE_MOCK_ANTHROPIC`
- `WORKER_USE_MOCK_REPLICATE`

## Checks

Run these before committing env-related changes:

```bash
npm run check:env-security
npm run check:production-workflow
```

`check:env-security` fails if active app code reads server-only secrets from client/shared paths or reintroduces legacy `VITE_*` env usage.
