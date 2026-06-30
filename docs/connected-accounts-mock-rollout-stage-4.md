# Connected Accounts Mock Rollout — Stage 4

## Scope
- This pass adds connected-account health surfacing to the personal dashboard, org overview, and admin workspace.
- It also extends admin logs so super admins can inspect `connection_events` directly.
- Org account creation and maintenance actions remain Stage 5 and Stage 6 work.

## Implemented

### Dashboard health card
- Wired `src/components/Dashboard/AccountHealthCard.jsx` into `src/pages/Dashboard/UserDashboard.jsx`
- The dashboard now reads from `public.connected_accounts_health_summary`
- The previous lightweight account status list is replaced with:
  - healthy vs attention summary
  - last successful publish signal
  - top issue rows
  - direct navigation to `Settings -> Connected Accounts`

### Org overview health card
- Wired `src/org/components/OrgAccountHealthCard.jsx` into `src/org/pages/OrgOverview.jsx`
- Org admins now see a shared-account health panel on the overview page
- The card shows:
  - org account totals
  - issue count
  - weekly publish activity
  - last publisher / last publish timestamps per account
  - direct navigation to org settings

### Admin account alert panel
- Wired `src/admin/components/AccountSeverityPanel.jsx` into `src/admin/pages/AdminOverview.jsx`
- The panel renders only for super admins
- It shows unresolved `account_severity_alerts` with:
  - severity badge
  - org or user reference
  - platform reference
  - relative timestamp
  - direct investigate link into connection-event logs
- Added realtime refresh on `account_severity_alerts` changes so the panel disappears when no unresolved alerts remain

### Connection events in admin logs
- Updated `src/admin/pages/AdminLogsPage.jsx`
- Added a log source switch:
  - `Audit Logs`
  - `Connection Events`
- In `Connection Events` mode the table now shows:
  - timestamp
  - account (`@username + platform`)
  - event type
  - severity
  - simulated vs standard badge
  - message
- Added support for deep-link scopes:
  - `/app/admin/logs?source=connection_events`
  - `/app/admin/logs?source=connection_events&accountId=<connected_account_id>`
- Grouping now adapts by source:
  - audit logs: group by user / content
  - connection events: group by user / account

## Supporting Files
- `src/styles/AccountHealth.css`
- `supabase/migrations/20260329010000_connected_account_admin_read_policies.sql`

## Manual Steps

### 1. Apply the Stage 4 policy migration
Run:

```bash
supabase db push
```

This stage relies on:
- `supabase/migrations/20260329010000_connected_account_admin_read_policies.sql`

That migration gives super admins read access to:
- `public.connected_accounts`
- `public.connection_events`

Without it, the new admin connection-event log mode will not work correctly.

### 2. No edge-function deploy is required
- Stage 4 uses existing tables, views, and Stage 1 / Stage 3 function work.

## Smoke Test

### Personal dashboard
1. Sign in as a user with one or more mock connected accounts
2. Open `/app/dashboard`
3. Confirm the `Account Health` card appears in the right column
4. Confirm:
   - all-healthy state renders when there are no failures
   - issue state renders when an account is expired/error/degraded
   - `Manage` opens `/app/settings`

### Org overview
1. Sign in as an org admin
2. Open `/app/org/:orgId/overview`
3. Confirm the org account health card renders below the stat grid
4. Confirm:
   - shared account totals are correct
   - weekly publish count is populated
   - `Manage` opens `/app/org/:orgId/admin/settings`

### Admin overview + logs
1. Sign in as a super admin
2. Open `/app/admin`
3. If unresolved `account_severity_alerts` exist, confirm the new alert panel appears below the KPI row
4. Click `View all` or `Investigate`
5. Confirm `/app/admin/logs?source=connection_events` loads connection-event rows
6. Confirm the connection-event table shows:
   - account identity
   - event type badge
   - severity badge
   - simulated badge
   - message

## Validation
- `npm run build` passes

## Remaining Work
- Stage 5: org connected-account management and member read-only org account views
- Stage 6: super-admin connected-accounts console and maintenance actions
