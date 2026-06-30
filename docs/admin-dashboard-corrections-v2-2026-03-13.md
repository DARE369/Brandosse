# Admin Dashboard Corrections v2

Updated: 2026-03-13

## What Was Fixed

- Fixed the admin access recursion failure caused by `admin_roles` RLS helpers calling back into `admin_roles`.
- Added short-lived caching to `getUserProfileAndRole()` so protected admin routes stop repeating the same role-resolution query during one navigation.
- Replaced native browser dialogs in the admin codebase (`window.alert`, `window.confirm`, `window.prompt`) with in-app admin flows or toast confirmations.
- Added `SuspendUserModal.jsx` and wired it into the active admin user directory and admin user detail page.
- Fixed admin profile menu settings links so they stay inside `/app/admin/settings`.
- Fixed the super admin scope label so it shows `Platform-wide` instead of `No admin scope`.
- Replaced the full-width sidebar footer collapse button with the compact icon-only rail toggle.
- Reworked `AdminUsersPage.jsx` to:
  - avoid full-page reload refreshes
  - cache list state across route revisits
  - update visible rows from Supabase realtime profile changes
  - show inline password-reset success/error state
  - count generations from `generations`, not from `posts`
- Reworked `AdminUserDetailPage.jsx` to use the same admin action model:
  - in-app suspension flow
  - visible password-reset state
  - compact security/actions layout
  - better connected-platform and activity sections
- Replaced the placeholder admin settings page with a real `/app/admin/settings` surface:
  - Profile
  - Security
  - Preferences
  - Notifications
- Added shared admin styles for:
  - modal layout
  - warning actions
  - settings tabs
  - profile menu scope/meta
  - activity cards
  - row-level action feedback

## Database Work You Need To Run

Run these migrations in order if they are not already applied:

1. `supabase/migrations/20260312153000_admin_foundation.sql`
2. `supabase/migrations/20260313090000_admin_rls_recursion_hotfix.sql`
3. `supabase/migrations/20260313103000_profiles_contact_and_activity_backfill.sql`

### Why the new backfill migration matters

`20260313103000_profiles_contact_and_activity_backfill.sql` does two things for existing users:

- backfills `profiles.email` from `auth.users.email`
- backfills `profiles.last_active_at` from the latest known generation/post activity

Then it refreshes `profiles.activity_status`.

## Verification Completed

- `npm run build`
- no remaining `window.alert`, `window.confirm`, or `window.prompt` calls inside `src/admin`

## What To Test On Your Side

1. Log in as a normal user and confirm redirect to `/app/dashboard`.
2. Log in as an admin and confirm redirect to `/app/admin`.
3. Open `/app/admin/users` and verify:
   - rows load without hanging
   - suspend opens the in-app modal
   - password reset shows success/error state inline
   - refresh does not reload the whole browser tab
4. Open `/app/admin/users/:id` and verify:
   - security actions do not use browser dialogs
   - settings links in the profile menu stay inside `/app/admin/settings`
5. Open `/app/admin/settings` and confirm all four tabs render.

## Not Fully Shipped In This Pass

These packet items still need a follow-up implementation pass:

- full moderation table redesign and drawer workflow
- system logs page redesign/grouping work
- navbar global search against users/posts/complaints
- platform health widget redesign
- generation volume chart rebuild
- automatic Grok media analysis on admin uploads

This pass focused on the breakages and P0 usability issues first.
