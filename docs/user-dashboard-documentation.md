# User Dashboard Documentation

Updated: 2026-02-17
Scope: User-facing dashboard only (`/app/dashboard`), excluding admin pages.

## 1. Page Purpose
The dashboard is the user landing page for a high-level snapshot of content activity:
- KPI counts (generated, scheduled, published, credits used)
- Recent generation activity list
- Placeholder trends card

## 2. Route and Composition
- Route: `/app/dashboard` (protected via `ProtectedRoute`)
- Parent shell: `src/App.jsx`
- Main component: `src/pages/Dashboard/UserDashboard.jsx`
- Shared shell components:
  - `src/components/User/UserNavbar.jsx`
  - `src/components/User/UserSidebar.jsx`

## 3. Runtime Behavior (As Implemented)
On mount, `UserDashboard`:
1. Calls `fetchDashboardData()`
2. Subscribes to realtime changes on `generations` and `posts`
3. Re-fetches dashboard data whenever those tables change

Data fetches:
- Current auth user (`supabase.auth.getUser()`)
- User name from `profiles.full_name`
- KPI counts:
  - `generations` total for user
  - `posts` status=`scheduled`
  - `posts` status=`posted` (currently inconsistent with schema)
- Recent generations: latest 4 rows from `generations`

Rendering:
- Header greeting and CTA button
- 4 KPI cards
- Recent activity with image/video thumbnails
- Static placeholder chart in "Performance Trends"

## 4. Schema Relationships Used
- `profiles (id -> auth.users.id)`
- `generations (user_id -> auth.users.id)`
- `posts (user_id -> auth.users.id)`

## 5. What Must Be In Place
Database and policies:
- RLS policies that allow users to read their own rows in `profiles`, `generations`, `posts`
- Indexes for performant counts and sorting:
  - `generations(user_id, created_at)`
  - `posts(user_id, status)`

Realtime:
- Realtime enabled for `generations` and `posts`
- Optional: filter realtime to the current user for lower load

Product behavior:
- A consistent `posts.status` enum shared across all user pages
- A real credits model (current value is derived placeholder)

## 6. Current Gaps and Required Fixes
P0
- Published KPI uses `posted`, but schema and other user code use `published`.
  - `src/pages/Dashboard/UserDashboard.jsx:89`

P1
- Credits used is hardcoded as `genCount * 5`, not based on persisted usage.
  - `src/pages/Dashboard/UserDashboard.jsx:103`
- CTA buttons are non-functional (`+ Create New`, `View All`).
  - `src/pages/Dashboard/UserDashboard.jsx:129`
  - `src/pages/Dashboard/UserDashboard.jsx:168`
- Realtime subscription listens to all users, then re-fetches current user data.
  - `src/pages/Dashboard/UserDashboard.jsx:53`
  - `src/pages/Dashboard/UserDashboard.jsx:54`

P2
- Mojibake text artifacts in UI strings.
  - `src/pages/Dashboard/UserDashboard.jsx:126`
  - `src/pages/Dashboard/UserDashboard.jsx:127`

## 7. Recommended Target Behavior
- Dashboard should be a navigational launchpad:
  - `+ Create New` -> `/app/generate`
  - `View All` -> filtered activity list page or calendar view
- KPI definitions should be explicit and shared (single status/constants module)
- Trends panel should use real analytics data (`platform_analytics` or summary view), not static bars

## 8. Acceptance Criteria
- Published KPI matches canonical status enum and DB rows
- Dashboard renders without placeholder-only calls to action
- Realtime updates do not cause unnecessary global refreshes
- Text rendering is clean UTF-8 across all dashboard strings
