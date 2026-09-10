# TikTok Direct Post + OAuth token refresh — session record, 2026-09-09

> **Status: shipped to `main` and deployed.** Merged as PR #4 (`90759fe`).
> This is a dated record of one session, not a living spec. Where it disagrees
> with code, the code wins — see Law 2 in `CLAUDE.md`.

Written as a handoff so the next session (YouTube integration) starts with the
context this one ended with. Section 13 is the part that matters most for
YouTube specifically.

---

## 1. What this session set out to do, and what it actually found

The stated goal was to finish TikTok publishing: build the Direct Post adapter,
wire it to the composer, then add token refresh.

The adapter was the easy part. Most of the session went on defects that were
already in the tree and that nothing was catching — each one silent, and each
one sitting directly on the path the TikTok feature needed. They are listed in
section 4 because they are the reusable lesson, not a footnote.

**The single most important fact for anyone picking this up:** the code is
complete and deployed, but **no TikTok account has ever been connected and no
video has ever been posted through it**. Everything green so far is static
analysis plus one live credential check. See section 8.

---

## 2. State at end of session

| Thing | State |
|---|---|
| PR #4 | Merged to `main` (`90759fe`) |
| Vercel production | Deployed, `success`, serving the merge commit |
| Canonical domain | `https://www.brandosse.com` (apex 308-redirects to `www`) |
| `refresh-social-tokens` edge function | Deployed (returns 401 to unauthorised callers) |
| Cron `refresh-social-tokens` | Registered by migration, runs `*/30 * * * *` |
| Static guards | 44/44 pass locally; CI `Guard scripts` green |
| `tsc --noEmit` | Clean |
| Deno type check (CI) | Fails — **pre-existing**, identical 75 errors on `main` and branch |
| First live TikTok connect | **Not done** |
| First live TikTok post | **Not done** |
| Service-role key mismatch | **Open**, deliberately parked (section 10) |

---

## 3. What shipped

Ten commits, merged as PR #4.

```
ced2afd fix(oauth): make a service-role key mismatch diagnosable, not a bare 401
4a67efd fix(oauth): a missing secret must not expire the user's account
c83d667 test(tiktok): preflight for the first live Direct Post
9773eef feat(oauth): refresh stored access tokens before they expire
441fd12 fix(tiktok): merge into workflow_state instead of replacing it
6c1ef98 docs: repoint the visual-QA agent at the real Playwright harness
8e9874b fix(guards): green the two checks the TikTok work left red
b8f5485 feat(tiktok): wire the Direct Post panel into the composer
926f041 feat(tiktok): Direct Post publish adapter and connect flow
```

New files:

- `supabase/functions/_shared/tiktok.service.ts` — the Direct Post adapter
- `supabase/functions/refresh-social-tokens/index.ts` — the refresh worker
- `supabase/migrations/20260909120000_register_social_token_refresh_cron.sql`
- `scripts/check-oauth-provider-parity.cjs` — new CI guard
- `scripts/smoke-tiktok-publish.mjs` — operator-run preflight

Modified: `supabase/functions/publish-post/index.ts` (provider dispatch),
`src/stores/SessionStore.js` (settings persistence),
`src/components/Generate/PostProductionPanel.jsx` (panel mount),
`app/api/auth/social/[provider]/callback/route.js` (the `client_key` fix),
`scripts/check-outbound-fetch-guard.cjs`, `scripts/check-app-shell.cjs`,
`.github/workflows/ci.yml`.

---

## 4. Defects found and fixed

All five were pre-existing or self-inflicted-and-caught. None had a failing
test or guard before this session.

### 4.1 TikTok could not be connected at all — `client_key` vs `client_id`

**The most consequential one.** TikTok names its client credential `client_key`,
not `client_id`, on *both* the authorize and token endpoints.
`app/api/_lib/socialProviders.js` records this as `clientIdParam` and carries a
comment warning that getting it wrong "yields an opaque error that reads like a
bad secret".

The connect route honoured it. The callback route hardcoded `client_id` and
ignored it. So TikTok cleared the consent screen and then failed **every** token
exchange, with an error blaming the secret.

Consequence: no TikTok account could ever be connected, which meant the entire
publish path was untestable, and nothing failed loudly enough for anyone to
notice. Fixed in `9773eef`; now guarded.

### 4.2 `workflow_state` was being replaced, not merged

The TikTok settings write assigned a bare `{ tiktok }` object to
`posts.workflow_state`. That column is shared: approval routing
(`approval_status`, `approval_route`, `approval_workflow_id`) and publish
accounting (`publish.platform_post_url`, `publish.retry_count`) all live in it.

Scheduling a TikTok post therefore destroyed all of it, silently. Every other
writer of that column already did read-modify-write; this one, the newest, did
not. Fixed in `441fd12` (`src/stores/SessionStore.js`).

### 4.3 A missing secret would have expired users' accounts

Self-inflicted, caught before it could bite. `readEnv()` throws on a missing
variable, and the TikTok credentials are read lazily *inside* the per-row try
block of the refresh worker. Deploy the function before setting the secrets and
every row throws, is caught as an **account-level** refresh failure, and
increments `refresh_failures`. Three runs — 90 minutes — and live accounts get
marked `expired`, telling users to reconnect a working connection because of a
server-side variable. Reconnecting would not have helped.

Fix (`4a67efd`): `providerConfigured()` is checked **before** the row is
claimed. A misconfigured deploy now leaves the queue exactly as it found it, and
reports `misconfigured: [...]` with `ok: false` rather than looking like a quiet
successful run.

### 4.4 Two CI guards were red on `main`

Both introduced by the earlier TikTok PR, both merged red:

- `check-app-shell` — the dev preview route `app/app/dev/tiktok-panel/page.jsx`
  renders no `<AppShell>`. Registered in `NO_CHROME_ROUTES` with a reason.
- `check-doc-citations` — the D5 row in `FUNCTIONAL-SPECIFICATION-PUBLISHING.md`
  cited a path **in order to say it does not exist**, which the guard reads as
  the opposite claim. Unbackticked with a note.

### 4.5 A live agent definition was entirely stale

Found while clearing 4.4, and worse than doc rot:
`.claude/agents/frontend-visual-qa.md` is an **active agent**, and every
operational detail in its procedure was wrong — a deleted screenshot script,
env vars defined nowhere in the repo, the wrong port, and a gone output
directory. Any invocation would have failed at step 1 with no fallback.

Repointed at what exists: `playwright.config.cjs`, its `chromium` /
`mobile-chrome` projects, `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`, and the
`signIn()` helper in `tests/e2e/persona-walkthroughs.spec.js`.

---

## 5. TikTok API contract — the non-obvious parts

Verified against TikTok's published docs during this session. These are the
things that cost time, and the reasons the adapter looks the way it does.

### 5.1 `total_chunk_count` is a FLOOR, not a ceil

```
total_chunk_count = floor(video_size / chunk_size)
```

The final chunk absorbs the remainder and may exceed `chunk_size` (up to 128MB).
A natural `Math.ceil` produces a count one higher than TikTok expects, and the
upload dies partway through with an error that points at the bytes rather than
the arithmetic. Example: 12MB with a 5MB chunk is **2** chunks (last one 7MB),
not 3.

Chunk bounds: min 5MB, max 64MB, final chunk up to 128MB, max 1000 chunks,
max file 4GB. Videos under 5MB upload whole.

### 5.2 A finished upload is not a published post

TikTok processes asynchronously and can reject a video **after** accepting every
byte. The adapter polls `POST /v2/post/publish/status/fetch/` and only reports
success on `PUBLISH_COMPLETE`. Returning success at upload time would mark posts
published that never appeared.

The poll is bounded at roughly two minutes. Timing out is deliberately **not**
retriable: the upload succeeded, TikTok may still publish it, so an automatic
retry risks a double post. It asks the user to check their profile instead.

### 5.3 `FILE_UPLOAD`, not `PULL_FROM_URL`

`PULL_FROM_URL` requires media on a TikTok-verified domain and rejects
pre-signed URLs from unverified hosts before the download starts. Our media is
in Supabase storage, so `FILE_UPLOAD` is the only workable option.

**Note for later:** TikTok photo posts support `PULL_FROM_URL` **only**. Photo
carousels will need domain verification. The adapter is video-only for that
reason.

### 5.4 `privacy_level` has no default, on purpose

TikTok's guidelines require the user to choose it. If the setting is absent the
adapter refuses to publish rather than inventing a visibility the user never
agreed to. `src/components/Publishing/TikTokOptionsPanel.jsx` is the only thing
permitted to set it.

Also note the panel reports what the user **allowed**, while TikTok's API wants
what is **disabled** — the adapter inverts them, defaulting to disabled.

### 5.5 Unaudited clients

Until the app passes TikTok's content audit, `privacy_level` must be
`SELF_ONLY` and the target account must be private, or init returns
`403 unaudited_client_can_only_post_to_private_accounts`. Surfaced as a specific
message, because the fix is a TikTok account setting, not anything in our app.

### 5.6 Token lifetimes and rotation

- Access token: **24 hours**
- Refresh token: **365 days from initial issuance** (refreshing does not extend
  it indefinitely — after a year the user must re-authorise)
- **TikTok returns a NEW `refresh_token` on every refresh and invalidates the
  one just used.**

---

## 6. The refresh worker

`supabase/functions/refresh-social-tokens/index.ts`, on a 30-minute cron.

**Why it exists:** `supabase/migrations/20260904120000_connected_account_token_custody.sql`
created `refresh_after`, `last_refreshed_at`, `refresh_failures` and
`last_refresh_error`, and states in its own comment that they exist "so a
refresh worker can find expiring rows". They were written at connect time and
read by nothing. With 24-hour TikTok tokens, any post scheduled more than a day
out failed with `access_token_invalid`, surfacing to the user as "TikTok signed
you out" — about a sign-out that never happened.

**Two hard requirements, both from refresh-token rotation:**

1. The new refresh token must be persisted. Missing this is the one failure no
   retry recovers from — the account locks out permanently.
2. Two overlapping runs must never touch the same row; each would spend the
   other's token, and the loser would store one the provider had already
   rotated away. Rows are claimed with a **compare-and-swap** before any network
   call, and the migration unschedules before scheduling so re-applying it
   cannot leave two jobs racing. Two independent defences.

**Other behaviour worth knowing:**

- Refreshes at 80% of token life, matching what the connect callback writes.
- Terminal rejections (`invalid_grant` etc.) or 3 consecutive failures set
  `connection_status = 'expired'` and stop retrying.
- LinkedIn issues no refresh token on the standard tier. Those rows cannot be
  refreshed by anyone, so once genuinely past expiry the account is marked
  `expired` — a truthful reconnect prompt rather than an uninterpretable
  publish failure later.
- A provider with no entry in the worker's `PROVIDERS` table is skipped without
  being claimed, so it starts refreshing the moment support is added.

**Deliberate duplication:** the worker keeps its own small copy of the provider
table because it is Deno and `app/api/_lib/socialProviders.js` is Node, with no
build step bridging them. That duplication is guarded — see 7.1.

---

## 7. Guards added

### 7.1 `scripts/check-oauth-provider-parity.cjs` (new, in CI)

Two assertions:

1. No route hardcodes `client_id` when building a credential payload — the 4.1
   defect.
2. The Deno worker's provider table matches `app/api/_lib/socialProviders.js` on
   `tokenUrl` and `clientIdParam`. Drift there is otherwise silent: it fails
   hours later on a background job and reaches the user as an unexplained
   reconnect prompt.

**Verified by reintroducing all three failure modes one at a time and confirming
the guard fails on each, then passes on the clean tree.** A guard only ever
observed passing has not been shown to work.

### 7.2 `scripts/check-outbound-fetch-guard.cjs`

Two `REVIEWED` entries added, for `tiktok.service.ts` and
`refresh-social-tokens/index.ts`, each recording why its fetches are not
caller-influenced. The genuinely caller-influenced URL in the TikTok adapter is
the media URL (`generations.output_url`), which goes through
`supabase/functions/_shared/safeFetch.ts` with per-redirect-hop revalidation and
a `video/*` content-type assertion.

---

## 8. Verification: what is proven, and what is not

Being precise here matters more than anywhere else in this document.

**Proven:**

- 44/44 static guards; `tsc --noEmit` clean.
- The full settings path was traced by hand, hop by hop:
  `PostProductionPanel.jsx` → `SessionStore.js` → `posts.workflow_state.tiktok`
  → `publish-post/index.ts` → adapter. No dead link.
- **Live:** TikTok accepted `client_key` + `client_secret` via
  `client_credentials` and issued an app token. This confirms the credentials
  are valid and that `client_key` is the correct parameter name — against
  TikTok's servers, not just their docs.
- Chunk arithmetic validated across five sizes, asserting the last chunk reaches
  the final byte exactly.
- The CI Deno type check was compared against `main`: **75 errors on both**,
  identical sets. The new files produce zero errors. That check has been failing
  on `main` for some time and is not currently protecting anything.

**Not proven — do not claim otherwise:**

- **No TikTok account has ever been connected.** Impossible before 4.1 was
  fixed, and the fix only reached production at the end of this session.
- **No video has ever been uploaded.** The chunked upload and the
  `PROCESSING_UPLOAD → PROCESSING_DOWNLOAD → PUBLISH_COMPLETE` poll have never
  executed against TikTok.
- **The refresh worker has never completed an authenticated run** (section 10).
- No Deno type check was run locally — Deno is not installed on the dev machine.
  Imports were verified by hand against real exports; CI does the rest.

---

## 9. Open items, ranked

1. **Connect a real TikTok account on `https://www.brandosse.com`** — must be
   the deployed domain, not localhost. `socialProviders.js` sets
   `requiresHttps: true` for TikTok because it rejects localhost redirects
   outright. This will be the first successful TikTok connect in the project's
   history.
2. **Post one real video to a private account.** This is the gate for the app
   review demo video — recording before it passes is a gamble on untested code.
3. **Resolve the service-role key mismatch** (section 10). Nothing above depends
   on it, but until it is fixed nothing is being refreshed, so a connected
   account stops working 24 hours later.
4. **TikTok content audit** — until it passes, posting is private-account only.
5. Photo carousels (needs domain verification, section 5.3).

---

## 10. The service-role key mismatch — full state

**Parked by explicit decision at the end of the session. Unresolved.**

Symptom: calling `refresh-social-tokens` with the `service_role` key from
`.env.local` returns `401 {"error":"Unauthorized"}`.

What was established:

- The key is valid: `role=service_role`, and PostgREST accepts it (HTTP 200).
- A *missing* variable was ruled out — that path returns **400** with "Missing
  environment variable" via `mapErrorToStatusCode`. The 401 body is exactly
  `{"error":"Unauthorized"}`, which only the explicit throw produces. So the
  variable **is** set inside the function, and its value differs.
- The key in `.env.local` was issued **2025-11-04** (`iat=1762273804`,
  `exp=2077849804`, sha256 fp `3e8ab947`) and did **not** change when the user
  reported rotating it across Vercel/GitHub/Fly — same `iat` before and after.
- The project uses legacy JWT keys on the client side (`anon` begins `eyJ`).

The one key, `SUPABASE_SERVICE_ROLE_KEY`, exists in four places that must agree:

1. The Supabase project itself (source of truth)
2. Injected into edge functions by the platform — **cannot be overridden**;
   Supabase rejects secrets named `SUPABASE_*`. This is what the guard compares
   against.
3. `.env.local`
4. Vault `service_role_key` — **what `pg_cron` sends**

The 401 proves #2 ≠ #3. Vercel/GitHub/Fly copies are irrelevant to this failure.

**Leading hypothesis:** the project has Supabase's newer API key system enabled,
so the runtime is injected an `sb_secret_…` value while the legacy JWT still
works for PostgREST. That fits every observation. Unconfirmed.

**Why it matters beyond one manual call:** the cron authenticates with the Vault
secret. If that has drifted too, every scheduled run gets a 401 and refreshes
nothing — silently. Three other functions authenticate identically
(`credit-monthly-reset`, `daily-analysis`, `process-risk-alerts`), so the same
drift would silence them as well. **Not verified** — those were deliberately not
invoked, since they write alerts and reset credits.

**How to settle it in one step.** `main` now has fingerprint logging in the auth
guard. Redeploy and call it; the function log prints
`expected key fp=… , presented fp=3e8ab947`. Same fingerprints means look
elsewhere; different means the values genuinely differ. Neither secret appears
in the log — it is a 4-byte SHA-256 prefix, enough to compare and nothing more.

The comparison was deliberately left as exact string equality: matching on an
unverified `role` claim would accept any forged JWT.

Useful SQL (note `cron.job_run_details` keys on `jobid`, not `jobname`):

```sql
SELECT name, left(decrypted_secret, 6) || '…' || right(decrypted_secret, 4) AS fingerprint
FROM vault.decrypted_secrets WHERE name = 'service_role_key';

SELECT j.jobname, d.status, d.return_message, d.start_time
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE j.jobname IN ('refresh-social-tokens','process-risk-alerts','credit-monthly-reset')
ORDER BY d.start_time DESC LIMIT 20;
```

---

## 11. Deployment topology facts

Discovered this session; all verified.

- **Canonical domain is `https://www.brandosse.com`.** The apex
  `brandosse.com` returns **308** to `www`.
- **OAuth `redirect_uri` must match exactly** — no redirect-following, no
  apex/www equivalence. The URI to register with any provider is therefore
  `https://www.brandosse.com/api/auth/social/<provider>/callback`.
- `NEXT_PUBLIC_APP_URL` must be `https://www.brandosse.com` in Vercel. The
  connect route falls back to the request origin only if it is unset. Note
  `.env.local` has it as `http://localhost:3000`; if that value ever reached
  Vercel, connect throws, because `redirectUriFor` refuses non-HTTPS for
  providers marked `requiresHttps`.
- The raw Vercel deployment URL is behind **Deployment Protection** and
  redirects to a Vercel SSO login. Only the custom domain is publicly reachable.
- Supabase project ref: `ujkuwemwlhilzarbrozu`.
- `gh` is **not installed** on the dev machine. PRs were created and merged via
  the GitHub REST API using the credential in Windows Credential Manager
  (`git credential fill` for `host=github.com`).
- Deno is **not installed** locally; the Deno type check only runs in CI.

---

## 12. Commands

```bash
# Preflight before any live TikTok attempt
node scripts/smoke-tiktok-publish.mjs
node scripts/smoke-tiktok-publish.mjs --account <connected_account_id>

# All static guards
for s in scripts/check-*.cjs; do node "$s" || echo "FAIL $s"; done

# The new parity guard alone
node scripts/check-oauth-provider-parity.cjs

# Deploy the refresh worker
npx supabase functions deploy refresh-social-tokens

# Invoke it manually (same thing the cron does)
curl -s -X POST "https://ujkuwemwlhilzarbrozu.supabase.co/functions/v1/refresh-social-tokens" \
  -H "Authorization: Bearer <service role key>"
# want: {"ok":true,...,"misconfigured":[]}
```

---

## 13. Notes for the YouTube integration

The next session's task. What already exists and what to reuse:

**Already in place:**

- YouTube is **already registered** in `app/api/_lib/socialProviders.js`
  (`id: 'youtube'`, `clientId` from `GOOGLE_OAUTH_CLIENT_ID`, `tokenUrl`
  `https://oauth2.googleapis.com/token`, `refreshStyle: 'refresh_token'`).
- The generic OAuth connect/callback routes are provider-driven, so connect may
  need little or no new code — **check before building** (this repo's dominant
  defect is disconnection, not absence).

**What does not exist:** there is no `youtube.service.ts`. Adapters present are
`linkedin.service.ts`, `tiktok.service.ts`, `zernio.service.ts`,
`fal.service.ts`. A YouTube publish adapter has to be written, and
`publish-post/index.ts` needs a `youtube` branch in its provider dispatch.

**Things this session learned that transfer directly:**

1. **Add `youtube` to the refresh worker's `PROVIDERS` table.** YouTube is
   `refreshStyle: 'refresh_token'`, so it genuinely refreshes — unlike LinkedIn.
   `check-oauth-provider-parity.cjs` will fail the build if the worker's entry
   disagrees with the registry, which is the intended safety net.
2. **Check the credential parameter name.** Google uses `client_id`, so the
   default is correct — but confirm rather than assume. That assumption cost
   this session a fully blocked integration (4.1).
3. **Google refresh tokens are issued once**, on first consent, and only when
   `access_type=offline` and `prompt=consent` are requested. Re-authorising
   without `prompt=consent` returns no refresh token. Verify how the connect
   route builds the authorize URL before the first live connect.
4. **Register `https://www.brandosse.com/api/auth/social/youtube/callback`** in
   the Google Cloud console — exact match, `www` included (section 11).
5. **Follow the async-publish discipline from 5.2.** YouTube's upload also
   returns before the video is processed and can fail afterwards; a successful
   upload response is not a published video.
6. **Read the migration comments before adding columns.**
   `connected_account_secrets` already has everything a refresh needs.
7. **Every new adapter needs a `REVIEWED` entry** in
   `check-outbound-fetch-guard.cjs`, or CI fails — and the caller-influenced
   media URL must go through `safeFetch.ts`.

**Process note that paid off repeatedly:** trace the whole path by hand before
declaring anything done. Three of the five defects here were found that way, not
by tests — including one (4.2) in code written earlier the same session.
