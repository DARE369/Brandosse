# Mobile/Tablet/Desktop Parity Audit — ui-v2 mockups (Library & Calendar)

Reviewer: `mobile-parity-auditor` (sub-agent of `docs-auditor` / Master Brief §4)
Scope: `library-mockup.html`, `calendar-mockup.html`
Method: static read of both fluid HTML files (no separate mobile build exists —
correct per Master Brief) at three reference widths — mobile ~390px (with a
320–375px stress check), tablet ~768px, desktop ~1440px — cross-checked against
the already-fixed production header (`src/ui-v2/shell/AppHeader.module.css`)
and `src/ui-v2/shell/MobileNavDrawer.jsx`, and against `src/ui-v2/primitives/
IconButton.module.css` for touch-target baselines.

No narrower specialist sub-agent was invoked. The one gesture-heavy feature
(calendar drag-and-drop) was tractable to assess directly by reading the
static markup/JS for a touch-equivalent path (drawer "Reschedule…" → mini-
calendar), so a dedicated touch-gesture reviewer was judged unnecessary. Flagging
this per the one-level-deep rule instead of silently deciding.

---

## Shared finding: both mockups correctly reuse the already-fixed header pattern

Both `.header`/`.app-header` blocks are **byte-identical in their responsive
rules** to the shipped, bug-fixed `src/ui-v2/shell/AppHeader.module.css`:
- `gap`/`padding` shrink at `max-width: 480px`
- `.right`/`.headerRight` gap shrinks at 480px
- `.creditPill`/`.credit-pill` padding shrinks and `gap: 0` at 480px
- `.creditTrack`/`.credit-pill__track` is `display: none` below 480px
- burger swap at `max-width: 900px`, identical breakpoint and markup shape
- mobile nav panel width `min(280px, 84vw)` matches `MobileNavDrawer.jsx` exactly

**Conclusion: neither mockup reinvents the header, and neither is at risk of
regressing the previously-fixed 320–375px overflow bug.** This is not a fix I
needed to make — it's confirmation the mockup authors correctly treated the
production CSS as the source of truth per the file's own header comment
("copied verbatim... do not fork/modify").

One mockup-only artifact, not a real bug: both headers use
`position: sticky; top: 33px` (library) / `top: 27px` (calendar) instead of
production's `top: 0`, to sit below the mockup's own dev-only banner bar. **When
this markup is converted into the real component, that `top` offset must be
dropped back to `0`** — flagging so it isn't copy-pasted into the real CSS by
accident.

---

## Library mockup (`library-mockup.html`)

### MUST-FIX

1. **Bulk-select checkbox is a 22×22px touch target with no larger tap
   region, and mistaps fall through to the wrong action.**
   `.selectCheck` (`docs/.../library-mockup.html:365`) is 22×22px. Outside
   bulk mode it's hidden until `:hover`, which is expected to have no effect
   on touch — that part is fine, since entering "Select" mode (the `Select`
   button in `pageActions`) forces `.bulk-mode` and makes all checkboxes
   visible via a CSS union (`.assetCard:hover .selectCheck, .bulk-mode
   .selectCheck { opacity: 1; }`), so the *feature* is reachable on mobile.
   The bug is **in the JS event wiring**: the select-toggle listener is a
   *capture-phase* listener that only fires `if (!check) return` where `check
   = e.target.closest('[data-select-check]')` — i.e. it only registers a
   selection if the tap literally lands inside that 22px span
   (`docs/.../library-mockup.html:1161-1176`). A tap anywhere else on the
   card in bulk mode falls through to the bubble-phase "open drawer" listener
   instead of selecting the card. On a 170px-wide mobile card (2-col grid at
   375px) a 22px target in the corner is a realistic mistap, and mistapping
   opens the wrong UI (asset drawer) instead of doing the expected thing
   (select for bulk action). Fix: make the entire bottom-left corner of the
   media area (or the whole card, while in bulk mode) the tap target, not
   just the checkbox glyph.

### Suggestions (nice-to-have, not blocking)

2. **List/table view has no mobile-specific row layout.** The table
   (`data-panel="list"`, `docs/.../library-mockup.html:626-644`) is wrapped in
   `overflow-x:auto` with `min-width:720px` — this is *safe* (contained
   horizontal scroll, does not bleed the page) but is a "shrunk desktop
   layout," not a genuine mobile treatment. Grid view (the default) is the
   actually mobile-friendly view, and table is opt-in via the view toggle, so
   nothing is silently lost — but if analytics show real users pick List on
   phones, a stacked-card row variant would be worth it later. Not blocking
   because Grid is default and fully touch-appropriate.
3. Card action row (`Schedule` button + `iconBtn` "More actions") is sized to
   the existing design-system pattern (`btn--sm` ≈ 30px tall, `iconBtn` fixed
   30×30 — matches `src/ui-v2/primitives/IconButton.module.css` verbatim).
   This is below the 44×44px comfortable-touch guideline, but it's the
   established app-wide pattern, not something unique to this mockup — flagging
   as a systemic design-system observation, not a Library-specific regression.
   If it's ever revisited, it should be revisited everywhere at once (Studio,
   Dashboard use the same primitive), not patched only here.
4. `.duplicateWarning` uses a fixed `margin-left: 46px` to visually align
   under the queue thumbnail (`docs/.../library-mockup.html:419`). At ~291px
   of usable modal width on a 375px phone, this leaves ~245px for the warning
   text — it still wraps safely (no overflow), just visually tight. Cosmetic
   only.

### What's genuinely good here (for the record)

- Left rail correctly disappears below 860px and is fully replaced by a
  bottom sheet (`#sheetPanel`) that re-renders the *same* `renderRail()`
  content — no filter functionality is dropped on mobile, only the container
  changes.
- Asset grid moves from `auto-fill(minmax(190px,1fr))` to a fixed, comfortable
  2-column layout below 480px rather than letting cards shrink arbitrarily —
  a deliberate density decision, not an accident.
- Drawer width `min(460px, 94vw)` scales correctly and was checked against
  375px (352px effective) — no clipping.
- Filter row has no fixed-width elements that would force horizontal page
  scroll — `searchBox` uses `flex: 1 1 220px` with a `min-width`, not a fixed
  `width`.

---

## Calendar mockup (`calendar-mockup.html`)

### MUST-FIX

1. **No way to add a post to an empty day cell while in Month view on a
   touch device.** The only affordance for creating a post on an arbitrary
   empty day is the `.month-cell__add` "+" button, which only appears via
   `.month-cell:hover .month-cell__add { display: flex }`
   (`docs/.../calendar-mockup.html:452`) and is explicitly hidden altogether
   below 640px (`.month-cell__add { display: none; }`,
   `docs/.../calendar-mockup.html:618`, with the comment "no hover affordance
   on touch; use the cell tap → palette instead"). That comment describes the
   *intended* fix but it was never implemented: the `.month-cell` `<div>`
   itself has **no `onclick`/tap handler anywhere in the markup** (confirmed
   by grep — only `.month-cell__add` and `.post-pill` have `onclick`). Net
   effect: on a phone, in Month view, tapping an empty day does nothing. The
   cell command palette (AI-recommended slot, "New post", "Ask AI what to
   post", "Generate week plan") is completely unreachable from the grid on
   mobile. Mitigating factor: Month view is not the mobile *default* (see
   "genuinely good" below) and a user can still create a post for an
   arbitrary date via Quick Post's manual date/time fields, so this is not a
   100%-full feature loss — but it is a real, silent regression in the
   specific "tap a day to get contextual options for that day" flow the
   desktop cell palette exists for. Fix: wire the tap handler onto the whole
   `.month-cell`, not just the "+" button, so the button being hover-only is
   irrelevant.

### Suggestions (nice-to-have, not blocking)

2. **Month view remains manually selectable on mobile and its `.post-pill`s
   are sub-30px touch targets.** `.post-pill` (`docs/.../calendar-mockup.html
   :455`) has `padding: 3px 6px` and `font-size: 10.5px` — comfortably under
   the 44px guideline, and there's no mobile-specific pill size bump in the
   `@media (max-width: 640px)` block. Because the mobile *default* view is
   List (see below), most users won't hit this, but the view toggle is still
   present and functional at every width, so a mobile user who deliberately
   picks Month view gets small pills. Given the List default already solves
   the primary UX problem the Master Brief calls out ("full month grid is
   very hard to use on a phone"), I'm not marking this a MUST-FIX, but it's
   worth a follow-up pass if Month-on-mobile turns out to get real usage.
3. `.intel-tip` (the AI tip text at the end of the intelligence strip) is
   `display: none` below 640px (`docs/.../calendar-mockup.html:612`) with a
   comment acknowledging it's "kept simple here" rather than truly relocated.
   It's supplementary/decorative text (the review banner above already
   surfaces the same failed-post information in a more prominent, still-
   visible way), so this isn't a functionality loss, just an honest known
   simplification. Flagging because the comment itself flags it as
   unfinished, not because it's a bug.
4. `.draft-card__move-btn` ("Select to move") has `onclick="event.
   stopPropagation()"` and no further handler wired anywhere in the mockup
   (`docs/.../calendar-mockup.html:1007` etc.) — it's unclear from the static
   mockup alone whether the *intended* real behavior is a tap-to-select-then-
   tap-a-cell touch equivalent for drag-and-drop, or something else. This
   isn't a mobile-parity bug per se (nothing is demonstrably broken — dragging
   itself already has a working equivalent via the drawer's "Reschedule…" →
   Schedule modal mini-calendar), but the mockup should not go to build
   without the frontend-builder knowing what this button is supposed to do on
   both desktop and touch. Recommend the mockup gain an explanatory comment
   or a follow-up spec note before hand-off.

### What's genuinely good here (for the record)

- **Mobile-first default view is a real, working behavior, not just a
  breakpoint-driven grid squeeze.** `applyResponsiveDefaultView()`
  (`docs/.../calendar-mockup.html:1433-1438`) checks `window.innerWidth <=
  640` on load and on resize and defaults to List/agenda view unless the user
  has explicitly picked a view — this directly satisfies the Master Brief's
  concern about full month grids on phones. This is exactly the "defaulting
  to list/agenda view" treatment called out as the good option, and it's
  wired to actually run (not just present in CSS).
- When Month view *is* shown (or manually selected) on mobile, it correctly
  gets horizontal scroll **contained inside the card**
  (`.month-card { overflow-x: auto }`, `.month-header, .month-body { min-
  width: 620px }`, `docs/.../calendar-mockup.html:615-616`), not a page-level
  overflow — header and body cells share the same scroll container so they
  stay column-aligned while scrolling.
- Drag-and-drop (desktop-only interaction) has a genuine, complete touch
  equivalent, not a missing one: every place a drag target exists on desktop
  (dragging a post pill or draft card onto a day) has a parallel tap-driven
  path — tap post pill/draft card → drawer → "Reschedule…" → Schedule modal's
  mini-calendar day picker, all of which work identically via `onclick` at
  every width tested.
- Drafts rail correctly reflows from a vertical resizable tray to a
  horizontal swipeable strip below 640px (`.rail__scroll { flex-direction:
  row; overflow-x: auto }`, `docs/.../calendar-mockup.html:622`) and moves
  above the calendar (`.rail { order: -1 }`) rather than being buried below a
  full month grid — a deliberate, sensible density decision.
- Modals (Schedule, Quick Post, Asset Picker, ⌘K overlay) all use `width:
  100%` inside a padded overlay with a `max-width` cap, verified to fit at
  375px without clipping or requiring horizontal scroll.
- No body text found below 16px-equivalent at the tokens' base (`--uiv2-text-
  base: 0.875rem` = 14px is the *smallest* running-copy size used, which is
  below the Master Brief's 16px body-text floor — see MUST-FIX-adjacent note
  below, since this is systemic to the whole token set, not unique to either
  mockup).

### Cross-cutting note (applies to both mockups equally): body text floor

Both files use the shared `--uiv2-text-base: 0.875rem` (14px) as the
`body` base font size, and most running copy in both mockups (captions,
descriptions, meta rows, field labels) sits at `--uiv2-text-sm` (13px) or
`--uiv2-text-xs` (11.5px) — below the Master Brief's "body text never below
16px" rule, and none of it is fluid via `clamp()`. This is **not something
either mockup introduced** — both explicitly copied the token set verbatim
from `src/ui-v2/tokens.css` ("do not fork/modify"), so the type scale itself
is already baked into the shipped design system before these two mockups
existed. I'm recording it here because the rule is explicit in my brief, but
fixing it means revisiting `tokens.css` globally (affecting every ui-v2
screen already shipped, including Dashboard/Studio), not patching Library or
Calendar in isolation. Recommend a separate, dedicated token-scale decision
before this reaches the human for sign-off, rather than silently accepting
sub-16px body copy as "fine because it matches the rest of the app."

---

## Re-verification pass (2026-07-07)

Re-read the actual applied fixes (not the self-report) for both prior
MUST-FIX items, plus a fresh 320–375px stress check, plus a diff of both
files' mobile-nav drawer against `MobileNavDrawer.jsx`/`Drawer.jsx`. Full
reasoning trail is in `DECISIONS_LOG.md` (2026-07-07T11:49:10Z entry); this
section is the summary.

### Calendar — MUST-FIX #1 (empty-cell tap → Cell Command Palette): CONFIRMED FIXED

`calendar-mockup.html:1559-1565` wires a real delegated `click` listener on
every `.month-cell`, gated to `window.innerWidth <= 640` (no double
affordance on desktop/tablet), excludes taps on `.post-pill` /
`.month-cell__add` / `.month-cell__more` so it doesn't shadow their own
handlers, and opens the same `openCellPalette()` desktop's "+" button
opens. The palette itself (`#cellPaletteAnchor`) lives at document root
(not inside the horizontally-scrollable `.month-card`), so it doesn't
inherit any scroll-offset weirdness, and at a 320px viewport its 260px
width centers with ~30px margin on each side — no clipping. No new issues
found in this area.

### Library — MUST-FIX #1 (bulk-select checkbox touch target): STILL BROKEN — new regression, not the same bug but the same bug class

The checkbox is now correctly wrapped in a real 44×44px `<button
class="selectHit">` (`library-mockup.html:1023`, CSS `:384`). That part of
the fix is right. But the CSS only toggles `opacity` (0 → 1) to reveal it
on hover/bulk-mode (`:385`) — it never sets `pointer-events: none` in the
default state, and `opacity` alone does not stop an element from being
hit-tested. Result: the enlarged 44×44 button is **live and clickable at
all times**, on every card, at every width, not just during bulk-select.
Traced through the actual click-handler chain
(`library-mockup.html:1178-1182` open-drawer listener,
`:1203-1219` select listener): outside bulk mode, a tap landing in that
corner now hits `.selectHit` (a `<button>`), which makes the open-drawer
listener's `e.target.closest('button')` guard bail out — so **nothing
happens at all**. No drawer opens, nothing gets selected, there is no
visible reaction. This is a regression versus the pre-fix state: the old
22px target was a plain `<span>` (not a button), so a mistap outside it
used to fall through to opening the drawer (wrong screen, but a visible
response) — now the same corner, enlarged to 44×44, silently swallows the
tap with zero affordance, and on touch specifically there is no `:hover`
state to ever reveal that this dead zone exists.

**Fix needed** (small, does not require re-doing the approach): add
`pointer-events: none` to the base `.selectHit` rule, and `pointer-events:
auto` alongside the existing `opacity: 1` in the
`.assetCard:hover .selectHit, .bulk-mode .selectHit` union — i.e. only let
the hit target actually receive clicks when it's visible/functional, the
same way `.selectCheck`'s own `pointer-events: none` already protects the
inner visual glyph.

### Mobile nav drawer — no regression in either file

Both `#mobileNavPanel`/`#mobileNavBackdrop` in Library and Calendar use
`width: min(280px, 84vw)`, matching `MobileNavDrawer.jsx`'s own width prop
exactly. Open (burger click) / close (backdrop click, explicit close
button, and the shared close-all-overlays path in Calendar) all wired and
functional. No new fixed-width element introduces a 320–375px overflow
risk. Also independently confirmed both headers' mockup-only `top: 27px` /
`top: 33px` offset (flagged in the first pass as something to drop before
real conversion) has already been corrected to `top: 0` in both files.

### Other 320–375px spot-check findings (no new MUST-FIX)

- Calendar adds a `@media (max-width: 380px)` rule hiding
  `.app-header__wordmark` and the full-length button label text
  (`calendar-mockup.html:644-647`) that Library does not have. This is a
  minor inconsistency between the two files (Calendar is slightly more
  defensive at sub-380px widths than Library), but it's additive/safe, not
  a fix for an actual observed overflow — not blocking, just noting the
  asymmetry in case it should be applied to Library too for consistency.
- Library's header has no equivalent sub-380px rule; a rough tally of its
  fixed-width elements at 320px (`brand` ~109px + `burger` 32px +
  `headerRight` ~136px + padding 24px ≈ 301px of a 320px budget) leaves
  very little slack, but this was already stress-tested and passed in the
  first audit pass (byte-identical to shipped, already-verified
  `AppHeader.module.css`), so not re-flagging as new — just noting it's the
  tightest fit in either file and would be the first thing to check if a
  future width-specific bug report ever comes in.

### Verdict

**MUST-FIX remains** — Library's `.selectHit` fix is incomplete (see above).
Calendar's fix is fully verified and correct. Do not sign off on the
combined packet until Library gets the one-line `pointer-events` correction
and is re-checked.
