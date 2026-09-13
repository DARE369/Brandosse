# Design System Compliance Review — Packet 2, Phase 2 Mockup Gallery

**Reviewer:** design-system-compliance-agent
**Reviewed:** `docs/calendar-library-rebuild/packet-2-personal-library/mockups/mockup-gallery.html`, `mockup.css`, `mockup.js`, `tokens.css`
**Method:** Direct re-inspection of every file's live contents (not the designer's self-report, not Packet 1's report) — grepped for raw hex, raw rgb/hsl, raw px in font-size/spacing/radius, and every `var(--token)` reference, then cross-checked each against this packet's own `tokens.css`, Packet 1's already-approved `tokens.css`/`mockup.css`, and production `src/styles/*.css`.

---

## VERDICT: FAIL — one unresolved blocking flag

The designer's claim that "all new component classes only reference var(--token) values from tokens.css" is **false in one instance**: `mockup-gallery.html:781` references `var(--radius-2xl)`, a token that does not exist anywhere in this packet's `tokens.css`, in Packet 1's `tokens.css`, or in production `src/styles/tokens.css`. Every other claim in the designer's report is verified true. This single flag blocks human review per Master Brief §0 rule 5 / the standing instruction that a mockup with unresolved flags does not proceed.

---

## 1. tokens.css byte-for-byte claim — VERIFIED TRUE

Read both files in full (575 lines each) and compared directly. `docs/calendar-library-rebuild/packet-2-personal-library/mockups/tokens.css` is identical line-for-line to `docs/calendar-library-rebuild/packet-1-personal-calendar/mockups/tokens.css`, which was independently re-verified (not just trusted) against the file contents in this review, not assumed from the Packet 1 report. No new primitive, semantic, or bridge token was added. Confirmed real tokens available include `--radius-sm/-md/-lg/-xl/-full` (all aliasing `--r-sm/-md/-lg/-xl/-full`) and the unaliased primitive `--r-2xl: 24px` — but **no `--radius-2xl` alias exists**, exactly the gap Packet 1 hit and had to fix in its own prior revision cycle (see Packet 1's `DESIGN_SYSTEM_COMPLIANCE.md` §1.1).

## 2. Raw color literals — VERIFIED CLEAN

- Grepped `mockup.css` for any 3–8 character hex literal (`#[0-9a-fA-F]{3,8}`): **zero matches.**
- Grepped `mockup.css` for `rgba(`/`hsla(`: the only matches are the `--cal3-shadow-*` and `--cal3-overlay` local token block (lines 52–66), which is **verbatim, byte-identical** to the same block in Packet 1's already-approved `mockup.css` (lines 58–82, confirmed by direct diff of both blocks). This is a reused local namespace, not a new color.
- Grepped `mockup-gallery.html` for inline `style="..."` color literals: none found; every color reference in inline styles resolves through `var(--color-*)`.

## 3. Raw px font-size / spacing — VERIFIED CLEAN (all precedented)

- `font-size: 10px` appears 4 times (`mockup.css:320, 331, 366, 475`) for micro-labels/badges (source badge, unused badge, asset tag, drawer section label). This exact raw value for this exact "uppercase micro-label/badge" pattern is heavily precedented in production (`src/styles/CalendarEngine.css` ×8, `src/styles/BrandosseGenerateStudio.css` ×14, `src/styles/GeneratePromptBar.css` ×3) and in Packet 1's own already-approved `mockup.css` (×8, identical pattern). Not a new value.
- Sub-`--space-1` (4px) raw values (`2px`, `4px`, `6px`, `8px` used for icon sizes, badge padding, gap, absolute-position offsets) are likewise the established convention for dense chrome below the token floor — confirmed present in the same shape throughout Packet 1's approved mockup and production CSS. Not new.
- `border: 1.5px solid ...` (`mockup.css:253, 345`) matches an extremely common production convention (50+ occurrences across `CalendarEngine.css`, `BrandosseGenerateStudio.css`, `BrandKit.css`, `GenerateV2.css`, `UserDashboard.css`, and Packet 1's mockup.css). Not new.
- No body text below 16px outside already-reviewed micro-chrome contexts; `html, body` sets `font-size: var(--text-md)` (1rem/16px) as the floor, matching Master Brief §4's body-text rule.

## 4. The one unresolved flag

**File:** `docs/calendar-library-rebuild/packet-2-personal-library/mockups/mockup-gallery.html`
**Line:** 781
**Offending code:**
```html
<section class="ui-empty-state" style="background:var(--color-bg-surface); border:1px solid var(--color-border); border-radius: var(--radius-2xl); box-shadow: var(--shadow-lg); max-width:380px;">
```
**Problem:** `--radius-2xl` is not defined in `tokens.css` (this packet's or Packet 1's or production's). The only related tokens that exist are the primitive `--r-2xl: 24px` (theme-agnostic, line 50, not intended for direct component consumption per the file's own TIER 1/2/3 rule comment) and the semantic alias `--radius-xl: var(--r-xl)` = 20px (the largest semantic radius alias that does exist). Because `--radius-2xl` resolves to nothing, `border-radius` on this rule is invalid and the browser drops the declaration, leaving this empty-state card with no rounding at all — a real, visible rendering defect in the "Empty — new account" gallery state (spec §11), not a theoretical one.
**This is the identical bug class Packet 1 hit and fixed** (see Packet 1's `DESIGN_SYSTEM_COMPLIANCE.md` §1.1: `.schedule-modal`/`.quickpost-modal` both originally referenced `var(--radius-2xl)` and were corrected to `var(--radius-xl)`). It was not carried over as a fix into this packet.
**Required fix:** Replace `var(--radius-2xl)` with `var(--radius-xl)` at `mockup-gallery.html:781` — the same resolution Packet 1 used, consistent with every other large-surface rounded card in both galleries (`.lib-modal`, `.lib-bulk-bar`, `.handoff-card`, `.upload-dropzone` all already use `var(--radius-xl)`).

## 5. Structural shell reuse claim — VERIFIED TRUE

Spot-checked `.ui-button*`, `.ui-icon-button*`, `.ui-badge*`, `.ui-field*`, `.ui-empty-state*` (apart from the one inline override above), `.status-pill`, `.toast*`, `.skel`/`skel-shimmer`, `.modal-backdrop`, `.drawer-backdrop` against Packet 1's `mockup.css`: all rules are reproduced verbatim, same property order, same values, same comment attribution ("verbatim from Packet 1's mockup.css"). No drift found.

## 6. New component classes — audited individually

| Class | Token usage | Verdict |
|---|---|---|
| `.asset-card` + children | `var(--radius-lg)`, `var(--color-*)`, `var(--shadow-md)`, `var(--space-*)` | Clean |
| `.lib-grid` | `var(--space-3/4)`, raw `180px`/`2` column-count values (layout-structural, not a token category) | Clean |
| `.lib-table` / `.lib-table-*` | `var(--color-*)`, `var(--text-*)`, `var(--space-*)`, `var(--radius-*)` | Clean |
| `.upload-dropzone` / `.upload-queue-item` | `var(--color-*)`, `var(--radius-*)`, `var(--space-*)` | Clean |
| `.duplicate-warning` | `var(--color-warning-*)`, `var(--radius-md)`, `var(--space-*)` | Clean |
| `.ai-shimmer-line` | `var(--radius-full)`, raw width values (52px/38px/44px, decorative skeleton-bar widths, not a token category) | Clean |
| `.version-chain` / `.version-item` | `var(--color-*)`, `var(--radius-md)`, `var(--space-*)` | Clean |
| `.lib-filter-chip` | `var(--radius-full)`, `var(--color-*)`, `1.5px` border (precedented, see §3) | Clean |

No new color, spacing primitive, font-size primitive, or component-pattern category was introduced anywhere in this list. The shimmer-bar widths and grid column counts are structural/decorative values outside the token system's scope (same as Packet 1's draft-card width precedent), not a compliance violation.

## 7. mockup.js — VERIFIED CLEAN

Read in full (486 lines). Every `style.` assignment made by JS is either a dynamic percentage (`fill.style.width = pct + '%'` — upload progress, not a design token) or a `var(--color-*)` string (duplicate-warning resolution state). No raw hex, no raw px size, no new interaction pattern beyond what mockup.css already defines. Behavior contracts (`data-open`/`data-close`/`data-backdrop-close`/`showToast`) are reused identically from Packet 1's `mockup.js`, confirmed by direct comparison of function shape and naming.

---

## Verdict (restated)

**FAIL — NOT cleared for human review.** One unresolved flag:

1. `mockup-gallery.html:781` — `var(--radius-2xl)` is an undefined token (no such alias exists in `tokens.css`); fix by changing it to `var(--radius-xl)`, the same correction Packet 1 already made for the identical mistake.

Every other claim in the designer's compliance self-report is independently verified true: the tokens.css copy is byte-for-byte identical to Packet 1's approved file, zero raw hex/rgb color literals exist anywhere in the new CSS, all raw px values found are pre-existing-pattern micro-chrome sizes with direct production and Packet-1 precedent, and all nine new component classes compose exclusively from existing tokens. Once the single line-781 fix is applied and re-verified, this mockup should clear without further compliance concerns — re-run a targeted grep for `radius-2xl` across all three files after the fix to confirm zero remaining matches before resubmitting.

---

# RE-TEST — Phase 2, fix round 1 — 2026-06-25

**Reviewer:** design-system-compliance-agent
**Trigger:** `library-ui-ux-designer`'s "Phase 2 (fix round 1)" entry in `DECISIONS_LOG.md` (2026-06-25T06:00:00 through 06:40:00), which claims to have resolved the single blocking flag above plus five other mobile-parity findings from `MOBILE_PARITY.md` that incidentally touched new/changed markup and CSS.
**Method:** Independent re-verification, not trust of the designer's self-report. (1) Grepped all three mockup files for `radius-2xl` directly. (2) Did a fresh, targeted compliance pass — same checks as the original review (raw hex, raw rgb/hsl, raw px font-size/spacing outside precedented patterns, new token names) — scoped specifically to the regions the fix round touched: `.lib-mobile-rail-toggle` / `#lib-mobile-rail-sheet` (new markup + CSS), the deleted `.asset-card__more-trigger` block, `.lib-table-checkbox-cell` (new hit-pad), the `.sm` modifier added to the four drawer footer buttons, and the `.gallery-section__desc` `clamp()` change. Did not re-review the entire file from scratch.

---

## VERDICT: PASS — original flag resolved, fix-round changes clean

## 1. Original flag (`var(--radius-2xl)`) — CONFIRMED RESOLVED

- `grep -n "radius-2xl" mockup-gallery.html` → **zero matches.**
- `grep -n "radius-2xl" mockup.css` → **zero matches.**
- `grep -n "radius-2xl" tokens.css` → **zero matches** (token was never defined here either, consistent with original finding).
- The empty-state card (now at `mockup-gallery.html:812`, shifted down from the original line 781 because the fix round inserted new mobile-rail-toggle/sheet markup earlier in the document — same element, not a new one) now reads:
  ```html
  <section class="ui-empty-state" style="background:var(--color-bg-surface); border:1px solid var(--color-border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); max-width:380px;">
  ```
  `var(--radius-xl)` resolves correctly (confirmed present in `tokens.css` as the semantic alias for `--r-xl` = 20px, the same value already used on `.lib-modal`, `.lib-bulk-bar`, `.handoff-card`, `.upload-dropzone`). No drift, no new value introduced. **Resolved exactly as specified.**

## 2. Fresh compliance pass on fix-round-changed regions

### 2a. `.lib-mobile-rail-toggle` / `#lib-mobile-rail-sheet` (new markup + CSS, `mockup-gallery.html:144-201`, `mockup.css:293-327`)

Read both the new HTML block and the new CSS block in full. Every property value is one of:
- An existing `var(--token)`: `--space-2/3/4/5`, `--color-border`, `--color-bg-surface`, `--color-text-primary`, `--color-text-tertiary`, `--text-sm`, `--text-md`, `--weight-medium`, `--weight-semibold`, `--weight-bold`, `--radius-md`, `--radius-xl`, `--cal3-shadow-panel` — all confirmed present in `tokens.css`/`mockup.css`'s existing local-token block (`--cal3-shadow-panel` is the same local namespace already used on the existing `.lib-drawer` panel, not new).
- A structural/layout raw value with direct precedent: `min-height: 44px` (the floor, used identically elsewhere), `width: 100%`, `min(70vh, 520px)` (a viewport-relative max-height clamp, same technique class as other `min()`/`clamp()` uses already in this file), `gap: 2px` (same sub-token-floor convention already reviewed and accepted in §3 of the original report for dense chrome).
- The `fade-in` keyframe animation (`mockup.css:210`) is pre-existing, reused verbatim — not a new animation.
- The bottom-sheet's `data-open`/`data-close`/`data-backdrop-close` attributes reuse the exact same generic modal/drawer-backdrop JS contract already wired for every other modal in this file (confirmed in the original review's §7) — not a new interaction pattern.

No new color, no new spacing primitive, no new font-size primitive, no new token name. **Clean.**

### 2b. Removed `.asset-card__more-trigger` dead CSS

Grepped both `mockup.css` and `mockup-gallery.html` for `more-trigger`: the only remaining reference is an explanatory code comment (`mockup.css:423`, "...that duplicated this same job"), not a live rule. The base rule, the `:has()` visibility gate, the inclusion in the blanket 44px-floor selector list, and the dedicated `::before` hit-pad rule are all gone — confirmed by direct read of `mockup.css:623-629`, the touch-target-floor selector list, which no longer names `.asset-card__more-trigger`. This is a pure deletion; nothing to flag (removing code cannot introduce a new token/color/spacing violation).

### 2c. `.lib-table-checkbox-cell` hit-pad (`mockup.css:451-460`, `mockup-gallery.html:372,384,404,424,444`)

```css
.lib-table-checkbox-cell { width: 44px; position: relative; }
.lib-table-checkbox-cell input[type="checkbox"] { position: relative; vertical-align: middle; }
.lib-table-checkbox-cell input[type="checkbox"]::before { content: ''; position: absolute; inset: -16px; }
```
`width: 44px` matches the existing 44px touch-target floor convention used throughout this file (not a new spacing value — it's the same floor constant, expressed as a cell width rather than a min-height/min-width pair). The `::before { inset: -16px }` hit-pad-expansion technique is the same pattern already in production use in this exact file on `.asset-card__select::before` (confirmed present, same shape: absolutely-positioned, content-less, negative-inset pseudo-element) — explicitly called out as reuse, not invention, in the CSS's own adjacent comment. `-16px` is a new specific inset *value* (the existing `.asset-card__select::before` uses `-9px`), but it is the same *pattern* applied to a smaller source element needing more expansion to clear the same 44px floor — this is parametrizing an existing technique to a new starting size, not introducing a new design-system category (color/font-size/spacing-scale/component-pattern). No flag.
Markup confirmed: all 5 cells (1 `<th>` + 4 `<td>`) carry the class consistently.

### 2d. `.sm` modifier added to 4 drawer footer buttons (`mockup-gallery.html:920,921,924,925`)

```html
<button class="ui-button ui-button-secondary sm" ...>Save changes</button>
<button class="ui-button ui-button-primary sm" ...>Schedule…</button>
<button class="ui-button ui-button-secondary sm" ...>Duplicate</button>
<button class="ui-button ui-button-danger sm" ...>Delete</button>
```
`.ui-button.sm` is a pre-existing modifier, confirmed already defined in `mockup.css:153` (`min-height: 44px; padding: 0 var(--space-3); font-size: var(--text-xs);`) and already in active use elsewhere in this same gallery before this fix round (card Schedule buttons, table action buttons). No new class was created; an existing class was applied to four additional elements. `--text-xs` (0.72rem) is confirmed defined in `tokens.css:25`. No flag.

### 2e. `.gallery-section__desc` `clamp()` change (`mockup.css:129`)

```css
.gallery-section__desc { font-size: clamp(1rem, 0.95rem + 0.3vw, 1.0625rem); ... }
```
Changed from a fixed `var(--text-base)` (14px) to a fluid clamp with a 16px floor (`1rem`) and a 17px ceiling (`1.0625rem`), scaling via `0.3vw`. All three clamp arguments use only `rem`/`vw` units already used elsewhere in this file's other `clamp()` declarations (e.g. `.lib-main-col`'s `padding: clamp(12px, 2vw, 20px)`). No raw hex, no new unit type, no value below the 16px body-text floor at any viewport — confirmed the floor (`1rem`) is reached only at the narrowest end of the clamp's range, never goes lower. This is harness/explanatory prose, not a product-surface component, but the change is itself fully compliant: it does not introduce a new token, it converts a fixed value to a fluid expression using an already-established `clamp()` idiom. No flag.

## 3. Scope check — confirmed nothing else changed

Re-grepped the full `mockup.css`/`mockup-gallery.html` for `#[0-9a-fA-F]{3,8}` (raw hex) and for any `var(--` reference not resolvable in `tokens.css`: zero new matches beyond what was already reviewed and passed in the original review's §2/§6. No incidental changes outside the six named fix-round items were found.

---

## Verdict (restated)

**PASS.** The original blocking flag (`mockup-gallery.html:781` → now `:812`, `var(--radius-2xl)` → `var(--radius-xl)`) is confirmed resolved by direct re-grep (zero `radius-2xl` matches anywhere in the packet) and by reading the corrected line in context. The fix round's six changes (mobile rail toggle + bottom sheet, dead `.asset-card__more-trigger` CSS removal, table checkbox hit-pad, `.sm` modifier on four drawer footer buttons, `.gallery-section__desc` fluid-clamp font-size) were independently re-audited as their own fresh compliance pass and introduce **zero new colors, zero new spacing/font-size primitives, and zero new token names** — every value used is either an existing token or a parametrization/extension of an already-precedented raw-value pattern (the `::before { inset: -Npx }` hit-pad technique, the `clamp()` fluid-sizing idiom, the 44px touch-target floor).

**This mockup is cleared on design-system-compliance grounds.** Note: this report covers compliance only. Per the division of labor recorded in this file's original §6 (2026-06-25T05:12:00 decision), mobile-parity/touch-target/feature-parity correctness for these same six fixes is `mobile-responsive-parity-agent`'s independent re-test, recorded separately in `MOBILE_PARITY.md` — this packet should not be treated as fully cleared for human review until that report's own re-test (if not already done) also confirms PASS.

---

# NEW MOCKUP REVIEW — `design-mockups/library-v3.dc.html` (Content Library v3) — 2026-09-12

**Reviewer:** design-system-compliance-agent
**Reviewed:** `design-mockups/library-v3.dc.html` (a later, separate `.dc.html`-format mockup, not the `mockup-gallery.html` reviewed above — this file post-dates the completion lockdown and was not previously reviewed).
**Authoritative sources used:** `src/ui-v2/tokens.css` (the real, locked v2 token file — not the old `mockup.css`-local `tokens.css` reviewed above, which is a different, superseded naming scheme), `src/pages/Library/LibraryPage.jsx`/`LibraryPage.module.css`, `src/ui-v2/primitives/*.module.css` (Button, IconButton, Badge, Card, Drawer, Modal, Dropdown, EmptyState, Skeleton, Toast), `src/pages/Library/components/AssetCard.module.css` and `AssetDetailDrawer.module.css`.
**Method:** The mockup mirrors every `src/ui-v2/tokens.css` value into a local, theme-scoped custom-property block (`[data-theme="dark"|"light"]`) rather than importing tokens.css directly, "so this mockup cannot drift from the locked system" (mockup's own header comment, line 16-21). I verified this claim value-by-value against `tokens.css` rather than trusting it, then checked every class in the file for hard-coded values, both-theme completeness, contrast, component duplication, and typography.

## VERDICT: FAIL — unresolved blocking flags (2 hard token-value defects: #1, #2). Not cleared for human review until resolved.

### 1. Invented tokens: `--success-wash` / `--success-border` do not exist in `tokens.css` — BLOCKING

**Lines:** `library-v3.dc.html:38` (dark: `--success-wash:rgba(48,164,108,.10); --success-border:rgba(48,164,108,.30);`), `:52` (light: `--success-wash:rgba(31,143,93,.07); --success-border:rgba(31,143,93,.28);`).
**Consumed at:** `.tag--ready` (line 192), `.fit--yes` (line 208), `.pill--published` (line 257).
**Problem:** `src/ui-v2/tokens.css` defines `--uiv2-danger-wash/-border`, `--uiv2-warning-wash/-border`, and `--uiv2-info-wash/-border` for both themes (lines 117-122 dark, 176-181 light) — but **no `--uiv2-success-wash` or `--uiv2-success-border` exists anywhere in the file**. The real, shipped precedent for a "success" status tone is `src/ui-v2/primitives/Badge.module.css:22`: `.success { background: color-mix(in srgb, var(--uiv2-success) 15%, transparent); color: var(--uiv2-success); }` — no border at all, and a 15%-opacity `color-mix()`, not a fixed rgba wash constant. The mockup's invented wash is 10%/7% opacity (dark/light), not 15%, and it adds a border Badge deliberately does not have. This is a new color pairing invented per-mockup, not traced to any existing token — exactly what Master Brief §0 rule 5 prohibits.
**Fix:** Replace every `var(--success-wash)`/`var(--success-border)` reference with the Badge primitive's actual recipe — background `color-mix(in srgb, var(--success) 15%, transparent)`, no border — or, if a bordered success treatment is genuinely needed, that is a real token-system gap to raise explicitly (add `--uiv2-success-wash`/`--uiv2-success-border` to `tokens.css` itself, once, with sign-off), not something a single mockup should silently define for itself.

### 2. `.btn--danger` hardcodes `color:#fff`, reintroducing the exact AA failure class `tokens.css`'s own comments warn about — BLOCKING

**Line:** `library-v3.dc.html:115` — `.btn--danger { background:var(--danger); color:#fff; }`.
**Used at:** line 673, `<button class="btn btn--danger btn--sm" onClick="{{onRepair}}">Re-upload</button>` (asset-detail drawer, "This file can't reach a platform" notice) — a real, live control, not decorative.
**Problem:** Computed contrast of white (`#fff`) on the dark-theme danger color `--danger:#E5484D` (mockup line 38, = `--uiv2-danger-d`, tokens.css:77) is **3.92:1**, which fails WCAG AA's 4.5:1 floor for normal-size text (the button label is 13px). This is the identical failure class documented in `tokens.css:68-71`'s own comment for `--uiv2-accent-on-solid` ("Was #FFFFFF on #FF5C38 — 3.07:1, a failing label") — white-on-saturated-color button text failing AA. The real, shipped `Button.module.css:58-61` primitive already solved this exact problem: `.dangerSolid { background: var(--uiv2-danger); color: var(--uiv2-accent-on-solid); }` — using the near-black `accent-on-solid` token (`#17181B`), which computes to 4.54:1 on the same danger red (passes AA). The mockup's `.btn--danger` is visually the filled/solid danger treatment (matching `.dangerSolid`, not the outlined `.danger` variant), so it should follow `.dangerSolid`'s text-color choice.
**Fix:** `.btn--danger { color: var(--accent-on-solid); }` (the mockup already defines this local alias correctly at line 31 and uses it correctly elsewhere, e.g. `.btn--primary` line 109, `.dest__box--on` line 278 — this one instance was missed).

### 3. `.shimmer` gradient uses the wrong middle-stop token and is unwired dead CSS — non-blocking, but flag before build

**Lines:** `library-v3.dc.html:44` (dark: `linear-gradient(90deg,#1E2023 0%,#26282C 50%,#1E2023 100%)`), `:58` (light: `linear-gradient(90deg,#F4F3EE 0%,#E4E2DC 50%,#F4F3EE 100%)`), consumed at `.shimmer` (line 215: `background-size:500px 100%; animation:sh 1.2s linear infinite;`).
**Problem:** `#26282C`/`#E4E2DC` are `--border`/`--border-strong`, not `--bg-inset`. Both real shimmer implementations in the codebase — `Skeleton.module.css:2-9` (`bg-elevated 0px, bg-inset 200px, bg-elevated 400px`, `background-size:800px`) and `AssetCard.module.css:163-169` (`bg-elevated 0px, bg-inset 120px, bg-elevated 240px`, `background-size:480px`) — use `bg-inset` as the highlight stop, never `border`. The mockup substitutes a border color into a shimmer-highlight role that has never held that value anywhere else in the system. Compounding this: `class="shimmer"` is never actually applied to any element in the markup (grepped the full file), despite the flow-view copy at line 600 explicitly promising "The card shimmers until they land" for tagging-pending assets — the card only renders a `.tag--tagging` text badge today, not a shimmer. So this is currently a wrong-valued, unused token sitting ready to be wired up incorrectly.
**Fix:** Change both gradients' middle stop to `var(--bg-inset)`'s literal value (`#131417` dark / `#F4F3EE` light) and `background-size` to match one of the two existing recipes (e.g. 480px, matching `AssetCard.module.css`'s per-card-scale shimmer), and either wire `.shimmer` onto the tagging-pending card state to match the copy's promise, or drop the promise/class if it's out of scope for this pass.

### 4. `.chip` background token doesn't match its own shipped equivalent (`LibraryPage.module.css`'s `.filterChip`)

**Line:** `library-v3.dc.html:154` — `background:var(--bg-surface)`.
**Real precedent:** `src/pages/Library/LibraryPage.module.css:151` — `.filterChip { background: var(--uiv2-bg-elevated); ... }`, the already-shipped equivalent of this exact "inactive filter chip" role (same pill radius, same border, same active-state accent-wash treatment as the mockup's `.chip--active`, line 157).
**Fix:** `.chip` should use `var(--bg-elevated)`, matching the shipped filter-chip precedent, not `--bg-surface`.

### 5. `.drawer` background token doesn't match the shipped `Drawer` primitive

**Line:** `library-v3.dc.html:221` — `.drawer { width:460px; ...background:var(--bg-surface); ...}`.
**Real precedent:** `src/ui-v2/primitives/Drawer.module.css:13` — `.panel { ...background: var(--uiv2-bg-inset); ...}`. Width is legitimately parametrizable (`Drawer.jsx` accepts a `width` prop, so 460px vs. the default 400px is not itself a violation), but the background token is a genuine mismatch against the primitive this component is standing in for.
**Fix:** `.drawer { background: var(--bg-inset); }`.

### 6. `.menu` (Add-content dropdown) reinvents `Dropdown` rather than reusing it, with drifted values

**Lines:** `library-v3.dc.html:126-134`.
**Real precedent:** `src/ui-v2/primitives/Dropdown.module.css` — `.panel { background: var(--uiv2-bg-surface); border: 1px solid var(--uiv2-border-strong); padding: 8px; ...}` (lines 9-12).
**Drift found:** mockup uses `background:var(--bg-elevated)` (not bg-surface), `border:1px solid var(--border)` (not border-strong), `padding:6px` (not 8px).
**Recommendation (component vocabulary, §4 of the review brief):** map `.menu`/`.menu__item` directly onto `Dropdown.jsx` + `.panel`/`.alignRight` rather than a parallel hand-rolled implementation, correcting the three drifted values above in the process.

### 7. `.pill--*` / `.tag--*` / `.fit--*` all duplicate `Badge` — map at build time

`Badge.jsx`/`Badge.module.css` already implements exactly this job (a tone-based small status label: success/warning/danger/info/neutral/accent). The mockup instead hand-rolls three parallel families (`.pill--published/scheduled/draft/failed`, `.tag--ready/blocked/tagging/nodest/record`, `.fit--yes/no`) with their own bespoke background/border values (see finding #1 for the success case specifically). Recommended mapping for the build phase, so nothing is re-implemented: `.pill--published`/`.tag--ready`/`.fit--yes` → `Badge tone="success"`; `.pill--scheduled`/`.tag--tagging` → `tone="info"`; `.pill--draft`/`.tag--record` → `tone="neutral"`; `.pill--failed`/`.tag--blocked` → `tone="danger"`; `.tag--nodest` → `tone="warning"`. Adopting this mapping also resolves finding #1 automatically, since `Badge`'s success tone never used an invented wash/border pair.

### 8. `.iconbtn` doesn't match the shipped `IconButton` primitive's size; `.iconbtn--on` is a real, missing variant worth promoting

**Line:** `library-v3.dc.html:119` — `.iconbtn { width:38px; height:38px; ...}` vs. `src/ui-v2/primitives/IconButton.module.css:2-3` — `.iconBtn { width: 30px; height: 30px; }`. Concrete size mismatch against the primitive it stands in for.
`.iconbtn--on` (line 124: `background:var(--accent-wash); color:var(--accent-text); border-color:var(--accent-border);`) has no equivalent in `IconButton.module.css` at all (only `.iconBtn`/`.dot` exist there) — but the value combination used is itself correctly token-derived and matches the "active" idiom used everywhere else in this system (`.navitem--active`, `LibraryPage.module.css`'s `.filterChipActive`/`.viewToggleBtnActive`). Recommend adding this as a real `.iconBtnActive` variant to the shipped `IconButton.module.css` (using exactly these three tokens) rather than leaving each screen to reinvent it.

### 9. `.btn--sm` font-size doesn't match the shipped `Button` primitive's small size

**Line:** `library-v3.dc.html:116` — `.btn--sm { ...font-size:12px; ...}` vs. `src/ui-v2/primitives/Button.module.css:22` — `.sizeSm { padding: 6px 12px; font-size: var(--uiv2-text-xs); }` = 11.5px. Minor but exact, checkable numeric drift from the primitive being mirrored.

### 10. `.btn--primary:hover` hardcodes a literal hex instead of mirroring the matching token, and departs from the Button primitive's own hover technique

**Line:** `library-v3.dc.html:110` — `.btn--primary:hover { background:color-mix(in srgb, #FF5C38 92%, white); }`.
The expression is byte-identical to `tokens.css:66`'s `--uiv2-accent-solid-hover: color-mix(in srgb, #FF5C38 92%, white);` — but the mockup inlines the literal instead of mirroring it as a local `--accent-solid-hover` alias, unlike every other tokens.css value it faithfully aliased in its `[data-theme]` block (lines 25-60). Separately, the actual shipped `Button.module.css:28` primitive uses a different technique entirely for this same state: `.solid:hover:not(:disabled) { filter: brightness(1.06); }`.
**Fix:** Either add `--accent-solid-hover` to the mockup's token block and reference it, or (preferred, to match the primitive of record) replace the rule with `filter: brightness(1.06)` to exactly mirror `Button.module.css`.

### 11. Toast padding and shadow token both drift from the shipped `Toast` primitive

**Line:** `library-v3.dc.html:311` — `.toast { padding:11px 16px; ...box-shadow:var(--shadow-pop); }` vs. `src/ui-v2/primitives/Toast.module.css:9,17` — `padding: 11px 18px;` and `box-shadow: var(--uiv2-shadow-modal-current);`. The mockup's `--shadow-pop` (line 57, light theme) resolves to `0 12px 28px rgba(0,0,0,.14)`, which is tokens.css's **popover** shadow (`--uiv2-shadow-popover`, tokens.css:83) — the real Toast primitive uses the larger **modal** shadow (`0 20px 50px rgba(0,0,0,.15)` in light theme, tokens.css:81). Both the padding (16px vs. 18px) and the shadow tier are checkable, exact mismatches against the component being mirrored.

### 12. Mono font stack isn't tokenized and doesn't match `--uiv2-font-mono` exactly

**Line:** `library-v3.dc.html:300` — `.node__src { font-family:"JetBrains Mono", ui-monospace, monospace; ...}`. Unlike `--font-display`/`--font-body`, which are correctly aliased in the `[data-theme]` block (lines 26-27) from `tokens.css:16-17`, no `--font-mono` alias is ever defined, and the hardcoded fallback stack differs from `tokens.css:18`'s `--uiv2-font-mono: "JetBrains Mono", "Fira Code", monospace` ("Fira Code" replaced with "ui-monospace"). **Fix:** add `--font-mono: "JetBrains Mono", "Fira Code", monospace;` to the `[data-theme]` block and reference `var(--font-mono)` at line 300.

### 13. `.chip__n` (and other counters) skip the established mono-numeral convention for counts

**Line:** `library-v3.dc.html:158` — `.chip__n { font-size:11px; color:var(--text-3); font-variant-numeric:tabular-nums; }`. Every other numeric-count instance in the shipped codebase uses `font-family: var(--uiv2-font-mono)` for this role (`LibraryPage.module.css:101-105` `.mobileRailToggleCount`, `:228-233` `.railItemCount`; `AssetCard.module.css:149` `.metaRow`) — the mockup instead relies only on `font-variant-numeric`, a different (and non-token) mechanism, for the same "tabular number" intent. Minor; align with the mono-numeral convention if this class is carried into the build.

## Checks that passed cleanly (not flagged further)

- **Both themes complete:** every local custom property defined in `[data-theme="dark"]` has a symmetric counterpart in `[data-theme="light"]` (verified line-by-line, lines 33-60); no color is theme-orphaned and no raw color outside the two theme blocks fails to flip (the one apparent exception, `.tag--src`/`.tag--dur`'s hardcoded `rgba(14,15,17,.72)`/`#F5F5F4` scrim-over-media badges at lines 190-191, is intentional and byte-identical to the already-shipped `AssetCard.module.css:44-56` `.mediaBadge` — a fixed-contrast overlay badge that must stay legible over an arbitrary photo regardless of theme, not a theme bug).
- **Contrast — `accent-on-solid`:** `.btn--primary`/`.dest__box--on` correctly use `--accent-on-solid` (#17181B in both themes), matching `tokens.css:67-72`'s AA-fixed value. Passes.
- **Contrast — light-theme `accent-text`:** correctly uses the AA-fixed `#C13F16` (line 51), not the failing `#E14E2F` `tokens.css:157-164`'s comment documents replacing. Passes.
- **Contrast — `.fit--no`:** computed contrast of `--text-3` on `--bg-inset` clears AA in both themes (dark ≈5.1:1, light ≈4.5:1, consistent with the floor `tokens.css`'s own tertiary-text comments already establish). Passes.
- **Typography — Space Grotesk vs. Inter:** every heading/title correctly uses `var(--font-display)` (`.rail__name`, `.topbar h1`, `.drawer__t`, `.empty__t`, the publish-sheet title); body text correctly inherits `var(--font-body)`. No misuse found.
- Radius, spacing, and most font-size values trace either to a real `--r-*` token or to a raw-px micro-chrome convention with direct, exact precedent already shipped in `LibraryPage.module.css`/`AssetCard.module.css`/`AssetDetailDrawer.module.css`/`StudioPage.module.css` (10px/10.5px/11px/11.5px/12px/12.5px/15px/16px/19px all independently confirmed present in shipped ui-v2 CSS in the same usage role) — not re-listed individually per the "don't pad the report" instruction.

## Summary

**13 findings, 2 blocking (#1 invented success-wash/border tokens; #2 the `.btn--danger` white-on-red AA failure).** The remaining 11 are real, checkable, file:line-precise token/value drift against the specific shipped primitive each mockup class is standing in for (Drawer, Dropdown, IconButton, Button, Toast, the mono font token, LibraryPage's filter chip) — none individually blocking on their own, but all should be corrected before this mockup is treated as build-ready, since Master Brief §0 rule 5 makes "matches an existing primitive exactly" the bar, not "is close enough." Per the standing rule, **this mockup does not go to human review until findings #1 and #2 are resolved and re-verified.**
