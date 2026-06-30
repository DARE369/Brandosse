# Research — Packet 1: Personal Content Calendar

Agent: `implementation-researcher`
Date: 2026-06-23
Builds on: `docs/calendar-library-rebuild/packet-1-personal-calendar/AS_IS_AUDIT.md` (Phase 0). This document does not re-derive facts already established there — it cites them by section where relevant and focuses on the four research questions assigned for Phase 1.

Web research tool availability: **`WebSearch` and `WebFetch` were available in this environment and used.** Every external claim below is cited with a URL. Codebase claims are cited with file:line or migration name. No unresearched guess is presented as a finding.

---

## 1. Calendar grid rendering — library vs. existing custom grid

### 1.1 What's actually in `package.json`

Read directly: `package.json:27-56` (dependencies), `:57-67` (devDependencies). No calendar-grid library is present — no `react-big-calendar`, `fullcalendar`/`@fullcalendar/*`, `react-calendar`, `react-day-picker`, or similar. The only relevant existing dependencies are:

- `@dnd-kit/core` `^6.3.1`, `@dnd-kit/sortable` `^10.0.0` — drag-and-drop primitives (see §2 below for touch-specific findings).
- `framer-motion` `^12.23.24` — animation, already used elsewhere in the app, available for any open/close/slide-over transitions the new grid needs.
- `@tanstack/react-query` `^5.90.5` (+ persist-client/sync-storage-persister) — already the project's data-fetching/caching layer; relevant to `useCalendarPosts.js`'s eventual implementation, not grid rendering itself, but worth noting since the spec's hook-based architecture (`CALENDAR_SPEC.md` §1) will likely want to sit on top of this rather than introduce a second fetching pattern.
- No date-manipulation library (no `date-fns`, `dayjs`, `luxon`, `moment`). Confirmed by `package.json` dependency list and corroborated by the Phase 0 audit's finding that `src/utils/timezone.js`'s own header comment explicitly states no such dependency exists (AS_IS_AUDIT.md §3.12).

### 1.2 Recommendation: keep building on the existing custom grid, do not adopt a library

**Recommendation: refactor the existing `v3/MonthGrid.jsx` and `v3/WeekGrid.jsx` into the new shared `src/calendar/components/CalendarGrid.jsx`, rather than adopting `react-big-calendar`, FullCalendar, or any other grid library.**

Reasoning, grounded in what Phase 0 already proved rather than re-investigated from zero:

1. **The existing grid code already matches the spec's exact requirements, including idiosyncratic ones a library would fight.** `CALENDAR_SPEC.md` §3 requires month view to show "up to 3 grouped cards per day, then '+N more'" — `MonthGrid.jsx:42-43` (`visible = items.slice(0,3)`, `overflowCount`) already implements this precisely (AS_IS_AUDIT.md §3.2). Generic calendar libraries (FullCalendar, react-big-calendar) render events as event-list/popover patterns that are close but not identical to this spec'd density behavior, and bending a third-party library's event-rendering API to match "exactly 3 + overflow with grouped multi-platform cards" is realistically more code than the current custom implementation already is.
2. **Status communicated by icon+label+color together, never color alone** (`CALENDAR_SPEC.md` §3) and the platform-icon-stack card requirement (§2.2, §4) are bespoke rendering concerns specific to this product's card anatomy (`PostCard.jsx`'s eventual shape). No calendar library ships this out of the box — it would be custom cell-renderer work regardless of the underlying grid engine, which erases most of the "buy vs. build" time savings a library would otherwise offer.
3. **Design system constraint (Master Brief §0 rule 5): "no new component library."** Adopting FullCalendar or react-big-calendar means adopting that library's own CSS/DOM structure and theming model, which would need to be overridden wholesale to match the existing Midnight Aurora / Dashboard-and-Generate-Studio design tokens. That fight is exactly the kind of friction the existing custom grid doesn't have, since it's already built directly against the app's real tokens.
4. **The DnD mechanics are already wired to `@dnd-kit`, already in the dependency tree, and already proven working in this exact codebase.** `WeekGrid.jsx`'s `useDraggable`/`useDroppable` hour-cell pattern (AS_IS_AUDIT.md §3.3) is a legitimate reference implementation. Swapping to a calendar library would either require dropping `@dnd-kit` in favor of that library's built-in drag handling (forfeiting the touch-sensor configuration already tuned for this app) or running two drag-and-drop systems side by side (the library's internal one, plus `@dnd-kit` for the Drafts/Unscheduled rail drag-in) — both are worse than one consistent system.
5. **Bundle-size and maintenance surface.** FullCalendar's React wrapper and core packages are large multi-package installs (core + day-grid + time-grid + interaction plugins, each versioned independently); react-big-calendar pulls in its own moment/date-fns adapter layer. Given there is no date library in this codebase today and the existing `timezone.js` Intl-only approach already works correctly (AS_IS_AUDIT.md §3.12), adopting a calendar library would likely reintroduce a date-library dependency this codebase has deliberately avoided.

**What a library would have offered that the custom build doesn't have today:** built-in keyboard navigation/ARIA roving-tabindex grid patterns, resize/multi-day-span event rendering, and battle-tested cross-browser date-math edge cases (DST transitions, etc.). These are real gaps worth tracking (see §2 below for the accessibility angle specifically), but they are gaps to close inside the custom `CalendarGrid.jsx`, not reasons to replace it — the spec's view requirements (month/week/list, §3) and density rules are unusual enough, and the design-system constraint strict enough, that a library adoption would trade a moderate, addressable gap for a much larger theming/architecture fight.

**Confirms Phase 0's framing directly:** AS_IS_AUDIT.md §6 already concluded "Yes, substantially" reusable, citing `WeekGrid.jsx`'s hour-grid+drag mechanics and `MonthGrid.jsx`'s day-cell+overflow pattern as "legitimate reference implementations." This research confirms that conclusion from the library-evaluation angle specifically: there is no superior off-the-shelf alternative sitting unused in `package.json`, and there's a positive reason (the §3 density/grouping requirements, the design-system rule, the existing `@dnd-kit` investment) to prefer evolving what exists.

---

## 2. Drag-and-drop touch verification — does `TouchSensor` satisfy the Master Brief's mandate?

### 2.1 The question

Master Brief §4: "every desktop hover/drag interaction needs a working non-hover equivalent in the same markup: drag-and-drop reschedule (Calendar) needs a tap-to-select-then-tap-target-slot fallback." The question for this packet: does `@dnd-kit`'s `TouchSensor`, as currently configured (`{ delay: 250, tolerance: 8 }`, confirmed at `CalendarPageV3.jsx:246`), already satisfy this, or is a genuinely separate tap-to-select-then-tap-destination interaction still required?

### 2.2 Finding: TouchSensor making touch-drag mechanically work is necessary but not sufficient — a separate non-drag path is still required

This is a firm **"separate path required,"** not a stylistic preference, for two independent reasons, one accessibility-standards-based and one UX-reliability-based:

**(a) WCAG 2.2 Success Criterion 2.5.7 (Dragging Movements, Level AA) requires a single-pointer alternative regardless of whether the drag gesture itself works.**

> "WCAG 2.5.7 Dragging Movements... requires that any functionality requiring a drag operation must also be achievable with a single pointer action (like a click or tap) without dragging... approximately 15 million Americans have conditions affecting upper limb mobility, and many cannot perform the precise motor control required for drag-and-drop interactions." — [How Do You Meet WCAG 2.5.7 Dragging Movements Requirements?, TestParty](https://testparty.ai/blog/wcag-dragging-movements-guide)

> "Understanding Success Criterion 2.5.7: Dragging Movements" — official W3C WAI understanding document. [W3C WAI](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)

The criterion has a narrow exception for cases where the drag path itself is "essential" (freehand drawing, signature capture). A calendar reschedule explicitly does not qualify:

> "A calendar reschedule feature would likely NOT qualify as an 'essential' exception, since the drag-and-drop is the means to an end (changing the event date) rather than the activity itself... a drag-and-drop calendar rescheduling feature would require accessible single-pointer alternatives, such as buttons, date pickers, or text inputs for changing event dates." — [WCAG 2.5.7 Dragging Movements: Complete Implementation Guide, AllAccessible](https://www.allaccessible.org/blog/wcag-257-dragging-movements-implementation-guide)

This means even a hypothetically flawless touch-drag implementation would not satisfy accessibility requirements on its own — a *non-drag* single-pointer path is mandatory, independent of touch-drag quality. `TouchSensor` only ever addresses the drag gesture itself; it cannot be the thing that satisfies SC 2.5.7, by definition (it's still a drag).

**(b) dnd-kit's own documentation does not claim TouchSensor is an accessibility solution, and is silent on touch-specific reliability/alternatives.**

Fetched directly from dnd-kit's official accessibility guide:

> "dnd-kit does not recommend or require a non-drag alternative interaction path for accessibility. The guide focuses exclusively on making drag-and-drop itself keyboard accessible... The documentation makes no mention of touch interactions, TouchSensor reliability, limitations, or alternative approaches for touch device users." — [Accessibility | @dnd-kit Documentation](https://dndkit.com/guides/accessibility) (fetched and summarized 2026-06-23)

In other words: dnd-kit's accessibility story is keyboard-only (arrow keys + Enter/Space to pick up/move/drop an item via `KeyboardSensor`). It does not extend that accessible pattern to touch. A `TouchSensor`-enabled drag is a *mechanical* improvement for touch input (it lets a finger perform the same continuous-drag gesture a mouse would), but it inherits all the same motor-control and precision problems SC 2.5.7 is concerned with — arguably worse on a small touchscreen than on desktop, since touch removes the precision a mouse pointer offers.

**(c) Known TouchSensor/PointerSensor reliability caveats, independent of the accessibility argument, reinforce why a non-drag path is also a UX-robustness requirement, not just a compliance checkbox:**

> "iOS Safari blocks touch drag when the page can scroll unless you add `preventScrollOnStart`... `touch-action: none` is the only way to reliably prevent scrolling for pointer events, and is currently the only reliable way to prevent scrolling in iOS Safari for both Touch and Pointer events." — [Understand touch sensor implementation for mobile devices](https://app.studyraid.com/en/read/12149/389960/touch-sensor-implementation-for-mobile-devices)

> Dragging with the default `PointerSensor` "does not work well on touch devices"; the GitHub issue thread confirms `TouchSensor` + `MouseSensor` + `KeyboardSensor` works smoothly on mobile, while `PointerSensor` + `KeyboardSensor` (the more commonly defaulted-to combination) was reported "unusable... in Chrome on Android 11." — [Dragging with PointerSensor does not work well on touch devices, dnd-kit GitHub Issue #435](https://github.com/clauderic/dnd-kit/issues/435)

The current codebase already does the right mitigation here — `CalendarPageV3.jsx:245-246` configures both `PointerSensor` (desktop, `distance: 8`) and `TouchSensor` (touch, `delay: 250, tolerance: 8`) explicitly, rather than relying on `PointerSensor` alone for both — so the *mechanical* touch-drag reliability concern is already addressed reasonably well in the existing code. But this only solves "drag works on touch," not "users who can't or don't want to drag have an alternative," which is the actual Master Brief §4 requirement and the actual WCAG 2.5.7 requirement.

### 2.3 What already exists in the codebase that is — and isn't — a real fallback today

Per Phase 0 (AS_IS_AUDIT.md §3.4, confirmed independently here at `PostPanel.jsx:419-441`): `PostPanel.jsx` already has a genuine single-pointer reschedule path — native `<input type="date">` / `<input type="time">` fields, wired through `combineDateAndTime()` → `zonedDateTimeToUTC()` (no drag gesture involved at all, timezone-correct). This **does** satisfy SC 2.5.7's letter for the cards it applies to (any post can be rescheduled via the detail panel without ever dragging).

However, this is not the same interaction the Master Brief §4 describes ("tap-to-select-then-tap-target-slot fallback") and Phase 0 itself flagged this gap explicitly (AS_IS_AUDIT.md §3.5, on `DraftTray.jsx`): the panel-based date/time-field path requires opening the full detail drawer first — a heavier, more clicks/taps path than the desktop drag gesture it's meant to mirror. The Master Brief's described pattern is lighter-weight: select a card (tap once), then tap a destination day/slot directly on the grid, without a full panel detour. Today, no such direct tap-to-place path exists anywhere in the audited tree — only (a) drag, and (b) the full-panel date-field edit.

### 2.4 Recommendation for Phase 2 mockups

Phase 2 mockups must show a **third, explicit interaction mode** beyond "drag" and "open full panel and edit date fields": a lightweight tap-to-select (the card visually enters a "selected, choose a destination" state) → tap-destination-cell (commits the move, same optimistic-update + conflict-toast path as drag) flow, available at every width, not just below a mobile breakpoint — consistent with Master Brief §4's "touch laptops and tablets exist at desktop widths too" rule. This is a *third* path, not a replacement for either existing one: drag stays (it's fast and delightful when it works), the full panel stays (it's needed for editing caption/platform alongside the date anyway), and the new tap-select-tap-place path is what makes rescheduling reliably accessible without requiring precision dragging or a full panel detour. `qa-persona-agent`'s Solo Sade walkthrough (named explicitly in `PACKET_1_PERSONAL_CALENDAR.md`'s Phase 2 instructions: "rescheduling by drag (and by the touch fallback)") should treat this third path as the thing being tested under "touch fallback," not the existing `TouchSensor`-enabled drag.

---

## 3. Multi-platform grouping — confirming `generation_id` as the calendar grouping key

Per the task framing, this is a sanity-check/confirm-or-flag exercise building on Phase 0's conclusion (AS_IS_AUDIT.md §4), not a from-scratch re-investigation.

### 3.1 Confirmation: `generation_id` is the correct, already-proven grouping key — at the database-constraint level, not just convention

Beyond what Phase 0 already found (column exists, used as a join key in `SessionStore.js`, `pipelineService.js`, `admin-list-posts/index.ts`, documented at `docs/database-consistency-audit.md:76`), this research read the actual migration and found a stronger guarantee than "convention":

`supabase/migrations/20260227103000_generation_post_unification_and_rls.sql:76-82` creates a **unique index enforcing the fan-out pattern at the schema level**:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_unique_draft_per_generation_account
  ON public.posts(
    user_id,
    generation_id,
    coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'draft' AND generation_id IS NOT NULL;
```

This index's shape *is* the multi-platform fan-out model made explicit: one `generation_id` can have many draft `posts` rows, differentiated only by `account_id` (the per-platform/account dimension), and the database itself prevents duplicate draft rows for the same `(user, generation, account)` triple. This is exactly the shape `CALENDAR_SPEC.md` §2.2 describes ("a single generation can fan out into multiple `posts` rows... one per platform/account") and confirms it's not just an application-level pattern that happens to use `generation_id` — it's a constraint the schema itself encodes.

`PERSONAL_WORKSPACE_SPEC.md` §5.4 (`publishContent()`, `SessionStore.js:2495`) independently confirms the write-time behavior: "Builds one `posts` row per selected platform/account (primary + secondary), each carrying its own resolved `platform` and `account_id`" — every row from one `publishContent()` call shares one originating generation.

**Conclusion: confirmed, formally. Use the existing `generation_id`; do not add a new `content_group_id` column.** This closes `CALENDAR_SPEC.md` §13 item 1 / §12 item 1 (same item, the doc's known dual-numbering, per the task framing) as: no schema change needed.

### 3.2 Concern surfaced: `generation_id` is nullable, and the Quick Post composer's own spec'd UX guarantees null rows will exist

This is the part of the task asking to look for a conflict, not just confirm the column exists. Grepping the schema confirms `generation_id` is **not required to be present on every `posts` row**:

- The same migration's auto-draft trigger only fires `WHERE generation_id IS NOT NULL` in multiple places (`20260227103000_generation_post_unification_and_rls.sql:82, 183`).
- `supabase/migrations/20260324110000_org_pipeline_tables.sql:28`: `generation_id uuid REFERENCES public.generations(id) ON DELETE SET NULL` — explicitly nullable, and explicitly nulled out if the source generation is ever deleted.
- Throughout the application code, the defensive `post.generation_id || null` pattern appears consistently (`SessionStore.js:379,387`, `LibraryStore.js:256`, `pipelineService.js:549,658`, `orgDraftWorkflowService.js:266`, `OrgDraftWorkflowModal.jsx:411,514,754`) — every call site treats a missing `generation_id` as an expected, handled case, not an invariant violation.

**Where this actually bites the new Calendar build:** `CALENDAR_SPEC.md` §6.3 (Quick Post composer) step 1 explicitly says "Pick **zero or one** existing Library asset." A Quick Post created with zero Library asset has no generation behind it at all — there is nothing to set `generation_id` to, by design. The same applies to any post created via the AI week-plan / command-bar flow already in the codebase today (`CalendarCommandBar.jsx`'s "generate week plan" action, per AS_IS_AUDIT.md §1.1, calls `createPost()` directly) — these are calendar-native creations with no upstream `generations` row.

**What this means for `CalendarGrid.jsx`'s grouping logic:** the grouping-by-`generation_id` rule must explicitly handle `generation_id IS NULL` as "this post is its own group of one" (render as a standalone card, no platform-icon-stack grouping attempted), never as an implicit bug or an accidental "all null-generation posts get grouped together" bucket (since `NULL = NULL` is not true in SQL/JS equality terms anyway, but it's worth stating as an explicit rule for whoever writes the grouping function, since a naive `groupBy(post => post.generation_id)` in JS *would* incorrectly bucket every null-generation post into one `"null"`-keyed group if not handled with care, e.g. via `Object.groupBy` coercing `null`/`undefined` to the string `"null"`/`"undefined"` keys).

**No conflict found with existing uses of `generation_id` elsewhere** (Pipeline, SessionStore, admin moderation, Library) — every one of those call sites already treats nullability as expected and handles it defensively. The grouping requirement for Calendar is additive (group when present, treat as singleton when absent) and does not need any other part of the system to change its handling of the column.

### 3.3 Net recommendation

Confirmed, with one concern flagged and resolved at the design level (not requiring schema changes): use `generation_id` as-is for grouping; `CalendarGrid.jsx`'s grouping function must treat `null`/missing `generation_id` as "ungroupable, render standalone" rather than attempting to bucket all such rows together. This should be written into the Phase 2 mockup's data-shape assumptions and into `useCalendarPosts.js`'s eventual grouping logic in Phase 3.

---

## 4. Quick Post composer — `generate-post-metadata` edge function confirmation

### 4.1 Existence and location

Confirmed: `supabase/functions/generate-post-metadata/index.ts` exists (419 lines). This is a real, deployed-shape Supabase Edge Function (standard `serve()` Deno handler), not a stub or placeholder.

### 4.2 Confirmed: callable as a plain service call, with no dependency on Generate Studio UI state

Reading the function's request contract (`MetadataRequest` type, `index.ts:22-31`) and its `loadContext()` resolution logic (`index.ts:90-188`) confirms **three independent ways to invoke it**, none requiring any Generate Studio/AI Studio UI state to be open or active:

1. **`post_id` only** (`index.ts:95-144`) — loads the post row directly (with its joined `generations` row if one exists), resolves brand/org context from the post's own `organization_id`/`brand_project_id`/`user_id`, and authorizes access by checking `post.user_id === userId` (personal) or org membership (org). No session, no Studio state.
2. **`generation_id` only** (`index.ts:146-176`) — loads the `generations` row directly, same authorization pattern.
3. **Neither — raw `prompt` + optional `organization_id`/`brand_project_id`** (`index.ts:178-187`) — the fallback path, used when there is no post or generation at all yet. This is the path most directly relevant to Quick Post: a draft caption can be requested for a not-yet-created post, purely from a typed prompt/topic plus the calling user's identity (taken from the auth header, not from any client-side session object).

The function resolves brand voice context itself, independent of caller state: org calls go through `buildBrandPrompt()` → `fetchBrandProject()`/`fetchDefaultBrandProject()` (`index.ts:246-281`); personal calls go through `buildPersonalBrandPrompt()`, which queries the calling user's own `brand_kit` row directly by `user_id` (`index.ts:192-244`). Authentication is handled the standard way for this codebase's edge functions — `requireUser(authClient)` against the `Authorization` header (`index.ts:292-293`) — the same pattern used by every other edge function in this project, not anything Studio-specific.

### 4.3 Confirmed real call sites today, already proving the "plain service call" claim

Grep confirms it is already invoked exactly as a generic service call via `supabase.functions.invoke('generate-post-metadata', ...)`:

- `src/stores/SessionStore.js:384` and `:1936` — Generate Studio's own usage (expected, this is where the spec says the function already exists).
- `src/org/services/orgDraftWorkflowService.js:11` (`const METADATA_FUNCTION = 'generate-post-metadata'`) — **org's draft workflow service**, a non-Studio caller, confirming the function is already used outside Generate Studio's own UI tree today. This is direct precedent that Quick Post calling the same function as "a service call, not duplicated logic" (per `CALENDAR_SPEC.md` §6.3) is both architecturally sound and already an established pattern, not a new integration risk.

### 4.4 Net confirmation

`CALENDAR_SPEC.md` §6.3's claim is accurate and verified: `generate-post-metadata` exists, is callable as a plain `supabase.functions.invoke()` service call, supports a no-asset/no-generation/raw-prompt invocation path suited to Quick Post's "pick zero or one Library asset" flow, resolves brand-voice context server-side from the caller's own identity rather than from any client-passed Studio state, and already has a precedent of being called from a non-Studio surface (`orgDraftWorkflowService.js`). Quick Post can call it directly; no Generate Studio file needs to be touched or imported, satisfying Master Brief §0 rule 2's boundary.

One implementation-relevant detail for Phase 3 (not a blocker, just noting precisely what the contract returns): the function both *returns* `{ title, caption, hashtags, summary, ... }` directly in its response **and**, if `post_id` was provided, writes those fields onto the post row itself (`index.ts:358-383`). For Quick Post's "pick zero asset" path there will be no `post_id` yet at caption-generation time (the post doesn't exist until submit), so Quick Post should call with the raw-`prompt` mode (§4.2 path 3) and use the returned fields client-side to populate the composer's editable caption field — it should not expect the function to have written anything to a `posts` row in that mode, since none exists yet to write to.

---

## Summary of recommendations

| # | Question | Recommendation |
|---|---|---|
| 1 | Calendar grid library vs. custom | Keep and refactor the existing custom `MonthGrid.jsx`/`WeekGrid.jsx` into `src/calendar/components/CalendarGrid.jsx`. No grid library in `package.json`; spec's density/grouping rules and the design-system constraint (Master Brief §0.5) make a library adoption a net loss, not a gain. |
| 2 | Touch drag-and-drop | `TouchSensor` (already configured) is necessary for touch-drag to work mechanically, but is **not** a substitute for a separate tap-to-select-then-tap-destination interaction. WCAG 2.2 SC 2.5.7 (Level AA) requires a non-drag single-pointer path for any drag-based function, with calendar rescheduling explicitly not qualifying for the "essential" exception. dnd-kit's own docs confirm they do not address this for touch. `PostPanel.jsx`'s date/time fields are a real but heavier non-drag path; Phase 2 needs a lighter, grid-native tap-select-tap-place mode as a third interaction option. |
| 3 | `generation_id` as grouping key | Confirmed, formally — and confirmed at the database-constraint level (`idx_posts_unique_draft_per_generation_account`), not just convention. One concern flagged: `generation_id` is nullable (Quick Post's own "zero asset" path guarantees null rows), so grouping logic must treat null as "standalone card," never bucket all nulls together. |
| 4 | `generate-post-metadata` for Quick Post | Confirmed exists, confirmed callable as a plain service call independent of Generate Studio UI state (three invocation modes, server-side auth/brand-context resolution), confirmed already called from a non-Studio surface (`orgDraftWorkflowService.js`) as precedent. Quick Post's no-post-yet caption-prefill should use the raw-prompt invocation mode. |

---

## Sources cited

Codebase (file:line / migration name):
- `package.json:27-67`
- `src/pages/CalendarPage/CalendarPageV3.jsx:245-246` (sensor configuration)
- `src/pages/CalendarPage/v3/PostPanel.jsx:419-441` (existing non-drag date/time field path)
- `supabase/migrations/20260227103000_generation_post_unification_and_rls.sql:76-187`
- `supabase/migrations/20260324110000_org_pipeline_tables.sql:28`
- `docs/database-consistency-audit.md:76`
- `docs/PERSONAL_WORKSPACE_SPEC.md:126-139` (§5.4)
- `supabase/functions/generate-post-metadata/index.ts` (full file)
- `src/org/services/orgDraftWorkflowService.js:11`
- `src/stores/SessionStore.js:384,1936`
- `docs/calendar-library-rebuild/packet-1-personal-calendar/AS_IS_AUDIT.md` (Phase 0, cited throughout per task instructions, not re-derived)

External (web):
- [Understanding Success Criterion 2.5.7: Dragging Movements — W3C WAI](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
- [How Do You Meet WCAG 2.5.7 Dragging Movements Requirements? — TestParty](https://testparty.ai/blog/wcag-dragging-movements-guide)
- [WCAG 2.5.7 Dragging Movements: Complete Implementation Guide — AllAccessible](https://www.allaccessible.org/blog/wcag-257-dragging-movements-implementation-guide)
- [Accessibility | @dnd-kit Documentation](https://dndkit.com/guides/accessibility)
- [Dragging with PointerSensor does not work well on touch devices — dnd-kit GitHub Issue #435](https://github.com/clauderic/dnd-kit/issues/435)
- [Understand touch sensor implementation for mobile devices — StudyRaid](https://app.studyraid.com/en/read/12149/389960/touch-sensor-implementation-for-mobile-devices)
- [Top 5 Drag-and-Drop Libraries for React in 2026 — Puck](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react) (consulted for general 2026 library landscape context; did not change the recommendation in §1)
