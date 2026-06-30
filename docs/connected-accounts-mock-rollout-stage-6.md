# Connected Accounts Mock Rollout — Stage 6

## Summary

Stage 6 adds the super-admin connected-accounts console at `/app/admin/accounts`.

This stage ships:

- platform-wide KPI tiles from `platform_account_health_overview`
- unresolved account alert handling with investigate and resolve actions
- a full connected-accounts table with filters for status, scope, platform, health, and search
- a right-side maintenance panel with:
  - overview
  - event log
  - admin action history
  - support note logging
  - member-access management for org-scoped accounts
- the `admin-account-action` edge function for:
  - `force_reconnect`
  - `clear_failures`
  - `reset_health`
  - `force_disconnect`
  - `resolve_alert`
  - `support_note`
  - `set_member_access`

The console is super-admin only. Org admins do not get the route or nav item.

## Files Added

- `src/admin/pages/AdminAccountsPage.jsx`
- `src/admin/components/AccountMaintenancePanel.jsx`
- `src/admin/styles/AdminAccounts.css`
- `supabase/functions/admin-account-action/index.ts`

## Files Updated

- `src/router/router.jsx`
- `src/admin/utils/rbac.js`
- `src/admin/components/AdminSidebar/AdminSidebar.jsx`
- `src/org/components/GrantAccessModal.jsx`

## Behavior Notes

- Force disconnect uses the compatibility-safe raw status `revoked`.
- Force reconnect regenerates mock token fields and clears failure state.
- Clear failures resolves open repeated-failure alerts for the account.
- Support notes are stored in `admin_account_actions`.
- Organization shared-account member access is now editable from the super-admin console through the same modal pattern used in org settings, but saved through the admin edge function instead of client RLS writes.

## Manual Steps

1. Deploy the new edge function:

   ```bash
   supabase functions deploy admin-account-action
   ```

2. Make sure the connected-account migrations are already applied, especially:

   - `supabase/migrations/20260328000000_connected_accounts_foundation.sql`
   - `supabase/migrations/20260328006000_admin_accounts_views.sql`
   - `supabase/migrations/20260329010000_connected_account_admin_read_policies.sql`

3. Log in as a super admin and verify:

   - `/app/admin/accounts` loads
   - the `Accounts` nav item appears in the admin sidebar
   - unresolved alerts can be investigated and resolved
   - `Force Reconnect`, `Clear Failures`, `Reset Health`, and `Force Disconnect` all return successful responses
   - org-scoped accounts can open `Manage access`

## Validation

- `npm run build`
