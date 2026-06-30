# Platform Admin Data Model and Supabase Contracts (Stage 2)

## Purpose
This file maps platform-admin UI surfaces to concrete SQL tables/views/RPCs/edge functions and realtime subscriptions currently used in code.

## Route-to-Contract Matrix
| Route | Main Contract Surface | Reads | Writes | Realtime |
| --- | --- | --- | --- | --- |
| `/app/admin` | Overview + risk | `profiles`, `posts`, `generations`, `complaints`, `audit_logs`, `risk_event_counts`, `admin_notifications`, `account_severity_alerts` | `admin_notifications` read/ack updates | `admin_notifications` insert channel (`severity=very_high`) |
| `/app/admin/users` | User directory | `profiles`, `organizations`, `connected_accounts`, `generations`, `posts` | `profiles` (suspend/unsuspend), `user_status_events`, `audit_logs` via `write_audit_log` | `profiles` table channel |
| `/app/admin/users/:userId` | User investigation | `profiles`, `connected_accounts`, `posts`, `generations`, `content_quality_reviews`, `complaints`, `admin_notes`, `audit_logs` | `profiles`, `user_status_events`, `admin_notes`, `admin_action_requests`, `complaint_comments`, `complaints` via RPC, `user_notifications` via edge function | none at page root |
| `/app/admin/organizations` | Org provisioning | `organizations`, `org_invitations`, `profiles` | `organizations`, invite state in `organizations.settings`, audit log | none |
| `/app/admin/organizations/:orgId` | Org detail | `organizations`, `organization_members`, `complaints`, `profiles` | none (read-only page) | none |
| `/app/admin/moderation` | Cross-user moderation queue | `profiles`, `posts`, `generations`, `content_quality_reviews`, `connected_accounts`, `media_assets`, `content_versions`, `admin_roles`, `organizations` | `posts`, `content_quality_reviews`, `content_library_items`, `admin_action_requests`, `audit_logs` | `posts` + `generations` channel invalidation |
| `/app/admin/complaints` | Complaint queue | `complaints`, `profiles` | `complaints` via `admin_update_complaint_status` RPC | none |
| `/app/admin/complaints/:complaintId` | Complaint casework | `complaints`, `complaint_comments`, `complaint_status_history`, `admin_roles`, `profiles` | `complaints` via RPC, `complaint_comments` | none |
| `/app/admin/logs` | Audit/connection log explorer | `audit_logs` OR `connection_events`; plus `profiles`, `connected_accounts`, `organizations` | none | none |
| `/app/admin/analytics` | Internal analytics | `profiles`, `generations`, `posts`, `connected_accounts`, `content_quality_reviews`, `organizations` | none | none |
| `/app/admin/settings` | Local workspace settings | auth identity + local storage | Supabase auth password-reset email trigger | none |
| `/app/admin/accounts` (supplemental) | Connected account maintenance | `platform_account_health_overview` view, `connected_accounts_health_summary` view, `account_severity_alerts`, `connected_accounts`, `connection_events`, `admin_account_actions`, `profiles`, `organizations` | via `admin-account-action` edge function | none |

## RPC Contracts Used by Stage 2
### `public.admin_update_complaint_status(...)`
- Used by:
  - `AdminComplaintsPage` (mark under review)
  - `AdminComplaintDetailPage` (status/assignment/resolution updates)
  - `AdminUserDetailPage` (quick resolve in complaints tab)
- Behavior:
  - Normalizes status to `submitted|under_review|resolved|closed`
  - Inserts into `complaint_status_history`
  - Writes `user_notifications` when resolved
  - Inserts `admin_notifications`
  - Writes audit log via `write_audit_log`

### `public.write_audit_log(...)`
- Used via `adminClient.insertAuditLog`, moderation API, org admin service, and auth context telemetry.
- Fallback path exists in `adminClient` to direct `audit_logs` insert when RPC fails with recoverable errors.

### Authorization helpers directly referenced by functions/policies
- `is_admin_user`
- `is_super_admin_user`
- `can_admin_access_user`
- `can_admin_access_organization`

## Edge Function Contracts Used by Stage 2
### `admin-list-posts`
- Primary moderation listing API.
- Accepts query filters (`page`, `limit`, user/org/status/platform/date/search and quality fields).
- Returns normalized moderation rows, count, and groups.
- Frontend fallback:
  - If unavailable/404, `moderationApi.fetchAdminPostsFallback` queries tables directly.

### `admin-notify-user`
- Triggered from `AdminUserDetailPage` notification modal.
- Inserts into `user_notifications` and writes `audit_logs`.
- Enforces `is_admin_user` and `can_admin_access_user` through RPC checks.

### `admin-account-action`
- Used by `/app/admin/accounts` and maintenance drawer.
- Supports actions:
  - `force_reconnect`, `clear_failures`, `reset_health`, `force_disconnect`, `resolve_alert`, `support_note`, `set_member_access`
- Writes:
  - `connected_accounts`, `account_severity_alerts`, `admin_account_actions`, `connection_events`
  - Optional user-facing notification for reconnect/disconnect events.

### `org-invite-member`
- Used by `orgAdminService` from organization provisioning/invite flows.
- On errors, UI persists invitation failure state into `organizations.settings`.

### Optional moderation functions (UI handles missing deployment)
- `admin-regenerate-post`
- `admin-analyze-media`
- `admin-promote-content-version`

## Realtime Contracts Used by Stage 2
- `AdminNavbar`: subscribes to `admin_notifications` changes and refreshes notification list.
- `AdminOverview`: subscribes to very-high risk inserts in `admin_notifications`.
- `AdminUsersPage`: subscribes to `profiles` and patches query cache.
- `AdminModerationWorkspace`: subscribes to `posts` and `generations` updates; invalidates moderation query.
- `AccountSeverityPanel`: subscribes to `account_severity_alerts`.

## Admin Access Resolution Contract (Current)
### Frontend modules involved
- `src/services/authService.js`: resolves role from auth metadata + profile + `admin_roles`.
- `src/Context/AuthContext.jsx`: computes `resolvedRole`, `adminRole`, workspace catalog, and redirect path.
- `src/utils/authRouting.js`: route helper normalization and `isAdminRole`.
- `src/admin/hooks/useAdminAccess.js`: secondary admin scope resolver for admin shell.
- `src/admin/utils/rbac.js`: admin nav visibility and labels.

### Known contract inconsistency
- `authRouting.isAdminRole` returns `true` only for `super_admin`.
- `rbac.normalizeAdminRole` treats both `super_admin` and `org_admin` as admin.
- Result:
  - route guard and in-shell role handling are not fully aligned.

## SQL View Contracts Used by Stage 2
### `public.connected_accounts_health_summary`
- Defined in `20260328002000_settings_connected_accounts_indexes.sql`.
- Used by `/app/admin/accounts` table view.

### `public.platform_account_health_overview`
- Defined in `20260328006000_admin_accounts_views.sql`.
- Used by `/app/admin/accounts` KPI cards.

## Policy/Schema Notes Relevant to Stage 2
- Complaint model is compatibility-normalized:
  - legacy statuses (`new`, `triaged`, `in_progress`, etc.) map to v2 statuses.
- Admin notifications are dual-column compatibility model:
  - `admin_id` + `recipient_admin_id`
  - `type` + `notification_type`
  - `read` + `is_read`
- Connected account admin read policy for super admins added in:
  - `20260329010000_connected_account_admin_read_policies.sql`

## No Relation Exists Yet (Data Contract Level)
- No dedicated reviewer-assignment table/column for moderation queue ownership.
- No persistent table for admin UI preferences from `/app/admin/settings`.
- No route in stage list for `/app/admin/accounts`, although it is implemented and super-admin visible.

## Contract Hardening Priorities
1. Align admin-role semantics across route guard (`authRouting`) and admin shell (`rbac`/`useAdminAccess`).
2. Convert optional moderation edge functions into explicit capability contract (startup check + UI disable states).
3. Canonicalize notification column usage and simplify frontend normalization branch paths.
4. Add explicit reviewer assignment persistence before enabling assignment UI.
