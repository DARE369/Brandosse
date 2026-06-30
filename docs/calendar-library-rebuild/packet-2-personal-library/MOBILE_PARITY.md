# Mobile / Tablet / Desktop Parity Report — Packet 2, Phase 2 Mockup Gallery

**Reviewer:** `mobile-responsive-parity-agent`
**Reviewed:** `docs/calendar-library-rebuild/packet-2-personal-library/mockups/mockup-gallery.html` (+ `mockup.css`, `mockup.js`, `tokens.css`).
**Method:** Real headless browser (Playwright/Chromium, already a project dependency at `node_modules/playwright`), served from a local static HTTP server rooted at `docs/calendar-library-rebuild/` (port 8765, confirmed stopped after testing — process killed, only `TIME_WAIT` socket remnants left, no active listener). Measurements are live `getBoundingClientRect()`/`getComputedStyle()` reads against the real DOM at **390×844**, **768×1024**, and **1440×900**, plus genuine touch-device emulation (Playwright `devices['iPhone 13']`, real `hasTouch`/`pointer:coarse`) for every claim about touch behavior — not a CSS-source read or an inspector toggle. Two throwaway driver scripts (`__test_p2_parity.js`, `__test_p2_followup.js`) were written to the repo root during this session and deleted immediately after extracting findings; neither is a deliverable. This is a **fresh, independent review** — no prior `MOBILE_PARITY.md` existed for this packet, and Packet 1's report was used only to calibrate rigor, not as a baseline to assume parity against.

## VERDICT: FAIL — two desktop-only features silently absent on mobile with zero markup fallback, plus a smaller cluster of sub-44px touch targets and one sub-16px body-text instance

The designer's own `DECISIONS_LOG.md` claims are **mostly accurate** (the grid's 2-column mobile floor works exactly as documented and is a deliberate, reasoned density choice; the select-checkbox `@media (pointer: coarse)` always-visible pattern works exactly as claimed; the upload dropzone has a genuine tap-to-browse fallback; the cross-gallery Schedule hand-off link is real and resolves with a live 200). But this review found two findings the designer's log does not mention at all, both of which are exactly the failure mode Master Brief §4 exists to catch: **CSS written for a feature that has no corresponding HTML markup anywhere in the file**, meaning the feature does not exist at any width, and a **left filter rail that disappears below 600px with no replacement UI of any kind** — not a hover-reveal gap, not a density tradeoff, a complete, undocumented feature cut.

---

## 1. BLOCKING — left filter rail (Source/Status: Uploads, Generations, Post-linked, Unused, Archived) disappears below 600px with zero replacement

**Root cause, confirmed against the live DOM, not a CSS-source inference:**

`mockup.css` line 276-279:
```css
@media (max-width: 600px) {
  .lib-rail { display: none; }
  .lib-mobile-rail-toggle { display: flex; }
}
.lib-mobile-rail-toggle { display: none; }
```

This reads as a complete, deliberate pattern: hide the rail, show a mobile-specific toggle in its place. I do not consider this CSS read alone sufficient (per Master Brief §4's "real browser testing, not just an inspector toggle" standard and the explicit instruction not to trust a designer's claim without checking the markup) — so I confirmed live, at 390px:

- `getComputedStyle(.lib-rail).display` → `"none"`. Confirmed hidden.
- `document.querySelectorAll('.lib-mobile-rail-toggle').length` → **`0`**. The class is referenced twice in CSS (the show rule and the base hide rule) but **`grep`-confirmed zero matches in `mockup-gallery.html`** — no button, no element, nothing with this class exists anywhere in the HTML. The CSS rule that's supposed to reveal a replacement control has nothing to reveal.

**Practical consequence:** at 390px (and any width ≤600px, which includes the entire mobile range and parts of small-tablet-portrait), there is **no way to filter by Source (Uploads / Generations / Post-linked) or by Status (Unused / Archived) by count-with-context** — the six `lib-rail__item` buttons (`All 24`, `Uploads 9`, `Generations 12`, `Post-linked 3`, `Unused 7`, `Archived 2`) that are fully present and functional at 768px/1440px (confirmed: rail renders icon-only at 768px between 600-900px width, full rail with labels above 900px) simply vanish on a phone. The only filtering left at 390px is: a free-text search box, a type `<select>` (Image/Video/Document — a different axis entirely), and the single "Unused only" chip — which covers exactly one of the rail's six options and not the other five (Uploads/Generations/Post-linked/Archived/All-with-count have no mobile equivalent at all).

This is precisely the category Master Brief §4 names explicitly: *"No feature present on desktop may simply disappear on mobile. If something must be reorganized for space... that's a layout decision to document, not a feature cut."* No `DECISIONS_LOG.md` entry documents this rail's mobile fate at all — the log's relevant entry (2026-06-25T04:38:00) discusses only the grid's column-count floor, not the rail's disappearance. This is an undocumented cut, not a documented tradeoff.

**Fix required:** either (a) build the missing `.lib-mobile-rail-toggle` as a real control (e.g., a button that opens the rail's six items as a bottom sheet or a horizontally-scrollable chip row, matching the pattern the CSS clearly intended), or (b) fold the rail's six Source/Status options into the existing filterbar as additional chips/a select, so the *capability* survives even if the *presentation* changes. Either is acceptable per §4's "reorganize, don't cut" rule — but something must render at ≤600px where today nothing does.

---

## 2. BLOCKING — `.asset-card__more-trigger` ("⋯" overflow button) is fully styled in CSS but has zero instances in the HTML — a phantom feature

**Root cause, confirmed against the live DOM:**

`mockup.css` defines this element in detail — base styles (lines 383-389), a `:has()`-gated visibility rule (line 392), a 44×44px touch-target enforcement rule (line 577), and a dedicated `::before` hit-pad expansion (lines 580-581) — a level of CSS investment that reads exactly like a real, considered, built feature. But:

- `document.querySelectorAll('.asset-card__more-trigger').length` at 390px, across the entire document → **`0`**.
- Confirmed via direct `grep` of `mockup-gallery.html`: zero matches for `more-trigger` anywhere in the HTML body (only the 5 CSS-side references exist).

This is functionally a dead, no-op feature — CSS that describes a hover/tap-reveal overflow menu trigger that never actually renders, on any card, at any width, because no markup ever instantiates it. It is not a mobile-specific gap (it's equally absent on desktop) but it is squarely in this review's mandate because the task explicitly asked to verify "hover-revealed quick-actions on grid cards are visible-on-tap... don't just trust the claim" — and the claim (implicit in the CSS's thoroughness) does not hold up against the markup. The grid cards' actual, real "more actions" affordance is the three-dot icon button inside `.asset-card__actions` (`aria-label="More actions for..."`), which **does** exist in markup and **does** correctly inherit the `@media (pointer: coarse)` always-visible rule applied to its parent `.asset-card__actions` row (confirmed: opacity `1` under touch emulation, `0` under plain fine-pointer resize as expected) — so the *card's* overflow-action need is actually met by a different, working element. The specific concern is that `.asset-card__more-trigger`'s entire CSS block is orphaned/dead code that should either be wired to real markup or removed, since right now it's indistinguishable, from a CSS read alone, from a working feature.

**Fix required:** either delete the dead CSS (lines 383-392, 580-581) since `.asset-card__actions`'s three-dot button already serves this need, or — if a separate persistent corner-trigger was actually intended as a distinct, always-visible-regardless-of-unused-badge affordance — add the missing markup to every card. Either is a small, mechanical fix; flagging because an unreviewed merge of this CSS as-is into a real component would silently ship inert styles.

---

## 3. Grid view at 390px — card tap-target and mis-tap-adjacency check: PASS

Tested directly, not assumed from the designer's decision-log claim:

- `grid-template-columns` at 390px resolves to `161px 161px` (2 columns, confirmed live) — matches the documented floor exactly.
- Adjacent same-row cards have a real 12px horizontal gap (`gapX: 12`) — no card touches or overlaps its neighbor, so a slightly mis-aimed tap lands on empty gutter, not on the wrong card. This directly answers the task's specific concern #1 ("remain individually tappable... without accidental mis-taps on adjacent cards") — confirmed geometrically, not assumed.
- Card height is non-uniform by content (270px vs. 352px in the same row, from differing tag-row/AI-shimmer content) but this doesn't create any overlap risk since CSS Grid's row-track sizing keeps each card's own bounding box independent; the taller card in a row doesn't encroach into the shorter neighbor's column.
- The select-checkbox (`.asset-card__select`) at 390px under genuine touch emulation: visible chip 26×26px (`min-width/min-height: 44px` rule in CSS sets the *button* itself to 44×44, confirmed live at `visibleW: 44, visibleH: 44` — the CSS's two competing size declarations, the original `width:26px` aesthetic size at line 342 and the later blanket `min-width/min-height:44px` enforcement at line 578, resolve correctly in the real browser with the later rule winning, not silently lost to specificity the way Packet 1's `[hidden]` bug was) plus a `::before { inset: -9px }` hit-pad on top of that, confirmed present. Real, comfortable, exceeds the floor.
- Confirmed via direct touch-emulated `.tap()`: tapping a card opens the real asset detail drawer (`drawerOpenAfterCardTap: true`), and tapping the "Schedule" quick-action button inside a card (73×44px, `opacity:1` under coarse-pointer, no hover needed) correctly opens the real hand-off confirmation modal — both confirmed by actual interaction, not by reading the `@media (pointer:coarse)` rule and assuming it fires.

**This specific named risk from the packet brief ("cards too small to tap accurately... mis-taps on adjacent cards") is genuinely addressed.**

---

## 4. Hover-revealed quick-actions / select-checkbox — `@media (pointer: coarse)` claim: VERIFIED TRUE, with the one caveat already flagged in Packet 1's precedent

Confirmed directly, both ways:
- Plain browser resize to 390px (no touch emulation — i.e., a developer just shrinking a desktop Chrome window, or Playwright's default `viewport`-only page) reports `pointer:coarse = false`, `pointer:fine = true`. Under this condition, `.asset-card__select` and `.asset-card__actions` both compute `opacity: 0` — invisible, no hover trigger exists on a touch surface, so on a hybrid fine-pointer-but-touch-capable device (e.g., some Windows touch laptops with a precision trackpad) these would be undiscoverable without a prior click landing inside `:focus-within`.
- Genuine touch-device emulation (`hasTouch`, real `pointer:coarse`) resolves both to `opacity: 1` — discoverable immediately, no prior interaction needed.

This is the **same caveat** Packet 1's re-test report flagged for its own Move-button opacity pattern (§2 of that report) and judged non-blocking because real phone/tablet hardware (the Master Brief §5 "Solo Sade, phone, on the move" persona) is unaffected — coarse pointer is what real touch hardware reports. I apply the same judgment here for the identical reason and do not block on it, but note it for consistency with how this exact class of finding was scored last packet.

---

## 5. Table view at 390px — horizontal scroll is real, present, and explicitly acknowledged, but is functionally a worse outcome than the brief's own anti-pattern warning suggests it should be

The packet brief names "metadata that requires horizontal scroll" as a named risk to watch for, and the designer's own copy in the gallery (`gallery-section__desc` for `#table-view`) states this was a *deliberate* decision, not an oversight: *"Horizontally scrollable as a deliberate density decision below tablet width, rather than collapsing columns silently."* I verified this claim concretely rather than accepting the stated intent at face value:

- At 390px: `.lib-table-wrap` clientWidth `324px` vs. table's actual rendered width `797px` (`min-width: 760px` in CSS) → `needsHorizontalScroll: true`, confirmed.
- At 768px (tablet): clientWidth `686px` vs. scrollWidth `797px` → **still needs horizontal scroll**, even at the tablet reference width the Master Brief explicitly names as a target breakpoint to get right, not just mobile.
- At 1440px (desktop): no scroll needed (`tableNeedsScrollAt1440: false`) — the table only fits without scrolling at desktop width.
- Confirmed this does **not** leak into page-level horizontal overflow (`document.documentElement.scrollWidth === clientWidth === 390` at the table section) — the scroll is correctly contained to `.lib-table-wrap`, not the whole page. This is the right containment technique, at least.

**Judgment call, made explicitly rather than silently passed or silently failed:** the brief calls horizontal scroll a "known anti-pattern" to check whether it was "avoided or just accepted." Here it is genuinely accepted, not avoided, and accepted at *both* mobile and tablet widths — a wider scope than the brief's phrasing implies should be the norm. I am not blocking on this alone, for the same reason Master Brief §4 itself draws a distinction between a "layout decision to document" and "a feature cut": the table view is explicitly an *alternative*, opt-in, metadata-dense view (the Grid view, which does not have this problem, is the documented default — confirmed `is-active` on the Grid switcher button in markup), and every action available in the table (View, Schedule, per-row select) is also reachable through the parity-clean Grid view. A user is never *forced* into the degraded surface to accomplish a task. This is the same reasoning Packet 1 used to judge its own List/Agenda view's narrower feature set "acceptable, not blocking" when a working alternative existed elsewhere (see Packet 1 report §4b). However, I flag two real sub-issues inside the table that are not acceptable on their own terms:

### 5a. Table-view checkboxes are bare `<input type="checkbox">`, ~13×13px, no hit-pad — fails the 44×44px floor outright
Confirmed via real touch-emulated measurement: `{ w: 13, h: 13 }`. No `::before` expansion, no wrapper, no `min-width/min-height` override anywhere in `mockup.css` for `.lib-table td input[type=checkbox]` or `.lib-table-checkbox-cell input`. This is a real, uncontested touch-target violation, present at every width (it isn't gated behind any breakpoint) — it just matters most on touch hardware, where 13px is roughly a third of the required minimum and checkboxes are notoriously easy to mis-tap even with comfortable targets.
**Fix required:** wrap each checkbox in a 44×44px tap-pad (the same `::before { inset: -Npx }` pattern already used correctly elsewhere in this same file for `.asset-card__select`), or substitute a custom checkbox component sized to the floor, consistent with the floor already enforced (correctly) on every other interactive element in this file via the blanket rule at lines 575-579 — this rule lists `.asset-card__select` and `.asset-card__more-trigger` but conspicuously does not include the table's native checkboxes, which is the direct, traceable cause of this gap.

### 5b. Table-view "View"/"Schedule" action buttons: PASS
Measured directly under touch emulation: `View` 51×44px, `Schedule` 73×44px, consistently across all 4 rows. Both meet the floor with the `.ui-button.sm` class's `min-height: 44px` rule. No issue here.

---

## 6. Asset detail drawer — full-screen takeover at mobile vs. side panel at desktop: PASS on the structural pattern, one touch-target gap inside it

- 390px: drawer width `390px` = `100%` of a `390px` viewport (`pctOfViewport: "100.0"`) — genuine full-screen takeover, confirmed live, not assumed from the `width: 100vw` CSS rule at line 563.
- 768px: also `100%` of viewport — full-screen takeover persists through tablet width, which is the correct call given 440px (the fixed desktop drawer width) would otherwise leave an uncomfortably narrow remaining content gutter at 768px; this is consistent with how the CSS's own breakpoint is written (`@media (max-width: 768px)` triggers full-width, `@media (min-width: 769px)` triggers the fixed 440px side panel) — confirmed the boundary is exact, not approximate.
- 1440px: drawer renders as a genuine side panel, `440px` fixed width = `30.6%` of viewport, leaving the rest of the page visible/dimmed behind the `.drawer-backdrop` overlay — correct desktop pattern.

This directly answers the task's concern #5 ("full-screen takeover vs. cramped side panel") — it is a full-screen takeover at both mobile and tablet, never a cramped side panel squeezed into a narrow viewport. Good.

**The one real gap found inside the drawer:** the four footer action buttons (`Save changes` / `Schedule…` / `Duplicate` / `Delete`) all measure **40px tall**, not 44px, at every width tested (confirmed at 390px: all four report `h: 40`). Root cause: these are plain `.ui-button` (base `min-height: 40px` per line 142 of `mockup.css`), not `.ui-button.sm` (`min-height: 44px`, line 144) — the same `.sm`-modifier distinction Packet 1's re-test report flagged for its own gallery's demo-only buttons, except here it's the **real, primary drawer footer**, not a demo callout, so this is not a "lower-priority, non-product-surface" instance the way Packet 1's was — this is the actual Save/Schedule/Duplicate/Delete row a real user taps on every single asset-detail interaction, on every device, including phones.
**Fix required:** add `.sm`, or otherwise raise `min-height` to 44px, on all four `.lib-drawer__footer .ui-button` instances. Mechanical, one-class-attribute fix per button.

---

## 7. Drag-drop upload — real tap-to-pick-file equivalent: PASS

Directly relevant to the task's concern #3. Confirmed under genuine touch-device emulation:
- The dropzone (`#upload-dropzone`) carries `role="button"`, `tabindex="0"` — keyboard- and AT-reachable, matching the `AssetUploader.jsx` precedent the designer's decision log cites.
- Real `.tap()` on the dropzone (not a `.click()` — genuine touch-event simulation) fires the dropzone's click handler, which calls `fileInput.click()` — confirmed via an injected listener on the real hidden `<input type="file">` (`dropzoneTapTriggeredFileInput: true`). This is a real tap-triggers-native-file-picker path, not a description of one.
- The dropzone measures 350×192px at mobile width under touch emulation — comfortably exceeds the 44×44px floor by a wide margin (it's a large target by design, not just barely passing).
- Drag-and-drop itself (`dragover`/`drop` listeners) is additionally wired for desktop/mouse use, confirmed present in `mockup.js`, and is correctly treated as an enhancement layered on top of the click-to-browse path rather than the only path — exactly the pattern Master Brief §4 asks for ("drag-and-drop... needs a tap-to-select... fallback").

No issue here. This is a clean pass and directly satisfies the task's named concern.

---

## 8. Body text size floor (16px) — mixed; one real violation, several correctly-scoped exceptions

Measured directly at 390px:

| Selector | Rendered size | Classification | Verdict |
|---|---|---|---|
| `.asset-card__title` (`<h4>`) | 13px | Card heading/label, not flowing body prose — same category Packet 1 scoped its `--text-xs` hint text out of the 16px rule | Acceptable, but flagged: see note below |
| `.lib-table td` | 13px | Tabular data cell text — short, scannable metadata values (file type, size, "2d ago"), not a paragraph of body copy | Acceptable on the same "metadata label, not body prose" reasoning, but this is the densest, most-read text in the table view and 13px is genuinely small for sustained scanning |
| `.ui-field-hint` | 11.52px | Secondary/meta hint text under labels — directly comparable to Packet 1's already-adjudicated `--text-xs` hint instance, which that report explicitly exempted from the 16px floor | Exempt, consistent with precedent |
| `.lib-header__title` ("Library") | 14px | Page/section heading, not body text | Exempt — headings are not body text |
| `.upload-queue-item__name` (file name in upload queue) | 13px | Short metadata label (a filename), not body prose | Acceptable on the same reasoning as the table cells |
| `.gallery-section__desc` (this gallery's own explanatory prose, harness chrome) | 14px | **This is body prose** — full sentences explaining each section, meant to be read start-to-finish, in the gallery harness itself (not the simulated product surface) | **Flagged as a real, if low-stakes, violation** |

**The one finding I'm treating as a genuine (if minor) violation:** `.gallery-section__desc` is real, multi-sentence body prose — the explanatory paragraphs under every section heading in this gallery — and it renders at 14px, below the Master Brief's explicit 16px floor, with no `clamp()` fluid scaling applied to it at all (confirmed: `font-size: var(--text-base)` at line 120 of `mockup.css`, a fixed token reference, not a `clamp()` expression). This is gallery-harness chrome rather than the simulated product surface itself (the actual asset-card titles, drawer fields, etc. are reasonably scoped as labels/metadata, not body prose, per the precedent set in Packet 1's own adjudication of similar text) — so I am not blocking the whole review on it, consistent with how Packet 1 treated its own harness-only `.gallery-frame` overflow finding as "tooling chrome, not a product bug." But unlike that overflow finding, this one is a literal, named Master Brief rule ("body text never below 16px... fluid via `clamp()`") being violated in a place a human reviewer is actually reading right now, including every word of this packet's own pitch for why its decisions are sound — worth fixing for the gallery's own credibility, even though it carries no implementation risk for the real Library page.
**Fix required (low priority, non-blocking):** raise `--text-base` or override `.gallery-section__desc` specifically to `clamp(1rem, 0.95rem + 0.3vw, 1.0625rem)` or similar, matching the fluid-type instruction literally.

No other sub-16px body-prose instance was found in the actual product-surface markup (asset card bodies, drawer fields, modal copy) — the drawer's longest prose block, the soft-delete recovery banner (`"This moves the asset to Trash... 30 days..."`), renders inside `.recovery-banner` at `font-size: var(--text-sm)` — I did not measure this one directly in the test pass above and am flagging it as **unverified, not cleared** rather than silently passing it; given the pattern found in `.gallery-section__desc`, the same `--text-sm`/`--text-base` distinction may recur here and should be checked before final sign-off.

---

## 9. Schedule hand-off cross-link — VERIFIED REAL, not just described

Per the task's specific instruction to check this is "a real link out," not a simulated one:
- Confirmed the actual `href` on `#handoff-confirm-link`: `../../packet-1-personal-calendar/mockups/mockup-gallery.html#quick-post`.
- Resolved this relative path against the real served URL and made a genuine HTTP request to it: **`200`**, confirmed live, not assumed from the path string looking correct.
- The link carries `target="_blank" rel="noopener"`, correct practice for a cross-document hand-off that shouldn't strand the user's place in the Library gallery.

This matches the designer's decision-log claim exactly and is a clean pass. The designer's separate, explicit acknowledgment that exact asset-prefill-on-arrival is deferred to Phase 3 (not silently dropped, but named as a documented mockup-fidelity boundary) is the right call and is not a parity issue — it's an implementation-detail deferral, not a missing interaction.

---

## 10. Grid/rail responsive behavior at tablet (768px) and desktop (1440px) — PASS

- 768px: grid renders 3 columns (`197.7px` each), rail collapses to icon-only at 64px width (between the 600px and 900px breakpoints, confirmed exactly at 768px) — a real, working intermediate density tier, not a binary mobile/desktop split.
- 1440px: grid renders 4 columns (`189.9px` each), rail at full 200px width with labels and counts.
- No console errors, no unexpected layout collapse at either width.

---

## 11. Sub-agent decision

I did not invoke a narrower touch-gesture-specialist sub-agent for this review. Every finding above — element-existence checks, computed-style/opacity reads under real `pointer:coarse` emulation, hit-target geometry including `::before` inset parsing, real `.tap()` interaction outcomes, and HTTP-status verification of the cross-link — is a standard DOM/CSS/network correctness check fully within this role's existing toolset (Playwright, already a project dependency), the same class of check Packet 1's reviewer used without a specialist. Nothing here surfaced a genuine gesture-reliability, multi-touch, or sensor-tuning question (e.g., pinch-zoom conflicts, momentum-scroll tuning, palm-rejection) that would need deeper touch-specific expertise beyond computed geometry and event simulation. Flagging this decision explicitly either way, per Master Brief §2's instruction.

---

## Summary table

| # | Finding | Severity | Fix required |
|---|---|---|---|
| 1 | Left filter rail (Source/Status, 6 options) vanishes below 600px; `.lib-mobile-rail-toggle` referenced in CSS but has zero markup instances — no replacement UI exists | **Blocking** | Build the missing mobile rail-toggle control (bottom sheet or chip row), or fold the 6 rail options into the existing filterbar so the capability survives at every width |
| 2 | `.asset-card__more-trigger` fully styled in CSS (base styles, `:has()` visibility gate, 44px enforcement, `::before` hit-pad) but zero instances anywhere in HTML — dead/phantom feature | **Blocking** (correctness/code-hygiene) | Delete the dead CSS, or add the missing markup if a distinct always-visible corner trigger was actually intended beyond the existing working 3-dot button |
| 3 | Grid-card tap-target sizing and mis-tap-adjacency at 390px | Pass | — |
| 4 | `@media (pointer: coarse)` reveal pattern for select-checkbox/quick-actions | Pass (one known, precedented, non-blocking caveat for fine-pointer touch hybrids) | — |
| 5 | Table view requires horizontal scroll at both 390px and 768px | Accepted tradeoff, not blocking (Grid view is the parity-clean default; every table action is reachable elsewhere) | — |
| 5a | Table-view native checkboxes measure ~13×13px, no hit-pad, fails 44px floor at every width | **Blocking** | Add a `::before` hit-pad (pattern already used correctly elsewhere in this file) or a custom-sized checkbox component |
| 5b | Table-view "View"/"Schedule" action buttons | Pass | — |
| 6 | Drawer full-screen takeover (mobile/tablet) vs. side panel (desktop) | Pass | — |
| 6b | Drawer footer buttons (Save/Schedule/Duplicate/Delete) measure 40px, not 44px, at every width — real primary controls, not demo-only | **Blocking** | Add `.sm` modifier (or equivalent) to all four buttons |
| 7 | Tap-to-pick-file equivalent for drag-drop upload | Pass | — |
| 8 | Body text 16px floor | Mostly pass; one real violation in gallery-harness prose (`.gallery-section__desc`, 14px, no `clamp()`); one drawer recovery-banner instance left unverified | Minor / non-blocking for product surface, but should be fixed; recovery-banner text size needs a follow-up check before sign-off |
| 9 | Schedule hand-off cross-link is a real, working click-through | Pass | — |
| 10 | Tablet/desktop grid and rail responsive tiers | Pass | — |

**Net recommendation:** do not forward to human approval yet. The grid view itself — the packet's named highest-risk surface — was handled carefully and mostly passes on its own terms (2-column floor, real mis-tap-adjacency clearance, working coarse-pointer reveal, working tap-to-open). But this review found a complete, silent feature cut (the filter rail) and a phantom feature (the more-trigger) that neither `design-system-compliance-agent`'s nor the designer's own self-check caught, plus two concrete sub-44px touch-target instances (table checkboxes, drawer footer buttons) in real, primary-surface controls — not demo-only chrome. All five blocking items are mechanical, scoped fixes (no redesign required), consistent in size and shape with the kind of fix Packet 1's own re-test cycle resolved before reaching approval. Recommend one more revision pass plus a targeted re-test of items 1, 2, 5a, and 6b specifically (not a full re-review) before this packet's Phase 2 gate is presented to the human.

---

# RE-TEST — 2026-06-25 (Phase 2, fix round 1 verification)

**Reviewer:** `mobile-responsive-parity-agent`
**Reviewed:** `docs/calendar-library-rebuild/packet-2-personal-library/mockups/mockup-gallery.html` (+ `mockup.css`, `mockup.js`, `tokens.css`), as edited by `library-ui-ux-designer`'s "Phase 2 (fix round 1)" pass (see `DECISIONS_LOG.md` entries 2026-06-25T06:00:00 through 06:40:00).
**Method:** Fresh, independent re-test. Real Playwright/Chromium (`node_modules/playwright`, v1.60.0) against a local static HTTP server rooted at `docs/calendar-library-rebuild/`, killed after each run — no lingering listener. Genuine touch-device emulation (`devices['iPhone 13']`, real `hasTouch`/`pointer:coarse`) for every touch-target and tap-interaction claim, plus plain-viewport contexts at 768×1024 and 1440×900 for tablet/desktop checks. Six throwaway driver scripts were written to the repo root during this session (`__retest_p2.js`, `__retest_p2_drawer.js`, `__retest_p2_checkbox.js`, `__retest_p2_desktop_drawer.js`, `__retest_p2_misc.js`, `__retest_p2_banner.js`) and deleted immediately after extracting findings — none are deliverables. This re-test did **not** take the designer's `DECISIONS_LOG.md` claims, or the prior FAIL report's own findings, at face value — every claim below was independently re-measured against the live DOM.

## VERDICT: PASS — all four original blocking items are genuinely fixed; one previously-flagged-but-unverified minor item remains open and is restated here as a clear, scoped non-blocking note

---

## 1. Mobile filter rail toggle (was Blocking #1) — FIXED, verified working end-to-end

- `document.querySelectorAll('.lib-mobile-rail-toggle').length` at 390px → **1** (was 0).
- `getComputedStyle(toggle).display` at 390px → `"flex"`. `getComputedStyle(.lib-rail).display` at 390px → `"none"`. Confirmed the CSS source-order bug the designer's log says it caught and fixed (base `display:none` now precedes the `@media (max-width:600px)` override) — re-verified directly, not re-read from source: the toggle genuinely renders at 390px.
- Real `.tap()` on the toggle opens `#lib-mobile-rail-sheet` (confirmed `hidden` attribute removed, `display` not `none`).
- The sheet contains **exactly the 6 original rail options**, with matching counts: `All 24`, `Uploads 9`, `Generations 12`, `Post-linked 3`, `Unused 7`, `Archived 2` — confirmed via `.textContent()` extraction, not assumed from markup inspection alone.
- Each of the 6 sheet items measures **358×44px** (`boundingBox()` on all six, individually) — comfortably exceeds the 44px floor, no exceptions.
- Functional round-trip confirmed: tapping "Uploads" inside the sheet (a) closes the sheet (`hidden` re-applied), and (b) updates the toggle's own label to read "Uploads 9" — so the current filter selection remains visible after the sheet closes, not just discoverable while it's open.
- Re-confirmed at 768px and 1440px: toggle `display: none`, rail `display: flex` — the toggle is mobile-only as intended, doesn't leak into tablet/desktop.

**All 6 original filter options are genuinely reachable through the mobile toggle, not just "a toggle button exists."** This is a full fix, not a partial one.

---

## 2. Three-dot `.asset-card__actions` button as the "more actions" mobile equivalent (was Blocking #2 — phantom `.asset-card__more-trigger`) — FIXED, and the designer's judgment call independently checked, not taken on faith

- `document.querySelectorAll('.asset-card__more-trigger').length` → **0**, confirmed at 390px. Grepped the live `mockup.css` and `mockup-gallery.html`: the only remaining textual reference to `more-trigger` anywhere in the packet is a single code **comment** (`mockup.css:423`, explaining why the trigger was removed) — zero active CSS rules, zero markup. The dead feature is genuinely gone, not just hidden.
- Independently verified the three-dot button is a real, working equivalent rather than accepting the designer's "judgment call" label at face value:
  - `document.querySelectorAll('.asset-card__actions .ui-icon-button-ghost').length` → **6** (one per visible card).
  - Under genuine touch emulation, `getComputedStyle(threeDotButton).opacity` → `"1"` — visible without hover, confirmed live, not inferred from the `@media (pointer:coarse)` rule's existence.
  - `boundingBox()` → **57.7×44px**. Meets the floor.
  - Carries a real `aria-label="More actions for Studio shot — new arrivals"` — per-asset, not generic.
  - Tapped it directly via `.tap()`: button responds (no JS error), consistent with being a real, live control on the card.
- Conclusion: this is a genuinely working "more actions" affordance, independently confirmed visible-without-hover and ≥44px — not just deferred to the designer's self-report.

---

## 3. Table-view checkboxes (was Blocking #3) — FIXED, confirmed via a real edge tap, not just CSS inspection

- `.lib-table-checkbox-cell` is now applied to **all 4 data-row `<td>`s** as well as the header `<th>` (previously header-only) — confirmed via `document.querySelectorAll('.lib-table-checkbox-cell').length` → 5 (1 header + 4 rows).
- Visible checkbox box unchanged at **13×13px** (no visual regression to the dense table) — this is expected and correct; only the hit area should change, not the visible chip.
- Computed `::before` pseudo-element: `inset: -16px`, confirmed live via `getComputedStyle(el, '::before')`. Computed effective hit area: **45×45px** (13 + 2×16 = 45 on each axis) — exceeds the 44×44px floor with margin.
- **Went further than a CSS-geometry calculation**: dispatched a real `page.touchscreen.tap()` at a point **10px outside the visible 13×13px box** (i.e., squarely inside the claimed-but-unverified expanded zone, not on the visible chip itself) and confirmed the checkbox's `checked` state actually flipped from `false` to `true`. `document.elementFromPoint()` at that exact coordinate resolves to the `<input type="checkbox">` itself. This proves the expanded hit-pad is functionally real, not just present in computed style with no actual hit-testing effect (a real risk with `::before`-based hit-pads, since pseudo-elements don't always participate in hit-testing the way one assumes without checking).

**Confirmed ≥44×44px effective hit area at 390px, and confirmed the expanded zone actually registers taps, not just computes the right numbers on paper.**

---

## 4. Drawer footer buttons — Save / Schedule / Duplicate / Delete (was Blocking #4) — FIXED, confirmed 44px at all three reference widths via real card-tap-to-open flows

- Confirmed `.ui-button.sm` computes to `min-height: 44px` in the live `mockup.css` (base `.ui-button` is 40px, `.sm` modifier raises it to 44px) — matches the designer's claim, independently re-checked at the source rather than assumed.
- All four footer buttons (`Save changes`, `Schedule…`, `Duplicate`, `Delete`) carry the `.sm` class in markup — confirmed via direct read of `mockup-gallery.html:920-925`.
- Opened the real asset detail drawer via a genuine card tap/click (not a JS-forced `hidden` removal) at all three reference widths and measured the footer buttons live:
  - **390px** (touch-emulated): all four buttons measure **44px tall**.
  - **768px** (plain viewport, mouse click): all four measure **44px tall**.
  - **1440px** (plain viewport, mouse click): all four measure **44px tall**.
- Note on method: an earlier combined test script in this same session produced a false "card tap doesn't open the drawer" result; isolating the test confirmed this was a test-script artifact (a stale bottom-sheet-adjacent interaction state from an earlier step in the same combined script, plus an incorrect JS fallback that tried to unhide `.lib-drawer` instead of its actual backdrop parent `#asset-drawer-demo`), not a real product bug — re-run in isolation, a plain tap/click on a fresh page genuinely opens the drawer every time, at every width, with no JS workaround needed. Flagging this explicitly so the "all four buttons measure 44px" finding is understood to rest on a real, organic open-the-drawer flow, not a forced one.

**All four buttons confirmed ≥44px tall at 390/768/1440px, opened via real interaction, not synthetic state manipulation.**

---

## 5. Regression check — no new defects introduced by this fix round

- **Duplicate-ID check:** 44 total `id` attributes in `mockup-gallery.html`, 44 unique — zero duplicates (the new `#lib-mobile-rail-sheet` and its children did not collide with any existing ID).
- **HTML tag balance:** re-checked open/close counts for `div`, `section`, `nav`, `aside`, `button`, `article`, `table`, `thead`, `tbody`, `tr`, `td`, `th`, `main`, `header`, `footer`, `label`, `svg`, `select`, `option`, `span`, `p`, `h1`–`h4`, `a` — all balanced, zero mismatches.
- **CSS brace balance:** 296 open / 296 close in `mockup.css` — balanced.
- **Dead-code check on the `.asset-card__more-trigger` removal:** confirmed zero remaining references anywhere in the packet except the one explanatory code comment — the designer's "delete it entirely" fix did not leave any dangling selector, and nothing else in the file depended on that class (no `:has()` parent rule elsewhere references it, no JS in `mockup.js` queries for it).
- **Cross-link to Packet 1 (regression check, since this was a separate PASS item in the original review and a fix round touching the same CSS file is exactly the kind of change that could silently break something unrelated):** re-verified live, `href="../../packet-1-personal-calendar/mockups/mockup-gallery.html#quick-post"` resolves with a genuine HTTP **200**. Unaffected by this fix round.
- **Console/page errors:** zero, at 390px (touch-emulated) and at a plain desktop viewport, across the full interaction sequence (rail sheet open/select/close, three-dot tap, table checkbox tap, drawer open via card tap).
- **`--radius-2xl` regression check:** zero remaining references anywhere in `mockup-gallery.html` or `mockup.css` — the Fix 1 (design-system) correction from the same round held; confirmed independently as part of this pass even though it's `design-system-compliance-agent`'s primary territory, since this re-test re-served and re-rendered the whole file anyway.

**No regressions found.**

---

## 6. Fix 6 (`.gallery-section__desc` clamp) — re-verified, holds

Not one of the 4 blocking items but re-checked anyway since it's cheap and the file was already open: `font-size` at 390px → **16.37px** (was 14px); at 1440px → **17px**. Both ≥16px. The fluid `clamp()` claim holds at both tested extremes.

---

## 7. Open item carried forward, NOT one of the designer's claimed fixes — `.recovery-banner` body text still below the 16px floor

The original FAIL report's §8 explicitly flagged this as **"unverified, not cleared"** rather than silently passing it, and noted it should be checked "before final sign-off." This fix round's `DECISIONS_LOG.md` entry for Fix 6 only addresses `.gallery-section__desc` — the recovery-banner text is not mentioned anywhere in the fix-round log, meaning it was never actually checked or fixed.

Independently measured this re-test: `.recovery-banner span` — real, multi-sentence body prose inside the real soft-delete confirmation modal ("This moves the asset to Trash, not a permanent delete. You can recover it from Trash for 30 days — after that it's gone for good.") — renders at `font-size: var(--text-sm)` = **13px** at 390px, confirmed live. No `clamp()`. This is a genuine, real-product-surface (not harness-chrome) instance of body prose below the 16px floor, on a screen a user sees immediately before confirming a destructive action.

**This is a new finding for this report (carried forward from an unresolved loose end in the original), not a re-opened item** — it was never claimed fixed, so it isn't a regression, but it should not be silently dropped just because the designer's fix round didn't happen to touch it. Scoring this **non-blocking** for the same reason `.gallery-section__desc` was originally scored non-blocking (real product surface text, same severity class, one component, mechanical fix, does not affect feature parity or touch-target geometry) — but it should be fixed before this packet's final human sign-off, not deferred indefinitely. **Fix suggested:** apply the same `clamp(1rem, 0.95rem + 0.3vw, 1.0625rem)` pattern used for `.gallery-section__desc`, scoped to `.recovery-banner` (and audit any other `.ui-field-hint`/`--text-sm`-styled real-sentence prose elsewhere in the modals for the same gap — the table-cell and card-label `--text-sm`/`--text-xs` instances remain correctly exempt as metadata labels, per the original report's §8 reasoning, which still holds).

---

## Summary table — re-test

| # | Original finding | Status now | Verified by |
|---|---|---|---|
| 1 | Filter rail vanishes below 600px, phantom toggle class | **FIXED** | Real toggle renders at 390px only, opens sheet with all 6 options/counts, tap-to-select closes sheet and updates label, confirmed absent at 768/1440px |
| 2 | `.asset-card__more-trigger` phantom CSS | **FIXED** | Zero remaining references (1 comment only); three-dot button independently confirmed visible-without-hover, ≥44px, real `aria-label`, responds to tap |
| 3 | Table checkboxes ~13×13px, no hit-pad | **FIXED** | `::before inset:-16px` confirmed live; real edge-tap 10px outside the visible box flips `checked` state — hit-pad is functionally real, not just computed |
| 4 | Drawer footer buttons 40px not 44px | **FIXED** | `.sm` class confirmed on all 4 buttons; measured 44px tall at 390/768/1440px via real card-tap-opened drawers (not JS-forced) |
| 5 (non-blocking, original) | `.gallery-section__desc` 14px, no clamp | **FIXED** | 16.37px at 390px, 17px at 1440px, both ≥16px |
| New (carried forward, unresolved) | `.recovery-banner` body prose at 13px (`--text-sm`), no clamp — flagged "unverified" in original report, never addressed by this fix round | **Open, non-blocking** | Confirmed live at 390px: 13px. Real body prose in a real destructive-action confirmation modal. Recommend fixing before final human sign-off, same pattern as the already-fixed `.gallery-section__desc`. |
| — | Regressions from this fix round (duplicate IDs, tag/brace balance, dead-code leftovers, cross-link, console errors, `--radius-2xl`) | **None found** | Direct re-measurement, not re-reading prior claims |

**Net recommendation: this mockup is CLEARED on mobile/tablet/desktop parity grounds.** All four original blocking findings are genuinely, independently confirmed fixed — not just claimed fixed — through real touch-emulated interaction at 390/768/1440px, not source-code inspection alone. One small, pre-existing, non-blocking text-size gap (`.recovery-banner`) remains open and was not part of this fix round's scope; it does not block this packet from proceeding, but should be swept up in the same pass as any other final-polish item before the human approval gate, since it's the same rule (16px body-text floor) the gallery's own prose was already held to and fixed.
