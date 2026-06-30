# AS-IS Audit — Packet 1: Personal Content Calendar

Auditor: `docs-auditor`
Date: 2026-06-23
Packet: `docs/calendar-library-rebuild/PACKET_1_PERSONAL_CALENDAR.md`
Specs compared against: `docs/CALENDAR_SPEC.md`, `docs/PERSONAL_WORKSPACE_SPEC.md` §5.4

Scope rule observed: no file under `src/**` was created, edited, or deleted. This is a read-only audit. Generate Studio / AI Studio files were read only to the minimum extent needed to confirm the stub-toast location named in the packet (Master Brief §0 rule 2) — not analyzed further.

---

## 0. Routing — how a user actually reaches this page

| File | Role |
|---|---|
| `src/components/User/UserSidebar.jsx:60-65` | Sidebar nav item "Content Calendar" → `path: "/app/calendar"` |
| `app/app/calendar/page.jsx` | Next.js route handler. Renders `<CalendarPageV3 />` imported from `@/pages/CalendarPage/CalendarPageV3`. No other logic. |
| `src/pages/CalendarPage/CalendarPageV3.jsx` | The actual page component (734 lines) |

**Finding:** the route is real, wired, and reachable — not a stub. This matches what the packet told me to verify rather than assume: "the page itself is thin or stubbed" language in the packet/spec refers only to the Generate Studio in-Studio Schedule button (§5.4 of `PERSONAL_WORKSPACE_SPEC.md`), confirmed below in §6. The standalone Calendar page itself is a substantial, functioning implementation.

---

## 1. Full file map of the current implementation

### 1.1 Page + view components (`src/pages/CalendarPage/`)

| File | Lines | Purpose |
|---|---|---|
| `CalendarPageV3.jsx` | 734 | Page shell: header/nav, view-mode switch (week/month), filters, DnD context, ⌘K command bar wiring, all event handlers (drag-end, panel save/delete, cell-click routing) |
| `v3/MonthGrid.jsx` | 147 | Month view — 6x7 day-cell grid, up to 3 cards/day + "+N more", no DnD (day-only, click-only) |
| `v3/WeekGrid.jsx` | 291 | Week view — 24-hour grid, draggable post chips (`useDraggable`), droppable hour cells (`useDroppable`), "now" line, per-cell click → palette |
| `v3/PostPanel.jsx` | 518 | Detail/edit side panel — caption editor, hashtag chips, AI caption audit, date/time fields, platform reassignment, readiness checklist, delete |
| `v3/DraftTray.jsx` | 148 | Collapsible bottom/side rail listing draft posts as draggable cards, readiness % bar per draft |
| `v3/CalendarCommandBar.jsx` | 272 | ⌘K natural-language command palette — calls `executeCalendarCommand()`, renders suggested commands, applies AI-returned actions |
| `v3/CellCommandPalette.jsx` | 126 | Popover on empty-cell click — "schedule a draft / new post / ask AI / generate week plan" |
| `v3/IntelligenceStrip.jsx` | 197 | Stat strip (scheduled/published/failed counts, best day, platform mix, health badge, one locally-computed text tip — explicitly NOT styled as AI) |
| `components/ScheduleModal.jsx` | 216 | Standalone month-picker + time-input modal. **Not imported by `CalendarPageV3.jsx` or any v3 component** — its only real caller is `src/pages/LibraryPage/LibraryPageV2.jsx:30,1002` |
| `implementation_guide.md` | — | Stale planning doc from an earlier build iteration (see §5 below) |

Total page-tree code (excluding the stale guide and the orphaned-from-Calendar-but-used-by-Library `ScheduleModal.jsx`): **2,426 lines** across 9 files (734+147+291+518+148+272+126+197 = 2,433; figure in packet brief, 2,642, includes `ScheduleModal.jsx`'s 216 lines counted as part of "Calendar" footprint, plus minor count variance — both numbers point at the same real, substantial codebase, not a stub).

### 1.2 Data layer

| File | Role |
|---|---|
| `src/stores/CalendarStore.js` (548 lines, Zustand) | **The entire data access layer for Calendar.** All Supabase queries against `posts` live here as direct inline calls — `fetchPosts()`, `fetchDrafts()`, `createPost()`, `updatePost()`, `deletePost()`, `subscribeToUpdates()`, plus **dead** methods for `ghost_slots`, `content_pillars`, `optimal_posting_times`, `calendar_settings` (see §5). |
| `src/services/calendarAIService.js` (331 lines) | Thin client for the `calendar-ai` Supabase edge function: `getSlotSuggestions()`, `auditPostCaption()`, `generateWeekPlan()`, `executeCalendarCommand()`, plus a pure-local `checkPublishReadiness()` (no network call). |
| `src/utils/postStatusMachine.js` (56 lines) | `canTransitionPostStatus()`, `isLockedForReschedule()`, `assertPostStatusTransition()` — a real status-transition guard enforced both client-side (UI disables drag on locked posts) and at the point of every `CalendarStore` write. |
| `src/utils/timezone.js` | Intl-only helpers: `getZonedDateKey()`, `getZonedParts()`, `zonedDateKeyAndHourToUTC()`, `zonedDateTimeToUTC()`, `formatInTimeZone()`, week/month key math. No date library dependency (file's own header comment confirms no date-fns-tz/luxon/dayjs exists in the repo). |
| `src/constants/statuses.js` | `POST_STATUS` enum (`draft/scheduled/published/failed/publishing/archived`) — the canonical status vocabulary `CalendarStore.js` and `postStatusMachine.js` both import. |
| `src/services/userSettingsService.js` (`fetchUserSettings`) | Used once, to resolve the user's stored timezone on mount. |
| `src/stores/BrandKitStore.js` | Used once, to pass `brandKit` into the AI caption-audit/slot-suggestion calls. |

### 1.3 `posts` columns read/written by this tree

Confirmed by direct grep of `CalendarStore.js`, `PostPanel.jsx`, `WeekGrid.jsx`, `MonthGrid.jsx`, `ScheduleModal.jsx`:

- Read: `id`, `user_id`, `status`, `scheduled_at`, `caption`, `hashtags`, `platform`, `account_id`, `title`, `thumbnail_url`, `media_url`, `media_type`, `published_at`, `failure_reason`, `created_at`, plus joined `connected_accounts(platform, account_name, avatar_url)` and `generations(storage_path, media_type, prompt)`.
- Written: `scheduled_at`, `status`, `caption`, `hashtags`, `account_id`, `platform` (via `updatePost()`), full row insert on `createPost()` (drafts and AI week-plan entries).
- **Not referenced anywhere in this tree:** `generation_id` is read implicitly through the `generations` join but never used as a grouping/dedup key for multi-platform fan-out — see §4 (Generation grouping) below. Confirmed separately (via repo-wide grep) that `posts.generation_id` **does exist** as a real column already in use elsewhere (`SessionStore.js`, org pipeline services, `20260227103000_generation_post_unification_and_rls.sql` migration, documented in `docs/database-consistency-audit.md:76` as `posts.generation_id -> generations.id`). The Calendar tree simply never queries or groups by it today.

### 1.4 Dependencies confirmed already in the project (relevant to Phase 1 research, noted here for continuity)

- `@dnd-kit/core` (`^6.3.1`) and `@dnd-kit/sortable` (`^10.0.0`) are real, installed dependencies — `CalendarPageV3.jsx` and `WeekGrid.jsx`/`DraftTray.jsx` already use `DndContext`, `useDraggable`, `useDroppable`, `PointerSensor`, `TouchSensor` from `@dnd-kit/core`. `TouchSensor` is explicitly configured (`{ delay: 250, tolerance: 8 }`), so touch-drag support is not a green-field problem — it already exists in some form in the current build. (Full library evaluation against Master Brief §4's parity mandate is the research agent's job in Phase 1; flagging the existing dependency here so that agent doesn't have to rediscover it.)

---

## 2. Comparison against `CALENDAR_SPEC.md`'s target architecture

Target (§1 of the spec):
```
src/calendar/
  components/ CalendarGrid.jsx, CalendarListView.jsx, PostCard.jsx, PostDetailDrawer.jsx,
              ScheduleModal.jsx, QuickPostComposer.jsx, UnscheduledRail.jsx, BrandProjectSwitcher.jsx
  hooks/      useCalendarPosts.js, useScheduleAction.js
  services/   calendarService.js
  stores/     calendarUiStore.js
src/pages/ContentCalendar/PersonalCalendarPage.jsx   # thin wrapper
```

None of this shared-engine structure exists yet. Every current file lives under the page-specific `src/pages/CalendarPage/` tree and is Calendar-only — there is no `src/calendar/` shared engine, and (per §1.4 of the spec) the org side (`src/org/pages/OrgCalendar.jsx`, `src/org/hooks/useOrgCalendar.js`, `src/org/services/orgCalendarService.js`) is a fully separate, parallel implementation that does not share a single line of code with the personal tree audited here. This is the core architectural gap the rebuild closes — not a defect in either side individually, but the lack of one shared engine the spec mandates.

---

## 3. Per-file classification

### 3.1 `CalendarPageV3.jsx` (734 lines) — **Refactor**

The page currently *is* the business logic — header, view switching, all DnD handlers, all command-bar action handling, filter persistence, timezone resolution, and the post-select/save/delete flow all live directly in this one file. Spec §1's explicit rule ("the page components contain no business logic... any behavior difference between personal and org calendars must be expressible as a prop/permission check inside the shared engine") means this file's *content* needs to move into the new `src/calendar/` engine; what survives as `PersonalCalendarPage.jsx` should be a thin wrapper resolving scope and rendering the shared engine, not this file's current shape.

What's worth carrying forward conceptually (not verbatim) into the new engine:
- The view-mode switch (week/month), filter popover pattern, and ⌘K command-bar wiring are sound UX ideas; they just need to live in `CalendarGrid.jsx`/`calendarUiStore.js` rather than the page.
- The DnD-handler logic (`handleDragEnd`, optimistic update + toast + rollback-on-error shape) is the right *shape* of what `useScheduleAction.js` needs to become, but it currently writes `scheduled_at` directly via `CalendarStore.updatePost()` with no optimistic-concurrency guard (no `updated_at` staleness check) — spec §5 explicitly calls this out as new, required behavior the current code does not have anywhere. This is a Refactor, not a Reuse, specifically because of that gap.
- The reschedule-lock check (`isLockedForReschedule(drag.post.status)` at `CalendarPageV3.jsx:330`) is good and should carry forward into `useScheduleAction.js`.

**Reasoning for Refactor (not Remove):** the interaction model (drag-to-reschedule, click-to-open-detail, ⌘K command bar, filters) is fundamentally the right concept for a personal calendar and matches the spec's intent in §3/§5. The problem is structural placement and a few real safety gaps (concurrency guard, conflict-toast-not-hard-block per §5), not the underlying idea.

### 3.2 `v3/MonthGrid.jsx` (147 lines) — **Refactor**

Maps closely to spec §3's Month view requirement: "shows up to 3 grouped cards per day, then '+N more'" — this is *exactly* what `MonthCell` already does (`MonthGrid.jsx:42-43`, `visible = items.slice(0,3)`, `overflowCount`). The "+N more" button (`MonthGrid.jsx:85-93`) opens the post panel for the 4th item rather than a slide-over list of all overflow items — spec §3 wants "+N more" to open "that day in a slide-over list," not jump straight to one arbitrary post. That's a real behavioral gap, but a small one.

Bigger gap: spec §2.2 requires fan-out posts (one generation → multiple platform rows) to render as **one card with a platform-icon stack**, never N separate cards on the same day. Current `MonthCell` has no grouping logic at all — it renders one card per `posts` row, so a 3-platform fan-out of a single generation today would visibly consume 3 of the "3 visible" slots and push real distinct content into "+N more." This is a correctness bug against the new spec, not just a structural one, and it's why this file is Refactor rather than Reuse despite getting the headline behavior (3-card + overflow) right.

Comment in the file itself (`MonthGrid.jsx:1-4`) says the pattern was "ported from the team product's OrgCalendar MonthCell" — confirming the cross-pollination the spec wants to make official already happened informally once; the rebuild should make that sharing structural instead of copy-pasted.

### 3.3 `v3/WeekGrid.jsx` (291 lines) — **Refactor**

This is the closest existing analog to spec §3's Week view ("Hour-aware... Drag changes both date and time") and is the single most reusable *concept* in the whole tree: 24-hour grid, droppable hour cells, draggable post chips with disabled-when-locked dragging, a live "now" line, optimal-slot highlighting. The drag-and-drop mechanics here (lines 47-71 `HourCell`, 74-112 `PostChip`) are a legitimate reference implementation for what `useScheduleAction.js` + the new `CalendarGrid.jsx` need to do.

Reasons it's Refactor and not Reuse:
- No multi-platform grouping (same gap as MonthGrid, §2.2).
- No optimistic-concurrency guard on drop (spec §5).
- Drag conflict on drop just isn't checked at all today — there's no "same account + same platform + same exact timestamp" check anywhere in `handleDragEnd` (`CalendarPageV3.jsx:320-354`); it silently overwrites. Spec §5 requires a non-blocking "schedule anyway" toast on conflict — this needs to be added, it doesn't exist in any form today.
- Built as a Calendar-only component, not the scope-agnostic shared `CalendarGrid.jsx` the spec wants for both personal and org.

### 3.4 `v3/PostPanel.jsx` (518 lines) — **Refactor**

Maps to spec §4's `PostDetailDrawer.jsx`. Good material here: caption editor with live char-limit-per-platform counting (`PLATFORM_CHAR_LIMITS`, matches spec's mention of per-platform caption cards reusing "the same caption-card pattern from `StudioPublishPanel`" — this file already independently built something with the same intent, though not literally sharing code with `StudioPublishPanel.jsx`), hashtag chip removal, AI caption audit integration, a readiness checklist computed once and shared between the checklist UI and the Save-button label (explicit comment at lines 235-237 about why — this is a genuinely good pattern worth preserving), and date/time fields for rescheduling.

Gaps against spec:
- Spec wants per-platform caption **tabs** for an expanded fan-out group (§4: "per-platform caption tabs... asset preview, and — org only — the pipeline approval history"). Current `PostPanel` edits a single post row's single caption/platform; there's no concept of "this card represents 3 fanned-out rows, here are 3 tabs."
- No pipeline-approval-history section — correctly out of scope for personal (spec says org-only), so not a gap for *this* packet, just noting the file as currently built has no scope-conditional rendering at all; the new shared engine needs that branch point.
- The account-reassignment dropdown (lines 219-221, 303-320) lets a user change `platform`/`account_id` on an existing post — this is *not* described anywhere in `CALENDAR_SPEC.md`. It's a reasonable feature but it's additive scope beyond the spec; flag for human decision on whether to carry it forward into `PostDetailDrawer.jsx` or drop it as out-of-spec scope creep.

### 3.5 `v3/DraftTray.jsx` (148 lines) — **Refactor**

This is the existing analog to spec §1/§3's `UnscheduledRail.jsx`, and for the **personal** scope specifically, the spec says the rail "Personal shows drafts" — which is exactly what this file already does, including the drag-to-schedule interaction spec §3 calls for ("Drag a card from here onto a calendar date to schedule it"). Readiness-score bar per draft card (lines 23-29, `readinessScore()`) is a nice touch with no direct spec mandate but no spec conflict either.

Refactor (not Reuse) because:
- It needs to become scope-aware (`UnscheduledRail.jsx` must also handle the org "approved-but-unplaced backlog" case per spec §3 — this file today has zero concept of org/approval state, it only ever shows `status='draft'` rows).
- The touch-drag fallback requirement (Master Brief §4: "every desktop hover/drag interaction needs a working non-hover equivalent... drag-and-drop reschedule needs a tap-to-select-then-tap-target-slot fallback") is not implemented here — `DraftTray.jsx` relies entirely on `@dnd-kit`'s `TouchSensor`, which gives touch *drag* but not an explicit tap-to-select-then-tap-destination alternative for users who can't complete a drag gesture. This needs design attention in Phase 2, not just an implementation carry-over.

### 3.6 `v3/CalendarCommandBar.jsx` (272 lines) + `v3/CellCommandPalette.jsx` (126 lines) — **Reuse** (as a unit, with scope caveat)

Neither maps to anything named in `CALENDAR_SPEC.md`. The spec does not mention a ⌘K AI command bar or a cell-click quick-action popover anywhere in its component list, views, or interactions sections. However, nothing in the spec contradicts or supersedes this feature either — §9 ("AI-assisted actions... always produce a proposal the user confirms, never an auto-committed write") is fully satisfied by the current implementation: every command-bar action (`handleCommandApply` in `CalendarPageV3.jsx:468-542`) requires the user to click an explicit "Apply" action button before anything is written, and the AI never auto-commits.

**Classified Reuse, not Refactor or Remove,** because: it already works, it doesn't conflict with the new architecture (it can sit inside `CalendarGrid.jsx`/the page wrapper as an optional enhancement layer that calls into the same `useScheduleAction()` plumbing once that exists, rather than `CalendarStore.updatePost()` directly), and removing a working, spec-compliant feature with no replacement named in the spec would be a regression, not a cleanup. The only required change is swapping its internal calls from `CalendarStore` methods to whatever the new `useScheduleAction()`/`calendarService.js` expose — that's a wiring change, not a redesign, which is why this is Reuse rather than Refactor. Flagging for human confirmation since the spec's silence on this feature could also mean "intentionally not in v1 scope" rather than "assumed to continue" — see open items at the end of this report.

### 3.7 `v3/IntelligenceStrip.jsx` (197 lines) — **Reuse** (with the same scope caveat as 3.6)

Same situation as the command bar: not named in the spec, doesn't conflict with it. The file's own comments are notably careful about AI honesty (explicitly *not* styling the locally-computed tip as an AI feature, to avoid confusion with the real AI features elsewhere on the page) — this is exactly the kind of honesty discipline the rest of the spec cares about (see spec §2.1's "Honesty note" on the Published status pill). Classified Reuse for the same reason as 3.6: it works, it's spec-compliant in spirit (no AI auto-commit, accurate self-description), and nothing in the spec replaces it. Same scope-confirmation flag applies.

### 3.8 `components/ScheduleModal.jsx` (216 lines) — **Refactor**

This is the file the packet specifically asked about ("anything left over from the Generate Studio 'coming soon' toast that should be referenced rather than duplicated" — see §6 below for that specific question) and it deserves its own careful read because of where it's actually used.

**Key finding: this file is not used by the Calendar page at all.** It is imported and rendered exclusively by `src/pages/LibraryPage/LibraryPageV2.jsx:30,1002` for Library's own "Schedule" button. `CalendarPageV3.jsx` and none of its v3 subcomponents import it — Calendar's own scheduling today happens entirely through drag-and-drop (`WeekGrid`/`DraftTray`) or through `PostPanel`'s inline date/time fields, never through this modal.

This matters directly for spec §6: *"`useScheduleAction()` + `ScheduleModal.jsx` is the single implementation of 'set a date/time on a post,' invoked from four places: Calendar itself, My Workspace's 'ready to schedule' queue, Pipeline Board's inline schedule action, and Library's 'Schedule' button."* Today, exactly one of those four call sites (Library) uses anything resembling a shared modal, and it isn't actually shared with Calendar — Calendar has its own separate, modal-free scheduling paths. So the *concept* of "one ScheduleModal used everywhere" is right and even half-exists, but the *implementation* needs to (a) move to `src/calendar/components/ScheduleModal.jsx`, (b) gain the account-timezone-explicit display and conflict-check spec §6 requires (current version has neither — it works in naive local browser time via plain `Date` objects, no timezone parameter at all, unlike the rest of the Calendar tree which carefully uses `src/utils/timezone.js`), and (c) actually be wired into Calendar's own flows so there's truly one implementation, not a Library-only one that Calendar should but doesn't currently call.

**Reasoning for Refactor, not Reuse:** the naive-Date-object time handling (lines 27-81: `new Date(...)`, `.getHours()`, `.setHours()` with no timezone parameter anywhere) is a direct contradiction of spec §6's explicit requirement ("account timezone, not browser timezone, shown explicitly") and of the care the rest of the Calendar tree already takes via `timezone.js`. This is a real correctness gap, not just a location problem.

**Reasoning for Refactor, not Remove:** the calendar-grid UI itself (month nav, day picker, time inputs) is straightforward and serviceable as a starting point; Library's existing caller would need to keep working through the transition, so this needs a planned refactor-in-place (move + fix timezone + wire into Calendar too), not a delete-and-rebuild-from-zero.

### 3.9 `src/stores/CalendarStore.js` (548 lines) — **Split classification: Refactor (posts-related) / Remove (everything else)**

This file has two distinct halves that need different treatment:

**Refactor — posts-related methods** (`fetchPosts`, `fetchDrafts`, `createPost`, `updatePost`, `deletePost`, `subscribeToUpdates`, lines 44-198 and 476-525): this is the real, working data-access layer for everything `CalendarPageV3.jsx` and its subcomponents actually use. It correctly scopes every query by `user_id` (matches spec §9's "every query... filters by scope first" rule already, for the personal case), correctly excludes drafts from the main calendar fetch via `CALENDAR_POST_STATUSES` (line 12-17), and routes every status change through `assertPostStatusTransition()` (the status machine guard) before writing — a real safety mechanism the spec doesn't explicitly ask for but that's good practice and worth carrying forward. This needs to become `calendarService.js` (the spec's name for this layer) plus a new `useCalendarPosts.js` hook wrapping it, built to the scope-aware shape (`{ workspaceType, organizationId?, brandProjectId?, userId }`) spec §0 requires — today it's hardcoded to `supabase.auth.getUser()` everywhere with no scope parameter at all, which is exactly the gap spec §0 names ("For Personal, no equivalent hook exists yet").

**Remove — everything else** (`ghostSlots`, `contentPillars`, `optimalTimes`, `calendarSettings` state slices and their associated `fetchGhostSlots`, `acceptGhostSlot`, `fetchContentPillars`, `createContentPillar`, `fetchOptimalTimes`, `getBestTimeForDate`, `fetchCalendarSettings`, `updateCalendarSettings` methods — roughly lines 200-458, ~258 of the file's 548 lines): **confirmed via repo-wide grep that none of these methods or state fields are referenced anywhere in `CalendarPageV3.jsx` or any `v3/*.jsx` component.** They query tables (`ghost_slots`, `content_pillars`, `optimal_posting_times`, `calendar_settings`) that `CALENDAR_SPEC.md` does not mention at all — this is leftover infrastructure from an earlier, more ambitious iteration of the calendar (see §5 below, `implementation_guide.md`, which describes exactly this feature set as "complete, production-ready"). It is genuinely dead code today: present in the store, invisible to the user, costing nothing at runtime except bundle size and a four-table footprint of unused complexity for future maintainers to puzzle over.

**Reasoning:** I classify the dead-code half as Remove rather than Refactor because nothing in `CALENDAR_SPEC.md` calls for "ghost slots," "content pillars," or "optimal posting times" as features — the spec's own AI-assisted feature is "Phase 2... AI 'fill this day' suggestions from unused Library assets (proposal-only)" (§11), which is a different mechanism reading from Library, not from a dedicated `ghost_slots`/`optimal_posting_times` schema. Carrying this code forward into the new `calendarService.js` would import unused complexity into a fresh file that's supposed to be the spec's single source of truth. This is exactly the kind of "old code as input to be audited, not blank slate" case the Master Brief means — it needs an explicit human Remove decision, not a silent drop, because the underlying tables/migrations might still be wanted for a future phase and that's not for this audit to decide unilaterally.

### 3.10 `src/services/calendarAIService.js` (331 lines) — **Reuse**

Clean separation of concerns already: every exported function is a thin client around the `calendar-ai` edge function (or, for `checkPublishReadiness()`, a pure local computation with no network call at all). Nothing here talks to `posts` directly — it only receives/returns plain data the caller already has. This survives the rebuild untouched regardless of where the calling components end up, because it has no dependency on `CalendarStore.js`, `CalendarPageV3.jsx`, or any other file being audited here — only on its own edge function contract. Classified Reuse because there is no structural reason to change it; the new `CalendarGrid.jsx`/command-bar-equivalent (if retained, see 3.6) can call these exact functions unmodified.

### 3.11 `src/utils/postStatusMachine.js` (56 lines) — **Reuse**

Directly implements the unified status taxonomy spec §2.1 describes (draft → scheduled → publishing → published/failed, plus archived) as an explicit transition table rather than ad hoc status string comparisons scattered across components. `isLockedForReschedule()` already encodes spec §5's "published posts can't silently move" rule. This is exactly the kind of shared, scope-agnostic logic the spec's "shared engine" philosophy wants — it has zero personal/org-specific logic in it today and can be imported directly by `useScheduleAction.js` without modification. Reuse, no caveats.

### 3.12 `src/utils/timezone.js` — **Reuse**

Spec §6 requires "account timezone, not browser timezone, shown explicitly" in the new `ScheduleModal`. This file is the only piece of the entire audited tree that already does that correctly and consistently — `getZonedDateKey`, `getZonedParts`, `zonedDateKeyAndHourToUTC`, `formatInTimeZone` are all timezone-explicit, Intl-only (no new dependency risk), and already proven across `MonthGrid`, `WeekGrid`, `PostPanel`, and `CalendarPageV3` itself. This is precisely the implementation `components/ScheduleModal.jsx` (3.8 above) is missing and should be made to use. Reuse, no caveats — and notably, the one file in this whole audit that should be held up as the reference standard for the rest.

### 3.13 `src/constants/statuses.js` (`POST_STATUS` portion) — **Reuse**

Already the single canonical source for status strings used by `CalendarStore.js` and `postStatusMachine.js` alike — no parallel/competing status enum exists in the Calendar tree. Matches spec §2.1's taxonomy (`draft/scheduled/publishing/published/failed`, plus `archived` which the spec doesn't name but doesn't contradict either — archived is a reasonable terminal state beyond published, not in conflict with anything). Reuse.

### 3.14 `implementation_guide.md` — **Remove**

Not code, but flagged because it actively documents a different, superseded architecture (`CalendarPageV2.jsx`, `CalendarView.jsx`, `GhostSlotCard.jsx`, `OptimalTimesService.js`, a `daily-analysis` edge function, `CalendarV2.css`) — none of which exist in the current `CalendarPageV3.jsx` tree. Leaving it in place risks a future engineer (human or agent) reading it as current and rebuilding against a description of a page that no longer exists. Recommend Remove (delete the stale doc) once a human confirms it has no historical/reference value worth preserving elsewhere (e.g., copied into an archive folder instead of deleted outright, if the `ghost_slots`/`content_pillars` feature set is wanted again in a future phase).

---

## 4. Multi-platform grouping — resolving the packet's flagged item early

Spec §2.2 asks to confirm before grid-rendering logic is built: *"Confirm whether a stable grouping key (`generation_id`/`content_group_id`) already exists across fanned-out multi-platform `posts` rows, or needs adding."*

This is formally Phase 1 (`implementation-researcher`) territory, but the answer materially changes how I classify `MonthGrid.jsx`/`WeekGrid.jsx` above, so I confirmed it now rather than leaving it open:

- `posts.generation_id` **already exists** as a real column, referenced consistently across `src/stores/SessionStore.js`, `src/org/services/pipelineService.js`, `supabase/functions/admin-list-posts/index.ts`, and documented explicitly in `docs/database-consistency-audit.md:76` ("`posts.generation_id -> generations.id`"). The `20260227103000_generation_post_unification_and_rls.sql` migration treats it as a load-bearing join key already (used to find/dedupe draft rows per generation).
- This means a multi-platform fan-out (one generation → N `posts` rows, one per platform/account, per `PERSONAL_WORKSPACE_SPEC.md` §5.4: "Builds one `posts` row per selected platform/account") already shares a common `generation_id` across all N rows **today** — no schema change is needed to group them.
- **What's missing is purely presentational:** neither `MonthGrid.jsx` nor `WeekGrid.jsx` currently groups by `generation_id` before rendering cards — they render one card per `posts` row, full stop. This is a rendering-logic gap (confirmed in §3.2/§3.3 above), not a data-model gap.

This pushes the answer toward "use the existing `generation_id`, do not add a new `content_group_id` column" — but final sign-off on that recommendation belongs to the Phase 1 research agent and to you, not to this audit; I'm surfacing the evidence here so Phase 1 doesn't have to re-derive it from scratch.

---

## 5. Generate Studio stub toast — confirmed location, not analyzed further

Per Master Brief §0 rule 2 and the packet's explicit scope boundary, I did not analyze Generate Studio. I located only what the packet asked me to confirm:

- The stub fires from `src/components/GenerateStudio/BrandosseGenerateStudio.jsx:606`: `onSchedule={() => toast('Calendar scheduling coming soon.')}`, passed as a prop into `<StudioPublishPanel>` (rendered when `studioStage === 'publish'`).
- `PERSONAL_WORKSPACE_SPEC.md` §5.4 attributes this same stub to `StudioPublishPanel.jsx:606` — both references point at the same wiring point (the button lives visually inside `StudioPublishPanel`, the handler that makes it a stub is defined one level up in `BrandosseGenerateStudio.jsx`). Not a contradiction, just two valid ways of citing the same integration seam.
- **Nothing in the audited Calendar tree currently references this stub, imports from it, or duplicates its logic.** There is no leftover scaffolding inside `CalendarPageV3.jsx` or any v3 component pointing at this toast — Calendar and Generate Studio are presently fully decoupled on this point, which is good: it means there's nothing to "deduplicate" because nothing was duplicated. The only real connection is the one spec §6.1 names explicitly: once the new `ScheduleModal` exists (the spec's shared one, not today's Library-only one), wiring this stub button to open it would be "a one-line integration" — but that one line lives inside `BrandosseGenerateStudio.jsx`, which is off-limits without separate sign-off (spec §6.1 and the packet's Phase 3 instructions both flag this explicitly as deferred, not decided here).

---

## 6. Direct answers to the packet's three named questions

**"Is there any existing calendar rendering code worth keeping at all?"**
Yes, substantially. `WeekGrid.jsx`'s hour-grid + drag mechanics and `MonthGrid.jsx`'s day-cell + overflow pattern are both legitimate reference implementations for the new `CalendarGrid.jsx` — the *interaction model* is right (drag-to-reschedule, click-to-open-detail, "+N more" overflow, locked-status drag-disable). What needs to change is (a) extracting them into the scope-agnostic shared engine, (b) adding multi-platform grouping (§4 above), and (c) adding the optimistic-concurrency guard and non-blocking conflict toast spec §5 requires, neither of which exist today in any form.

**"Is there anything resembling `scheduled_at` handling already correct?"**
Yes — `src/utils/timezone.js` (§3.12 above) is the one piece of this entire tree that already does `scheduled_at` handling exactly the way spec §6 wants the new `ScheduleModal` to: explicit IANA timezone, not browser-implicit, via Intl APIs with no new dependency. It's proven correct in production today across four different components (`MonthGrid`, `WeekGrid`, `PostPanel`, `CalendarPageV3`). By contrast, `components/ScheduleModal.jsx` (§3.8) — the file whose *name* matches the spec's target file most closely — is the one place in the tree that gets this wrong (naive browser-local `Date` objects, no timezone parameter at all). Worth being explicit about this inversion: the correctly-named file is the worst offender; the correct logic lives in a generically-named utils file.

**"Is there anything tied to the Generate Studio stub toast that the new build should reference rather than duplicate?"**
No — see §5. There is nothing to reference because there is nothing currently duplicated. The only actionable connection is the deferred one-line wiring spec §6.1 already names as an open question requiring separate sign-off before touching `BrandosseGenerateStudio.jsx`.

---

## 7. Summary table

| File | Lines | Classification | One-line reason |
|---|---|---|---|
| `pages/CalendarPage/CalendarPageV3.jsx` | 734 | Refactor | Right interactions, wrong layer (business logic belongs in shared engine, not the page); missing concurrency guard |
| `pages/CalendarPage/v3/MonthGrid.jsx` | 147 | Refactor | Correct 3-card+overflow pattern; missing multi-platform grouping (§2.2) |
| `pages/CalendarPage/v3/WeekGrid.jsx` | 291 | Refactor | Best existing DnD reference; missing grouping, concurrency guard, conflict toast |
| `pages/CalendarPage/v3/PostPanel.jsx` | 518 | Refactor | Good readiness-checklist pattern; missing per-platform tabs for fan-out groups |
| `pages/CalendarPage/v3/DraftTray.jsx` | 148 | Refactor | Right concept for personal Drafts rail; not scope-aware, no explicit tap-fallback |
| `pages/CalendarPage/v3/CalendarCommandBar.jsx` | 272 | Reuse | Works, spec-compliant (proposal-only AI), not contradicted by spec — confirm intentional v1 inclusion |
| `pages/CalendarPage/v3/CellCommandPalette.jsx` | 126 | Reuse | Same as above, paired component |
| `pages/CalendarPage/v3/IntelligenceStrip.jsx` | 197 | Reuse | Works, honest about what is/isn't AI, not contradicted by spec |
| `pages/CalendarPage/components/ScheduleModal.jsx` | 216 | Refactor | Right concept, wrong timezone handling, wrong owner (used by Library, not Calendar) — needs to become the actual shared modal |
| `stores/CalendarStore.js` (posts methods) | ~290 of 548 | Refactor | Real working data layer; needs scope-awareness, rename to `calendarService.js`/`useCalendarPosts.js` |
| `stores/CalendarStore.js` (ghost/pillar/optimal/settings methods) | ~258 of 548 | Remove | Confirmed dead — zero references anywhere in the rendered Calendar tree; queries tables not in spec |
| `services/calendarAIService.js` | 331 | Reuse | Clean, decoupled, edge-function client; no structural reason to change |
| `utils/postStatusMachine.js` | 56 | Reuse | Already implements spec §2.1's taxonomy + §5's reschedule-lock rule |
| `utils/timezone.js` | — | Reuse | Already does exactly what spec §6 wants; the reference standard for the rebuild |
| `constants/statuses.js` (`POST_STATUS`) | — | Reuse | Single canonical status source, matches spec taxonomy |
| `pages/CalendarPage/implementation_guide.md` | — | Remove | Describes a superseded architecture (V2, ghost slots, etc.) not present in the current build — actively misleading if left in place |

**Counts:** Reuse = 8, Refactor = 6, Remove = 2 (one code block within `CalendarStore.js`, one stale doc).

---

## 8. Open items for human attention (not full open-questions resolution — that's Phase 1/3's job)

1. Whether `CalendarCommandBar.jsx`/`CellCommandPalette.jsx`/`IntelligenceStrip.jsx` (the ⌘K AI bar, cell palette, and stat strip) are an intentional carry-forward into the new build or were simply never mentioned in `CALENDAR_SPEC.md` because they're meant to be cut for v1 simplicity. I classified them Reuse on the basis of "works and doesn't conflict," not on confirmed intent to keep — flagging explicitly so this doesn't get assumed either direction.
2. The account/platform-reassignment dropdown in `PostPanel.jsx` (§3.4) is scope beyond what `CALENDAR_SPEC.md` describes for `PostDetailDrawer.jsx`. Decide whether to carry it forward.
3. The dead `ghost_slots`/`content_pillars`/`optimal_posting_times`/`calendar_settings` code and underlying tables (§3.9, §3.14) — confirm whether the associated Supabase tables/migrations should also be flagged for a future cleanup pass (out of scope for this audit, which only covers `src/**` files per the Master Brief's file-map instruction, but the human should know the dead code's tables likely still exist in the live schema).
4. `components/ScheduleModal.jsx` is currently load-bearing for Library (`LibraryPageV2.jsx`) even though it lives under the Calendar page's folder. Any refactor plan needs to keep Library's caller working throughout the transition — this is a cross-packet dependency between Packet 1 (Calendar) and Packet 2 (Library) that whoever runs Packet 2's audit should also be made aware of.

---

**Awaiting human sign-off before any Remove classification is acted on.** Nothing in this report has been deleted, edited, or moved — this is a read-only audit and recommendation only. The two Remove classifications above (the dead `CalendarStore.js` methods and `implementation_guide.md`) require your explicit approval before any agent touches them, per Master Brief §0 rule 3.
