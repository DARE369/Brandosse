# Platform Admin Page: Logs

## Page Purpose (Plain Language)
This page is the forensic timeline for admin operations. It lets super admins inspect platform audit events and connected-account connection events with filters and grouping.

## Route and Access Rules
- Route: `/app/admin/logs`
- Parent guard: `<ProtectedRoute requireAdmin>`
- In-page restriction:
  - hard-gated to super admin (`adminAccess.isSuperAdmin`)
  - org admin sees blocked-state message

## Component Composition
- Container: `src/admin/pages/AdminLogsPage.jsx`
- Shared controls:
  - source switch (`audit_logs` vs `connection_events`)
  - event/severity/user/search filters
  - group mode (`flat`, `group by user`, `group by entity/account`)
- Render modes:
  - flat table view
  - collapsible grouped sections

## State, Hooks, Services Used
- React state:
  - `logs`, `profiles`, `connectedAccounts`, `organizations`
  - `filters`, `groupBy`, `collapsedGroups`
  - loading state
- Router state:
  - `source`, `accountId`, `domain` query params
- Helpers:
  - event tone/label formatters
  - derived user/account labeling helpers

## Data Contracts Touched
- Tables read:
  - `audit_logs`
  - `connection_events`
  - `profiles`
  - `connected_accounts`
  - `organizations`
- Writes:
  - none from this page
- Realtime:
  - none (query-on-filter change only)

## Inbound Dependencies
- Deep-linked from:
  - overview risk cards and platform-health cards
  - account severity panel (`source=connection_events`, optional `accountId`)
  - risk modal (`domain` query scope)
  - sidebar direct navigation

## Outbound Dependencies
- Scope-clear actions navigate to:
  - `/app/admin/logs`
  - `/app/admin/logs?source=connection_events`
- No row-level navigation to entity detail pages yet.

## Current Working Relationships
- Two log domains are supported with source-specific filters and table schemas.
- `domain` query scope narrows audit logs by mapped event-type pattern sets.
- Connection events enrich rows with account/user/org labels from related table lookups.

## Missing or Partial Relationships
- `severity` query param is passed by some upstream links but not actually consumed by page filter initialization.
- No pagination or cursor; each source is capped at 200 rows.
- No CSV/export API for long-window investigations.

## No Relation Exists Yet
- No relation to `admin_account_actions` timeline despite connected-account operations being a core admin action stream.
- No relation from log row to direct drill-down routes (`user`, `complaint`, `post`, `organization`) even when entity IDs exist.

## Recommended Wiring Contract
- Add unified log source contract that includes:
  - `audit_logs`
  - `connection_events`
  - `admin_account_actions`
  with explicit source discriminator and dedupe policy.
- Parse and apply `severity` query param consistently at load.
- Add row action routing by `entity_type` and `entity_id`.

## Risks If Wired Incorrectly
- Partial log unions can duplicate or drop events, weakening incident reconstruction.
- Weak filter parsing can present incomplete evidence during investigations.
- Large unbounded queries can degrade admin workspace performance.
