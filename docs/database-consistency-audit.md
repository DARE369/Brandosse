# Database Consistency Audit (2026-02-20)

## 1) Runtime Errors Fixed

- Fixed `brand_kit` duplicate key race (`brand_kit_user_id_key`):
  - Root cause: parallel `loadBrandKit()` calls were doing `insert` after `maybeSingle()`.
  - Fix: switched to atomic `upsert(..., { onConflict: 'user_id' })` in `src/stores/BrandKitStore.js`.

- Fixed post notifications query failure (`posts.updated_at does not exist`):
  - Root cause: `UserNavbar` ordered posts by `updated_at`, but `posts` table has no `updated_at` column.
  - Fix: query now uses `created_at` and computes notification timestamp from `published_at`, `scheduled_at`, or `created_at` in `src/components/User/UserNavbar.jsx`.

- Fixed another posts schema mismatch:
  - Root cause: `UserNavbar` selected `connected_account_id` (column not present in current schema).
  - Fix: removed `connected_account_id` from select and use `account_id` only.

- Fixed Brand Kit page shell/layout:
  - Root cause: Brand Kit page rendered outside dashboard shell (no navbar/sidebar, poor scrolling UX).
  - Fix: wrapped page in `dashboard-shell` with `UserNavbar`, `UserSidebar`, and `dashboard-content` in `src/pages/Settings/BrandKitPage.jsx`.

- Fixed status string mismatches (`posted` vs `published`) in admin flows:
  - Updated admin status writes/filters to use `published` in:
    - `src/admin/utils/apiService.js`
    - `src/admin/components/ContentModeration/PublicationModal.jsx`
    - `src/admin/components/ContentModeration/ModerationQueue.jsx`
    - `src/admin/components/ContentModeration/FilterBar.jsx`
    - `src/admin/components/ContentManager/StatusBadge.jsx`
    - `src/admin/components/ContentManager/ContentSchedulerTimeline.jsx`
    - `src/admin/components/ContentManager/ContentFilterBar.jsx`

- Fixed video preview fallback for legacy invalid provider URLs:
  - `video.pollinations.ai` URLs are replaced with a known working fallback URL when rendering previews:
    - `src/components/Generate/BatchGenerationGrid.jsx`
    - `src/components/Generate/PostProductionPanel.jsx`

- Fixed calendar realtime subscription runtime error:
  - Root cause: `subscribeToUpdates()` destructured `supabase.auth.getUser()` without `await`.
  - Fix: removed the invalid destructuring call in `src/stores/CalendarStore.js`.

## 2) Schema -> Code Usage Mapping

Tables actively used by app code (Supabase queries present):
- `profiles`
- `sessions`
- `generations`
- `posts`
- `connected_accounts`
- `calendar_settings`
- `ghost_slots`
- `content_pillars`
- `optimal_posting_times`
- `trending_topics`
- `user_settings`
- `brand_kit`
- `brand_assets`
- `content_plans`

Tables in schema that appear legacy or not currently queried by runtime app code:
- `admin_keys`
- `admin_logs`
- `analytics_summary`
- `generated_content`
- `generation_assets`
- `generation_metadata`
- `generation_sessions`
- `moderation_queue`
- `platforms`
- `scheduled_generations`

Potentially active but indirect relationship usage:
- `platform_analytics` is read via nested relation from `posts` in `src/services/OptimalTimesService.js`.

## 3) Relationship Consistency Check

Relationships aligned with code paths:
- `posts.generation_id -> generations.id` (used across calendar/admin/post-production)
- `posts.account_id -> connected_accounts.id` (used by notification/account lookups)
- `posts.user_id -> auth.users.id` (all user-scoped queries)
- `generations.session_id -> sessions.id` (session history and generation grouping)
- `generations.content_plan_id -> content_plans.id` (pipeline + SEO panel)
- `brand_assets.brand_kit_id -> brand_kit.id` (asset upload and management)

Observed legacy/parallel modeling to review:
- `generated_content`, `generation_sessions`, and `generations` overlap conceptually.
- `scheduled_generations` overlaps with `posts` scheduling semantics.
- `platforms` table appears legacy relative to text platform keys now stored directly.

## 4) Mock Data Still Present (Documented)

The following are still mock-driven and not fully DB-truth source-of-record flows:
- `src/services/MockOAuthService.js`
  - Generates synthetic usernames/avatars/tokens/metadata.
- `src/admin/components/ContentManager/ContentSchedulerTimeline.jsx`
  - Uses hardcoded in-memory `mockPosts`.
- `src/admin/utils/mockAnalyticsExtended.js`
  - Provides mock analytics data consumed by admin analytics UI.

## 5) Inconsistencies Remaining (Not Yet Refactored)

- Deprecated generation state layer (`src/pages/GeneratePage/state/...`) remains in tree; packet marked it deprecated but not removed.
- `src/services/MockOAuthService.js` remains in repository and should be removed once live OAuth is wired.

## 6) Recommended Next Cleanup Steps

1. Add live OAuth connect flow and remove `src/services/MockOAuthService.js` once no longer needed.
2. Remove hardcoded mock timeline/analytics datasets and point those views to real tables.
3. Plan migration/deprecation for legacy tables (`generated_content`, `generation_sessions`, `scheduled_generations`, etc.) after confirming no external consumers.
4. Remove deprecated `GeneratePage/state` services after final import verification.
