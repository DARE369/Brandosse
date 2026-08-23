# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/). Versioning per
[`engineering/01-versioning.md`](engineering/01-versioning.md).

Every entry cites the audit finding or lock it closes. An entry that cannot say
what changed and why is not an entry.

---

## [Unreleased] — Completion Lockdown, Waves 0–5

Remediation of the 2026-08 launch audit ([`audit/`](audit/), 121 findings).
No new capability: everything here finishes, connects, or deletes what already
existed. See [`audit/11-lockdown-plan.md`](audit/11-lockdown-plan.md).

### Security — Fixed

- **Cross-tenant WRITES were never tested** (L6.4). The audit proved nobody can
  read another account and said in as many words that writes "were deliberately
  not tested" — but RLS SELECT and RLS UPDATE/INSERT/DELETE are different
  policies, so half the question had never been asked. Now asked: 15 of 15
  attempts refused, across `sessions`, `posts`, `generations`, `user_credits`
  and `profiles`. `scripts/security/cross-tenant-write-probe.mjs` registers two
  throwaway accounts and attacks one from the other, because a write probe run
  against real users finds out by damaging someone.
- **`job-webhook` was rejecting every callback it exists to receive** (L6.3,
  P10s-004). It is the URL handed to fal.ai when a video render is submitted;
  fal.ai has no Supabase session, so the gateway refused each one with
  `UNAUTHORIZED_NO_AUTH_HEADER` before the function ran. Videos still finished
  via the `process-jobs` poller — which the function's own header calls the
  FALLBACK — so the preferred path had never worked once and the fallback
  covering for it is why nobody noticed. There was no `supabase/config.toml` at
  all, so this setting had never been declared anywhere; there is now, and
  `edge-auth-probe.mjs` fails both ways: an unlisted function that answers is an
  exposure, a listed one that refuses is a dead integration.

- **Cross-tenant data leak on `posts` and `generations`** (P10s-001/002). Any
  authenticated user could read every row in both tables with an ordinary JWT —
  verified live at 73 foreign posts from 6 users, and 39 foreign generations.
  Root cause was an undocumented permissive policy that no migration described.
  Fixed by an allowlist sweep that drops any policy not on a known-good list.
  `20260821090000`
- **Privilege escalation via `profiles.role`** (P10s-009). A user could
  `PATCH` their own row to `role: 'admin'`, which `get_admin_role()` coalesced
  into `super_admin`, granting `can_admin_access_user()` over every user and
  reopening the leak above in one request. Write-confirmed live. Closed at both
  ends: the self-update guard is now enforced, and admin status derives only
  from `admin_roles`. `20260821120000`, `20260821140000`
- **`daily-analysis` was publicly invokable** (P10s-011). It authenticated with
  the *public* anon key and returned all 12 active user IDs to any caller.
  Now service-role only. A sweep of all 52 edge functions confirmed it was the
  only genuinely unguarded one. `20260821200000`
- **Zernio OAuth callback had no CSRF protection** (P10s-007). It derived the
  target user from an unsigned `profileId` query parameter, so an attacker could
  attach an account they control to a victim's workspace — and since
  `connected_accounts` drives the publisher, the victim's content would publish
  to the attacker's account. Identity now comes from an HMAC-signed state.
- **Live `WORKER_WEBHOOK_SECRET` was committed** (P10s-005) in
  `docs/VIDEO_LAB_COMPLETE_GUIDE.md`. Rotated and redacted.
- **Worker mock mode defaulted to ON** (P4-004). Omitting one environment
  variable produced fabricated AI output while reporting healthy. Now
  fail-closed, with startup validation that refuses to boot on a missing
  credential for an enabled stage.

### Data integrity — Fixed

- **24 records stranded in non-terminal states** (P6-003). 20 posts frozen mid
  `publishing` for up to 139 days and 4 clips mid-render for 65 — never retried,
  never failed, invisible to the user. Added `reap_stuck_records()` on a
  5-minute schedule and backfilled every stranded row. `20260821160000`
- **Timeouts on all 28 outbound provider calls** (P10q-005). `zernio.service.ts`
  — the only real publishing provider — had four calls and zero timeouts, which
  is the direct mechanism that produced the frozen posts above. Every value sits
  under the reaper threshold so a hung provider fails cleanly and retries.
- **`profiles.status` was NULL on the two oldest accounts** — including the
  administrator's — silently excluding them from every `status = 'active'`
  filter. Backfilled, with a column default. `20260822100000`

### Honesty — Fixed

- **Fabricated trend data** (P8-001). `daily-analysis` wrote two hardcoded topic
  strings across four platforms every night since 2026-03-24 (~1,200 rows, two
  distinct topics in total) into a table named `trending_topics`. Writer
  disabled; real ingestion is deferred rather than faked.
- **Accounts that cannot publish reported "Healthy"** (P6-002, P9-004). Three
  live accounts on a removed provider, plus the one working account sitting at
  `health_score = 20` with a recorded failure reason, all rendered green.
  Capability is now computed in the view so every consumer inherits it, and the
  badge has no "assume healthy" branch. `20260821220000`
- **Four calendar AI actions silently did nothing** (P2-004). "Apply week plan"
  generated a real Groq-backed plan and discarded it — dialog closed, no write,
  no error. `week_plan`, `add_draft_post` and `delete_post` now work;
  `suggest_slots` confirms honestly; unknown types warn loudly.
- **Credit cost displayed 3× the truth** (P10s-010 / L2.6). The client defaulted
  to 3 credits where the server charges 1. Now reports server truth or nothing.
- **Raw tracebacks shown to users**, under a hardcoded "Credits have been
  refunded" that was wired to no refund state — the UI asserting a financial
  fact it had no knowledge of. Errors are now explained in plain language; the
  raw text is demoted to a collapsed block.
- **A search box that could not accept input** — rendered on four routes with
  no-op default props. Now rendered only when a real handler is supplied.
- **The signup page promised 100 free credits over a database that grants 30**
  (L5.15). The number was hardcoded into three marketing surfaces; the header
  pill reads `user_credits.balance`, so a new account watched the promise break
  within seconds of arriving. The 100 came from `profiles.credits`, a column
  that gates nothing. All three now read one constant, and
  `check-credit-grant.cjs` fails the build if it and the migration's grant
  trigger ever disagree again.
- **A loading state dressed as an empty state** (L5.15). The support-ticket list
  rendered "Loading tickets" inside a dashed "nothing here" box while the fetch
  was still in flight — telling a slow connection it had no tickets, which may
  be false. Now a skeleton.
- **The credits page rendered a balance of 0 on any fetch failure** (L5.15).
  `.catch(() => {})` made a failed load visually identical to an empty account,
  on the one page whose job is telling you what you have. It now says it could
  not load, and offers a retry. The post-payment refresh had the same silent
  catch and now says the payment went through even when the refresh did not.

### Quality — Changed

- **15 of 19 empty states were dead ends** (L5.15, DoC-9). A new account is
  nothing but empty states, so these are the product's first impression: they
  said there was nothing there and left the user to work out what to do about
  it. Every one now offers a real control, or declares in code why it has none
  ("No failures" is the outcome you want). Six hand-rolled boxes in the video
  engine moved onto the shared primitive so the guard can see them at all.
  `check-empty-states.cjs`

- **Default Claude model** `claude-3-5-sonnet-latest` → `claude-sonnet-5`
  (P3-010). Same list price, current generation. With Groq failing 100% since
  ~2026-08-18, that 2024-era default was generating *all* product content.
  Provider fallback now logs `llm_provider_fallback` at error level — the
  tripwire whose absence hid the outage.
- **`generate-caption` reconnected** (P3-005). The best caption prompt in the
  repository, with anti-repetition context from the user's five most recent
  captions, was called by no UI. Caption regeneration now routes to it.
- **Revision history enabled** (P3-003). `content_versions` existed with an
  owner *read* policy but only admins could write, so "Regenerate" was a blind
  overwrite. Owners can now append revisions — INSERT only, because history a
  user can rewrite is not history. `20260822090000`

### Infrastructure — Added

- **CI itself was broken and nobody knew.** `npm ci` had been failing on Linux
  for months on `main`: `sass` and `@emnapi/core` are dependencies of
  unknown-platform FALLBACK packages (`sass-embedded-all-unknown`,
  `@tailwindcss/oxide-wasm32-wasi`), and npm on Windows never resolves those
  subtrees, so they were never written to the lock. `npm ci` on Ubuntu validates
  the entire tree and refused. A workflow that only builds, whose build is
  broken, produces exactly as much signal as no workflow — which is why it
  survived. Found only because this PR added guards whose result someone
  actually looked at. Third instance of the same pattern this release, after
  the cron-monitoring allowlist and four guard scripts failing against deleted
  files: **verification nobody watches decays to zero.**
- **CI runs checks, not just a build.** Eight guard scripts existed and executed
  nowhere; four had been failing for months against files deleted during the
  ui-v2 migration. All eight now pass and run on every PR, alongside a secret
  scanner and the OAuth state test. Live database probes run daily.
- **`scripts/security/cross-tenant-probe.mjs`** — logs in as a real non-admin
  user with the public anon key and asserts it can read nothing it does not own
  and cannot promote itself. The highest-value test in the repository.
- **`scripts/security/stuck-records-probe.mjs`**, **`secret-scan.mjs`**,
  **`oauth-state.test.mjs`**.
- **`tests/e2e/time-to-first-value.spec.js`** — registers a genuinely new
  account on every run and walks the path a stranger walks: signup → onboarding
  wizard → Studio → a real generated post, asserting the whole thing lands under
  five minutes (measured: 93–99s). Every other test in the suite signs in as an
  account that already has data, so none of them can see what a new user sees.
  It also asserts the wizard actually intercepts a new signup — 209 lines that
  render for nobody if the redirect ever moves — and that the prompt typed in
  the wizard survives the handoff into Studio. Test accounts are deleted
  afterwards, walking the foreign-key chain by hand because deleting a user with
  content is refused outright (see horizon register H13).
- **`scripts/check-empty-states.cjs`** and **`scripts/check-credit-grant.cjs`**,
  both wired into CI. Each was verified by breaking the code deliberately and
  confirming it failed — a guard that has never failed has not been tested.
- **CI had never run the e2e suite at all** (L6.2). Nineteen Playwright tests
  existed; the workflow ran guard scripts and a build and nothing else. That is
  why four of them could fail for months against markup deleted in the ui-v2
  migration without anyone knowing. An `e2e` job now runs the suite on the daily
  schedule — scheduled rather than per-PR, because the first-run tests register
  real accounts against production, which is the only way to see what a new user
  sees. Recorded result on 2026-08-22: **15 passed, 4 skipped, 0 failed**;
  11/11 offline guards and 4/4 live probes pass.
- **`tests/e2e/persona-walkthroughs.spec.js`** (L6.1) — D4's two persona
  acceptance tests, which had only ever been assessed by reading code. The Power
  Migrant one may not call `page.goto()` after sign-in: every surface must be
  reached by CLICKING. Every other test navigates by URL, which is the automated
  equivalent of the address bar — so a route reachable only that way passes all
  of them while being invisible to a person. That is finding P9-002 exactly, and
  it was verified by adding a surface with no nav control and confirming the test
  named it.
- **Four e2e tests repointed** after months of silent failure. They targeted
  `.bd-kpi-card`, `.studio-bar__textarea` and `.sidebar-logout-btn`, classes
  that exist in zero files since the ui-v2 migration. Now written against roles
  and text, and the dashboard test asserts each of the seven nav labels by name
  — which is what would have caught the drift L5.7 fixed. Fourth instance of
  **verification nobody watches decays to zero.**
- **`engineering/`** — versioning, agentic code review, documentation, and
  production-readiness standards, loaded into every session via `CLAUDE.md`.

### Removed

- `src/app/**` and `src/api/**` — 17 files, an unroutable duplicate of the App
  Router tree including a dead Stripe webhook, still type-checked so it looked
  maintained.
- `video-worker/utils/{clip_selector,llm_client,transcript_parser,video_reframer}.py`
  — 1,015 lines imported by nothing. `llm_client.py` returned hardcoded scores.
- `src/legacy/supabase.js`, the empty `src/pages/CalendarPage/` tree, and stale
  bytecode.

### Observability — Added

- **Sentry instrumentation** (L0.4). Next.js server, client, edge runtime, and
  React render errors (`app/global-error.tsx` — those never reach
  `onRequestError`, so a white-screening user was invisible). Configured for
  low noise and no content leakage: errors at 100%, traces at 5%,
  `sendDefaultPii` off with a header/body scrubber, no session replay, and a
  tunnel route so ad blockers cannot silently drop reports.
- **Edge-function reporting** via a dependency-free `_shared/sentry.ts`. The
  Next.js SDK does not cover Supabase Edge Functions, so the
  `llm_provider_fallback` tripwire — the single alert most likely to have caught
  the Groq outage — was writing to a console nobody reads. It now reports.
  Hand-rolled rather than pulling the SDK into 51 separately-bundled Deno
  functions; it never throws, never blocks, and is bounded at 5s.
- Verified by planting two deliberate failures, both ingested HTTP 200. Per the
  lockdown's demonstration rule, a lock is not closed until a planted failure is
  actually caught.

### Known gaps

- **The Python worker is not instrumented.** Deferred to Wave 7 with the Fly
  migration, since it cannot boot today regardless (missing `WORKER_GROQ_API_KEY`).
- **Edge functions are not deployed** except `daily-analysis`, and have not been
  type-checked by Deno.
- Wave 5 has 14 items remaining, including real multi-platform publishing
  (L5.1), which four pillars depend on.
