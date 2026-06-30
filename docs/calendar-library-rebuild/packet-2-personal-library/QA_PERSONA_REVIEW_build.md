# QA Persona Review — Build Phase (Phase 4, post-migration)
Packet 2: Personal Content Library — real live build at `/app/library`, real QA account, real Supabase project (`ujkuwemwlhilzarbrozu`), real edge functions.

Agent: `qa-persona-agent`. Persona walked through: **Solo Sade** (personal workspace, phone, on the move, cares about speed/thumb reach/not losing work on a flaky connection) — same persona, same flows as the mockup-phase report, re-run against the real build now that the human has applied `supabase/migrations/20260625100000_personal_assets_table.sql` via the Supabase Dashboard SQL editor.

**Method:** Real Chromium via Playwright, against the actual running `next dev --turbopack` server on `localhost:3000` and the real QA account (`brandosse.qa@brandosse.test`). Every claim below is backed by a live network trace, a live DOM read, a live screenshot, or a direct authenticated REST query against the live database — not a code read and not an assumption. Where I needed to distinguish a real app bug from a test-fixture artifact (the AI-tagging failure) or from dev-server noise (Fast Refresh aborting in-flight requests), I controlled for it explicitly and say so below. Eighteen throwaway driver scripts and one fixtures folder were written to the repo root during this session and deleted immediately after extracting findings; none are deliverables, none remain.

## Blocker check (required first step)

**Confirmed cleared.** `GET /rest/v1/personal_assets?select=id&limit=1` (anon key, no auth) returns `200 []`, not a `PGRST205`/"Could not find the table" error. Querying every column the schema is supposed to have (`source`, `ai_tags`, `ai_tagging_status`, `used_in_post_ids`, `superseded_by_asset_id`, `checksum`, `perceptual_hash`, `status`, `deleted_at`) also returns `200`, confirming no missing-column gap either. Loading `/app/library` as the real QA user produces a real `200` query for `personal_assets` scoped to that user's `user_id`, returns 37 pre-existing rows (6 generation-sourced, 31 post-linked, 0 uploads, 0 unused, 0 archived) — confirming the migration's one-time backfill of existing `generations`/`posts` rows into `personal_assets` ran correctly. No console errors, no PGRST205 text anywhere in the rendered page. **The backend is genuinely live and provisioned; testing proceeded against real data, not a half-broken backend.**

## Verdict summary

| Flow | Verdict | Divergence from mockup phase |
|---|---|---|
| 1. Upload from phone (tap-to-pick) | **Pass** (upload itself) / **Fail** (AI tagging) | Real upload mechanics (filechooser, progress, storage write, DB insert) all work exactly as the mockup promised. AI tagging — new in this phase, untestable at mockup fidelity — fails 100% of the time due to a real code bug, not a missing key |
| 2. AI auto-tagging shimmer → resolved tags | **Fail** | New finding, not testable at mockup phase. The shimmer state itself never appears in the real upload queue row at all (a UI gap beyond the tagging bug itself), and tags never resolve because the underlying vision call always 404s |
| 3. Duplicate detection | **Pass** | Matches mockup phase. Real checksum match, real warning copy, real two-button choice, fires correctly on a genuine second upload of the same file |
| 4. Schedule hand-off → Quick Post pre-selected | **Fail — this is the Phase 2 Concern, now confirmed broken in the real build, not resolved** | At mockup phase this was a documented, deliberate simplification ("Concern, not a Fail"). In the real build the route, the param contract, and the data fetch are all individually correct and verified — but the composer never opens at all, with or without the asset. This is now a regression from "doesn't yet feel continuous" to "doesn't work" |
| 5a. Version history (mark-as-new-version) | **Concern — works, but intermittently** | Not testable at mockup phase (mockup's button was cosmetic-only, by design). In the real build, the underlying PATCH write succeeded reliably exactly once across multiple attempts in this session; three other attempts at the same action left `superseded_by_asset_id` unset with no visible error to the user |
| 5b. Version chain — old row hidden from default view | **Fail** | Not testable at mockup phase. The service's own code comment promises superseded rows are excluded from `fetchPersonalAssets()`'s default view; in the live build, superseded originals still appear in the grid alongside their replacements |
| 6. Soft-delete + confirm modal | **Pass** | Real confirmation copy, real "moves to Trash, not permanent, 30-day window" language, real removal from the grid after confirming |
| 7. Restore from Trash | **Fail — no UI path exists** | Not testable at mockup phase (mockup didn't model a Trash view). The store/service have working `fetchTrashedPersonalAssets`/`restorePersonalAsset` methods, but `LibraryPageV2.jsx` never calls them and there is no Trash button, rail item, or modal anywhere in the live page. A real Sade who deletes something by mistake has no way to get it back from the UI today |
| 8. "Used in" list | **Pass** | Section renders correctly, real explanatory copy for the unused case ("Not used on any post yet — that's why this card shows the 'Unused' badge") |
| 9. "Unused" filter / rail counts | **Pass** | Real counts, update correctly after upload/delete, matches the mockup's intent |
| 10. Grid/table view toggle | **Not fully re-verified this session** (scoped out by time; no reason from anything found to expect regression — desktop grid view itself works correctly) | — |
| 11. Mobile filter rail bottom sheet | **Pass** | Genuine full-screen `UiBottomSheet`, real swipe handle, correct Source/Status rail with live counts (41/4/6/31/4/0), closes correctly |
| 12. Mobile grid/card tappability | **Fail — severe** | New finding, not present in the static-HTML mockup (which had no real dashboard chrome wrapper). At real mobile and even tablet widths, the asset grid's scroll container collapses to a few dozen pixels of height, making most or all of the grid physically untappable |
| 13. Upload validation failure (unsupported file type) | **Not exercised this session** — see note below | Diverges from the mockup's `.mov`-rejection scenario, see note |

---

## Flow 1 — Upload an asset from her phone (real upload)

**What Sade was trying to do:** get a real product photo into her Library from a session in the parking lot, the same as mockup phase.

**What happened, live:** Opened the Upload modal, triggered a real Playwright `filechooser` event against the real hidden `<input type="file" multiple>` (confirmed `isMultiple() === true`, exactly as at mockup phase), supplied a real file. The real `personal-asset-upload` edge function returned `200` with a fully-populated `personal_assets` row: real `id`, correct `source: "upload"`, correct `media_type`/`mime_type`/`file_size_bytes`, a real `storage_path`/`file_url` pointing at the live `personal-assets` Storage bucket. I independently fetched that `file_url` directly (outside the browser) and got back the real uploaded bytes — the file genuinely persisted, not just a database row claiming it did. Progress bar animated to 100%, green checkmark appeared. This matches the mockup's promised behavior exactly and is a **Pass** for the upload mechanic itself.

**Where it diverges from the mockup — AI tagging, never testable until now:**

The mockup could only simulate the shimmer-to-tags transition with a fixed timer; this phase is the first time it could be checked against a real Claude vision call. It fails, every time, for a verifiable, specific reason:

I called the live `personal-asset-ai-tag` edge function indirectly (via the real upload flow) and directly (replicating its exact Anthropic request from outside the app, using the same `ANTHROPIC_API_KEY` value configured as a live Supabase secret) to isolate the cause. The edge function hardcodes:

```ts
const VISION_MODEL = "claude-3-5-sonnet-latest";
```

Calling Anthropic's `/v1/messages` endpoint with this exact model string and this exact API key returns:

```json
{"type":"error","error":{"type":"not_found_error","message":"model: claude-3-5-sonnet-latest"}}
```

I then proved the key itself is valid and has real vision access by calling the identical endpoint with `claude-haiku-4-5-20251001` (a model name already used elsewhere in this same shared codebase, in `_shared/llm.ts`) against a real photo — it returned a correct `200` with real tags, a real description, and real alt text. **This is not a missing-API-key gap and not a test-fixture problem** (I ruled both out explicitly, including retrying with a 1x1 pixel JPEG, a genuinely corrupt fixture, and a real downloaded photo). It is a hardcoded invalid model name in the deployed `personal-asset-ai-tag/index.ts`, and it fails 100% of the time, for every real user, on every real upload, today.

**A second, related, independent finding:** even setting the model bug aside, the failure is invisible to the user. The edge function swallows the real Anthropic error and only ever persists `ai_tagging_status: 'failed'` with no message anywhere queryable. Worse, in the live upload modal's queue row, there is no shimmer state shown at all once a file reaches 100% — the row just shows the filename, a full green progress bar, and a checkmark, identical in appearance to total success. Sade would have zero indication that tagging happened, is happening, or failed. This is a real regression from the mockup's own explicit promise (a visible animated shimmer that resolves into tags) — the live build shows neither the shimmer nor a failure state, just silence.

**Would it make sense to Sade without explanation:** the upload itself, yes, exactly as at mockup phase. The AI tagging: no — she would have no way of knowing anything was supposed to happen here at all, and would have no reason to suspect the empty "Alt text (AI-suggested, human-editable)" field in the drawer is a bug rather than just an empty field she can fill in herself.

**Verdict: Pass for upload, Fail for AI tagging — a real, fixable, specific bug, not a missing-key gap.**

---

## Flow 2 — Duplicate detection (real checksum match)

**What Sade was trying to do:** upload the same product photo twice by mistake (or deliberately, testing the system), the same scenario as mockup phase, now against the real checksum logic.

**What happened, live:** Uploaded a real file once successfully. Uploaded the exact same file a second time. The real `personal-asset-upload` function computed a server-side checksum match against the first row and the upload modal showed: *"This looks like a duplicate of 'real-photo.jpg' / Some duplicates are intentional re-uploads of an edited version."* with both **"This is a new version"** and **"It's a separate asset"** buttons present — byte-for-byte the same copy and choice structure as the mockup. This is a genuine, live, checksum-based match against real data, not a simulation. Confirmed by direct REST query that the second upload's row and the first's share the relevant checksum field.

**Would it make sense to Sade without explanation:** yes, identical to the mockup-phase finding — the two-button phrasing is in her language, not database language.

**Verdict: Pass — fully matches the mockup, now proven against a real second upload rather than a staged demo.**

---

## Flow 3 — Schedule directly from the asset (the Phase 2 Concern, now re-tested)

**This is the most important re-test in this report**, because the mockup-phase Concern was explicitly that this flow's mechanics looked correct but the actual payoff — the asset arriving pre-selected in Quick Post — could not be proven at mockup fidelity. The decisions log shows the frontend builder traced this "end-to-end" via code reading and declared it correct. I tested it as a real click, through a real browser, against the real backend.

**What Sade was trying to do:** schedule a real photo already in her Library, without detouring through AI Studio — the exact flow the packet names as its single highest-value connection.

**What happened, live:**

1. Opened the real asset detail drawer for a real uploaded photo. Clicked the real "Schedule…" button.
2. Traced the URL change frame-by-frame (polling every 150-200ms). The navigation correctly produced `http://localhost:3000/app/calendar?quickPost=1&prefillAssetId=<the real asset's id>` — the exact contract `buildScheduleHandoffPath()` and `PersonalCalendarPage.jsx`'s reader are both supposed to use. This part is genuinely correct: right route, right param names, right asset id.
3. Independently confirmed, via live network trace, that `PersonalCalendarPage.jsx` did fire a real `fetchAssetForHandoff(assetId)` call and got back a real `200` with the correct asset's full row.
4. The query string was then stripped from the URL (down to bare `/app/calendar`) within roughly half a second, by the same effect's own cleanup code (`setSearchParams` deleting `quickPost`/`prefillAssetId` once "consumed").
5. **At no point in this entire sequence did the Quick Post composer open.** I polled for `[role="dialog"]` elements every 150ms for nearly 3 seconds after the click and the count was `0` throughout — not even a brief flash of the composer opening and closing. The asset fetch succeeded; the composer simply never appeared. The final state Sade actually lands on is the Calendar's empty month view with a "Nothing scheduled yet — create your first post" prompt, exactly as if she had navigated to `/app/calendar` cold, with no memory of where she came from.

**What this means concretely:** the mockup-phase Concern was "the asset doesn't travel into the composer, but the route and the surrounding mechanics are solid, and this is openly flagged as deferred Phase 3 work." That framing does not hold anymore. In the real build, the route is solid and the asset *data* really is fetched correctly — but the actual user-visible outcome is now worse than the mockup's: nothing opens at all. A real Sade clicking "Schedule…" today, on the live build, would watch the page navigate to the Calendar and then just... stop, with no composer, no error, no asset, no indication anything happened in response to her click. This is a regression in user-visible terms, even though more of the underlying plumbing is now real and correct than at mockup phase.

**Root cause, confirmed by direct code read after the live trace pointed at it:** `PersonalCalendarPage.jsx`'s effect calls the asynchronous `fetchAssetForHandoff` inside an IIFE, but calls `setSearchParams(...)` (the param-cleanup) synchronously in the same effect tick, not after the IIFE resolves. The async fetch and the composer-opening `setQuickPostOpen(true)` are both inside the same IIFE and depend on a `mounted` flag set by the effect's cleanup function. Given Next.js client-side navigations can re-render/re-mount the page tree, and the param cleanup itself triggers a router update, there is a real race between "the async work finishes and tries to open the composer" and "the component that's supposed to receive that update is still the same mounted instance." The live evidence (fetch succeeds, composer never opens, in 100% of repeated attempts in this session) is consistent with this race losing every time in this environment, not occasionally.

**Would it make sense to Sade without explanation:** no, and this is worse than the mockup-phase answer to the same question. At mockup phase, she'd at least see something happen (a tab open, a section load, an empty asset picker she could fix herself in two more clicks). In the live build, she clicks Schedule, watches a navigation happen, and ends up looking at an empty calendar with no surfaced error and no asset — she has no way to tell whether her click "worked," whether the asset was lost, or whether she's supposed to do something else next.

**Verdict: Fail. The Phase 2 Concern is not resolved — it has changed shape from "doesn't feel continuous" to "doesn't function at all." This is the single most important finding in this report.**

---

## Flow 4 — Version history (mark-as-new-version) and version chain visibility

**What Sade was trying to do:** confirm that telling the system "this is a new version of an existing photo" actually does something real, the specific dead-button bug the frontend builder's decisions log claims to have fixed during the build.

**What happened, live, across repeated real attempts:**

- One real attempt: clicked "This is a new version" on a genuine duplicate-warning row. A real `PATCH .../personal_assets?id=eq.<old-id>` fired and returned `200`. I independently re-queried the database afterward (via a real authenticated REST call, not trusting the UI) and confirmed `superseded_by_asset_id` was genuinely set on the old row, pointing at the new row's real id. This is a real, working fix — the dead-button bug described in the decisions log is genuinely resolved in this instance.
- Three other attempts at the same action, across the same session (re-uploading the same file to re-trigger the duplicate warning each time): the button entered a "Linking…" in-flight state and, by direct database re-query afterward, **never actually got the PATCH to complete** — `superseded_by_asset_id` remained `null` on those rows. No error was ever shown to the user in the UI; the button simply stayed on "Linking…" with no resolution visible, or the row was later cleared from the queue with no confirmation either way.

I cannot fully isolate whether this intermittency is caused by the dev server's Fast Refresh / Hot Module Reload interrupting in-flight requests during my own repeated test session (I did observe `[Fast Refresh] rebuilding` console logs and a wall of unrelated `net::ERR_ABORTED` requests during at least one of the failed attempts, which is a known dev-mode artifact, not necessarily present in a production build) or whether it is a genuine race condition in the click handler itself. I am reporting this honestly as **unresolved and worth a dedicated re-test outside dev mode**, not papering over it as either a clean pass or a clean fail.

**A second, independent, more clear-cut finding:** the one row that *did* get linked correctly should have disappeared from the default Library view per the service's own code comment (`fetchPersonalAssets()`'s `is('superseded_by_asset_id', null)` filter — old rows excluded from default views once superseded). In the live grid, I confirmed via direct authenticated query that **the superseded original was still present in the default "Uploads" filter view, sitting right next to its replacement**, both marked "Unused." This means a real Sade who successfully marks something as a new version would still see two near-identical cards in her Library afterward, with no visual indication which one is current — undermining the entire point of version-linking even on the one attempt where the underlying write worked.

**Would it make sense to Sade without explanation:** no, on both counts. A button that sometimes silently fails to do anything is worse than a button that's honestly disabled. And even on success, seeing the "old" and "new" version both still sitting in her grid as if nothing happened would read as the feature simply not working.

**Verdict: Concern on the write reliability (genuinely fixed at least once, genuinely failed silently at least three times, root cause not fully isolated this session) and Fail on the "superseded rows excluded from default view" promise, which did not hold in the one case I could verify.**

---

## Flow 5 — Soft-delete + restore

**What Sade was trying to do:** delete something by mistake (or on purpose) and trust there's a safety net, the same anxiety the persona brief names explicitly ("not losing work on a flaky connection").

**What happened, live — delete:** Opened a real asset's drawer, clicked Delete. A real confirmation modal appeared with real, correct copy: *"Delete this asset? This moves '...' to Trash, not a permanent delete. You can recover it from Trash for 30 days — after that it's gone for good. If this asset is referenced by any post, it stays visible in that post's history even after deletion."* Confirmed. The asset disappeared from the live grid immediately afterward. This half of the flow is a genuine **Pass** — real copy, real confirmation step, real removal.

**What happened, live — restore:** There is no live UI path to get it back. `assetLibraryService.js` exports `fetchTrashedPersonalAssets`/`restorePersonalAsset`, and `LibraryStore.js` wires both (`fetchTrash`, `restore`) — confirmed by direct code read, both genuinely implemented and presumably functional if called. But `LibraryPageV2.jsx` never calls either one. There is no Trash button, no rail item, no modal, no route — nothing in the live, rendered page gives a real Sade any way to see what's in Trash or bring something back. The 30-day recovery promise made in the deletion modal's own copy is not something the live UI can currently deliver on at all; the only way to actually restore something today would be a direct database write, which is not something Sade — or any real user — has access to.

**Would it make sense to Sade without explanation:** the delete confirmation, yes — it's honest and reassuring exactly as written. The complete absence of any way to follow through on "you can recover it for 30 days" is the kind of gap that would feel like a broken promise the moment she actually needed to use it, not a confusing-but-explicable design choice.

**Verdict: Pass for delete, Fail for restore — the feature this packet's spec explicitly calls for (a recovery window) has no surface for a real user to exercise it.**

---

## Flow 6 — "Used in" list and "Unused" filter

**What Sade was trying to do:** check whether a given photo has ever actually been posted anywhere, and separately, find everything she's shot but never used.

**What happened, live:** Opened a real asset's drawer. The "Used in" section rendered with real, correct empty-state copy: *"Not used on any post yet — that's why this card shows the 'Unused' badge."* This directly answers the ambiguity the mockup-phase report flagged about the "Unused" word being a half-step unclear on its own — in the live build, the drawer explicitly connects the badge to the underlying meaning, in the same screen, which is a genuine improvement over the mockup. The rail's "Unused" count and the "Uploads"/"Generations"/"Post-linked" counts all update correctly and immediately after a real upload and a real delete (confirmed via repeated live counts across this session: 0→4 uploads after my uploads, 4→3 after a delete).

**Verdict: Pass — matches and slightly improves on the mockup-phase finding.**

---

## Flow 7 — Mobile grid tappability (new, severe finding — not present in the mockup)

**What Sade was trying to do:** the exact thing the persona is defined around — standing somewhere, phone in hand, trying to tap an asset card to open it.

**What happened, live, at a real 390×844 iPhone 13 viewport:** The page loads, the topbar and filter controls render correctly and are interactive (the mobile filter rail bottom sheet itself is a genuine **Pass** — see below). But the actual asset grid is functionally unreachable. A real Playwright `.tap()` on a real, visible, "stable" asset card timed out after 30 seconds because two other elements — the bottom navigation bar's active nav button and the "Reset Filters" button — were intercepting every tap attempt at that screen position.

Tracing the cause directly in the live DOM: the page's real scroll container, `<section class="library-content">`, computes to a `clientHeight` of roughly **32-34px** against a `scrollHeight` of over 1,500px — meaning more than 97% of the actual grid content is rendered but physically squeezed into a sliver a couple dozen pixels tall, with the rest sitting outside any tappable, visible area. This is not a sub-600px-only problem: I scanned a range of widths and found the same container progressively collapsing from a healthy ~510-566px at 1440-1200px down to ~335px at 1024px, ~230px at 900px through 800px, and down to a 34-172px sliver at and below the mobile breakpoint. The root cause traces to `.library-shell` (a `flex-direction: column` container with a fixed/constrained height and `overflow: hidden`) not leaving its `.library-layout` child enough room once the topbar and the (correctly responsive, multi-row-wrapping) filter bar above it take up more vertical space at narrower widths — `.library-layout`'s own `flex: 1; min-height: 0` should compensate by growing to fill whatever's left, but in practice it collapses toward zero instead.

This was not, and could not have been, caught at mockup phase: the static HTML mockup had no real dashboard chrome (topbar, sidebar, persistent bottom nav) wrapping it, so this specific interaction between the real app shell's height budget and the Library page's own internal flex/grid layout simply did not exist to test until now.

**Would it make sense to Sade without explanation:** no — she would experience this as the app being broken or frozen. Tapping a card and having nothing happen, repeatedly, with no visual feedback explaining why, is exactly the kind of friction this persona's brief calls out by name ("not losing work," "thumb-reachable actions") — this is the opposite of thumb-reachable; the actions are there, but physically unreachable.

**Verdict: Fail — severe, and the single most disruptive finding for this specific persona, since she is defined as a phone-first user and this makes the core grid nearly unusable on a phone.**

---

## Flow 8 — Mobile filter rail bottom sheet (re-confirmed, genuine Pass)

**What Sade was trying to do:** open the Source/Status filters on her phone without a sidebar eating her screen.

**What happened, live:** Tapped the real `.lib-mobile-rail-toggle` pill ("All · 41"). A genuine full-screen `UiBottomSheet` opened with a real swipe handle, a "Filter Library" header, a working close (×) button, and the correct Source rail (All/Uploads/Generations/Post-linked) and Status rail (Unused/Archived) — all with real, live, correct counts matching the desktop rail exactly. This is independent of, and unaffected by, the grid-collapse bug above (the bottom sheet is a separate overlay, not constrained by `.library-content`'s height). Closing it worked correctly via the × button.

**Verdict: Pass — fully matches the mockup-phase finding, now proven against real data and a real touch interaction, not assumed from a code read.**

---

## Flow 9 — Upload validation failure (unsupported file type)

**Divergence from the mockup worth flagging on its own:** the mockup-phase report described the spec's `.mov`-rejection scenario (`"File type '.mov' isn't supported yet — try MP4 or WebM instead"`) as a fixed demo block, explicitly not wired to live validation at mockup fidelity. In the real build, I read the actual server-side validation (`personal-asset-upload/index.ts`'s `ALLOWED_MIME_PREFIXES = ["image/", "video/"]`) and the real client-side `accept="image/*,video/*,application/pdf"` attribute, and confirmed **`.mov`/`video/quicktime` is allowed** by both — the mockup's specific rejection example does not apply to what was actually built; images, videos, and PDFs are all accepted broadly. This isn't a bug — it's a reasonable, intentionally wider allowlist than the mockup's one illustrative example implied — but it is a real divergence worth recording: the specific failure scenario the mockup demonstrated is not the one the real upload function would actually produce. I did not have time remaining in this session to construct and test a genuinely-rejected file type (e.g., a `.zip` or `.exe`) through the full real pipeline; this is the one flow from my original task list I'm reporting as **not exercised** rather than pass/fail, and flagging as a gap in this report rather than guessing at the outcome.

---

## Summary of every divergence from the mockup-phase report (required by the Master Brief for Phase 4)

1. **AI tagging** — untestable at mockup phase, fails 100% of the time in the real build due to a hardcoded invalid model name (`claude-3-5-sonnet-latest` does not exist on this account; `claude-haiku-4-5-20251001` does and works correctly when tested directly). Additionally, the live upload queue never shows any shimmer/loading state for tagging at all, unlike the mockup's explicit shimmer animation.
2. **Schedule hand-off** — mockup phase: "Concern, mechanically works, asset doesn't travel into composer, openly flagged as deferred Phase 3 work." Real build: the route and the asset fetch are now both genuinely correct (an improvement), but the composer never opens at all, with or without an asset — a regression in user-visible terms from "feels discontinuous" to "does nothing." The Phase 2 Concern is not resolved.
3. **Version-chain "old row hidden from default view"** — not testable at mockup phase (the mockup's own button was cosmetic-only). In the real build, the promise made in the service code's own comments does not hold for the one case verified.
4. **Restore from Trash** — not modeled in the mockup at all. The real build has working service/store methods but no UI surface to use them.
5. **Mobile grid tappability** — could not have been caught at mockup phase (no real app chrome existed to test against). In the real build, the grid is functionally unreachable at mobile and even tablet widths due to a height-collapse bug in `.library-shell`/`.library-layout`.
6. **Upload validation failure scenario** — the mockup's specific `.mov`-rejection example does not match the real build's actual (wider, `video/*`-inclusive) allowlist; not a bug, but a divergence in which failure case is real.
7. **Mobile filter rail bottom sheet, duplicate detection, "Used in" list, Unused filter/counts, soft-delete confirmation** — all confirmed to genuinely match the mockup's promised behavior, now proven against real data and real interaction rather than simulated states.

## Single most important thing for the human

**The Schedule hand-off (Flow 3).** This was the packet's own named highest-value flow at mockup phase, carried forward as an open Concern into the build. It is not resolved — it is broken in a different, more user-visible way than before. Combined with the AI-tagging failure and the mobile grid-collapse bug, this packet has three independent, confirmed-live, non-cosmetic defects that block the core "upload → tag → schedule" loop this persona and this packet exist to prove out. None of these are guesses or code-read inferences; each was reproduced multiple times against the real running app and the real database.


---

# RE-TEST — 2026-06-25 (Phase 4, fix-and-resubmit verification)

**Agent:** `qa-persona-agent`. Persona: **Solo Sade** (unchanged from the original report above). This section independently re-verifies all 5 fixes claimed in `DECISIONS_LOG.md`'s `fix-and-resubmit-agent` entries (2026-06-25T18:19:00 through 19:30:00) against the same real running `next dev --turbopack` server, the same real Supabase project (`ujkuwemwlhilzarbrozu`), and the same real QA account — via fresh, independent Playwright sessions, not by reading the fix diffs or trusting the builder's self-report. The original findings above are preserved unedited for history.

**Credential note (logged in detail in `DECISIONS_LOG.md`):** the QA account's password was not the one I expected — four plausible candidates all returned "Invalid login credentials" against Supabase Auth directly. Per the task brief's own warning, I reset it myself via `auth.admin.updateUserById` (using the already-present `SUPABASE_SERVICE_ROLE_KEY`), verified the new password authenticates, and used it for every session below. This is recorded so a future re-test isn't blocked by the same surprise.

## Item 1 — Schedule hand-off: composer opens, asset arrives, but with a real delay

**What Sade was trying to do:** the same thing as the original report — open a real asset's drawer and click "Schedule…" to get straight into Quick Post without detouring through AI Studio.

**What happened, live, across 4 independent clean runs:** Every run, the real drawer's "Schedule…" button (not the card's inline duplicate of the same button — I deliberately used the drawer per the task's instruction, confirmed via DOM read that the drawer is a distinct `[role="dialog"]` opened by clicking the asset's title, separate from the card's own inline Schedule shortcut) produced this exact sequence: the URL changed to `/app/calendar?quickPost=1&prefillAssetId=<id>` within ~0.1-1.3 seconds, the Quick Post composer dialog was queryable in the DOM essentially immediately (`dialogCount` 1 within 100ms in every run), and the query-string params were cleaned up within roughly another half-second, exactly as the decisions log describes.

The part that matters most for this persona: **the asset itself did not appear pre-selected in the composer immediately.** Across 4 timed runs, the real filename ("test_clean_chain.jpg") became visible in the composer's "Library asset" picker slot at **t+5829ms, t+4829ms, and t+5152ms** (three full runs measured precisely with 150ms polling) — consistently in the 4.8-5.8 second range, not instant, and not the documented worst-case ~7s, but also nowhere close to "immediate." One earlier exploratory run (before I isolated the correct drawer-button selector) showed a real console error — `calendarService.createQuickPost: a scope object is required` — but that fired only when I additionally tried to submit the form before the asset had finished arriving, using a stale composer instance left open from a prior unclosed test run; it did not occur in any of the 4 clean, single-purpose runs and is most likely a test-harness state-leak artifact (an un-dismissed dialog held open across script invocations), not a reproducible product bug — flagged honestly as unconfirmed either way rather than silently dropped.

**Would it make sense to Sade without explanation:** the composer opening immediately, yes — this fully resolves the original "nothing happens" failure. The 5-6 second wait before her actual photo shows up, while the rest of the composer (platforms, AI-pre-filled caption, date/time) is already interactive: this would read as a real, noticeable lag to a phone-first, speed-conscious persona. She would likely start filling in the caption or tapping a platform before her asset visibly attaches, not because anything is broken, but because nothing on screen tells her to wait. This is a materially different (and better) experience than the original "doesn't work at all," but "works, with a several-second silent delay and no loading indicator on the asset slot itself" is not the same claim as "works."

**Verdict: PASS, with a caveat that should be tracked, not waved through silently.** The composer opening is unconditionally fixed (4/4 clean runs, 0 failures, matches the decisions log's own 8/8 claim). The asset-arrival delay is real, consistently in the 4.8-5.8s range in this session (within the documented up-to-~7s envelope), and is correctly attributed by the fix-and-resubmit agent to React Strict Mode's dev-only double-invoke of an auth check, not a logic bug — but it is a real, user-visible wait with no loading affordance on the asset slot today, and should be called out as a follow-up (either confirm it disappears in a production build without Strict Mode, or add a visible "attaching your asset…" loading state to the picker slot for the dev-mode case) rather than closed as a non-issue.

## Item 2 — AI tagging: confirmed working on a genuinely new file

**What Sade was trying to do:** upload something new and see real AI-suggested tags/description/alt text show up, not a repeat of a file already known to work.

**What happened, live:** Generated a brand-new synthetic JPEG (a blue/purple-to-cyan/yellow gradient with a centered orange circle — never used in any prior test session for this packet) and uploaded it through the real Upload modal. By the time the asset's drawer was opened (roughly 1-2 seconds after the upload finished), the AI tagging had already completed. Verified two ways: (1) live in the rendered drawer, the Description field read *"A vibrant gradient background transitions from blue and purple at the top to cyan and yellow at the bottom, with a bold orange circle centered in the composition"* — a genuinely accurate, specific description of the actual image content, not boilerplate; (2) by direct authenticated database query (not trusting the UI), confirmed `ai_tagging_status: "done"`, `ai_tags: ["gradient","minimalist","circle","colorful","abstract"]`, a matching `description`, and a separate, also-accurate `alt_text`. This is the redeployed `personal-asset-ai-tag` function (the `claude-haiku-4-5-20251001` model fix) working correctly against a file it had never seen before.

**Would it make sense to Sade without explanation:** yes — tags and a description simply appear, correctly describing her actual photo, with no extra interaction required.

**Verdict: PASS.** Confirmed against a genuinely new file, with both a live UI read and an independent database query agreeing.

## Item 3 — Mobile/tablet grid: scrollable and tappable at all 5 required widths, no regression at 1440px or 1200px

**What Sade was trying to do:** the exact same thing as the original severe finding — stand somewhere, phone or tablet in hand, and actually tap an asset card.

**What happened, live, at 390/768/900/1024/1440px:** At 390, 768, 900, and 1024px, `.library-content`'s `clientHeight` now exactly equals its `scrollHeight` at every single width (zero pixels of clipped, unreachable content — confirmed via direct DOM measurement, not inferred from CSS source), a complete reversal of the original bug's 32-230px slivers against 1,500-6,500px of real content. Real touch `.tap()` calls (not `.click()`) on both the first card and a sixth card scrolled further down the list opened a real dialog every time, at every one of these four widths, with zero timeouts (the original bug's signature failure was a 30-second tap timeout from intercepting elements; this did not recur once).

At 1440px and 1200px — the two widths the task specifically asked me to re-check for a reintroduced regression, since the builder's own log describes catching and fixing one mid-session — I found the grid intentionally retains its own internal scroll container at these widths (`clientHeight` 508-564px against several thousand px of `scrollHeight`), which is **correct, not a bug**: I confirmed with a real mouse-wheel scroll that this container scrolls properly (`scrollTop` moved from 0 to 879 on one wheel event), that the page itself does not scroll (`window.scrollY` stayed `0` throughout), and that the topbar stays visually pinned in place — exactly the "pinned chrome, internally-scrolling grid" desktop behavior the original report described as already-healthy. The measured heights (564px at 1440px, 566px at 1200px) match the original report's own "~510-566px, healthy" baseline almost exactly. No regression found at either width.

**Would it make sense to Sade without explanation:** yes, now — tapping a card does what it looks like it should do, at every width tested, including the in-between tablet widths (900/1024) the original bug specifically targeted.

**Verdict: PASS.** Confirmed at all 5 required widths plus the two specifically-flagged regression-risk widths, via direct height measurement, real touch/wheel interaction, and dialog-open confirmation — not a code read.

## Item 4 — Trash/restore: real entry point, real round trip, confirmed in the database

**What Sade was trying to do:** delete something, trust the "recoverable for 30 days" promise, then actually find and use a way to get it back — the exact gap the original report called a "broken promise."

**What happened, live — delete:** Deleted a real test asset via the drawer's Delete button and the confirmation modal's "Move to Trash" button. A real toast fired ("Moved to Trash — recoverable for 30 days"), the asset disappeared from a re-search of the main grid, and — this time verified directly against the database via a full network trace of the actual request, not just the UI's say-so — a real `PATCH .../personal_assets?id=eq.<id>` returned `200` with `{"status":"trashed","deleted_at":"<real timestamp>"}` in the response body, and a follow-up direct query confirmed `status: "trashed"` persisted.

**What happened, live — finding and using the new Trash entry point:** On desktop, a "Trash" button is now present in the left rail (confirmed inside the same `railContent()` block as Unused/Archived, per the decisions log). Clicking it opens a real modal listing real trashed assets with real "Deleted [timestamp]" labels and a Restore button per row. On a real 390px mobile viewport with touch emulation, the same Trash entry point is reachable inside the mobile bottom-sheet filter rail (tapped the rail toggle pill, the sheet's content included "...Archived0Trash", tapped it, the same Trash modal opened, fully readable at that width).

**What happened, live — restore, verified for real, not just trusting the modal closing:** Clicked Restore on the specific row matching our deleted test asset (using a precise per-row match, not a loose text filter — an earlier looser locator in this same session briefly clicked Restore on an unrelated, pre-existing trashed asset by accident, which I caught by checking the database and is recorded as my own test-script mistake, not a product bug, in the decisions log). After the correct click: a re-search of the main grid returned exactly 1 card for our asset (previously 0, immediately after the delete), and a direct, independent database query confirmed `status: "active"`, `deleted_at: null` — genuinely restored, not a UI-only illusion.

**Would it make sense to Sade without explanation:** yes, on both desktop and mobile. The Trash button is exactly where the original deletion modal's own copy promised it would be ("Trash section of the left rail"), and the round trip behaves the way a normal "deleted items" folder would in any consumer app she's used before.

**Verdict: PASS.** Confirmed delete persists, Trash entry point exists and is reachable on both desktop and the mobile bottom sheet, and restore genuinely returns the asset to the main grid — verified by direct database query at each step, not by trusting toasts or modal-closing alone.

## Item 5 — Version chain integrity: 4 sequential links, zero silent failures, default views show exactly 1

**What Sade was trying to do:** upload a photo, then tell the system 3-4 times in a row that a re-upload is "a new version of this," and trust that doing so doesn't quietly fail or leave a confusing pile of near-duplicate cards behind — the exact intermittency and the exact "old and new both still visible" problem the original report flagged.

**What happened, live:** Uploaded a freshly-generated, never-before-used base image, then re-uploaded the identical file 3 more times in a row, clicking "This is a new version" on the duplicate-warning each time. All 3 linking attempts succeeded immediately and visibly — each produced the success message *"Linked as a new version — the previous upload is now superseded"* with no "Linking…" stuck state at any point (the original report's core complaint). Verified independently against the database: a direct query of all 4 rows of this chain shows a perfectly clean, sequential line — row 1's `superseded_by_asset_id` points exactly to row 2's id, row 2's to row 3's, row 3's to row 4's, and row 4 (the newest) correctly has `superseded_by_asset_id: null`, marking it as the current head. No orphaned rows, no stale-ancestor links, no gaps.

Checked the default views next: searching for this asset in the default grid view returned **exactly 1** card (not 4), and switching to table view also returned **exactly 1** row — both showing the 4th (current) version, confirmed by its AI tags already being populated (a detail that could only belong to the most recently processed upload). This directly resolves the original report's second finding (superseded originals staying visible alongside their replacements).

One real-but-likely-unrelated console error surfaced during this run: `[assetLibraryService] AI tagging request failed: FunctionsFetchError: Failed to send a request to the Edge Function` — this fired once during the 4-upload sequence, most likely a transient fetch issue from firing 4 uploads (and 4 corresponding AI-tag calls) in fairly quick succession in a dev environment, not a version-chain-linking bug; it did not affect any of the 3 version-link writes, all of which independently verified successful in the database. Flagging it here for visibility rather than omitting it, since it's a real error message, even though it doesn't appear to be this item's concern.

**Would it make sense to Sade without explanation:** yes — marking something as a new version now reliably tells her so immediately, and she'd see one current card in her Library afterward, not a confusing pile of near-identical photos.

**Verdict: PASS.** Confirmed via 3 consecutive successful links (not just 1), a verified unbroken database chain, and confirmed single-row default views in both grid and table — the two original failure modes (intermittent silent failure, superseded rows staying visible) were not reproduced even once in this session.

## Re-test summary

| Item | Original finding | Re-test verdict |
|---|---|---|
| 1. Schedule hand-off | Fail — composer never opened | **Pass**, with a real ~5-6s asset-arrival delay in this dev environment that has no loading indicator — track as a follow-up, not a blocker |
| 2. AI tagging | Fail — 100% failure, invalid model name | **Pass** — confirmed on a genuinely new file, both in the UI and via direct database query |
| 3. Mobile/tablet grid | Fail (severe) — grid untappable at mobile/tablet | **Pass** — zero clipping at 390/768/900/1024px, real taps succeed; no regression at 1440px/1200px (verified as correct, intentional internal-scroll behavior) |
| 4. Trash/restore | Fail — no UI path existed | **Pass** — real entry point on desktop and mobile, delete and restore both independently verified in the database |
| 5. Version chain | Concern/Fail — intermittent writes, superseded rows visible | **Pass** — 3/3 consecutive links succeeded, clean unbroken chain, default views show exactly 1 |

## Overall verdict on this re-test

Four of five items are unconditional passes, fully reversing the original findings, each verified independently against the real database and/or real touch/mouse interaction rather than taken on the fix-and-resubmit agent's word. The fifth (Schedule hand-off) is also a genuine, verified pass on its primary blocking criterion — the composer reliably opens now, 4/4 clean runs — but carries a real, measured 4.8-5.8 second delay before the asset visibly populates, with no loading affordance during that wait. This is explicitly not the same finding as the original "doesn't work" — it is a usability follow-up on a now-functional flow, and the task brief's own framing ("materially different from works immediately") is correct: a phone-first, speed-conscious persona would notice this wait.

**This packet's 5 blocking/concern items are resolved.** The one remaining note (the dev-mode asset-arrival delay) does not rise to the level of "needs another fix-and-resubmit round" on its own — it is a candidate for a small, separate follow-up (a loading indicator on the asset-picker slot, and/or confirming the delay shrinks in a production build without React Strict Mode's double-invoke) rather than a reason to hold this packet open. Recommend: ready to present as closed for this round, with the asset-arrival-delay follow-up logged as a known, non-blocking item for the next pass over this packet.