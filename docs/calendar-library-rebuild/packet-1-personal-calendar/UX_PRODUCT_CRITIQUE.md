# UX/Product Critique — Personal Content Calendar Mockup Gallery

**Reviewer role:** busy social media manager evaluating this as a tool to schedule real client content through, daily, across brands.

**What was reviewed:** the real rendered output of `docs/calendar-library-rebuild/packet-1-personal-calendar/mockups/mockup-gallery.html`, captured live via Playwright at desktop (1440px) and mobile (390px), light and dark mode, across every view, state, and overlay called out in the brief. Screenshots live in `docs/calendar-library-rebuild/packet-1-personal-calendar/mockups/review-shots/` (not committed permanently — delete after sign-off if you don't want render artifacts in the repo). Code referenced: `mockup.css`, `mockup.js`, `mockup-gallery.html`, `tokens.css` in the same folder.

**Overall verdict up front:** This is closer to a finished product than a mockup. The core flows (Month, List, Quick Post, Schedule modal, drawer, empty/loading/error states) are coherent, well-typeset, and honestly worded — better than most live SaaS calendar features I've used. But there are two real bugs and one structural gap that would visibly embarrass the product if a client saw them, plus a handful of smaller polish gaps. None of them are "rebuild it" problems; all are fixable before implementation without rethinking the design.

---

## P0 — blocks trust or looks broken

### P0-1: Cell command palette item text has no line break — reads as broken
**Where:** `#cell-palette` section; live in `mockup.css` lines 922–924; screenshot `review-shots/BUG-cell-palette-closeup.png`.

Clicking an empty day cell opens the palette, and every item renders as **"New postQuick Post composer"** and **"Schedule a draft hereePick from Drafts rail"** — label and hint mashed onto one line with no space between them. This isn't a screenshot-timing artifact; I confirmed it in the CSS: `.cell-palette__item-label` and `.cell-palette__item-hint` are plain inline spans inside `.cell-palette__item-body`, which has no `display:flex; flex-direction:column` (or equivalent) to stack them. The class names and the HTML structure clearly intend two stacked lines (main label, smaller gray hint below) — this is a missed style rule, not an intentional layout.

This is the single worst thing in the whole gallery. It's a tiny popover that a user will open constantly (it's the fastest path to creating a post on an empty day), and every time, the text looks like a templating bug shipped to production. That one impression does more damage to "is this a serious product" than anything else here.

**Fix:** add `display:flex; flex-direction:column;` (or `display:block` on both children) so label and hint stack on separate lines, matching every other two-line item pattern already used correctly elsewhere in this same file (e.g. `.draft-card__meta`, `.cmdbar__suggestion-item`).

### P0-2: Mobile review is invalidated by the gallery shell itself — sidebar never collapses
**Where:** `.gallery-shell` / `.gallery-nav` in `mockup.css` (lines 88–154); no `@media` rule for `.gallery-shell` anywhere in the file (confirmed by searching all `@media` blocks — none target `.gallery-shell` or `.gallery-nav`); every `*-mobile-*.png` screenshot in `review-shots/`.

At 390px width, the gallery's own left nav (`grid-template-columns: 240px 1fr`, fixed 240px) does not collapse, hide, or become a drawer. It permanently occupies 240px of a 390px viewport — 61% of the screen — leaving the actual calendar app squeezed into ~150px. Month view's day-of-week headers ("MON / TUE / WED...") are cut off mid-word, the month grid is illegible, and this is the literal first thing a reviewer or stakeholder sees if they open this file on a phone to "check mobile," directly undermining the page's own claim ("resize the browser to confirm mobile (~390px) → tablet (~768px) → desktop (~1440px) parity in the same markup").

This is good news and bad news. Good news: once you isolate the actual product surfaces from the gallery chrome — I tested the modals/drawers/overlays directly, which render as proper full-viewport overlays unaffected by the side nav — the *product* itself (Quick Post, Schedule modal, drawer) looks genuinely solid on mobile: touch-sized platform pills, readable captions, a usable mini-calendar. So the mobile parity work described in `MOBILE_PARITY.md` may well be sound. Bad news: the in-page calendar grid, drafts rail, and stats strip can't be honestly judged on mobile through this gallery file as it stands, because the harness itself is broken at that width, and no one evaluating this on a phone will know to mentally subtract the broken nav.

**Fix:** add a `@media (max-width: 768px)` rule that collapses `.gallery-nav` into a top bar or hides it behind a toggle so the preview frames get the real available width. This is gallery-harness-only — it does not affect the real implementation — but it should be fixed before anyone else reviews this on a phone, or they'll (reasonably) conclude mobile is unfinished when it likely isn't.

---

## P1 — real, fixable polish gaps

### P1-1: Asset preview in the post drawer and Quick Post is a gray box with a filename, never an actual thumbnail
**Where:** Post detail drawer `.media-preview` (drawer screenshot `CLEAN-drawer-linkedin-desktop-light.png`); Quick Post asset picker tiles (`CLEAN-asset-picker-desktop-light.png`).

The drawer's "Asset preview" section shows a flat gray rectangle with a file icon and the text "video-to-post.mp4" — no actual image/video frame, even a placeholder photo. The asset picker grid in Quick Post is the same: six tiles, each just a generic emoji/icon on gray, no differentiation between what's actually a photo vs. a video vs. an AI render. For a tool whose entire job is scheduling *visual* content, never showing the visual is the single biggest thing keeping this from feeling real. I understand this is "representative content only" per the mockup's own disclaimer, but a thumbnail crop or even a colored gradient placeholder per asset (so the six tiles look visually distinct from each other) would go a long way — right now all six asset tiles in the picker are indistinguishable rectangles differentiated only by tiny emoji.

**Fix:** at minimum, vary background color/pattern per asset tile so they don't look like six copies of the same broken image. In the real build, this is presumably solved once real Library thumbnails wire in — flag that this placeholder treatment must not ship as-is.

### P1-2: "Reschedule…" and "Unschedule" sit adjacent in near-identical orange, one is far more destructive than the other
**Where:** post detail drawer footer, `CLEAN-drawer-linkedin-desktop-light.png` and `CLEAN-drawer-instagram-desktop-light.png`.

In the drawer footer, "Reschedule…" is a solid coral/orange primary button and "Unschedule" is a lighter coral/orange button directly below it. Both read as "the orange button" at a glance. Reschedule just changes a time. Unschedule pulls the post off the calendar back to draft — a meaningfully bigger action a user might do by mistake reaching for the wrong "orange button." Pair that with "Duplicate" sitting as a plain secondary button right next to "Unschedule" in the same row, and the two destructive-ish actions (Unschedule) and safe actions (Duplicate, Save changes) aren't visually distinguished by weight or color family at all — only "Reschedule" gets emphasis treatment.

**Fix:** Unschedule should either move to a clearly "quieter danger" treatment (e.g., a ghost/text button with a confirm step) distinct from Reschedule's primary-accent treatment, or pick up the actual `ui-button-danger` class already defined and used correctly elsewhere in this same file (I can see `ui-button-danger` styling exists in the CSS — it's just not applied to this specific Unschedule button in the drawer, where a different shade of accent color is used instead).

### P1-3: Cmd-K AI result never shows what it's about to change
**Where:** `CLEAN-cmdbar-result-desktop-light.png`.

Typing "move everything on friday to monday" and pressing Enter returns: *"Here is a proposed plan for 'move everything on friday to monday'. Review and apply each change below — nothing is written until you confirm."* — but no actual list of changes appears below it. There's just the templated sentence and two buttons (Apply / Dismiss). The spec is explicit that this AI layer must show a proposal the user confirms, not an auto-write — and the *promise* of a diff is there in the copy ("review... each change below") but the diff itself is absent. As a user, I would not click Apply on something that says "review the changes below" when there's nothing below to review — that's a worse trust signal than not having AI batch-edit at all.

This may simply be out of scope for a static mockup (no real data to diff against), but it's worth flagging explicitly before implementation: the real build needs an actual per-post diff list (e.g., "Tip Tuesday post: Jun 16 9:00 AM → Jun 19 9:00 AM") inside that result panel, not just restated intent.

### P1-4: Today's date badge on the month grid looks like an unread-notification badge, not a date highlight
**Where:** month view, "today" cell (Jun 9 / Jun 23), visible in `month-view-desktop-light.png` and `month-view-desktop-dark.png`.

The current-day cell's date number sits inside a solid red-orange circle, identical in shape/weight to a notification-count badge you'd see on an app icon or sidebar item. At a glance, before reading "Today: Jun 23" in the header, my first read of that circle was "something needs my attention here" rather than "this is today." It's a small thing, but a calendar's "today" marker is one of the highest-frequency visual elements on the page, and right now it borrows a shape vocabulary from "alert/count," not "you are here."

**Fix:** consider a ring/outline or filled-pill-behind-the-number-without-perfect-circle treatment more conventionally associated with "today," distinguishing it from the badge language used for counts elsewhere (e.g., the Drafts rail's "4" count badge uses the same circular shape — so today's-date and draft-count now share a visual signifier they shouldn't).

### P1-5: Draft card readiness text wraps awkwardly at narrower widths
**Where:** Drafts rail open state, `drafts-rail-open-desktop-light.png` — "image · 66%" breaks across two lines inside a fixed-width draft card, leaving "ready" orphaned on its own line in some renders.

Minor, but in a feature that's meant to communicate "this draft isn't ready to publish" at a glance, having the readiness percentage text wrap mid-phrase undercuts the at-a-glance read the readiness bar (the colored fill underneath) is otherwise doing well.

---

## P2 — small things, mention but don't block on

- **Toast stacking/duration:** firing the conflict toast, then the stale-write toast, then a Quick Post submit toast in quick succession stacks up to four toasts before any dismiss (9-second auto-dismiss, confirmed in `mockup.js`). In isolated normal use this is fine — but if a user does a bulk action (the spec mentions bulk reschedule/delete in §5) and each one fires its own toast, this stacking behavior needs a "grouped" or "N actions completed" summary toast instead of one-per-item, or the bottom-left corner will wall off real content during heavy use. Worth deciding now, since bulk actions are explicitly planned for this same engine.
- **Schedule modal checkbox:** in dark mode, the target-account row in the Schedule modal shows an unchecked checkbox next to the Instagram account that isn't visually obvious in light mode at the same spot (compare `CLEAN-schedule-modal-desktop-light.png` vs `CLEAN-schedule-modal-desktop-dark.png`) — worth confirming what that checkbox is for (multi-account select for the fan-out case?) since its purpose isn't explained by adjacent copy.
- **Cmdbar suggestion truncation on mobile:** "Generate a week plan from my un…" truncates mid-word on a 390px viewport. Fine for a suggestion chip, but consider wrapping to two lines instead of an ellipsis cut so the suggestion's intent stays fully legible at a glance.

---

## What's genuinely good (say so plainly)

- **List/Agenda view** is the strongest screen in the gallery. Status pills, day grouping, the honest "via mock connection" tag on the Published pill, and the Failed row's inline guidance ("retry or reschedule from the drawer") all read like real shipped copy, not placeholder text. I would not change this view structurally.
- **Quick Post's per-platform caption pre-fill** is convincingly well done — TikTok's caption is genuinely shorter/casual with an emoji, LinkedIn's is longer and professional in register, X respects its 280-char limit with a live counter. This is the detail that separates "looks like AI" from "looks like a template with {{platform}} swapped in," and it's done right here.
- **Dark mode** is not an afterthought. Contrast holds up, the accent shifts coherently (coral → violet) without breaking any legibility, and the warning/conflict banners keep their meaning (amber stays readable amber, not muddy brown). Many products treat dark mode as inverted colors; this one clearly got designed in both modes.
- **Empty, loading, and day-error states** all do the honest thing the spec asks for: the empty state never hides the calendar grid behind a blank illustration, the loading skeleton matches the real card shapes (not generic bars), and the day-error slide-over visibly leaves the rest of the month grid untouched, which is the right way to build user trust in a partial failure.
- **The three reschedule modes** (drag, full panel, tap-to-select) are a genuinely thoughtful accessibility-driven design decision, not boilerplate — tap-to-select's sticky banner + dashed-outline destination highlighting communicates state through shape, color, and text together, exactly as WCAG 2.5.7 requires, and it's actually pleasant to use, not just compliant.

---

## Would I keep using this page?

Yes — conditionally. If P0-1 (cell palette text bug) ships as-is, I'd lose confidence in the team's QA the first time I opened that popover, because it's the kind of bug that's impossible to miss once you see it and easy to read as "they didn't even look at this before shipping." Fix that one thing and this calendar already feels more trustworthy than several live competitors' equivalents. The List view and Quick Post composer in particular are good enough that I'd happily make them my daily entry point for scheduling client content.

## Top 3 fixes that most raise perceived quality

1. **Fix the cell command palette label/hint stacking bug (P0-1).** Single CSS rule, single biggest "is this finished" signal in the whole gallery.
2. **Give real visual variation to asset thumbnails (P1-1)**, even fake placeholder color variety — a content calendar with six identical gray boxes for "your photos and videos" undercuts the product's entire premise at the most-looked-at moment (deciding what to attach to a post).
3. **Fix the gallery's mobile nav collapse (P0-2)** so anyone (including future reviewers) can actually evaluate mobile through this file — right now the harness itself is lying about what mobile looks like.
