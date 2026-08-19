# Security & Authentication Audit — 2026-08-19

Scope: authentication flow end to end, RLS/privilege-escalation surface, secret
hygiene, and a per-function ownership review of every edge function that uses
the Supabase admin client (bypasses RLS). Findings below in the order they
were found; commit hashes are on `main`.

## Fixed

### 1. `qa-debug-fal6` — SSRF + key exfiltration (CRITICAL, `e0ef22d`)
Took an arbitrary `url` query param, attached `FAL_API_KEY` as an
`Authorization` header, fetched it, and returned status/headers/body — no
auth, no allowlist, no rate limit. A single request to an attacker-controlled
host would exfiltrate the fal.ai key; it also worked as a general SSRF proxy
into internal/metadata endpoints. Verified **not deployed** at time of
discovery, so latent rather than live — but one `deploy --all` away.
**Deleted** (repo + confirmed absent from the live function list).

### 2. Auth debug/diagnostic logs leaking live tokens (HIGH, `e0ef22d`)
Diagnostics added earlier in this same work (`bd164c1`, `934364b`) wrote
supabase-js debug output and refresh-failure bodies to
`localStorage['socialai-auth-debug-log']` / `[...-last-refresh-failure]` —
meant to be read out and pasted into a bug report. supabase-js passes full
session objects to its debug hook, so this was writing live
`access_token`/`refresh_token` values in plaintext. **Fixed**: both paths now
redact before storing — sensitive object keys replaced wholesale, any
JWT-shaped string stripped wherever it appears (including inside URL
fragments). Verified against a synthetic session: tokens gone, `expires_at`/
email/provider/error text preserved.

### 3. `adminStats` — dead, unauditable, admin-named endpoint (`0944ee5`, `fc63367`)
Deployed and ACTIVE in production; local `index.ts` was **0 bytes since the
initial commit** (never had content), so the deployed build had no `serve()`
handler and could not have been doing anything. Zero references anywhere in
the codebase, no cron schedule invoking it. Two prior dated audits in `docs/`
had already flagged it as empty/uninvoked. **Deleted** from the Supabase
project and the repo; `FEATURE_INVENTORY.md`'s stale listing removed too.

### 4. `optimize-seo` — IDOR, cross-account write (HIGH)
`content_id`/`post_id` (client-supplied, not secret — appears in URLs/API
responses) was passed straight into `persistSeoState`, which writes through
the admin client (RLS bypassed) with **no ownership check anywhere in the
call chain**. Any authenticated user could pass any post's UUID and overwrite
that post's `seo_state`/`workflow_state`. **Fixed**: ownership confirmed
(`posts.user_id = user.id`) before the write; a non-owned id degrades to a
silent skip rather than an error, so the scoring output still returns to the
caller.

### 5. `seo-score` — same IDOR, higher exposure (HIGH)
Identical defect to #4, in the sibling function. Higher severity in practice:
this is the function the **org draft workflow actually calls** with a real
post id (`orgDraftWorkflowService` doesn't call `optimize-seo` with an id at
all — confirmed by reading the call site — so `seo-score` was the one
actually reachable with attacker-controlled `content_id` in both the personal
and org paths). **Fixed** with a dual ownership model, matching the pattern
`generate-post-metadata` already used correctly for the same two callers:
personal posts check `user_id`, org-owned posts check `requireActiveOrgMember`
against the post's `organization_id`.

## Verified sound (audited, no action needed)

- **Privilege escalation via `profiles`**: closed. `profile_self_update_guard`
  requires `role`, `is_admin`, `credits`, `status`, `organization_id` to be
  unchanged on self-update (`WITH CHECK`); INSERT is constrained to
  non-admin roles/values. `admin_roles` table itself is writable only by a
  verified super admin.
- **RLS coverage**: 63 tables, 217 policies. The one `USING (true)` found is
  SELECT-only on `platform_registry`, a public reference table — correct as
  written.
- **`user_credits`**: `UPDATE USING (false)` — no direct client mutation
  possible; all changes go through the `deduct_credits`/`reserve_credits` RPCs.
- **Service-role key**: only referenced in genuinely server-only paths
  (`app/api/*`, `src/lib/video-engine/supabase-admin.ts`). Never
  client-reachable; no `NEXT_PUBLIC_*` exposure.
- **Secret hygiene**: no `.env*` tracked in git; `.gitignore` covers it;
  the repo's own `scripts/check-env-security.cjs` passes.
- **Full per-function ownership pass** across all ~45 edge functions using
  the admin client (the two IDORs above were the only findings):
  - Personal-data functions (`editImage`, `personal-asset-*`, `upscaleImage`,
    `quality-gate`, `generate-post-metadata`, `mock-publish`, `publish-post`)
    consistently scope by `user_id` (or `requireServiceRole` for the
    server-to-server publish path) before any read/write.
  - Org-scoped functions (14 of them) consistently gate through
    `requireActiveOrgMember` / `requireOrgAdmin` /
    `requireOrgAdminOrSuperAdmin`, re-deriving the org from the resource
    being acted on rather than trusting a client-supplied org id.
  - Admin-named functions (`admin-account-action`,
    `admin-seed-connected-account`, `admin-list-posts`, `admin-notify-user`)
    all verify real admin role (`isSuperAdminUser`/`is_admin_user`), and
    `admin-list-posts` correctly confines an `org_admin` caller to their own
    `organization_id` only.
  - Cron/system functions (`credit-monthly-reset`, `detect-account-failures`,
    `process-jobs`, `process-risk-alerts`) are gated on the actual
    `SUPABASE_SERVICE_ROLE_KEY` bearer token, not a forgeable header.
  - `healthCheck` is unauthenticated by design and correctly so — returns
    only cron job names/schedule/pass-fail state, no user data.
  - `org-complete-invitation-signup` is unauthenticated by necessity (there
    is no user yet); secured by a `gen_random_uuid()` invitation token
    (122 bits, not brute-forceable) plus the account email being pinned
    server-side from the invitation row, never taken from client input.
  - `org-accept-invitation` enforces an email match before granting real
    membership (`403` if mismatched); the one branch that doesn't require a
    match is scoped to `preview` display only, not membership grant.
  - `job-webhook` / `pipeline-client-action` are unauthenticated by design
    (external webhook / pre-auth client link) but verify a per-resource
    random token before acting, and `pipeline-client-action`'s token is
    time-limited and single-use.
- **XSS**: no `dangerouslySetInnerHTML` anywhere in the codebase.
- **CORS `*` on edge functions**: acceptable — auth is bearer-token based,
  not cookie-based, so a permissive CORS policy doesn't create a CSRF-style
  exposure the way it would for cookie auth.

## Deliberate, documented tradeoff (no code change)

### `generated_assets` storage bucket is `public = true`
See the inline comment added to
`supabase/migrations/20260222013000_storage_buckets_and_policies.sql` above
the bucket definition for the full writeup. Summary: Supabase serves public
buckets directly, bypassing RLS entirely, so the `generated_assets_select_own`
policy protects only the (unused) authenticated API path — anyone holding a
generated image/video URL can view it indefinitely, no login required. Paths
are UUID-prefixed and unguessable, so this is a capability-URL model, not
access control: safe against enumeration, not against a leaked link. Kept
as-is deliberately — this is the normal, low-friction pattern for a
content-generation tool whose output is generally meant to be shared or
published. Revisit only if some generated content is ever meant to stay
genuinely private; switching to signed URLs at that point is a real migration
(every existing stored URL breaks), not a config flip.

## Not covered by this pass

- Prompt injection via user content / brand-kit text flowing into LLM system
  prompts — not assessed.
- Rate-limiting effectiveness under sustained abuse (present via
  `enforceRateLimit` on essentially every function, but load-tested nowhere).
- Supabase Auth provider-level settings (session timeout, refresh rotation
  interval) beyond what was checked while debugging the "signed out on
  browser close" report earlier in this work — see git history for that
  investigation (`1fcbb2f` onward).
