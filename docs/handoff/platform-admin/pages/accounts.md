# Platform Admin Page: Accounts (Supplemental Implemented Route)

## Page Purpose (Plain Language)
This page is the super-admin maintenance console for connected social accounts. It centralizes health monitoring, alert triage, reconnect/disconnect controls, and account-level intervention history.

## Route and Access Rules
- Route: `/app/admin/accounts`
- Parent guard: `<ProtectedRoute requireAdmin>`
- In-page restriction:
  - super admin only (`adminAccess.isSuperAdmin`)
  - org admin receives blocked-state panel

## Component Composition
- Route container: `src/admin/pages/AdminAccountsPage.jsx`
- Child surfaces:
  - KPI strip from overview view
  - unresolved alerts panel
  - account table with filters/actions
  - `AccountMaintenancePanel` drawer
  - `GrantAccessModal` (organization account member-access management)

## State, Hooks, Services Used
- React state:
  - loading state
  - `overview`, `accounts`, `alerts`, `profiles`, `organizations`
  - filter state (`status`, `scope`, `platform`, `health`, `search`)
  - drawer selection/open state
  - action busy state
- Data helpers:
  - `normalizeConnectedAccountRow`
  - `getConnectedAccountSemanticStatus`
  - health-tier/status/search utility functions
- Action path:
  - `supabase.functions.invoke("admin-account-action")`

## Data Contracts Touched
- Views read:
  - `platform_account_health_overview`
  - `connected_accounts_health_summary`
- Tables read:
  - `account_severity_alerts`
  - `connected_accounts`
  - `connection_events`
  - `admin_account_actions`
  - `profiles`
  - `organizations`
- Writes (via edge function):
  - `connected_accounts` updates
  - `account_severity_alerts` resolve updates
  - `admin_account_actions` inserts
  - `connection_events` inserts
  - optional `user_notifications` inserts for reconnect/disconnect actions
- Edge function:
  - `admin-account-action`

## Inbound Dependencies
- Sidebar `Accounts` nav item (super admin only).
- Account drawer cross-links can be reached from unresolved alert investigate actions.

## Outbound Dependencies
- Drawer links:
  - `/app/admin/users/:userId`
  - `/app/admin/organizations/:orgId`
- Account actions create downstream visibility in:
  - system logs (`connection_events`)
  - support trails (`admin_account_actions`)
  - user notifications (selected action types)

## Current Working Relationships
- KPI summary and table are driven by admin-specific connected-account views.
- Alerts can be resolved from list or drawer and are reflected in health views after refresh.
- Drawer exposes account event log, admin action timeline, support notes, and access management.

## Missing or Partial Relationships
- No realtime subscription for account/alert changes; data refresh is manual or action-triggered.
- No route query contract for direct deep-linking to a specific account drawer.
- Not integrated into `/app/admin/logs` unified timeline beyond raw `connection_events`.

## No Relation Exists Yet
- No direct relation from moderation queue failures to auto-open account maintenance context.
- No relation from personal/org settings connected-account surfaces to this admin console for escalation handoff.

## Recommended Wiring Contract
- Add deep-link support:
  - `/app/admin/accounts?accountId=<id>&tab=<overview|events|actions>`
- Add optional realtime channel for:
  - `account_severity_alerts`
  - `connected_accounts`
  - `connection_events`
- Add canonical event correlation IDs shared with `audit_logs` for cross-page traceability.

## Risks If Wired Incorrectly
- Incorrect super-admin enforcement on action endpoint can allow unauthorized account control.
- Aggressive auto-refresh/realtime without throttling can destabilize operator UX at scale.
- Member-access updates without strict org-scope checks can overgrant publishing permissions.
