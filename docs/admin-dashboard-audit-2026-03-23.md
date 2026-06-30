# Admin Dashboard Audit

Date: 2026-03-23

Audit basis:
- Current frontend and edge-function code in this repo
- Current Supabase migrations in `supabase/migrations/`
- Current admin routes mounted in `src/router/router.jsx`
- This audit does not yet include an external canonical schema dump from the user

Verification performed:
- `npm run build` completed successfully on 2026-03-23

## Executive Summary

The admin workspace is no longer a prototype shell. The currently mounted routes under `/app/admin` cover:

- overview
- users
- user detail
- organizations
- moderation
- complaints
- logs
- analytics
- settings

The bigger problem is not missing screens. It is model drift:

- admin scope is derived from multiple role and organization sources
- several admin screens still depend on denormalized profile data instead of the richer governance tables
- one migration family widened permissions again after later scoped policies were added
- a large legacy admin component set still exists beside the active route system

## Current Admin Surface

| Area | Current file | State | Main backing data |
| --- | --- | --- | --- |
| Overview | `src/admin/pages/AdminOverview.jsx` | Active | `profiles`, `generations`, `complaints`, `content_quality_reviews`, `posts`, `audit_logs`, `organizations` |
| Users | `src/admin/pages/AdminUsersPage.jsx` | Active | `profiles`, `organizations`, `connected_accounts`, `generations`, `posts` |
| User detail | `src/admin/pages/AdminUserDetailPage.jsx` | Active | `profiles`, `connected_accounts`, `posts`, `generations`, `complaints`, `content_quality_reviews`, `audit_logs`, `admin_notes` |
| Moderation | `src/admin/pages/AdminModeration/AdminModerationWorkspace.jsx` | Active | `posts`, `generations`, `content_quality_reviews`, `connected_accounts`, `content_library_items` |
| Complaints | `src/admin/pages/AdminComplaintsPage.jsx` | Active | `complaints`, `complaint_comments` |
| Organizations | `src/admin/pages/AdminOrgsPage.jsx` | Active | `organizations`, `profiles`, `complaints` |
| Logs | `src/admin/pages/AdminLogsPage.jsx` | Active | `audit_logs`, `profiles` |
| Analytics | `src/admin/pages/AdminAnalyticsPage.jsx` | Active | `profiles`, `generations`, `posts`, `connected_accounts`, `content_quality_reviews`, `organizations` |
| Settings | `src/admin/pages/AdminSettingsPage.jsx` | Active UI, mostly local-only | local storage, auth metadata |

## Findings

### P0

#### 1. `user_notifications` and `admin_notes` still have older broad admin policies alongside newer scoped policies

Evidence:
- `supabase/migrations/002_user_notifications.sql`
- `supabase/migrations/003_admin_notes.sql`
- `supabase/migrations/20260321153000_admin_v4_notifications_notes_and_activity.sql`

What is wrong:
- Migration `002_user_notifications.sql` creates `user_notifications_admin_insert` and `user_notifications_admin_select`.
- Migration `003_admin_notes.sql` creates `admin_notes_admin_select` and `admin_notes_admin_insert`.
- The later `20260321153000_admin_v4_notifications_notes_and_activity.sql` adds scoped replacements, but it does not drop the older policy names.
- In Postgres RLS, multiple policies are combined permissively for the same command. That means the older broad policies continue to widen access.

Impact:
- Any admin can still read all `user_notifications`.
- Any admin can still insert `user_notifications` without the later scoped `can_admin_access_user(...)` check being the only gate.
- Any admin can still read all `admin_notes`.
- Any admin can still insert `admin_notes` without the later scoped note target check being the only gate.

Suggested fix:
- Add a cleanup migration that explicitly drops the older policy names from `002_user_notifications.sql` and `003_admin_notes.sql`.
- Keep only the scoped policy set introduced in `20260321153000_admin_v4_notifications_notes_and_activity.sql`.

#### 2. Admin role and organization scope are split across too many sources

Evidence:
- `supabase/migrations/20260312153000_admin_foundation.sql`
- `supabase/migrations/20260321113000_admin_moderation_schema_alignment.sql`
- `src/services/authService.js`
- `src/admin/utils/adminClient.js`

Current sources:
- `auth.users.app_metadata.role`
- `auth.users.user_metadata.role`
- `profiles.role`
- `admin_roles.role`
- `profiles.organization_id`
- `admin_roles.organization_id`
- `organization_members.organization_id`

What is wrong:
- The code merges metadata role hints, profile role hints, and `admin_roles` data at runtime.
- The code resolves org scope from both `profiles.organization_id` and `admin_roles.organization_id`.
- The schema also carries `organization_members`, but the active admin UI does not use it as the membership source of truth.

Impact:
- Access resolution is harder to reason about.
- Backfills and fallbacks hide drift instead of eliminating it.
- Role and org bugs can present as "works in one screen, wrong in another" because different screens read different sources.

Suggested fix:
- Pick one authoritative source for admin role.
- Pick one authoritative source for org membership.
- Treat the others as derived caches or compatibility shims, not equal peers.

### P1

#### 3. Org-admin overview is only partially scoped

Evidence:
- `src/admin/pages/AdminOverview.jsx`

What is wrong:
- `profiles` queries are org-scoped.
- `complaints` are org-scoped for org admins.
- `generations`, `content_quality_reviews`, and `posts` used for platform health are not org-scoped in the same function.

Impact:
- Org admins can see mixed-scope metrics on the same page.
- "Total Users" can be org-scoped while "Generated Today", low-quality queue, and platform health are effectively platform-wide.

Suggested fix:
- Scope overview queries by the same user set for every KPI and subpanel, not only the profile-based ones.

#### 4. Complaint search can miss valid in-scope results

Evidence:
- `src/admin/utils/adminClient.js`

What is wrong:
- `searchAdminWorkspace()` fetches complaint matches with `.limit(5)` first.
- Org-admin scope filtering is then applied client-side.

Impact:
- An org admin can get zero complaint search results even when matching in-scope complaints exist beyond the first five global matches.

Suggested fix:
- Push org scope into the query itself before the limit is applied.

#### 5. Calendar rescheduling can mutate already published posts into a contradictory state

Evidence:
- `src/admin/components/AdminUserCalendar.jsx`
- `src/admin/utils/adminClient.js`

What is wrong:
- `AdminUserCalendar` allows edit mode for published posts.
- `updateAdminPostSchedule()` preserves `status = "published"` while writing a new future `scheduled_at` value when the current post is already published.

Impact:
- A published post can end up with a future schedule timestamp while still marked published.
- That weakens the status contract used by calendar, moderation, and downstream analytics.

Suggested fix:
- Either block schedule edits for published posts or convert them into a new draft/scheduled copy.

#### 6. Some admin writes do not validate their database result

Evidence:
- `src/admin/utils/adminClient.js`

Examples:
- `updateAdminUserStatus()` checks the `profiles` update but does not inspect the `user_status_events` insert result.
- `requestUserDeletion()` checks the `admin_action_requests` insert but does not inspect the follow-up `profiles` update result.

Impact:
- The UI can report success while audit or lifecycle side effects silently fail.

Suggested fix:
- Check and handle every returned `{ error }` object for multi-step admin actions.

#### 7. The admin workspace does not fully support the canonical `publishing` post status

Evidence:
- `src/constants/statuses.js`
- `src/admin/pages/AdminModeration/moderationApi.js`
- `src/admin/utils/adminClient.js`

What is wrong:
- The canonical status list includes `publishing`.
- Admin moderation status filters do not include it.
- `getStatusMeta()` falls back to Draft for any unhandled status.
- `fetchUserCalendarPosts()` excludes `publishing` rows entirely.

Impact:
- A real `publishing` row is either hidden or mislabeled in admin surfaces.

Suggested fix:
- Add `publishing` everywhere the admin UI enumerates post lifecycle states.

#### 8. Force schedule/publish can overwrite an existing non-draft post for the same generation and account

Evidence:
- `src/admin/pages/AdminModeration/moderationApi.js`

What is wrong:
- `forceModerationAction()` reuses an existing post when `account_id` matches the target account, even before checking whether the reusable row is still a draft.

Impact:
- A previously published or historically scheduled row can be overwritten in place.
- That weakens content history and makes `content_versions` less meaningful.

Suggested fix:
- Only reuse draft rows automatically.
- Create a new row when the existing matched row is already terminal or historically significant.

### P2

#### 9. There is a large legacy admin component island that is no longer mounted

Evidence:
- Unused legacy panels and helpers under:
  - `src/admin/components/UserListPanel/`
  - `src/admin/components/UserDetailsPanel/`
  - `src/admin/components/ContentManager/`
  - `src/admin/components/ContentModeration/`
  - `src/admin/utils/apiService.js`
  - `src/admin/utils/mockService.js`

What is wrong:
- The active routed admin system now uses `AdminUsersPage`, `AdminUserDetailPage`, and `AdminModerationWorkspace`.
- The older panel-based admin system still exists and carries stale assumptions.

Impact:
- Code review is slower.
- Documentation is harder to trust.
- Future edits may land in the wrong layer.

Suggested fix:
- Either remove the legacy island or move it under an explicit `legacy/` folder.

#### 10. Some admin files are placeholders or dead shells

Confirmed examples:
- `src/admin/adminRoutes.jsx` is empty
- `src/admin/components/ContentCharts/ContentCharts.jsx` is empty
- `src/admin/components/ContentModeration/ContentReviewModal.jsx` is empty
- `supabase/functions/adminStats/index.ts` is empty

Impact:
- These files signal capabilities that do not actually exist.

Suggested fix:
- Delete them, implement them, or mark them clearly as backlog placeholders.

#### 11. `AdminDashboard.jsx` is dead code and would not compile if reactivated

Evidence:
- `src/admin/AdminDashboard.jsx`

What is wrong:
- It renders `AdminLayout` but does not import it.
- It is not part of the current router, so the problem is hidden.

Impact:
- The file looks reusable but is not viable.

Suggested fix:
- Remove it or repair it before anyone tries to revive it.

#### 12. Admin settings are mostly local-only and not connected to runtime behavior

Evidence:
- `src/admin/pages/AdminSettingsPage.jsx`

Examples:
- `defaultPageSize`
- `realtimeNotifications`
- `showUnreadOnly`
- `notificationTypes`

Impact:
- The settings page looks functional, but most preferences are not consumed by the rest of the admin workspace.

Suggested fix:
- Either wire these preferences into the relevant screens or label them as local preview settings.

#### 13. Admin notification center has a reader but no clear producer path in the repo

Evidence:
- `src/admin/utils/adminClient.js` reads and updates `admin_notifications`
- The repo audit did not find any active insert path for `admin_notifications`

Impact:
- The navbar bell can stay empty unless rows are inserted manually or by an external process not represented here.

Suggested fix:
- Document the producer path or add it to the repo.

## Lower-Severity Observations

- `AdminUsersPage` realtime patching updates and removes visible rows, but it does not add newly inserted matching profiles to the current page cache.
- `AdminAnalyticsPage` only samples up to 200 quality reviews for distribution, which will drift as data volume grows.
- `AdminOverview` computes platform health `severity`, but the current UI does not render that severity signal.
- `fetchModerationFilterOptions()` returns an `admins` list that the current moderation workspace does not use.

## Recommended Fix Order

1. Clean up duplicate RLS policies on `user_notifications` and `admin_notes`.
2. Choose one canonical source for admin role and one canonical source for org membership.
3. Make org-admin overview queries fully scope-consistent.
4. Normalize admin post lifecycle handling to include `publishing`.
5. Block or redesign published-post rescheduling.
6. Tighten multi-step admin action error handling.
7. Reduce the legacy admin island so future work happens in one active path.

## Follow-Up When the Canonical SQL Schema Is Provided

Once the external schema is pasted, the next pass should explicitly diff:

- repo migrations vs canonical schema
- policy names that still exist in the live database vs policy names intended by the latest migrations
- whether `organization_members` or `profiles.organization_id` is supposed to be canonical
- whether `admin_roles.role` or auth metadata is supposed to be canonical for redirects and access checks
