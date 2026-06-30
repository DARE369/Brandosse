# Mobile UX Critique — Packet 1, Personal Content Calendar (Phase 2 mockup)

**Reviewer:** mobile-ux-specialist (mobile-native judgment, not mechanical compliance)
**Subject:** `docs/calendar-library-rebuild/packet-1-personal-calendar/mockups/mockup-gallery.html` (+ `mockup.css`, `mockup.js`)
**Method:** Rendered in real Chromium at 390×844 under genuine touch emulation (`hasTouch`, `isMobile`, DPR 2) via Playwright (already a project dependency). The gallery's own chrome (left nav, section descriptions, `.gallery-frame { resize:horizontal }`) was neutralized per-shot so each product surface actually received the full 390px — without that, the harness forces document overflow and pushes the real frame off-screen, which is a known harness artifact, not a product bug. Overlay box geometry and primary-button viewport position were measured with live `getBoundingClientRect()`. Screenshots saved under `mockups/__shots/` (the `F*.png` set is the chrome-stripped, true-width set; judge from those).
**Persona:** Solo Sade — personal workspace, on her phone between client visits; cares about speed, thumb-reachable actions, not losing work on flaky connections (Master Brief §5).

---

## VERDICT: Mixed — mobile-native in the parts built as lists/sheets/overlays; a shrunk desktop view in the one place it matters most (the default Month grid).

This is **not** a lazy reflow across the board. Several surfaces are genuinely designed for the phone: the List/Agenda view, the post detail drawer, the Schedule modal, the toasts, and the new tap-to-select reschedule pattern are all real mobile patterns done with care. But the **Month view — which is the calendar's default, named-primary surface — is a desktop 7-column grid scaled down to 390px**, and it fails the core mobile-native test. Because Month is what loads first, the *first impression* of this screen for Solo Sade is the weakest, most desktop-shaped part of the whole packet. That's the headline problem.

A second structural issue cuts across the creation flow: **the Quick Post composer's primary action is stranded ~600px below the fold** with a non-sticky footer, so the most important "speed" action for an on-the-move persona requires a long scroll to commit.

---

## Surface-by-surface

### 1. Month view — **P0. This is a resized desktop grid, not a phone calendar.**
Rendered at 390px (`__shots/F01-month.png`), the full Mon–Sun 7-column grid is kept. Consequences, all classic "resized web view" smells:

- **7 columns in 390px → ~55px per cell.** Below 520px the post cards collapse to *dots-only* (label and time `display:none`, per `mockup.css` §615–624). So a scheduled post becomes two tiny colored dots in a ~40px chip. **Solo Sade cannot tell what any post is** — not the title, not the time, not the platform name — without opening something. That is information *destroyed* by the small screen, not adapted to it. The parity report calls this "same data, denser glyph"; experientially it is not the same data, it's an unreadable token.
- **Each week row is enormous.** With `grid-auto-rows: minmax(84px, 1fr)` stretched by flex, a near-empty week still renders ~470px tall on this capture. The month becomes a very long scroll through mostly whitespace — the opposite of "fast glance on the move."
- **Primary actions stranded at the top.** Header wraps to: title row, then a floating centered row of Month/List + ⌘K + Quick Post, leaving dead gutters left and right. All of these sit at the very top of a multi-thousand-pixel scroll — the worst zone for one-handed reach. There is **no bottom tab bar, no FAB, no sticky create affordance.**
- **The per-cell "Move" (⤢) chip** is rendered next to a ~40px card in a 55px column (two side-by-side targets in one tiny cell). Even setting aside that the parity report found these Month-grid Move buttons functionally broken (`closest()` sibling bug), visually this is a desktop hover-era affordance crammed into a touch cell.

**What "great" looks like here:** On phones, Month should not be the literal 7×6 grid. Default Solo Sade into the **Agenda/List view** (the mockup already builds a great one) and treat Month as a **compact month strip / mini-month that scrolls to a day's agenda**, or a dot-density month *overview* whose only job is "tap a day → see that day's list," never "read posts inside a 55px cell." The gallery's own copy already admits "Agenda becomes the recommended view... on narrow phones" — so make that the actual default at mobile width instead of leaving the desktop grid as the landing surface. Add a persistent thumb-zone create affordance (bottom-anchored "+ " / Quick Post FAB or a bottom bar) instead of a top-stranded button.

### 2. List / Agenda view — **Genuinely mobile-native. Keep it; promote it.**
`__shots/F02-list.png`: full-width rows, 16px titles (Fix 10 correctly bumped `.post-row__title` to `--text-md`), clear icon+label+color status pills, comfortable thumbnail + body + meta, generous tap targets, sticky day-group headers. This is exactly what a phone content calendar should feel like. It reads instantly one-handed. This view, not Month, should be the phone home surface.
- *Minor (P2):* the filter bar (search + two `<select>`s) wraps to up to 3 rows at 390px and pushes the first post down. Consider collapsing status/platform filters behind a single "Filter" chip that opens a sheet.

### 3. Drafts rail — **OK but desktop-shaped interaction model.**
`__shots/F03-drafts.png`: a horizontally-scrolling rail of 110px cards pinned under the grid. Horizontal scroll for a *primary* content shelf is a weak mobile pattern (low discoverability, easy to miss cards 4+, fights vertical page scroll). The Move button per card is correctly always-visible under coarse pointer and hits 44px via `::before` padding — good. But on a phone, "drag a draft onto a 55px calendar cell" is effectively unusable; the rail's own hint still leads with "drag onto the calendar."
- *P1:* On mobile, lead with **tap-Move** (which works), de-emphasize drag, and consider making the rail a **vertical "Drafts" sheet** (bottom sheet listing drafts as full rows) rather than a horizontal filmstrip.

### 4. Tap-to-select → tap-destination reschedule — **The best thing in the packet. Deliberate and native — in the row context.**
`__shots/F04-tap-move.png`: tapping Move outlines the source card in accent, drops a **sticky banner** ("Moving *Tip Tuesday post* — tap a highlighted day...") with a Cancel button, and gives every valid destination a dashed accent outline + tint. Status is shape + color + text, never color alone; Escape/Cancel/re-tap all exit. This reads like a real iOS/Android "move/select" mode, not a bolted-on workaround. **This is the right answer to "drag doesn't work on touch."**
Two caveats keep it from full marks:
- **It shines in the standalone demo because the cards there are full-width `.post-row`s.** Hosted in the real Month grid, the trigger is the cramped 55px-cell ⤢ chip (see §1), and the parity report found that exact instance non-functional. The *pattern* is excellent; its *home on the real grid* is not. Fixing §1 (agenda-first mobile) largely fixes this too — run the move flow over full-width rows.
- The sticky banner sits at the top; the Cancel is top-right. Fine, but a bottom-sheet confirm bar ("Tap a day · Cancel") would sit better in the thumb zone during a one-handed move.

### 5. Post detail drawer — **Mobile-native (full-screen sheet), one density nit.**
Measured 390×844 at x:0,y:0 — a true full-screen sheet on mobile (`__shots/F05-drawer.png`). Platform caption tabs, readiness checklist, paired footer actions (Save/Reschedule, Duplicate/Unschedule) anchored at the bottom in thumb reach. This is well done.
- *P2:* the `aspect-ratio:1/1` asset preview consumes ~half the first screen for a placeholder; on a tall phone a 16:9 or capped-height preview would get the captions/actions above the fold faster.

### 6. Quick Post composer — **P1. Full-screen sheet (good) but the commit action is below the fold.**
Full-screen at 390×844 (good). But with all four platforms toggled on, the primary **"Schedule post" button measures at y≈1441 in an 844px viewport — ~600px below the fold, `inView:false`**, and `.quickpost-footer` is **not sticky** (it scrolls with content, `mockup.css` §1077). For a "speed, on the move" persona, the single most important action (commit the post) is the hardest to reach. The per-platform stacked caption cards also make the form very tall fast.
- *Fix:* make `.quickpost-footer` a **sticky bottom action bar** (Save draft / Schedule) pinned in the thumb zone at all times; consider collapsing inactive platform caption rows to accordions so the form doesn't balloon.

### 7. Schedule modal — **Mobile-native.** Full-screen at 390×844, `border-radius:0`, edge-to-edge (`mockup.css` §1141). Explicit account-timezone banner, mini-calendar days bumped to 44px on mobile (§1143), target-account card, conflict banner. Solid. *P2:* footer (Cancel/Confirm) is not pinned; on a tall modal it can require a scroll, same class of issue as Quick Post but milder.

### 8. ⌘K command bar — **P2. Desktop palette, not a mobile sheet.** Measured 358px wide, anchored at y:84 as a floating centered card with a 16px margin (`__shots/F08-cmdbar.png`). It reads as desktop "Spotlight," not a native command sheet. It's a secondary/power feature so this is low priority, but on mobile it should be a **bottom sheet** (input near the bottom where the keyboard rises, suggestions stacked above) rather than a top-floating dialog. Also: a ⌘K affordance is desktop-idiom; on phone it's reachable only via the header button, which is itself top-stranded.

### 9. Cell command palette — **P2.** A 260px absolutely-positioned popover anchored to a cell. On the real 55px mobile cell this has nowhere good to anchor and will collide with edges. On mobile this should be the **day's bottom sheet** ("New post / Schedule a draft / Ask AI") opened by tapping the day — which dovetails with the agenda-first recommendation in §1.

### 10. Toasts — **Mobile-native.** Bottom-centered, `min(440px, 100vw−32px)`, 44px close, clear title/description/actions ("Schedule anyway" / "Undo move"). Correct position (thumb zone) and correct non-blocking behavior. Clean pass.

### 11. States (empty / loading / day-error / conflict / stale) — Reasonable. Empty state centers a single Quick Post CTA (good intent, but it's centered = not thumb-zone; a bottom-anchored CTA would be better on phone). Loading/skeleton and error/retry are fine and on-brand.

---

## Thumb-reachability scorecard
| Surface | Primary action location | Thumb-reachable? |
|---|---|---|
| Month view | Quick Post / ⌘K at top of tall scroll | No — stranded top |
| List/Agenda | rows fill screen; no persistent create | Partial (no FAB) |
| Quick Post | Schedule button ~600px below fold, non-sticky | No |
| Schedule modal | footer not pinned | Partial |
| Post drawer | footer at bottom | Yes |
| Toasts | bottom-centered | Yes |
| Tap-to-move | banner/Cancel top; destinations in grid | Partial |

The recurring miss: **no persistent thumb-zone primary action** anywhere, and **non-sticky footers** in the two creation overlays. A bottom tab/FAB + sticky overlay footers would lift the whole experience.

---

## Is any piece "a shrunk desktop view wearing a mobile costume"?
- **Yes, unambiguously:** the **Month view** (desktop 7-col grid at 390px with content reduced to unreadable dots) and the **⌘K command bar** (top-floating desktop palette).
- **Costume-but-actually-native underneath:** the drawer, schedule modal, and Quick Post *are* real full-screen sheets — their problem is internal (below-fold actions), not fake-mobile.
- **Genuinely mobile-native:** List/Agenda, tap-to-select reschedule (in row context), toasts.

---

## Top 3 mobile changes (highest experience impact)
1. **Default phones to Agenda/List, and demote Month to a tap-a-day overview.** Stop rendering a readable-content 7-column grid at 390px; the dots-only fallback destroys information. The great agenda view already exists — make it the mobile home, and let Month be a compact month strip whose cells only route to a day's list.
2. **Add a persistent thumb-zone primary action and make overlay footers sticky.** A bottom-anchored "+ Quick Post" (FAB or bottom bar) on the calendar, and a pinned bottom action bar in Quick Post + Schedule modal so "Schedule post" is never ~600px below the fold for a one-handed, on-the-move user.
3. **Run the tap-to-select reschedule over full-width rows, not 55px grid cells.** The interaction is excellent; host it where it works (agenda rows / day sheet) instead of the cramped, currently-broken Month-grid chip — which also retires the desktop hover-era ⤢ affordance on touch.
