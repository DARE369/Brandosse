# Functional Specification — Personal Dashboard, Generate/Studio, Calendar & Library

**Companion document.** The root-level `FUNCTIONAL-SPEC.md` documents this product's account/identity screens, the full organization workspace, organization administration, and the platform admin console — and explicitly excludes the personal Dashboard, the Generate/Studio content-creation workspace, the personal Calendar, and the personal Library, noting those would be "handled separately." This document is that separate handling. It also picks up two personal-workspace pages the root document doesn't reach either: Video Lab and the Credits/Billing page, both of which are reachable only from this cluster of screens.

**Purpose:** a complete, implementation-free description of what these screens do, for a design team rebuilding the interface from scratch. It describes jobs, data, actions, and states — never colors, fonts, spacing, component libraries, or current layouts. Nothing here should be read as a design instruction; everything here should be read as a product fact.

**Ground truth note:** this reflects shipped, current behavior as of this writing, not aspirational documentation. Where the interface implies something that isn't actually true underneath (a label, a promise, a control that does nothing), that's called out explicitly rather than smoothed over — a redesign needs to know which parts of the current experience it can trust as a spec and which parts it should treat as a warning.

---

## 1. Product Overview

This cluster of screens is the working core of the personal (single-person) side of a content-operations product: a hub, a content-creation workspace, a place to keep reusable media, and a place to see what's scheduled or already sent. The people who use it are solo creators and small-business owners producing social content for themselves, without a team around them.

**The job they hire this part of the product for:** turn an idea into a scheduled or published post, without switching tools, and always be able to answer three questions at a glance — *what's already out, what's coming up next, and what needs my attention right now.*

**What a successful session looks like:** the person opens the app, immediately understands their current state (nothing hidden, nothing surprising), does one of three things — generates something new, manages something already scheduled, or organizes existing media — and leaves confident the system did what they asked. For a person planning a week of content, success might mean generating and scheduling five posts in one sitting without re-explaining their brand each time. For a person checking in on a single failed post, success is finding out *why* it failed and fixing it in under a minute.

**This is professional, focused-work tooling.** The person using it is often mid-task, sometimes on a phone between other things, and is trusting the system with something that will become public (or is already public). Precision and speed matter more than delight; a miscount on a stat card, a silently-dropped upload, or an ambiguous "delete" is a real cost, not a rough edge.

**A standing fact that shapes every screen here:** actual publishing to social networks is simulated in the current build, not live — this is a deliberate, permanent-for-now product decision (documented in full in the companion document's Section 10). Every screen below that touches "publish," "connected account," or "scheduled post" inherits this fact, and the interface is currently explicit about it in several places (worth preserving, in some form, in the redesign) and silent about it in others (worth deciding).

---

## 2. Roles & Permissions (scoped to this document)

Within this cluster of screens there is exactly one role: the signed-in individual account owner. There is no reviewer, no approver, no shared ownership — everything a person creates, schedules, or stores here belongs to them alone and can be acted on by them alone. (The full role table, including how a Solo Creator's role interacts with an organization role if they also belong to one, lives in the companion document's Section 2.)

**Permission-denied states that do exist within this cluster:**
- Every screen requires a signed-in session; there is no guest or partial view of any of it.
- Video Lab's job-detail screen performs a record-level ownership check and shows a plain "not found" rather than another person's data if an ID is guessed or reused.
- There is no concept of "view-only" or a second person with reduced access anywhere in this cluster — that concept only exists once an organization is involved, which is out of scope here.

---

## 3. Screen Inventory

### 3.1 Personal Dashboard

**Job:** a single-glance command center — orient the person on what already happened, what's coming next, and give one-click paths into creating or managing content.

**Shown, ranked by importance:**
1. A greeting and the current date (computed), plus the primary "New generation" action.
2. First-time only: a three-step onboarding checklist (create an account — already done; connect a social account; generate a first post), with a completed-count badge. Shown only when the person has zero generations and zero connected accounts; every subsequent visit skips straight to the regular view.
3. Four headline numbers: posts published, scheduled, "clips ready" (completed video clips), and drafts — each with a trend arrow comparing the last 30 days to the 30 days before that (a flat trend is shown as "steady" rather than a fabricated 0%), and a short supporting line under each.
4. The next scheduled post: a thumbnail/type marker, its title or caption, its destination platform, and a live countdown to its send time — labeled as a simulated publish.
5. A content-flow funnel: drafted → scheduled → published → failed, each a count with a proportional bar.
6. Recent generations: the five most recent, each showing a thumbnail, a title, a relative date, and a status; a live search box filters this list (against a larger recent window, not the person's full history — see Constraints).
7. Credit balance: current balance, "of X purchased" (or "free credits" if nothing has been purchased yet), a percentage bar, a breakdown of recent spend by content category (image / video / carousel / edit / other, plus older unlabeled spend grouped as "uncategorized"), and lifetime amount spent.
8. Connected accounts: platform, display name, handle, and a plain-language health status (Healthy / Reconnect / Reconnecting / Needs attention / Disconnected) per account — labeled as simulated connections.

**Actions:** start a new generation (primary; also reachable with a single keyboard shortcut); search recent generations (primary; a second keyboard shortcut focuses it, Escape clears it); open a specific recent generation to resume it (primary); complete an onboarding step — connect an account or generate a first post (primary, first-time only); open the next scheduled post or jump straight to the calendar (secondary); jump to the full analytics report (secondary); view billing (secondary); manage connected accounts (secondary); retry a section that failed to load (secondary); switch light/dark appearance, open account settings, open the profile shortcut (all secondary, always available).

**States:** loading (each section resolves independently rather than the whole page waiting on the slowest query); a per-section error with its own retry control — one section failing does not take down the others, and a single failed count silently shows as zero rather than surfacing an error; three distinct empty conditions — nothing scheduled yet, no generations yet vs. no generations matching the current search, and no accounts connected — each with its own explanation and a way to fix it; the first-time onboarding state described above, which is distinct from the ordinary "no generations yet" empty state; no offline-specific state.

**Entry points:** the default landing screen after signing in, for anyone not routed elsewhere by an organization role (see the companion document for the exact redirect logic); the main navigation.
**Exit points:** Generate/Studio (new generation, resume a past one, or the "generate a first post" onboarding step); account settings (the "connect an account" onboarding step, a header shortcut, and "manage accounts"); Calendar (reviewing the next post, "open calendar," and the empty-state "schedule a post" action); Billing (credit balance's "view billing"); full Analytics (the content-flow panel's "full report" link — a screen documented in the companion document); the profile shortcut.

**Constraints:** most of the page refreshes itself automatically — any change to generations, posts, connected accounts, or video clips (from any device or tab) triggers a short debounced refresh of the whole page (well under two seconds); the credit balance updates on its own separate, faster live channel; the search box only searches a rolling window of roughly the 120 most recent generations, not the person's entire history.

---

### 3.2 Generate / Studio — Brief & Generation

**Job:** collect what the person wants made, show what it will cost before committing, and produce it.

**Shown, ranked by importance:**
1. A content-type choice: image, carousel (multi-slide), text-to-video, image edit, or frames-to-video (image-to-video).
2. The brief itself: either a single free-form prompt (with a length limit) or a set of guided fields (subject, setting, style, mood) that combine into one; an AI "enhance this prompt" rewrite option that replaces the text in place; a source-image reference, required for the two edit/video-from-image modes.
3. Format controls relevant to the chosen mode: aspect ratio; how many variants to generate at once (image mode); how many slides (carousel mode, with an "auto" option); clip length and a Standard/Premium quality choice (video modes).
4. A "match my brand kit" toggle, on by default (brand kit itself is documented in the companion document).
5. Which connected platform(s) this is being made for (multi-select, drawn from the person's connected accounts).
6. A computed cost estimate in credits, shown before the person commits, and blocked outright with a specific shortfall message if they don't have enough.

**Actions:** generate (primary — disabled and explained if credits are insufficient); enhance/rewrite the prompt (secondary, reversible — it only replaces the draft text); switch content type, aspect ratio, batch/slide count, quality tier, or target platform(s) (secondary, all reversible before generating); save the current brief as a draft without generating (secondary); cancel a generation already in progress (secondary — an honest cancel: anything already far enough along still finishes and appears in the results, only not-yet-started work is stopped, and stopped work is never billed).

**States:** the brief itself (default); generating (a progress view with an honest time estimate — roughly 20 seconds for a single image, 2–4 minutes for video; multi-slide carousels generate one slide at a time with a "generating slide N of M" indicator, and a partially-completed carousel is kept rather than discarded if some slides fail); a specific, worded failure per problem (missing required input, insufficient credits, the generation provider returning nothing usable, a storage failure) rather than one generic error; a cancelled state with a plain explanation of what will and won't still appear.

**Entry points:** the main navigation ("Studio"); the dashboard's "new generation" action and onboarding step; resuming a session from Session History; being handed a starting point from Library (an existing asset as an edit source), from Calendar (repurposing or editing an existing post), or from a saved template.
**Exit points:** the results/publishing stage below (on success); Session History (to switch to a different past session); Billing (from the insufficient-credits message).

**Constraints:** costs are fixed and shown up front — one credit per image (so a batch of four costs four), one credit per carousel slide (a default six-slide carousel costs six), three credits for an image edit, five credits for a Standard-quality video, fifteen for Premium; a Standard-quality video request with no source image is automatically upgraded to Premium quality and billed accordingly, with the reason stated plainly rather than silently. Credits are reserved before the work starts and automatically refunded if the work fails.

---

### 3.3 Generate / Studio — Results, Editing & Publishing

**Job:** let the person review what was generated, pick and preview the best result, write the accompanying post copy, and either save it, schedule it, or send it.

**Shown, ranked by importance:**
1. The generated result(s) as a grid — one or more images, carousel slides, or a video — each openable full-size with next/previous navigation.
2. Per-post editable copy: a title, a caption, and hashtags (added/removed individually).
3. A computed "discovery readiness" score (0–100, across five dimensions — readability, hook strength, hashtag quality, brand consistency, platform fit) with a re-score/retry control; shows as unscored rather than a fabricated number if scoring hasn't run or failed.
4. A target account, chosen from the person's connected accounts.
5. Once sent: confirmation that the post was queued to the chosen account, explicitly labeled as a simulated publish.

**Actions:** select a result as the one to use (secondary, reversible); regenerate the whole set, or retry only the pieces that failed without re-billing the ones that already succeeded (secondary); regenerate just the caption/title (secondary, reversible); re-score discovery readiness (secondary, reversible); save as a draft (primary — fully editable later); schedule for a future time (primary — hands off to Calendar's scheduling); publish immediately (primary, explicitly confirmed as an immediate, simulated action the person is told cannot be undone from this screen, and disabled until a target account is chosen).

**States:** results grid (default); an empty/partial grid if some variants failed, clearly distinguished from ones that succeeded; a full-size preview overlay; editing copy; scoring in progress vs. scored vs. unscored; a publish confirmation step; a published confirmation; a sign-in/permission guard is not applicable here (already covered by the parent workspace).

**Entry points:** directly after a successful generation; reopening a past session from Session History; the full-size preview's "use for post" shortcut, which jumps straight here for a specific result.
**Exit points:** Calendar (after scheduling, or via "open calendar" from a scheduled confirmation); a simulated publish confirmation (terminal for this session); back to the brief (to generate something new); Session History.

**Constraints:** publishing here is immediate and explicitly framed as not reversible from this screen; saving as a draft has no such restriction and can be revisited and changed freely.

---

### 3.4 Generate / Studio — Session History

**Job:** let the person find, resume, or clean up past generation sessions, optionally organized into named projects (campaign-style folders).

**Shown, ranked by importance:** a list of past sessions, grouped by project (plus a default "General" grouping for sessions not filed into one); each session's title/status; the list of projects themselves, each with a name and a color marker for quick scanning.

**Actions:** resume a session (primary); start a new session, optionally inside a specific project (primary); rename a session or a project (secondary); create a new project — name plus a choice of eight color markers (secondary); reorder projects (secondary); delete a session — explicitly explained as permanent, removing its generations along with it (secondary, not reversible); delete a project — its sessions are moved back into the general grouping rather than deleted (secondary, effectively reversible, and worth noting this is a materially different kind of "delete" from the session-level one just above).

**States:** the drawer's default list view; empty (no sessions/projects yet); a session mid-rename or mid-creation.

**Entry points:** opened from within the Generate/Studio workspace at any time.
**Exit points:** the brief or results stage for the chosen session; back to a fresh brief for a brand-new session.

**Constraints:** none beyond the delete-permanence noted above.

---

### 3.5 Generate / Studio — Video Jobs

**Job:** track AI-generated video requests that render asynchronously in the background, separately from the faster image/carousel path, so the person can keep working while a video finishes.

**Shown:** a list of in-flight and recently finished video generation requests, each with a status; a request that failed is marked with an explicit note that its credits were already refunded.

**Actions:** none beyond viewing — a job cannot be cancelled or retried directly from this list; a failed job's refund note implies the person should simply submit again from the brief.

**States:** in progress; complete (result appears back in the results stage); failed (with the refund note).

**Entry points:** opened from within the Generate/Studio workspace whenever a video request is outstanding.
**Exit points:** the results stage, once a job completes.

**Constraints:** this list survives a page refresh or closed tab — jobs are tracked server-side, not just in the open browser session. This is a materially different feature from Video Lab (3.9–3.10 below), which is a separate video-clip-extraction tool with its own job list; the two should not be assumed to be the same thing even though both use the word "job."

---

### 3.6 Content Library

**Job:** one place to keep every piece of media the person has — uploaded, generated, or pulled from a post — so it can be found and reused later.

**Shown, ranked by importance:**
1. The asset grid/list itself: a thumbnail, title, media type (image/video/document), where it came from (uploaded / generated / from a post), and whether it's currently used on any post (an "unused" flag, or "in use ×N").
2. Filter and search controls: by keyword, by tag, by media type, and an "unused only" view.
3. Per-asset technical detail available on demand rather than up front: file size, dimensions or duration, format.

**Actions:** upload one or more files at once, each validated and uploaded independently so one bad file doesn't block the rest (primary); open an asset's detail (primary); edit an asset's title, description, alt text, or tags (secondary, reversible); delete an asset — moves it to Trash, not an immediate hard delete (secondary, confirmed, reversible via Trash); archive an asset (secondary, reversible); duplicate an asset, or mark a freshly uploaded file as a new version of an existing one (secondary); select multiple assets to archive or delete together (secondary — currently no separate confirmation step for the bulk version of an action that does ask for confirmation one at a time); hand an asset off to Calendar to schedule directly (secondary).

**States:** loading (placeholder grid); genuinely empty ("nothing here yet," with an upload prompt); empty because of an active filter/search (a different message, with a path to clear filters rather than upload); a normal populated grid; an individual upload item failing without blocking the others in the same batch.

**Entry points:** the main navigation; "use this asset" hand-offs from Generate/Studio; the dashboard is not a direct entry point today.
**Exit points:** an asset's detail view; Calendar (scheduling hand-off); Generate/Studio (using an asset as a generation source).

**Constraints:** uploads are capped at 50MB per file and limited to image, video, or PDF file types, enforced by the server (not just a client-side hint); the entire active library loads at once with no pagination or infinite scroll today — this will not hold up well once a person's library grows into the thousands of items; duplicate detection exists for exact re-uploads and near-identical images, surfaced as the "mark as a new version" option rather than silently creating a duplicate.

---

### 3.7 Content Library — Asset Detail & Trash

**Job:** inspect a single asset in full, see its history, and recover anything recently deleted.

**Shown, ranked by importance (detail drawer):** a full preview; editable title, description, alt text, and tags; which posts (if any) currently use this asset, or an explicit "not used on any post yet" note; version history, if this asset has ever superseded or been superseded by another upload.

**Shown (Trash view):** every asset currently in a deleted state, each restorable individually; the interface states deleted items are kept for 30 days before being gone for good.

**Actions:** edit metadata (reversible); duplicate (reversible — creates a new, independent copy); restore from Trash (reversible); everything else available from the main grid is also reachable here.

**States:** normal detail view; an asset with no usage history; an asset with version history to show; Trash empty ("nothing deleted recently"); Trash populated.

**Entry points:** opening any asset from the main grid; a "Trash" view/filter within the Library.
**Exit points:** back to the main grid.

**Constraints — worth flagging directly:** although the interface tells the person deleted assets are recoverable for 30 days and then permanently removed, nothing in the current system actually enforces that removal — a deleted asset stays recoverable indefinitely until someone restores it. There is also currently no "delete forever" action anywhere for an asset already in Trash. Either the stated 30-day promise or the actual behavior needs to change so the two agree; a redesign should not assume automatic permanent deletion is really happening today.

---

### 3.8 Calendar

**Job:** show what's scheduled, published, or failed, and let the person move, edit, or remove any of it.

**Shown, ranked by importance:**
1. A month view and a list/agenda view of the same underlying posts (the list view is the default on a small screen); a separate "drafts" rail alongside the calendar itself for content that hasn't been scheduled yet.
2. Per-post: destination platform (or a stacked marker if the same generated content is scheduled to more than one platform at once), scheduled date/time, current status, a caption preview, and a thumbnail.
3. On a failed post: the specific reason it failed.

**Actions:** reschedule — by dragging a post to a new date, by tapping to select and then tapping a destination, or through a full edit view (three equivalent paths to the same result); edit a post's caption, hashtags, or destination account (secondary); delete a post — explicitly confirmed as not undoable (secondary, destructive); unschedule a post back to a draft — non-destructive, blocked once a post is in a state that can no longer be pulled back (secondary); duplicate a post into a fresh draft — blocked if an identical draft already exists for the same content and account, with an explanatory message rather than a silent failure (secondary).

**States:** loading; a genuinely empty month, with both a "quick post" shortcut and a pointer into Generate/Studio for anyone who wants richer tools; a list view with no results matching the current filters (a different message from the truly-empty case); a fetch error with a retry; a real-time conflict — if the same slot for the same account gets claimed by another action while the person is looking at it, their move is not silently applied; instead they're told the card refreshed to the latest version.

**Entry points:** the main navigation; the dashboard's "review post" / "open calendar" / "schedule a post" actions; a scheduling hand-off from Generate/Studio or the Library.
**Exit points:** the post detail/scheduling surface below; Generate/Studio (editing or repurposing a post's content).

**Constraints:** the drafts rail shows at most the 50 most recent drafts; the month grid itself has no fixed row cap but is always scoped to the visible month; a background process sends out due scheduled posts in batches of up to 50 at a time, so a very large backlog of simultaneous due posts could take more than one pass to fully clear. As with the rest of this product, sending a post through here is a simulated publish, not a live one — the interface currently marks a "published" post with a visible note that it went out through a simulated connection rather than a live platform API, which is worth preserving in some form so the redesign doesn't accidentally make a simulated send look identical to a real one.

---

### 3.9 Calendar — Post Detail & Scheduling

**Job:** the focused view of one post — full detail, edit, and every scheduling action in one place.

**Shown, ranked by importance:** full caption and hashtags; destination account and platform; scheduled date/time (editable); current status; on a failure, the failure reason in full, with a note that the person can retry by rescheduling or editing rather than a dedicated "retry" button; on a same-slot conflict, an explicit warning with the option to schedule anyway rather than silently overwrite anything.

**Actions:** edit any editable field (secondary, reversible until scheduled/sent); change the scheduled time (primary — this is also how a failed post gets "retried," since there is no separate retry action); delete (secondary, confirmed, not reversible); duplicate into a new draft (secondary); the same publish/schedule actions described in 3.3 above, when reached from here instead of from Generate/Studio.

**States:** normal editable detail; a locked state for posts that already published, where rescheduling is disabled with an explanation rather than allowed to silently fail; a failure state with the reason shown; a conflict-warning state.

**Entry points:** opening any post from the calendar grid, list, or drafts rail.
**Exit points:** back to the calendar.

**Constraints:** a real-publish attempt (as opposed to the simulated path) retries automatically up to three times before being marked failed for good; there is no user-facing manual "publish now" or "retry" button anywhere in this screen today — both are accomplished indirectly through rescheduling, which is worth flagging as a possible source of confusion (see Section 5).

---

### 3.10 Video Lab — Submit & Job Queue

**Job:** a separate tool from Generate/Studio: turn a long external video (a YouTube or Twitter/X link) into several short, AI-selected clips.

**Shown, ranked by importance:** a submission form (paste a source link; optional preferences for aspect ratio, caption style, target clip count, and clip-length range); a list of past and in-progress jobs, each with a source title, submission date, clip count once known, source duration, and a live status.

**Actions:** submit a new source link (primary — blocked below a minimum credit balance, with a direct link to buy more); open a job's detail (primary); delete a job, with a two-step confirmation (secondary, not reversible); retry a failed job — pre-fills the same source link into a fresh submission rather than truly resubmitting the same job (secondary).

**States:** loading; empty (no jobs yet); a link that isn't from a supported platform, rejected with a specific message rather than a silent failure; insufficient credits to submit; a background-worker-offline notice (jobs still queue, they just don't start immediately); a general "failed to load your jobs" error.

**Entry points:** the main navigation ("Video Lab," currently marked as a beta feature).
**Exit points:** a specific job's detail.

**Constraints:** one credit per minute of source video, a five-credit minimum to submit at all, a maximum source length of 180 minutes, at most two jobs in flight per person at once, and a cap on how many submissions can be made in a single hour — all stated as limits the interface should communicate rather than let a person discover by hitting them unexplained.

---

### 3.11 Video Lab — Job Detail

**Job:** watch a single clip-extraction job progress, then review its output.

**Shown, ranked by importance:** the job's current stage, in plain language (queued → downloading → transcribing → analyzing → rendering → complete, or failed with the specific stage it broke at); once complete, the resulting short clips, ordered by an AI-computed quality score, each independently previewable.

**Actions:** watch a clip; delete the job (as above); retry (as above) if failed; a refund note appears automatically on failure, so the person knows they weren't charged for a job that didn't finish.

**States:** each pipeline stage in turn; complete with results; failed, with the specific stage identified and a refund confirmation; not-found (either a bad link or a job that doesn't belong to this person — shown identically either way, so as not to reveal whether a given job ID exists).

**Entry points:** opening a job from the Video Lab list.
**Exit points:** back to the list.

**Constraints:** target output is roughly seven clips per job, each 30–90 seconds — useful for setting expectations on how long a "complete" job's result set will be.

---

### 3.12 Credits (Video Lab billing)

**Job:** manage the pay-as-you-go credit balance that Video Lab specifically draws from, including buying more.

**Shown, ranked by importance:** current balance; a transaction history (date, type — purchase / used / refund / bonus / adjustment, amount, running balance after); three fixed purchase packages, one marked as the most popular option.

**Actions:** buy a package (primary — hands off to an external, real checkout); nothing else is available here (no invoice download, no plan cancellation — there is no subscription to cancel, only one-time credit purchases).

**States:** normal balance view; a success banner just after a completed purchase; a cancelled-purchase banner; a checkout-start failure with a plain retry message.

**Entry points:** the dashboard's "view billing" action; the main navigation ("Credits"); Video Lab's insufficient-credit prompts.
**Exit points:** an external checkout; back to wherever the "buy credits" action was triggered from.

**Constraints — worth flagging directly:** despite being the destination for the dashboard's general "View billing" action, this screen only ever shows the Video Lab credit wallet — it is not a general account-billing or subscription-management page. Anyone arriving here expecting a broader billing overview (their overall plan, their Generate/Studio credit usage, an invoice history beyond these transactions) will not find it. Package purchases go through a real, external one-time checkout in a fully configured environment; an alternate, clearly-flagged fallback path exists for environments where that isn't set up.

---

## 4. User Flows

**Flow 1 — A brand-new solo creator's first working session.** Signs in for the first time → lands on the Dashboard in its first-time state, seeing a three-step checklist instead of the usual stat cards → connects a social account (hands off to the account-settings screen documented in the companion spec) → returns to the Dashboard, now showing "1 of 3 done" → starts a generation, picks an image, writes a caption, and either schedules or publishes it → returns to the Dashboard a final time to see the checklist fully complete and the ordinary view (stat cards, funnel, recent generations) replace the onboarding card for good.

**Flow 2 — Generate and schedule a single post end-to-end.** Opens Generate/Studio → chooses a content type and writes a brief → sees the credit cost before committing and generates → reviews the results, picks the best one, opens it full-size to confirm → writes a title, caption, and hashtags, optionally re-scoring discovery readiness → schedules it for a specific future time rather than publishing immediately → is handed to the Calendar, where the new post now appears on the chosen date.

**Flow 3 — Investigating and recovering from a failed scheduled post.** Notices a nonzero "failed" count in the Dashboard's content-flow funnel → opens the Calendar and finds the failed post (flagged inline) → opens its detail and reads the specific failure reason → decides to reschedule it for a new time, which is also how it gets retried, since there's no separate retry control → if the new time slot is already taken on the same account, is warned and can choose to schedule anyway rather than silently overwrite anything.

**Flow 4 — Building a multi-slide carousel that partially fails.** Chooses carousel mode, sets six slides, and generates → slides render one at a time; two of the six fail while four succeed → rather than discarding the whole batch, the four successful slides are kept and offered as a usable partial result → retries only the two failed slides, without being re-billed for the four that already succeeded → proceeds to captioning and scheduling once satisfied.

**Flow 5 — Reusing an existing Library asset in a new post.** Opens the Library, finds an asset flagged "unused" → opens its detail, confirms it isn't tied to any post yet → uses it as the source image for an image-edit generation in Generate/Studio → once a new result is produced from it, schedules that result through the Calendar as usual.

**Flow 6 — Resuming an abandoned generation session.** Starts a brief, gets partway through writing a prompt, and leaves without generating → returns later, opens Session History, and finds the saved draft prompt exactly where it was left → resumes it, adjusts the brief, and generates from there.

**Flow 7 — Running out of credits mid-workflow.** Attempts to generate a Premium-quality video → the interface blocks the action and states exactly how many credits are needed versus how many are available → follows a direct link to Credits → buys the smallest package → returns to Generate/Studio and completes the original generation.

**Flow 8 — Extracting clips from a source video (with a known dead end).** Submits a YouTube link to Video Lab, with enough credits to clear the five-credit minimum → watches the job move through its stages → reviews the finished, AI-ranked clips once complete → **there is currently no in-app path from here into Library, Calendar, or Generate/Studio** — the person has working clips and nowhere the product itself offers to take them next. This gap is called out again in Section 5.

**Flow 9 — Cleaning up the Library, with a near-miss.** Filters the Library down to "unused only," multi-selects a batch of old assets, and deletes them all at once with no separate bulk-confirmation step → realizes one of them was actually still needed → opens Trash and restores it, since deletion here is a soft delete rather than immediate and permanent.

**Flow 10 — Checking on an unhealthy connected account from the Dashboard.** Notices an account marked "Needs attention" in the Dashboard's connected-accounts card → follows "manage accounts" to the account-settings screen (documented in the companion spec) to investigate and reconnect it → returns to the Dashboard, where the account's status updates to reflect the fix without needing a manual refresh.

---

## 5. Honest UX Problem List

Framed as open questions for the product and design team — some of these may be intentional phasing rather than oversights.

1. **This cluster of personal screens currently has two different, simultaneously-live navigation structures**, and they don't list the same things. One (used by Analytics, Settings, Video Lab, and Credits) includes Video Lab, Credits, and account settings as persistent items. The other (used by the Dashboard, Generate/Studio, Calendar, and Library) only lists five items — Dashboard, Studio, Library, Calendar, and Brand Kit — and drops Analytics, Credits, Video Lab, and Help entirely, leaving them reachable only from screens still using the older structure. Should the redesign standardize on one persistent navigation that includes everything, or is some of this intentionally being retired?
2. **The Dashboard's "Simulated publish" and "Simulated" labels are fixed, unconditional badges**, not actually computed from whether a given post or account is really running through a simulated connection versus a real one (the underlying data distinguishes the two, but the Dashboard's own queries don't currently read that field). If a real connection is ever active alongside simulated ones, the Dashboard would currently mislabel it. Should this become a genuinely per-item label before it's trusted as accurate?
3. **A "negative prompt" input exists in the underlying brief state but has no visible control for the person to set it** in Generate/Studio today — a real, half-built input. Should it be finished and exposed, or removed until it is?
4. **The Library's Trash explicitly promises 30-day recovery and then permanent removal, but nothing actually enforces that removal** — deleted assets are recoverable indefinitely today, and there is no "delete forever" action anywhere. Either the stated promise or the actual behavior needs to change so they agree.
5. **There is no explicit "publish now" or "retry" action on a scheduled or failed Calendar post** — both are accomplished indirectly by rescheduling. Is that indirection intentional (fewer buttons, one mental model: "when should this go out"), or should a redesign make retry/publish-now explicit given how often a failed post is likely to need exactly that?
6. **A completed Video Lab job has no in-app hand-off into Library, Calendar, or Generate/Studio.** A person who successfully extracts great clips has no product-offered next step to actually turn them into a scheduled post — they would have to leave the app to download and re-upload. Should Video Lab output land directly in the Library, or offer a direct "schedule this clip" action?
7. **Session History treats "delete" inconsistently depending on what's being deleted:** deleting a session is explicitly permanent and removes its content; deleting a project only unfiles its sessions into a general bucket rather than removing anything. The same word describes two very different levels of consequence one click apart — worth a clearer distinction in wording or confirmation weight.
8. **The Dashboard's "View billing" action leads to a screen that is scoped only to Video Lab's credit wallet**, not a general account-billing overview. Anyone expecting broader billing information (overall plan, Generate/Studio credit history, invoices) won't find it there. Should billing be unified into one screen, or should the Dashboard's link and label be clearer about where it's actually going?
9. **Publishing immediately from Generate/Studio is explicitly flagged as not undoable from that screen, with no intermediate confirmation weight beyond a single dialog**, while saving as a draft carries no such consequence at all. Given how permanent the language already is around "publish," is a single confirmation the right amount of friction for an action this final?
10. **Bulk actions in the Library (archiving or deleting many assets at once) currently skip the confirmation step that the same action requires one item at a time.** Should bulk destructive actions get at least the same confirmation weight as their single-item equivalent, given they can affect far more at once?
11. **"Studio" (the workspace's own navigation label) and "Generate" (its route and the label used elsewhere) refer to the exact same workspace** — worth folding into one consistent name during redesign, consistent with the terminology-consistency concerns already raised for other parts of the product in the companion document.

---

## 6. Real Content Samples

**Prompt starting points (shown as suggestions, by content type):**
- Image: "A serene morning café scene with golden light and fresh coffee on a marble surface"; "Bold product close-up on a clean white background with dramatic shadow detail"; "Vibrant lifestyle moment — someone using the product outdoors in natural sunlight"
- Carousel: "5-slide series: '3 Ways to Transform Your Morning Routine' with clean typography"; "Product benefit breakdown — before and after with consistent typographic slides"
- Video: "Dynamic product reveal with a slow cinematic camera pan and warm color grade"; "Upbeat lifestyle montage showing the product in three everyday scenarios"
- Image edit: "Remove the background and place the subject on a clean white studio surface"; "Add warm sunset glow and soft bokeh lighting to the existing image"
- Image-to-video: "Gentle forward camera push into the scene with a soft light drift"; "Hero motion: leaves sway naturally, steam rises slowly from the coffee cup"

**Status labels in use:** Post — Draft, Scheduled, Published, Failed, Publishing, Archived. Generation — Queued, Processing, Completed, Failed. Connected account health — Healthy, Reconnect, Reconnecting, Needs attention, Disconnected.

**Supported platforms:** Instagram, TikTok, YouTube, Facebook, LinkedIn, X (Twitter), Pinterest, Threads.

**Content types / format options (Generate/Studio):** Image, Carousel, Text to video, Image edit, Frames to video. Aspect ratios: 1:1, 4:5, 9:16, 16:9. Video length: 5s or 10s. Video quality: Standard or Premium.

**Credit packages (Credits/Billing):**
| Package | Credits | Price |
|---|---|---|
| Starter | 100 | $15 |
| Creator (most popular) | 300 | $35 |
| Pro | 1,000 | $99 |

**Real error and status copy found in the product, by scenario:**
- Insufficient credits (pre-generation): "Not enough credits — you need {cost} but have {available}."
- Video quality auto-upgrade: "Standard tier requires a source image for image-to-video; this request had none, so it renders (and is billed) at premium quality instead."
- Cancel confirmation: "Cancelled — any renders already in progress will still appear in this session."
- Video job failure (inside Generate/Studio): "Failed — credits were refunded."
- Immediate-publish confirmation: "This posts immediately (simulated). Unlike a draft, this can't be undone from here."
- Publish confirmation: "'{title}' was queued to {account}."
- Session deletion warning: "…and its generations will be removed. This can't be undone."
- Upload rejected (type): "File type 'X' isn't supported yet — try an image, video, or PDF instead."
- Upload rejected (size): "File is larger than the 50MB limit for a single asset."
- Library empty state: "Nothing in your Library yet" / "Upload your first asset — logos, brand photography, anything you'll want to post later."
- Library filtered-empty state: "No assets found" / "Try changing filters or upload new content."
- Trash empty state: "Trash is empty — nothing deleted in the last 30 days."
- Unused-asset explanation: "Not used on any post yet — that's why this card shows the 'Unused' badge."
- Calendar empty state: "Nothing scheduled yet" / "Create your first post and pick a date — no need to open AI Studio first, though you can if you want richer generation tools."
- Calendar filtered-empty state: "No posts match these filters."
- Calendar fetch error: "Couldn't load posts. Check your connection and try again."
- Concurrent-edit notice: "This post changed elsewhere… We refreshed this card to the latest version — your move was not applied."
- Locked reschedule: "Published posts can't be rescheduled — open the post to see options."
- Delete confirmation: "Delete this post? This cannot be undone."
- Duplicate blocked: "A draft for this asset already exists."
- Scheduling conflict: "Time slot already taken… Another post is scheduled to this account at the exact same time. Nothing was overwritten." with a "Schedule anyway" option.
- Mock-connection disclosure (shown on published posts): "Publishing in this build uses a mock connection, not a live platform API."
- Video Lab worker offline: "Video worker is offline. Jobs can be queued but will start once the worker restarts."
- Video Lab insufficient credits: "You need at least {N} credits to process a video."
- Video Lab unsupported link: "Platform not supported. Paste a YouTube or Twitter/X URL."
- Video Lab job not found: "Job not found or you don't have access to it."
- Video Lab refund notice: "Credits for this job have been refunded. Submit the same URL to try again."
- Purchase success: "Payment successful! Your credits have been added."
- Purchase cancelled: "Payment was cancelled."
- Checkout failure: "Could not start checkout. Please try again."

---

## 7. Technical Constraints That Bind Design

**Timing the interface should set honest expectations around:**
- A single image generation typically takes about 20 seconds; video generation typically takes 2–4 minutes.
- A multi-slide carousel generates one slide at a time, sequentially, not all at once — a six-slide carousel is visibly slower than a single image, and the interface should show per-slide progress rather than one opaque spinner.
- The Dashboard refreshes automatically on relevant changes with a short debounce (well under two seconds); credit balance updates on an even faster, separate channel.

**Volume and pagination:**
- The Library's asset grid currently loads the person's entire active collection at once, with no pagination — this will not scale gracefully as a library grows into the thousands of items.
- The Dashboard's recent-generation search only covers a rolling window of roughly the 120 most recent generations, not full history.
- The Calendar's drafts rail is capped at the 50 most recent drafts.
- A background process sends out due scheduled posts in batches of up to 50 per run.

**Credits and cost, all shown before commitment:**
- Image: 1 credit each. Carousel: 1 credit per slide (default 6 = 6 credits). Image edit: 3 credits. Video Standard: 5 credits. Video Premium: 15 credits (also applied automatically, with an explanation, to a Standard request that has no source image).
- Video Lab: 1 credit per minute of source video, 5-credit minimum to submit, up to 180 minutes of source per job, at most 2 jobs in flight per person at once, and a cap on submissions per hour.
- Credits are reserved before work starts and refunded automatically if the work fails — a person is never charged for something that didn't complete.

**Size and format limits, worth stating in the interface itself:**
- Library upload: image, video, or PDF, up to 50MB per file, multiple files uploaded independently in one batch.
- Video Lab clip length: roughly 30–90 seconds each, about 7 clips per completed job.

**Recovery windows:**
- Library soft-deletes are stated as 30-day-recoverable in the interface, but nothing currently enforces removal after that window — items are recoverable indefinitely in practice today (see Section 5, item 4).

**Mixed real/simulated data — must stay honestly labeled, not polished away:**
- All publishing in this cluster of screens — scheduled and immediate — currently runs through a simulated mechanism rather than live social-network APIs, by permanent product decision. This must remain clearly and consistently distinguishable from what a live connection/publish would look like, everywhere it's relevant here (the Dashboard's next-post and connected-accounts cards, every Calendar post once published, Generate/Studio's publish confirmation).
- Credit-pack purchases go through a real, external one-time checkout when the environment is fully configured; a separate, clearly-different fallback exists for environments where it isn't — the interface should not let these look identical to each other during testing/staging.

**Multi-tenancy scoping:** every query in this entire cluster of screens is already scoped to the individual signed-in person (excluding anything that belongs to an organization) — there is no cross-account visibility risk within this document's scope to design around, unlike the organization and admin worlds covered in the companion document.
