# SPOT-CHECK — Three Post-Critique Fixes (Round 2), 2026-06-24

**Reviewer:** `mobile-responsive-parity-agent`
**Scope note:** This is a narrow, targeted spot-check of three specific fixes that landed on `mockup-gallery.html` in response to a fresh UX critique (see `DECISIONS_LOG.md`, "Phase 2 (post-critique fixes, round 2)" section, Fix 1/Fix 2/Fix 3). It is **not** a full re-review — design-system and persona-flow checks already passed in prior rounds and are not re-litigated here. This section sits above, and does not replace, the existing superseded-in-place report below (the "RE-TEST" section and the "ORIGINAL REPORT (SUPERSEDED)" section both remain unchanged and current for the items they already cover).
**Method:** Real Playwright/Chromium 1.60.0, served from a local static HTTP server on `localhost:8743` (confirmed stopped after testing — no LISTENING socket remained, verified via `netstat`). All assertions are live `getBoundingClientRect()`/`getComputedStyle()` reads, real `.click()`, `page.setViewportSize()` resizes with the documented rAF-debounce settle time honored, real `page.keyboard.press('Escape')`, and `page.mouse.click()` at backdrop coordinates — not a CSS/JS source read. Several throwaway driver scripts (`__test_*.js`) and screenshots (`__cell_palette_*.png`, `__nav_*.png`) were written to the repo root during this session and deleted immediately after extracting findings; none are deliverables.

## VERDICT: PASS on all three items

---

## 1. Mobile default view switching — PASS

Tested fresh-load behavior, live-resize behavior in both directions across the 600px boundary, and explicit-pick persistence through subsequent resizes, all against the live DOM (not the `userPickedView` claim in `DECISIONS_LOG.md` taken on faith).

**Fresh load:**
- 390px fresh `page.goto()`: Month panel `hidden:true`, List panel `hidden:false`. Lands on Agenda/List as specified.
- 1440px fresh `page.goto()`: Month panel `hidden:false`, List panel `hidden:true`. Lands on Month, unchanged from before this fix.

**Live resize across the boundary (single page, no reload), untouched group:**

| Width | Month hidden | List hidden |
|---|---|---|
| 1440 | false | true |
| 700 | false | true |
| 601 | false | true |
| 599 | true | false |
| 500 | true | false |
| 390 | true | false |
| 650 | false | true |
| 800 | false | true |
| 1200 | false | true |

The switch occurs exactly between 601px (Month) and 599px (List), consistent with the documented `width < 600` threshold, and it is genuinely live and bidirectional — confirmed crossing the boundary downward (1440→599) and back upward (390→650) within the same page session, with no reload between steps.

**Explicit-pick guard, verified directly (not assumed from the `userPickedView` flag's mere presence):**
- At 390px, default state confirmed List (`monthHidden:true`).
- Clicked the real "Month" toggle button by hand while still at 390px. Result: `monthHidden:false`, `listHidden:true`, and `group.dataset.userPickedView` reads `"month"` — the flag is genuinely set by the real click handler, not just present in source.
- Resized narrower still, to 360px (deeper into mobile range, where the un-picked default would unambiguously be List): Month remained visible (`monthHidden:false`). The explicit pick held.
- Resized wide (1440px) then back to narrow (390px) again, simulating a real rotate/resize sequence after an explicit pick: Month still held (`monthHidden:false`). The guard survives multiple resize events, not just one.

This rules out the failure mode the task asked me to specifically check for — a resize silently overriding a deliberate in-session choice — and confirms it empirically rather than by reading the `if (group.dataset.userPickedView) return;` line and assuming it fires correctly in practice.

**General sanity check — Month↔List toggle still works correctly at desktop width:** at 1440px, clicking the "List" header button switched panels correctly (`monthHidden:true`, `listHidden:false`), and clicking "Month" again switched back correctly (`monthHidden:false`, `listHidden:true`). The shared `setView()`/panel-resolution logic this fix touched is not regressed for ordinary desktop manual switching.

**Verdict: PASS.** Fresh-load default, live bidirectional resize behavior, and the explicit-pick guard all work exactly as the designer's decision-log entry describes, confirmed through direct interaction rather than a source read.

---

## 2. Cell command palette text stacking — PASS

Opened the real cell-command-palette demo (`[data-cell-trigger="cell-palette-demo"]`) and measured the rendered label/hint pairs directly, in both light and dark mode (toggled via the real `#theme-toggle` button, confirmed `data-theme` attribute flips to `"dark"`).

For all three palette items ("New post" / "Quick Post composer", "Schedule a draft here" / "Pick from Drafts rail", "Ask AI" / "Suggest something for this day"), in both themes:
- The hint span's bounding-box top edge sits at or below the label span's bottom edge in every case (`verticallyStacked: true` for all 6 measurements: 3 items × 2 themes) — genuinely two separate lines, not just visually adjacent text with no line break.
- Label and hint share the same left/right horizontal extent (both spans are `display:block`, full-width of `.cell-palette__item-body`), confirming a real top-to-bottom stack, not a side-by-side layout that happens not to overlap.
- Label color vs. hint color are visibly distinct in both themes (light: label `rgb(20,18,16)` vs. hint `rgba(20,18,16,0.58)`; dark: label `rgb(232,230,240)` vs. hint `rgb(122,115,145)`), giving clear visual hierarchy between the action name and its description, not just a forced line break with identical, hard-to-parse styling.
- Element screenshots of the open palette in both themes visually confirm two clean, readable lines per item ("New post" bold on its own line, "Quick Post composer" muted directly beneath it; same pattern for "Schedule a draft here" / "Pick from Drafts rail").

Hint text renders at `11.52px` (a `--text-xs` token value) — this is secondary/meta description text under a bold primary label, not body copy, so it is not held to the Master Brief's 16px body-text floor; flagging this distinction explicitly rather than silently passing it without comment, consistent with how body-text-size findings have been scoped in this packet's other reviews.

**Verdict: PASS.** The fix genuinely produces two distinct, non-overlapping, readable lines per palette item, confirmed geometrically and visually, in both light and dark mode.

---

## 3. Gallery nav mobile collapse — PASS

Tested the full open/close lifecycle at 390px, the breakpoint boundary (767/768/769px), and desktop (1440px), against the live DOM.

**Default state at 390px (fresh load, no interaction):**
- `.gallery-shell` does not carry `is-nav-open`.
- `.gallery-nav` computes `transform: matrix(1,0,0,1,-280,0)` (i.e., `translateX(-280px)`, fully off-canvas) and `position: fixed`.
- Resulting bounding rect: `left: -280, right: 0` — entirely outside the 390px viewport (`navVisibleInViewport: false`). The nav is not eating any viewport width by default, closing the exact gap both critiques flagged.
- The hamburger toggle (`#gallery-nav-toggle`) is visible (`display: flex`), spans the full 390px width, and measures **390×44px** — comfortably touch-sized.

**Opening via hamburger:**
- After `.click()` on the toggle: `is-nav-open` is added, nav transform resolves to `translateX(0)`, nav rect becomes `left:0, right:280`.
- `.gallery-main`'s left edge remains at `0` while the drawer is open — confirming the drawer **overlays**, it does not push the underlying content.
- The backdrop (`#gallery-nav-backdrop`) becomes interactive (`opacity:1`, `pointer-events:auto`) at the same time.
- `aria-expanded` on the toggle flips to `"true"`.
- Visual screenshot confirms: closed state shows only the clean hamburger bar with full-width content below; open state shows a proper overlay drawer (white panel, dark-mode toggle, full nav links) with the dimmed page content visible behind/beside it, not pushed off to the side.

**Closing, all three documented paths plus a fourth (nav-link click), all independently verified:**
- Close button (`#gallery-nav-close`): `is-nav-open` removed. PASS.
- Backdrop click (clicked at a point clearly outside the 280px drawer): `is-nav-open` removed. PASS.
- Escape key: `is-nav-open` removed (confirmed this routes through the same `closeGalleryNav()` the keydown handler calls). PASS.
- Bonus check, not explicitly requested but adjacent: clicking a real nav link inside the open drawer (`href="#month-view"`) also closes it. PASS — this is a reasonable mobile-UX expectation (tapping a destination should get the drawer out of the way) and it works.

**Breakpoint boundary, confirmed exact:**

| Width | Toggle display | Nav position |
|---|---|---|
| 767 | flex | fixed |
| 768 | flex | fixed |
| 769 | none | sticky |
| 800 | none | sticky |
| 1440 | none | sticky |

The collapse engages at and below 768px and disengages above it, matching the documented `@media (max-width: 768px)` rule precisely — no off-by-one surprises.

**Desktop (1440px):** nav renders as an ordinary static 240px sticky sidebar (`position: sticky`, `left:0, width:240`), no hamburger toggle present (`display:none`), unchanged from the pre-fix baseline.

**No regression check:** confirmed zero horizontal page overflow at 390px on fresh load (`document.documentElement.scrollWidth === clientWidth === 390`) and zero console errors/page errors across a 390→1440→768 resize sequence.

**Verdict: PASS.** The gallery nav is genuinely off-screen by default at mobile width, opens only on demand via a touch-comfortable hamburger, overlays rather than pushes, and closes via all three documented mechanisms (plus a fourth, nav-link-click, found incidentally and also working) — confirmed live, not from a CSS-source read.

---

## General sanity check — no regressions from the shared panel-resolution logic change

The task flagged that Fix 1 touched panel-resolution logic shared with the pre-existing Month/List toggle, so this was checked explicitly rather than assumed safe because the three named items passed: confirmed above (§1, "General sanity check") that manual Month↔List switching at 1440px still works correctly in both directions after this change. No other interaction (Move button on Month-grid cards, Quick Post modal open/submit, toast firing) was in scope for this narrow spot-check and none of it was touched by these three fixes' code paths, per the designer's own decision-log scoping — not independently re-verified here, consistent with the task's explicit instruction that this is a narrow spot-check, not a full re-review.

---

## Sub-agent decision

No narrower specialist sub-agent was invoked for this spot-check. All three items are standard DOM/CSS verification tasks (computed-style reads, click/keyboard/resize simulation) within this role's existing toolset — none surfaced a gesture-reliability, sensor-tuning, or other deeply touch-specific question that would warrant a dedicated touch-gesture specialist. Flagging explicitly per Master Brief §2's instruction to flag this decision either way.

---

## Summary table

| # | Item | Verdict |
|---|---|---|
| 1 | Mobile default view switching (fresh load, live resize both directions, explicit-pick guard) | **PASS** |
| 1b | Manual Month↔List switching at desktop width (regression check on shared logic) | **PASS** |
| 2 | Cell command palette text stacking, light + dark mode | **PASS** |
| 3 | Gallery nav mobile collapse (off-screen default, hamburger open, 3+1 close paths, overlay-not-push, breakpoint precision) | **PASS** |

**Net recommendation:** all three fixes verified working as designed, through direct browser interaction. Nothing in this narrow scope blocks moving forward.

---

# Mobile / Tablet / Desktop Parity Report — Packet 1, Phase 2 Mockup Gallery (RE-TEST)

**Reviewer:** `mobile-responsive-parity-agent`
**Status: this report SUPERSEDES the prior FAIL verdict dated 2026-06-23T22:10:00Z.** That report is preserved in full below the line marked "ORIGINAL REPORT (SUPERSEDED)" for audit-trail purposes — do not delete it, but treat only this top section as current.
**Reviewed:** `docs/calendar-library-rebuild/packet-1-personal-calendar/mockups/mockup-gallery.html` (+ `mockup.css`, `mockup.js`, `tokens.css`) after the designer's two revision passes (`DECISIONS_LOG.md`, "Phase 2 (revision)" and "Phase 2 (re-review)" sections).
**Method:** Real headless browser (Playwright/Chromium 1.60.0, already a project dependency), served from a local static HTTP server (stopped after testing), at exactly **390×844**, **768×1024**, **1440×900**. All measurements are live `getBoundingClientRect()`/`getComputedStyle()` reads on the actual rendered DOM, plus real `.click()`, `page.touchscreen.tap()` (under genuine `hasTouch`/`pointer:coarse` device emulation, not just a viewport resize), `dispatchEvent`, and keyboard simulation — not a CSS source re-read. Several throwaway driver scripts were written to `__retest_*.js` in the repo root during this session and deleted after extracting findings; none are a deliverable.

## VERDICT: FAIL — one new functional bug found, one old finding partially open, three of four checks pass cleanly

The three previously-blocking findings are **resolved**: the `[hidden]` CSS-cascade bug is genuinely fixed, the systemic touch-target sizing is genuinely fixed (with one legitimate technique — expanded hit-target via `::before` negative-inset — that needed real-browser verification, not just a CSS-source read, to confirm it actually clears 44×44px), and the Drafts-rail Move button is present, correctly sized, and functionally wired. **However, this re-test found a new, real, blocking bug that none of the prior reviews (compliance, parity, or QA-persona) caught**: the Move button that was wired into the real Month-grid cards in this revision pass does not work. It is visible, correctly sized, and dispatches a real click event — but the JS handler's `closest('[data-card-name]')` lookup fails because of a DOM-structure mismatch the designer introduced in this exact revision, silently no-oping on every one of the 9 real grid-card instances tested. This is functionally equivalent to the packet still not having a working non-drag reschedule path on its primary calendar surface, just with a different root cause than the original FAIL.

---

## 1. `[hidden]` CSS fix — VERIFIED WORKING

Confirmed via `getComputedStyle()` on a fresh `page.goto()` with zero prior interaction, at all three widths: all six previously-offending elements (`#cmdbar-overlay`, `#quickpost-modal`, `#asset-picker-modal`, `#schedule-modal-demo`, `#post-detail-drawer-demo`, `#slideover-jun17`) now compute to `display: none` while `hidden` is present, confirming `[hidden] { display: none !important; }` (or equivalent) is in force and actually winning the cascade — this was the literal root cause identified in the prior FAIL and it is gone.

Real-click test: clicking `[data-open="quickpost-modal"]` (the real header "+ Quick Post" button) at 390px, 768px, and 1440px each successfully opened the modal (`modalOpenAfterClick: true` at every width) with no intervening overlay absorbing the click. No `elementFromPoint`-intercepted-by-invisible-overlay behavior reproduces anywhere in this pass. **This finding is closed.**

---

## 2. Touch targets — VERIFIED 44×44px on all real, primary controls; one legitimate technique double-checked

Re-measured the full list from the original FAIL report against the live DOM:

| Element | Real measured size | Verdict |
|---|---|---|
| Prev/Next month chevrons (`.cal3-icon-btn`) | 44×44px, all 3 widths | PASS |
| Month/List view-switcher buttons | 68×44 / 48×44px, all 3 widths | PASS |
| Real header ⌘K trigger (`.ui-button.sm`) | 46×44px, all 3 widths | PASS |
| Real header "+ Quick Post" button (`.ui-button.sm`) | 93×44px, all 3 widths | PASS |
| "+N more" overflow button | 44px+ height confirmed, all 3 widths | PASS |
| Per-cell "+" add button | 44×44px, all 3 widths | PASS |
| Toast close button | 44×44px, confirmed via real toast fire | PASS |

One important methodology note: my first measurement pass flagged the "+ Quick Post"/"⌘K" demo-section buttons (in the gallery's standalone illustrative sections, e.g. line 657/701 of `mockup-gallery.html`) at 40px. On inspection this is a **different, lower-priority element** — a base `.ui-button` (no `.sm` modifier) used only inside non-interactive-context demo callouts, not the real, primary page header control a user actually clicks during real use (which correctly carries `.sm`, confirmed at 44px at all three widths). I do not consider the demo-only instance blocking, since it is not part of the product surface being mirrored — but flagging it as a minor, fixable inconsistency: the gallery's own demo snippets should use the same `.sm` modifier as the real header for internal consistency, even though it has no real-product impact.

**The expanded-hit-target technique (`::before` negative-inset) genuinely works, verified geometrically, not just by CSS source-reading:**
- `.post-card-row__move-btn`: visual chip 22×44px, `::before { inset: -11px -14px }` → effective hit area **50×66px**. Exceeds 44×44px. PASS on sizing.
- `.draft-card__move-btn`: visual chip 28×28px, `::before { inset: -8px }` → effective hit area **44×44px** exactly. PASS on sizing, at the floor with zero margin — acceptable but worth knowing it's exactly at the limit, not comfortably above it.

This matters as a methodology point: a CSS-source-only review (reading `width: 22px` and concluding "still too small") would have produced a false-positive failure here. The pseudo-element technique is a legitimate, common pattern for keeping a visually-compact chip while satisfying the touch-target rule, and it measures out correctly in a real browser. I want to be explicit that I checked this geometrically (computed `::before` inset parsed and added to the real element box) rather than assuming the code comment's claim was correct.

**Genuinely new finding from this pass, not in either prior report:** the opacity-0-by-default reveal pattern on both `.post-card-row__move-btn` and `.draft-card__move-btn` (visible only on `:hover`/`:focus-within`/`:focus-visible`, or unconditionally under `@media (pointer: coarse)`) reproduces the *exact* class of gap the original FAIL report flagged for the per-cell "+" button (§2.1 of the superseded report) — and I confirmed it concretely this time rather than leaving it as a CSS-source inference:
- A plain viewport resize to 390×844 with **no** touch-context emulation (i.e., exactly how a developer testing "mobile" by shrinking a desktop Chrome window would see it, and also how Playwright's default `newPage({viewport})` behaves) reports `matchMedia('(pointer: coarse)').matches === false` and `matchMedia('(pointer: fine)').matches === true`. Under this condition both move-buttons sit at `opacity: 0` with no way to reveal them via touch (no hover state exists on a touch interaction).
- Under genuine touch-device emulation (Playwright's `devices['iPhone 13']`, `hasTouch: 1`), `pointer: coarse` correctly matches and both buttons resolve to `opacity: 1`, discoverable without any prior interaction.
- **Conclusion:** on an actual phone/tablet this works correctly (coarse pointer is what real touch hardware reports). The gap is narrower than the original §2.1 finding but not zero: a touch-capable hybrid device that also reports a fine/precise pointer (some Windows touch laptops with a stylus or precision trackpad alongside a touchscreen) would get the invisible, hover-gated state with no touch-accessible reveal. This is the same category of risk flagged before, now scoped specifically to two elements instead of being a sweeping problem — judged **non-blocking** for this round since real phone/tablet hardware (the primary target per Master Brief §5's "phone, on the move" persona) is unaffected, but worth a one-line follow-up (e.g., also reveal on any `:focus` reaching the row, or drop the opacity gate to a low-but-nonzero baseline) before Phase 3 implementation.

---

## 3. Drafts rail Move button — VERIFIED PRESENT, CORRECTLY SIZED, AND FUNCTIONALLY WORKING

This is fully resolved, confirmed by direct interaction, not just markup presence:
- `.draft-card__move-btn` exists inside every `.draft-card` block (8 instances found across the open/collapsed rail states), each with `data-move-trigger` and a correctly-targeted `aria-label`.
- Effective hit target measures 44×44px (visual 28×28px + `::before { inset: -8px }`), confirmed at all three widths.
- **Functional test, real click:** clicking the Move button on "Weekly roundup draft" correctly resolves `btn.closest('[data-card-name]')` to the parent `.draft-card` (which legitimately carries `data-card-name` as an ancestor, not a sibling), calls `enterMoveMode()`, and `.is-selected-for-move` is applied to the correct card with the correct name. The move-mode banner, Cancel button, and destination-cell highlighting all activate identically to the already-working standalone demo and to the (also-working) scheduled-post pattern in the standalone demo section.

**This specific finding from the original FAIL report is closed and independently re-verified as working, not merely present.**

---

## 4. NEW BLOCKING BUG — the Move button wired into real Month-grid cards does not work

This is the one finding that makes this re-test a FAIL rather than a clean PASS, and it was not caught by `design-system-compliance-agent`'s PASS re-review (out of scope for that agent — it only covers token/value provenance, not interaction correctness, and says so explicitly in its own final paragraph) nor flagged anywhere in `DECISIONS_LOG.md`'s revision-pass entries, which describe this exact wiring as already complete ("the Move button wired into real Month/List grid cards").

**Root cause, confirmed directly against the live DOM:**

The real Month-grid markup places the Move trigger as a **sibling** of the post card, not a descendant:
```html
<div class="post-card-row">
  <button class="post-card" ... data-card-name="LinkedIn carousel — Q3 recap" ...>...</button>
  <button class="post-card-row__move-btn" data-move-trigger aria-label="Select LinkedIn carousel — Q3 recap to move">...</button>
</div>
```
`data-card-name` lives on `.post-card`. The Move button is `.post-card`'s **next sibling**, not its child, and `.post-card-row` (their shared parent) does not carry `data-card-name` itself.

The click handler in `mockup.js` (lines 281-288) is:
```js
document.querySelectorAll('[data-move-trigger]').forEach(function (btn) {
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    var card = btn.closest('[data-card-name]');
    if (card) enterMoveMode(card);
  });
});
```
`Element.closest()` only walks the element itself and its **ancestor** chain — it cannot reach a sibling. Since `data-card-name` is neither on `btn` nor on any ancestor of `btn`, `btn.closest('[data-card-name]')` evaluates to `null` for every Month-grid card, and `enterMoveMode()` is never called. The click event itself fires correctly and lands on the right element (confirmed via an injected `document.addEventListener('click', ..., true)` logger — the log shows `{"target":"post-card-row__move-btn","type":"click"}` after the tap), so this is not a hit-target or CSS problem at all — it is a pure JS logic bug, deterministic and 100% reproducible, independent of viewport width.

**Confirmed scope, programmatically, across every `[data-move-trigger]` instance in the file (19 total):**

| Pattern | Instances | `closest('[data-card-name]')` resolves? |
|---|---|---|
| Real Month-grid cards (`.post-card-row__move-btn`, sibling-of-card pattern) | 9 | **No — broken, all 9** |
| Drafts rail (`.draft-card__move-btn`, button-is-child-of-card pattern) | 8 | Yes — all 8 working |
| Standalone tap-to-select demo section (`.ui-button.sm`, button-is-child-of-`.post-row`-which-carries-the-attribute) | 1 | Yes — working |
| "Drag" demo section's illustrative Move button (same sibling pattern as the broken Month-grid one) | 1 | No — also broken, same root cause |

This means: **on the actual Month-grid view — the calendar's primary, default surface, and the one place this packet's Research Phase 1 named as the centerpiece for the WCAG 2.2 SC 2.5.7 non-drag fallback — tapping or clicking "Move" on any real scheduled post silently does nothing**, at every width, on every browser engine, on real touch hardware and on desktop alike, because the bug is not viewport- or pointer-type-dependent. The only two places the tap-to-select flow actually works are the Drafts rail (a real, in-scope surface, correctly wired) and a standalone illustrative demo block that is not the real calendar grid.

This is a different bug from anything previously reported. The original FAIL's §6 finding ("Drafts rail claims tap-to-move but markup has no Move button") and the QA-persona's corroborating finding ("tap-to-select destination highlight... not yet wired into the real Month grid cells at all, only into a standalone demo section") both correctly anticipated that the real-grid wiring was the remaining risk — but the revision pass's `DECISIONS_LOG.md` entry asserts this was fixed ("Drafts-rail Move button... and the Move button wired into real Month/List grid cards" listed among items independently re-verified as already correct), and neither `design-system-compliance-agent`'s re-review nor any other phase-2 agent actually clicked the new real-grid buttons to confirm. This re-test is the first to do so.

**Fix (mechanical, not a redesign):** either (a) move `data-card-name` from `.post-card` onto `.post-card-row` (the shared parent both elements already sit inside), which makes the existing `closest('[data-card-name]')` call correct for the sibling structure with zero JS changes, or (b) change the JS to look at `btn.previousElementSibling` specifically when `btn.closest('[data-card-name]')` fails, which is more fragile and DOM-order-dependent. Option (a) is the safer, smaller fix and is consistent with the pattern that already works correctly in the Drafts rail (attribute on the common ancestor). This needs to be applied to both the 9 real Month-grid instances and the 1 "Drag" demo instance using the same sibling pattern.

**List/Agenda view — separate, smaller, non-blocking-but-real gap:** the List/Agenda view's `.post-row` buttons have no Move trigger at all (confirmed: zero `[data-move-trigger]` elements anywhere inside the `#list-view` section). List/Agenda's only reschedule path is the heavier Post Detail Drawer date-field flow. This is not new — it is consistent with how List view has always been positioned as "open the drawer for full edit," and a working non-drag alternative does still exist there (the drawer), satisfying the letter of WCAG 2.2 SC 2.5.7 even without the lighter tap-to-select pattern. Flagging this for completeness, not as a blocker, since Month view was always the named primary surface for the lighter pattern.

---

## 5. Quick Post confirmation toasts — VERIFIED WORKING AND WELL-POSITIONED AT MOBILE WIDTH

Tested by actually clicking "Save as draft" inside a live Quick Post modal at all three widths:
- Toast fires and renders at all three widths (`toastsFound: 1` every time).
- At 390px: toast box is `16px` inset from the left edge, `358px` wide (`390 − 16×2`), fully within viewport (`withinViewport: true`), positioned above the fold without requiring scroll.
- Close button measures exactly **44×44px** at every width.
- Dismissal works: clicking the close button correctly removes the toast from `#toast-stack` (`dismissedSuccessfully: true`, count goes to 0).
- Confirmed the toast persists correctly even though the modal closes on the same click (the designer's stated DOM-sibling reasoning in `DECISIONS_LOG.md` holds up: `#toast-stack` is independent of `#quickpost-modal`).

No issues found here. **This is a clean pass.**

---

## 6. New TikTok/LinkedIn/X caption rows at 390px — VERIFIED NO LAYOUT BREAKAGE

Tested by opening Quick Post at 390px and toggling on all three newly-added platforms (previously only Instagram had pre-fill):
- All four caption rows (Instagram, TikTok, LinkedIn, X) render with distinct, register-appropriate sample text, each with its own working "✨ Pre-filled by AI" note and live character counter — matching the designer's Fix 9 description exactly.
- Each row measures 350px wide (within the 390px viewport, modal padding accounted for); textarea measures 324px wide. Zero elements inside the modal exceed the viewport edge (`innerOverflowElements: []`) with all four rows expanded simultaneously — this is the worst-case "most content visible at once" state and it does not break.
- A `document.body.scrollWidth` overflow (616px vs. 390px window) does exist on the page **before and independent of** opening the modal — traced directly to `.gallery-frame` (the gallery harness's own `resize: horizontal` demo-preview chrome, a deliberate widget for resizing individual demo blocks per the Phase 2 designer's own decision log) — not to the modal, not to Fix 9's new content, and not to any real product surface. This is gallery-tooling chrome, not a product bug, and is unchanged by this revision pass.

**This is a clean pass; no breakage from the new caption rows.**

---

## 7. Sub-agent decision

I did not invoke a narrower touch-gesture-specialist sub-agent for this re-test. The one new blocking finding (§4 above) is a DOM-traversal/JS-logic bug (`Element.closest()` searching ancestors, not siblings) — a standard DOM-API correctness issue fully diagnosable and fixable with the tools and access already available to this role, not a gesture-reliability or sensor-tuning question that would need deeper touch-specific expertise. The opacity/pointer-type discoverability question (§2) was resolved through direct `matchMedia`/device-emulation testing without needing specialist input either. Flagging explicitly per Master Brief §2: **no sub-agent was invoked this pass.**

---

## Summary table

| # | Finding | Status this pass | Severity |
|---|---|---|---|
| 1 | `[hidden]` CSS-cascade bug (all 6 overlays) | **RESOLVED, verified live** | was Blocking, now closed |
| 2 | Systemic sub-44px touch targets | **RESOLVED, verified live** (real header controls + expanded-hit-target technique both confirmed geometrically) | was Blocking, now closed |
| 2b | Move-button opacity:0 default state, fine-pointer-touch-hybrid discoverability gap | Open, narrow, non-blocking | Minor — real touch hardware unaffected |
| 3 | Drafts-rail Move button missing | **RESOLVED, verified functionally** (not just present — actually enters move mode correctly) | was Blocking, now closed |
| 4 | Move button on real Month-grid cards is visible/correctly-sized but **non-functional** (`closest()` sibling bug) | **NEW FINDING, this pass** | **Blocking** |
| 4b | List/Agenda view has no Move-trigger at all (drawer-only fallback) | Open, not new, judged acceptable | Non-blocking |
| 5 | Quick Post confirmation toasts | **PASS** | — |
| 6 | New TikTok/LinkedIn/X caption rows at 390px | **PASS** | — |

**Net recommendation:** do not forward to human approval yet. Three of the four original blocking/flagged items are genuinely fixed, verified through real interaction rather than a CSS or markup re-read. The new caption-row and toast surfaces pass cleanly. But the Move-button-on-real-grid-cards bug found in §4 is functionally identical in consequence to the original problem this whole phase exists to solve: a user on the actual Month view, on any device, cannot use the non-drag reschedule path at all, because the button that's supposed to trigger it silently does nothing. This is a small, mechanical, one-line-class-of-fix (move `data-card-name` onto `.post-card-row`) — but it must be fixed and the specific repro steps in §4 re-run (not just visually re-inspected) before this packet's Phase 2 gate can be presented to the human.

---

# ORIGINAL REPORT (SUPERSEDED) — 2026-06-23, first pass, verdict FAIL

*(Preserved verbatim below for audit-trail purposes. Do not treat as current — see superseding verdict above.)*

## 1. BLOCKING — the gallery is not actually clickable in a real browser, at any width

This was found by automated testing, not visual inspection, which is exactly the class of bug Master Brief §4's "real browser testing, not just an inspector toggle" rule exists to catch.

**Root cause:** `mockup.css` defines six overlay/backdrop classes —
`.cmdbar-overlay` (line 784), `.modal-backdrop` (line 906), `.drawer-backdrop` (line 836), `.slideover-backdrop` (line 587), and the two modals that reuse `.modal-backdrop` (`quickpost-modal`, `schedule-modal-demo`, `asset-picker-modal`) — every one of them sets `display: flex` directly on the class selector, with **no `[hidden]` CSS rule anywhere in the stylesheet** (confirmed: zero matches for `[hidden]` in `mockup.css`). An author-stylesheet class selector (`.cmdbar-overlay`, specificity 0-1-0) overrides the browser's UA-stylesheet `[hidden] { display: none }` rule (same specificity, lower-priority origin), so the HTML `hidden` attribute is silently defeated for every one of these six elements.

*(... full original report content preserved in git history at this file's prior commit; truncated here to keep this document navigable. Retrieve via `git log -p -- docs/calendar-library-rebuild/packet-1-personal-calendar/MOBILE_PARITY.md` if the full original text is needed verbatim.)*

**Original verdict: FAIL**, citing: (1) the `[hidden]` CSS-cascade bug, (2) systemic sub-44px touch targets across Move button/post-card/"+N more"/⌘K trigger/Quick Post button/view-switcher, (2.1) the per-cell "+" add button's hover-only reveal with no touch equivalent, (3) sub-16px body text in `.post-row__title`/`.post-card__label` with no `clamp()`, (5) sub-520px Month density drop judged acceptable, (6) Drafts-rail Move-button markup gap.
