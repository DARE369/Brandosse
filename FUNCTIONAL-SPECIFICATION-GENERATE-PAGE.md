# Functional Specification — Videos (the clipping surface)

**What this document is.** A complete, implementation-free description of what the Videos surface does, written so a designer can produce an interface for it from scratch. It describes jobs-to-be-done, information, actions, states, relationships, and constraints. It deliberately does **not** describe layout, hierarchy, components, colour, type, density, navigation patterns, or any current visual arrangement — none of that is settled, and nothing here should be read as a hint. Where the current build does something visual, this document names only the *capability* underneath it, never the form it takes today.

**How to read it.** Parts 1–9 are the specification. Appendix A is a separate engineering record of the current code's health — it exists so the implementer knows what will be rebuilt versus reused, and it prescribes nothing about the design. Appendix B is a cross-application consistency and blocked-flow audit for the rest of the personal workspace, at the same remove.

**Ground truth.** Everything asserted here was read out of the code on 2026-08-25 and is cited by `file:line`. Where the code and older internal documentation disagree, the code wins and the disagreement is noted. Where something could not be verified, it says so.

**Market position, stated once and not elaborated.** The direct competitor is OpusClip. That is a statement about what job the product must do — take one long video and return several short, ranked, caption-burned, ready-to-post vertical clips — and about the standard of reliability and speed users will measure it against. It is **not** a design reference, and no OpusClip interface pattern is prescribed, implied, or requested anywhere in this document.

---

## 1. What this surface is

Videos is the product's clip-extraction pipeline. A person supplies one long video — by uploading a file or pasting a link — and the system returns several short, vertical, captioned clips cut from it, each scored for how likely it is to perform, each ready to download, keep, or schedule.

It is a **distinct product capability from the rest of the application**, and this distinction is load-bearing for the design:

- Everywhere else in the app, the person *authors* content: they describe something and the system generates it.
- Here the person *supplies* content and the system *finds* what is worth keeping inside it. The raw material already exists and already belongs to them; the value the product adds is selection, cropping, captioning, and ranking.

**The job it is hired for.** "I have a long video — a podcast episode, a webinar, an interview, a stream — and I know there are five good minutes inside sixty. Find them for me, cut them properly, and hand them back ready to post."

**What a successful session looks like.** The person arrives with a file or a link, hands it over, leaves (the work takes minutes, not seconds), comes back, and finds a set of finished clips ordered so the best one is obvious. They watch two or three, take the ones they want, and move them onward — to storage, to a schedule, or to their own disk. They never have to ask whether the system is still working, what stage it is at, or why a clip was chosen.

**Two facts that shape everything.**
1. **This is long-running, unattended work.** A job takes minutes and continues whether or not the person is watching. Nothing in the experience may assume the person stays on screen, and everything must survive them leaving, closing the tab, and returning on another device.
2. **It costs real money per use** — credits are consumed in proportion to the length of the source video. The person must always be able to answer "what will this cost me" *before* committing, and "was I charged" after something goes wrong.

---

## 2. Roles and access

There is exactly one role on this surface: **the signed-in individual account owner.** There is no sharing, no reviewer, no second person with reduced access, and no organisation equivalent — the clipping pipeline exists only in the personal workspace.

Access rules that exist and must be honoured:
- Every screen requires a signed-in session. There is no anonymous or partial view.
- Every read is scoped to the owner at the database level (`supabase/migrations/20260710190000_baseline_video_engine_tables.sql:49-52`) and again in every query (`src/services/videoEngineData.js:62-64`, `app/api/video/jobs/[id]/route.ts:69`).
- A job belonging to someone else, and a job that does not exist, must be **indistinguishable** to the person asking. Both currently resolve to the same not-found outcome (`app/api/video/jobs/[id]/route.ts:72-74`) and that behaviour must be preserved — it is what prevents someone from discovering whether a given job ID is real.
- The person may not modify a job directly; the pipeline owns job state (`…baseline_video_engine_tables.sql:59-62`). The only job-level write a person can perform is deletion.
- Uploaded source files are scoped to the uploader by a signed, short-lived, single-use ticket, and the processing secret never reaches the browser (`src/components/video-engine/SubmitForm.jsx:196-207`).

---

## 3. Screens

The surface is three screens plus one it depends on. Each is described as *job → information needed → actions available → states → entry/exit → binding constraints*.

### 3.1 The job list ("my videos")

**Job.** Answer, on arrival: what have I put through this, what is running right now, and what is finished and waiting for me.

**Information this screen needs to carry, ranked by what the person is actually looking for:**
1. Which jobs are currently working, and how far along each is. This is the single most-asked question on this screen and the current build answers it worst.
2. Per job: what the source was (a human-readable title where the pipeline could determine one; otherwise something that lets the person recognise their own submission), when it was submitted, how long the source was, how many clips came out, and its current state.
3. The seven states a job can be in, in plain language: waiting to start, downloading the source, transcribing the audio, analysing for moments worth cutting, rendering the clips, finished, failed. (`src/lib/video-engine/constants.ts:35-43`)
4. Whether the person currently has capacity to start another job — two may be in flight at once (`src/lib/video-engine/rate-limiter.ts:7`), and ten may be submitted per hour (`…rate-limiter.ts:50`).
5. **Not currently shown and required:** how long each finished job's clips will remain available before they are automatically deleted. See §7.

**Actions.**
- *Start a new job* — primary, and always available in some form even when the list is full of work, because the answer to "can I start another" is itself information.
- *Open a job* — primary.
- *Delete a job* — destructive and permanent; it removes the job record and all of its stored clip files (`app/api/video/jobs/[id]/route.ts:107-127`). It must be confirmed, and the confirmation must say that the clips go with it.
- *Retry a failed job* — currently this does not resubmit anything; it carries the original source link into a fresh submission for the person to re-confirm (`src/components/video-engine/JobStatusPipeline.jsx:180`). Whether retry should become a true one-click resubmit is an open product decision, not a design one; the design should assume the person is told which of the two is happening.
- **Missing and needed at any realistic volume:** search, filter by state, and sort. The list is capped at the 50 most recent jobs (`src/services/videoEngineData.js:32`) with no pagination, no search, and no filter. A person who has used this for a month cannot find anything.

**States.** Loading; loaded with jobs; empty (never submitted anything); load failure, which must be honest that the failure is in *displaying* the list and that any running work is unaffected; and — currently absent — the state where a job is running and the list is showing stale information about it.

**Entry.** The main navigation entry labelled "Videos" (`src/ui-v2/shell/navItems.js:34`). That is presently the only reliable way in; see Appendix B.
**Exit.** A job's detail; the submission screen; the credits/billing screen when the person cannot afford to submit.

**Binding constraints.**
- Two concurrent jobs per person; ten submissions per hour. Both are enforced server-side and the person must learn about them *before* being refused, not by being refused.
- The list must reflect job progress without the person reloading. It currently does not — it is fetched once on mount with no live channel and no polling (`src/pages/VideoEngine/VideoJobsPage.jsx:19-31`), while the detail screen has both (`src/hooks/video-engine/useJobRealtime.js`). A person who submits a job and returns to the list sees it frozen at "In Queue" indefinitely. Whatever form the list takes, live state is a requirement, not an enhancement.

---

### 3.2 Submitting a video

**Job.** Get the source in, set expectations honestly, and refuse clearly and early anything that will not work.

**Information the person needs before committing:**
1. **Two ingestion paths, which are not equally reliable, and the person must be told so.** Uploading a file always works. Pasting a link depends on the source platform tolerating an automated download from a server, and YouTube frequently does not — this is the single most common real-world failure of the whole product (`src/components/video-engine/JobStatusPipeline.jsx:98-103` documents 4 of 9 lifetime job failures as exactly this). The current build states this in the interface before submission (`SubmitForm.jsx:394-397`) and that honesty must survive the redesign in some form.
2. Supported link sources: YouTube (watch, short-link, and Shorts URLs) and Twitter/X status URLs. Playlists, private videos, and Shorts-inside-a-playlist are explicitly rejected (`app/api/video/submit/route.ts:76-87`).
3. Supported upload formats — MP4, MOV, MKV, WebM, AVI — and the size ceiling, currently 4 GB (`SubmitForm.jsx:35-42`).
4. **Cost, before committing.** One credit per minute of source video (`src/lib/video-engine/constants.ts:4`), with a five-credit minimum balance required to submit at all (`…constants.ts:5`). Note the asymmetry the design must handle honestly: the *true* cost is not knowable until the system has fetched the video and measured it — the charge is applied after the download stage, once duration is known (`video-worker/job_runner.py:51-56`). So the person can be shown a rate and an estimate, but not a guaranteed figure, and should not be shown one that pretends otherwise.
5. Current credit balance, and a direct route to buy more when it is insufficient.
6. How many of their two concurrent slots are in use.
7. Whether the processing machine is currently awake. It powers down when idle to keep cost near zero, and a submission to a sleeping worker adds roughly thirty seconds before anything starts (`SubmitForm.jsx:428-433`). This is a legitimate and honest thing to say. (It is currently said *always* — see Appendix A.)

**Optional settings the person may adjust, all of which have working server and pipeline support:**
- **Aspect ratio.** The pipeline accepts five (`app/api/video/submit/route.ts:31`); the current interface offers four (`src/components/video-engine/AspectRatioPicker.jsx:3-8`). All five should be available: 9:16, 4:5, 1:1, 16:9, 3:4. Default 9:16.
- **Caption style.** Six burned-in caption treatments, each meaningfully different in how words appear over time: words highlighting as spoken; large words dropping in; boxed words popping in; plain outlined text; coloured emphasis on key words; one key word at a time (`src/components/video-engine/CaptionStylePicker.jsx:3-10`). Default: the first. **These are the visual output of the product and the person is choosing them blind** — there is currently no way to see what any of them looks like before committing credits. Giving the person a way to know what they are choosing is a real requirement.
- **Target number of clips.** Optional; blank means the system decides. The server accepts 1–15 (`app/api/video/submit/route.ts:34`).
- **Clip length range**, minimum and maximum in seconds. Server accepts 10–600 for each, and rejects a minimum that is not below the maximum (`…submit/route.ts:35-36, 41-52`). The pipeline's own target band is 30–90 seconds (`src/lib/video-engine/constants.ts:12-13`).
- **A free-text steer** — "focus on these moments" — up to 500 characters, describing what the person wants found (`…submit/route.ts:37`).

**Actions.** Choose an ingestion path; supply a file or a link; adjust any of the settings above; submit. Nothing else.

**States, all of which currently exist and each of which needs its own clear treatment:**
- Nothing supplied yet.
- A link pasted and recognised as a supported source.
- A link pasted and recognised as unsupported — said as soon as it is recognisable, not on submit.
- A file chosen and accepted.
- A file rejected, with the specific reason: too large (with its actual size named), empty, or an unsupported format (`SubmitForm.jsx:51-62`).
- **Uploading.** Up to 4 GB is moving. The person currently gets the word "Uploading…" and nothing else — no percentage, no bytes, no time estimate, no cancel (`SubmitForm.jsx:462`). On a domestic connection a large file is a multi-minute silence with no evidence of life. This is a required state, not an optional refinement.
- Submitting, after upload completes.
- Refused — insufficient credits, with the exact shortfall and a route to fix it.
- Refused — both concurrent slots in use, naming what is running.
- Refused — hourly submission limit reached.
- Failed at upload, with distinct outcomes for: the processing volume being out of disk space, the file exceeding the ceiling, and the upload authorisation window having expired (`SubmitForm.jsx:227-243`).
- Processing machine asleep (an advisory, not a refusal).
- Credit balance could not be read (an advisory: the balance shown may be wrong).

**Entry.** From the job list; from a failed job carrying its source forward; from a URL that already contains a source link (`SubmitForm.jsx:64-71` — a link may be handed in from elsewhere and should prefill).
**Exit.** Straight into the new job's detail screen on success (`SubmitForm.jsx:285`); to credits when blocked on balance.

**Binding constraints.** Maximum source length 180 minutes (`src/lib/video-engine/constants.ts:7`). Maximum upload 4 GB. Five-credit minimum. Two concurrent, ten per hour.

---

### 3.3 A job in progress

**Job.** Hold the person's confidence for the several minutes the work takes, and if it fails, tell them what happened in terms they can act on.

**Information needed:**
1. Where the job is, expressed as an ordered sequence the person can see themselves moving through. The stages, with the pipeline's own honest estimates: waiting to start (seconds); downloading the source (1–3 min); transcribing the audio (1–2 min); analysing for the moments worth cutting (under 1 min); rendering the clips (2–5 min); complete (`src/components/video-engine/JobStatusPipeline.jsx:6-13`).
2. Real progress *within* the two long stages, because these are where the person loses patience: the download reports a true percentage where the source provides one (`video_jobs.download_progress`), and rendering reports clip N of M, because clips finish one at a time and each one lands as it completes (`JobStatusPipeline.jsx:153-155, 256-276`).
3. Elapsed time.
4. Whether the live connection is currently healthy, so a stalled-looking screen can be distinguished from a stalled job (`src/hooks/video-engine/useJobRealtime.js:117-119`).
5. The source's title, once the pipeline has determined it.

**On failure, the person needs three things and not one:** what went wrong in plain language, what to do about it, and — separately and secondarily — the underlying technical detail for anyone who wants it. The system already classifies failures into distinct, actionable cases (`JobStatusPipeline.jsx:95-140`):
- The source platform blocked the download → and the answer is "upload the file instead".
- The video is not available in a downloadable format.
- The video is private, restricted, or region-locked.
- The video has no audio track, so there is nothing to transcribe and therefore nothing to clip.
- Processing exceeded its time limit; shorter sources are more reliable.
- A service on our side is misconfigured — explicitly *not* the person's fault.
- Anything else, named by the stage it broke at.

**A financial fact that must be surfaced and currently is not.** Credits consumed by a job that fails are refunded automatically (`video-worker/job_runner.py:165, 177`; `video-worker/database.py:207-240`). The person is not told this. An earlier version of this screen *claimed* a refund with no knowledge of whether one had occurred, which was correctly removed (`JobStatusPipeline.jsx:80-88`) — but the correct fix is to show the real refund, not to stay silent about money. The design should assume refund state is available to display.

**Actions.** Return to the list; try again with the same source, if failed; expand technical detail, if failed. **Notably absent: no way to stop a job that is running.** The system only permits cancellation while a job is still queued; once processing begins it refuses, with a 409 and an explanation (`app/api/video/jobs/[id]/route.ts:99-105`). The current interface offers the same delete control regardless and surfaces the refusal as a generic "Could not delete. Try again." (`src/components/video-engine/JobCard.jsx:31`) — which is wrong twice: it is not a transient error, and retrying will not help.

**States.** Each of the six pipeline stages; failed, identified to the stage that broke; and — see Appendix A — at least one state the pipeline can enter that the interface has no representation for at all.

**Entry.** Opening a job from the list; landing here directly after submitting.
**Exit.** The results, when the job completes; the list; a fresh submission carrying the same source.

**Binding constraints.** Live updates arrive over a subscription with a polling fallback every 5 seconds when that subscription is down and every 30 seconds when it is up, stopping entirely once the job is finished or failed (`useJobRealtime.js:5-7, 52-66`). The design may assume state is current to within a few seconds and must not assume the person is present when it changes.

---

### 3.4 The results — finished clips

This is the payoff screen and the one the whole product is judged on.

**Job.** Let the person quickly judge several clips, understand why each was chosen, and move the good ones onward with as little friction as possible.

**Information available per clip — all of it real, all of it already stored:**
- The clip itself, playable, with a poster frame.
- An AI-written title and an AI-written caption (`video_clips.ai_title`, `ai_caption`).
- Its duration, and — stored but currently unused — **where in the source it came from**, as a start and end timestamp (`video_clips.start_time_secs`, `end_time_secs`). This answers "which part of my video is this" and is presently visible nowhere.
- A **suggested destination**: TikTok, Reels, Shorts, or universal (`video_clips.platform_target`, constrained at `…baseline_video_engine_tables.sql:81`).
- **Five scores.** One overall score, and four dimensions beneath it: hook strength, flow, content value, and trend fit (`video_clips.overall_score, hook_score, flow_score, content_score, trend_score`). Hook is the strongest single predictor of whether a clip gets watched, and the current build already treats it as the most important of the four (`src/components/video-engine/ClipPreviewPanel.jsx:38-40`). Scores may be absent, and an absent score must read as *unknown*, never as zero (`src/components/video-engine/clip-utils.js:16-21`).
- A short written explanation of **why this clip works** (`video_clips.why_this_works`), populated by the analysis stage. This is one of the most persuasive things the product produces and it is currently easy to miss.
- **Stored and never shown:** the transcript excerpt for the clip (`video_clips.transcript_excerpt`). This is the clip's actual words, available for free, and it is the fastest way for a person to judge a clip without watching it.
- Per-clip render state. A clip can fail on its own while its siblings succeed. A failed clip carries its own error and must be clearly distinguished from a successful one, must not be ranked among them, and must state that it was not charged for.

**Job-level information:** how many clips are ready, how many failed, and — required, currently absent — **when these clips will be deleted** (see §7).

**Also produced by the pipeline and currently surfaced nowhere at all:** a single **stitched output** — every clip from the job concatenated into one continuous video, produced after rendering and stored on the job (`video-worker/stages/stitch.py`; `video_jobs.stitched_output_url`; migration `20260622000002_video_jobs_stitched_url.sql`). It is generated on every successful job, it costs storage, and no interface has ever offered it. Whether it earns a place is a product call; that it exists is a fact the design should know.

**Ordering.** Clips are ranked by overall score, best first, with failed clips excluded from the ranking and placed after it (`src/components/video-engine/ClipsGallery.jsx:246-266`). Ranking is the product's core claim — the person should not have to sort.

**Actions, in rough order of how often they are wanted:**
- *Play a clip.* Playback must be cheap to start and cheap to abandon; the person is triaging, not watching.
- *Download a clip* as an MP4.
- *Keep a clip* — save it into the Content Library as a personal asset. This goes through the identical pipeline a manual Library upload uses (checksum, perceptual hash, the personal-asset upload path) rather than a parallel one (`src/components/video-engine/clipLibraryActions.js:1-30`). Once kept, a clip must read as kept everywhere it appears, so the person cannot accidentally create a duplicate Library entry for the same clip.
- *Keep all clips at once*, skipping the ones already kept (`ClipsGallery.jsx:295-313`). This must report partial failure honestly — some may save and some may not.
- *Schedule a clip.* This saves it to the Library first if it is not already saved, then hands off to the Calendar with the asset pre-selected for a new post (`clipLibraryActions.js:31-33`; `src/services/assetLibraryService.js:585-588`; consumed at `src/pages/Calendar/CalendarPage.jsx:195-216`). The two-step nature of this — save, then schedule — is invisible to the person today and should stay invisible, but the design must account for the wait.
- *Copy the AI caption* to the clipboard.
- **Absent and worth deciding on:** editing the AI title or caption before keeping or scheduling; choosing a subset of clips and acting on them together; re-rendering a single failed clip.

**States.** Job complete with clips; job complete with **zero** clips — a real and non-obvious outcome that happens when a video has no speech or the analysis found nothing worth cutting, and which needs its own explanation rather than an empty result (`ClipsGallery.jsx:317-332`); clips still arriving while the job finishes rendering; a clip that failed to render; a clip whose playback link has expired and is being renewed; a clip that will not play at all.

**A constraint the design must absorb: playback links expire.** Clip URLs are signed for 48 hours (`src/lib/video-engine/constants.ts:23`). The system detects expiry and silently requests a fresh link on playback failure (`src/hooks/video-engine/useSignedUrls.js` via `ClipsGallery.jsx:283`; `app/api/video/clips/[id]/refresh-url/route.ts`). This recovery exists and works; it just needs to not read as a broken video while it happens.

**Entry.** A job reaching completion, whether the person is watching or arriving later.
**Exit.** The Content Library (a kept clip); the Calendar (a scheduled clip); the person's own disk (a download); the job list.

---

### 3.5 The dependency: credits

Not part of the Videos surface, but the Videos surface cannot function without it and must route into it correctly.

- Balance, and a ledger of every purchase, use, refund, bonus, and adjustment with the running balance after each (`src/services/videoEngineData.js:14-25`).
- Three one-time purchase packages: 100 credits for $15, 300 for $35 (marked the popular choice), 1000 for $99 (`src/lib/video-engine/credit-packages.ts:15-41`). There is no subscription and therefore nothing to cancel.
- Purchases go through a real external checkout.
- **One wallet, shared.** The same credits pay for image generation, video generation, edits, and clip processing (`src/pages/Billing/BillingPage.jsx:113`). This matters here: a person who spends their balance in the Studio cannot process a video, and the Videos surface must be able to say so precisely rather than generically.
- **There are currently two different screens for this one wallet.** See Appendix B.

---

## 4. How Videos relates to everything else

This is the section the design most needs, because the Videos surface is currently near-isolated and the fix is mostly a matter of connections, not screens.

### 4.1 Connections that exist and work

| To | Direction | What happens | Evidence |
|---|---|---|---|
| **Content Library** | Videos → Library | A clip is saved as a personal asset through the same upload path as a manual Library upload — same checksum, same perceptual hash, same edge function. It then behaves like any other asset: it appears under the Library's "video" type filter, can be tagged, can be scheduled, can be trashed and restored. | `src/components/video-engine/clipLibraryActions.js:8-29`; `src/pages/Library/LibraryPage.jsx:202,508` |
| **Calendar** | Videos → Calendar | "Schedule" saves the clip to the Library, then opens the Calendar's quick-post composer with that asset pre-selected. | `clipLibraryActions.js:31-33`; `src/services/assetLibraryService.js:585-588`; `src/pages/Calendar/CalendarPage.jsx:195-216` |
| **Credits / Billing** | Videos → Billing | Insufficient balance routes to the purchase screen. | `SubmitForm.jsx:445` |
| **The application shell** | Shell → Videos | A primary navigation entry, "Videos". This is currently the surface's only dependable entry point. | `src/ui-v2/shell/navItems.js:34` |
| **The shared credit indicator** | Shell → Videos | The balance shown in the app chrome is the same wallet Videos spends from, live. | `src/ui-v2/shell/AppShell.jsx:110-118` |

### 4.2 Connections that should exist and do not

Each of these is a place where the product already holds the information and simply never offers the door.

1. **Dashboard → Videos.** The personal Dashboard counts "Clips ready" as one of its four headline numbers (`src/pages/Dashboard/PersonalDashboardPage.jsx:131`). It is not clickable, and nothing else on the Dashboard links to the Videos surface at all — the stat component accepts no action (`src/ui-v2/primitives/StatCard.jsx:11`). The Dashboard tells the person clips exist and offers no way to reach them.
2. **Dashboard → an in-flight job.** The Dashboard surfaces the next scheduled post with a live countdown, but says nothing about a video that is currently rendering — which is the longest-running and most anxiety-producing thing the product does.
3. **Videos → Studio.** A finished clip is a natural starting point for a caption, a repurpose, or a thumbnail, and Studio already accepts a handed-in source. No route exists.
4. **Library → Videos.** A video already in the Library cannot be sent to clipping, even though upload is a supported ingestion path and the asset is already stored. This is the most obvious missing connection in the product.
5. **Analytics → Videos.** The personal Analytics screen contains no reference to clips or video jobs whatsoever (verified: zero matches for "clip" or "video" in `src/pages/AnalyticsPage/PersonalAnalyticsPage.jsx`). A person cannot learn whether the clips they posted performed.
6. **Help → Videos.** The Help content contains nothing about the video surface at all (verified: zero matches in `src/pages/HelpPage/helpContent.js`). The product's most complex, most expensive, most failure-prone feature is entirely undocumented in-product.
7. **Settings → Videos.** There is no way to set a default aspect ratio or caption style, so a person who always wants 9:16 with one caption style re-chooses it on every submission. The Settings screen already hosts content defaults.
8. **Notifications → Videos.** The shell has a notification facility (`src/ui-v2/shell/NotificationBell.jsx`). A job that finishes while the person is elsewhere generates nothing. This is the single highest-value missing connection: the work is explicitly designed to be left alone, and nothing tells the person it is done.

### 4.3 A naming collision that must be resolved before design starts

The application contains **two unrelated systems both called "video jobs"**, and they are currently cross-wired.

- **Generative video** lives in the Studio: the person describes something, the system generates a short video. Its jobs are stored in `background_jobs` with type `video_generation` and are tracked in a Studio-local panel titled "Video jobs" (`src/stores/SessionStore.js:2803-2827`; `src/pages/Studio/StudioPage.jsx:1194`).
- **Clip extraction** is this document's subject. Its jobs are stored in `video_jobs` with clips in `video_clips`, and live at the "Videos" navigation entry.

They share no table, no pipeline, no cost model, and no output format. Yet the Studio panel's empty state — for *generative* video — offers a button that sends the person to the *clipping* submission screen (`StudioPage.jsx:1234`). A person who wants an AI-generated video is handed a form asking them to upload one.

The design cannot resolve which system owns the word "video" — that is a product decision — but it must be made before either surface is designed, because both currently claim the same name in the same navigation.

### 4.4 Systems the surface depends on

- **The processing worker** — a separate, long-running service that performs download, transcription, analysis, rendering, and stitching. It sleeps when idle and takes roughly thirty seconds to wake. Every timing promise in the interface ultimately depends on it.
- **Object storage** — for uploaded sources and rendered clips. Clip access is by time-limited signed link, not permanent URL.
- **Live update channel** — carries job and clip changes to any screen watching, with a polling fallback.
- **The shared credit wallet** — see §3.5.
- **The personal asset library upload path** — reused verbatim for keeping clips.
- **The Calendar quick-post handoff** — reused verbatim for scheduling clips.

---

## 5. Flows

**Flow 1 — First successful clip, from nothing.** Person opens Videos for the first time and sees an empty list that explains what the tool does. They start a job, choose to upload, pick a 40-minute file, see the rate and their balance, optionally adjust settings, and submit. The file uploads (minutes, with visible progress). The job appears and begins moving through its stages. **They leave.** Some minutes later they are told it is done. They return, see clips ranked best-first, watch the top two, keep three, and schedule one. Total attention required: under three minutes of the fifteen the job took.

**Flow 2 — Link submission that fails the way most link submissions fail.** Person pastes a YouTube URL. It is recognised. They submit. The job reaches downloading and fails because YouTube blocked the download. They are told, in plain language, that the platform blocked it, that it is not something they did, and that uploading the file directly always works. They are told the credits were refunded. They upload the file and it succeeds.

**Flow 3 — Blocked before starting.** Person tries to submit with three credits. They are stopped before anything is uploaded, told exactly what is required and what they have, sent to purchase, buy the smallest package, and return to the submission they were part-way through — ideally without re-entering it.

**Flow 4 — Second job while the first runs.** Person submits a second video while the first is still rendering, which is allowed. They submit a third, which is not — and they must learn this *before* uploading gigabytes, not after.

**Flow 5 — Partial success.** A job completes with six of eight clips rendered. The two failures are visible, explained, clearly not charged for, and do not contaminate the ranking of the six that worked.

**Flow 6 — Nothing to clip.** A job completes successfully with zero clips because the source had no speech. The person must understand this is a property of their video, not a failure of the system, and must not be charged as though they received something.

**Flow 7 — Returning after two days.** Person comes back to a finished job. Playback links have expired; the system renews them without the person seeing a broken video. But if a week has passed, the clips have been **permanently deleted**, and the person was never warned. See §7.

**Flow 8 — Clip to published post.** Person keeps a clip, which lands in the Library like any other asset. They open the Calendar, place it on a date, and schedule it. This path works end-to-end today.

**Flow 9 — Wanting to stop.** Person realises they submitted the wrong video. If it has not started, it can be cancelled. If it has, it cannot — and they must be told that clearly, not handed a generic error implying they should try again.

---

## 6. Real content this surface produces

Verbatim, so the design is calibrated against real text rather than placeholder lengths.

**Stage labels:** In Queue · Downloading Video · Transcribing Audio · Analyzing Content · Rendering Clips · Complete · Failed (`src/lib/video-engine/constants.ts:35-43`)

**Stage descriptions and estimates:** "Waiting for the worker" (usually seconds) · "Fetching source media" (1–3 minutes) · "Creating word-level transcript" (1–2 minutes) · "Scoring viral moments" (under 1 minute) · "Producing vertical clips" (2–5 minutes) (`JobStatusPipeline.jsx:6-13`)

**Failure explanations (plain-language, with next step):**
> "YouTube blocked the download. It does this to servers it does not recognise, and it is not something you did wrong." → "Try uploading the video file directly instead of pasting a link."

> "That video has no audio track, so it cannot be transcribed into clips." → "Clipping needs speech to find moments worth cutting."

> "The video service is not configured correctly. This is a problem on our side, not yours." → (no next step)

**A processing advisory:**
> "The processor is asleep — it powers down when idle to keep running costs near zero. Submitting wakes it, which adds about half a minute before processing starts."

**A link-reliability warning shown before submission:**
> "Links can fail — YouTube blocks automated downloads from servers, and when it does there is nothing this app can do about it. Uploading the file always works."

**Zero-clip outcome:**
> "No clips were generated." / "This can happen if the video has no speech or the AI could not identify any compelling moments."

**Caption style names and descriptions:** Karaoke ("Words highlight as spoken") · Bold Drop ("Big bold words drop in") · Box Pop ("Boxed captions pop in") · Classic ("Clean white, black outline") · Color Pop ("Colored emphasis words") · Focus Word ("One key word at a time")

**Aspect ratio labels:** 9:16 ("TikTok · Reels · Shorts") · 4:5 ("Instagram Feed") · 1:1 ("Square") · 16:9 ("Landscape · YouTube") · 3:4 (currently unlabelled — supported by the server, not offered in the interface)

**Scale of real content:** AI titles run short — roughly 3–8 words. AI captions run one to three sentences. "Why this works" runs one to two sentences. Source titles are whatever the source platform provides and can be very long. A typical job produces around seven clips (`src/lib/video-engine/constants.ts:14`); the person may request between one and fifteen.

---

## 7. Constraints that bind, in one place

| Constraint | Value | Source |
|---|---|---|
| Cost | 1 credit per minute of **source** video | `constants.ts:4` |
| Minimum balance to submit | 5 credits | `constants.ts:5`, `credit-packages.ts:50` |
| When charged | After download, once true duration is known | `job_runner.py:51-56` |
| On failure | Credits automatically refunded | `job_runner.py:165,177`; `database.py:207-240` |
| Free credits at signup | 30 | `constants.ts:6` |
| Max source length | 180 minutes | `constants.ts:8` |
| Max upload size | 4 GB | `SubmitForm.jsx:35` |
| Accepted upload formats | MP4, MOV, MKV, WebM, AVI, MPEG | `SubmitForm.jsx:38-41` |
| Accepted link sources | YouTube (watch / youtu.be / Shorts), Twitter/X status | `constants.ts:22-32` |
| Concurrent jobs per person | 2 | `rate-limiter.ts:7` |
| Submissions per hour | 10 | `rate-limiter.ts:50` |
| Target clips per job | ~7 | `constants.ts:14` |
| Requestable clip count | 1–15 | `submit/route.ts:34` |
| Target clip length | 30–90 seconds | `constants.ts:12-13` |
| Requestable clip length | 10–600 seconds each bound, min < max | `submit/route.ts:35-36,41-52` |
| Playback link lifetime | 48 hours, auto-renewed | `constants.ts:23`; `clips/[id]/refresh-url/route.ts` |
| **Clip file lifetime** | **7 days after the job finishes, then permanently deleted** | `video-worker/retention.py:53` |
| Cancellable | Only while still queued | `jobs/[id]/route.ts:15,99-105` |
| Deletion | Permanent; removes the job and all its clip files | `jobs/[id]/route.ts:107-127` |
| Job list depth | 50 most recent, no pagination | `videoEngineData.js:32` |

**The retention constraint deserves its own paragraph, because it is the most serious honesty gap on this surface.** Rendered clips are automatically deleted seven days after their job reaches a terminal state (`video-worker/retention.py:29-53`). This is a deliberate and correct decision — it is what keeps storage cost proportional to recent activity rather than total activity, and the 48-hour signed links already implied that clips were meant to be deliverables rather than an archive. But **the interface never says so.** A person who processes a video, downloads nothing, and returns in ten days finds their clips gone with no prior warning and no explanation. The design must carry this fact: on the results, on the job list, and ideally as a prompt to keep anything worth keeping. This is not a nice-to-have; it is the difference between a documented policy and silent data loss.

---

## 8. What the design must not assume

- **Do not assume the person is watching.** Every long-running state must be reconstructible on arrival, from any device, with no history of what happened while they were away.
- **Do not assume a score exists.** Any of the five scores may be absent, and absent must read as unknown, never as zero.
- **Do not assume a clip plays.** Links expire and are renewed in the background; renewal is a normal event, not an error.
- **Do not assume a job's clips are all in the same condition.** Success is routinely partial.
- **Do not assume clips persist.** They are deliverables with a seven-day life.
- **Do not assume the cost is known up front.** A rate is knowable; a total is not, until the source has been measured.
- **Do not assume the person can afford the action.** One wallet is shared across the whole product, so a Videos action can be blocked by Studio spending.
- **Do not assume "video" means one thing.** See §4.3.

---

## 9. Open decisions this design will surface

These are product decisions, not design ones. They are listed so the design does not silently answer them by accident.

1. Does "Videos" mean clipping, generative video, or both? (§4.3)
2. Is retry a true one-click resubmit, or a prefilled new submission? (§3.1)
3. Does the stitched full-length output ship, or should the pipeline stop producing it? (§3.4)
4. Should a person be able to cancel a job that has started, accepting the wasted work, or is the current queued-only rule correct? (§3.3)
5. Should clip retention be extended, made a paid feature, or kept at seven days and simply made honest? (§7)
6. Should a video already in the Library be re-submittable to clipping? (§4.2)

---
---

# Appendix A — Implementation record

*Not design input.* This section describes the state of the existing code so the implementer knows what is being replaced. It prescribes nothing about the interface and contains no visual recommendation. A designer can stop reading here.

### A.1 The current surface does not share the application's design system

The application has one design system, defined in `src/ui-v2/`, with its own token set (`--uiv2-*`, `src/ui-v2/tokens.css`) and its own themed scope. Dashboard, Studio, Library, Calendar, Brand Kit, Settings, Analytics, Billing, Help, and Onboarding are all built on it.

The Videos surface is not. It uses the outer application chrome from the design system, and then styles all of its own content with a different, older token set (`--color-*`) — via a dedicated stylesheet (`src/components/video-engine/videoEngine.css`, 1,042 lines) and, for the results screen, several hundred inline style declarations.

Measured across `src/components/video-engine/` and `src/pages/VideoEngine/`:

| Token | Times referenced | Times defined anywhere in the repo |
|---|---|---|
| `--color-border-tertiary` | 46 | **0** |
| `--color-background-primary` | 21 | **0** |
| `--color-background-secondary` | 15 | **0** |
| `--border-radius-md` | 9 | **0** |
| `--color-border-primary` | 4 | **0** |
| `--color-background-tertiary` | 1 | **0** |

**96 references resolve to nothing.** No stylesheet in the repository defines any of these six names. Every declaration using one is invalid at computed-value time, which means every one of those backgrounds is transparent and every one of those borders is absent. This is the mechanical reason the Videos screens do not look like the rest of the application: a large part of their intended styling has never rendered.

### A.2 Its colours are driven by a theme signal the app's theme control does not set

There are two independent theme systems live at once:

- The design system themes by stamping `data-uiv2-theme` on a wrapper element, persisted under the `uiv2-theme` key (`src/ui-v2/ThemeProvider.jsx:26-45`). The theme toggle in the application chrome drives this one, and only this one.
- The older token set themes by `:root[data-theme]` (`src/styles/tokens.css:119-120, 195`), set by a separate provider from a separate storage key that defaults to following the operating system (`src/Context/ThemeContext.jsx:54-68`).

The Videos surface's remaining working colours (`--color-text-primary`, `--color-text-secondary`, `--color-danger`, and the score colours) come from the second system. So toggling the app's theme changes the chrome and does not change the Videos content, and a person on a light-mode OS who chooses dark in the app gets near-black body text on a dark background.

### A.3 A permanently-false advisory

`useWorkerHealth` polls `/api/video/health` every 30 seconds and treats any non-OK response as "the processor is asleep" (`src/hooks/video-engine/useWorkerHealth.js:14-19`).

**That route does not exist.** `app/api/video/` contains `clips/[id]/refresh-url`, `jobs`, `jobs/[id]`, `submit`, and `upload-ticket`, and there is no rewrite. Every poll 404s, so the hook resolves to `unhealthy` permanently, so the submission screen shows the "processor is asleep, this will add about half a minute" advisory **on every visit regardless of actual worker state**. The message is well-written and the underlying fact is real; the signal behind it is not.

### A.4 A pipeline state with no interface representation

The worker sets job status to `stitching` between rendering and completion (`video-worker/job_runner.py:116`).

- The migration-tracked check constraint on `video_jobs.status` permits only `queued, downloading, transcribing, analyzing, rendering, complete, failed` (`supabase/migrations/20260710190000_baseline_video_engine_tables.sql:24-27`), and no later migration adds `stitching`.
- The interface's status vocabulary does not include it either (`src/lib/video-engine/constants.ts:35-51`), and the job-detail screen routes anything outside its known sets to an "unknown job state" dead end (`src/components/video-engine/JobDetailView.jsx:36-44`).

So either the status write is rejected by the constraint and the worker logs a failure while the job appears stuck at "rendering", or the live schema has drifted to accept it and jobs briefly land on a dead-end screen. **Which of the two is happening has not been verified** — per the project's standing rule, the live schema is known to differ from migrations and must be checked directly rather than inferred. Either way the interface has no representation for the state.

### A.5 Backend capability with no interface

- **Stitched output.** Produced on every successful job, stored on the job row, referenced by zero interface code. (`stages/stitch.py`; `video_jobs.stitched_output_url`)
- **Per-clip transcript excerpt.** Stored on every clip, referenced by zero interface code. (`video_clips.transcript_excerpt`)
- **Clip source timestamps.** Stored on every clip; referenced only inside a component that nothing imports. (`video_clips.start_time_secs / end_time_secs`)
- **A fifth aspect ratio.** Accepted by the server, not offered by the interface. (`submit/route.ts:31` vs `AspectRatioPicker.jsx:3-8`)
- **Credits consumed and processing timestamps.** Stored per job, shown nowhere.

### A.6 Client and server disagree on limits

The clip-count field accepts and advertises 1–20 (`ClipSettingsPanel.jsx:151-159`); the server rejects anything above 15 (`submit/route.ts:34`). A person entering 16 is accepted by the form and refused by the submission with a raw validation string.

The clip-duration fields set a floor of 15 seconds (`ClipSettingsPanel.jsx:165,175`); the server's floor is 10 (`submit/route.ts:35-36`).

### A.7 Live state on the list

The job-detail screen has a live subscription plus polling (`useJobRealtime.js`). The job list has neither — one fetch on mount, no refresh (`VideoJobsPage.jsx:19-31`). The list is the surface's landing screen.

### A.8 Delete misreports a permanent refusal as a transient error

The server refuses deletion of an actively-processing job with a 409 and a specific explanation (`jobs/[id]/route.ts:99-105`). The client renders any failure as `"Could not delete. Try again."` (`JobCard.jsx:31`), which is wrong on both counts.

### A.9 Unreferenced code in this surface

- `src/pages/VideoEngine/VideoEngineLab.jsx` (274 lines) and `VideoEngineLab.css` (367 lines) — imported by nothing.
- `src/components/video-engine/ClipCard.jsx` (128 lines) — imported by nothing.
- `src/components/video-engine/ClipPreviewModal.jsx` (99 lines) — imported only by `ClipCard`, which is itself unreachable.
- `src/hooks/video-engine/useClipDownload.js` — used only by `ClipCard`.

Roughly 870 unreachable lines. Worth confirming against the intended rebuild before deleting — some of it may be the nearest thing to a prior attempt at what is being redesigned.

### A.10 Live routes serving placeholder text

`app/(video-engine)/video/jobs/page.tsx`, `app/(video-engine)/video/new/page.tsx`, and `app/(video-engine)/video/jobs/[id]/page.tsx` are real, reachable routes at `/video/jobs`, `/video/new`, and `/video/jobs/{id}`. Each renders a single line of text: `"Jobs Page - Coming Stage 8"`, `"Submit Page - Coming Stage 8"`, `"Job Detail - Coming Stage 8"`. They shadow the real routes at `/app/video/...` by one path segment, are outside the authenticated layout, and have no chrome.

### A.11 Responsiveness

The results screen carries no responsive handling of any kind — no breakpoints, no viewport query, no conditional behaviour (verified: zero `@media`, `matchMedia`, or width checks across `src/components/video-engine/*.jsx`). Its sizing is fixed in absolute and percentage terms inside a container given a fixed viewport-derived height. The one stylesheet breakpoint in the surface covers the list and submission screens only (`videoEngine.css:909`). Given the project's mobile-first standing rule, the results screen has effectively never been designed for a phone.

---

# Appendix B — Personal workspace: consistency and blocked flows

*Not design input for the Videos page.* A record of what else in the personal workspace does not match, and where flows are obstructed. Organisation and platform-admin surfaces are out of scope.

### B.1 Design-system status, by route

Measured by which token set each screen's own code uses.

**On the design system:**

| Route | Screen |
|---|---|
| `/app/dashboard` | Personal Dashboard |
| `/app/generate` | Studio |
| `/app/library` | Content Library |
| `/app/calendar` | Calendar |
| `/app/analytics` | Analytics |
| `/app/billing` | Billing & credits |
| `/app/settings/brand-kit` | Brand Kit |
| `/app/settings/connect` | Connect account |
| `/app/help` | Help |
| `/app/onboarding` | Onboarding |

**Not on the design system:**

| Route | Screen | What it uses instead |
|---|---|---|
| `/app/video/jobs` | Job list | `ve-*` stylesheet on the older token set |
| `/app/video/new` | Submission | same |
| `/app/video/jobs/{id}` | Progress and results | same, plus several hundred inline declarations; 96 of its token references are undefined (A.1) |
| `/app/billing/credits` | A second credits screen | same |
| `/app/design` | An internal design-reference page | its own stylesheet on the older token set |

**Partial:**

| Route | Screen | Note |
|---|---|---|
| `/app/settings` | Settings | Its stylesheet mixes both systems and bridges some old names onto new ones (`src/pages/Settings.module.css:30`). It renders consistently; it is just not cleanly on one system. |
| `/app/calendar` | Calendar | The page and its main stylesheet are on the design system (547 v2 token references). Eight of its child components still reference a handful of old token names each — small, but they are the kind of stray that drifts. |

### B.2 Duplicate and unreachable surfaces

1. **Two credits screens for one wallet.** `/app/billing` shows balance, spend-by-category, packages, and ledger, on the design system. `/app/billing/credits` shows balance, packages, and ledger, on the old one. Same wallet, same packages, same purchase path. The second is linked only from a profile menu used exclusively by the admin console (`src/components/User/ProfileMenu.jsx:68` — the only importers of that component are under `src/admin/`), so from the personal workspace it is unreachable except by typing the URL. It also declares itself active against a navigation key that does not exist (`CreditsPage.jsx:47` vs `navItems.js:27-35`).
2. **Two "video jobs" systems sharing a name, cross-wired.** Detailed at §4.3.
3. **Three placeholder routes** shadowing the real Videos routes. Detailed at A.10.
4. **An internal design-reference page** shipped at `/app/design`.

### B.3 Obstructed flows

1. **Dashboard counts clips and cannot reach them.** "Clips ready" is one of four headline numbers and is inert; the stat component takes no action, and nothing else on the Dashboard links to Videos (§4.2).
2. **A running job is invisible outside its own screen.** No Dashboard presence, no shell indicator, no notification on completion — on a feature explicitly built to be left alone.
3. **The job list does not update.** Submit, return to the list, and it reads "In Queue" until manually reloaded (A.7).
4. **Nothing warns before clips are deleted.** Seven-day retention, never mentioned (§7).
5. **Caption styles are chosen blind.** Six burned-in treatments, no preview, credits spent to find out.
6. **A large upload gives no progress.** Up to 4 GB behind a single word, no percentage, no cancel.
7. **A running job cannot be stopped, and says the wrong thing when asked.** (A.8)
8. **Clipping is undocumented in Help** and absent from Analytics (§4.2).
9. **A Library video cannot be sent to clipping**, despite upload being a first-class ingestion path.
10. **The Studio's generative-video empty state routes to the clipping form** (§4.3).
11. **The job list has no search, filter, or sort**, and stops at 50.
12. **Client and server disagree on clip-count limits**, so a valid-looking entry is refused after the fact (A.6).
