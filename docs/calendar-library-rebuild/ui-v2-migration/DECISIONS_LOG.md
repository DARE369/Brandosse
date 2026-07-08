# Decisions Log — ui-v2 migration audit (Library & Calendar)

Format: timestamp, agent, decision, reasoning, what would need to change if wrong.

---

**2026-07-07T00:00:00Z** — `docs-auditor`
Decision: Treated this as a new, separate audit scope ("ui-v2-migration")
rather than forcing it into the existing `packet-1-personal-calendar` /
`packet-2-personal-library` folders.
Reasoning: Those two folders document a *completed* prior rebuild (full
phase lifecycle, including post-build QA) against the pre-ui-v2 design
system. This audit's purpose is different — auditing that already-finished
work as an input to a *second*, presentation-only migration — so writing
into the old packet folders would conflate two different rebuild efforts'
audit trails.
If wrong: if the human wants this folded into the existing packet folders
instead (e.g. as a "Phase 5" continuation), the content here can be copied
in with no loss — nothing here depends on the new folder's name.

---

**2026-07-07T00:05:00Z** — `docs-auditor`
Decision: Classified `LibraryPageV2.jsx`/`PersonalCalendarPage.jsx` and their
component trees as Refactor (not Reuse, not Remove).
Reasoning: Confirmed via direct file reads that both are real, working,
QA-passed builds against live Supabase data (`personal_assets`, `posts`) —
not stubs. The only concrete gap found is presentation: legacy `--dash-*`
CSS tokens and legacy shared `Ui*` primitives instead of `src/ui-v2/`. This
is the same category Studio/Dashboard were in before their own migrations
(confirmed by reading `StudioPage.jsx`'s own header comment describing
exactly this history).
If wrong: if a deeper functional audit turns up spec drift beyond styling
(e.g. multi-platform grouping not actually implemented, Week view gaps),
the classification would need to split into Refactor (structure) vs.
Reuse (data) more granularly, similar to how the original 2026-06-23 packet-1
audit split `CalendarStore.js` into two different classifications.

---

**2026-07-07T00:10:00Z** — `docs-auditor`
Decision: Classified `src/pages/CalendarPage/components/ScheduleModal.jsx`
as Remove.
Reasoning: Grepped the entire `src/` tree for any import path referencing
this exact file location and found none — the only calendar `ScheduleModal`
in active use is `src/calendar/components/ScheduleModal.jsx`. The prior
(2026-06-23) audit had explicitly flagged the old file as still load-bearing
for Library at that time; confirmed Library no longer uses a modal at all
for scheduling (it navigates via `buildScheduleHandoffPath` instead). This
means the dependency that previously blocked removal no longer exists.
If wrong: if some code path outside `src/` (e.g. a dynamic import, a test
file, or a route not covered by this grep) still references this file, the
classification should revert to "confirm callers first" rather than Remove.
This is flagged explicitly as pending human sign-off, not acted on.

---

**2026-07-07T00:15:00Z** — `docs-auditor`
Decision: Flagged the absence of `Library.dc.html`/`Calendar.dc.html` as a
process gap requiring resolution before any implementation work, rather
than silently assuming the existing (pre-ui-v2) `mockup-gallery.html` files
under the old packet folders are an adequate substitute.
Reasoning: `src/ui-v2/README.md` explicitly ties per-screen loading/empty/
error/success state requirements to ".dc.html mockups," and both
already-migrated screens (Studio, Dashboard) cite a `.dc.html` file as their
build target. No such file exists for Library or Calendar under the ui-v2
system. Using the old mockups would import the old system's visual
decisions into a supposedly clean rewrite.
If wrong: if the human intends the old mockups' *interaction* design (not
visual design) to be carried forward as-is and only wants a token/component
swap with no new mockup needed, this recommendation would need to be walked
back to "skip mockup phase, go straight to component-mapping" — a lighter
process than what's recommended here.

---

**2026-07-07T10:12:00Z** — `library-ui-ux-designer`
Decision: Produced `library-mockup.html` as a single static, self-contained
HTML/CSS/JS file (no build step, no framework) rather than several
`*-mobile.html`/`*-desktop.html` files or a set of per-state files.
Reasoning: Master Brief §4's mobile/responsive parity mandate requires one
fluid file per page-state where resizing the browser reveals the full
mobile→tablet→desktop range. Since Library has several distinct
*page-states* (grid populated, list/table populated, loading, empty
first-time, empty-filtered, trash) plus several *overlay states* (upload
default, upload duplicate-detection, asset detail drawer, soft-delete
confirm) that can appear on top of any page-state, I combined all of them
into one gallery file with a clearly-marked "mockup-only" control bar (same
pattern the prior, pre-ui-v2 `packet-2-personal-library/mockups/
mockup-gallery.html` used) instead of one-file-per-state. Every state is
still independently fluid/responsive — the control bar only switches which
state's markup is visible, it does not fork the CSS per breakpoint.
If wrong: if a human reviewer wants literally separate files per state for
easier isolated review/diffing, the content of each `[data-panel]`/overlay
block can be lifted out into its own file with the same `<head>` token/
primitive CSS block copy-pasted at the top of each — no visual redesign
needed, just a file-split.

---

**2026-07-07T10:12:00Z** — `library-ui-ux-designer`
Decision: Read every token value and primitive style (`Card`, `Badge`,
`Button`, `IconButton`, `EmptyState`, `Skeleton`, `Modal`, `Drawer`,
`Dropdown`, `AppHeader`, `MobileNavDrawer`) directly from `src/ui-v2/**`'s
actual CSS Modules and reproduced their exact property values as flat CSS
classes in the mockup (e.g. `.card`, `.badge--accent`, `.btn--solid`,
`.drawerPanel`), rather than inventing new visual treatments for Library.
Reasoning: Master Brief §0 rule 5 — never invent new tokens/components when
real ones exist. Also read `StudioPage.jsx`/`.module.css` and
`PersonalDashboardPage.jsx`/`.module.css` (the two already-completed ui-v2
migrations) to confirm the established conventions this mockup needed to
match: mono-font uppercase section kickers (`.sectionKicker`), sticky
`AppHeader` with credit pill + theme toggle + avatar, card-based panels,
pill badges, and the `MobileNavDrawer`/burger pattern below 900px.
If wrong: if a frontend-builder finds a primitive's real CSS Module has
since diverged from what's captured here (e.g. `Modal`/`Drawer` gain a new
size variant), the fix is to re-sync this mockup's flat classes against the
current CSS Module source, not to treat this mockup as authoritative over
the primitives themselves — `src/ui-v2/primitives/**` is always the source
of truth.

---

**2026-07-07T10:12:00Z** — `library-ui-ux-designer`
Decision: Kept the asset-card's top-left badge as the **source** badge
(Upload / Generation / Post-linked — the real, shipped `getSourceLabel()`
feature from `libraryItemUtils.js`) and added a top-right **status pill**
(In use / Unused / Archived) derived from `isUnused()`/`asset.status`,
rather than replacing the source badge with a plain media-type (IMG/VID/
CAR/DOC) badge as the user's earlier reference screenshot showed literally.
Reasoning: The reference screenshot's IA (badge top-left, status pill
top-right) is preserved, but the *content* of the top-left badge must stay
the real, shipped source-distinction feature per the task's explicit
"preserve every real feature/state, do not invent or drop functionality"
instruction (AS_IS_AUDIT.md §1.4 confirms source badges are a real,
QA-passed feature, not a stub). To still honor the screenshot's visual
convention of a compact format/media-type tag, I additionally render a
small mono-font media-type tag (IMG/VID/CAR/DOC) in the same top-left
corner position layered with the source badge context via the card's
existing meta-row, so both signals are visible without dropping either.
If wrong: if the human specifically wants the media-type badge to fully
replace the source badge visually (with source demoted to the meta-row
only, matching the screenshot pixel-for-pixel), this is a small swap
localized to `.mediaBadge`/`.sourceRow` in `library-mockup.html` — no
other layout changes needed.

---

**2026-07-07T10:12:00Z** — `library-ui-ux-designer`
Decision: Did not resolve the open `onDuplicate` stub question (AS_IS_AUDIT.md
§6 item 2) by inventing new duplicate-flow UI beyond what's already shipped;
instead mocked "Duplicate" as a real, present action (drawer footer button)
matching the current `LibraryPageV2.jsx`'s real `handleDuplicate` wiring
(confirmed asset duplication already shipped, not the old `toast('Duplicate
is coming soon')` stub the audit's first draft had flagged — the codebase
has since been updated per the task brief's "just added — real asset
duplication" note).
Reasoning: The task brief explicitly states real asset duplication was
just added, superseding the audit's stale note about a stub. Mocking the
already-real behavior (not a "coming soon" toast) keeps the mockup in sync
with current shipped functionality rather than an out-of-date audit
snapshot.
If wrong: if duplication is still actually stubbed in the live codebase
(the audit doc and the task brief disagree on this point), the drawer's
"Duplicate" button in the mockup needs no visual change — only the future
frontend-builder's wiring choice (real call vs. toast placeholder) is
affected, not this mockup's UI.

---

**2026-07-07T11:40:00Z** — `calendar-ui-ux-designer`
Decision: Read every real Calendar component's source directly
(`CalendarGrid.jsx`, `CalendarListView.jsx`, `PostDetailDrawer.jsx`,
`ScheduleModal.jsx`, `QuickPostComposer.jsx`, `UnscheduledRail.jsx`,
`CalendarCommandBar.jsx`, `CellCommandPalette.jsx`, `IntelligenceStrip.jsx`,
`PostCard.jsx`, `StatusPill.jsx`) plus `PersonalCalendarPage.jsx` and
`AS_IS_AUDIT.md`/prior `DECISIONS_LOG.md` entries before drawing a single
pixel, rather than starting from the user's reference screenshots alone.
Reasoning: Master Brief §0 rule 5 and this task's explicit "preserve every
one of these real features/states... do not invent or drop functionality"
instruction required knowing exactly what the shipped, QA-passed engine
already does (three reschedule modes — drag, tap-to-select move, and full
drawer edit; grouped/fanned-out multi-platform posts sharing one
generation_id; the honest "via mock connection" published-status caveat;
the non-AI, locally-computed Intelligence Strip tip vs. the real-AI Command
Bar being deliberately visually distinct) before reconciling that with the
screenshots' layout. The screenshots describe information architecture: the
audit + source describe ground truth functionality that IA must not
contradict.
If wrong: if a deeper functional spot-check finds additional real states not
covered by the components read (e.g. an undocumented multi-select bulk
mode), the same source-first process applies — go read that component next,
don't guess from the screenshot.

---

**2026-07-07T11:40:00Z** — `calendar-ui-ux-designer`
Decision: Produced `calendar-mockup.html` as one self-contained static
HTML/CSS/JS gallery file (month view populated/empty/loading, list/agenda
view, command bar inline row + full ⌘K overlay, unscheduled-drafts rail,
post detail drawer, schedule modal, quick-post composer + its nested asset
picker, and the per-cell command palette, all in one file with a small
"mockup-only" state-switcher control bar), rather than one file per state or
per component.
Reasoning: Same reasoning the Library packet's parallel entry gives above
(2026-07-07T10:12:00Z) — Master Brief §4 wants one fluid file per
page-state where resizing the browser reveals the full mobile→tablet→
desktop range via CSS media queries alone, and Calendar has even more
overlay states than Library (drawer, schedule modal, quick-post + asset
picker, cell palette, ⌘K overlay) that all need to be reachable without
forking files. The state-switcher only toggles which markup block is
visible or which demo overlay is open — it never forks the CSS per
breakpoint, so resizing the window at any state still exercises the real
responsive range end-to-end.
If wrong: if a human reviewer wants isolated single-state files for easier
diffing, each block can be lifted out with the same `<head>` token/
primitive CSS copied to the top of each — no redesign needed, just a
file-split.

---

**2026-07-07T11:40:00Z** — `calendar-ui-ux-designer`
Decision: Preserved every real component/state named in AS_IS_AUDIT.md §2.2
as a distinct, clearly-labeled visual section: CalendarGrid (month, with the
real 3-visible-then-"+N more" slide-over overflow rule and drag/move-mode
drop-candidate cell state), CalendarListView (agenda, with its search/
status/platform filter bar and per-day grouping), PostDetailDrawer
(platform tabs for fanned-out/grouped posts, caption + hashtags + AI-audit
affordance, account/platform reassignment, reschedule date/time fields,
readiness checklist, the personal-scope-only note, and a failure-reason
box for failed posts), ScheduleModal (timezone banner, mini month
calendar, target-account card, non-blocking conflict banner), QuickPost
Composer (3-step: optional Library asset via a nested asset-picker modal,
per-platform toggles with an AI-prefill indicator, date/time-or-draft),
UnscheduledRail (readiness bar, per-card Move button, resize handle,
collapse toggle, empty state), CalendarCommandBar (inline bar + full ⌘K
overlay with categorized suggestions, a result state with apply/dismiss
action buttons, and kbd-hint footer), and CellCommandPalette (AI-optimal-
slot callout + the 4 real quick actions: schedule a draft, new post, ask AI,
generate week plan). Did not invent any new feature, and did not add a Week
view — Week view's absence is intentional and matches
`PersonalCalendarPage.jsx`'s own documented Phase 2 deferral
(`CALENDAR_SPEC.md` §11, cited in AS_IS_AUDIT.md §2.4).
Reasoning: Master Brief §0 rule 5 and this task's explicit "preserve every
one of these real features/states... do not invent or drop functionality"
instruction. Every component in the audit's file map has a corresponding
section in the mockup; nothing was collapsed, merged away, or silently
added beyond what the real components already do.
If wrong: if Week view should actually be pulled into scope for the ui-v2
pass now (AS_IS_AUDIT.md §6 item 3 flags this as an open human decision),
this mockup would need a new Week-view section added as a third option
alongside the existing Month/List segmented toggle — nothing in the current
markup or CSS blocks that addition.

---

**2026-07-07T11:40:00Z** — `calendar-ui-ux-designer`
Decision: Made List/Agenda view the responsive default under 640px width
(auto-selected via a `resize`/initial-load check, but instantly overridable
by the reviewer clicking the Month/List segmented toggle), and kept Month
view reachable at any width via a horizontally-scrollable grid rather than
hiding it on narrow screens.
Reasoning: `CalendarListView.jsx`'s own source comment explicitly documents
this as real, shipped behavior ("Below ~600px this is the default view...
though Month stays one tap away always"). A full 7-column month grid is
genuinely hard to read under ~375px, so defaulting to the already-designed
agenda/list layout (search + status/platform filters, day-grouped rows)
matches both the real component's documented intent and the task's own
prompt ("does it default to list view on narrow screens, or a condensed
grid" — answer: both, list by default, condensed-and-scrollable grid still
available). Month view's cells shrink their row height and the grid becomes
horizontally scrollable below 640px rather than truncating post pills,
avoiding the 320–375px overflow bugs flagged as a recurring problem in
Build Standards.
If wrong: if human/product feedback prefers Month to stay the always-on
default even on phones (accepting horizontal scroll as the primary mobile
month interaction), the fix is deleting the `applyResponsiveDefaultView()`
JS function and its `resize` listener — the condensed/scrollable Month CSS
underneath already works standalone and needs no other change.

---

**2026-07-07T11:40:00Z** — `calendar-ui-ux-designer`
Decision: On narrow screens, moved the Unscheduled Drafts rail from its
desktop right-hand column to a horizontally-scrollable strip directly above
the Month/List content (`order: -1`), rather than keeping it below the
calendar or turning it into a bottom sheet/tray overlay.
Reasoning: The real `UnscheduledRail.jsx` already has its own resizable-
tray/collapse mechanic on desktop (a `cal3-tray` with a drag handle and a
`localStorage`-persisted height) — reproducing a competing bottom-sheet
pattern on mobile would be a second, inconsistent interaction model for the
same feature. A horizontal-scroll strip keeps the exact same draft cards,
thumbnails, platform dots, and Move buttons with no new interaction
paradigm, and placing it above the calendar (not below) means it doesn't
get pushed below a potentially long agenda list where a user might never
scroll to it — drag-to-schedule and Move both depend on the user actually
seeing the rail.
If wrong: if user testing shows people expect the collapsed tray/bottom-
sheet pattern used elsewhere in the app on mobile, this is a scoped CSS/JS
change to the `@media (max-width: 640px) .rail` block only — the draft-card
markup itself does not need to change.

---

**2026-07-07T00:20:00Z** — `mobile-parity-auditor`
Decision: Did not spawn a dedicated touch-gesture-specialist sub-agent for the
calendar mockup's drag-and-drop review, despite drag-and-drop being the single
most gesture-heavy interaction in either mockup.
Reasoning: The static markup/JS was sufficient to trace a complete, working
touch-equivalent path for every drag target (tap post-pill/draft-card → drawer
→ "Reschedule…" → Schedule modal's mini-calendar day picker), so a narrower
specialist would not have surfaced anything beyond what a direct read already
found. Time/effort was better spent finding the actual mobile-parity bugs
(month-cell add-post dead end on touch, 22px bulk-select tap target) than
delegating a sub-review of an interaction that already checked out.
If wrong: if the human specifically wants a hands-on touch/pointer-event
simulation (not just a static-code trace) — e.g. to verify native HTML5
`draggable` doesn't accidentally intercept touch scroll on the drafts rail — a
follow-up touch-gesture sub-agent should be spawned against the built React
components once they exist, since a static mockup can't actually be
touch-tested for that class of bug.

---

**2026-07-07T00:20:00Z** — `mobile-parity-auditor`
Decision: Classified the sub-16px body-text tokens (`--uiv2-text-sm`/`--uiv2-
text-xs`/`--uiv2-text-base`=14px, none fluid via `clamp()`) as a cross-cutting
design-system issue to flag for a separate decision, not a Library- or
Calendar-mockup-specific bug to "fix" by editing these two files.
Reasoning: Both mockup files explicitly state they copy `tokens.css` verbatim
and forbid forking it locally. The type scale is already shipped and used
identically on Dashboard/Studio, so silently rewriting font sizes in only
these two mockups would (a) violate the "copied verbatim, do not fork" rule
these files state for themselves, and (b) create three-way inconsistency
across ui-v2 screens instead of fixing the actual root cause.
If wrong: if the human wants an immediate mockup-local fix rather than a
tokens.css-wide change, the smallest safe patch is bumping only true
running-copy classes (captions, descriptions, field labels) to `--uiv2-text-
md` (15px) or introducing a new `--uiv2-text-body-min: clamp(1rem, ...)`
token — but that still needs to land in `tokens.css` to avoid drift between
screens that already shipped and these two that haven't yet.

---

**2026-07-07T12:30:00Z** — `design-system-compliance-agent`
Decision: Marked both `library-mockup.html` and `calendar-mockup.html` as
UNRESOLVED — neither is cleared to proceed to human review yet — rather than
passing them with notes, despite the large majority of both files being
verbatim-faithful reproductions of `tokens.css` and the real primitive CSS
Modules.
Reasoning: Master Brief's `design-system-compliance-agent` mandate is
explicit: "A mockup with unresolved flags does not go to human review."
Four concrete, correctable violations were found that were not addressed by
any existing `DECISIONS_LOG.md` entry: (1) both mockups reinvent a
left-side, header-less, close-button-less mobile nav panel instead of
composing the real `MobileNavDrawer`/`Drawer` primitives (which slide from
the right, use `bg-inset`, and always show a "Menu" title + close button);
(2) both mockups invent new Modal `md`/`lg` size values that don't match
`Modal.module.css`'s real 420px/560px scale, and don't even agree with each
other (`lg` = 640px in Library vs. 620px in Calendar); (3) Library's asset
`.statusPill--inuse/unused/archived` variants use three hex text colors
(`#6FE3A6`, `#D3D4D8`, `#FFCE6E`) that a full-repo grep confirms exist
nowhere else in the codebase, plus non-standard wash/border opacities that
don't match any `--uiv2-*-wash`/`--uiv2-*-border` token; (4) Calendar's
`.icon-btn` uses a filled `var(--uiv2-bg-elevated)` background by default,
diverging from the real `IconButton` primitive's transparent default (and
from Library's own correct copy of that same primitive). See
`DESIGN_SYSTEM_COMPLIANCE.md` for full detail, code excerpts, and severity
per item, including two additional non-blocking notes (Calendar's
`--platform-*` variables are a legitimate reuse of the pre-existing
`src/styles/tokens.css` values but need a proper logged decision instead of
only an inline CSS comment; `.btn--dangerSolid` is missing its `:hover`
rule in Calendar only).
If wrong: if the human reviewer decides any of these four are acceptable as
deliberate deviations (e.g. they like the wider modal sizes, or want a
distinct "on-image" status-pill palette), the fastest path is not to redo
this review but to have the human explicitly say so, at which point the
corresponding `library-ui-ux-designer`/`calendar-ui-ux-designer` agent logs
that decision with reasoning here, and this compliance doc gets a one-line
"resolved by explicit human sign-off on <date>" update rather than a
re-review from scratch. None of the four findings require new visual or
interaction design work — all are either "swap in the real primitive as
built" or "pick and log one consistent value" — so the corrections pass
should be fast.

---

**2026-07-07T11:40:00Z** — `library-ui-ux-designer`
Decision: Applied all four fixes from the compliance + mobile-parity review
directly to `library-mockup.html` (no `src/**` touched):
1. Rebuilt the mobile burger nav to be the *actual* `MobileNavDrawer`/
   `Drawer` shape — right-side panel, `bg-inset`, `border-left`, a real
   title bar ("Menu") + close button — reusing the same `.drawerBackdrop`/
   `.drawerPanel`/`.drawerHeader`/`.drawerTitle`/`.drawerCloseBtn` classes
   the asset detail drawer already uses, instead of a separate hand-rolled
   left-side sliding panel with its own transform/`is-open` animation.
2. Fixed `Modal` `md`/`lg` sizes to the real `Modal.module.css` scale —
   420px / 560px (previously 460px / 640px, invented and inconsistent with
   the Calendar mockup's own values).
3. Replaced the invented status-pill hex colors (`#6FE3A6`/`#D3D4D8`/
   `#FFCE6E` + non-standard wash/border opacities) with the real `Badge`
   tone classes (`badge--success`/`badge--neutral`/`badge--warning`,
   unchanged from `Badge.module.css`), with only positioning/backdrop-blur
   added on top for the on-media placement — no new color values anywhere.
4. Gave the bulk-select checkbox a real ~44×44 touch target: wrapped the
   22×22 visual checkbox in an invisible `.selectHit` button sized to the
   platform-standard minimum hit area, wired to the same select handler
   (`data-select-check` moved to the wrapper; the inner visual box is
   `pointer-events: none` and only receives the `is-checked` class).
5. Dropped the mockup-only `top: 33px` header offset — header now sticks at
   `top: 0`, matching the real `AppHeader.module.css` exactly — and added a
   comment explaining the dev-only control bar above it is not part of the
   shipped component and must not leak an offset into this rule.
Reasoning: All four were direct instructions from the compliance/
mobile-parity review passes, each pointing at a specific real primitive
(`Drawer`, `Modal`, `Badge`, `AppHeader`) this mockup should have matched
exactly the first time per Master Brief §0 rule 5, plus one WCAG/iOS-HIG
minimum-touch-target correctness fix. Applied via targeted string
replacement against exact, previously-known source blocks (verified via
`assert old_block in html` before each substitution) rather than a full
file rewrite, to avoid accidentally reintroducing or losing unrelated
content in a 78KB single file.
If wrong: each fix is isolated to a clearly-commented block (search
`DESIGN_SYSTEM_COMPLIANCE.md fix` / `MOBILE_PARITY.md MUST-FIX` in the
file) — reverting any one of them is a local, self-contained edit and does
not require touching the other three.

---

**2026-07-07T13:15:00Z** — `calendar-ui-ux-designer`
Decision: Applied all six fixes from the compliance + mobile-parity review
directly to `calendar-mockup.html` (no `src/**` touched):
1. Rebuilt the mobile burger nav to be the *actual* `MobileNavDrawer`/
   `Drawer` shape — right-side panel, `bg-inset`, `border-left`, a real
   title bar ("Menu") + close button — reusing the same `.drawer-backdrop`/
   `.drawer-panel`/`.drawer-header`/`.drawer-title`/`.drawer-close` classes
   the Post Detail Drawer already uses (width capped at `min(280px, 84vw)`
   via inline style, matching `MobileNavDrawer.jsx`'s own width prop),
   instead of the previous hand-rolled left-side `<nav>` panel with no
   header/close button and a `bg-surface` fill.
2. Fixed `Modal` `md`/`lg` sizes to the real `Modal.module.css` scale —
   420px / 560px (previously 460px / 620px, invented and inconsistent with
   the Library mockup's own values).
3. Fixed `.icon-btn`'s default background to transparent (previously
   `var(--uiv2-bg-elevated)`, filled), matching the real `IconButton`
   primitive and Library mockup's own correct copy of it — the fill now
   only ever comes from `:hover`'s existing border/color change, no new
   fill state added.
4. Added `.btn--dangerSolid:hover:not(:disabled) { filter: brightness(1.06); }`,
   matching every other solid button variant's real hover treatment in
   `Button.module.css` (previously the only variant with no hover state at
   all).
5. Dropped the mockup-only `top: 27px` header offset — header now sticks at
   `top: 0`, matching the real `AppHeader.module.css` exactly — and added a
   comment explaining that offset existed only to clear this mockup's own
   dev banner/state-switcher chrome, which does not exist in production, so
   the banner scrolling under the sticky header here is an accepted mockup-
   only artifact, not a real interaction bug.
6. **MOBILE_PARITY.md MUST-FIX**: wired a real tap handler on every
   `.month-cell` (delegated via a single `querySelectorAll('.month-cell')`
   loop, not 42 inline handlers) that opens the Cell Command Palette when
   the viewport is ≤640px and the tap didn't land on a post pill / "+N more"
   / the desktop-only "+" button. This closes the gap the code comment had
   previously only promised ("use the cell tap → palette instead") without
   ever implementing — the `.month-cell__add` "+" affordance is hover-only
   and already `display: none` below 640px, so touch users previously had
   no way to reach "Schedule a draft" / "New post" / "Ask AI what to post" /
   "Generate week plan" from an empty day cell at all.
Reasoning: Items 1–5 were direct instructions from the compliance review,
each pointing at a specific real primitive (`Drawer`/`MobileNavDrawer`,
`Modal`, `IconButton`, `Button`, `AppHeader`) this mockup should have
matched exactly the first time per Master Brief §0 rule 5. Item 6 is a
correctness bug, not a style deviation — an entire quick-action surface was
unreachable on touch devices, which directly contradicts the mobile/
responsive parity mandate (Master Brief §4) and this task's own instruction
to design the mobile calendar interaction carefully rather than as an
afterthought. Applied via targeted, uniqueness-verified string replacement
(each old block asserted to appear exactly once before substitution) rather
than a full file rewrite, to avoid accidentally reintroducing or losing
unrelated content in a 100KB+ single file. Verified afterward with
`node --check` against the extracted `<script>` block (using the *last*
`<script>`/`</script>` pair in the document, since an inert empty
placeholder `<script>` already existed inside the loading-skeleton markup
and a CSS comment briefly contained the literal substring `<script>`,
either of which can confuse a naive first-tag-to-first-close extraction —
neither affects real browser parsing, only ad hoc verification tooling) and
a div/aside tag-balance count.
If wrong: each fix is isolated to a clearly-commented block (search
`MOBILE_PARITY.md must-fix` / `MOBILE_PARITY.md MUST-FIX` / "real Drawer/
MobileNavDrawer pattern" in the file) — reverting any one of them is a
local, self-contained edit and does not require touching the others.

---

**2026-07-07T13:15:00Z** — `calendar-ui-ux-designer`
Decision: Logged the `--platform-instagram`/`--platform-tiktok`/
`--platform-linkedin`/`--platform-x`/`--platform-youtube`/
`--platform-facebook`/`--platform-pinterest` custom properties (used for
platform-dot color-coding on post pills, drafts, and the drawer's platform
tabs) as a deliberate, scoped reuse of the pre-existing
`src/styles/tokens.css` platform palette, rather than leaving that
justification as only the inline CSS comment above the `:root` block, per
the compliance review's explicit ask for a proper dated log entry.
Reasoning: `src/ui-v2/tokens.css` defines no platform-brand color palette at
all — Calendar (and the real, shipped `src/calendar/**` engine it mirrors)
genuinely needs one, since post pills/drafts/platform tabs must be visually
distinguishable by platform at a glance, matching `PostCard.jsx`'s and
`UnscheduledRail.jsx`'s real `PLATFORM_VARS`/`platformVar()` helpers (which
read the *exact same* `--platform-*` custom properties from
`src/styles/tokens.css` today). Reusing the same seven literal hex values
already shipped and in active use elsewhere in the codebase is the
"don't invent, don't contradict" move — inventing a *second*, different
platform palette under a `--uiv2-platform-*` name would create the exact
kind of two-systems drift Master Brief §0 rule 5 exists to prevent, and
copying the real component's own literal values (not eyeballing new ones)
keeps this mockup's platform-dot colors pixel-identical to what the shipped
engine already renders today.
If wrong: if a human decides ui-v2 should own a first-class
`--uiv2-platform-*` token set instead of continuing to borrow from the old
`src/styles/tokens.css` system, that decision belongs in `tokens.css`
itself (cross-cutting, same reasoning as the `mobile-parity-auditor`'s
2026-07-07T00:20:00Z entry above about sub-16px type tokens) — at which
point this mockup's seven `--platform-*` declarations get renamed/aliased
to whatever the new token names are, with no visual change required since
the hex values would carry over unchanged.

---

**2026-07-07T14:05:00Z** — `design-system-compliance-agent`
Decision: Marked both `library-mockup.html` and `calendar-mockup.html` as
APPROVED for human review, superseding this same agent's prior UNRESOLVED
verdict (2026-07-07T12:30:00Z), after independently re-verifying all four
blocking findings and two minor findings against the live primitive source
files (`Drawer.jsx`/`.module.css`, `Modal.module.css`, `IconButton.module.css`,
`Badge.module.css`, `Button.module.css`, `AppHeader.module.css`,
`MobileNavDrawer.jsx`/`.module.css`) rather than trusting the designer
agents' self-reported fix summaries alone.
Reasoning: Read each real primitive fresh, then line-diffed the mockups'
markup/CSS against it: (1) mobile nav in both files now composes the actual
`.drawerPanel`/`.drawerBackdrop`/`.drawerHeader`/`.drawerTitle`/
`.drawerCloseBtn` shape — right-side, `bg-inset`, `min(280px, 84vw)`
matching `MobileNavDrawer.jsx`'s own width prop, "Menu" title + close
button present in both; (2) `Modal` `sm`/`md`/`lg` are now `380/420/560`px
in both files, matching `Modal.module.css` exactly and each other; (3)
Library's status pill now emits real `badge--success`/`--neutral`/
`--warning` classes with zero invented hex colors, only a positioning
overlay class; (4) Calendar's `.icon-btn` now defaults to
`background: transparent`, matching `IconButton.module.css` and Library's
own correct copy; (5) the `--platform-*` reuse now has a proper
`DECISIONS_LOG.md` entry (2026-07-07T13:15:00Z) rather than only an inline
CSS comment; (6) `.btn--dangerSolid:hover` is now present in Calendar,
matching `Button.module.css`. All six previously-required fixes verified
correct with no regressions. One new informational-only observation was
raised during a fresh full scan (Library's asset-detail drawer uses
`width: min(460px, 94vw)` and Calendar's post-detail drawer uses
`min(440px, 94vw)`, both diverging from `Drawer.module.css`'s
un-parameterized `400px` default) but is explicitly not blocking, since
every real shipped `<Drawer>` usage already passes its own bespoke `width`
prop (`StudioPage.jsx`'s Video Jobs drawer uses `min(380px, 92vw)`,
`SessionHistoryDrawer.jsx` uses `min(360px, 92vw)`) — there is no shared
size-scale being violated the way `Modal`'s sm/md/lg scale was, so a
content-driven bespoke width for these two content-heavier drawers is
consistent with, not a departure from, existing practice.
If wrong: if a human reviewer disagrees that the Drawer-width observation
is non-blocking (e.g. wants a hard cap matching the 400px default, or wants
Library/Calendar's two values reconciled to one shared number), the fix is
a one-line CSS `max-width`/`width` change in each file plus a note that the
future `<Drawer width="...">` prop should be set to match — no other part
of either mockup needs to change, and neither approval should be revoked
over it; it can be corrected in the same pass as build.

---

**2026-07-07T14:45:00Z** — `parent (orchestrator)`

Fixed the regression the second mobile-parity pass found in
`library-mockup.html`'s bulk-select touch-target fix directly (small,
mechanical, one CSS rule — not worth another agent round-trip). The
`.selectHit` 44x44 hit-area was toggling `opacity` on hover/`.bulk-mode`
but never gating `pointer-events`, so the button was live and swallowing
taps at all times, on every card, even outside bulk-select mode
(`e.target.closest('button')` in the open-drawer listener bailed out
silently — no drawer opened, nothing selected, no visible feedback).
Added `pointer-events: none` to the base `.selectHit` rule and
`pointer-events: auto` alongside the existing `opacity: 1` in the
`:hover`/`.bulk-mode` rule — same gating pattern `.selectCheck`'s inner
visual glyph already used, applied one level up to the new hit-area
wrapper. Verified `bulk-mode` is entered via a real, always-visible
`#selectModeBtn` ("Select" button, line ~581) that toggles the
`.bulk-mode` class on the grid — so touch users (who have no `:hover`)
can still reach per-card selection once in bulk mode, matching the fix's
original intent. Confirmed via grep: exactly 2 `pointer-events: none`
declarations now present, `.selectHit` rule structurally intact.
If wrong: revert the two `pointer-events` additions; no other code
depends on this change.

---

**2026-07-07T15:20:00Z** — `parent (orchestrator)`

Human reviewer flagged, from a real screenshot of `library-mockup.html`'s
"Mobile 375" simulator button, that the header/filter-rail were not
actually restructuring for mobile. Root cause: both mockups' frame-width
simulator buttons only ever set `frame.style.maxWidth` on a wrapper
`&lt;div&gt;` — but every responsive rule was written as `@media (max-width:
...)`, which evaluates against the true browser viewport, not a wrapper
div's width. Narrowing the div did nothing to the CSS; the "Tablet
768"/"Mobile 375" buttons were fully decorative. Real browser-window
resize (the banner's stated fallback) DID work correctly the whole time —
this was purely a simulator-tooling bug, not a design/CSS defect, but it
made the mockups impossible to review correctly inside a fixed-width
Artifact viewer pane where the user can't resize a real window.

Fix applied to both files: `#frame` (library) / `.shell`/`#themeRoot`
(calendar) now declare `container-type: inline-size; container-name:
frame;`, and every page-shell `@media (max-width: Npx)` rule (9 in
library, 6 in calendar, all confirmed to govern only descendants of that
container — no rule needed to stay viewport-relative) was converted to
`@container frame (max-width: Npx)`. Calendar's `applyResponsiveDefaultView()`
JS (auto-switches to List view under 640px) was also changed to measure
`#themeRoot.getBoundingClientRect().width` instead of `window.innerWidth`,
so the simulator drives that behavioral default correctly too, and a
matching frame-simulator control bar (previously Library-only) was added
to Calendar for parity, per the human's explicit ask to also verify
Calendar's tablet/mobile treatment.

While auditing Calendar's real (previously untested-in-simulator)
tablet breakpoint, found the same "hard cutover, no intermediate tablet
tier" pattern already fixed once this session on Studio's brief sidebar:
`.body-grid` (month grid + drafts rail) jumped straight from a 300px rail
to full single-column stack at 1080px. Added a `@container frame
(max-width: 1180px)` tier that narrows the rail to 240px before the
900px full stack, matching `StudioPage.module.css`'s established pattern.

Verified via real Playwright (not visual inspection alone, given this
session's simulator bug already fooled one visual-only review): (1) real
375px viewport resize was unaffected (already worked, confirmed still
0px overflow); (2) clicking the "Mobile 375" simulator button at a real
1440px viewport now correctly triggers the burger menu / mobile layout
(previously did not); (3) a 10-combination matrix (library at
768/375px, calendar at 1080/768/375px, each × dark/light theme) measured
`frame.scrollWidth - frame.clientWidth` directly (not document-level
scrollWidth, since the frame sits centered inside an otherwise-wide
page) — all 10 combinations: 0px overflow.

Also ran a light/dark theme-consistency grep across both files' non-token
CSS for hardcoded hex/rgba colors. Findings: library's `.mockupBar` (dev
tool banner) hardcodes dark colors intentionally — it's explicitly
dev-only chrome, never part of the shipped design, correctly excluded
from theming. `.mediaBadge`/`.selectCheck`/`.drawerPreview` background
hardcode dark scrims/letterboxing over unpredictable media-thumbnail
content — matches the real, already-shipped precedent in
`StudioPage.module.css`'s `.variantChip`/`.variantIconBtn` (on-media
chips always use a fixed dark scrim regardless of app theme, since
they sit on arbitrary photo/video content, not the page background).
Calendar's one hit, `.view-toggle button.is-active`'s `box-shadow: 0 1px
0 rgba(0,0,0,0.04)`, is a decorative hairline shadow with no dedicated
token equivalent (tokens.css only has modal/popover-scale shadows) —
judged negligible in both themes and left as-is rather than
over-engineered.

Files touched: `library-mockup.html`, `calendar-mockup.html`.
If wrong: the `@container`/`container-type` conversions are purely
additive relative to the prior `@media` behavior at real viewport
widths (verified identical via the Playwright check above) — reverting
would mean going back to a simulator that doesn't work inside a
fixed-width preview pane, not a regression in real-browser behavior.

---

Awaiting human sign-off before any Remove classification is acted on.

---

**2026-07-07T11:49:10Z** — `mobile-parity-auditor` (re-verification pass)
Decision: Re-read the actual applied fixes for both prior MUST-FIX items (not
the designer agents' self-report), plus a fresh 320–375px stress pass on both
files, plus a diff of both mockups' mobile-nav markup/JS against
`MobileNavDrawer.jsx`/`Drawer.jsx`. Verdict: Calendar's fix is CONFIRMED
correct and complete. Library's fix is CONFIRMED INCOMPLETE — it removes the
original bug but introduces a new one of the same class, so Library is NOT
approved yet.

Reasoning, calendar `.month-cell` tap fix (confirmed working):
`document.querySelectorAll('.month-cell').forEach(cell => cell.addEventListener('click', ...))`
(`calendar-mockup.html:1559-1565`) is wired, guards `window.innerWidth > 640`
so it's inert on desktop/tablet (no double-affordance), excludes
`.post-pill`/`.month-cell__add`/`.month-cell__more` taps so it doesn't
shadow other handlers, and calls the same `openCellPalette()` the desktop
"+" button calls — genuine parity, not a stub. Confirmed the palette's
`#cellPaletteAnchor` (`top:340px; left:50%; transform:translateX(-50%)`)
sits at document root (not nested inside the horizontally-scrollable
`.month-card`), so at 320px viewport a 260px-wide palette centers with
~30px margins each side — no horizontal clipping. (The palette's fixed
`top:340px`/no per-cell positioning is a pre-existing demo simplification
shared with desktop's "+" button — already true before this fix, not
something the fix introduced or worsened, so not re-flagged as new.)

Reasoning, library `.selectHit` tap fix (confirmed BROKEN): the fix wraps
the 22×22 visual checkbox in a real 44×44 `<button class="selectHit"
data-select-check>` (`library-mockup.html:1023`, CSS at :384). That part is
right. But `.selectHit`'s CSS only toggles `opacity` between 0 and 1
(`.assetCard:hover .selectHit, .bulk-mode .selectHit { opacity: 1; }`,
`:385`) — it never sets `pointer-events: none` in the default (opacity:0,
non-bulk-mode) state, and CSS `opacity` does not affect hit-testing. That
means the 44×44 `<button>` is live and clickable at all times, on every
card, not just during bulk-select or hover. Traced the consequence through
both click listeners on `#assetGridPopulated`: the capture-phase select
listener (`:1203-1219`) returns early without `stopPropagation()` when
`!bulkMode`, so the event still bubbles — but the bubble-phase
"open drawer" listener (`:1178-1182`) checks `if (e.target.closest('button'))
return;`, and since `.selectHit` IS a button, that check now matches even
though the tap had nothing to do with selection. Net effect: an invisible,
permanent 44×44px dead zone now sits in the bottom-left corner of every
asset thumbnail at every width — a tap landing there outside bulk mode
does *nothing* (no drawer opens, no selection happens, no visible
feedback). This is worse for touch specifically than the original bug: the
old 22px target was a plain `<span>` (not a `<button>`), so a mistap
*outside* the 22px area fell through and opened the drawer (wrong action,
but a visible reaction) — the "fix" is a strictly larger, now fully-silent
non-response zone with zero affordance on touch (no `:hover` state ever
fires there to reveal it). This also affects desktop (hovering to reveal
the checkbox, then clicking it outside bulk mode does nothing either), but
I'm flagging it here specifically because it's a mobile-parity regression
class problem, not just a cosmetic desktop quirk.
Fix needed (one line, not re-litigating the whole approach): add
`pointer-events: none` to the base `.selectHit` rule and `pointer-events:
auto` to the `.assetCard:hover .selectHit, .bulk-mode .selectHit` union, so
the enlarged hit target is only actually hit-testable when it's visible
and functional — mirroring what `.selectCheck`'s existing
`pointer-events: none` already does for the visual layer.

Also confirmed both files' mobile nav (burger → drawer) did not regress:
both `#mobileNavPanel`/`#mobileNavBackdrop` use `width: min(280px, 84vw)`
identically, open/close wiring (burger opens; backdrop click, explicit
close button, and Escape-equivalent close-all-overlays all close) mirrors
`Drawer.jsx`'s backdrop-click-to-dismiss + explicit close button pattern,
and neither introduces a new fixed-width element that could overflow at
320px. Calendar's header previously had a `top: 27px` mockup-only offset
(flagged in the first pass as "must be dropped back to 0 before real
conversion") — confirmed now `top: 0` in both files, so that flagged item
was also independently fixed along the way, not just the two requested
MUST-FIXes.

If wrong: if a human reviewer decides the `pointer-events` dead-zone is
tolerable (e.g. because real usage data shows nobody taps that exact
corner outside bulk mode), the file can ship as-is and this note can be
downgraded to a "suggestion" — but as read today, it is a demonstrable,
traceable functional regression on a MUST-FIX item that was reported fixed,
so I am not downgrading it myself.

---

**2026-07-07T16:10:00Z** — `parent (orchestrator)`

Human reviewer sent real screenshots after the container-query fix,
scrolled down inside the mobile simulator, reporting overlapping
header/banner content and "there's literally no calendar" visible on
Calendar's mobile view. Two separate real bugs found and fixed, plus one
already-fixed-elsewhere pattern recurred and got caught:

**Bug 1 — sticky dev-chrome overlap.** Both mockups' dev-only top banner
(`.mockupBar` in library, `.mockup-banner` in calendar) are `position:
sticky; top: 0`, and so is the real `.header`/`.app-header` (also `top:
0`) — both elements pin to the exact same spot once scrolled, so the dev
banner visually covered the real header (brand mark, burger, credit pill,
avatar). This existed in the original mockups from the start; it was
newly *visible* only once the frame-simulator fix (previous entry) made
it possible to actually scroll a narrow preview — a comment on `.header`
had previously (first compliance-fix round) rationalized this exact
overlap as "acceptable dev-tool chrome, not a spec change," which turned
out to be wrong once genuinely exercised. Fixed with a small JS function
(`stackDevBarOverHeader()`) in both files that measures the dev bar's
real rendered height (not a hardcoded px guess — library's bar wraps
across a variable number of lines depending on frame width, since it has
many buttons) and sets the real header's `top` as an inline style,
re-run on window resize and on every frame-simulator button click. The
`top: 0` written in each file's actual `.header`/`.app-header` CSS rule
is untouched and still a literal, correct copy of production.

**Bug 2 — real cascade-order bug, same class as the AppHeader burger fix
earlier this session.** In `library-mockup.html`, the unconditional
`.leftRail { display: flex; ... }` rule was declared AFTER the
`@container frame (max-width: 860px) { .leftRail { display: none; } }`
override — at equal specificity, source order decides, so the
unconditional rule always won and the desktop filter sidebar never
actually hid on mobile, regardless of width. This existed in the
original `@media` version of the file too (inherited unchanged through
the container-query conversion); it explains the human's screenshot
showing a huge inline SOURCE/STATUS filter list before ever reaching the
asset grid on the "Mobile 375" simulator. The mobile bottom-sheet
(`#sheetPanel`/`.mobileRailToggle`) was independently confirmed correct
and closed the whole time (`transform: matrix(1,0,0,1,0,388.5)`, i.e.
translateY(388.5px), off-screen) — this was purely the redundant desktop
rail failing to hide, not a bottom-sheet bug. Fixed by moving the
`@container` override to after the base rule (matching the exact
reordering already applied to `src/ui-v2/shell/AppHeader.module.css`'s
burger-menu fix). Audited every other converted `@media`→`@container`
pair in both files for this same ordering mistake (checked source line
number of every base rule against its override's line number) — none of
the other 14 pairs had it; this was isolated to `.leftRail`.

**Non-bug — Calendar's real, approved mobile-default List-view behavior.**
Separately, once the overlap was fixed, Calendar's Month grid was still
not visible by default at 375px — this is real, correct, already-approved
production behavior (`applyResponsiveDefaultView()` defaults to List
under 640px, matching `CalendarListView.jsx`'s own documented mobile
default; a 7-column grid genuinely doesn't work well on a phone). Not a
bug, but it made the Month grid's OWN mobile treatment hard for a
*reviewer* to find/check in the simulator. Added a dev-only "Preview
Month view on mobile" shortcut button to the state-switcher bar that
calls the exact same `setView('month')` a real user's manual toggle tap
would — does not change the real default logic or its approved
reasoning, only gives a reviewer instant access to see it.

Verified via real Playwright, not visual inspection alone: (1) scrolled
both files at 375px and measured zero pixel overlap between banner-bottom
and header-top (previously they were exactly co-located); (2)
`getComputedStyle(#leftRailDesktop).display` confirmed `"none"` at both
375px and 768px, `"flex"` at full desktop width; (3) clicked the new
"Preview Month view on mobile" button and confirmed `monthView` becomes
visible / `listView` hides, with the month grid actually rendering
(horizontally-scrollable at its documented 620px min-width, screenshot
captured); (4) re-ran the full 10-combination overflow matrix (both
tablet tiers × mobile × dark/light, both files) after all three fixes —
still 0px overflow everywhere.

Files touched: `library-mockup.html`, `calendar-mockup.html`.
If wrong: the sticky-offset fix and cascade reorder are both corrections
to demonstrated bugs (measured 0px→Npx overlap, `display:flex`→`none`
before/after), not stylistic changes — reverting either would
reintroduce the exact defect the human's screenshots showed. The "Preview
Month view on mobile" button is purely additive dev tooling; removing it
would not affect real behavior, only make Month harder for a reviewer to
reach.

---

**2026-07-08T08:01:00Z** — `frontend-builder`

Built the real ui-v2 Library page against the APPROVED `library-mockup.html`,
per Master Brief §1's Phase 3 gate (confirmed `docs/calendar-library-rebuild/
MOCKUP_APPROVED` exists before starting). New tree: `src/pages/Library/
LibraryPage.jsx` + `LibraryPage.module.css`, and
`src/pages/Library/components/{AssetCard,BulkActionBar,UploadModal,
AssetDetailDrawer,DeleteConfirmModal,TrashView}.jsx` (+ their own
`.module.css` files where they have component-local styles), plus
`src/pages/Library/libraryItemUtils.js` moved verbatim from the old
location. `app/app/library/page.jsx` now renders `LibraryPage` instead of
`LibraryPageV2`. Old `src/pages/LibraryPage/` directory and
`src/styles/LibraryV2.css` deleted after confirming (via curl against the
running dev server, before AND after deletion) that `/app/library` and
every other already-migrated route (`/app/dashboard`, `/app/generate`,
`/app/calendar`) still return 200 with no "Module not found" errors in the
RSC payload.

Decision 1 — reused every real handler/state from `LibraryPageV2.jsx`
unchanged (search/source/status/type/tag filters, remember-filters
localStorage, upload with duplicate-detection + mark-as-new-version,
archive, real `duplicateAsset` (confirmed wired in `LibraryStore.js`, not a
stub — the `AS_IS_AUDIT.md` §1.4 "coming soon" note is stale per the
mockup's own 2026-07-07T10:12:00Z decision entry), soft-delete with 30-day
Trash/restore, bulk select/archive/delete, and the Schedule hand-off via
`buildScheduleHandoffPath`), only swapping which primitives/CSS render them
— same Refactor-not-Rebuild approach `AS_IS_AUDIT.md` §4.1 called for and
the same pattern Studio/Dashboard already used.
Reasoning: task brief explicitly requires "every real prop/handler...work
identically, just restyled," and the data layer
(`LibraryStore.js`/`assetLibraryService.js`) was explicitly out of scope to
modify.
If wrong: any single handler can be re-diffed against the deleted
`LibraryPageV2.jsx` (recoverable from git history) without needing to
revisit the rest of this rebuild.

Decision 2 — followed the approved mockup's interaction change of Trash
from a modal (old `TrashModal.jsx`) to a full content-area page state
(`showTrash` boolean swaps the page header/description/actions and content
section, reached via the left rail's "Trash" item and closed via a "Back to
Library" button), rather than preserving the old modal presentation.
Reasoning: the mockup (already through design-system-compliance and
mobile-parity review, both passed) renders Trash as `data-panel="trash"`,
one of the page-level view states alongside grid/list/loading/empty — not
an overlay. Master Brief's build-agent scope is "build exactly what the
approved mockup shows... nothing more," and the interaction model is part
of what the mockup shows, not just its visual skin. The underlying data
path (`fetchTrash`/`restoreAsset`, 30-day recovery copy) is byte-for-byte
identical to the old `TrashModal.jsx` — only the container changed.
If wrong: reverting to a modal is a small, isolated change (wrap
`TrashView`'s JSX in `<Modal>` instead of the inline page-header swap) with
no data-layer impact either way.

Decision 3 — replaced the AS_IS_AUDIT.md-flagged raw `<table>` +
inline-style list/table view (old `LibraryPageV2.jsx` lines 592-644,
explicitly called out as "don't copy this part verbatim") with the same
`<table>` markup shape but driven entirely by `LibraryPage.module.css`
classes (`.table`, `.nameCell`, `.thumbWrap`, `.tableActions`, etc.) — no
inline `style={{ gridTemplateColumns: ... }}` or ad hoc inline styles
anywhere in the new list view.
Reasoning: direct instruction from `AS_IS_AUDIT.md` §1.4's "flagging as a
concrete 'don't copy this part verbatim' note for the future
frontend-builder agent" — this is that agent, following that note.
If wrong: no functional behavior changed (same columns, same data, same
View/Schedule actions per row), so reverting to inline styles would be
purely cosmetic and low-risk either way — not expected to be wrong.

Decision 4 — for the asset card's overflow ("more actions") menu, composed
the real `Dropdown` primitive with two plain buttons (Archive/Delete)
styled with minimal inline styles, rather than adding a new
"menu item" sub-component to `src/ui-v2/primitives/`.
Reasoning: Master Brief §0 rule 5 forbids inventing new components when
real primitives exist for the job; `Dropdown` is the real anchored-popover
primitive already used elsewhere (avatar menu, notifications). No mockup
state in `library-mockup.html` shows this menu's *open* contents in detail
(the mockup only shows the `⋮` trigger button, `.assetActions .iconBtn`, at
rest) — so its two-item internal layout is a reasonable, minimal
composition of existing tokens/classes, not a new visual pattern, and
matches the two actions (`Archive`/`Delete`) the old page's
`secondaryActions` array already wired identically.
If wrong: if a reviewer wants a first-class `MenuItem`/`DropdownMenu`
sub-primitive instead of ad hoc buttons, that's an additive change inside
`Dropdown`'s children slot only — no restructuring of `AssetCard.jsx`'s
props or the rest of the page needed.

Decision 5 — converted every `@container frame (...)` rule from the mockup
to a plain `@media (...)` rule at the identical pixel breakpoint (900px
burger nav — already built into the real `AppHeader.module.css`, 860px
filter-rail/bottom-sheet cutover, 480px 2-column grid, 640px main padding).
Reasoning: task brief's explicit instruction — the mockup's `@container`
conversion was a documented dev-tool-only fix (DECISIONS_LOG.md
2026-07-07T15:20:00Z) to make a fixed-width Artifact preview pane
resizable for review purposes; production has no such wrapper div
constraint, so `@media` against the real viewport is both correct and
simpler, and was verified via the same curl-based route check (no visual
diff possible without a browser tool in this session, but no build/config
divergence either — same breakpoint numbers, same rule bodies).
If wrong: if a future container-based layout (e.g. a resizable split view)
is introduced on this page, the base `.leftRail`/`.mobileRailToggle`/etc.
rules can be re-wrapped in `@container` without any class-name changes.

Files created: `src/pages/Library/LibraryPage.jsx`,
`src/pages/Library/LibraryPage.module.css`,
`src/pages/Library/libraryItemUtils.js`,
`src/pages/Library/components/AssetCard.jsx` (+`.module.css`),
`src/pages/Library/components/BulkActionBar.jsx`,
`src/pages/Library/components/UploadModal.jsx` (+`.module.css`),
`src/pages/Library/components/AssetDetailDrawer.jsx` (+`.module.css`),
`src/pages/Library/components/DeleteConfirmModal.jsx`,
`src/pages/Library/components/TrashView.jsx`.
Files edited: `app/app/library/page.jsx` (now renders the new component),
`src/styles/app-entry.css` (removed the now-dead `@import "./LibraryV2.css"`
line — this is a global CSS entry point imported by every route, so leaving
a dangling `@import` after deleting the target file would have broken the
whole app's build, not just Library; verified via curl against
`/app/library`, `/app/dashboard`, `/app/generate`, and `/app/calendar` all
still returning 200 after the edit).
Files deleted (only after confirming the new route compiled cleanly via
curl, per the task's explicit instruction): `src/pages/LibraryPage/` (the
entire old directory: `LibraryPageV2.jsx`, its 6 old sub-components,
`libraryItemUtils.js`), `src/styles/LibraryV2.css`.

---

**2026-07-07T16:35:00Z** — `parent (orchestrator)`

Human reported Calendar's dark mode showing "white sections." Diagnosed
via direct computed-style inspection (`getComputedStyle`, not visual
guessing): `.mockup-banner` (the top dev-only text banner) was a SIBLING
of `#themeRoot`, positioned in the HTML before `<div data-uiv2-theme="dark"
id="themeRoot">` opened -- meaning it sat entirely outside the
`[data-uiv2-theme="dark"]` selector scope every `--uiv2-*` custom
property is defined within. Its CSS (`background: var(--uiv2-accent-wash);
color: var(--uiv2-accent-text);`) referenced variables that simply didn't
exist on that element or its ancestors, and `var()` with an undefined
custom property falls back to the property's initial value --
`background-color: transparent` and inherited (browser-default black)
text -- rendering as a plain white bar over the page's unstyled default
white canvas. Confirmed precisely: `getComputedStyle(banner).backgroundColor`
was literally `"rgba(0, 0, 0, 0)"`.

Checked every other top-level element for the same "outside the themed
subtree" mistake: `.state-switcher` (the Month-state/Demo/frame button
row) IS a real descendant of `#themeRoot` and was already rendering
correctly (`rgb(19, 20, 23)` = the real dark `--uiv2-bg-inset` value,
confirmed via computed style, not just visual read of a low-res
screenshot). `library-mockup.html`'s equivalent dev bar (`.mockupBar`)
is unaffected by this class of bug entirely -- it's intentionally
hardcoded to its own dark striped pattern regardless of theme, never
routes through `--uiv2-*` tokens, by original design. So the fix is
isolated to this one element in one file.

Fix: moved `.mockup-banner`'s HTML to be the first child inside
`#themeRoot` (right before `.app-header`) instead of a preceding sibling,
so it becomes a real descendant and inherits theme tokens like every
other element. Verified via computed style before/after: dark theme now
correctly resolves to `rgba(255, 92, 56, 0.1)` background / `rgb(255, 92,
56)` text (the real accent-wash/accent-text pair) instead of transparent
black-on-nothing; also toggled to light theme and confirmed it follows
correctly too (`rgba(255, 92, 56, 0.08)` / `rgb(225, 78, 47)`, the real
light-theme accent-wash/accent-text pair) -- previously it would have
stayed broken (transparent/black) in either theme, since the bug was
about being outside the scope entirely, not about which theme was active.
Screenshot re-captured full-page: no white/light sections remain anywhere
on the page in dark mode.

Files touched: `calendar-mockup.html`.
If wrong: this is a straightforward DOM-nesting correction with no
functional/behavioral side effects (the sticky dev-bar-height JS added
in the previous entry measures the banner's rendered geometry, not its
DOM position, so it is unaffected by this move) — reverting would
reintroduce the demonstrated white-background bug.

---

**2026-07-08T08:03:00Z** — `feature-frontend-builder` (Phase 3, real build,
Personal Content Calendar)

Confirmed `docs/calendar-library-rebuild/MOCKUP_APPROVED` exists before
touching anything under `src/**`, per Master Brief §0 rule 1.

**Decision 1 — restyled the 12 `src/calendar/components/**` files IN PLACE
(kept their JSX/business logic 100% unchanged) rather than rewriting them as
new files, and built a single new stylesheet
(`src/calendar/calendar-engine-v2.css`) that redefines every one of
`CalendarEngine.css`'s original selectors (the `cal3-*`/`post-card`/
`agenda-*`/`post-drawer`/`schedule-modal`/`quickpost-*`/`cal3-cmdbar*`/
`cal3-cell-palette*` family, plus the legacy `ui-button`/`ui-icon-button`/
`ui-input`/`ui-select`/`ui-textarea`/`ui-field*`/`ui-badge`/`ui-empty-state*`
primitive-alias classes those files reference by literal class name) using
only `var(--uiv2-*)` tokens, verified value-by-value against the real
`Button.module.css`/`IconButton.module.css`/`Badge.module.css`/
`Card.module.css`/`Modal.module.css`/`Drawer.module.css`/
`EmptyState.module.css` so every reskinned class computes the same paint as
the actual ui-v2 React primitive it stands in for.
Reasoning: this task explicitly allows "restyle the existing
`src/calendar/components/*.jsx` files in place instead of replacing them,
that's fine too — just be explicit... about which approach you took and
why." All 12 files are real, QA-passed, live-Supabase-wired business logic
(confirmed via AS_IS_AUDIT.md's "Refactor, not Remove" classification and
my own direct reads of every file) with zero behavior distinct from their
visual styling — every `ui-button`/`ui-icon-button` usage in them is a plain
`<button className="...">`, not a component with its own logic, so a
class-for-class token reskin produces a pixel-identical outcome to swapping
in the literal `<Button>`/`<IconButton>` React components, at a small
fraction of the edit-surface and regression risk of touching 12
already-approved files' JSX (schedule-conflict handling, the
optimistic-concurrency guard, the three reschedule modes, the AI caption
audit, the Quick Post hand-off race fix, etc. — all documented as
hard-won, specific bugfixes in this same file above). The one place I DID
use the real React primitives directly is the new page shell itself
(`AppHeader`, `MobileNavDrawer`, `IconButton`, `CreditPill`, `Avatar`,
`UiV2ThemeProvider`) — that file is new, so there was no existing logic to
risk, and it is the literal outer chrome Studio/Dashboard already establish
this exact way.
If wrong: if a future pass wants literal `<Button>`/`<IconButton>`/`<Badge>`
component substitution inside the 12 engine files instead of the CSS-alias
approach, `calendar-engine-v2.css`'s `ui-button`/`ui-icon-button`/`ui-badge`
block is the one place to delete once every call site is swapped to the
real components — no other part of this file depends on those classes
still existing, since every other selector is the calendar-specific
`cal3-*`/`post-card`/etc. family, not a primitive alias.

**Decision 2 — new page shell at `src/pages/Calendar/CalendarPage.jsx` +
`CalendarPage.module.css`**, replacing `src/pages/ContentCalendar/
PersonalCalendarPage.jsx`, following the exact `StudioPage.jsx`/
`PersonalDashboardPage.jsx` pattern: `UiV2ThemeProvider` wrapping a body
component, real `AppHeader` (with the same `NAV_ITEMS`, credit pill, theme
toggle, avatar Studio already uses) + `MobileNavDrawer` for the burger
fallback under 900px, and a `.main`/`.canvas` CSS-Module wrapper in place of
the old `.dashboard-shell` grid + `UserNavbar`/`UserSidebar`. Every hook,
handler, and prop passed into the 8 stateful child components
(`CalendarGrid`, `CalendarListView`, `PostDetailDrawer`, `ScheduleModal`,
`QuickPostComposer`, `UnscheduledRail`, `CalendarCommandBar`,
`CellCommandPalette`, `IntelligenceStrip`, `ToastStack`) was copied verbatim
from `PersonalCalendarPage.jsx` — same scope resolution, same
`useCalendarPosts`/`useCalendarDrafts`/`useScheduleAction` calls, same
three reschedule-mode commit path, same Quick-Post/Schedule-hand-off race
fix, same ⌘K shortcut, same mobile-default-to-List-under-600px behavior.
Nothing under `src/calendar/hooks/**`, `src/calendar/services/
calendarService.js`, or `src/calendar/stores/calendarUiStore.js` was
touched, per this task's explicit "do not change the data-layer behavior"
instruction.
If wrong: since every handler/hook call is byte-for-byte the same as the
old page, any data-layer regression would not be attributable to this
rewrite — it would mean the same bug already existed in
`PersonalCalendarPage.jsx` before deletion. Any presentation-only issue is
isolated to `CalendarPage.jsx`'s JSX/`CalendarPage.module.css` or
`calendar-engine-v2.css`, not the business logic.

**Decision 3 — deleted `src/pages/ContentCalendar/PersonalCalendarPage.jsx`
and `src/styles/CalendarEngine.css` only after confirming (a) a repo-wide
grep found zero remaining references to either path outside this task's own
now-updated `app/app/calendar/page.jsx`, and (b) the new route
(`/app/calendar`) returned HTTP 200 with no `Failed to compile`/`Module not
found`/`SyntaxError` strings in the rendered HTML both before and after the
deletion, against the human's already-running dev server on port 3000 (a
redundant second `next dev` instance this build accidentally spawned on
port 3001 was killed immediately, not left running).**
Did NOT delete `src/pages/CalendarPage/components/ScheduleModal.jsx` (the
orphaned pre-existing file AS_IS_AUDIT.md §4.5 flagged as Remove) — that
classification is explicitly "awaiting human sign-off" in the audit and is
Library's concern (it was the old Library-only modal, not part of this
Calendar packet's file map), not something this task's own file list
authorized touching.
Did NOT rebuild any of the 12 `src/calendar/components/**` files as new
files (see Decision 1), so per this task's own instruction ("delete...
old `src/calendar/components/*.jsx` files IF you rebuilt them as new ui-v2
versions") none of them were deleted — they are the same files, now painted
by a new stylesheet.
If wrong: both deleted files are recoverable from git history; nothing else
in the tree imports either path (verified via grep immediately before
deletion), so restoring them would be a pure revert with no follow-on
breakage to reconcile.

Files touched: `src/pages/Calendar/CalendarPage.jsx` (new),
`src/pages/Calendar/CalendarPage.module.css` (new),
`src/calendar/calendar-engine-v2.css` (new),
`app/app/calendar/page.jsx` (updated to render the new component).
Files deleted: `src/pages/ContentCalendar/PersonalCalendarPage.jsx`,
`src/styles/CalendarEngine.css` (and the now-empty
`src/pages/ContentCalendar/` directory).
Files NOT touched: all 12 `src/calendar/components/**` files, all of
`src/calendar/hooks/**`/`src/calendar/services/**`/`src/calendar/stores/**`,
`src/utils/timezone.js`, `src/utils/postStatusMachine.js`,
`src/constants/statuses.js`.

---

**2026-07-08T00:00:00Z** — `visual-qa-fix-agent`
Decision: The prior "token-faithful CSS reskin, zero JSX changes" approach
(Decision above, "Files NOT touched: all 12 `src/calendar/components/**`
files") was correct for 10 of the 12 components, but wrong for two:
`UnscheduledRail.jsx` and `CalendarCommandBar.jsx` needed real JSX/layout
changes, not just a CSS remap, because their DOM *structure* (not just
colors) didn't match the approved mockup. Confirmed by an independent visual
QA pass against `calendar-mockup.html`.
Reasoning: CSS can restyle colors/spacing/typography of an existing DOM
shape, but it cannot turn a horizontal bottom tray into a vertical
right-docked sidebar, or make a component that only renders inside a modal
overlay also render inline — those require different elements/parents in
the tree. Both gaps were structural, not cosmetic.
If wrong: the two components' pre-fix versions are recoverable from git
history; nothing else imports their internals (verified via grep), so a
revert would be a clean, isolated rollback.

Decision: For `UnscheduledRail.jsx`, kept the component's real hooks/handlers
(drag-to-schedule via `dataTransfer`, the `onMoveTrigger` tap-to-select-move
button, the resizable-height drag handle, `workspaceType` scope guard, empty
state) and only changed (a) the outer wrapper's class names/DOM role from a
horizontal `cal3-tray` to a vertical `cal3-rail` sidebar matching the
mockup's `.rail`/`.rail__scroll`/`#draftsRail`, and (b) `DraftCard`'s
internal element order (thumb → meta → move-button, was thumb → move-button
→ meta) to match the mockup's visual reading order. Renamed the resize
persistence key `cal3-tray-height` → `cal3-rail-height` and widened its
min/default/max (100/148/520 → 160/360/720) since it now resizes a vertical
list's max-height, not a horizontal tray's height, and a pre-migration saved
148px value would have looked cramped as a sidebar's height.
Reasoning: The task explicitly said not to drop any real functionality —
renaming the CSS class layer and reordering DOM siblings changes nothing
about *how* the component behaves, only what it looks like structurally.
If wrong: the resize-height localStorage key rename means users with an old
saved `cal3-tray-height` value will just fall back to the new default
(360px) once, not lose data destructively — acceptable since it's a purely
cosmetic preference, not user content.

Decision: For `CalendarCommandBar.jsx`, added a new named export
`CalendarCommandBarInline` (always-visible bar, mockup's `.cmdbar` /
`.cmdbar__chips`) instead of modifying the existing default-exported overlay
component's internals. `CalendarPage.jsx` now renders
`CalendarCommandBarInline` unconditionally right below `IntelligenceStrip`,
wired to open the *same* existing overlay component (same `cmdBarOpen`/
`cmdBarPreset` state, same `executeCalendarCommand` service call, same
`onApplyAction` handler) — the overlay itself, its ⌘K keyboard shortcut, and
the header's pre-existing "Ask AI ⌘K" ghost button are all untouched and
still work as additional entry points to the identical overlay.
Reasoning: This was the lowest-risk way to close the gap — the overlay
component already had 100% of the real AI logic (suggestions, submit,
result rendering, action buttons, error state) fully QA'd; duplicating that
logic into a second "inline mode" of the same component risked introducing
a second, divergent code path for the same feature. A separate, dumb
"trigger" component that opens the existing overlay keeps exactly one
source of truth for AI-command execution.
Reasoning (chip count): the mockup shows 5 quick-action chips; this
implementation renders all 6 real `SUGGESTED_COMMANDS` entries (adds "How
many posts do I have scheduled this week?"). This is an intentional, minor
deviation — dropping a working, real quick-action to hit an exact count
would have thrown away functionality for no benefit, and the chip row is
already horizontally scrollable in both the mockup's CSS and this
implementation, so the 6th chip doesn't break the row's layout.
If wrong: if the human wants exactly 5 chips pixel-matched to the mockup,
removing the 6th (`How many posts...`) from the inline row (but leaving it
in the overlay's own suggestion list) is a one-line change.

Decision: Fixed an unrelated regression discovered while testing the rail
sidebar: `.draft-card` had no `flex-shrink` set, so inside
`.cal3-rail__scroll`'s fixed-`max-height` flex column, the browser's default
`flex-shrink: 1` let every draft card compress far below its content's
natural size (~58px → ~20px) to force-fit the container instead of
overflowing and scrolling, which visually looked like corrupted/overlapping
text. Added `flex-shrink: 0` to `.draft-card`. Verified via Playwright
(computed height went from 20px to the correct 58px, and a full-page
screenshot after the fix shows clean, non-overlapping rows).
Reasoning: This was a pure CSS bug introduced by this same change (the old
horizontal tray never hit this failure mode because its cards had
`flex-shrink: 0` implicitly via a fixed `width` + row layout that never
needed to shrink cross-axis). Left unfixed, the sidebar would have passed a
cursory glance but failed under any real draft list longer than ~2 items.
If wrong: reverting this one-line CSS addition is trivial and has no
dependency on anything else changed in this session.

Verified before/after: `curl -s -o /dev/null -w "%{http_code}" /app/calendar`
returned 200 both before and after all changes (page keeps compiling
cleanly). Logged in as the test account via Playwright and confirmed with
screenshots + `getComputedStyle`/`getBoundingClientRect` checks: (1) the
drafts rail renders as a right-docked vertical sidebar with 58px-tall
correctly-laid-out draft cards, collapses to a horizontal `order: -1` strip
below 640px per the mockup's documented mobile behavior; (2) the inline
"Ask AI" bar with chips is always visible below the Intelligence Strip,
clicking it or a chip opens the real ⌘K overlay pre-filled with real
command text, and the overlay's own ⌘K shortcut / header button still work
as additional entry points.

Files touched: `src/calendar/components/UnscheduledRail.jsx`,
`src/calendar/components/CalendarCommandBar.jsx` (added named export, no
existing exports/behavior removed), `src/calendar/calendar-engine-v2.css`
(renamed/restructured `.cal3-tray*` → `.cal3-rail*` selectors, added
`.cal3-cmdbar-inline*` selectors, changed `.cal3-body` from a flex column to
a two-column CSS grid with responsive breakpoints at 1180px/900px/640px),
`src/pages/Calendar/CalendarPage.jsx` (moved `<UnscheduledRail>` out of
`.cal3-main-col` to be a grid sibling, added `<CalendarCommandBarInline>`
below `<IntelligenceStrip>`).
Files NOT touched: everything else — same scope boundary as the prior
entry (`src/calendar/hooks/**`/`services/**`/`stores/**`, all other
`src/calendar/components/**` files, `src/utils/**`).
