# QA Persona Review — Mockup Phase (RE-TEST)
Packet 1: Personal Content Calendar — `mockup-gallery.html`

**Status: this report SUPERSEDES the prior verdict dated 2026-06-23.** That review is preserved in full below the line marked "ORIGINAL REPORT (SUPERSEDED)" for audit-trail purposes — do not delete it, but treat only this top section as current.

Agent: `qa-persona-agent`
Persona walked through: **Solo Sade** (personal workspace, phone, on the move between client visits, cares about speed, thumb-reachable actions, not losing work on flaky connections) — the packet's named primary persona for this phase.

**Reviewed:** `docs/calendar-library-rebuild/packet-1-personal-calendar/mockups/mockup-gallery.html` (+ `mockup.css`, `mockup.js`, `tokens.css`) after three rounds of fixes documented in `DECISIONS_LOG.md` ("Phase 2 (revision)", "Phase 2 (re-review)", "Phase 2 (re-test)", and "Phase 2 (fix)" sections) — specifically Round 3's fix to the real Month-grid Move button (`data-card-name` moved from `.post-card` onto the shared parent `.post-card-row`), which `mobile-responsive-parity-agent` found broken on its own re-test and which I am independently confirming live in this pass, not taking on the fix report's word.

**Method:** Real Chromium browser via Playwright (already a project dependency), driven against the gallery served from a local static HTTP server (stopped after testing). Desktop context: plain `viewport: 1440×900`, fine pointer, no touch. Mobile context: Playwright's `devices['iPhone 13']` preset (390×844 logical, `hasTouch: true`, `pointer: coarse` correctly reported), using real `.tap()` calls under genuine touch emulation, not a fine-pointer click dispatched at a resized window. Real mouse-drag sequences (`mouse.down` → multi-step `mouse.move` → `mouse.up`) were used for the native-HTML5-drag flows — unlike the original review, these worked and produced real `dragover`/`drop` browser events, confirmed by visible `is-drop-candidate` highlighting mid-drag and a real post-drop confirmation flash, not just a dispatched-event simulation. Screenshots were captured at both widths for every flow and inspected directly, not inferred from DOM state alone. All throwaway driver scripts and screenshots were written outside the deliverable tree and deleted after extracting findings; none are a deliverable.

## Verdict: PASS, with one real but non-blocking friction point and one harness-only (non-product) caveat

All four assigned flows now work, at both widths, exactly as the underlying interaction design intends — including the Round 3 fix, which I verified myself rather than trusting the fix report. The page-wide `[hidden]` CSS bug, the Drafts-rail Move-button gap, the silent Quick Post submit, and the single-platform-only caption pre-fill — all four hard findings from my original review — are independently confirmed resolved through live interaction. I found no new blocking defect. From Solo Sade's standpoint specifically, every flow she needs (schedule a draft, reschedule a post, create via Quick Post, understand a conflict) now behaves the way a first-time user would expect with zero explanation, on the device she'd actually be using (phone, touch, on the move).

I also independently surfaced one thing worth a sentence of attention before human review, even though it doesn't change my pass verdict: the gallery's own table-of-contents sidebar (explicitly labeled in `mockup.css` as "GALLERY CHROME — not part of the product") never collapses below any breakpoint, so a human opening this file on an actual phone will see a cramped, two-column layout where the nav eats roughly 60% of the screen width. This is real and I confirmed it with a live screenshot, but it is test-harness packaging, not the calendar design itself — flagging it so whoever demos this to the human knows to either resize a real browser window or be ready to explain why the gallery's own nav looks squeezed on a literal phone, separate from anything about the actual Month grid / Quick Post / Drafts rail design.

---

### Flow 1 — Schedule a draft from the Drafts rail

**1a. Desktop (1440px), drag a draft onto a calendar date.**

What Sade was trying to do: drag "Office hours promo" from the open Drafts rail onto a date a few days out.

What happened, verified by a real mouse-drag sequence (not a dispatched event): the drag worked. Mid-drag, the destination cell (Jun 23) correctly showed the dashed-outline `is-drop-candidate` highlight (screenshot captured at this exact moment). On drop, the cell showed a green "Moved to Jun 23 (today)" confirmation flash, and the card moved off the Drafts rail visual onto the calendar. This contradicts my original review's finding that "native HTML5 drag can't be triggered by synthetic mouse events" — with a slower, multi-step `down → small-move → larger-move → up` sequence (rather than a single large jump), Chromium's native drag threshold fires correctly. I'm noting the contradiction explicitly rather than silently dropping it: the original finding was a testing-technique limitation in that pass, not a real defect in the design, and this pass confirms the underlying drag mechanism genuinely works for a real user with a real mouse.

Would it make sense to Sade without explanation: yes. Dragging a card from a clearly-labeled "Drafts" rail onto a calendar date is one of the most self-explanatory gestures in software; nothing here needed a tutorial.

**1b. Mobile (390px), tap-to-select then tap-destination.**

What Sade was trying to do: same task, but standing, one hand on her phone between a client's office and her car — exactly the scenario her persona profile names.

What happened, verified by a real touch tap (`hasTouch` context, not a click on a resized window): tapping the Move button on "Office hours promo" correctly entered move mode — the banner read "Moving **Office hours promo** — tap a highlighted day to schedule it there" with a visible Cancel, and destination cells lit up with the dashed purple highlight. Tapping a highlighted cell correctly committed the move and showed "Weekly roundup draft moved to Jun 8" (tested with a second draft card to rule out a one-card fluke) as a green confirmation directly in the grid. I also re-confirmed the previously-fixed gap from my original review still holds fixed: tapping the draft card's *body* (not the Move button) does nothing, which is fine — the card body isn't meant to be the trigger, the Move button is, and it is now present, correctly sized, and working.

Would it make sense to Sade without explanation: yes, now. The exact gap my original review flagged as a hard Fail — "the rail's own copy promises a Move button that doesn't exist on draft cards" — is closed. The Move button exists, is labeled, is reachable on first paint on a real touch device (confirmed: `opacity: 1` with zero prior interaction under `pointer: coarse`, the device condition Sade's actual phone reports), and the resulting banner/commit/confirmation sequence is exactly as clear as it was in the original review's isolated demo-section testing — except now it's the real Drafts rail, not just a demo.

**Remaining friction:** none new. The previously-flagged 34px Move-button-height-under-44px finding is resolved (verified geometrically by the parity agent's `::before` expanded-hit-target technique, and I independently confirmed the button is tappable without precision on a real touch context).

---

### Flow 2 — Reschedule an already-scheduled post on the real Month grid

This is the flow that was silently broken until minutes before this re-test (per the task brief), so I want to be explicit about what "confirmed live" means here: I did not read the fix description and accept it. I drove a real Playwright session against the patched file myself, on both a fine-pointer desktop click and a genuine touch-emulated tap, and watched the actual resulting DOM state and a screenshot, before writing this section.

**2a. Drag (desktop), real Month-grid card.**

Attempted a real mouse-drag on a real Month-grid post card (not the standalone demo section). Native drag triggered correctly using the same multi-step mouse sequence as Flow 1a. Reported here for completeness; this mode was never the one in question for the Round 3 bug (that bug only affected the Move-button click path).

**2b. Tap-to-select → tap-destination, real Month-grid card — the just-fixed flow.**

What Sade was trying to do: reschedule "Tip Tuesday" (currently Jun 16) to a different date, on her phone, on the actual Month view she'd actually be looking at day to day — not a demo section built to showcase the pattern in isolation.

What happened, step by step, verified live:
1. Scrolled to the real Month grid (not the dedicated "Reschedule mode 3" demo block). Found the card for "Tip Tuesday" inside its real `.post-card-row` wrapper, with a visible Move button (the crossed-arrows icon chip) sitting next to the post card itself.
2. Tapped the Move button with a real touch tap. It worked. `.is-selected-for-move` was applied to the card, and the sticky banner appeared: "Moving **Tip Tuesday** — tap a highlighted day to schedule it there," with a Cancel button. Screenshot captured at this exact moment shows the banner clearly, plus a visible dashed purple-tinted highlight on every valid destination cell across the visible grid (confirmed at least three highlighted cells in the captured viewport: Jun 8/9 block and the Jun 22/23 block).
3. Scrolled to and tapped one of the highlighted destination cells. It worked. The grid cell where "Tip Tuesday" used to sit showed a green "Tip Tuesday moved to Jun 9" confirmation pill directly inline in the grid (screenshot captured), and the banner correctly disappeared.
4. Repeated the equivalent flow on desktop (1440px, real mouse click rather than tap) against a different card ("LinkedIn carousel — Q3 recap") to rule out a one-card fluke or a width-specific fix: same result — Move button click correctly entered move mode with the correct card name in the banner, clicking the highlighted destination correctly committed and the banner correctly disappeared afterward (`bannerHiddenAfter: true`).

This is the literal repro the task asked me to run "live, don't take the fix report on faith," and I'm reporting the literal result: **it now works**, on both a real touch tap and a real mouse click, on the actual Month-grid surface, not just the standalone demo section. The previous bug (`btn.closest('[data-card-name]')` resolving to `null` because the attribute lived on a sibling, not an ancestor) is gone — I confirmed the markup directly: `data-card-name` now sits on `.post-card-row`, the shared parent of both the post card and the Move button, for every real grid card I inspected.

Would it make sense to Sade without explanation: yes, unambiguously. A labeled Move button, an unambiguous "Moving X — tap a highlighted day" banner naming the exact post by name, clearly distinguishable destination highlighting (dashed outline plus a violet tint, not color alone), an always-visible Cancel, and an inline plain-language confirmation after commit ("X moved to [date]") — every one of her stated priorities (speed: two taps total; thumb-reachable: the Move button measures a real 44×44px+ effective hit area; not losing work: nothing commits until the second tap, and Cancel is always present) is satisfied, and now on the real surface she'd actually use.

**2c. Full detail-panel edit.** Unchanged from the original review and still good: the drawer's native date/time fields with the explicit "America/New_York (UTC−4)" timezone label remain the heaviest of the three reschedule paths, appropriately so, since it's also where caption/platform edits happen.

**Remaining friction, carried forward from the parity report, independently re-confirmed by me, judged non-blocking:** the List/Agenda view has zero Move triggers (confirmed: 0 matches for `[data-move-trigger]` inside `#list-view`). Its only reschedule path is the heavier detail-drawer date fields. This still satisfies the letter of the non-drag-alternative requirement (a single-pointer alternative does exist, just the heavier one), and List/Agenda was never the surface this lighter pattern was scoped to — Month view was. Not a blocker, but noting it so it isn't silently forgotten heading into Phase 3.

---

### Flow 3 — Quick Post, zero-asset path, end-to-end (mobile, then cross-checked desktop)

**What Sade was trying to do:** a quick Instagram + TikTok post with no Library asset, scheduled in the gap between two client visits.

**Walkthrough, verified by real taps/clicks at 390px, then repeated at 1440px to confirm no width-specific regression:**

1. Opened Quick Post via the real header button (not a demo-section stand-in). Modal opened correctly at both widths.
2. Toggled TikTok on. The caption row appeared with **its own distinct, register-appropriate sample text** — "wait for it... 👀 #brandosse #newdrop" — visibly different in tone and content from Instagram's "Excited to share our latest update with you all today!", with its own "✨ Pre-filled by AI — edit freely" note and a live character counter reading "54 / 2200." This directly resolves my original review's flagged gap (caption pre-fill demonstrated for Instagram only). I also toggled LinkedIn and confirmed its sample text is a third, distinct, longer-form/professional register ("We're excited to share an update on what our team has been building this quarter — read on for the details and what it means for our customers."), not a copy-paste of either of the other two.
3. Pressed "Save as draft." The modal closed, and **a real confirmation toast appeared**: a green checkmark icon, bold title "Saved as draft," and the body text "Find it in the Drafts rail or the Library anytime — nothing was lost." This is the exact fix for my original review's top Sade-specific finding (silent submit contradicting her "don't lose work" concern) — verified by screenshot, not just by reading the toast template in the markup.
4. Waited for the toast's full 9-second auto-dismiss, then reopened Quick Post, toggled on TikTok and LinkedIn again, and pressed "Schedule post" instead. A **second, distinctly-worded toast** fired: "Post scheduled — It now appears on the calendar at the time you set, in your account timezone." Confirmed this is genuinely a different message from the draft-saved toast (not a copy-paste), and confirmed via the same toast mechanism that it, too, persists correctly after the modal closes.
5. Re-confirmed the timezone banner ("Times shown in your account timezone: America/New_York (UTC−4)") is still present and unchanged — still the right fix for the AS-IS audit's flagged real-`ScheduleModal.jsx` bug.

**Would the end-to-end flow make sense to Sade without explanation:** yes, on both submit paths now. The numbered-step structure is self-narrating, the per-platform captions now demonstrate genuinely platform-tailored pre-fill rather than implying a broader capability than what's shown, and — the part that matters most for her specific anxiety — she now gets an explicit, plain-language acknowledgment after both "Save as draft" and "Schedule post," each phrased to directly answer the question a flaky-connection-wary user would otherwise be left wondering about ("nothing was lost" / "it now appears on the calendar... in your account timezone"). I deliberately tested both submit paths separately, as the task asked, rather than assuming the fix covered both because it covered one — both are confirmed independently.

**One real, non-blocking methodology note for whoever re-tests this next:** the toast auto-dismisses after 9 seconds and a second toast fired before the first one fully clears will visually read as the *first* toast's text if you don't wait for the clear — I hit this myself on my first pass through this exact flow and want it on record so it isn't mistaken for a product bug by the next person testing this: it's a timing artifact of testing too fast, not a real defect. Once I waited the full 9 seconds, the "Post scheduled" toast read correctly and distinctly from "Saved as draft."

---

### Bonus — Stale-write / conflict toasts, re-checked

**What Sade was trying to do (hypothetically, since this is a system-initiated state, not something she does on purpose):** understand what happened if a drag/move lands on an already-occupied slot, or if her own edit collided with a change from another of her own devices.

**Re-confirmed, verbatim, at mobile width via a real tap:**
- Conflict toast: "Time slot already taken — Another post is scheduled to this account at the exact same time. Nothing was overwritten." with "Schedule anyway" / "Undo move" buttons, both clearly legible and tappable side-by-side even within the gallery's own cramped harness column.
- Stale-write toast: "This post changed elsewhere — It was updated from another tab or device since you opened it. We refreshed this card to the latest version — your move was not applied." Dismiss-only, no action buttons, as previously documented and judged intentional (nothing to undo since the move wasn't applied).

No change from the original review's pass verdict here — both toasts still read in plain language, name a real-world cause Sade would recognize from her own life ("another tab or device," not "concurrency"), and state outcomes rather than just naming a problem. **Still a clean pass.**

---

### A note on the gallery harness itself (not a verdict on the design)

While testing at 390px, I found that `.gallery-shell`'s nav sidebar (`mockup.css` explicitly comments this as "GALLERY CHROME — not part of the product — the index/nav around each state") never collapses at any breakpoint. On a real device profile, this means the gallery's own table-of-contents column eats roughly 240px of the 390px viewport, leaving the actual content description column squeezed into the remainder — confirmed with a live screenshot showing the page's own intro heading wrapping to one or two words per line. This does not affect any of the actual calendar/Quick-Post/Drafts-rail product surfaces I tested inside that squeezed column — every one of them (the Month grid, the move-mode banner, the Quick Post modal, the toasts) rendered and behaved correctly once scrolled to and interacted with, as documented in each flow above. I'm flagging this only because a human reviewer opening this exact file on their own phone, rather than a resized desktop browser, will hit the same cramped nav and should know in advance that it's the gallery's own packaging, not the calendar design being evaluated.

---

## Summary verdicts

| Flow | Verdict | Why |
|---|---|---|
| 1a. Drag a draft onto a date (desktop) | **Pass** | Real native HTML5 drag confirmed working this pass (prior "untestable via synthetic mouse events" was a testing-technique limitation, not a real defect) |
| 1b. Tap-to-select a draft → tap-destination (mobile) | **Pass** | Previously a hard Fail (no Move button existed); now present, correctly sized, and confirmed working end-to-end via real touch tap, with a clear inline confirmation |
| 2a. Drag reschedule, real grid (desktop) | **Pass** | Confirmed working with a real mouse-drag sequence |
| 2b. Tap-to-select → tap-destination, real Month-grid card (mobile + desktop) | **Pass** | The just-fixed flow — independently confirmed live via real tap and real click, not taken on faith; banner, destination highlight, and inline confirmation all correct, on the real grid, not just the demo section |
| 2c. Full detail-panel edit | Pass (unchanged) | Native date/time fields with explicit account-timezone label |
| 3. Quick Post end-to-end, zero-asset (mobile, cross-checked desktop) | **Pass** | Per-platform pre-fill now genuinely distinct per platform (not Instagram-only); both "Save as draft" and "Schedule post" now produce clear, distinctly-worded confirmation toasts, tested separately |
| Bonus: stale-write/conflict toasts | Pass (unchanged) | Plain-language copy, real-world framing, states outcomes |
| List/Agenda view Move trigger | Open, non-blocking | No lighter tap-to-select path in List view; heavier drawer fallback still satisfies the underlying accessibility requirement |
| Gallery harness nav on real mobile width | Note, not a design defect | Test-harness chrome only; does not affect any product surface tested |

## Recommendation

From my standpoint, this mockup is ready to recommend for human approval. All four flows named in this re-test work as designed, on both a real touch tap and a real mouse/click, at both the mobile and desktop widths Sade would actually use. The specific bug this re-test existed to catch — the Move button on real Month-grid cards silently doing nothing — is fixed and I confirmed that myself, live, rather than accepting the fix report. I found no new blocking defect in this pass. The one open item (List/Agenda's missing lighter Move path) and the one harness-packaging note (the gallery's own nav not collapsing on real mobile widths) are both worth a sentence in the human's review but are not reasons to send this back for another fix cycle.

---

# ORIGINAL REPORT (SUPERSEDED) — 2026-06-23, first pass

*(Preserved verbatim below for audit-trail purposes. Do not treat as current — see superseding verdict above. The findings below describe the gallery BEFORE three rounds of fixes documented in `DECISIONS_LOG.md`; the page-wide `[hidden]` CSS bug, the Drafts-rail Move-button gap, the single-platform caption pre-fill, and the silent Quick Post submit described below are all resolved as of the re-test above.)*

## Headline finding before the per-flow walkthrough

**There is a single, severe, page-wide bug in the mockup's shared overlay CSS that breaks every modal/drawer/command-bar/slide-over trigger in the gallery, on every device width.** This is not specific to one flow — it affects all four flows below, so it's documented once here and then referenced by each flow section.

Root cause: `.cmdbar-overlay`, `.modal-backdrop`, `.drawer-backdrop`, and `.slideover-backdrop` are declared with `display: flex` (or similar) directly on the class selector, with no `:not([hidden])` qualifier anywhere in `mockup.css`, and there is no `[hidden] { display: none; }` reset rule in the stylesheet at all. The HTML `hidden` attribute is present on every one of these elements when "closed" (confirmed in markup), but because the author stylesheet's class-level `display` declaration has equal-or-greater specificity to the browser's own `[hidden]` UA-stylesheet rule, **the class wins**. Verified directly in a live Chromium page, on a freshly loaded gallery with zero prior interaction:

```
On fresh load: [
  {"id":"cmdbar-overlay","hidden":true,"display":"flex"},
  {"id":"quickpost-modal","hidden":true,"display":"flex"},
  {"id":"schedule-modal-demo","hidden":true,"display":"flex"},
  {"id":"post-detail-drawer-demo","hidden":true,"display":"flex"}
]
```

Every one of these "closed" overlays is actually rendered, `position: fixed; inset: 0`, full-viewport, with `z-index` 60–70 and `pointer-events: auto`, stacked on top of the entire page at all times. Confirmed with `document.elementFromPoint()` at arbitrary coordinates (returns `cmdbar-overlay`, not the page content underneath) and, most importantly, confirmed with Playwright's real actionability engine — the same hit-testing a genuine user's click goes through — which times out after 30s of retries trying to click the real, visible "+ Quick Post" header button on a **completely fresh page load, before any other interaction**:

```
- <div hidden="" id="cmdbar-overlay" class="cmdbar-overlay" data-backdrop-close="">…</div>
  intercepts pointer events
- retrying click action ... (54 retries, 30s timeout)
```

I isolated this further to separate "is the CSS hit-testing broken" from "is the underlying JS logic broken," because those are different bugs with different fixes:
- Dispatching a raw `click` event directly at the JS level (bypassing browser hit-testing) onto the correct element (the Move button, a destination cell, a toast trigger) **works exactly as designed** — `enterMoveMode()` correctly selects the card, highlights all 17 valid destination cells, shows the banner; clicking a destination correctly commits and dismisses the banner; toast firing works. So **the interaction logic itself is sound** — this is purely a CSS/hit-testing defect, not a logic defect.
- But any *real* click — mouse, the standard Playwright click flow, or a forced click that still goes through the browser's own event-target resolution — lands on the invisible `cmdbar-overlay` (or whichever stacked overlay happens to be topmost) instead of the intended button, **every single time**, at every width tested.

What this means for Sade specifically, and for this review: every screenshot below that should show "Quick Post modal open" or "Move-mode banner active" in isolation instead shows the Schedule Modal, the ⌘K command bar, and the Post Detail Drawer all stacked on top of each other simultaneously — because once any one overlay's `hidden` attribute is toggled off, it joins the pile of already-rendered-but-supposedly-hidden siblings sitting at z-index 60–70, and whichever one happens to paint last visually wins. This is a real, true-to-the-current-file bug, not a test-harness artifact — I verified it three independent ways (computed style, `elementFromPoint`, and Playwright's actionability engine) and the result was identical every time.

**This is flagged for the mockup author before this review's per-flow findings are read as a verdict on the design itself** — the interaction design demonstrated by direct JS dispatch (see screenshots and findings below) is, in every flow, the thing Sade would actually experience once this CSS bug is fixed. The findings below describe both: what the design intends (verified via direct JS dispatch, which proves the logic) and what a real click currently does (broken, due to this bug) — both are reported because both are true today.

---

## Flow 1 — Schedule a draft from the Drafts rail

### 1a. Desktop (~1440px) — drag a draft onto a calendar date

**What Sade was trying to do:** She's at her desk for ten minutes between client calls, catching up on the week. She wants to drag "Weekly roundup draft" from the open Drafts rail under the Month grid onto Jun 26.

**What happened:** Scrolled to the Month view + Drafts rail (`#drafts-rail-month`), confirmed the rail is open with 4 draft cards, each `draggable="true"`. Performed a real `mouse.down()` → `mouse.move()` (10 steps) → `mouse.up()` sequence from the first draft card to the Jun 26 day cell. **The native HTML5 drag did not register a drop on the target cell** — no `is-drop-candidate` highlight appeared during the drag and no "Moved to Jun 26" confirmation flash appeared afterward, screenshot `02-desktop-after-mouse-drag-attempt.png` shows the page unchanged. This is consistent with how the mockup itself frames this: it uses synthetic `mousedown`/`mousemove`/`mouseup` to test drag intent, but the actual code path relies on the browser's native HTML5 Drag and Drop API (`dragstart`/`dragover`/`drop` events), which requires the browser to fire its own native drag gesture, not a sequence of plain mouse events — a real human dragging with a real mouse in a real browser would trigger this correctly (confirmed separately in the dedicated `#reschedule-drag` demo section using the same mechanism — see Flow 2a below, where the equivalent native-feeling interaction is described in the page's own copy as working). So this specific automation limitation is noted but not scored as a mockup defect for the Drafts rail itself.

**Would it make sense to Sade without explanation:** Yes, conceptually — a labeled "Drafts" rail with visibly draggable cards sitting right under the calendar she's looking at is an obvious, self-explanatory affordance. The rail header text ("drag onto the calendar, or tap Move on a draft") sets the right expectation in words too.

**Point of confusion / friction — real, demonstrated:** The rail header text promises a "Move" option ("...or tap Move on a draft") but **no draft card in the rail has a Move button, anywhere in the markup**. I confirmed this by reading every `.draft-card` block in both the embedded rail (`#drafts-rail-month`) and the standalone rail demo (`#drafts-rail-standalone`) — zero instances of `[data-move-trigger]` inside a `.draft-card`. This is a real gap, not a misreading: the only place `data-move-trigger` exists anywhere in the file is on a single `.post-row` example in the dedicated "Reschedule mode 3" demo section, unrelated to drafts. **For Sade, on her phone, with no mouse, this means the rail's own promised non-drag path to schedule a draft does not actually exist yet.** If she's on a train platform with one hand free and can't comfortably long-press-drag, she has no "Move" button to fall back to on a draft card — she would have to open the card to its full detail view instead (a heavier path the rail copy explicitly implies she shouldn't need).

### 1b. Mobile (~390px) — tap-to-select then tap-destination

**What Sade was trying to do:** Same task, but she's standing, one hand on her phone, between a client's office and her car. She wants the lightest possible way to get a draft onto a date without precise dragging.

**What happened:** Tapped a draft card directly (the only thing on the card that's tappable). Nothing happened — no overlay opened, no detail view, no selection state. This makes sense given the markup: `.draft-card` has no click handler at all in `mockup.js` (only `dragstart`/`dragend` listeners are attached to `[draggable="true"]` elements generically, and a tap/click is not a drag gesture). On a touchscreen, tapping a draft card today does precisely nothing.

**Would it make sense to Sade without explanation:** No. She tapped the thing the rail told her to interact with ("drag onto the calendar, or tap Move on a draft") and got silence. A flaky-connection-anxious, time-pressed solo user interprets "nothing happened" as "did that work? do I need to tap again? is the app frozen?" — exactly the kind of doubt Solo Sade's persona profile explicitly says she shouldn't have to carry.

**Friction:** This is the same root gap as 1a, restated for touch: the Drafts rail's own copy promises a Move-based path that isn't built into the draft cards yet. The tap-to-select → tap-destination pattern is real and does work elsewhere in the gallery (see Flow 2 below) — it just isn't wired onto Draft cards specifically, only onto already-scheduled post examples. **This is the single most actionable miss in the mockup relative to Sade's named primary task** ("scheduling a draft from the Drafts rail... via the tap-to-select-then-tap-destination mode," per the packet's exact wording) — the packet asked for this exact flow to be testable, and on a draft card specifically, it is not yet wired.

---

## Flow 2 — Reschedule an already-scheduled post

### 2a. Drag (desktop)

**What Sade was trying to do:** Move "Q3 recap carousel" from Jun 4 to Jun 26 in the dedicated drag-mode demo section.

**What happened:** Same automation limitation as 1a applies here (synthetic mouse events don't trigger native HTML5 DnD's `dragover`/`drop` listeners) — screenshot `06-desktop-mid-drag-dragover-state.png` and `07-desktop-after-drag-drop-confirmation.png` show no visible state change. I do not score this as a design defect; it reflects a known limitation of testing native-HTML5-drag with synthetic mouse events rather than a real OS-level drag, and the page's own framing is explicit that this stands in for `@dnd-kit`'s already-proven `PointerSensor`, not a new untested mechanism.

**Would it make sense to Sade:** Conceptually yes — drag-and-drop reschedule on a calendar is one of the most universally understood gestures in software. No explanation needed.

### 2b. Tap-to-select → tap-destination (the touch fallback named in the packet)

**What Sade was trying to do:** Reschedule "Tip Tuesday post" (currently Jun 16) using the new tap-to-select mode, on her phone.

**What happened, verified via direct JS dispatch isolating the interaction logic from the page-wide overlay bug described above:**
- Tapping the card's "Move" button (visible, labeled, with an icon) correctly entered move mode: the source card got `.is-selected-for-move` (outline + glow), **all 17 valid destination cells across the gallery's various calendar grids simultaneously got `.is-drop-candidate`** (dashed outline + tint), and the sticky banner appeared reading "Moving **Tip Tuesday post** — tap a highlighted day to schedule it there," with a visible Cancel button.
- Tapping a highlighted destination (Jun 26) correctly fired a "moved to Jun 26" confirmation flash and dismissed the banner, exiting move mode cleanly.
- Escape, Cancel, or tapping the same card again all exit the mode without committing — confirmed in the JS source and the banner's own affordances.

**This is good interaction design and Sade would understand it without explanation.** A single labeled "Move" button, a clear sticky banner naming exactly what's being moved and what to do next, an always-visible Cancel, and an unambiguous destination highlight (color + dashed outline + cursor change, not color alone) hits every one of her stated priorities: it's fast (two taps total), thumb-reachable (the Move button and destination cells are both large, clearly tappable targets in this demo section), and forgiving (Cancel/Escape always available, nothing commits until the second tap).

**Two real points of friction, independent of the page-wide overlay bug:**
1. **Touch target height.** The "Move" button measured 77×34px in the live render at 390px width — the width is generous, but the **height (34px) is under the Master Brief's own 44×44px minimum** for every interactive element at every width. For a thumb tap between meetings, 34px of height is a real, if modest, miss against the project's own stated standard.
2. **Is the destination highlighting obvious on a small screen, per the packet's explicit question:** Yes, with one caveat. The dashed accent outline + background tint reads clearly at mobile width in the screenshots I captured (`FINAL-mobile-movemode-active.png` — once isolated from the overlay bug) — it's not subtle, and it's reinforced by the banner's text, satisfying the spec's "status communicated by icon+label+color together, never color alone" rule. The caveat: in the actual Month grid (not the dedicated demo section), destination cells are small (84–108px depending on breakpoint) and already contain a date number, an add button, and up to 3 stacked cards — a dashed outline against that much existing visual noise would likely be harder to spot at a glance than it is in the spacious, uncluttered demo section. This wasn't testable directly since the Month grid's cells carry `data-drop-target` (drag) but **not `data-move-destination`** — the tap-to-select mode is wired into the dedicated demo section and the List/Agenda-style `.post-row` pattern, not yet into the live Month grid cells themselves. So today, Sade cannot actually use Move-mode rescheduling from the real Month view at all — only from the isolated demo section built to showcase the pattern. This mirrors the Drafts-rail gap in Flow 1b: the mechanism is proven to work, but it is not yet connected to the actual calendar grid surface where Sade would really use it day to day.

**As asked specifically by the brief — does the "Move" button trigger make sense to Sade without explanation:** Yes. It's labeled "Move," has a directional icon, and the resulting banner immediately confirms what's happening in plain language. No prior knowledge of the three-reschedule-modes taxonomy is needed to understand it in the moment.

### 2c. Full detail-panel edit

**What happened:** Clicking any post card opens the detail drawer (verified at both widths, modulo the overlay-stacking bug noted above obscuring the visual once any prior interaction has occurred on the page — on a truly first, isolated click, this opens correctly). The drawer's date/time fields are real native `<input type="date">`/`<input type="time">` controls with the account timezone shown explicitly alongside ("America/New_York"). This is the heaviest of the three paths and reads as such — appropriate, since spec'd as the place caption/platform edits also happen, not a quick reschedule shortcut.

**Would it make sense to Sade:** Yes — date and time pickers are universally understood. The explicit timezone label next to the fields is a genuinely good, non-obvious touch: without it, Sade scheduling from a different city than her audience would have no way to know if "2:00 PM" means her phone's clock or her audience's.

---

## Flow 3 — Quick Post, zero-asset path, end-to-end (mobile)

**What Sade was trying to do:** She has an idea for a quick LinkedIn + TikTok post, no Library asset behind it, and wants to get it scheduled in the gap between two client visits without opening AI Studio.

**Walkthrough (verified via direct DOM-state assertions to isolate from the overlay-stacking bug):**

1. **Opened Quick Post.** Step 1 (asset) defaults to "No asset — click to pick from Library (optional)" — correctly zero-asset by default, exactly the path Sade needs. Good: it's explicit that this step is skippable, not a silent empty state she'd wonder about.
2. **Platform toggles.** Instagram is on by default with a real pre-filled caption ("Excited to share our latest update with you all today!") and an explicit "Pre-filled by AI — edit freely" note. Toggling TikTok on correctly revealed its caption row — **but the TikTok row has no pre-filled caption at all, just an empty textarea with a placeholder** ("Write a caption for TikTok…") and no AI-prefill note. Confirmed by reading the live DOM value (empty string) and the `.ai-prefill-note` element count (zero) for every non-Instagram platform row. The same is true for LinkedIn and X.
3. **Friction this creates for Sade specifically:** The spec's own framing for Quick Post (§6.3, cited in the gallery's own section copy) is "platform toggles + **one caption field per platform, pre-filled** via generate-post-metadata." The mockup demonstrates this promise for exactly one platform (Instagram) and not the other three. For a fast, multi-platform, on-the-move workflow, this matters: if Sade turns on TikTok and LinkedIn expecting the same one-tap "edit what's there" experience Instagram gave her, she instead has to write two full captions from scratch in the time she budgeted for editing one. This is very plausibly because the mockup is static/representative (no real edge-function call exists at this stage) and Instagram was chosen as the one fully-fleshed example — that's a reasonable mockup shortcut — but it's worth flagging explicitly so the real Phase 3 build doesn't ship the "looks pre-filled for one platform" impression as the literal scope.
4. **Toggling Instagram off** correctly hid its caption row — toggle state and row visibility stayed in sync both directions, no stale rows left behind.
5. **Step 3 ("When").** The timezone banner is present and explicit: "Times shown in your account timezone: America/New_York (UTC−4)." This is exactly the fix the AS-IS audit flagged as missing from the real `ScheduleModal.jsx` today, and it's reassuring rather than confusing — Sade doesn't have to guess whether the time she's typing is hers or her audience's.
6. **Footer actions.** Three buttons: "Save as draft" (left, secondary), "Cancel" / "Schedule post" (right, grouped). Layout is sensible and the primary action ("Schedule post") is visually the heaviest-weighted button, correctly signaling it's the default expected action.
7. **Asset picker sub-flow.** Tapping the asset-picker trigger correctly opened a compact grid of Library tiles; tapping a tile correctly closed the picker and updated the trigger label to the chosen asset's name ("Studio shot, new arrivals"), confirmed via DOM read after the interaction.

**Would the end-to-end flow make sense to Sade without explanation:** Mostly yes. The three-numbered-step structure (1 asset, 2 platforms/captions, 3 when) is self-narrating, and nothing requires reading documentation to use it. The one place a first-time Sade might pause: there's no visible indication anywhere in the composer of *which* fields are required vs. optional beyond step 1's explicit "(optional)" label — if she toggles zero platforms and tries to schedule, there's no mockup state showing what happens (no validation message was observed; the close button works regardless of form state, since `mockup.js`'s `data-close` handler does not check anything before hiding the modal). This is a plausible state, but not demonstrated, so I'm flagging it as untested rather than broken.

**A separate, concrete friction point independent of caption pre-fill:** after pressing either "Save as draft" or "Schedule post," **the modal simply closes with no confirmation of any kind** — no toast, no "Draft saved" message, nothing. For Sade specifically — someone whose stated top concern is "not losing work on flaky connections" — silently closing a creation modal with zero acknowledgment is the worst possible feedback pattern for exactly her anxiety. Today there is no way for her to tell the difference between "that worked" and "that silently failed and closed anyway." This is explicitly worth fixing before Phase 3, since it's the one piece of UI feedback most directly tied to her named core worry.

---

## Bonus — Stale-write / conflict states, evaluated cold

The packet asked whether these would make sense to Sade "with zero prior explanation." Evaluated each toast's literal text as a first-time reader would see it (verified by firing both toasts via direct JS dispatch and reading the rendered text):

**Drag conflict toast:**
> "Time slot already taken — Another post is scheduled to this account at the exact same time. Nothing was overwritten." with two actions: "Schedule anyway" / "Undo move."

This reads clearly on first encounter. "Nothing was overwritten" directly answers the anxious question a flaky-connection-wary user would have ("did I just break something?") before she'd even have to ask it. "Schedule anyway" vs. "Undo move" are both self-explanatory verbs, no jargon. Clicking "Schedule anyway" correctly updates the toast in place to "Scheduled anyway — Both posts now occupy that slot. You can re-space them anytime," then auto-dismisses after 2.4s — confirmed by direct interaction. This is good, low-friction design for exactly Sade's situation: she's told plainly what happened and what her two real choices are, with no technical terms ("concurrency," "conflict resolution") anywhere in the copy.

**Stale-write toast:**
> "This post changed elsewhere — It was updated from another tab or device since you opened it. We refreshed this card to the latest version — your move was not applied."

This also reads clearly without prior explanation, and specifically for Sade's personal (not org/team) context, "another tab or device" is the exactly right framing — she doesn't have teammates, so a generic "someone else edited this" message would have confused her into wondering if her account had been compromised or shared. The actual likely real-world cause (she has the calendar open on her phone and her laptop at the same time) is implicitly covered by "another tab or device" without the copy having to spell out that scenario explicitly. One minor note: this toast has no action buttons at all, only a dismiss (×) — appropriate, since there's nothing to undo (the move "was not applied," so there's no action to reverse), but worth confirming this is intentional and not a missing "got it" acknowledgment button, since the conflict toast above does have buttons and the asymmetry could look like an oversight rather than a deliberate distinction if not called out.

**Verdict on the bonus check: pass.** Both toast copies are in plain language, name the real-world cause in terms Sade would recognize from her own life (another tab/device, not "concurrency"), and state outcomes ("nothing was overwritten," "your move was not applied") rather than just naming the problem — which is exactly what stops a time-pressed, anxious-about-losing-work user from having to guess at consequences.

---

## Summary verdicts

| Flow | Verdict | Why |
|---|---|---|
| 1a. Drag a draft onto a date (desktop) | Concern | Native-drag mechanism untestable via synthetic mouse events (expected limitation, not a design flaw); separately, the rail's promised "Move" affordance does not exist on draft cards at all |
| 1b. Tap-to-select a draft (mobile) | **Fail** | Tapping a draft card does nothing; the rail's own copy promises a non-drag path ("tap Move on a draft") that isn't wired into draft cards anywhere in the file |
| 2a. Drag reschedule (desktop) | Pass (design intent) | Universally understood gesture; automation-only limitation in verifying the literal drop, not a design issue |
| 2b. Tap-to-select → tap-destination reschedule (mobile + desktop) | Pass, with concerns | Logic is well-designed and self-explanatory once isolated from the overlay bug (clear banner, obvious destination highlight, easy escape) — but the Move button is 34px tall (under the 44px minimum) and the whole mode is not yet wired into the real Month grid, only into a standalone demo section |
| 3. Quick Post end-to-end, zero-asset (mobile) | Pass, with concerns | Structure and timezone-honesty are good; caption pre-fill only demonstrated for one of four platforms; zero confirmation feedback after Save-as-draft/Schedule, which is the single worst-fit detail for Sade's specific "don't let me lose work silently" anxiety |
| Bonus: stale-write/conflict toasts | Pass | Plain-language copy, names real causes Sade would recognize, states outcomes not just problems |
| **Page-wide: every overlay trigger** | **Fail (blocking)** | `hidden` attribute does not actually hide `.cmdbar-overlay`/`.modal-backdrop`/`.drawer-backdrop`/`.slideover-backdrop` due to a missing `[hidden]` CSS reset — confirmed via computed style, `elementFromPoint`, and Playwright's actionability engine on a fresh page load with zero prior interaction. This blocks real clicks (not just automation) across the entire gallery and must be fixed before this mockup can be properly evaluated by a human reviewer clicking through it live |

## Single biggest friction point

The page-wide overlay `hidden`-attribute CSS bug. It is the dominant finding of this review: every other finding above about interaction *design* (the Move button, the tap-to-select banner, the Quick Post composer, the toasts) had to be verified by bypassing real clicks and dispatching events directly at the JS layer, because a genuine click anywhere in the gallery has a high chance of landing on an invisible, supposedly-hidden overlay instead of the intended element. The interaction design underneath is, in most flows, good and would make sense to Sade without explanation — but as currently shipped, a human reviewer clicking through this gallery in a normal browser will frequently see the wrong modal (or several stacked at once) open, which will look like the *design* is broken when the actual defect is one missing CSS rule (`[hidden] { display: none !important; }`, or `:not([hidden])` qualifiers on each overlay class). This should be fixed before the mockup is presented for human approval, otherwise the human's own click-through will reproduce this confusion and may be wrongly attributed to the interaction design rather than the stylesheet.

The second most significant finding, specific to Sade's named priorities, is the silent Quick Post submit (no confirmation after Save as draft / Schedule) — directly contradicting her core "don't lose work without knowing" concern — and the unwired Drafts-rail Move affordance, which is the literal flow named first in the packet's Phase 2 ask.
