# AS-IS Audit — Library & Calendar, current implementation, for ui-v2 migration

Auditor: `docs-auditor`
Date: 2026-07-07
Scope: pre-migration audit of the **already-rebuilt** Personal Content Library
and Personal Content Calendar screens, to determine what should carry forward
unchanged (data layer) vs. be rebuilt on `src/ui-v2/` (presentation layer),
mirroring the pattern already executed for Studio (`src/pages/Studio/StudioPage.jsx`)
and Dashboard (`src/pages/Dashboard/PersonalDashboardPage.jsx`).

This is a read-only audit. No application code was created, edited, or
deleted while producing it.

---

## 0. Important context this audit surfaced

Both screens have **already been fully rebuilt once**, under the older
`docs/calendar-library-rebuild/` packet process (Packet 1 = Personal Calendar,
Packet 2 = Personal Library). That process ran its full lifecycle — AS-IS
audit, research, mockup, design-system-compliance review, mobile-parity
review, QA-persona review (pre-build and post-build), implementation, and a
post-build QA pass — and both screens are now real, wired, working pages
against live Supabase data. They are **not** stubs, not mocked, not
half-finished.

What they are *not* built on is `src/ui-v2/`. They're built on the design
system that predates it (referred to in memory as "Midnight Aurora" /
`--dash-*` tokens, `ui-button`/`dashboard-shell` classes, etc.) — the same
system Studio and Dashboard looked like *before* their own ui-v2 rewrites.
So the situation here is structurally identical to what Studio/Dashboard
faced: a working, spec-compliant, real-data page whose *presentation layer*
predates the current design system and needs a like-for-like swap, not a
rebuild of the underlying behavior.

Evidence this prior rebuild happened and is current (not stale docs):
- `docs/calendar-library-rebuild/packet-1-personal-calendar/` and
  `packet-2-personal-library/` both contain a full set of phase artifacts:
  `AS_IS_AUDIT.md`, `RESEARCH.md`, `mockups/` (incl. `mockup-gallery.html`,
  `tokens.css`, `mockup.js`/`mockup.css` for packet 2), `DESIGN_SYSTEM_COMPLIANCE.md`,
  `MOBILE_PARITY.md` (or `QA_PERSONA_REVIEW_mockup.md` for packet 1's
  mobile+desktop screenshot set), `QA_PERSONA_REVIEW_build.md` (packet 2 —
  proof a post-*build* QA pass happened, i.e. Phase 3/4 completed), and a
  `DECISIONS_LOG.md`.
- The actual routed components (`PersonalCalendarPage.jsx`, `LibraryPageV2.jsx`)
  contain extensive comments citing these exact docs and packet phases
  ("Phase 4 QA fix (DECISIONS_LOG.md, QA item 4 — Trash/restore UI)", "Built
  strictly against the approved mockup
  (docs/.../packet-2-personal-library/mockups/mockup-gallery.html)").

**Implication for this migration:** there is no `Library.dc.html` /
`Calendar.dc.html` yet (searched the whole repo — none exist, unlike Studio's
`Studio.dc.html` and Dashboard's equivalent). The existing
`mockups/mockup-gallery.html` files under the two packet folders are the
*prior* design system's mockups, not ui-v2 mockups. **A new ui-v2 mockup
would need to be produced for each screen before a frontend-builder agent
rebuilds the presentation layer** — same gate Studio/Dashboard went through
(a `.dc.html`-equivalent spec file per screen), just not yet created for
these two.

---

## 1. Library — file map

### 1.1 Routing
| File | Role |
|---|---|
| `app/app/library/page.jsx` | Next.js route. Renders `<LibraryPageV2 />` from `@/pages/LibraryPage/LibraryPageV2`. No other logic. |
| `app/app/org/[orgId]/library/page.jsx` | Separate org-scoped route — out of scope for this audit (personal-only packet), noted only so it isn't confused with the file below. |

### 1.2 Presentation layer (what gets rebuilt on ui-v2)
| File | Lines (approx) | Role |
|---|---|---|
| `src/pages/LibraryPage/LibraryPageV2.jsx` | 700 | Page shell: header/actions, grid/table view toggle, filter rail (source/status), search, tag filter, bulk-select mode + bulk action bar, upload modal trigger, asset detail drawer trigger, soft-delete/trash flow, Schedule hand-off to Calendar |
| `src/pages/LibraryPage/components/LibraryCard.jsx` | — | Grid-view asset card: thumbnail, source badge, hover/tap quick actions |
| `src/pages/LibraryPage/components/LibraryBulkActionBar.jsx` | — | Sticky bar shown in bulk-select mode (archive/delete selected) |
| `src/pages/LibraryPage/components/AssetUploadModal.jsx` | — | Multi-file upload flow, per-file progress, duplicate/"mark as new version" handling |
| `src/pages/LibraryPage/components/AssetDetailDrawer.jsx` | — | Side drawer: metadata edit, "used in" posts list, version chain, schedule/duplicate/delete actions |
| `src/pages/LibraryPage/components/SoftDeleteConfirmModal.jsx` | — | Confirm-before-soft-delete modal (30-day recovery copy) |
| `src/pages/LibraryPage/components/TrashModal.jsx` | — | Lists soft-deleted assets, restore action |
| `src/pages/LibraryPage/libraryItemUtils.js` | — | Pure presentational helpers (title/source/format/date label derivation) — not a data layer, but tightly coupled to the current markup's needs; will likely need light rework as props change shape, not a rewrite |

Styling: `src/styles/LibraryV2.css`. Confirmed (read lines 1-5) it defines
`--library-surface`/`--library-border` etc. via `color-mix()` against
`--dash-panel`/`--dash-border` — i.e. it's a themed layer *on top of* the
pre-ui-v2 "Midnight Aurora" token set, not ui-v2's `--uiv2-*` tokens. Also
reuses shared legacy primitives from `src/components/Shared/ui`
(`UiButton`, `UiIconButton`, `UiEmptyState`, `UiPageHeader`, `UiBottomSheet`) —
the same pre-ui-v2 shared component kit Studio/Dashboard used to depend on
before their own rewrites.

### 1.3 Data layer (what should be reused essentially as-is)
| File | Role |
|---|---|
| `src/stores/LibraryStore.js` | Zustand store. Explicitly documented in its own header as "never querying Supabase directly here" — delegates everything to `assetLibraryService.js`. Holds `assets`, `counts`, `loading`, `error`, a 5-minute staleness window, and all the action methods the page calls (`fetchLibraryData`, `uploadAsset`, `updateAssetMetadata`, `archiveAsset`/`unarchiveAsset`, `softDeleteAsset`/`restoreAsset`, `fetchTrash`, `markAsNewVersion`, `fetchVersionChainFor`, `fetchUsedIn`, `fetchAssetById`). |
| `src/services/assetLibraryService.js` | The real Supabase client. Confirmed via direct grep: 13 distinct `.from('personal_assets')` call sites (lines 157, 201, 231, 386, 402, 418, 436, 452, 467, 499, 526, 542, 551) plus additional helper exports (`buildScheduleHandoffPath`, `fetchAssetForHandoff`, `toQuickPostAssetShape` — the Calendar hand-off contract). This is real, live-table access, not mocked. |

**Verdict: data layer is Reuse, unchanged.** Nothing here needs to move or
change shape for a presentation-only ui-v2 rewrite — same pattern as
Studio's `SessionStore.js`/Dashboard's underlying hooks being left alone
while only the render layer moved to `ui-v2` + a `.module.css` file.

### 1.4 Known issues / incomplete states found in Library
- No TODOs or commented-out dead code found in `LibraryPageV2.jsx` itself —
  it reads as a completed, QA-passed build (matches the `QA_PERSONA_REVIEW_build.md`
  artifact's existence).
- `onDuplicate={() => toast('Duplicate is coming soon')}` (`LibraryPageV2.jsx:676`)
  — a real, currently-shipped stub. This is a known, intentional gap (asset
  duplication is not implemented), not an artifact of an incomplete rebuild.
  Flag for the ui-v2 mockup phase to decide whether this stays a stub or
  gets scoped in.
- The raw `<table>` markup for list/table view (lines 592-644) and the
  inline `style={{ gridTemplateColumns: ... }}` on `library-table-item`
  (line 619) are exactly the kind of ad hoc, non-tokenized markup a ui-v2
  rebuild should replace with real `ui-v2` primitives/CSS Modules rather
  than carry forward — flagging as a concrete "don't copy this part
  verbatim" note for the future frontend-builder agent.

---

## 2. Calendar — file map

### 2.1 Routing
| File | Role |
|---|---|
| `app/app/calendar/page.jsx` | Next.js route. Renders `<PersonalCalendarPage />` from `@/pages/ContentCalendar/PersonalCalendarPage`. No other logic. |

Note: this is a **different component than the one the packet-1 audit
(2026-06-23) described** (`CalendarPageV3.jsx`). That file no longer exists
in the tree (confirmed via glob — only `src/pages/CalendarPage/components/ScheduleModal.jsx`
remains under the old `CalendarPage` folder). `CalendarPageV3.jsx` was
superseded by `PersonalCalendarPage.jsx` + the new shared `src/calendar/`
engine exactly as that earlier audit recommended (Refactor into a thin
wrapper + shared engine). This confirms Packet 1's Phase 3 implementation
completed since that audit was written.

### 2.2 Presentation layer (what gets rebuilt on ui-v2)
| File | Role |
|---|---|
| `src/pages/ContentCalendar/PersonalCalendarPage.jsx` | Thin(ish) page wrapper per its own header comment ("the page components contain no business logic") — in practice ~750 lines because it still owns scope resolution, all the reschedule-mode orchestration (drag/move-mode/modal), quick-post/schedule-modal/command-bar open state, and the schedule hand-off from Library. Renders the shared engine below. |
| `src/calendar/components/CalendarGrid.jsx` | Month grid view |
| `src/calendar/components/CalendarListView.jsx` | List view (also the mobile-default view under 600px per this file's own comment) |
| `src/calendar/components/PostDetailDrawer.jsx` | Detail/edit drawer for a post (or fan-out group) |
| `src/calendar/components/ScheduleModal.jsx` | The real, current, shared schedule modal (supersedes the old Library-only one flagged in the 2026-06-23 audit) |
| `src/calendar/components/QuickPostComposer.jsx` | Quick-post composer, including asset-prefill hand-off from Library |
| `src/calendar/components/UnscheduledRail.jsx` | Drafts rail |
| `src/calendar/components/CalendarCommandBar.jsx` | ⌘K natural-language command bar |
| `src/calendar/components/CellCommandPalette.jsx` | Empty-cell click popover |
| `src/calendar/components/IntelligenceStrip.jsx` | Stat strip |
| `src/calendar/components/ToastStack.jsx` | Page-level toast stack (conflict/stale-write/"schedule anyway" toasts) |
| `src/calendar/components/StatusPill.jsx`, `PostCard.jsx` | Small shared presentational pieces used by the above |

Styling: `src/styles/CalendarEngine.css`, explicitly "ported from the
APPROVED mockup" per its own header — i.e. built to the old (pre-ui-v2)
design system's tokens, same family as `LibraryV2.css`.

### 2.3 Data layer (what should be reused essentially as-is)
| File | Role |
|---|---|
| `src/calendar/hooks/useCalendarPosts.js` | `useCalendarPosts()` + `useCalendarDrafts()` — scope-aware (`{ workspaceType, userId }`) fetch hooks, replacing the old hardcoded-to-`auth.getUser()` `CalendarStore.js` the 2026-06-23 audit flagged as needing this exact change. Confirms that refactor happened. |
| `src/calendar/hooks/useScheduleAction.js` | `schedulePost`/`reschedulePost`/`unschedulePost`/`scheduleAnyway` — the optimistic-concurrency-guarded, conflict-checked write path the earlier audit flagged as missing. Confirms that gap was closed. |
| `src/calendar/services/calendarService.js` | `createPost`, `createQuickPost`, `updatePost`, `deletePost` — the renamed/refactored real data-access layer (was `CalendarStore.js`). |
| `src/calendar/stores/calendarUiStore.js` | Pure UI state (view mode, month cursor, drafts-rail collapse, move-mode) — no Supabase calls; fine to leave untouched. |
| `src/utils/timezone.js`, `src/utils/postStatusMachine.js`, `src/constants/statuses.js` | Unchanged shared utilities, already flagged Reuse in the prior audit and still in active use here. |

**Verdict: data layer is Reuse, unchanged.** Same reasoning as Library —
this is a real, scope-aware, conflict-safe data layer built specifically to
close the gaps the prior audit found; a presentation-only rewrite has no
reason to touch it.

### 2.4 Known issues / incomplete states found in Calendar
- **Orphaned dead file:** `src/pages/CalendarPage/components/ScheduleModal.jsx`
  still exists on disk. Grep across `src/` for any import path pointing at
  it found none — the only calendar-related `ScheduleModal` actually in use
  is `src/calendar/components/ScheduleModal.jsx`. This is the exact file the
  2026-06-23 audit flagged (then still load-bearing for Library) as needing
  to "become the actual shared modal." That migration happened — Library's
  `LibraryPageV2.jsx` no longer imports the old one either (it uses the
  Schedule *hand-off* navigation pattern, `buildScheduleHandoffPath`,
  instead of embedding a modal). The old file is now pure dead code left
  over from that transition. Flag for **Remove**, pending human sign-off —
  not touched by this audit.
- `PersonalCalendarPage.jsx`'s own comments note Week view / hour-aware
  scheduling and AI optimal-slot suggestions (`getSlotSuggestions`) are
  explicitly **not** wired in ("Week view is explicitly Phase 2 per
  CALENDAR_SPEC.md §11, out of this packet's scope"). This is documented,
  intentional scope, not a bug — worth carrying into the ui-v2 mockup scope
  discussion (is Week view in scope for the ui-v2 pass, or still deferred?).
- No other TODOs/commented-out dead code found in the actively-used
  `src/calendar/**` tree.

---

## 3. Styling system comparison across all four already-migrated/to-migrate screens

| Screen | Current styling | ui-v2 status |
|---|---|---|
| Dashboard | was `--dash-*` tokens | **Migrated** — `PersonalDashboardPage.module.css`, imports from `../../ui-v2` |
| Studio | was `--dash-*` tokens, `src/components/GenerateStudio/...` | **Migrated** — `StudioPage.module.css`, imports from `../../ui-v2` (confirmed: `UiV2ThemeProvider`, `AppHeader`, `Card`, `Badge`, `Skeleton`, `EmptyState`, `Button`, `Modal`, `Drawer`, `Dropdown`, `MobileNavDrawer` all imported) |
| Library | `src/styles/LibraryV2.css` (`--dash-*`-derived via `color-mix()`) + `src/components/Shared/ui` legacy primitives | **Not migrated** |
| Calendar | `src/styles/CalendarEngine.css` (same pre-ui-v2 family) | **Not migrated** |

This confirms the parent task's framing exactly: Library and Calendar are
the two screens still on the old system, structurally in the same position
Studio/Dashboard were in before their own ui-v2 rewrites.

---

## 4. Per-piece classification

### 4.1 `LibraryPageV2.jsx` + its 6 sub-components (presentation) — **Refactor**
Concept and interaction model are correct and already QA-passed against
`LIBRARY_SPEC.md` (grid/table toggle, source+status filter rail, bulk
select, upload with duplicate/version detection, soft-delete + trash,
schedule hand-off). What needs to change is purely which component
primitives and CSS render it — swap `UiButton`/`UiIconButton`/`UiEmptyState`/
`UiPageHeader`/`UiBottomSheet` (legacy `src/components/Shared/ui`) and raw
`<table>`/inline-style markup for `ui-v2` primitives (`Button`, `IconButton`,
`EmptyState`, `Card`, `Modal`/`Drawer`, etc.) plus a `LibraryPageV2.module.css`
following the same pattern as `StudioPage.module.css`/
`PersonalDashboardPage.module.css`. **Reasoning for Refactor, not Remove:**
this is a completed, working, spec-compliant screen — there's no functional
reason to throw it away, only a presentation-layer swap, exactly the
category Studio/Dashboard were in.

### 4.2 `LibraryStore.js` + `assetLibraryService.js` (data) — **Reuse**
Confirmed real (19 total `personal_assets` references, no mock data path),
already scope-appropriate, already the single source of truth the page
depends on. No structural reason to change for a presentation-only rewrite.

### 4.3 `PersonalCalendarPage.jsx` + `src/calendar/components/**` (presentation) — **Refactor**
Same reasoning as 4.1: this is the *already-completed* Refactor the prior
(2026-06-23) audit called for — business logic pulled into a scope-agnostic
shared engine, concurrency guard and conflict toast added, multi-platform
grouping presumably addressed (would need a fresh spot-check if desired,
out of scope for this presentation-focused audit). What remains is swapping
`CalendarEngine.css` + whatever legacy primitives it still uses for `ui-v2`
equivalents, componentized the same way Studio/Dashboard were.

### 4.4 `src/calendar/hooks/**`, `src/calendar/services/calendarService.js`, `src/calendar/stores/calendarUiStore.js`, `src/utils/timezone.js`, `src/utils/postStatusMachine.js`, `src/constants/statuses.js` (data + pure logic) — **Reuse**
Same reasoning as 4.2. Scope-aware, conflict-safe, already verified against
real Supabase writes (`posts` table) in the prior audit and unchanged since.

### 4.5 `src/pages/CalendarPage/components/ScheduleModal.jsx` (orphaned old file) — **Remove**
Confirmed zero live import references anywhere in `src/`. Superseded by
`src/calendar/components/ScheduleModal.jsx`. This is exactly the kind of
leftover the 2026-06-23 audit predicted would need to be cleaned up once the
"actual shared modal" migration completed — that migration has completed,
and this file is now inert. **Reasoning for Remove, not Refactor:** there is
a working replacement already in active use; keeping this file around only
risks a future engineer (human or agent) editing the wrong file by mistake.

### 4.6 Missing ui-v2 mockup specs for both screens — **Process gap, not a code classification**
Neither `Library.dc.html` nor `Calendar.dc.html` (or any equivalent) exists
anywhere in the repo. Studio and Dashboard were each migrated against a
`.dc.html`-style mockup (per `StudioPage.jsx`'s own header comment: "see
memory design-system-v2 / docs mockup 'Studio.dc.html'"). Recommend this gap
be closed (a `calendar-ui-ux-designer`/`library-ui-ux-designer`-equivalent
producing a ui-v2 mockup for each screen) **before** any frontend-builder
agent starts rewriting `LibraryPageV2.jsx`/`PersonalCalendarPage.jsx`'s
presentation layer — this mirrors the phase-gate the original packet process
enforced (mockup before implementation) and the `src/ui-v2/README.md`'s own
rule #3 ("every migrated screen must implement loading/empty/error/success
states... see the four `.dc.html` mockups for the spec of each state per
screen" — there is currently nothing to point at for these two screens).

---

## 5. Summary table

| Item | Classification | One-line reason |
|---|---|---|
| `LibraryPageV2.jsx` + 6 sub-components | Refactor | Correct, QA-passed concept; needs ui-v2 primitives/CSS Modules instead of legacy `Ui*`/raw markup |
| `src/styles/LibraryV2.css` | Refactor (replace) | Pre-ui-v2 token family (`--dash-*` via `color-mix`); superseded by a future `LibraryPageV2.module.css` on `--uiv2-*` tokens |
| `LibraryStore.js` + `assetLibraryService.js` | Reuse | Real Supabase (`personal_assets`, 19 refs), scope-correct, no structural gap for a presentation rewrite |
| `PersonalCalendarPage.jsx` + `src/calendar/components/**` | Refactor | Already-completed architectural refactor from the prior audit; only presentation layer is stale |
| `src/styles/CalendarEngine.css` | Refactor (replace) | Same pre-ui-v2 token family as Library's CSS |
| `src/calendar/hooks/**`, `calendarService.js`, `calendarUiStore.js`, `timezone.js`, `postStatusMachine.js`, `constants/statuses.js` | Reuse | Scope-aware, conflict-safe, real-data layer; unchanged since the 2026-06-23 audit's recommendations were implemented |
| `src/pages/CalendarPage/components/ScheduleModal.jsx` | Remove | Confirmed zero live imports; superseded by `src/calendar/components/ScheduleModal.jsx` |
| `Library.dc.html` / `Calendar.dc.html` (missing) | N/A — process gap | No ui-v2 mockup exists yet for either screen; needed before implementation starts, per the pattern Studio/Dashboard already followed |

**Counts:** Reuse = 2 (data-layer groups), Refactor = 4 (2 presentation
trees + 2 legacy stylesheets), Remove = 1 (orphaned file).

---

## 6. Open items for human attention

1. Confirm whether the ui-v2 migration for Library/Calendar should follow
   the exact same phase gate as the original packet process (mockup →
   compliance/parity review → approval → build) or a lighter-weight pass
   given that the underlying interaction design is already approved and
   QA-passed once — only the visual system is changing. This audit
   recommends **at minimum** producing the two missing `.dc.html`-equivalent
   mockups before any `src/**` edits, consistent with `src/ui-v2/README.md`'s
   own rules and the Master Brief's Phase 2 gate.
2. `onDuplicate` stub in `AssetDetailDrawer`'s Library integration
   (`LibraryPageV2.jsx:676`) — confirm whether "Duplicate" is in scope for
   the ui-v2 pass or remains an intentional, shipped stub.
3. Whether Week view / hour-aware scheduling (`PersonalCalendarPage.jsx`'s
   documented Phase 2 deferral) should be pulled into scope now, or the
   ui-v2 rewrite should also defer it and rebuild only Month/List views.
4. Sign-off on removing the orphaned `src/pages/CalendarPage/components/ScheduleModal.jsx`.

---

**Awaiting human sign-off before any Remove classification is acted on.**
Nothing in this report has been deleted, edited, or moved — this is a
read-only audit and recommendation only. The one Remove classification
above (the orphaned `ScheduleModal.jsx`) requires explicit approval before
any agent touches it.
