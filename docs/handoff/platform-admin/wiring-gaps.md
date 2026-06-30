# Platform Admin Wiring Gap Report (Stage 2)

## Purpose
This report tracks missing or partial platform-admin relationships as first-class handoff content.

Each gap is documented as:
1. Current state
2. Intended relationship
3. Exact missing connection point
4. Likely implementation path
5. Constraints and risks

## Gap 1: Duplicate authority sources create access drift
### Current state
- Route gate for `/app/admin` uses `authRouting.isAdminRole`, which only accepts `super_admin`.
- Admin shell (`useAdminAccess` + `rbac`) treats both `super_admin` and `org_admin` as valid admin scopes.

### Intended relationship
- A single canonical admin-role contract should determine route entry, nav visibility, and data scope.

### Missing connection point
- No shared authority module is used by `ProtectedRoute`, `AuthContext`, and admin RBAC helpers.

### Likely implementation path
- Introduce one canonical role normalizer/validator used everywhere.
- Update route guard to allow `org_admin` where stage requirements expect scoped admin access.
- Add integration test coverage for both role types.

### Constraints and risks
- Relaxing guard logic without matching data-scope checks can overexpose tenant data.
- Keeping split logic causes environment-specific admin lockout and inconsistent UX.

## Gap 2: Moderation lineage is incomplete across request/approval/execution
### Current state
- Moderation can force publish/schedule, archive, and submit deletion requests.
- `Assign Reviewer` is intentionally disabled and no reviewer ownership is persisted.

### Intended relationship
- Each moderation action should have clear actor, assignee, approval state, and execution trace.

### Missing connection point
- No reviewer-assignment field/relationship in moderation queue model.
- No UI path to approve/reject `admin_action_requests` from moderation context.

### Likely implementation path
- Add reviewer ownership fields to moderation domain (or reuse workflow task model explicitly).
- Add approval workflow surface tied to `admin_action_requests`.
- Persist lineage references from moderation item -> action request -> audit log correlation id.

### Constraints and risks
- If assignment is added only in UI, queue ownership will be misleading and unverifiable.
- Approval flow without hard authorization checks can bypass governance intent.

## Gap 3: Org/member linkage is read-heavy but control-light
### Current state
- Org list supports creation and owner invite generation.
- Org detail is read-only (owner, members, complaints).

### Intended relationship
- Org oversight should include controlled membership and owner lifecycle operations.

### Missing connection point
- No editable linkage from org detail into member role/status management workflows.
- No direct linkage from org detail to organization-scoped admin routes for follow-up actions.

### Likely implementation path
- Add controlled action panel on org detail:
  - owner reassignment request
  - member status changes
  - org suspension request
- Require audit-log write and scoped authorization for all mutations.

### Constraints and risks
- Owner/membership edits are high-risk and must preserve referential integrity.
- Partial org mutations without workflow tracking can orphan invitations or role templates.

## Gap 4: Analytics path is partially real and partially placeholder
### Current state
- `AdminAnalyticsPage` computes internal metrics from live tables.
- Platform cards display hard-coded mock values and do not query `platform_analytics`.

### Intended relationship
- Analytics should clearly separate shipped metrics from pending integrations, with explicit contract status.

### Missing connection point
- No service that maps connected accounts/posts to platform API analytics ingestion outputs.

### Likely implementation path
- Introduce analytics source registry in code:
  - `live`, `derived`, `mock`, `unavailable`
- Wire platform cards to `platform_analytics` where available; keep explicit fallback states.
- Add date-window filters aligned to the same data source contract.

### Constraints and risks
- Mixing mock/live data without provenance labels can mislead operational decisions.
- Backfilling analytics without org/user scoping can leak cross-tenant metrics.

## Gap 5: Notification model remains compatibility-layer heavy
### Current state
- Frontend normalizes `type/notification_type`, `read/is_read`, `admin_id/recipient_admin_id`.
- Policies and migrations still support both schemas.

### Intended relationship
- One canonical notification shape across frontend and backend.

### Missing connection point
- No cleanup migration + frontend contract simplification plan.

### Likely implementation path
- Stage canonical columns and deprecate legacy fields in phases:
  1. dual-write
  2. read-canonical + fallback
  3. remove fallback and old columns
- Update all notification reads/writes to canonical fields.

### Constraints and risks
- Removing compatibility too early can break older clients or migration-order-sensitive environments.

## Gap 6: Settings preferences are local-only and disconnected from behavior
### Current state
- `/app/admin/settings` saves preferences in local storage.
- Notification toggles and page size do not drive live query/subscription behavior globally.

### Intended relationship
- Settings should influence runtime behavior and optionally persist per admin user.

### Missing connection point
- No backend settings table or shared settings service used by admin pages.

### Likely implementation path
- Add `admin_workspace_settings` (or extend profile metadata) with scoped RLS.
- Apply settings to notification fetches, default list pagination, and log filters.

### Constraints and risks
- Inconsistent local defaults across devices can cause operational confusion.
- Persisting without schema-level validation risks invalid preference payloads.

## Gap 7: Complaint detail comment flow is weakly linked for multi-ticket users
### Current state
- User detail complaint comment action always posts to newest complaint only.
- Complaint detail page supports full comment/history model.

### Intended relationship
- Comment actions from user investigations should target an explicit complaint.

### Missing connection point
- No selector or routing contract from user detail to chosen complaint context.

### Likely implementation path
- Add explicit complaint selection in user detail complaints tab.
- Reuse complaint detail route as canonical comment surface.

### Constraints and risks
- Implicit newest-complaint writes can attach notes to wrong ticket.

## Gap 8: Logs coverage omits parts of admin operations lineage
### Current state
- Logs page reads `audit_logs` and `connection_events`.
- Connected account actions are recorded in `admin_account_actions`, but that table is not directly surfaced in logs explorer.

### Intended relationship
- Operators should see one coherent timeline across audit + connection + account-action domains.

### Missing connection point
- No merged query/view for admin account action lineage in logs explorer.

### Likely implementation path
- Add unified server-side view or API union for:
  - `audit_logs`
  - `connection_events`
  - `admin_account_actions`
- Keep source labels in UI.

### Constraints and risks
- Naive union can duplicate events already reflected in audit metadata.

## Gap 9: Admin route inventory mismatch
### Current state
- `router.jsx` includes `/app/admin/accounts`.
- Requested stage route list did not include this path.

### Intended relationship
- Route inventory in handoff artifacts and implementation should match exactly.

### Missing connection point
- No canonical route registry consumed by docs, router, and sidebar generation.

### Likely implementation path
- Define a single route ownership map (code) and drive docs/checklists from it.

### Constraints and risks
- Documentation drift causes incomplete onboarding and missed regression checks.

## Required Stage-2 Gap Buckets Check
### Duplicate authority sources
- Covered by Gap 1.

### Incomplete moderation lineage
- Covered by Gap 2 and Gap 8.

### Missing org/member linkage
- Covered by Gap 3.

### Analytics/notification paths partial or mock
- Covered by Gap 4 and Gap 5.
