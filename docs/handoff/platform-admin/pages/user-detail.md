# Platform Admin Page: User Detail

## Page Purpose (Plain Language)
This page is the investigation workspace for a single user. It combines profile, platform accounts, posts, calendar, complaint history, internal notes, and security actions in one place.

## Route and Access Rules
- Route: `/app/admin/users/:userId`
- Parent guard: `<ProtectedRoute requireAdmin>`
- Scope:
  - Requires `adminAccess.isAdmin`.
  - Data availability still depends on row-level policies and org scope.

## Component Composition
- Container: `src/admin/pages/AdminUserDetailPage.jsx`
- Tabbed sections:
  - `overview`
  - `platforms`
  - `posts` (embedded `AdminModerationWorkspace`)
  - `calendar` (`AdminUserCalendar`)
  - `activity`
  - `complaints`
  - `analytics`
  - `security`
- Child components:
  - `AdminNotesPanel`
  - `AdminNotifyUserModal`
  - `SuspendUserModal`
  - `ActivityStatusBadge`, `AdminRiskBadge`, `QualityScoreBadge`

## State, Hooks, Services Used
- Local state for tab selection, detail loading, notes, activity filters, security form, modals.
- `adminClient` helpers:
  - `fetchUserActivityLog`
  - `fetchAdminNotes`
  - `addAdminNote`, `updateAdminNote`, `deleteAdminNote`
  - `updateAdminUserStatus`
  - `requestUserDeletion`
  - `sendAdminPasswordReset`
  - `sendAdminUserNotification`
  - `updateComplaintRecord`
  - `addComplaintComment`
  - `fetchOrganizationsByIds`
- Direct Supabase reads for profile/accounts/posts/generations/complaints/quality snapshots.

## Data Contracts Touched
- Tables read:
  - `profiles`
  - `connected_accounts`
  - `posts`
  - `generations`
  - `content_quality_reviews`
  - `complaints`
  - `admin_notes`
  - `audit_logs`
- Tables written:
  - `profiles` (suspension/deletion-request state)
  - `user_status_events`
  - `admin_notes`
  - `admin_action_requests` (user deletion requests)
  - `complaint_comments`
  - `complaints` through RPC
  - `audit_logs` through helper paths
- Edge/RPC:
  - `admin-notify-user`
  - `admin_update_complaint_status`
  - `write_audit_log`

## Inbound Dependencies
- Usually opened from `/app/admin/users`.
- Also targeted by notification center links (`entity_type=user`).

## Outbound Dependencies
- Embedded moderation tab reuses moderation workflow and query contracts.
- Calendar tab edits schedules and pushes updates to moderation cache.
- Complaint quick actions affect complaint queue/detail pages.
- Security actions affect logs, notifications, and governance workflows.

## Current Working Relationships
- Aggregates user-centric records across content, support, and moderation domains.
- Internal notes are private admin-only and audit-logged on write/update/delete.
- Security tab supports:
  - password reset
  - suspension/unsuspension
  - deletion request submission with typed confirmation.

## Missing or Partial Relationships
- Complaints tab adds internal comment only to newest complaint, not selected complaint.
- `Revoke publishing access` control is disabled placeholder.
- No direct assignment controls for complaint owner from this page.

## No Relation Exists Yet
- No relation from quality score items to content version history detail.
- No relation from platform account cards to `/app/admin/accounts` maintenance drawer for the same account.

## Recommended Wiring Contract
- Add explicit complaint selector for comment action and status action context.
- Add account drill-down handoff contract:
  - navigate with `accountId` into `/app/admin/accounts`.
- Replace disabled publishing-access control with either:
  - real permission workflow
  - or remove UI affordance until backend path exists.

## Risks If Wired Incorrectly
- Quick complaint actions on the wrong complaint can corrupt support timelines.
- Security actions without strong typed-confirmation and audit mapping are high-risk.
- Cross-tab stale state can show outdated moderation or calendar decisions if cache invalidation is incomplete.
