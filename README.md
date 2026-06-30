# Social Media Agent

Next.js + Supabase application for AI-assisted social content generation, review, scheduling, connected accounts, and publishing workflows.

## Stack

- Next.js 16 / React 18
- Supabase Auth, Postgres, Storage, Realtime, and Edge Functions
- Playwright for route-level E2E checks
- CSS token-based design system in `src/styles/tokens.css` and `src/styles/design-system.css`

## Quickstart

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy environment values from `.env.example` into your local `.env.local`.
3. Start the Next dev server:
   ```bash
   npm run dev
   ```

## Verification

Run these before handing off production-facing changes:

```bash
npm run build
npm run check:production-ready
npm run test:e2e:chromium
```

`npm run smoke:routes` expects a running local server. The Playwright wrapper starts one automatically for the E2E route checks.

Authenticated Playwright journeys run only when the `E2E_*` variables in `.env.example` are configured. Use `npm run check:e2e-env` to see which flows are enabled, or `E2E_REQUIRE_AUTH=1 npm run check:e2e-env` in CI to require full authenticated coverage.

## Supabase

Supabase Edge Functions live in `supabase/functions`. Deploy them with the Supabase CLI after validating required environment variables and platform credentials.

Local function type-checking requires Deno. If Deno is not installed, validate with the Supabase CLI/runtime environment before deployment.

Run `npm run check:edge-functions` before deployment to catch missing local imports and undocumented edge-function environment variables.

## Notes

Real platform OAuth and publishing require the relevant platform app credentials plus Supabase service-role configuration. When credentials are missing, the settings flow can fall back to demo/mock connected accounts.
