# Design System Compliance Review — ui-v2 migration (Library & Calendar mockups)

Reviewer: `design-system-compliance-agent` (re-review pass, 2026-07-07)
Scope: `docs/calendar-library-rebuild/ui-v2-migration/library-mockup.html` and
`.../calendar-mockup.html`, re-checked against `src/ui-v2/tokens.css`,
`src/ui-v2/primitives/Drawer.jsx`/`.module.css`, `Modal.module.css`,
`IconButton.module.css`, `Badge.module.css`, `Button.module.css`,
`src/ui-v2/shell/AppHeader.jsx`/`.module.css`,
`src/ui-v2/shell/MobileNavDrawer.jsx`/`.module.css`, and the two shipped
ui-v2 reference screens (`StudioPage.jsx`/`.module.css`,
`PersonalDashboardPage.jsx`/`.module.css`).

This is a fresh verification pass against the prior UNRESOLVED verdict
(2026-07-07T12:30:00Z). Each of the four blocking items plus the two minor
items from that review was independently re-checked against the live
primitive source (not the designers' self-reported fix summaries), plus a
fresh scan for anything missed the first time.

## Verification of each previously-flagged item

**1.1 Mobile nav drawer (was BLOCKING) — CONFIRMED FIXED, both files.**
Read `MobileNavDrawer.jsx` (composes `<Drawer title="Menu" width="min(280px,
84vw)">`) and `Drawer.jsx`/`.module.css` (right `0`, `border-left`,
`bg-inset`, title + `×` close button, `uiv2-fade-in`) directly, then
compared against the markup in both mockups line-by-line:
- `library-mockup.html` lines 549–569: `.drawerBackdrop`/`.drawerPanel`/
  `.drawerHeader`/`.drawerTitle`/`.drawerCloseBtn` reused verbatim (same
  classes the real asset-detail drawer uses lower in the same file), right
  side, `bg-inset`, inline `width:min(280px, 84vw)` matching the real
  component's own width prop, title "Menu" + close SVG present.
- `calendar-mockup.html` lines 686–700: same pattern, `.drawer-panel` right
  `0`/`border-left`/`bg-inset`, `min(280px, 84vw)` inline width, "Menu"
  title + close button present.
- Both files' `.mobile-nav-link`/`.mobileNavLink` CSS (padding `11px 12px`,
  radius `7px`, `font-size: 14px`, `font-weight: 500`, hover/active →
  `bg-elevated`) matches `MobileNavDrawer.module.css`'s `.link`/`.linkActive`
  exactly, property-for-property.
Resolved.

**1.2 Modal size scale (was BLOCKING) — CONFIRMED FIXED, both files.**
Real `Modal.module.css`: `sizeSm 380px / sizeMd 420px / sizeLg 560px`.
`library-mockup.html` lines 222–224 and `calendar-mockup.html` lines
277–279 both now read `380px / 420px / 560px` exactly, and both files'
usages (`modalPanel--lg` for the Library upload/dedupe overlays,
`modal-panel--md`/`--lg` for Calendar's schedule modal / quick-post / asset
picker) reference these corrected classes. The two files now agree with
each other and with the primitive. Resolved.

**2.1 Library status-pill invented hex colors (was BLOCKING) — CONFIRMED
FIXED.** `statusPill()` (library-mockup.html lines 1001–1008) now emits
`badge badge--success`/`badge--neutral`/`badge--warning` with only a
`.statusPill` positioning class layered on top (`position: absolute; top:
8px; right: 8px; backdrop-filter: blur(3px);` — layout only, no color). The
three `.badge--*` tone rules (lines 185–187) are byte-identical to
`Badge.module.css`'s `.neutral`/`.success`/`.warning`. No hex text colors
remain anywhere in the status-pill code path. Resolved.

**3.1 Calendar `.icon-btn` filled background (was BLOCKING) — CONFIRMED
FIXED.** `calendar-mockup.html` line 249: `background: transparent;`,
matching `IconButton.module.css`'s `.iconBtn` exactly (30×30,
`--uiv2-radius-md`, `1px solid var(--uiv2-border)`, transparent fill,
hover → `border-hover`/`text-primary`). Now consistent with Library's own
copy of the same primitive. Resolved.

**3.2 Platform color vars (was "process gap, log it") — CONFIRMED
RESOLVED.** `DECISIONS_LOG.md` now has a dated entry
(`2026-07-07T13:15:00Z`, `calendar-ui-ux-designer`) explaining the
`--platform-*` reuse from `src/styles/tokens.css`/`PostCard.jsx`'s
`PLATFORM_VARS`, superseding the inline-comment-only justification the
prior review flagged. The inline CSS comment (lines 72–74) now also points
at this being a logged, deliberate decision rather than standing alone.
Resolved.

**3.3 `.btn--dangerSolid` missing `:hover` (was minor) — CONFIRMED FIXED.**
`calendar-mockup.html` line 245: `.btn--dangerSolid:hover:not(:disabled) {
filter: brightness(1.06); }` now present, matching
`Button.module.css`'s `.dangerSolid:hover` exactly. Resolved.

**Header `top: 33px`/`top: 27px` offsets — CONFIRMED FIXED.** Both
`.header`/`.page-head` rules now read `position: sticky; top: 0;` (library
line 341, calendar line 191), matching `AppHeader.module.css` exactly. Both
files carry an explicit comment noting the removed offset was a mockup-only
artifact of the dev control bar, not a real product state.

## Fresh scan for anything missed the first pass

Checked full token block verbatim-copy status (still exact vs.
`tokens.css`, including light/dark theme color values), `Badge`/`Button`/
`IconButton`/`Modal`/`Drawer`/`AppHeader` primitive fidelity beyond what was
previously flagged, and grepped both files for stray hex colors outside the
`:root` token block.

- **One non-blocking observation (new): `Drawer` panel base width differs
  between the two mockups and from the primitive's un-parameterized
  default.** Real `Drawer.module.css`'s `.panel` defaults to `width:
  min(400px, 94vw)` when no `width` prop is passed. `library-mockup.html`'s
  `.drawerPanel` (asset-detail drawer) uses `min(460px, 94vw)`;
  `calendar-mockup.html`'s `.drawer-panel` (post-detail drawer) uses
  `min(440px, 94vw)`. Checked against actual usage precedent in the shipped
  app (`StudioPage.jsx` passes `width="min(380px, 92vw)"` for Video Jobs,
  `SessionHistoryDrawer.jsx` passes `width="min(360px, 92vw)"`) — every real
  `Drawer` instance already picks its own bespoke, content-driven width via
  the `width` prop rather than relying on the 400px default, so a
  wider-than-400px width for a richer asset/post detail panel is consistent
  with established practice, not a new pattern. It is **not being raised as
  blocking**, since it doesn't invent a wrong value against a shared scale
  the way the Modal sizes did (Drawer has no shared size-scale to violate —
  each instance is genuinely bespoke by design). Flagging only so a human
  reviewer/builder knows to pass `width="min(460px, 94vw)"` /
  `width="min(440px, 94vw)"` explicitly when wiring the real `<Drawer>` for
  these two screens, and that the two values are intentionally different
  from each other (denser post-detail content in Calendar vs. asset preview
  + metadata in Library) rather than a copy/paste drift. No fix required
  before human review; recommend a one-line note in the eventual build
  packet, not a mockup change.
- No other new invented tokens, hex colors, spacing, radius, or font-size
  values found. `mockupBar`/`.mockupBar select/button` hardcoded
  `#1a1a1a`/`#232323`/`#111`/`#444`/`#fff` values in `library-mockup.html`
  (lines 245–258) are explicitly commented "MOCKUP-ONLY CONTROL BAR ...
  clearly not part of the shipped product" — correctly out of scope, same
  as the equivalent dev chrome already accepted in the first review.
  `.mediaBadge`/`.selectCheck` on-image chip colors (library lines
  371/386) use literal hex/rgba values that are numerically identical to
  `--uiv2-text-primary`/`--uiv2-bg-canvas` dark-theme values (intentional —
  these chips must stay legible over arbitrary photo/video thumbnails
  regardless of active theme) — not a new invented palette, same category
  already accepted for the status-pill's blur/positioning treatment.

## Verdict

**Both `library-mockup.html` and `calendar-mockup.html` are APPROVED — ready
for human review.**

All five previously-blocking findings (mobile nav reinvention ×2, Modal
size invention ×2, status-pill invented hex colors, icon-btn filled
background) and both previously-minor findings (platform-color log gap,
missing dangerSolid hover) were independently re-verified against the live
primitive source files, not just the designers' change summaries, and all
are confirmed correctly fixed with no regressions or new divergences
introduced during the fix pass. The one new item found in this fresh scan
(Drawer base-panel width choice) is informational only, consistent with
established per-instance `width`-prop precedent elsewhere in the codebase,
and does not block human review.
