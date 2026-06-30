# QA Persona Review — Mockup Phase
Packet 2: Personal Content Library — `mockup-gallery.html`

Agent: `qa-persona-agent`
Persona walked through: **Solo Sade** (personal workspace, phone, on the move between client visits, cares about speed, thumb-reachable actions, not losing work on flaky connections) — the packet's named persona for this phase, per `PACKET_2_PERSONAL_LIBRARY.md`'s exact charge: "uploading an asset from her phone, confirming it got auto-tagged sensibly, and scheduling directly from it without ever opening AI Studio — at both mobile and desktop width."

**Reviewed:** `docs/calendar-library-rebuild/packet-2-personal-library/mockups/mockup-gallery.html` (+ `mockup.css`, `mockup.js`, `tokens.css`), after fix round 1, which `DESIGN_SYSTEM_COMPLIANCE.md` and `MOBILE_PARITY.md` both re-tested and passed (mobile filter rail toggle added, phantom `.asset-card__more-trigger` removed, table checkboxes and drawer footer buttons brought to 44px, two font-size/dead-CSS items swept). I did not re-litigate those findings; I independently drove the four flows this packet specifically assigned me, plus the spot-checks named in my task.

**Method:** Real Chromium via Playwright (`node_modules/playwright`, v1.60.0), driven against both `docs/calendar-library-rebuild/packet-2-personal-library/mockups/mockup-gallery.html` and `docs/calendar-library-rebuild/packet-1-personal-calendar/mockups/mockup-gallery.html` served from a single local static HTTP server rooted at `docs/calendar-library-rebuild/` (so the real relative cross-link between the two galleries resolves exactly as it would for a human opening these files via a server, not `file://`), stopped after testing. Desktop context: plain `viewport: 1440×900`. Mobile context: Playwright's `devices['iPhone 13']` preset (390×844, `hasTouch: true`, `pointer: coarse`), using real `.tap()` calls. For the upload flow specifically, I did not rely on the mockup's own synthetic-file fallback — I used Playwright's `filechooser` event with two real on-disk temp files, so the "tap-to-pick-file" path was exercised exactly as a phone's native file picker would be, not the JS fallback that exists for environments where a file chooser can't be scripted. Five throwaway driver scripts were written to the repo root during this session and deleted immediately after extracting findings (none are deliverables, none remain).

## Verdict summary

| Flow | Verdict | Headline reason |
|---|---|---|
| 1. Upload from phone (tap-to-pick) | **Pass** | Real `<input type="file" multiple>` behind the dropzone, genuine `filechooser` event fires on tap, multi-file progress, duplicate warning, and a one-failure-doesn't-block-the-batch validation state all work as designed, at both widths |
| 2. AI auto-tagging shimmer → resolved tags | **Pass, with one real ambiguity worth a sentence** | Shimmer reads as "still working," resolves into clearly-marked sparkle-icon AI tags visually distinct from user tags — but nothing in the UI ever explains the sparkle icon's meaning the first time you see it |
| 3. Schedule hand-off without opening AI Studio | **Concern — mechanically works, experientially breaks the "one continuous action" promise** | The click-through lands correctly on Packet 1's Quick Post section and never touches AI Studio, but the asset does not actually travel into the composer — Sade lands on a generic description block, must click a second button, and the composer she eventually sees says "No asset" exactly as if she'd opened it cold |
| 4a. Grid/table toggle | **Pass** | Single tap/click, instant panel swap, state remembered |
| 4b. "Unused" filter | **Pass, with one explanatory gap** | The chip is one tap away and visibly activates, but "Unused" as a word is not self-explanatory out of context — the badge on individual cards is, the filter chip alone is borderline |
| 4c. Asset detail drawer on mobile | **Pass** | Full-screen sheet, not a shrunk desktop panel; all four footer actions land at a real 44px and are visible without scrolling on first paint |

---

## Flow 1 — Upload an asset from her phone

**What Sade was trying to do:** standing in a parking lot between two client visits, phone in one hand, she wants to get three new product photos into her Library before she forgets. She has no mouse, no drag-and-drop.

**Walkthrough, mobile (390px), verified by real interaction:**

1. Tapped the header "+ Upload" button. The Upload modal opened correctly — confirmed via DOM state, not assumed.
2. The dropzone inside (`#upload-dropzone`) is a real `role="button"`, `tabindex="0"` element wrapping a genuinely hidden `<input type="file" multiple>`. This is the detail that matters most for this exact flow: drag-and-drop is explicitly useless on a phone, and this mockup does not pretend otherwise — tapping the dropzone area dispatches a real `.click()` on the file input, which I confirmed by listening for Playwright's own `filechooser` event (the same event a real native picker sheet firing on an actual phone would trigger) rather than reading the JS and assuming it works. The event fired every time, both widths, and reported `isMultiple() === true`.
3. Supplied two real files through the chooser. Both appeared immediately in the upload queue with a thumbnail-style icon, filename, and a live percentage counter ticking up from 0% in randomized increments — not a single fake jump to 100%, which reads as a genuine in-progress upload rather than a static "done" state slapped on instantly.
4. Both files reached 100%, each independently flipped to a green checkmark `is-done` state at its own pace (confirmed via `is-done` class count, not a fixed timer assumption).
5. Closed the modal via the "Done" button. Re-confirmed `hidden` was restored.

**Duplicate detection (§5), tested as its own real pass:** uploaded a file named so it would match the duplicate-trigger condition alongside a second, unrelated file in the same batch. Result: the duplicate file got a non-blocking warning card inserted directly under its row — `"This looks like a duplicate of 'Studio shot — new arrivals'" / "Some duplicates are intentional re-uploads of an edited version."` — with two real buttons, `"This is a new version"` and `"It's a separate asset"`, each measuring a genuine 44×44px+ tap target (measured: 133×44px). Critically, **the second, non-duplicate file in the same batch was not blocked or delayed by the first file's warning** — it proceeded straight into its own AI-tagging shimmer independently, confirmed by checking both rows' states concurrently rather than sequentially. Tapping "This is a new version" correctly dismissed the warning and fired a real confirmation toast ("Upload complete — New assets now appear in your Library grid"). This is exactly the §5 behavior the spec calls for: non-blocking, decision deferred to the human, doesn't gate the rest of the batch.

**Validation failure, one-fails-others-succeed (§11):** this state is presented as a fixed demo block rather than something I could trigger through the real file input with my own synthetic files (the mockup has no actual mime-type-rejection logic wired to `handleFiles` — it's representative content, not live validation). I read and visually confirmed the demo block directly: three files in one queue, file 1 and file 3 (`.jpg`) show green success, file 2 (`brand-promo.mov`) shows a red X with inline text **on that row only** — `"File type '.mov' isn't supported yet — try MP4 or WebM instead."` — and an explicit caption underneath stating "The two valid files finish uploading normally — the failed one never holds up the batch." This correctly demonstrates the *intended* behavior per spec §11, but I want to be precise about what I verified versus what I'm taking on faith: I confirmed the **markup and visual state** match the spec; I did not confirm a live validation rule actually rejecting a real `.mov` File object through the real dropzone, because no such rule exists yet in `mockup.js` (`handleFiles` accepts anything handed to it). This is appropriate for a mockup of this fidelity and is exactly the kind of thing Phase 3's real upload handler needs to implement for real — flagging it as a Phase 3 reminder, not a mockup defect.

**Desktop (1440px):** repeated the full upload + duplicate sequence with a mouse click instead of a tap. Identical behavior, identical timing, identical confirmation toast. No width-specific divergence.

**Would it make sense to Sade without explanation:** yes. A dropzone that's also clearly tappable (icon + "Drop files here or click to upload" + a visible hint about size/type), a per-file progress bar with a percentage she can watch tick up, and a green check when each one lands — none of this requires a tutorial. The duplicate warning's two-button choice is phrased in her language ("a new version" / "a separate asset"), not database language ("create new row," "supersede").

**Friction, real but minor:** the upload modal's "Done" button is the only way to close it once files are queued — there's no toast or banner confirming "3 files uploaded to your Library" after closing, the way Packet 1's Quick Post now does for drafts/scheduled posts (per that packet's re-test). For Sade specifically — whose top named anxiety is not losing work on a flaky connection — a per-item green check during the upload is good, but there's no single closing acknowledgment that the whole batch is safely in her Library after she taps Done. Not blocking; the per-row checkmarks already answer "did this specific file make it," which is most of what she'd worry about, but a single closing toast would fully close the loop the way the calendar packet's fix round did for its own save/schedule actions.

**Verdict: Pass.**

---

## Flow 2 — Confirm it got auto-tagged sensibly

**What Sade was trying to do:** after uploading, she wants to glance at the card and trust that it's been usefully labeled without her having to type tags herself — but she also doesn't want to mistake the computer's guess for something she said.

**Walkthrough, verified live, both widths:**

1. Immediately after a file finished uploading (continuing from Flow 1's queue), the row showed two skeleton/shimmer bars (`.skel.ai-shimmer-line`) in place of tags — a clearly "still loading" visual treatment, animated, not a static gray block that could be mistaken for "nothing is happening."
2. After roughly 1.8 seconds (timed in the mockup's JS, representative of the real async Claude vision call's latency), the shimmer was replaced by two real tag chips: `"✨ product"` and `"✨ flat-lay"`.
3. Cross-checked against the dedicated standalone AI-tagging demo section (`#upload-ai-tagging`), which lets you trigger the shimmer-to-tags transition on demand via a "Simulate AI tags landing" button — same visual result, sparkle-prefixed tags appearing where the shimmer had been.
4. Checked the asset detail drawer's tag area for the same asset: tags rendered as a mixed row — `product` (no icon, a plain chip) sitting next to `✨ flat-lay` and `✨ spring` (sparkle-icon chips, distinguishable by both the icon and a slightly different chip style class, `is-ai`). This is the spec §2.1 requirement made visible: `tags` (freeform, user-added) and `ai_tags` (system-generated) are stored separately and **rendered separately enough to tell apart at a glance**, not merged into one indistinguishable tag soup.

**Would it make sense to Sade without explanation — graded honestly:**

- The shimmer-while-processing state: yes, immediately. It's a standard "this is loading" pattern she'd recognize from any app.
- The distinction between her own tags and the AI's tags: **mostly yes, with one real gap.** The sparkle emoji prefix is a reasonable, low-effort visual signal that something is AI-suggested rather than human-entered, and it's used consistently everywhere tags appear (grid cards, table view is text-only so this doesn't apply there, and the drawer). But I checked every tag-bearing surface in the file for an explanatory label, tooltip, or legend anywhere near the tags — `title` attribute, `aria-label`, adjacent caption — and found none. A first-time Sade seeing a sparkle next to some words and not others would very likely *guess* correctly that it means "AI suggested this" (sparkle is a fairly conventional AI-affordance icon at this point), but it is a guess, not something the UI states outright anywhere on the card itself. The drawer's "Alt text" field is the one place in the whole drawer that *does* spell this out explicitly in words ("AI-suggested, human-editable") — the tags section right next to it does not get the same explicit label, which is an inconsistency worth a beat of attention: one field on the same screen explains itself in words, the other relies on icon convention alone.

**Verdict: Pass, with one real ambiguity worth a sentence** — not blocking, since the icon convention is a reasonable inference and the drawer's adjacent alt-text field demonstrates the team already knows how to spell this out in words when it wants to; it just didn't carry that same explicit labeling over to the tags row on the same screen.

---

## Flow 3 — Schedule directly from the asset, without ever opening AI Studio

This is the flow the packet calls "the single highest-value connection identified across both specs," and I gave it the most scrutiny accordingly. I tested it from three different entry points (a grid card's quick-action Schedule button, the dedicated demo section's Schedule button, and the asset detail drawer's own Schedule button — all three wire to the same modal) and followed the actual click-through into a real second browser tab rather than stopping at "the modal opened."

**What Sade was trying to do:** she has a product photo already sitting in her Library from a shoot last week. She wants to post it Thursday. She should never have to detour through Generate/AI Studio to do this — the asset already exists, she just needs to attach a caption, pick platforms, and pick a time.

**Walkthrough, mobile then desktop, verified step by step:**

1. Tapped "Schedule" on the "Studio shot — new arrivals" card. A confirmation modal opened correctly, titled "Schedule this asset," showing the asset's name (`Studio shot — new arrivals`, matched exactly against the button's `data-asset-name` — confirmed the modal threads the *specific* asset name through, not a generic placeholder) and the line: *"This opens the Calendar's Quick Post composer — the same shared component spec §7 requires, not a Library-specific reimplementation — in a new tab, with this asset ready to attach."*
2. The primary action, "Continue to Quick Post →", is a real `<a>` tag with `href="../../packet-1-personal-calendar/mockups/mockup-gallery.html#quick-post"` and `target="_blank"` — a genuine cross-gallery link, not a styled dead button standing in for one. Tapping/clicking it opened a real second browser tab.
3. The new tab loaded Packet 1's actual gallery and landed scrolled precisely to the `#quick-post` anchor — confirmed the section's bounding box sits at the very top of the viewport on arrival, at both widths. Mechanically, this part of the hand-off works exactly as intended: it is a real click-through between two real files, it does not round-trip through any AI Studio surface, and the landing point is correct, not "somewhere vaguely on the page."
4. **Here is where the flow breaks down for Sade specifically.** The `#quick-post` anchor she lands on is not the Quick Post composer itself — it's the *gallery's own descriptive section about* Quick Post (a heading, two sentences of spec-citation prose, and a single `"+ Quick Post"` button she still has to press). I read this section's literal rendered text directly: nothing in it mentions "Studio shot," nothing says an asset is waiting, nothing distinguishes this landing from someone who had never touched the Library at all.
5. I then took the next, obvious step a real Sade would take — pressed that "+ Quick Post" button to actually open the composer — and read its contents directly. Step 1 of the composer reads: **"No asset — click to pick from Library (optional)."** Not "Studio shot — new arrivals, ready to attach." Not even a loading state. The composer that opens after the full click-through is byte-for-byte the same empty-state composer she would get by opening Quick Post completely cold from the Calendar, with no Library detour at all.

**What this means concretely:** the *promise* stated in the hand-off confirmation modal itself — "with this asset ready to attach" — is not what a real click-through delivers today. Sade would tap "Continue to Quick Post," watch a new tab open, watch it land on the right general area, then have to (a) notice there's still a button to press, (b) press it, (c) discover the asset she just came from is not there, and (d) manually reopen the Library asset picker inside Quick Post and re-select "Studio shot — new arrivals" by hand — the exact asset she had already selected one tab ago. That is not "one continuous action." It is a worse version of opening Quick Post directly from the Calendar, because it adds a tab-switch and a moment of "wait, where did it go?" with no payoff.

I want to be precise about whose responsibility this gap is, because the mockup's own documentation already flags it: the handoff modal's body copy explicitly says *"Exact prefill wiring (auto-selecting this specific asset inside the Asset Picker step) is a Phase 3 implementation detail; at mockup fidelity this links to the real, existing Quick Post section and its Asset Picker step, which is the closest existing anchor... see DECISIONS_LOG.md."* So this is a **known, declared simplification**, not an oversight the designer is unaware of. But from Sade's standpoint — which is the only standpoint this report is required to take — the *experience* of the click-through, as it exists in the file today, does not yet deliver the "without ever opening AI Studio, as one continuous action" feeling the spec is explicitly trying to prove out. It delivers the "without ever opening AI Studio" half correctly (confirmed: at no point does any URL or modal in this entire flow touch a Generate/AI Studio surface) and not yet the "one continuous action" half.

**Would it make sense to Sade without explanation, graded on what exists today:** the mechanics (new tab, correct anchor landing, no AI Studio detour) would make sense to her. The experience of arriving and finding her asset gone would not — she would reasonably read it as the feature being broken, not as a deliberate mockup-fidelity placeholder, because nothing on the landing screen tells her otherwise.

**Verdict: Concern, not a Fail** — I am not scoring this a hard Fail because the gap is openly and specifically documented as deferred Phase 3 wiring rather than a hidden defect, and because the surrounding mechanics (real new tab, real correct anchor, zero AI Studio contact) are genuinely correct and verified, not assumed. But this is the single most important thing for a human reviewer to look at before sign-off, because it is the packet's own named highest-value flow, and as currently clickable, it does not yet deliver the specific feeling ("one continuous action") the spec singles out as the reason this hand-off matters at all. Recommend either (a) accepting this as correctly scoped for Phase 2 mockup fidelity and explicitly carrying the asset-prefill wiring into Phase 3's acceptance criteria with no ambiguity, or (b) if the human wants Phase 2 itself to demonstrate the *feeling* of continuity (not just the routing), asking for a lightweight addition — e.g., a query param or sessionStorage flag the Quick Post section could read to swap its empty-asset-step copy for a "Studio shot — new arrivals attached" placeholder, even at mockup fidelity — before this flow is presented as proof of the highest-value connection in the spec.

---

## Spot-check 4a — Grid/table view toggle

**What Sade was trying to do:** flip from the visual grid to a denser table to scan filenames quickly.

**Walkthrough:** tapped/clicked the "Table" button in the view switcher. The grid panel correctly hid and the table panel correctly showed (confirmed both panels' actual visibility state, not just an `is-active` class on the button). Switched back to grid the same way — round-trip confirmed clean, no leftover state. Both buttons measured a real 44px tall at both widths.

**Would it make sense to Sade without explanation:** yes — a two-button grid/table switcher with icon + label is an extremely common, self-explanatory pattern, and the immediate panel swap (no loading delay, no page reload) reinforces that it's a pure view preference, not a different query.

**Verdict: Pass.**

---

## Spot-check 4b — "Unused" filter

**What Sade was trying to do:** find the products she's already photographed but never actually posted anywhere — the exact "what haven't I used yet" question the spec's §4 cites as the direct reason this filter exists.

**Walkthrough:** the filter chip reads "Unused only" with a count badge. Tapped/clicked it; it correctly toggled to an active visual state. Separately, in the dedicated `#unused-filter` demo section, the same concept is shown isolated: a chip reading "Unused only — 7 assets" sitting above a grid of cards that each individually carry a small "Unused" badge in their corner.

**Would it understand it at a glance, per the task's explicit question:** **mostly yes, with a real caveat worth naming precisely.** The *individual card badge* ("Unused," sitting right on a thumbnail she can already see has no scheduling history near it) is genuinely self-explanatory in context — she'd read it as "this hasn't been used yet," which is correct. The *filter chip itself*, evaluated cold and out of context (i.e., if this were the very first thing she saw on the page, before ever seeing a card badge to anchor the word against), is a half-step more ambiguous: "Unused" could plausibly be misread as "unused" in the sense of "this file isn't referenced/orphaned and might be safe to delete," rather than its actual, narrower meaning — "not yet placed on any post" (`used_in_post_ids` is empty). The spec's own §4 frames this filter as answering "what haven't I posted yet," which is a more specific and more useful framing than the single word "Unused" conveys on its own. In practice this is a minor gap because the card badges and the chip co-exist on the same screen and reinforce each other quickly — but if I'm answering the literal question asked ("does Sade understand what it means at a glance"), the honest answer is: she'd get the *gist* immediately and the *precise* meaning within a few seconds of seeing it next to actual cards, not necessarily instantly from the chip's label alone.

**Verdict: Pass, with one explanatory gap** — not blocking, but a one-word tooltip or a slightly more specific label ("Not yet posted" instead of "Unused") would close the small remaining ambiguity entirely, and would cost nothing structurally to change.

---

## Spot-check 4c — Asset detail drawer on mobile

**What Sade was trying to do:** tap a card to see/edit its details one-handed, the way she'd actually do it standing up.

**Walkthrough, mobile (390px):** tapped a real grid card directly (not a stand-in demo trigger). The drawer opened as a genuine full-screen sheet — measured `390×664`, i.e., 100% of the viewport width, not a narrow panel squeezed into a corner. Header shows the asset name, source badge, and a 44×44px close (×) button sitting at a clearly one-thumb-reachable top-right position. Body sections (Preview, Metadata, Used in, Version history, Technical) stack vertically and are individually scrollable. The footer — Save changes / Schedule… / Duplicate / Delete, in a 2×2 grid — sits at `y:535` within an 844px-tall viewport, meaning **all four footer actions are visible on first paint, with no scrolling required**, each measuring a real 44px tall (re-confirmed independently here, not just taking the parity report's word for it). The tag input fields measured a real 40px tall single-line inputs, individually large enough to tap into without a precision issue.

**Walkthrough, desktop (1440px):** same trigger, same content, rendered instead as a 440px-wide right-side panel (31% of viewport width) rather than a full-screen sheet — correctly a deliberate, named layout adaptation (full sheet on mobile, side panel on desktop), not a feature cut; every section and every footer button present at both widths, same labels, same order.

**Would it feel like a cramped desktop panel shrunk down, per the task's explicit question:** no. The mobile version is a different layout shape entirely (full-bleed sheet vs. side panel), not the same fixed-width panel rendered smaller — exactly the kind of deliberate reorganization the Master Brief's §4 asks for instead of "things got smaller." Nothing required horizontal scrolling, nothing was clipped, and the one genuinely heavy part of this screen (a metadata form with four fields plus a tag row plus a used-in list plus version history plus a four-button footer) still resolved into a usable, single-column, thumb-scrollable sequence rather than a cramped multi-column miniature.

**One real, independent observation, not part of the assigned drawer check but found while in there:** tapping "Save changes" produces no toast or confirmation of any kind (checked directly: zero `.toast` elements appeared after the click, at either width). This is the same category of gap as the upload-modal's missing closing acknowledgment noted in Flow 1, and for the same Sade-specific reason (her stated anxiety is specifically about not knowing whether something she did actually stuck) — worth a mention here since the drawer is exactly the kind of "I just typed something, did it save" moment that anxiety applies to most directly. Not part of this flow's assigned scope, so not scored as a failure of the drawer check itself, but flagged because it's real and on-theme for this persona.

**Verdict: Pass.**

---

## Summary verdicts (restated as a table)

| Flow | Verdict | Why |
|---|---|---|
| 1. Upload from phone | **Pass** | Real tap-to-pick-file path (genuine `filechooser` event, not assumed), multi-file progress, non-blocking duplicate warning with two clear choices, one-file-fails-others-succeed validation state all confirmed at both widths |
| 2. AI auto-tagging shimmer → tags | **Pass, minor gap** | Shimmer-to-tags transition reads clearly; sparkle-icon convention distinguishes AI tags from user tags consistently, but is never spelled out in words on the card/drawer the way the adjacent "Alt text (AI-suggested, human-editable)" field is |
| 3. Schedule hand-off, no AI Studio | **Concern** | Real cross-gallery click-through lands correctly and never touches AI Studio, but the asset does not travel into the landed composer — Quick Post shows "No asset" after the full hand-off, contradicting the modal's own "ready to attach" promise; openly documented as deferred Phase 3 wiring, not a hidden bug, but breaks the "one continuous action" feeling this flow exists to prove |
| 4a. Grid/table toggle | **Pass** | Instant, clean panel swap, both directions, both widths |
| 4b. "Unused" filter | **Pass, minor gap** | Card badges are immediately clear in context; the filter chip's single word is a half-step more ambiguous read cold, before seeing a badge to anchor it against |
| 4c. Drawer on mobile | **Pass** | Genuine full-screen sheet (not a shrunk panel), all four footer actions visible and 44px without scrolling on first paint |

## Single most important thing for the human approval gate

**Flow 3, the Schedule hand-off.** Everything else in this report is a pass or a small, easily-worded fix. This one is the packet's explicitly named highest-value flow, the mechanics around it (real new tab, correct anchor, zero AI Studio contact) are genuinely solid and independently verified, but the actual payoff — arriving with the asset already attached — does not happen yet, and the modal's own copy currently promises that it does ("ready to attach"). Either the promise text should be softened to match current mockup fidelity, or a lightweight asset-passing mechanism (even a mockup-fidelity one) should be added before this is held up as proof of the spec's single most valuable connection.
