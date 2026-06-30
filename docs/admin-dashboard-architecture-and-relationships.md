# Admin Dashboard Architecture and Relationship Reference

Historical note:
- This document is still useful for background context, but parts of it are now stale.
- For the current 2026-03-23 audit, see `docs/admin-dashboard-audit-2026-03-23.md`.
- For the current relationship review, see `docs/admin-dashboard-database-relationship-audit-2026-03-23.md`.

Updated: 2026-03-12  
Audience: Claude or any engineer extending the admin workspace  
Scope: Admin routes under `/app/admin/*`, the shared platform data model, and the relationship between admin surfaces, the user dashboard, and the broader user workspace.

## 1. Purpose of This Document

This document describes the admin dashboard as it exists in the codebase today, not as a generic idealized admin panel.

It is meant to answer four questions:

1. What the admin workspace is supposed to control.
2. What each admin route currently does in code.
3. Which user-facing pages and database entities it is actually connected to.
4. Which parts are real, mocked, placeholder-only, or partially wired so Claude can improve the correct layer.

This is intentionally detailed because the admin system sits on top of the same data model used by the user dashboard, generate workflow, calendar, library, settings, and notifications.

## 2. Executive Summary

The app has one protected application shell at `/app`, with two role-aware workspaces inside it:

- User workspace: `/app/dashboard`, `/app/generate`, `/app/calendar`, `/app/library`, `/app/settings`, `/app/settings/brand-kit`
- Admin workspace: `/app/admin`, `/app/admin/users`, `/app/admin/content/review`, `/app/admin/analytics`, `/app/admin/logs`

The admin workspace is not a separate product. It is an operational layer over the same underlying records that users create and manage:

- `profiles`
- `sessions`
- `generations`
- `posts`
- `connected_accounts`
- `content_library_items`
- `media_assets`
- related planning tables

Current reality:

- Admin overview is backed by real Supabase counts and realtime refreshes.
- Admin users page is backed by real profile/account data and exposes account-level actions.
- Admin moderation is backed by real `generations` and `posts` data and can edit, schedule, publish, or delete content.
- Admin analytics is mock-driven.
- Admin logs is a placeholder.
- Several admin child components exist but are not wired into active routes.

## 3. Top-Level Routing and Access Model

### 3.1 Route topology

Primary route registration lives in `src/router/router.jsx`.

Public routes:

- `/`
- `/login`
- `/register`
- `/auth/callback`

Protected app shell:

- `/app`

Protected user routes under `/app`:

- `/app/dashboard`
- `/app/generate`
- `/app/generate/:sessionId`
- `/app/calendar`
- `/app/library`
- `/app/settings`
- `/app/settings/brand-kit`

Protected admin routes under `/app/admin`:

- `/app/admin` -> overview
- `/app/admin/users`
- `/app/admin/content/review`
- `/app/admin/analytics`
- `/app/admin/logs`

### 3.2 Role resolution

Role resolution is handled by:

- `src/services/authService.js`
- `src/utils/authRouting.js`
- `src/utils/protectedRoute.jsx`
- `src/utils/PostAuthRedirect.jsx`

The app determines whether a user is an admin by merging:

- `auth.users.app_metadata.role`
- `auth.users.user_metadata.role`
- `auth.users.*.is_admin`
- `profiles.role`
- `profiles.is_admin` if present

The canonical normalized roles are:

- `admin`
- `user`

### 3.3 Post-login default destinations

Post-login redirect behavior:

- regular user -> `/app/dashboard`
- admin -> `/app/admin`

That behavior is implemented by `resolvePostAuthPath()` in `src/utils/authRouting.js`.

### 3.4 Route guards

`ProtectedRoute` enforces:

- auth required for all `/app/*`
- admin role required for `/app/admin/*`
- non-admin attempts to open admin routes are redirected to `/app/dashboard`

Important relationship detail:

- Admin users can still access normal user routes because the user routes only require authentication, not non-admin role.
- This means an admin account can experience both the user dashboard and the admin workspace.

## 4. Shared Database and Security Contract

### 4.1 Core shared entities

The admin and user workspaces are both reading and mutating the same domain records.

| Entity | Purpose | Primary user surfaces | Primary admin surfaces | Notes |
| --- | --- | --- | --- | --- |
| `profiles` | identity, role, credits, status, avatar, email mirror | dashboard shell, navbar, settings | overview, users | central identity anchor |
| `sessions` | generation session containers | generate | indirect only | used for generation grouping and deep links |
| `generations` | AI generation outputs and prompt history | dashboard, generate, moderation, library | overview, moderation, user manager | canonical creation artifact |
| `posts` | draft, scheduled, publishing, published, failed lifecycle | calendar, dashboard KPIs, navbar notifications, library | overview, moderation, analytics assumptions | canonical publishing lifecycle |
| `connected_accounts` | linked social destinations | settings, dashboard account health, publish flow | user details, moderation context | active in code, not versioned in current migrations present here |
| `content_library_items` | library indexing layer for posts/media/templates | library | indirect impact from moderation deletes | populated by triggers |
| `media_assets` | uploaded media library | library | indirect only | not surfaced in current admin routes |
| `content_templates` | reusable caption/template assets | library | not surfaced in current admin routes | optional table |
| `brand_kit` / `brand_assets` | user brand system | brand kit | not surfaced in current admin routes | admin currently has no brand kit view |
| `calendar_settings`, `ghost_slots`, `optimal_posting_times`, `trending_topics` | scheduling intelligence | calendar | only indirectly via analytics/moderation context | not directly surfaced in active admin pages |

### 4.2 Canonical lifecycle statuses

From `src/constants/statuses.js`:

Generation lifecycle:

- `processing`
- `completed`
- `failed`

Post lifecycle:

- `draft`
- `scheduled`
- `publishing`
- `published`
- `failed`

These statuses matter because both the user and admin dashboards assume them.

### 4.3 Admin RLS visibility

`supabase/migrations/20260227103000_generation_post_unification_and_rls.sql` defines:

- `public.is_admin_user(p_user_id uuid)`
- admin-aware policies for `sessions`, `generations`, `posts`, `content_plans`
- admin-aware policies for `media_assets`, `content_templates`, `content_library_items`

Core policy pattern:

- user can access own rows
- admin can access all rows through `public.is_admin_user(auth.uid())`

This is the foundational reason the admin workspace can inspect cross-user data without bypassing the normal table model.

### 4.4 Important trigger behavior

The biggest shared lifecycle rule is:

- when a generation becomes `completed`, the DB auto-creates a `posts` row with `status='draft'`

This is implemented by `public.ensure_draft_post_for_generation()` and the triggers:

- `generations_to_draft_post_insert`
- `generations_to_draft_post_update`

This matters because:

- users generate content in the creation flow
- calendar and library operate on `posts`
- admin moderation wants one unified content lifecycle view

So the bridge between user creation and admin moderation is not just UI logic. It is a database trigger contract.

### 4.5 Library side effects

`supabase/migrations/20260227090000_calendar_library_alignment.sql` also adds:

- `content_library_items`
- `create_library_item_from_post()` trigger
- `create_library_item_from_media()` trigger

Meaning:

- a `posts` insert can automatically create a library item
- deleting a post can cascade to its library item

This is important for admin moderation and user library consistency.

## 5. Admin Workspace Structure

### 5.1 Shell

Active admin shell files:

- `src/admin/AdminLayout.jsx`
- `src/admin/components/AdminSidebar/AdminSidebar.jsx`
- `src/admin/components/AdminNavbar/AdminNavbar.jsx`
- `src/admin/styles/AdminShell.css`

Shell responsibilities:

- responsive two-column admin layout
- collapsible sidebar
- top navbar with contextual title/description per route
- tablet/mobile backdrop behavior

Admin sidebar navigation entries:

- Overview
- Users
- Moderation
- Analytics
- Logs

Navbar behavior:

- title and description change based on current admin pathname
- search input changes placeholder by route
- search input is cosmetic only right now
- notifications button is cosmetic only
- avatar is cosmetic only

### 5.2 Route summary matrix

| Route | Main file | Data source | Status |
| --- | --- | --- | --- |
| `/app/admin` | `src/admin/pages/AdminOverview.jsx` | real Supabase queries + realtime | active |
| `/app/admin/users` | `src/admin/pages/AdminUsersPage.jsx` | real Supabase queries + realtime | active |
| `/app/admin/content/review` | `src/admin/pages/AdminModeration/AdminModerationPage.jsx` | real Supabase queries + realtime | active |
| `/app/admin/analytics` | `src/admin/pages/AdminAnalyticsPage.jsx` | mock service | partially active |
| `/app/admin/logs` | `src/admin/pages/AdminLogsPage.jsx` | none | placeholder |

## 6. Admin Overview Page

### 6.1 Files

- `src/admin/pages/AdminOverview.jsx`
- `src/admin/utils/apiService.js`
- `src/admin/components/KpiCard/KpiCard.jsx`

### 6.2 What it does

This is the top-level admin dashboard landing page.

It loads:

- KPI cards via `fetchKpis()`
- a 30-day generations chart via `fetchGenerationsChart(30)`

### 6.3 KPI definitions

Current overview KPIs:

- Total Users
- Total Generated
- Scheduled & Published
- Conversion Rate (`(scheduled + published) / total generations`)

These are global platform metrics, not per-user metrics.

### 6.4 Data sources

`fetchKpis()` queries:

- `profiles`
- `generations`
- `posts where status = scheduled`
- `posts where status = published`

`fetchGenerationsChart()` queries:

- `generations.created_at` over the last N days

### 6.5 Realtime behavior

Admin overview subscribes to global changes on:

- `profiles`
- `generations`
- `posts`

Any change triggers a full reload of the KPI cards and chart.

### 6.6 Relationship to the user dashboard

The admin overview is the global counterpart of the user dashboard KPI area:

- user dashboard KPI cards are user-scoped
- admin overview KPI cards are platform-scoped

Relationship summary:

- user dashboard answers: "What is happening for me?"
- admin overview answers: "What is happening across everyone?"

Shared tables:

- `profiles`
- `generations`
- `posts`

### 6.7 Current limitations

- no date range selector
- no drill-down from KPI cards to a filtered page
- no per-platform breakdown
- no segmentation by role, account status, or plan
- full reload on every subscribed table event

## 7. Admin Users Page

### 7.1 Files

- `src/admin/pages/AdminUsersPage.jsx`
- `src/admin/components/UserListPanel/UserListPanel.jsx`
- `src/admin/components/UserListPanel/UserListRow.jsx`
- `src/admin/components/UserDetailsPanel/UserDetailsPanel.jsx`
- `src/admin/components/UserDetailsPanel/SocialMediaTile.jsx`
- `src/admin/components/ContentManager/ContentManager.jsx`
- `src/admin/components/ContentAnalytics/ContentAnalytics.jsx`

### 7.2 What it does

This page is the account-operations surface for admins.

Layout:

- left panel -> searchable user list
- right panel -> selected user details

### 7.3 User list behavior

Data source:

- `profiles.select("*").order("created_at", { ascending: false })`

Mapped fields:

- id
- name
- email
- avatar
- status
- role
- created_at

List-side functionality:

- local name/email search
- select user
- highlight selected row
- realtime refresh on `profiles` changes

### 7.4 User details panel behavior

Tabs:

- `overview`
- `manager`
- `analytics`

#### Overview tab

Current responsibilities:

- large user identity header
- connected accounts list
- placeholder recent activity block
- danger zone actions

Connected accounts query:

- `connected_accounts.select("id, platform, account_name").eq("user_id", user.id)`

Danger zone actions:

- suspend / unsuspend user by updating `profiles.status`
- send password reset email via `supabase.auth.resetPasswordForEmail`
- delete profile row from `profiles`

#### Manager tab

This embeds `ContentManager` for the selected user.

Capabilities:

- query that user's `generations`
- filter by prompt search and generation status
- open metadata edit drawer
- placeholder regenerate action

The manager tab is generation-centric, not post-centric.

#### Analytics tab

This embeds `ContentAnalytics`.

Current behavior:

- static demo chart
- static sample platform totals
- does not query real data
- does not actually use the `user` prop passed into it

### 7.5 Relationship to user-facing areas

This page is the closest admin surface to an actual user account.

It relates directly to:

- user dashboard identity and greeting via `profiles`
- user settings account connections via `connected_accounts`
- user generate history via `generations`
- user moderation/editability via generation metadata

It does not currently expose:

- user brand kit
- user library assets
- user calendar settings
- user notification history

### 7.6 Important caveats

Current implementation gaps on this page:

- `SocialMediaTile` expects an `account` prop, but `UserDetailsPanel` passes `platform`, `username`, and `status` separately. That means connected-account tiles are not wired correctly and can break when accounts exist.
- "Recent Activity" is placeholder-only.
- "Delete Account" only deletes the row in `profiles`; it does not delete the underlying `auth.users` record. That can leave an authenticated user without a profile row.
- Password reset points to `/reset-password`, but no route for that path exists in the current router.
- Content analytics inside the user details panel is static.

## 8. Content Manager Subsystem

This subsystem is not a standalone route, but it is a functional admin feature inside the user details panel.

### 8.1 Files

- `src/admin/components/ContentManager/ContentManager.jsx`
- `src/admin/components/ContentManager/ContentDataGrid.jsx`
- `src/admin/components/ContentManager/MetadataEditDrawer.jsx`

### 8.2 What it does

It lets an admin inspect a selected user's `generations` records.

Fetched data shape combines:

- generation row
- joined profile data via manual second query

Displayed columns:

- media preview
- user name/email
- prompt snippet
- caption summary
- generation status
- created date
- actions

### 8.3 Available actions

- edit -> opens metadata drawer
- regen -> placeholder alert only

### 8.4 Save behavior

The edit drawer currently updates the `generations` row:

- `prompt`
- `storage_path`
- `metadata.caption`
- `metadata.hashtags`

### 8.5 Caveats

- the drawer includes `scheduled_at`, but save logic does not persist it
- realtime subscription watches only `generations`
- content manager is generation-level admin tooling, not post lifecycle tooling
- regenerate is not implemented

## 9. Admin Moderation Page

### 9.1 Files

- `src/admin/pages/AdminModeration/AdminModerationPage.jsx`
- `src/admin/components/ContentModeration/FilterBar.jsx`
- `src/admin/components/ContentModeration/ModerationQueue.jsx`
- `src/admin/components/ContentModeration/PublicationModal.jsx`
- `src/admin/components/ContentModeration/EditModal.jsx`
- `src/admin/components/ContentModeration/PreviewPane.jsx`

### 9.2 What it is

This is the strongest operational admin surface in the current codebase.

It creates a unified cross-user content view by combining:

- `generations` as draft-like content sources
- `posts` as explicit publishing lifecycle records
- `profiles` for user identity
- linked `generations` for post media lookup

### 9.3 How the page normalizes content

The page does not rely on a DB view. It builds a client-side unified content list.

Normalization flow:

1. fetch all `generations`
2. fetch all `posts`
3. fetch all involved `profiles`
4. fetch linked `generations` for post media lookup
5. convert `generations` into normalized `draft`-like items
6. convert `posts` into normalized post items
7. hide generation rows whose generation already appears in a post
8. merge into one master list

Normalized fields include:

- `data_type`
- `unified_date`
- `unified_status`
- `media_url`
- `profiles`

### 9.4 Filters

Visible filters:

- search
- user
- media type
- status
- date range

Actual implemented filter logic:

- search -> caption, prompt, or user name
- user -> yes
- media type -> yes
- status -> yes
- date range -> visible in UI but not actually applied in filtering logic yet

### 9.5 Grouping and queue display

Content is grouped by localized date label and rendered in a moderation queue table.

Displayed row data:

- preview image or video
- user name/email
- caption or prompt
- schedule time when status is `scheduled`
- lifecycle badge
- row actions

### 9.6 Available moderation actions

Per-item actions:

- schedule
- edit
- delete

Action rules:

- `draft` -> schedule, edit, delete
- `scheduled` -> edit, delete
- `published` -> delete only

### 9.7 Publication modal

The publication modal supports:

- schedule mode
- post-now mode
- caption edit
- hashtags edit
- preview pane

Outputs:

- `scheduled` for scheduled publication
- `published` for immediate post-now flow

Behavior split:

- if the selected item is already a `post`, update the existing `posts` row
- if the selected item is a draft/generation, insert a new `posts` row linked by `generation_id`

### 9.8 Edit modal

The edit modal can edit:

- caption
- hashtags

Save target depends on record type:

- `draft` generation -> update `generations.metadata`
- `post` -> update `posts.caption`

### 9.9 Realtime behavior

This page subscribes globally to:

- `generations`
- `posts`

Each change triggers a full refetch and renormalization.

### 9.10 Relationship to user-facing surfaces

This page is the admin mirror of the user content lifecycle.

It directly overlaps with:

- Generate page: source `generations`
- Calendar page: source `posts`
- User dashboard: KPI counts derived from `posts` and recent work from `generations`
- Library: `posts` deletions can cascade into `content_library_items`
- Navbar notifications: status changes in `generations` and `posts`

Operationally, this is the main admin view that spans both creation and publishing.

### 9.11 Important caveats

- there is no approval/rejection workflow separate from edit/delete/schedule
- "Post now" writes `published` immediately; there is no background publisher involved here
- deleting content is immediate and direct
- the moderation page uses broad client-side stitching instead of a server-side materialized view or RPC
- date-range filter UI is currently incomplete

## 10. Admin Analytics Page

### 10.1 Files

- `src/admin/pages/AdminAnalyticsPage.jsx`
- `src/admin/utils/mockService.js`
- `src/admin/utils/mockAnalyticsExtended.js`
- `src/admin/components/ScoreCard/ScoreCard.jsx`
- `src/admin/components/AnalyticsPagination/Pagination.jsx`

### 10.2 What it does

This page is an analytics dashboard prototype with working UI interactions, but it is not wired to real platform analytics data.

### 10.3 Implemented UI capabilities

Controls:

- last 7/14/30/90 days
- platform filter
- team filter
- segment filter
- compare mode: None / MoM / YoY
- view mode: Overall / Individual User
- selected-user search in individual mode
- CSV export for generation series

Charts:

- generations over time line chart
- optional compare overlay
- stacked area chart for cost per platform
- pie chart for latest platform distribution

Table:

- paginated user/platform breakdown
- mock server-side pagination behavior

KPIs shown:

- Active AI Users
- Cost per Generated Post (CPP)
- API Failure Rate
- Content Rejection Rate

### 10.4 Data source reality

Everything on this page comes from mock data helpers.

It does not currently query:

- `platform_analytics`
- real posts per platform
- real cost telemetry
- real moderation outcomes
- real team/segment data

### 10.5 Relationship to user-facing analytics

There is no real standalone user analytics route right now.

In the user workspace:

- `/app/analytics` redirects to `/app/calendar`
- dashboard trends are not a full analytics system

So this admin analytics page is ahead of the user information architecture in UI ambition, but behind it in data reality.

### 10.6 Important caveats

- mock only
- KPI names imply operational telemetry that is not yet backed by actual ingestion
- filtering and pagination are simulation, not real backend query behavior

## 11. Admin Logs Page

### 11.1 Files

- `src/admin/pages/AdminLogsPage.jsx`

### 11.2 Current behavior

This route is placeholder-only.

It currently renders:

- `Analytics Logs Page`

There is no:

- log query
- log table
- audit feed
- background job history
- request trace surface

### 11.3 Relationship to the rest of the system

At the moment, there is no operational connection.

The repo also does not have an active frontend path consuming:

- `admin_logs`
- edge function job histories
- webhook traces

This route is effectively a shell slot waiting for a real implementation.

## 12. Relationship to the User Dashboard

### 12.1 User dashboard purpose

The user dashboard at `/app/dashboard` is the user's personal summary surface.

Files:

- `src/pages/Dashboard/UserDashboard.jsx`
- `src/components/Dashboard/RealtimeKPICards.jsx`
- `src/hooks/useRealtimeKPIs.js`

### 12.2 What the user dashboard shows

User dashboard features:

- greeting based on time of day
- onboarding checklist for first-time users
- user-scoped realtime KPI cards
- recent generations
- quick actions
- connected account health
- generation search via navbar
- user notifications via navbar

### 12.3 Shared data overlap with admin

User dashboard and admin overlap on:

- `profiles`
- `generations`
- `posts`
- `connected_accounts`

Shared functional overlap:

- user dashboard recent generations vs admin content manager/moderation
- user dashboard KPI counts vs admin overview platform totals
- user dashboard account health vs admin user-details connected account view

### 12.4 Conceptual difference

The user dashboard is:

- self-service
- scoped to one user
- navigational
- operational for daily content work

The admin dashboard is:

- cross-user
- supervisory
- moderation-oriented
- operational for support and governance

### 12.5 Direct comparison

| Concern | User dashboard | Admin counterpart |
| --- | --- | --- |
| identity | personal greeting and avatar | user list and user details |
| KPIs | personal realtime KPIs | platform-wide overview KPIs |
| recent content | recent generations for current user | moderation queue and content manager |
| account connections | account health card | connected accounts in user details |
| actions | generate, calendar, settings navigation | suspend, reset, delete, moderate |
| notifications | personal generation/post updates | not implemented in admin |
| search | generation search | navbar search is cosmetic only |

## 13. Relationship to the Broader User Workspace

The admin dashboard is not only related to the user dashboard. It is related to the entire user workflow.

### 13.1 Generate page

User route:

- `/app/generate`

Shared entities:

- `sessions`
- `generations`
- `posts`

Relationship:

- users create `generations`
- completed generations auto-create draft `posts`
- admin moderation and content manager inspect or edit those outputs

### 13.2 Calendar page

User route:

- `/app/calendar`

Shared entities:

- `posts`
- `connected_accounts`
- planning tables

Relationship:

- calendar is the user's scheduling control center
- moderation is the admin control center for the same lifecycle
- admin overview counts scheduled/published posts that users manage in calendar

### 13.3 Library page

User route:

- `/app/library`

Shared entities:

- `posts`
- `media_assets`
- `content_templates`
- `content_library_items`

Relationship:

- library items are created from posts/media by trigger
- admin deletions of posts can remove library visibility for users
- current admin UI does not give a dedicated library management surface

### 13.4 Settings page

User route:

- `/app/settings`

Shared entities:

- `connected_accounts`
- `profiles`

Relationship:

- user settings manages platform connections
- dashboard account health reads those rows
- navbar notifications can resolve account names for post updates
- admin user details also reads those rows

Current implementation note:

- settings page currently tells the user that OAuth connect flow is not configured in this build, even though `MockOAuthService` exists as a development helper. In other words, the connected account data model is active, but the end-user connection UX is only partially wired.

### 13.5 Brand Kit page

User route:

- `/app/settings/brand-kit`

Shared entities:

- `brand_kit`
- `brand_assets`

Relationship:

- this is part of the user workspace
- no active admin route currently exposes brand kit data
- if Claude adds admin account audits, brand kit completeness could become an admin concern, but that is not implemented today

## 14. End-to-End System Flows

### 14.1 Authentication and workspace routing

```text
auth.users login
  -> AuthContext resolves session
  -> authService/getUserProfileAndRole resolves role
  -> PostAuthRedirect sends:
       user  -> /app/dashboard
       admin -> /app/admin
```

### 14.2 User creation to admin visibility

```text
auth.users insert
  -> handle_new_user_profile() creates/updates profiles row
  -> admin overview total users increases
  -> admin users page shows the account
  -> user dashboard/navbar/sidebar can load identity data
```

### 14.3 Generation to moderation to scheduling

```text
user generates content
  -> generations row inserted
  -> generation status becomes completed
  -> ensure_draft_post_for_generation() creates draft post
  -> user dashboard recent generations updates
  -> calendar drafts update
  -> moderation queue can review/edit/schedule it
  -> overview KPIs can count resulting posts
```

### 14.4 Connected accounts and health

```text
connected_accounts rows exist
  -> user dashboard account health shows them
  -> settings page manages disconnect state
  -> navbar notifications can resolve account names for post updates
  -> admin user details displays connected platforms
```

### 14.5 Admin destructive action side effects

```text
admin deletes post
  -> post row removed
  -> linked content_library_items can cascade delete
  -> user calendar/library/dashboard counts can change
  -> overview KPIs can change
```

## 15. Realtime Behavior Map

### 15.1 User workspace realtime

User dashboard:

- `generations`
- `posts`
- `connected_accounts`

User KPI hook:

- user-scoped `generations`
- user-scoped `posts`
- user-scoped `profiles`

Navbar notifications:

- user-scoped `generations`
- user-scoped `posts`

### 15.2 Admin workspace realtime

Admin overview:

- global `profiles`
- global `generations`
- global `posts`

Admin users page:

- global `profiles`

Admin moderation:

- global `generations`
- global `posts`

Content manager:

- global `generations`, narrowed by selected user in query logic

### 15.3 Operational implication

User realtime is mostly scoped and personal.

Admin realtime is mostly global and causes page-level refetches.

That is functionally acceptable for small data volumes but will become expensive at scale.

## 16. Real vs Mock vs Placeholder Inventory

### 16.1 Real and actively wired

- admin route protection
- admin overview KPIs
- admin overview generation chart
- admin users list
- admin user suspend action
- admin reset-password action call
- admin moderation queue
- admin moderation schedule/edit/delete
- user dashboard realtime KPIs
- shared generation-to-draft trigger model

### 16.2 Partially real / partially incomplete

- connected account visibility in admin user details
- content manager edit flow
- settings account-connection model
- user analytics navigation, which currently aliases to calendar

### 16.3 Mock-driven

- admin analytics page
- content analytics tab inside user details
- any future-looking team/segment/cost telemetry on the admin side
- `MockOAuthService` data generation, when used

### 16.4 Placeholder or dead/unwired

- admin logs page
- admin navbar search
- admin navbar notifications
- user details recent activity block
- content manager regenerate action
- `src/admin/adminRoutes.jsx` empty
- `src/admin/AdminDashboard.jsx` unused
- `supabase/functions/adminStats/*` empty
- `src/admin/components/ContentModeration/ContentReviewModal.jsx` empty
- several `ContentManager` helper components exist but are not mounted by active routes
- `UploadWizard` exists as a standalone admin concept but is not wired into the current route flow

## 17. Files That Matter Most for Future Improvements

If Claude is extending the admin system, these are the highest-value anchor files:

- `src/router/router.jsx`
- `src/utils/protectedRoute.jsx`
- `src/utils/authRouting.js`
- `src/services/authService.js`
- `src/admin/AdminLayout.jsx`
- `src/admin/pages/AdminOverview.jsx`
- `src/admin/pages/AdminUsersPage.jsx`
- `src/admin/pages/AdminModeration/AdminModerationPage.jsx`
- `src/admin/pages/AdminAnalyticsPage.jsx`
- `src/pages/Dashboard/UserDashboard.jsx`
- `src/hooks/useRealtimeKPIs.js`
- `src/constants/statuses.js`
- `supabase/migrations/20260227103000_generation_post_unification_and_rls.sql`
- `supabase/migrations/20260227090000_calendar_library_alignment.sql`
- `supabase/migrations/20260302110000_profile_provisioning_and_status_domain.sql`

## 18. Invariants Claude Should Preserve

These are the most important system truths to preserve when improving the admin dashboard:

1. `posts` is the canonical publishing lifecycle model.
2. `generations` is the canonical creation model.
3. Completed generations should continue to produce draft posts unless the lifecycle model is intentionally redesigned everywhere.
4. Admin visibility should continue to work through RLS-aware access, not by bypassing the normal data model.
5. Lifecycle statuses should stay aligned with `src/constants/statuses.js`.
6. Admin actions can affect user dashboard, calendar, library, and notifications because they share the same rows.
7. Deleting or mutating user/profile/content records in admin should be treated as cross-surface changes, not local UI actions.

## 19. Most Valuable Improvement Directions

If Claude is asked to improve this area, the highest-value work is:

1. Replace admin analytics mock data with real aggregated queries or edge functions.
2. Implement a real logs/audit route instead of the current placeholder.
3. Fix the connected-account tile contract mismatch in the users page.
4. Move dangerous admin actions such as full account deletion to server-side admin functions instead of raw client deletes.
5. Add explicit admin drill-down paths from overview KPIs into filtered users/moderation views.
6. Add a server-side unified moderation view or RPC to replace repeated client-side stitching of generations, posts, profiles, and linked media.
7. Expose real brand-kit/library/account-completeness audits if account operations need a fuller admin picture.
8. Introduce better user-scoped and page-scoped realtime strategies to avoid broad global refetches.

## 20. Bottom Line

The current admin dashboard is best understood as a hybrid system:

- a real operational shell for overview, user management, and moderation
- a prototype shell for analytics
- a placeholder shell for logs

Its relationship to the user dashboard is not incidental. Both sit on the same platform model:

- user dashboard = personal operating console
- admin dashboard = cross-user supervisory console

Any improvement to either side needs to account for the shared lifecycle of:

- `profiles`
- `generations`
- `posts`
- `connected_accounts`

That shared model is the main architectural connection across the whole product.
