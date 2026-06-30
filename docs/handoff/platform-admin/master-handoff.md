# Platform Admin Master Handoff (Stage 2)

## Plain-Language Overview
The platform-admin workspace is the control center for platform-wide governance. Admins can investigate users, review content, triage support complaints, monitor operational risk, inspect logs, and manage organization onboarding.

## Technical Architecture Summary
- Route scope under `/app/admin/*`:
  - `/app/admin` (overview)
  - `/app/admin/users`, `/app/admin/users/:userId`
  - `/app/admin/organizations`, `/app/admin/organizations/:orgId`
  - `/app/admin/moderation`
  - `/app/admin/complaints`, `/app/admin/complaints/:complaintId`
  - `/app/admin/logs`
  - `/app/admin/analytics`
  - `/app/admin/settings`
  - Supplemental: `/app/admin/accounts` (super-admin connected account maintenance)
  - Alias: `/app/admin/content/review` redirects to moderation
- Shell/runtime:
  - Route entry and guard: `src/router/router.jsx`, `src/utils/protectedRoute.jsx`
  - Admin shell: `src/admin/AdminLayout.jsx`
  - Global admin chrome: `AdminNavbar`, `AdminSidebar`, `AdminNotificationCenter`, `AdminProfileMenu`
  - Access context: `useAdminAccess`, `useAuth` (AuthContext)
- Data and contracts:
  - Frontend reads/writes via `supabase-js`, `adminClient`, `orgAdminService`, `moderationApi`
  - Heavy workflows call edge functions: `admin-list-posts`, `admin-notify-user`, `admin-account-action`, `org-invite-member`
  - Core admin SQL contracts come from:
    - `20260312153000_admin_foundation.sql`
    - `20260321113000_admin_moderation_schema_alignment.sql`
    - `20260321153000_admin_v4_notifications_notes_and_activity.sql`
    - `20260323100000_risk_notifications_and_help_system_core.sql`
    - `20260323101000_risk_notifications_and_help_system_policies.sql`
    - `20260323102000_complaint_workflow_and_audit_functions.sql`
    - Connected-account admin views/policies in `2026032800*` and `20260329010000*`

## Page Relationship Map
- Admin landing:
  - `/app/admin` summarizes KPIs, complaints, risk domains, and account-severity alerts.
  - It deep-links into `/app/admin/logs` and complaint detail pages.
- User operations:
  - `/app/admin/users` is the directory and bulk-action surface.
  - `/app/admin/users/:userId` is the investigative drill-down; embeds moderation and calendar slices.
- Moderation and publishing control:
  - `/app/admin/moderation` is a cross-user queue for edit/schedule/publish/archive/delete/regenerate actions.
  - Complaint detail routes can deep-link into moderation through query params.
- Support lifecycle:
  - `/app/admin/complaints` triages queue.
  - `/app/admin/complaints/:complaintId` executes status transitions, assignment, and internal comments via RPC.
- Organization governance:
  - `/app/admin/organizations` creates orgs and owner onboarding links.
  - `/app/admin/organizations/:orgId` shows organization owner/member/complaint context.
- Observability and settings:
  - `/app/admin/logs` unifies audit logs and connection events with scoped filters.
  - `/app/admin/analytics` provides internal analytics plus explicitly mocked external-platform cards.
  - `/app/admin/settings` is local admin preference management and basic account security actions.

## UI-Service-Edge-Schema Relationship Map
| UI Domain | Services/Hooks | Edge Functions/RPC | Primary Schema Contracts |
| --- | --- | --- | --- |
| Access + shell | `useAdminAccess`, `useAuth`, `rbac`, `protectedRoute` | none | `profiles`, `admin_roles`, `organizations`, `organization_members` |
| Overview | local `fetchAdminOverview`, `adminClient` | none | `profiles`, `posts`, `generations`, `complaints`, `audit_logs`, `risk_event_counts`, `admin_notifications`, `account_severity_alerts` |
| Users + user detail | `adminClient`, `AdminUserCalendar` | `admin-notify-user`, `admin_update_complaint_status` RPC, `write_audit_log` RPC | `profiles`, `connected_accounts`, `posts`, `generations`, `content_quality_reviews`, `user_status_events`, `admin_notes`, `admin_action_requests`, `audit_logs`, `complaints`, `complaint_comments` |
| Moderation | `moderationApi`, React Query | `admin-list-posts`, `admin-regenerate-post`, `admin-analyze-media`, `admin-promote-content-version` | `posts`, `generations`, `content_quality_reviews`, `content_versions`, `connected_accounts`, `content_library_items`, `admin_action_requests`, `audit_logs` |
| Complaints | `adminClient` + direct Supabase queries | `admin_update_complaint_status` RPC | `complaints`, `complaint_comments`, `complaint_status_history`, `admin_roles`, `profiles`, `user_notifications`, `admin_notifications`, `audit_logs` |
| Organizations | `orgAdminService` | `org-invite-member`, `write_audit_log` RPC | `organizations`, `organization_plans`, `organization_members`, `org_invitations`, `profiles`, `admin_roles` |
| Logs | direct Supabase + helpers | none | `audit_logs`, `connection_events`, `connected_accounts`, `profiles`, `organizations` |
| Settings | `useLocalPersist`, `rbac` | Supabase auth password reset | local storage preferences + `profiles`/auth identity |
| Connected account maintenance (supplemental) | `AdminAccountsPage`, `AccountMaintenancePanel` | `admin-account-action` | `connected_accounts_health_summary`, `platform_account_health_overview`, `account_severity_alerts`, `admin_account_actions`, `connection_events`, `connected_accounts`, `profiles`, `organizations` |

## Implemented vs Missing Relationship Summary
### Implemented and working
- Admin shell, sidebar/nav routing, and page-level data loading with scoped filtering.
- Complaint status transitions are centralized through `admin_update_complaint_status`, with history and audit trail writes.
- Moderation queue supports draft edits, force actions, archive/delete requests, quality rescoring, and optional regeneration flows.
- Account maintenance actions are service-driven through `admin-account-action` and create connection events/action logs.

### Partially wired
- Moderation depends on optional edge functions (`admin-regenerate-post`, `admin-analyze-media`, `admin-promote-content-version`); UI has fallback messages when missing.
- Analytics mixes real internal calculations with explicit mock placeholders for external platform metrics.
- Notification schema remains compatibility-first (`admin_id`/`recipient_admin_id`, `read`/`is_read`, `type`/`notification_type`) and frontend normalizes both.

### No relation exists yet (observed)
- `Assign Reviewer` control in moderation bulk bar is intentionally disabled; no reviewer-ownership field is wired.
- Admin settings notification toggles are local-only and do not influence query filters, channel subscriptions, or backend notification policy.
- Organization detail page is read-only; no relation yet to actionable org controls (suspend/reactivate/reassign owner).

## Missing-Link Inventory (Platform Admin)
See `platform-admin/wiring-gaps.md` for structured gap-by-gap integration guidance.

## How To Complete Unfinished Wiring Safely
1. Unify admin authority resolution first (route guard + AuthContext + RBAC helper modules).
2. Convert moderation optional paths into explicit capability contracts (feature flags + health checks for edge functions).
3. Add reviewer ownership and moderation lineage fields before enabling assignment UI controls.
4. Bind admin settings preferences to persistent storage and apply them to notification/log query behavior.
5. Expand organization detail from read-only into controlled mutation workflows with audit logging and scoped authorization checks.
