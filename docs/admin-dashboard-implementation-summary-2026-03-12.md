# Admin Dashboard Implementation Summary

Updated: 2026-03-12

## What was implemented

This pass ships the admin foundation and the main frontend rebuild needed to move the current admin area toward the packet spec.

### Database / Supabase

Added migration:

- `supabase/migrations/20260312153000_admin_foundation.sql`
- `supabase/migrations/20260313090000_admin_rls_recursion_hotfix.sql`

This migration adds:

- `organizations`
- `organization_members`
- `admin_roles`
- `user_status_events`
- `complaints`
- `complaint_comments`
- `content_quality_reviews`
- `content_versions`
- `admin_action_requests`
- `audit_logs`
- `admin_notifications`

It also adds admin-related columns to:

- `profiles`
  - `organization_id`
  - `last_active_at`
  - `activity_status`
  - `suspension_type`
  - `suspension_expires_at`
  - `deletion_requested_at`
  - `deletion_eligible_at`
- `posts`
  - `moderation_status`
  - `flagged_by_admin_id`
  - `force_published_by`
  - `delete_reason`
  - `quality_review_id`

It also introduces:

- scoped admin helper SQL functions
  - `get_admin_role`
  - `get_admin_organization_id`
  - `is_admin_user`
  - `is_super_admin_user`
  - `can_admin_access_organization`
  - `can_admin_access_user`
- audit log write helper
  - `write_audit_log(...)`
- profile activity helpers
  - `touch_profile_last_active()`
  - `refresh_profile_activity_statuses()`
- audit log immutability trigger protection
- RLS alignment for admin-scoped access on core/admin tables
- legacy backfill from `profiles.role = 'admin' | 'super_admin' | 'org_admin'` into `admin_roles`

### Frontend / Admin shell

Rebuilt the admin shell around a real admin access model:

- role-aware admin access hook
- persisted sidebar collapse state via `admin-sidebar-collapsed`
- new sidebar nav for:
  - Overview
  - Users
  - Organizations
  - Moderation
  - Complaints
  - Analytics
  - System Logs
  - Settings
- org-aware scope label in the shell
- debounced navbar search across users, posts, complaints
- admin notification dropdown
- admin profile menu

### Frontend / Pages

Reworked or added these routes:

- `/app/admin`
- `/app/admin/users`
- `/app/admin/users/:userId`
- `/app/admin/organizations`
- `/app/admin/organizations/:orgId`
- `/app/admin/moderation`
- `/app/admin/complaints`
- `/app/admin/complaints/:complaintId`
- `/app/admin/analytics`
- `/app/admin/logs`
- `/app/admin/settings`

Also added a redirect from the legacy moderation path:

- `/app/admin/content/review` -> `/app/admin/moderation`

### Shared admin components

Added:

- `ActivityStatusBadge`
- `QualityScoreBadge`
- `AdminNotificationCenter`
- `AdminProfileMenu`
- `useAdminAccess`
- `useDebouncedValue`
- `useLocalPersist`
- shared admin formatting + RBAC utilities

Also fixed the `SocialMediaTile` prop mismatch so it can accept both:

- `account={...}`
- legacy individual props

### Auth / routing updates

Updated admin detection so the app recognizes:

- `super_admin`
- `org_admin`
- legacy `admin`

This affects:

- protected admin route checks
- post-auth redirects
- role resolution in auth service
- last active timestamp update on sign-in

This pass also hardens role detection so login routing still works if the admin migration has not finished yet.

- missing `profiles.organization_id`
- missing legacy `profiles.is_admin`
- missing `admin_roles`

The app now falls back cleanly to legacy `profiles.role` markers instead of dropping admins into the user path.

## Important implementation note

This pass does **not** add the full Supabase Edge Function suite from the packet yet.

Current behavior:

- admin frontend pages use direct Supabase client queries/mutations
- access control is expected to come from the new RLS + scope helper functions in the migration

That means the core admin UI is now wired for the new schema, but the dedicated edge functions listed in the packet are still a follow-up item.

## What you need to do on your end

### 1. Apply the migration

Run the new migration against your Supabase project.

If you use the Supabase CLI:

```bash
supabase db push
```

Or apply:

- `supabase/migrations/20260312153000_admin_foundation.sql`

from the Supabase SQL editor.

If your earlier run failed partway through, rerun the updated file from the top. It is written to be rerunnable.

Important fix in the updated SQL:

- legacy `admin_roles` backfill now skips orphaned `profiles` rows that do not exist in `auth.users`
- `profiles` now has an explicit self-insert RLS policy so signup / OAuth fallback profile creation does not break after RLS is enabled
- admin helper functions now run as `SECURITY DEFINER` to prevent recursive RLS evaluation on `admin_roles` / `profiles`

The specific error you hit means at least one row exists in `public.profiles` whose `id` is not present in `auth.users`.

You can inspect those rows with:

```sql
select p.id, p.email, p.role
from public.profiles p
left join auth.users u on u.id = p.id
where u.id is null;
```

Those rows are now ignored by the admin role backfill, but you should still review whether they are stale data that should be cleaned up manually.

If admin pages are loading indefinitely and the browser console shows `stack depth limit exceeded` for `admin_roles`, apply the hotfix migration too:

- `supabase/migrations/20260313090000_admin_rls_recursion_hotfix.sql`

That error means the original helper functions were being called from RLS policies and recursively querying `admin_roles` again during policy evaluation.

### 2. Create at least one organization

The new org-scoped admin model assumes real organization rows exist.

Minimum required:

- create at least one row in `organizations`
- assign relevant users in `profiles.organization_id`

### 3. Assign admin roles

You need real rows in `admin_roles` for the admins you want to use.

Examples:

- `super_admin` for platform-wide admins
- `org_admin` with `organization_id` for tenant-scoped admins

Notes:

- if you already used `profiles.role = 'admin'`, the migration backfills those users into `admin_roles` as `super_admin`
- for proper org scoping, you still need to set `organization_id`

### 4. Validate RLS access with a real admin account

After migration, test these:

- super admin can access all `/app/admin/*` routes
- org admin only sees users/content/complaints inside their org
- normal users cannot access `/app/admin/*`

### 5. Seed some data if you want the pages to look populated

The new pages will be much more useful if you already have rows in:

- `connected_accounts`
- `complaints`
- `audit_logs`
- `content_quality_reviews`
- `admin_notifications`

Without those, the pages still work, but several sections will show empty states.

## What you will need

- Supabase project access with permission to run SQL migrations
- at least one admin user id from `auth.users`
- organization seed data
- profile rows mapped to `organization_id`
- real or mock complaint / quality / notification data if you want to exercise all routes

## Recommended next steps

Highest value follow-up items:

1. Implement the admin edge functions from the packet and move sensitive mutations off direct client calls.
2. Add real quality-score generation flow and auto-scoring hooks.
3. Finish complaint assignment/SLA automation.
4. Add full approval-chain flows for deletion / high-risk actions.
5. Add org admin provisioning UI instead of manual SQL seeding.
