# Platform Admin Page: Overview

## Page Purpose (Plain Language)
This page gives admins a live health snapshot of the platform: user volume, queued publishing work, complaints, generation failures, moderation pressure, and risk alerts.

## Route and Access Rules
- Route: `/app/admin`
- Parent guard: `<ProtectedRoute requireAdmin>` at `/app/admin/*`
- In-page scope:
  - Super admin: platform-wide metrics.
  - Org admin: metrics scoped by `organization_id` and scoped user IDs.

## Component Composition
- Container: `src/admin/pages/AdminOverview.jsx`
- Uses:
  - `KpiCard`
  - `AccountSeverityPanel`
  - `RiskNotificationModal`
  - Recharts (`LineChart`, `Tooltip`, `Legend`, etc.)

## State, Hooks, Services Used
- `useQuery` (`@tanstack/react-query`) for overview dataset.
- `useOutletContext()` for `adminAccess`.
- Local state: `rangeDays`, `pendingRiskModals`.
- `adminClient` helpers:
  - `fetchScopedUserIds`
  - `fetchRiskEventCounts`
  - `fetchAdminNotifications`
  - `acknowledgeNotification`
- Direct Supabase reads for KPI and feed queries.

## Data Contracts Touched
- Tables:
  - `profiles`
  - `posts`
  - `complaints`
  - `generations`
  - `audit_logs`
  - `risk_event_counts`
  - `admin_notifications`
  - `account_severity_alerts` (via `AccountSeverityPanel`)
- Realtime:
  - `admin_notifications` insert subscription (`severity=very_high`)

## Inbound Dependencies
- Opened from admin sidebar default route.
- Relies on `AdminLayout` context (`adminAccess`) and auth resolution.

## Outbound Dependencies
- KPI card and platform-risk panel deep-link to `/app/admin/logs`.
- Complaint list deep-links to `/app/admin/complaints/:complaintId`.
- AccountSeverityPanel deep-links to logs with `source=connection_events`.

## Current Working Relationships
- KPI counts and charts are computed from live data.
- Risk modal acknowledges very-high alerts and updates notification rows.
- Org-admin scoping is applied in query branches (`organization_id` and scoped user IDs).

## Missing or Partial Relationships
- At-risk users are listed but not clickable to user detail.
- No direct link from generation-failure KPI to filtered logs view.
- Risk summary and account-severity summary are separate widgets with no merged severity model.

## No Relation Exists Yet
- No relation between range selector and complaints/alerts query windows (range affects generation trend period only).
- No persisted dashboard preference (selected range resets).

## Recommended Wiring Contract
- Add route query contract for drill-downs:
  - `/app/admin/logs?domain=<risk-domain>&severity=error`
  - `/app/admin/users?activityStatus=dormant`
- Define shared admin-risk severity mapper consumed by both overview and account-severity panels.

## Risks If Wired Incorrectly
- Incorrect scope filtering can expose cross-tenant counts to org admins.
- Coupling all cards to one date range without explicit definitions can mislead operators.
- Missing idempotent notification acknowledge handling can duplicate modal actions during realtime bursts.
