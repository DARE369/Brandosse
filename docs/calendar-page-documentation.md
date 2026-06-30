# Calendar Page Documentation

Updated: 2026-02-25  
Scope: User-facing calendar and scheduling workflow (`/app/calendar`) and its direct dependencies across Generate, Dashboard/Navbar, Settings, Supabase tables, and automation jobs.

## 1. What the Calendar Page Is

The Calendar page is the planning and scheduling control center for user content.  
It currently supports:

- Viewing planned and historical content (`scheduled`, `publishing`, `published`, `failed`)
- Managing unscheduled drafts (`status='draft'`)
- Rescheduling content from the calendar
- Scheduling drafts through a modal
- AI suggestion slots (ghost slots)
- AI-assisted optimal-time insights
- Bulk auto-scheduling for drafts

Main files:

- `src/pages/CalendarPage/CalendarPageV2.jsx`
- `src/pages/CalendarPage/components/*`
- `src/stores/CalendarStore.js`
- `src/services/OptimalTimesService.js`

---

## 2. How It Relates to the Entire System

### 2.1 Routing and navigation

- Route is mounted at `path: "calendar"` under `/app`:
  - `src/router/router.jsx:56`
- Sidebar "Analytics" currently aliases to calendar (not a standalone analytics page):
  - `src/router/router.jsx:62`
  - `src/components/User/UserSidebar.jsx:36`
- Dashboard quick action "Schedule a Post" navigates to `/app/calendar`:
  - `src/pages/Dashboard/UserDashboard.jsx:510`

### 2.2 Upstream dependency (Generate -> Calendar)

Generate flow creates `posts` rows via `publishContent`, then Calendar reads them:

- Publish/schedule write in session store:
  - `src/stores/SessionStore.js:997`
  - `src/stores/SessionStore.js:1011`
  - `src/stores/SessionStore.js:1022`
- Post production schedule selection:
  - `src/components/Generate/PostProductionPanel.jsx:596`
  - `src/components/Generate/PostProductionPanel.jsx:617`

### 2.3 Downstream dependencies (Calendar -> other surfaces)

- Dashboard KPI cards and counts read `posts` statuses (`scheduled`, `published`):
  - `src/hooks/useRealtimeKPIs.js:44`
  - `src/hooks/useRealtimeKPIs.js:49`
- Navbar notifications route post updates back to calendar:
  - `src/components/User/UserNavbar.jsx:190`
- Admin moderation/analytics utilities also query `posts` lifecycle states:
  - `src/admin/utils/apiService.js:28`
  - `src/admin/utils/apiService.js:31`

This means calendar lifecycle correctness directly affects dashboard metrics, notifications, and admin reporting.

---

## 3. Current Calendar Runtime Architecture

### 3.1 Initialization and data loading

On page load:

1. Fetch scheduled/history posts:
   - `src/pages/CalendarPage/CalendarPageV2.jsx:59`
   - `src/stores/CalendarStore.js:34`
   - Includes statuses: `scheduled`, `published`, `publishing`, `failed`
   - `src/stores/CalendarStore.js:49`
2. Fetch drafts (`status='draft'`):
   - `src/pages/CalendarPage/CalendarPageV2.jsx:60`
   - `src/stores/CalendarStore.js:64`
   - `src/stores/CalendarStore.js:76`
3. Fetch/create calendar settings:
   - `src/pages/CalendarPage/CalendarPageV2.jsx:61`
   - `src/stores/CalendarStore.js:363`
4. Fetch ghost slots when enabled:
   - `src/pages/CalendarPage/CalendarPageV2.jsx:66`

### 3.2 Main component composition

- Calendar grid and navigation: `CalendarView.jsx`
- Draft rail: `DraftsSidebar.jsx`
- Single schedule modal: `ScheduleModal.jsx`
- Bulk scheduler: `BulkScheduleModal.jsx`
- AI suggestions toggle/settings: `GhostSlotsToggle.jsx`
- AI suggestions cards: `GhostSlotCard.jsx`
- Best times panel: `OptimalTimesPanel.jsx`

### 3.3 State owner

- Zustand store `useCalendarStore` owns posts, drafts, ghost slots, settings, and view/date state:
  - `src/stores/CalendarStore.js`

---

## 4. Current Functionalities (As Implemented)

### 4.1 Calendar views and navigation

- View modes: Month, Week, Day:
  - `src/pages/CalendarPage/CalendarPageV2.jsx:204`
- Date navigation (prev/next/today) in `CalendarView`.
- Month view supports drag-drop rescheduling.
- Week/day views are read-only cards (no drag-drop):
  - `src/pages/CalendarPage/components/CalendarView.jsx:254`
  - `src/pages/CalendarPage/components/CalendarView.jsx:313`

### 4.2 Rescheduling/scheduling

- Drag-drop reschedules by updating `scheduled_at`:
  - `src/pages/CalendarPage/CalendarPageV2.jsx:98`
- Clicking a post/draft opens `ScheduleModal`.
- Save from modal routes to:
  - update existing post (`updatePost`)
  - accept ghost slot (`acceptGhostSlot`)
  - create new post (`createPost`)
  - `src/pages/CalendarPage/CalendarPageV2.jsx:290`

### 4.3 Draft management

- Left rail lists drafts and opens scheduler on click.
- Empty state points users to Generate page:
  - `src/pages/CalendarPage/components/DraftsSidebar.jsx:38`
  - `src/pages/CalendarPage/components/DraftsSidebar.jsx:39`

### 4.4 Ghost slots (AI suggestions)

- Toggle on/off in `calendar_settings`.
- Optional frequency setting (`preferred_post_frequency`).
- Dismiss updates slot status to `dismissed`:
  - `src/pages/CalendarPage/components/GhostSlotCard.jsx:19`

### 4.5 Optimal posting times

- Panel reads `optimal_posting_times` with `sample_size >= 3`.
- Bulk scheduler uses `getRecommendedTime`.

### 4.6 Bulk schedule

- Step flow: select drafts -> AI review -> confirm.
- Auto mode is implemented.
- Manual mode is visible but disabled:
  - `src/pages/CalendarPage/components/BulkScheduleModal.jsx:201`
  - `src/pages/CalendarPage/components/BulkScheduleModal.jsx:203`

### 4.7 Previewing behavior (current)

Preview is distributed across surfaces:

- Generate page pre-publish preview:
  - `src/components/Generate/PostProductionPanel.jsx` (media preview card)
- Draft rail thumbnail preview:
  - `src/pages/CalendarPage/components/DraftsSidebar.jsx`
- Calendar post card thumbnail preview:
  - `src/pages/CalendarPage/components/PostCard.jsx`
- Bulk schedule review preview:
  - `src/pages/CalendarPage/components/BulkScheduleModal.jsx`

The single schedule modal itself does not show a media preview; it is date/time focused.

---

## 5. Process Flows

## 5.1 Primary scheduling path: Generate -> Calendar

1. User creates content in Generate and opens Post Production.
2. User selects accounts and optional schedule datetime.
3. `SessionStore.publishContent` inserts one `posts` row per selected account.
4. Calendar `fetchPosts` loads scheduled/history rows into the grid.
5. User can reschedule from calendar card drag or schedule modal.

Reference points:

- `src/components/Generate/PostProductionPanel.jsx:596`
- `src/stores/SessionStore.js:1013`
- `src/stores/SessionStore.js:1022`
- `src/stores/CalendarStore.js:34`

## 5.2 Draft scheduling path: Draft rail -> Schedule modal

1. User clicks a draft in `DraftsSidebar`.
2. `ScheduleModal` opens prefilled with current date/time or draft schedule.
3. Save sends payload with `status: "scheduled"` and ISO datetime.
4. Parent updates post and then refreshes posts/drafts/ghost slots.

Reference points:

- `src/pages/CalendarPage/components/DraftsSidebar.jsx:46`
- `src/pages/CalendarPage/components/ScheduleModal.jsx:75`
- `src/pages/CalendarPage/components/ScheduleModal.jsx:79`
- `src/pages/CalendarPage/CalendarPageV2.jsx:290`
- `src/pages/CalendarPage/CalendarPageV2.jsx:319`

## 5.3 Ghost slot -> scheduled post

1. User clicks ghost slot card.
2. Calendar opens schedule modal with ghost suggestion prefilled.
3. Save calls `acceptGhostSlot`, creates post, marks ghost slot accepted.

Reference points:

- `src/pages/CalendarPage/CalendarPageV2.jsx:108`
- `src/stores/CalendarStore.js:176`

## 5.4 Bulk scheduling process

1. User opens bulk modal.
2. Drafts auto-selected (up to 10).
3. Auto mode gets recommended time per draft.
4. Confirm loops through selected drafts and updates each to `scheduled`.

Reference points:

- `src/pages/CalendarPage/components/BulkScheduleModal.jsx:22`
- `src/pages/CalendarPage/components/BulkScheduleModal.jsx:47`
- `src/pages/CalendarPage/components/BulkScheduleModal.jsx:82`

---

## 6. What the Calendar Page Needs (Infrastructure and Product Dependencies)

## 6.1 Data model and policies needed

Calendar assumes these tables and relations exist with user-scoped RLS:

- `posts` (+ relations to `generations`, `connected_accounts`)
- `calendar_settings`
- `ghost_slots`
- `content_pillars`
- `optimal_posting_times`
- `trending_topics`
- `platform_analytics`

Current repository state:

- `supabase/functions/schema.sql` is empty
- `supabase/functions/policies.sql` is empty
- migrations folder currently contains only:
  - `20260220041938_brand_kit.sql`
  - `20260222013000_storage_buckets_and_policies.sql`

So calendar schema/policy setup is not versioned in repo yet.

## 6.2 Automation/jobs needed for full value

1. Daily analysis job for optimal times and ghost slots:
   - `supabase/functions/daily-analysis/index.ts`
2. Scheduled publishing worker (`scheduled -> publishing -> published/failed`) is still needed.
3. Analytics sync job to populate `platform_analytics` is still needed.
4. Optional RPC helper used by store (`get_best_posting_time`) is referenced but not defined in repo SQL:
   - `src/stores/CalendarStore.js:330`

---

## 7. Missing from the MVP Model (Current Gaps)

## 7.1 P0 gaps (high impact)

1. Draft lifecycle is incomplete in active user flow.

- Calendar expects `posts.status='draft'`:
  - `src/stores/CalendarStore.js:76`
- Main publish path writes only `scheduled` or `published`:
  - `src/stores/SessionStore.js:1011`
- `POST_STATUS` does not include `draft`:
  - `src/constants/statuses.js:11`

Impact: Draft rail can remain empty unless drafts are inserted outside the visible user flow.

2. Rescheduling lifecycle can overwrite terminal states.

- Calendar includes `published`, `publishing`, `failed` in editable posts:
  - `src/stores/CalendarStore.js:49`
- Schedule modal save forces `status: 'scheduled'` on existing posts:
  - `src/pages/CalendarPage/CalendarPageV2.jsx:296`

Impact: Historical/published records can be unintentionally moved back to scheduled.

3. Month view date generation is fixed to 35 days.

- Current implementation always returns 35 day cells:
  - `src/pages/CalendarPage/components/CalendarView.jsx:384`

Impact: Some 6-row months are truncated.

## 7.2 P1 gaps (important)

1. Draft relation mismatch for platform metadata.

- Draft query does not join `connected_accounts`:
  - `src/stores/CalendarStore.js:64`
- UI expects `draft.connected_accounts`:
  - `src/pages/CalendarPage/components/DraftsSidebar.jsx:70`
  - `src/pages/CalendarPage/components/BulkScheduleModal.jsx:47`

2. Realtime calendar subscription exists but is not wired from page.

- Store has `subscribeToUpdates`:
  - `src/stores/CalendarStore.js:447`
- `CalendarPageV2` does not call it.

3. Bulk scheduler manual mode is not implemented (disabled).

- `src/pages/CalendarPage/components/BulkScheduleModal.jsx:203`

4. Platform attribution in analytics pipeline is fragile.

- Filter relies on `p.connected_accounts?.platform` without selecting that relation:
  - `src/services/OptimalTimesService.js:47`
  - `supabase/functions/daily-analysis/index.ts:137`

5. Ghost-slot frequency setting is not fully used in generator logic.

- Setting is read:
  - `supabase/functions/daily-analysis/index.ts:234`
- `postsPerWeek` is computed but unused:
  - `supabase/functions/daily-analysis/index.ts:271`

## 7.3 P2 gaps (cleanup and polish)

1. Legacy calendar component still in tree:
   - `src/pages/CalendarPage/components/CalendarGrid.jsx`
2. UI copy says drafts are draggable, but draft cards are click-to-schedule only:
   - `src/pages/CalendarPage/components/DraftsSidebar.jsx:32`
3. Trend feed currently uses manual mock source in daily analysis:
   - `supabase/functions/daily-analysis/index.ts:353`

---

## 8. Current UI Specifications and How Calendar Should Emulate Them

## 8.1 Source UI specifications

Primary contracts:

- `docs/mobile-tablet-layout-contract.md`
- `src/styles/responsive-contract.css`
- `src/styles/variables.css`

Key contract rules for calendar:

- Breakpoints:
  - `0-599`, `600-899`, `900-1199`, `1200+`
  - `docs/mobile-tablet-layout-contract.md:5`
- `<1180px`: drafts become drawer
  - `docs/mobile-tablet-layout-contract.md:18`
- `<900px`: no drag-drop; tap-to-reschedule
  - `docs/mobile-tablet-layout-contract.md:19`
- No critical action hidden behind hover-only affordances
  - `docs/mobile-tablet-layout-contract.md:30`

## 8.2 What calendar already matches

1. Breakpoint-driven compact behavior at 1180px:
   - `src/pages/CalendarPage/CalendarPageV2.jsx:15`
2. Draft drawer/backdrop mechanics:
   - `src/pages/CalendarPage/CalendarPageV2.jsx:148`
   - `src/styles/responsive-contract.css:227`
3. Drag-drop disabled on compact/touch layouts:
   - `src/pages/CalendarPage/CalendarPageV2.jsx:274`
   - `src/pages/CalendarPage/CalendarPageV2.jsx:252`
4. Schedule modal responsive contract is implemented in shared CSS:
   - `src/styles/responsive-contract.css:421`

## 8.3 Where calendar diverges from spec intent

1. Ghost-slot dismiss button is hover-revealed (opacity 0 until hover):
   - `src/styles/CalendarV2.css:674`
   - `src/styles/CalendarV2.css:678`

This conflicts with "no critical action hidden behind hover-only affordances" on touch and keyboard-first paths.

2. Draft interaction copy is misleading.

- UI says "Drag to calendar or click to schedule":
  - `src/pages/CalendarPage/components/DraftsSidebar.jsx:32`
- Draft drag source is not implemented.

3. Calendar visual layer still has duplicated/legacy styling rules in `CalendarV2.css` that partially overlap the responsive contract.

## 8.4 Emulation plan (UI-level)

1. Make ghost-slot dismiss always visible or expose it via explicit "More actions" button.
2. Replace draft subtitle with truthful action text ("Click to schedule") until draft drag-drop is implemented.
3. Keep responsive behavior in `responsive-contract.css` as source of truth; reduce duplicate media-query logic in `CalendarV2.css`.
4. Add dedicated post preview panel/drawer for schedule modal context (media + caption + platform + status) to align with generate-page preview quality.
5. Add keyboard-accessible reschedule controls for non-drag contexts in month/week/day views.

---

## 9. Recommended Improvement Roadmap

## 9.1 Phase 1 (stabilize lifecycle)

1. Add explicit draft creation path from Generate (`save as draft`) and include `draft` in canonical post status constants.
2. Restrict schedule edits by current status:
   - allow reschedule for `draft` and `scheduled`
   - block or clone for `published`, `publishing`, `failed`
3. Fix month grid generation to support 35/42 day layouts dynamically.

## 9.2 Phase 2 (data and AI reliability)

1. Join `connected_accounts` in draft queries or remove UI assumptions.
2. Wire calendar realtime subscription with user-scoped filtering.
3. Repair optimal-time platform attribution query path.
4. Use `preferred_post_frequency` in ghost-slot generation logic.

## 9.3 Phase 3 (UX completion)

1. Implement bulk manual scheduling mode.
2. Add in-modal media preview for schedule flow.
3. Build dedicated user analytics route and remove analytics->calendar alias when ready.

---

## 10. MVP Completion Acceptance Criteria (Calendar Domain)

Calendar is considered MVP-complete when:

1. User can reliably move content through `draft -> scheduled -> publishing -> published/failed`.
2. Calendar edits cannot corrupt historical/published lifecycle states.
3. Generate, Calendar, Dashboard, Navbar, and Admin show consistent post counts and statuses.
4. Scheduling works with both drag and non-drag interaction paths.
5. Ghost slots and best-time recommendations are driven by real platform-attributed analytics.
6. Calendar schema + RLS + jobs are migration-backed and reproducible from repo artifacts.
