# Security, RBAC, RLS, and Token Gap Audit

## Purpose
Document high-impact security and authorization gaps with direct evidence and a safe remediation order.

## Findings by Severity

## Critical 1: `credit-monthly-reset` is admin-client powered with no caller gate
### Evidence
- `supabase/functions/credit-monthly-reset/index.ts:19` creates admin client.
- No `requireUser(...)` or `requireServiceRole(...)` check in that function.

### Risk
- Any caller that can hit the endpoint can reset org/member credit counters.

### Recommended fix
1. Add service-role verification gate at function entry.
2. Restrict method to POST (already present) and require signed internal trigger.
3. Add audit log write for each reset execution.

## Critical 2: `extractBrandKit` uses admin storage access with no caller auth boundary
### Evidence
- `supabase/functions/extractBrandKit/index.ts:98` creates admin client.
- Function signs `brand_assets` storage paths without `requireUser`/membership verification.

### Risk
- If storage paths are discovered/guessable, unauthorized document access is possible.

### Recommended fix
1. Require authenticated user.
2. Validate ownership/org membership for requested `storagePath`.
3. Add strict path prefix checks and rate limiting.

## High 1: Client review tokens are effectively non-expiring in current flow
### Evidence
- `supabase/functions/pipeline-generate-client-link/index.ts:54` sets `client_review_token_expires_at: null`.
- `supabase/functions/_shared/pipeline.ts:83` token lookup does not enforce expiration.
- `supabase/functions/pipeline-client-action/index.ts:31-32` checks token usage status but not expiry.

### Risk
- Leaked tokens may remain actionable indefinitely until manually invalidated.

### Recommended fix
1. Set default expiry on token generation (for example 72 hours).
2. Reject expired tokens in `loadPipelineContextByToken`.
3. Record failure telemetry for expired or invalid token attempts.

## High 2: Invitation signup endpoint is public and requires abuse controls
### Evidence
- `supabase/functions/org-complete-invitation-signup/index.ts:29` creates admin client.
- Endpoint is public by design and operates with invitation token plus password payload.

### Risk
- Token brute-force attempts and account-provisioning abuse if no rate-limit/attempt tracking is present.

### Recommended fix
1. Add per-IP and per-token attempt throttling.
2. Add failed-attempt counters and temporary lockouts.
3. Log abuse signals to `audit_logs` or dedicated security telemetry.

## Medium 1: Role authority contract drifts between routing and admin RBAC
### Evidence
- `src/utils/authRouting.js:104-106` treats admin as `super_admin` only.
- `src/admin/utils/rbac.js:27-29` treats both `super_admin` and `org_admin` forms as admin.

### Risk
- Inconsistent access behavior across route entry vs in-app admin capability checks.

### Recommended fix
1. Create one shared role-authority module.
2. Consume it in route guards, nav visibility, and service authorization checks.
3. Add integration tests for both `super_admin` and `org_admin`.

## Medium 2: Health summary views aggregate across tenants without per-user filters
### Evidence
- `supabase/migrations/20260328004000_health_card_views.sql` and
  `supabase/migrations/20260328006000_admin_accounts_views.sql` define global aggregate views.
- View definitions have no explicit row-level filters by `auth.uid()` context.

### Risk
- If grants are broad, aggregate cross-tenant metrics may be visible unintentionally.

### Recommended fix
1. Verify and tighten grants for these views.
2. Prefer `security_invoker` or replace with scoped RPC/functions that enforce caller context.
3. Add tests for tenant isolation at query boundary.

## RLS Status Note
- Stage 5 checks found RLS enablement statements for active tables in current migration set.
- Remaining risk is not RLS absence but policy correctness and edge-function bypass behavior via admin clients.

## Remediation Order
1. `credit-monthly-reset` auth hardening.
2. `extractBrandKit` ownership/auth hardening.
3. Client-review token expiration enforcement.
4. Invitation signup abuse controls.
5. Role authority normalization.
6. View grant/tenant-scope verification.

