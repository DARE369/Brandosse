# Design System Compliance Review — Packet 1, Phase 2 Mockup Gallery

**Reviewer:** design-system-compliance-agent
**Reviewed:** `docs/calendar-library-rebuild/packet-1-personal-calendar/mockups/mockup-gallery.html`, `mockup.css`, `mockup.js`, `tokens.css`
**Status: RE-REVIEW (re-test).** This document **supersedes** the prior **FAIL** verdict below the line in §0. The prior report's full text is preserved in git history / `DECISIONS_LOG.md` citations; this is the authoritative current verdict.

---

## VERDICT: PASS

All previously-blocking findings are confirmed resolved by direct re-inspection of the live files (not by trusting the designer's revision-log claims). The new surface area added in the second revision pass (toast success-tone, `.post-row__title` size bump, per-platform Quick Post caption rows) was independently audited and introduces no new color, spacing value, font size, radius, or component pattern. One trivial, non-blocking, previously-undocumented variance was found (§3) — it does not block.

---

## 1. Re-verification of prior BLOCKING findings

### 1.1 `var(--radius-2xl)` — RESOLVED, confirmed
Grepped `mockup.css` in full for `radius-2xl`: zero matches. Both former offending rules now read:
```css
.schedule-modal { ... border-radius: var(--radius-xl); ... }   /* line 1000 */
.quickpost-modal { ... border-radius: var(--radius-xl); ... }  /* line 1044 */
```
`var(--radius-xl)` is confirmed real in `tokens.css` line 54 (`--radius-xl: var(--r-xl)` → `--r-xl: 20px`, line 50). This is the same token already used by `.cell-palette` (`var(--cal3-radius-xl)`, a separately-defined but value-identical 20px local alias) and is consistent with every other large surface in the system. Fix confirmed mechanically correct, not just claimed.

### 1.2 Five non-standard pixel dimensions — RESOLVED for three, retained-with-rationale for two
Re-measured all five directly against both `mockup.css` and production `src/styles/CalendarV3.css` (independently re-read, not taken from the prior report's table):

| Element | Mockup value now | Production value | Status |
|---|---|---|---|
| Month cell min-height (desktop) | `96px` (`mockup.css:500`) | `96px` (`CalendarV3.css:1630`) | **Reverted to exact match** |
| Month grid `grid-auto-rows` (desktop) | `minmax(96px, 1fr)` (`mockup.css:497`) | matches | **Reverted to exact match** |
| Draft card width × min-height | `110px × 90px` (`mockup.css:763`) | `110px` (`CalendarV3.css:1056`) | **Reverted to exact match** |
| Drafts rail tray height (open) | `148px` via `--cal3-tray-h` (`mockup.css:64`, applied at every width per `mockup.css:817-823` comment) | `148px` (`CalendarV3.css:21`) | **Reverted to exact match** |
| Month cell min-height (≤768px tablet/mobile) | `84px` (`mockup.css:612`) | n/a (production has no sub-breakpoint step) | **Retained, rationale now logged** |
| Drafts rail tray height (collapsed) | `44px` (`mockup.css:744`) | `0px` (`CalendarV3.css:22`) | **Retained, rationale now logged** |

Four of the five originally-flagged dimensions were reverted to the exact production value, not just rationalized — this is the stronger of the two acceptable resolutions the prior report offered, and it was the one chosen for everything except the two cases below.

**Rationale check for the two retained deviations** (the task's specific instruction was to confirm the rationale is real and adequate, not just a comment pointing at a log entry):

- **84px tablet/mobile month-cell step** (`DECISIONS_LOG.md`, 2026-06-24T00:00:01Z): rationale is concrete and falsifiable, not a placeholder. It explicitly ties back to the already-approved (Phase 2, 2026-06-23T20:19:35Z) sub-520px density precedent, states the guardrail it inherits (label/time text may shrink/hide only if the same info stays one tap away via "+N more"/slide-over — verified true at this breakpoint by reading `mockup.css:605-625`), and gives a concrete reason for the specific number (84px = 12px shorter than desktop, comfortably above the 44px floor *for the cell itself*, while the touch targets inside remain independently sized to 44px). This is a real, inspectable, falsifiable rationale — not a stub. **Adequate.**
- **44px collapsed tray height** (`DECISIONS_LOG.md`, 2026-06-24T00:00:02Z): re-checked against the actual markup at `mockup.css:746-754` (`.cal3-tray__header`) — confirmed the collapsed state keeps a real, visible, interactive 44px header strip (title, count badge, hint, toggle button) rather than collapsing to nothing, and confirmed this is the same 44px floor applied to every other interactive control in this revision pass (the touch-target sweep from the prior `mobile-responsive-parity-agent` FAIL cycle). The log entry explicitly states it independently re-verified this against markup rather than rubber-stamping the orchestrator's suggested reasoning, and gives a concrete "would change if wrong" (revert to 0px + relocate the reopen trigger elsewhere). **Adequate.**

Both retained deviations are now correctly logged: real reasoning, tied to a concrete guardrail, falsifiable, isolated/cheap to reverse. Neither is a comment that merely gestures at a missing log entry.

### 1.3 Two raw `#fff` literals — RESOLVED, confirmed
Grepped `mockup.css` in full for `#fff`/`#FFF`/any 3-8 char hex literal (`#[0-9a-fA-F]{3,8}`): **zero matches anywhere in the file.** Both `.cmdbar__ai-icon` and `.cell-palette__item-icon.tone-ai` now resolve through token variables (confirmed no hex remains in either rule). This is the strongest possible resolution — not just swapped to the recommended `var(--color-text-inverse)`, but the file now contains no raw color literal of any kind.

### 1.4 `outline: 3px` inconsistency — RESOLVED, confirmed
Grepped for `outline: 3px` / `outline:3px`: zero matches. `.draft-card.is-selected-for-move` now uses the same `2px` convention as every other selection/drop-candidate state in the file and in production `CalendarV3.css`.

---

## 2. Audit of NEW surface area (not previously reviewed)

### 2.1 `.toast__icon.tone-success`
```css
.toast__icon.tone-success { background: var(--color-success-bg); color: var(--color-success-text); }
```
(`mockup.css:865`, immediately preceded by a comment correctly citing its precedent.) Both values are pre-existing TIER 2 semantic tokens, defined in `tokens.css:164` (light: `--color-success-bg: rgba(26,158,95,.12)`, `--color-success-text: #117047`) and `tokens.css:236` (dark equivalents). This is the exact same token pair already used elsewhere in the system for success-tone chips (`.ui-badge-tone-success`, `.cal3-strip__icon.tone-success` — both confirmed to exist in `ui-primitives.css`/`CalendarV3.css` conventions in the prior review's §3). **No new color introduced. Composes correctly.**

The two new toast templates (`#toast-draft-saved-template`, `#toast-post-scheduled-template` in `mockup-gallery.html:1374-1390`) reuse the identical `.toast`/`.toast__icon`/`.toast__body`/`.toast__title`/`.toast__desc`/`.ui-icon-button-ghost.sm` markup contract as the already-reviewed conflict/stale-write toasts — verified by direct comparison, not assumption. No new toast layout, sizing, or shadow was added.

### 2.2 `var(--text-md)` resolution
Confirmed in `tokens.css:28`: `--text-md: 1rem;` — at the standard 16px browser root font-size, this is exactly 16px. `.post-row__title` (`mockup.css:682`) now reads:
```css
.post-row__title { font-size: var(--text-md); font-weight: var(--weight-semibold); ... }
```
This is a pre-existing TIER 1 primitive token (used elsewhere in the system already, not introduced for this change) being applied to a class that previously used a smaller pre-existing token (`--text-sm`, 13px). **No new font-size value entered the system — this is a reassignment between two already-existing sizes**, which is exactly the kind of fix rule 5 wants (reuse, don't invent). Satisfies Master Brief §4's 16px body-text floor outright for the row title, which is the one span in List/Agenda (the doc's own stated "accessibility fallback" view) that most plausibly needed it. `.post-card__label` was deliberately left at `var(--text-xs)` with a logged, density-based rationale (Month grid's narrow cells, escape hatch via "+N more"/slide-over, matches production's own pervasive sub-16px convention for this exact density-constrained chrome) — reviewed and found consistent with the already-accepted sub-520px density precedent, not a new exception.

### 2.3 New pre-filled caption rows (TikTok / LinkedIn / X)
Read the actual markup (`mockup-gallery.html:1153-1168`). All three new rows are structurally and stylistically identical to the already-reviewed Instagram row:
```html
<div class="per-platform-caption__row" data-caption-row="tiktok" hidden>
  ...
  <span class="ai-prefill-note">✨ Pre-filled by AI — edit freely</span>
  <textarea class="ui-textarea" data-char-limit="2200" data-counter-target="qp-counter-tt">...</textarea>
</div>
```
`.ai-prefill-note` and `.ui-textarea` are both pre-existing classes (defined once in `mockup.css`, not redefined or modified for the new rows) — `.ai-prefill-note` (`mockup.css:1072-1075`) uses `var(--text-xs)`, `var(--color-primary-text)`, `var(--color-primary-subtle)`, `var(--radius-full)`, all already-reviewed tokens; `.ui-textarea` shares the combined `.ui-input, .ui-select, .ui-textarea` selector and visual contract already in the file. The per-platform character limits (Instagram/TikTok 2200, LinkedIn 3000, X 280) are realistic per-platform values, not styling — no new CSS surface. **This is new text content using already-reviewed styling, exactly as the task framed the question — confirmed, not assumed.**

---

## 3. Non-blocking observation (new, minor, not previously documented)

`mockup.css:824`, inside the `@media (max-width: 600px)` block: `.draft-card { width: 112px; }` — 2px wider than the reverted desktop value of 110px. This is a trivial, undocumented micro-variance (not one of the five originally-flagged dimensions, and not mentioned in either revision-pass log entry). It introduces no new primitive and is well within "the same neighborhood" — flagged for completeness only, consistent with this agent's practice of surfacing every deviation found, however small. **Does not block.** Recommend either matching it to 110px exactly or adding a one-line rationale in a future pass, at the designer's discretion.

---

## 4. Spot-check of previously-clean areas (confirm no regression)

- **Color:** re-grepped the full file for any hex/rgb/hsl literal — zero found (was 2 in the prior pass; now 0). Strictly improved.
- **Spacing/Radius/Shadow:** spot-checked unaffected; no edits touched these declarations outside the items already covered in §1 and §2.
- **JS:** `mockup.js`'s `showToast()` mechanism (cited in `DECISIONS_LOG.md`'s Fix 8 entry) is reused unmodified for the two new templates — confirmed via the generic `data-fire-toast` wiring already present on the conflict/stale-write buttons and now also on the Quick Post footer buttons (`mockup-gallery.html:1196,1199`). No new dependency, no new mechanism.

---

## Verdict (restated)

**PASS.** Every prior blocking finding (broken `--radius-2xl` reference; five dimension deviations) is confirmed resolved — three reverted exactly to production values, two retained with adequate, falsifiable, markup-verified rationale now in `DECISIONS_LOG.md`. The two prior non-blocking items (`#fff` literals, `outline:3px`) are fully resolved, not just minimized. The new surface area (`.toast__icon.tone-success`, `var(--text-md)` reassignment, three new caption rows) introduces zero new colors, sizes, radii, or component patterns — every new declaration traces to a pre-existing token or a pre-existing class reused verbatim. One trivial new non-blocking variance (§3, `112px` vs `110px` draft-card mobile width) is noted but does not block.

This mockup is cleared to proceed to `mobile-responsive-parity-agent` and `qa-persona-agent` re-test cycles per the standing Phase 2 sequence, and from there to the human approval gate, on design-system-compliance grounds specifically. (This verdict covers compliance only — it does not re-certify the mobile-parity or QA-persona findings from the same revision cycle; those agents' own re-test reports govern their respective domains.)
