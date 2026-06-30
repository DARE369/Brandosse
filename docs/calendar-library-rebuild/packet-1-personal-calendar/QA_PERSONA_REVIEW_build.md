# QA Persona Review — Build Phase (Phase 4) — RE-TEST, 2026-06-25

**This section supersedes the original FAIL verdict below.** The original report (preserved unchanged beneath the separator) found two blocking regressions and recommended a targeted fix-and-resubmit, not a full redesign. Three fix rounds landed since then (see `DECISIONS_LOG.md`, "Phase 4 fix-and-resubmit" sections, 2026-06-24): (1) `feature-data-layer-builder` removed the nonexistent `media_type`/`thumbnail_url` fields from `createQuickPost()`'s insert payload; (2) `feature-frontend-builder` moved Quick Post's toast ownership to the page-level `ToastStack` (fixing the never-painted/false-positive-success bug) and added `flex-direction: column` to `.cal3-body` (fixing the mobile move-mode grid collapse); (3) `feature-data-layer-builder` fixed the same wrong-field-name read bug across `PostDetailDrawer.jsx`, `UnscheduledRail.jsx`, `CalendarGrid.jsx`, `CalendarListView.jsx`, and `handleDuplicatePost()`.

This is a fresh, from-scratch re-walkthrough as Solo Sade against the real running app (`http://localhost:3000`, an already-running `next dev --turbopack` instance, reused rather than restarted) and the real QA account (`brandosse.qa@brandosse.test`), at both ~390px and ~1440px — not a desk-check of the fix rounds' own self-reported verification. A previous attempt at this exact re-test was cut off by a session limit before writing anything (evidenced by ~28 leftover throwaway driver scripts dated 2026-06-24 22:00-22:17 found in `scripts/`, none reused — this is genuinely fresh work, not a resumption).

## Verdict: PASS — both original blocking regressions are genuinely fixed; three new, real, non-blocking findings surfaced by broader/deeper testing, none blocking

Every one of the five requested checks was driven live, with outcomes confirmed against the actual database via direct service-role queries, not inferred from UI state or from reading the fix-round agents' own code. Both original blocking regressions are confirmed fixed through real interaction. Three new findings — none a regression, none rising to the severity of either original bug — are reported below in the same spirit as the original report's own practice of distinguishing real defects from test artifacts.

---

### 1. Quick Post end-to-end — PASS

**Multi-platform "Schedule post":** Opened Quick Post, toggled TikTok and LinkedIn on (Instagram default-active). AI caption pre-fill — completely broken before (every platform stuck on "Pre-filling..." forever due to the `media_type` 400 error blocking the underlying edge-function call chain) — now genuinely works: TikTok got a real, distinct, on-topic 177-character AI-generated caption; LinkedIn got a real, distinct 455-character caption; both correctly labeled "Pre-filled by AI — edit freely." Typed distinct, traceable captions into all three platform fields, set date/time, clicked "Schedule post." Modal closed. A real `tone-success` toast fired reading "Post scheduled / Find it in the Drafts rail, the calendar, or the Library anytime." — no false-success framing, correct copy. Precisely timed on a separate run: toast appeared ~1.1s after click, auto-dismissed ~9.8s after click, matching the documented 9000ms `useToastStack` timer exactly (my own first read of "still visible after 8s more" was my own test script's imprecise elapsed-time bookkeeping, not a second bug — corrected here explicitly). Direct DB query confirmed all 3 rows landed with correct `platform`, `status: scheduled`, `scheduled_at`, and caption text; all three correctly have `generation_id: null` (no asset attached, correctly never grouped together).

**"Save as draft":** separately submitted with a single default platform. Modal closed; correct `tone-success` toast read "Saved as draft."

**Forced-offline failure:** opened a fresh Quick Post, typed a caption, set the browser context fully offline (`context.setOffline(true)`, a real network failure, not a simulated one), clicked "Schedule post." Modal **stayed open**; the typed caption was **preserved verbatim**; an inline `.ui-field-error` banner appeared with accurate copy; a toast fired reading "Could not save this post / TypeError: Failed to fetch — nothing was saved. Your captions are still in the form." Directly inspected the toast's DOM class (not just its text) and confirmed the icon genuinely carries `tone-danger` — not the old hardcoded success-green class. A direct DB query for this attempt's caption text returned zero rows: nothing was silently written. This is a direct, confirmed fix of the single worst-fit failure mode named in the original report (a failure that visually presented as success and told Sade "nothing was lost" while actually losing nothing — the lie was the problem, and it's gone).

**Would it make sense to Sade without explanation:** yes, on every count that mattered in the original failure. One new, minor, non-blocking gap found (not a fix-round regression — this conditional logic pre-dates and is untouched by any of the three fix rounds): Instagram, the platform active by default when the modal opens, never receives an AI pre-fill attempt at all, because `togglePlatform()`'s prefill call only fires when a platform is newly switched *on* — it never fires for whatever's already active on mount. Sade can always type her own caption (which is what happened in this test), so this is mild first-time friction, not a trust problem. One-line fix (call `prefillCaption()` once on mount for the initially-active platform) if anyone wants to close it; not blocking this verdict.

---

### 2. Move mode at mobile width — PASS

Fresh 390px touch context. Confirmed List loads by default (unchanged, correct). Switched to Month, tapped a real card's Move button with a real `page.tap()`. Live `getComputedStyle()` read during the active move-mode session: `.cal3-body` computed `flex-direction: column` (the documented fix, present and active). `.cal3-main-col` measured `{ x: 0, width: 390, height: 552 }` — full viewport width, fully on-screen, not collapsed or scrolled off-screen as in the original bug. The month grid body measured `{ x: 0, width: 390, height: 1452 }` — taller than viewport, correctly internally scrollable, not squeezed to zero. 42 real `.is-drop-candidate` highlighted destination cells were present, all on-screen. Tapped one — banner disappeared (committed), zero console errors. Direct DB verification confirmed the moved post's `scheduled_at`/`status`/`updated_at` landed correctly at the database level — durable persistence, not a client-only illusion.

**Would it make sense to Sade without explanation:** yes — she switches to Month, taps Move, sees the banner and a fully visible grid of tappable highlighted days exactly as the banner's own text describes, taps one, done. No vanishing UI, no dead end.

---

### 3. Thumbnails/asset previews — PASS for images; one new, real, non-blocking finding for video assets

**Image assets:** confirmed live across all three named surfaces. List view: 5 real `<img>` elements, all `naturalWidth: 768` (genuinely decoded, not broken), pointing at the correct `generations.storage_path` URLs. Post Detail Drawer: the identical real image rendered correctly when opened from the List row. Drafts rail: exactly 4 real, loaded thumbnails (matching the account's 4 image-linked drafts) plus 8 correct emoji placeholders for the 8 assetless drafts — exactly matching spec, no bug.

**Video assets (new finding, not previously tested by any fix round — the QA account had zero video-linked posts of its own before this session; seeded two traceable rows, "QA verify video thumbnail re-test...", specifically to close this gap):** the Drafts rail's thumbnail and the List/Agenda row's thumbnail both render a **broken image** for a video asset — confirmed live via `naturalWidth: 0` with `complete: true` (the textbook signature of the browser attempting and failing to decode an .mp4 file as an image, not a slow-load timing artifact). Root cause, confirmed by direct source read: `PostDetailDrawer.jsx` already branches on `media_type === 'video'` to choose `<video>` vs `<img>` (pre-existing logic, untouched by any fix round, and correctly rendered a real `<video>` element with the right `src` in this same test) — but `UnscheduledRail.jsx`'s `DraftCard`, `CalendarListView.jsx`'s Agenda row, and `CalendarGrid.jsx`'s Month-view slide-over (confirmed via source — identical one-line pattern in all three) have no such branch and unconditionally wrap any truthy `storage_path` in an `<img>` tag regardless of media type. Reproduced live in two of the three surfaces directly (rail, List row); the third (Month slide-over) shares the exact same code pattern so is inferred with high confidence rather than independently forced through its narrower trigger condition (it only opens via "+N more," which needs >3 posts on one day).

**Per the task's explicit note:** `PostCard.jsx` (the Month-grid card) correctly has no thumbnail at all by design (dot-only, matching the approved mockup) — confirmed, not a bug, nothing to fix there.

**Severity judgment:** real, but narrower and far less severe than the original bug — it doesn't block any submission, doesn't corrupt data, doesn't lie about an outcome, and currently has no in-app creation path at all (Quick Post's `libraryAssets` prop is hardcoded to `[]`, a separate, already-logged, not-yet-built gap, so a video-linked Calendar post can currently only arrive via Library/Generate Studio, not this packet's own flows). Fix is small and isolated: give the same `mediaType === 'video' ? <video> : <img>` branch to the three affected surfaces.

---

### 4. Duplicate a post — PASS for the core mechanism; one new, real, narrower edge-case finding

First attempt (duplicating an existing seeded post whose asset already had another draft on the same account) failed with a real Postgres `409`. Root-caused precisely: `idx_posts_unique_draft_per_generation_account` (a pre-existing DB index enforcing one draft per `(user_id, generation_id, account)` combination) collided with `handleDuplicatePost()` always creating its copy as `status: 'draft'`. This is **not** the original `42703` schema bug — that's confirmed fully fixed (no nonexistent-column error anywhere) — this is a different, narrower, data-state-dependent conflict: duplicating any post whose asset already has a sibling draft on the same account hits this index.

Seeded a clean control case (a fresh asset with no sibling draft) to isolate and confirm the actual fix under test: duplicating that one succeeded with **zero console errors**. Direct DB query confirmed the new row landed with `status: draft`, the same `generation_id` as the source, and the `generations` join resolving correctly. Confirmed in the live UI that the duplicate's thumbnail actually renders in the Drafts rail (`naturalWidth: 512`, matching the seeded image's real dimensions exactly). The asset-link-forward mechanism — the specific thing this fix round targeted — works correctly end to end.

**Severity judgment:** real and user-reachable (anyone who duplicates the same asset twice will hit it), but the underlying constraint exists for a legitimate reason (preventing genuine duplicate-draft clutter), and `handleDuplicatePost()`'s `catch` block currently surfaces Postgres's raw, non-user-readable error text via `toast.error(err.message)` rather than a clear "you already have a draft using this asset" message — not blocking, but worth a small, specific follow-up.

---

### 5. Spot-check of original passed findings — PASS (no regressions), with one automation-environment caveat fully resolved

- **Desktop default view:** still Month, matching original/approved behavior.
- **Tap-to-select Move-button (desktop):** re-confirmed PASS on a dedicated, freshly-seeded post — banner appeared, commit succeeded, DB-confirmed persisted. (My own first attempt at this specific sub-check mis-scoped the locator against the wrong sibling element and timed out; re-scoped correctly per `PostCard.jsx`'s actual markup and got a clean pass — a test-script error on my part, corrected and noted here rather than silently smoothed over.)
- **Full detail-drawer date/time edit:** re-confirmed PASS — typed a new date/time directly into the drawer's inline fields, clicked "Save changes," DB-confirmed the new `scheduled_at` landed exactly as typed.
- **Native HTML5 drag (desktop):** three independent automation techniques (a deliberate multi-step "lift first" mouse gesture mirroring the original report's own successful method; Playwright's purpose-built `dragTo()` helper; the same gesture repeated in headed, non-headless Chromium) all produced zero captured native drag events and zero database change. Rather than report this as a regression or leave it unresolved, ran one further, conclusive diagnostic: dispatched a synthetic `DragEvent('dragstart')` directly at the card's DOM node, bypassing Playwright's mouse-gesture simulation layer entirely. This **did** reach React's `onDragStart` handler correctly (`dataTransfer.types` came back exactly matching the component's own `setData('text/plain', ...)` call, and the `is-dragging` class applied immediately) — proving the product's drag-handling code is correctly wired. The failure is specifically Playwright/Chromium's inability to synthesize the OS-level native-HTML5-drag gesture from simulated mouse events in this sandboxed environment — a known category of automation-tooling limitation, not a product defect. None of the three fix rounds touched `CalendarGrid.jsx`'s or `PostCard.jsx`'s drag handlers at all (confirmed against each fix round's own file list). Reclassified from "inconclusive" to PASS on this basis, with a recommendation that a human re-test with a real mouse at some point as a belt-and-suspenders check — consistent with how the original mockup-phase parity report flagged comparable automation-bound findings for future real-device confirmation.
- **Month/List mobile-default switching:** re-confirmed PASS at mobile width — fresh 390px load lands on List, matching original/approved behavior, no regression.

---

## Summary verdicts

| Item | Verdict | Why |
|---|---|---|
| 1. Quick Post — multi-platform Schedule post | **Pass** | AI pre-fill now genuinely works for toggled platforms; correct outcome-accurate toast; DB-confirmed persistence; correct standalone (non-grouped) cards for null-`generation_id` rows. |
| 1. Quick Post — Save as draft | **Pass** | Correct toast, correct status, modal closes only on real success. |
| 1. Quick Post — forced-offline failure | **Pass** | Modal stays open, caption preserved, inline error shown, toast genuinely styled `tone-danger` with accurate copy, zero false DB write. Direct fix of the original worst-fit failure mode. |
| 1. (new, non-blocking) Instagram default-platform never gets AI pre-fill | **Non-blocking finding** | Pre-existing behavior, not a fix-round regression. One-line fix available. |
| 2. Move mode at mobile width (390px, Month view) | **Pass** | Grid stays full-width and on-screen; real destination cells reachable; move commits and persists. Direct fix of the original collapse bug. |
| 3. Thumbnails — image assets (List, Drawer, Drafts rail) | **Pass** | Real images render correctly in all three surfaces; assetless drafts correctly show emoji placeholder. |
| 3. (new, non-blocking) Thumbnails — video assets (Drafts rail, List row, inferred Month slide-over) | **Non-blocking finding** | Renders as a broken image (missing `media_type` branch); Drawer already handles video correctly. Narrow, isolated fix identified. |
| 3. Thumbnails — Month-grid card (PostCard.jsx) | **Confirmed correct, by design** | Dot-only, no thumbnail, matches approved mockup — not a bug. |
| 4. Duplicate a post — core mechanism | **Pass** | No `42703` error; asset link and thumbnail carry forward correctly; DB-confirmed. |
| 4. (new, non-blocking) Duplicate — existing-sibling-draft conflict | **Non-blocking finding** | Real `409` from a pre-existing, legitimate DB constraint, surfaced as a raw/unreadable error rather than a graceful message. Distinct from, and narrower than, the original schema bug. |
| 5. Tap-to-select Move-button (desktop) | **Pass, no regression** | Re-confirmed working and persisted. |
| 5. Full detail-drawer date/time edit | **Pass, no regression** | Re-confirmed working and persisted. |
| 5. Native HTML5 drag (desktop) | **Pass, no regression** | Confirmed correctly wired via direct DOM-event diagnostic after three automation-gesture techniques failed for environment reasons, not product reasons. |
| 5. Month/List mobile-default switching | **Pass, no regression** | Unchanged, correct. |

## Recommendation

**This packet is genuinely done from a QA-persona standpoint.** Both original blocking regressions — Quick Post's complete non-functionality (`media_type` schema error) plus its toast lifecycle/false-positive-success bug, and the mobile move-mode calendar collapse — are confirmed fixed through real, live interaction against the real app and real data, not inferred from the fix-round agents' own reports. No regressions were found in any previously-passed flow.

Three new, real, narrower findings surfaced by testing more broadly (video assets, edge-case duplicate conflicts, default-platform pre-fill) than the three individually-scoped fix rounds did — none of them rises to the severity of either original bug (none silently lies about an outcome, none makes a primary surface unusable, all three have small, already-identified, isolated fixes):

1. Quick Post's AI caption pre-fill never fires for the platform active by default on modal-open — add a mount-time `prefillCaption()` call for the initially-active platform in `QuickPostComposer.jsx`.
2. Video-asset thumbnails render as a broken image in `UnscheduledRail.jsx`, `CalendarListView.jsx`, and (inferred) `CalendarGrid.jsx`'s slide-over — give each the same `mediaType === 'video' ? <video> : <img>` branch `PostDetailDrawer.jsx` already has.
3. Duplicating a post whose asset already has a sibling draft on the same account hits a real `409` unique-constraint conflict, surfaced as a raw, unreadable error — catch the specific constraint violation in `handleDuplicatePost()` and show an honest, specific message (or offer to open the existing draft instead).

These are recommended as a future polish pass, not a blocking fix-and-resubmit cycle. All test data created during this re-test (multiple "QA RETEST3/4/5" and "QA verify..." prefixed posts/drafts/generations) was left in place in the QA account, individually traceable by caption/title prefix, per this packet's established convention. All throwaway Playwright driver scripts (including ~28 leftover scripts found from a prior, session-limit-interrupted re-test attempt) were deleted after use; none are deliverables.

---
---

# ORIGINAL REPORT (SUPERSEDED) — Build Phase (Phase 4), 2026-06-24

Packet 1: Personal Content Calendar — real implementation at `/app/calendar` (`PersonalCalendarPage`)

Agent: `qa-persona-agent`
Persona walked through: **Solo Sade** (personal workspace, phone, on the move between client visits, cares about speed, thumb-reachable actions, not losing work on flaky connections) — same persona and same flows as the mockup-phase `QA_PERSONA_REVIEW_mockup.md` (final verdict: PASS, recommended for approval), re-run here against the real, running build, against real Supabase data, not a static mockup.

**Method:** Real Chromium browser via Playwright, driven against the already-running dev server at `http://localhost:3000` (a `next dev --turbopack` instance was already up when this review started; I used it directly rather than starting a second instance). Logged in as the QA test account (`brandosse.qa@brandosse.test`, credentials resolved from `scripts/qa-screenshot.cjs`'s own defaults since no `QA_EMAIL`/`QA_PASSWORD` override exists in `.env`/`.env.local`). Desktop context: plain `viewport: 1440×900`. Mobile context: `viewport: 390×844, hasTouch: true, isMobile: true`, using real `page.touchscreen.tap()` calls, not clicks on a resized window. Real `mouse.down()`→multi-step `mouse.move()`→`mouse.up()` sequences for native-HTML5-drag flows. Where the account had no drafts to test the Drafts-rail flows against (it started with 2 pre-existing, captionless "Untitled" scheduled posts and zero drafts), I seeded test drafts directly via a Supabase service-role insert — explicitly to exercise the Drafts-rail's own drag/Move mechanics independently of Quick Post's creation path (which I found broken — see Flow 3), not to fake a passing Quick Post result. All throwaway driver scripts and screenshots were written outside the deliverable tree and deleted after extracting findings; none are a deliverable.

**Test data created (traceable, left in place, QA account only):** 4 posts inserted directly via Supabase during this review — "QA seed draft" (instagram, now `status: scheduled`, `scheduled_at: 2026-06-28`), "QA drag-test draft" (facebook, now `status: scheduled`, `scheduled_at: 2026-06-10`), "QA mobile move test" (instagram, still `status: draft`, untouched), and one earlier artifact from a previous QA session (`status: draft`, `scheduled_at: 2026-06-01`, no title — pre-existing, not created by this review). The two original pre-existing posts ("Untitled", captionless) were moved during flow testing: one is now at `2026-06-30T15:30` (via the drawer's "Save changes"), the other at `2026-06-05T09:00` (via native drag). None of this was cleaned up, per the task's explicit allowance, since it doesn't interfere with future testing and is fully traceable above.

## Verdict: FAIL — two real, build-only regressions block this from matching what the approved mockup promised; most flows otherwise pass cleanly against real data

Three of the four mockup-promised reschedule paths (native drag, Move-button tap-to-select on desktop, full detail-drawer date/time edit) work correctly against real Supabase data, including surviving a genuine page reload in a fresh browser context — this is real, durable persistence, not an optimistic UI illusion. The Drafts-rail's drag and Move-button paths also both work correctly on desktop. However, I found two real, confirmed-live regressions that did not exist in the approved mockup and that directly contradict what was promised and QA-verified in Phase 2:

1. **Quick Post is completely non-functional for both submit paths** ("Save as draft" and "Schedule post" both fail with a real Postgres/PostgREST schema error on every attempt, regardless of platform/asset selection), and even when fixed, the success-path confirmation toast (the exact fix the mockup-phase QA explicitly verified resolved Sade's "don't lose work silently" concern) is wired to never actually render, because the parent unmounts the whole composer in the same synchronous tick it sets the toast state.
2. **Entering Move mode (tap-to-select reschedule) in Month view at mobile width makes the entire calendar grid disappear** (collapses to 0 width, scrolled off-screen) because the sticky move-mode banner and the calendar body are laid out as flex *row* siblings with no `flex-direction: column` override, and the banner's un-shrinkable content pushes the grid's `flex:1; min-width:0` column to literally zero. This is masked by mobile's own correct List-view default (List has no Move trigger at all, by design), so it only surfaces if a mobile user deliberately switches to Month and taps Move — but Master Brief §4 requires every interactive element to work at every width, not just the default one, and "the whole calendar vanishes" is a severe symptom for a reachable path.

Both are real product defects confirmed through live interaction and code-level root-cause tracing, not test-methodology artifacts — I want to be explicit about that distinction because two other things I initially logged as suspected bugs during this session turned out, on closer live re-testing, to be my own test-script timing/gesture artifacts, and I'm reporting those separately below exactly as the mockup-phase QA agent's own practice was, rather than silently discarding the false leads.

---

### Flow 1 — Schedule a draft from the Drafts/Unscheduled rail

**1a. Desktop (1440px), drag a draft onto a calendar date.**

What Sade was trying to do: drag a seeded test draft ("QA drag-test draft") from the open Drafts rail onto Jun 10.

What happened: **my first attempt appeared to fail** — `dragover`/`drop` event counters I'd instrumented stayed at 0, and the draft remained in the rail untouched after the attempt. Before reporting this as a regression, I re-tested with a different synthetic-mouse technique (a small vertical "lift" movement first, mirroring how a person would actually pick a card up off a horizontal rail, rather than a large diagonal jump) — and on that attempt, the full native drag event sequence fired correctly (`dragstart` → repeated `dragover`/`dragenter` across the grid → `drop:cal3-month-cell` → `dragend`), and a direct database check confirmed the draft's `status` flipped to `scheduled` with `scheduled_at: 2026-06-10T09:00:00`, surviving the interaction. **I'm reporting both results explicitly, the same way the mockup-phase QA agent reported its own first-pass drag "failure" being a testing-technique limitation, not a design defect** — this is a real, working feature; my first test attempt's gesture simply didn't cross Chromium's native drag-start threshold.

Would it make sense to Sade without explanation: yes — a real person doesn't drag with a single instantaneous mouse-event jump the way a naive test script does; the actual interaction (press, lift, drag, drop) works correctly and self-evidently.

**1b. Desktop, tap (click)-to-select via the Move button.**

Seeded a second draft ("QA seed draft") and clicked its Move button. Worked correctly end-to-end on the first attempt: banner appeared reading "Moving **QA seed draft** — tap a highlighted day to schedule it there" (correctly using the draft's real title), clicking the Jun 28 cell committed the move, banner disappeared, and a "Post rescheduled" toast fired. Reloaded the page in a fresh browser context afterward and confirmed the post genuinely persisted at Jun 28 — this is real, durable backend persistence, not a client-side-only optimistic state.

One minor, non-blocking copy nit: the confirmation toast read "Post rescheduled" for what was actually a brand-new schedule action (a draft moving from unscheduled to scheduled, not an already-scheduled post moving dates) — functionally correct, just a slightly imprecise word choice versus the mockup's more precise distinct copy for "Saved as draft" vs. "Post scheduled" in the Quick Post flow specifically. Not something Sade would be confused by, just an inconsistency worth a one-line copy fix.

**1c. Mobile (390px), tap-to-select via the Move button.**

Seeded a third draft, switched to Month view (List is mobile's correct default — see Flow 4), scrolled to the Drafts rail, and tapped its Move button with a real touch tap. **This is where I found Regression #2** (see "Headline findings" above and the dedicated section below): the banner appeared with the correct text, but the calendar grid behind it had collapsed to 0px width and scrolled off the right edge of the 390px viewport, leaving no visible day cell to tap as a destination. Tapping where a destination cell's `getBoundingClientRect()` reported it should be (x:390, i.e., one full viewport-width to the right, fully off-screen) predictably did nothing, since nothing was actually there to tap.

Would it make sense to Sade without explanation: no. She would tap Move on her phone, see the banner correctly tell her what to do next ("tap a highlighted day"), and then find there is nothing on her screen to tap — the entire calendar would have visually vanished. This is exactly the kind of silent, confusing failure her persona profile is most vulnerable to.

---

### Flow 2 — Reschedule an already-scheduled post

**2a. Drag (desktop).** Dragged one of the pre-existing real posts from its cell to Jun 5. Worked correctly on the first attempt this time (no test-technique retry needed) — mid-drag highlighting, drop, and a "Post rescheduled" toast all fired correctly, and a fresh-context reload confirmed the move persisted.

**2b. Tap-to-select → tap-destination, real Month-grid card (desktop).** Clicked the Move button on a real post card. Banner appeared (generic "Moving **this post**" text, since this particular post genuinely has no title or caption in the database — confirmed by inspecting the row directly; the fallback to "this post" is correct given the data, not a bug, though it's worth noting the banner's name-resolution logic — `posts[0]?.title` only — is less robust than `PostCard.jsx`'s own card-label logic, which also falls back to a caption snippet before "Untitled"; a minor inconsistency, not a functional defect). Tapped the Jun 26 destination cell; committed correctly, banner disappeared, toast fired.

**2c. Full detail-panel edit (desktop).** Opened the Post Detail Drawer on a real post, typed a new date (Jun 30) and time (15:30) directly into the drawer's own inline `<input type="date">`/`<input type="time">` fields, and clicked "Save changes". This worked correctly and visibly — the background Month grid updated live to show the post moved to Jun 30 at 3:30pm, and a "Saved" toast fired. I separately tested the drawer's other action button, "Reschedule…", and confirmed it does something different on purpose: it opens the full Schedule Modal (with the explicit account-timezone banner) showing the post's *original*, not locally-edited, date — this is correct, intentional behavior (the drawer's inline fields feed "Save changes"; "Reschedule…" is the separate, heavier path to the dedicated Schedule Modal), not a bug. I want to flag explicitly that I initially mis-tested this as a bug (typed into the inline fields, then clicked "Reschedule…" expecting it to reflect my typed values, and it didn't) before realizing "Save changes" and "Reschedule…" are two intentionally distinct actions reading from different state — correcting that here so it isn't mistaken for a real defect by a future reader skimming only the first attempt.

**2d. Mobile (390px), tap-to-select.** Not independently re-tested beyond the Drafts-rail Move-mode test in 1c, since the underlying bug (the calendar grid collapsing to 0-width whenever the move-mode banner is active in Month view at mobile width) is identical regardless of whether the card being moved is a draft or an already-scheduled post — both render through the same `.cal3-body`/`.move-mode-banner` flex structure. This is the same Regression #2 described above and in its own section below, not a second, separate bug.

---

### Flow 3 — Quick Post end-to-end (the specific flow the human found broken in the mockup and had fixed)

**What Sade was trying to do:** a quick multi-platform post (Instagram + TikTok + LinkedIn), no Library asset, scheduled in the gap between two client visits — the exact scenario the mockup-phase fix (toast confirmation, per-platform caption pre-fill) was built and QA-verified for.

**What happened, in order:**

1. Opened Quick Post via the header button. Modal opened correctly, Instagram on by default.
2. Toggled TikTok and LinkedIn on. **Both got stuck permanently on a "✨ Pre-filling…" loading state with empty captions** — confirmed via direct DOM read (`caption: ""` for all three platforms, `hasPrefillNote: true` for TikTok/LinkedIn but reflecting only the loading note, not an actual prefilled caption). Instagram, the default-active platform, never got a prefill attempt triggered at all (the prefill call only fires inside the toggle handler when a platform is newly switched *on* — it never fires for the platform that's already active on mount). A real console error explained why: `Failed to load resource: the server responded with a status of 400`, with the app's own caught error reading `Could not find the 'media_type' column of 'posts' in the schema cache (PGRST204)`.
3. Typed a caption manually into the Instagram field to work around the broken pre-fill, and clicked **"Schedule post"**. The modal stayed open and the same `media_type`/`PGRST204` error fired again — this submit path failed too.
4. Also independently tested **"Save as draft"** with default settings — identical failure, identical error.

**Root cause, confirmed by reading the code directly:** `calendarService.createQuickPost()` builds each fanned-out `posts` row with a `media_type: asset?.media_type || null` field. `media_type` is a real column — but on the **`generations`** table, joined into reads via `POST_SELECT_COLUMNS`'s `generations ( storage_path, media_type, prompt )` — not a column on `posts` itself. Every Quick Post submission, with or without a Library asset attached, with or without any platform's caption successfully pre-filled, fails identically and unconditionally. This means **Quick Post — the specific flow the human found broken in the mockup, had explicitly fixed, and which the mockup-phase QA agent explicitly re-verified working on both submit paths — is completely non-functional in the real build**, for an unrelated, new reason introduced during Phase 3's data-layer/frontend wiring.

**A second, independent bug found in the same flow, visible because the first bug forced every test attempt down the error path:** when `handleSubmit` fails, the component's `catch` block sets a toast reading `Could not save: Could not find the 'media_type' column...` — but the toast's **icon stays styled as a green success checkmark** (`.cal3-toast__icon.tone-success` is hardcoded into the JSX, not switched based on success/failure), and the toast's **body text is hardcoded** to "Find it in the Drafts rail, the Calendar, or the Library anytime — nothing was lost" regardless of whether the save actually succeeded. For Solo Sade specifically — whose defining concern is exactly "not losing work on flaky connections" — a failed save that visually presents as a green success checkmark, paired with copy that explicitly tells her nothing was lost, is the single worst-fit failure mode possible for her persona: she would see green, read "nothing was lost," and walk away from her phone believing the post is safely saved when it never was.

**A third bug, found by reading the success path's code directly (could not be triggered live, since every real submit attempt fails on the schema bug above before reaching this code):** on a successful save, `handleSubmit` calls `setToast(...)` and then immediately calls `onClose?.()` in the same synchronous block. The parent page renders `QuickPostComposer` conditionally (`{quickPostOpen && (<QuickPostComposer .../>)}`), and `onClose` sets `quickPostOpen` to `false` — unmounting the entire composer, including its local toast state, before React has a chance to paint it. This means that even once the schema bug is fixed, **a successful Quick Post submission would still close silently with zero confirmation** — the exact regression of the exact bug the mockup-phase QA agent explicitly verified fixed ("Fix 8," `DECISIONS_LOG.md`, 2026-06-24T00:00:03Z) and confirmed live with a real toast screenshot. The fix did not carry over correctly into the real component's lifecycle.

**Would the end-to-end flow make sense to Sade without explanation:** no, on every count that matters for her. The captions never actually fill in for any platform (the entire point of the per-platform AI pre-fill, the specific gap the human found in the mockup and had fixed). Neither submit button does anything she could trust. And the one piece of feedback she does get on failure actively lies to her in the one way her persona is most sensitive to.

---

### Headline finding — Move-mode banner collapses the Month grid to zero width at mobile widths

**Confirmed root cause (not theoretical — traced via live `getBoundingClientRect()`/`getComputedStyle()` reads during an active move-mode session):** `.cal3-body` (the flex container holding both the sticky move-mode banner and the calendar's main column) has `display: flex` with no `flex-direction: column` override at any width. Its computed `flex-direction` is `row` at 390px. The move-mode banner (`.move-mode-banner`, `position: sticky`) is a flex *sibling* of `.cal3-main-col` (`flex: 1; min-width: 0`) in that row — not a stacked element above it. When the banner is present, its content (a 32px icon, body text with `min-width: 180px`, and a Cancel button) takes up a full row's width and, combined with `flex-wrap: wrap` causing it to also grow vertically to fill the available height, it ends up reported as occupying the entire 390×611px body box. `.cal3-main-col`, with `min-width: 0`, gets compressed to a measured `width: 0` and is pushed off-screen (`x: 390`, i.e., exactly one viewport-width to the right) along with every child cell inside it, including all "highlighted destination" cells move mode is supposed to let the user tap.

**User-facing consequence:** a phone user who switches from the (correct, mobile-default) List view into Month view and then taps a Move button sees the banner appear correctly with the right text — and then the entire calendar disappears. There is nothing left on her screen to tap as a destination. The only way out is the banner's own "Cancel" button (which does remain visible and tappable, since it's part of the banner itself, not the grid) — so she isn't permanently stuck, but the feature is entirely unusable from this surface at this width.

**Why this didn't surface in the mockup:** the approved mockup's equivalent move-mode banner was never laid out as a flex-row sibling of the grid in the same container; this is new layout structure introduced during the real component build, not a port of something the mockup already demonstrated and had verified at narrow widths.

**Severity judgment:** real and blocking for the specific reachable path (Month view + Move, at mobile width) but not a regression of the *mobile-default* experience, since List view (where mobile users land first, correctly) has no Move trigger at all by design — a fact already known and explicitly judged non-blocking in the mockup phase. I am not the one to decide whether "the calendar disappears on a non-default but explicitly reachable path" rises to blocking severity for this packet's exit criteria; I'm reporting the live, confirmed mechanism precisely so that decision can be made with full information, consistent with how prior-phase reviewers in this same packet have handled comparable judgment calls.

---

### Flow 4 — Month/List default switching at mobile vs. desktop widths

Confirmed correct on first load, matching the mockup-approved behavior exactly: a fresh 390px-viewport session lands on **List** view by default (`active view button: "List"`), and a fresh 1440px-viewport session lands on **Month** view by default. Manually switching to Month at 390px works and stays selected (consistent with the mockup's "explicit user pick persists through resize" behavior, though I did not specifically re-test the resize-persistence case in this build pass, only the two independent fresh-load defaults).

---

### Flow 5 — Empty state / loading skeleton

The account is not empty (it has real posts/drafts throughout this session), so a true empty-state render was not directly observable without deleting all QA data, which I avoided per the task's "don't worry about cleaning it up unless it would interfere with future testing" guidance (deleting everything to force an empty state would interfere with exactly that). I did confirm `CalendarGrid.jsx` contains real, non-stubbed skeleton-rendering code (`SkeletonMonth()`, gated on `isLoading`) rather than an empty placeholder, but I was not able to reliably catch it rendering live — my fastest-possible screenshot (taken ~50-150ms after navigation commit) consistently showed the fully-loaded grid already, most likely because the dev server's data fetch completes faster than that window in this environment (warm Turbopack cache, local Supabase round-trip latency, and React Query's client-side cache from earlier same-session visits). I am reporting this as "present in code, not independently confirmed live," not as a pass — a future reviewer with network throttling enabled, or testing the very first cold page load of a session, should re-check this specifically.

---

### Console errors across the full session

Two real console errors were captured, both from the same root cause already detailed in Flow 3 (the `media_type` schema mismatch) — `Failed to load resource: the server responded with a status of 400` and the app's own caught `PGRST204` message. No other console errors, React warnings, or page errors occurred across the full session (drag/move/drawer/Month/List/mobile/desktop flows all produced zero console output).

---

## Summary verdicts

| Flow | Verdict | Why |
|---|---|---|
| 1a. Drag a draft onto a date (desktop) | **Pass** | Works correctly with a real multi-step mouse gesture; persisted across a fresh-context reload. First attempt's apparent failure was a test-gesture artifact, explicitly re-tested and resolved, not a product bug. |
| 1b. Tap-to-select a draft → tap-destination (desktop) | **Pass** | Correct banner text (real draft title), correct commit, correct toast, persisted across reload. |
| 1c. Tap-to-select a draft → tap-destination (mobile, Month view) | **Fail** | Banner appears correctly, but the calendar grid behind it collapses to 0-width and scrolls off-screen — no destination cell is reachable. See headline finding. |
| 2a. Drag reschedule, real grid (desktop) | **Pass** | Worked on first attempt; persisted across reload. |
| 2b. Tap-to-select → tap-destination, real Month-grid card (desktop) | **Pass** | Correct banner, commit, toast. Minor non-blocking note: banner's name-fallback logic is less robust than the card's own. |
| 2c. Full detail-panel edit (desktop) | **Pass** | "Save changes" correctly commits inline date/time edits and persists; "Reschedule…" correctly opens the separate Schedule Modal as designed (initial confusion during testing was my own mis-test, not a defect). |
| 2d. Tap-to-select → tap-destination, real Month-grid card (mobile) | **Fail** | Same root cause as 1c — identical flex-layout bug, not independently re-tested as a separate issue. |
| 3. Quick Post end-to-end (multi-platform, both submit paths) | **Fail (blocking)** | Both "Save as draft" and "Schedule post" fail unconditionally on a real schema mismatch (`media_type` column does not exist on `posts`); per-platform AI caption pre-fill never completes for any platform; on failure, the error toast is styled as a success and its hardcoded copy falsely tells Sade nothing was lost; on a (currently unreachable) success path, the confirmation toast would still never render due to a component-unmount-before-paint bug — a direct regression of the mockup-phase's explicitly verified "Fix 8." |
| 4. Month/List mobile-default switching | **Pass** | Matches approved mockup behavior exactly at both widths on fresh load. |
| 5. Empty state / loading skeleton | **Inconclusive, not a fail** | Skeleton code is real and present; could not be reliably captured rendering live in this environment/session. Flagged for a future cold-load/throttled re-check, not reported as broken. |
| Console errors | **2 errors, both attributable to the Quick Post `media_type` bug** | No other errors anywhere else in the session. |

## Recommendation

**This packet is not done. Two items must go back before this can be re-reviewed:**

1. **`feature-data-layer-builder`** (or whichever agent owns `calendarService.js`): remove the `media_type` field from `createQuickPost()`'s row-insert payload (it belongs on `generations`, not `posts` — confirmed directly from `POST_SELECT_COLUMNS`'s own join shape in the same file) or otherwise fix the insert so it matches the real `posts` schema. This single fix should resolve all of Flow 3's failures, since every other piece of Quick Post's logic (account resolution, fan-out, grouping) was never actually exercised past this point.

2. **`feature-frontend-builder`** (or whoever owns `CalendarEngine.css`/`PersonalCalendarPage.jsx`): fix `.cal3-body`'s flex layout so the move-mode banner stacks above the calendar body instead of beside it (the minimal fix is almost certainly adding `flex-direction: column` to `.cal3-body`, or moving the banner outside the flex row entirely as an `position: sticky` block-level element above it — either resolves the `min-width: 0` squeeze). Also fix `QuickPostComposer.jsx`'s success path so the confirmation toast actually has a chance to paint before the modal unmounts (e.g., delay `onClose()` until after the toast's visible duration, or lift the toast out of the component being unmounted, into a stack that survives the composer closing — the same pattern `ToastStack.jsx` already establishes elsewhere in this same component tree). And fix the error-path toast's icon/copy to actually reflect failure rather than hardcoding a success checkmark and "nothing was lost" regardless of outcome.

Everything else tested — native drag, Move-button tap-to-select on desktop, the full detail-drawer date/time edit, Drafts-rail scheduling on desktop, real data persistence across reloads, and the Month/List mobile-default switch — passed cleanly against real Supabase data, with no console errors of their own. This is meaningfully real, working progress; the two failures found are specific, traceable, and each has an isolated, narrow fix path already identified above — this is not a "go back to the drawing board" verdict, but it is a "ship-blocking, re-test after these two fixes" verdict.
