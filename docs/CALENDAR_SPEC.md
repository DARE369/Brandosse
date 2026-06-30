# Content Calendar — Specification (Personal + Org)

Status: **Proposed — pending sign-off on §13 open questions before implementation starts.**
Companion documents: `ORG_WORKSPACE_SPEC.md`, `PERSONAL_WORKSPACE_SPEC.md`, `LIBRARY_SPEC.md`.

**Explicit non-goals:** this spec does not modify the Dashboard (`UserDashboard.jsx`), Generate Studio / AI Studio (`GeneratePageV2.jsx`, `SessionStore.js`, `OrgGenerateComposer.jsx`), or Pipeline's approval logic (`PipelineBoard.jsx`, `PipelineConfigPage.jsx`). Calendar *reads* posts and pipeline state and *writes* scheduling changes to `posts`; it does not own approval, generation, or the dashboard's KPI surface.

---

## 0. What already exists vs. what this spec builds

Two hooks referenced in `ORG_WORKSPACE_SPEC.md` §3 already exist and are load-bearing for Org Overview today: `useOrgCalendar()` (aggregated snapshot of `posts` + `pipeline_items`, org-scoped) and the calendar-adjacent counts feeding "scheduled this week" / "approved queue" / "next 5 scheduled posts." **This spec extends that hook rather than replacing it** — Overview's summary numbers and the full Calendar page must share one source of truth. Building a second, parallel aggregation would let the two surfaces silently disagree with each other.

For Personal, no equivalent hook exists yet (Dashboard queries `posts`/`generations`/`video_clips` directly). Personal Calendar gets a fresh hook, `usePersonalCalendarPosts()`, built to the same shape so the two can eventually share more code than they currently could.

---

## 1. One engine, two surfaces

```
src/calendar/
  components/
    CalendarGrid.jsx          # month/week rendering, scope-agnostic
    CalendarListView.jsx      # agenda/list view
    PostCard.jsx              # the card shown in any view
    PostDetailDrawer.jsx      # click-through detail panel
    ScheduleModal.jsx         # THE single scheduling UI — see §6
    QuickPostComposer.jsx     # lightweight create-and-schedule flow — see §6.3
    UnscheduledRail.jsx       # "Drafts" (personal) / "Approved backlog" (org)
    BrandProjectSwitcher.jsx  # org-only, reused from existing brand-project context
  hooks/
    useCalendarPosts.js       # scope-aware: { workspaceType, organizationId?, brandProjectId?, userId }
    useScheduleAction.js       # the one place reschedule/schedule/unschedule logic lives
  services/
    calendarService.js        # query + mutation layer, always filters by scope first
  stores/
    calendarUiStore.js         # view mode, selected date range, filters — local UI state only

src/pages/ContentCalendar/PersonalCalendarPage.jsx   # thin wrapper, personal scope
src/org/pages/OrgCalendar.jsx                         # thin wrapper, org scope, extends useOrgCalendar()
```

Rule, mirroring how `OrgGenerateComposer` wraps the shared Generate Studio engine: **the page components contain no business logic.** They resolve scope (from `OrgContextProvider` / personal session) and pass it into the shared engine. Any behavior difference between personal and org calendars must be expressible as a prop/permission check inside the shared engine, not as forked page-level code.

---

## 2. Data model — additive only

Calendar has **no primary table of its own.** It is a presentation and scheduling-action layer over:

- `posts` — read for display, written for `scheduled_at` / status changes.
- `pipeline_items` (org only) — read-joined for approval-stage overlay; **never written by Calendar.** Approval state changes stay exclusively in Pipeline.

### 2.1 Unified status taxonomy

| Status (shown on card) | Personal source | Org source | Who can move it |
|---|---|---|---|
| Draft | `posts.status = 'draft'` | `posts.status = 'draft'`, no pipeline submission yet | owner of the draft |
| In review | — | `pipeline_items.status IN ('pending','in_review')` | nobody (read-only on Calendar; action happens in Pipeline) |
| Revision requested | — | `pipeline_items.status = 'revision_requested'` | nobody (read-only; action happens in My Workspace/Pipeline) |
| Approved (unscheduled) | n/a — personal has no approval gate | `pipeline_items.status = 'approved'` AND `posts.scheduled_at IS NULL` | anyone with `can_schedule` |
| Scheduled | `posts.status = 'scheduled'` | same | anyone with `can_schedule` (drag to reschedule, or unschedule) |
| Publishing | `posts.status = 'publishing'` | same | nobody — transient, polling state |
| Published | `posts.status = 'published'` | same | nobody (read-only; duplicate-to-new-draft is the only action) |
| Failed | `posts.status = 'failed'` | same | owner / `can_schedule` (retry or reschedule) |

**Honesty note carried over from the Personal spec's stub list:** "published" today means `executeMockPublishAttempts()` succeeded, not that content reached a real platform. The status pill must not claim more than that. Recommend the pill literally read "Published" with a small "via mock connection" affordance on the connected-account icon (already how Account Health communicates this elsewhere) rather than inventing new copy — keeps one honesty mechanism instead of two.

### 2.2 Multi-platform grouping (flagged assumption — see §13.1)

A single generation can fan out into multiple `posts` rows (one per platform/account, per Personal spec §5.4). Calendar renders these as **one card with a platform-icon stack**, expandable to per-platform tabs in the detail drawer — never N separate cards on the same day for the same piece of content. This requires a stable grouping key (`generation_id` or an explicit `content_group_id`) shared across the fanned-out rows. **This must be confirmed against the actual schema before the grid-rendering logic is built** — if no such key exists today, it needs to be added as a non-breaking column, written at fan-out time.

---

## 3. Views

- **Month** (default). Density-aware: shows up to 3 grouped cards per day, then "+N more" — opens that day in a slide-over list. This is the view that needs to look "impeccable at a glance" — status communicated by icon+label+color together (never color alone), so a fully scheduled month reads as confidence, not noise.
- **Week.** Hour-aware, for teams that care about exact post times. Drag changes both date and time.
- **List / Agenda.** Flat, filterable, the accessible/mobile-first fallback. Same data, same `PostCard`, different layout — not a separate query.
- **Org only — Brand Project filter.** A dropdown, not a separate page, scoped the same way the Brand Kit and Common Room already scope by `brand_project_id`. Defaults to "all brands I have access to."
- **Unscheduled rail** (collapsible side panel, all views): Personal shows drafts; Org shows the approved-but-unplaced backlog (the same count Org Overview already calls "approved queue"). Drag a card from here onto a calendar date to schedule it — see §6.

---

## 4. Post card anatomy

- Thumbnail (or platform glyph if text-only), platform-icon stack, status pill, scheduled time, connected-account avatar.
- Hover reveals quick actions: reschedule (opens date picker inline), duplicate, open detail.
- Click opens `PostDetailDrawer`: per-platform caption tabs (reusing the same caption-card pattern from `StudioPublishPanel`, read/edit here too), asset preview, and — org only — the pipeline approval history for this item (read-only mirror of what Pipeline Board already shows, so a scheduler never has to leave Calendar to understand *why* something is approved).

---

## 5. Interactions

- **Drag-and-drop reschedule.** Optimistic UI update; on conflict (same account + same platform + same exact timestamp already occupied) show a non-blocking warning toast with "schedule anyway" — never a hard block, since intentional double-posting to the same slot is a real (if rare) use case.
- **Optimistic-concurrency guard.** Every reschedule write includes the row's last-known `updated_at`; if it's stale (someone else moved it first), the UI rolls back and re-fetches that single card rather than silently overwriting a teammate's change. This is the one piece of real-time safety the current spec doesn't describe anywhere and genuinely needs for a multi-editor calendar.
- **Bulk select** (shift/cmd-click on cards): bulk reschedule (shift a batch by N days), bulk unschedule, bulk delete — all permission-gated, all requiring one confirmation for destructive actions.
- **Unschedule** returns a post to draft (personal) or to the approved-unscheduled backlog (org) — it never deletes the underlying content.

### 6. Scheduling — the one shared action

`useScheduleAction()` + `ScheduleModal.jsx` is the **single** implementation of "set a date/time on a post," invoked from four places: Calendar itself, My Workspace's "ready to schedule" queue, Pipeline Board's inline schedule action, and Library's "Schedule" button (see `LIBRARY_SPEC.md` §7). Each caller passes in a `postId` (or, for Quick Post, creates one first) and gets back the same modal: date/time picker (account timezone, not browser timezone, shown explicitly), target account confirmation, and the conflict check from §5.

### 6.1 Wiring Generate Studio's stubbed button (flagged, not decided here)

The Personal spec documents a known stub: Generate's own Schedule button just toasts "coming soon." Once `ScheduleModal` exists, wiring that button to open it is a one-line integration — but it touches a file inside AI Studio (`StudioPublishPanel.jsx`), which you've asked to leave untouched for now. **Left as an explicit open question (§13.2).** Until resolved, the *only* way to schedule a personal draft is via Calendar's own Drafts rail or Library — which is a perfectly reasonable v1 boundary, just stating it plainly rather than assuming.

### 6.2 Org scheduling and the approval boundary

Calendar never grants scheduling rights to content that hasn't cleared whatever gate applies to it: if a brand project has a configured Pipeline, only `pipeline_items.status = 'approved'` items are schedulable; if a brand project has no pipeline configured, anyone with `can_schedule` can schedule a draft directly. This mirrors how Pipeline submission is already optional/explicit in My Office (§4 of the org spec), not mandatory for every draft.

### 6.3 Quick Post composer

A deliberately minimal, calendar-native creation path — *not* a reimplementation of Generate Studio:

1. Pick zero or one existing Library asset (opens a compact asset picker, scoped the same way Library is).
2. Platform toggles + one caption field per platform, pre-filled via the same `generate-post-metadata` edge function Generate already uses (reused as a service call, not duplicated logic).
3. Pick a date/time (reuses `ScheduleModal`'s picker) or save as draft.
4. On submit: creates the `posts` row(s) directly. For org, if the active brand project has a configured pipeline, it routes through `submitPostToPipeline()` exactly like My Office does — Quick Post is a second front door into the same pipeline, not a bypass of it.

This is what makes "schedule something without ever opening AI Studio" possible — closing the gap noted in the cover message — without rewriting anything inside Generate.

---

## 7. Permissions

| Action | Personal | Org — gating permission |
|---|---|---|
| View calendar | always (own content) | always (scoped to org; reviewer/contributor see everything for context) |
| Drag-reschedule / schedule | always | `can_schedule` |
| Quick Post — schedule directly | always | `can_schedule`; if no pipeline configured for the brand project, also requires `can_publish` semantics consistent with §9.1 of the org spec |
| Quick Post — submit to pipeline | n/a | anyone who can already submit from My Office |
| Bulk delete | always (own) | `can_manage_library` is the closest existing flag *for assets*; for posts, gate bulk delete behind `org_admin`/`org_owner` or the post's own submitter — flagged in §13.3, no exact existing permission maps cleanly to "delete a scheduled post" today |
| Brand project filter | n/a | always available, scoped to brand projects the member has access to |

---

## 8. Notifications & realtime

- Realtime subscription on `posts` (+ `pipeline_items` for org), **debounced 800ms** — identical convention to the Dashboard's existing realtime pattern, so the whole product feels consistent rather than Calendar inventing its own timing.
- Reschedule, schedule, and unschedule actions should emit into the existing notification surface. Personal: `user_notifications`, merged into the bell exactly as today. **Org: flagged open question (§13.4)** — no org-level notification table is described in the org spec; Calendar needs somewhere to tell a teammate "your approved post was scheduled by someone else," and this is presently undefined infrastructure, not a Calendar-specific gap.

---

## 9. Security & reliability

- Every query in `calendarService.js` filters by scope first (`organization_id` / `user_id`), exactly the enforced pattern already used everywhere else — no exceptions, no "admin can see everything" shortcut at the query layer (admin-wide views are a UI composition of properly-scoped queries, never an unscoped one).
- Permission-gated actions are **disabled with an explanatory tooltip**, not hidden — except admin-only surfaces, which stay hidden per existing convention (org spec §2). This keeps "why can't I do this" self-evident, in line with the no-explaining-needed requirement.
- Each panel (grid, unscheduled rail, brand-project switcher) loads and errors independently — one widget failing doesn't blank the page, matching the Dashboard's per-widget retry pattern.
- AI-assisted actions (Quick Post caption pre-fill, "fill this day" suggestions — phase 2) always produce a **proposal the user confirms**, never an auto-committed write. No AI action mutates `posts` directly.

---

## 10. Empty / loading / error states

| State | Behavior |
|---|---|
| No posts at all (new account) | Calendar shows the month grid empty, with a single centered CTA into Quick Post or "go create your first post" — AI Studio (a link, not a redirect — Calendar stays the home surface) |
| Loading | Skeleton cards in grid cells, matching Dashboard's skeleton convention |
| A single day fails to load detail | Inline retry on that day's slide-over, rest of calendar unaffected |
| Drag conflict | Non-blocking toast, described in §5 |
| Stale write (concurrency conflict) | Toast + automatic single-card refresh, described in §5 |

---

## 11. Phased build plan

**MVP**
- Month + List views, personal and org, read-only pipeline overlay for org.
- `ScheduleModal`, drag-and-drop reschedule, unschedule.
- Unscheduled rail (drafts / approved backlog).
- Quick Post composer (asset-optional, caption-assisted, schedule-or-draft).
- Permission gating per §7.

**Phase 2**
- Week view, bulk actions, brand-project swimlanes.
- AI "fill this day" suggestions from unused Library assets (proposal-only, per §9).
- Org-level notification wiring once that infrastructure exists.

**Phase 3**
- Recurring/evergreen post support (not modeled anywhere in `posts` today — a deliberate scope cut, not an oversight, since it would touch the schema).
- Generate Studio Schedule-button integration, pending §13.2.

---

## 12. Open questions requiring sign-off before implementation

1. **§2.2** — Confirm whether a stable grouping key (`generation_id`/`content_group_id`) already exists across fanned-out multi-platform `posts` rows, or needs adding.
2. **§6.1** — Should Generate Studio's stubbed Schedule button be wired to the new `ScheduleModal` now (a small touch inside AI Studio), or stay deferred until you explicitly approve touching that file?
3. **§7** — "Bulk delete a scheduled post" doesn't map cleanly to an existing permission flag (those govern library/publish/schedule/tasks, not post-deletion specifically). Confirm the intended owner of this action.
4. **§8** — Confirm whether an org-level notifications mechanism exists/is planned, or whether Calendar should provision a minimal one as part of this build.
