# 12 — Publishing Journey: gap register and build plan

**Audited:** 2026-09-11 · **Branch:** `feat/direct-social-publishing`
**Scope:** personal surfaces only — Studio, Library, Calendar, Dashboard, Video Jobs.
Org Calendar, org asset library and the ClientReview pipeline are out of scope.
**Visual map:** https://claude.ai/code/artifact/3375cfe6-aea5-45d9-8100-11010a2f272a

**Method.** Every claim below carries a `file:line` from the working tree. Claims
about the **live database** are marked `UNVERIFIED` and are not asserted — the
live schema is known to be drifted from migrations, so a migration's presence is
evidence of intent, never of installed state.

---

## 0a. PHASE 0 RESULTS — live database, 2026-09-12 · corrections to this document

Phase 0 was executed against the live database (read-only, via the session
pooler). **It refuted three findings in this document.** They are corrected
below, and left visible rather than quietly rewritten.

### What was wrong

| Gap | Claimed | Live reality |
|---|---|---|
| **G3** | "No reaper exists." | **WRONG.** `reap-stuck-records` is cron job #9, `*/5 * * * *`, active, **6,094 successful runs**. Defined in `supabase/migrations/20260821160000_reap_stuck_records.sql` — which I failed to search for by name. |
| **G4** | "The scheduler may not be installed." | **REFUTED.** `process-scheduled-posts` is cron job #4, `* * * * *`, active, **91,362 successful runs**, last 2026-09-12T00:49. `pg_cron` 1.6.4 and `pg_net` 0.19.5 installed; both worker functions exist. |
| **G5** | "Auth mismatch stops dispatch." | **UNPROVEN, probably wrong.** `net._http_response` holds 397 rows and 11 posts are `published`. Requests reach `publish-post`. My GUC reading was config-reading rather than behaviour — the repo's own standard, and I broke it. |
| **G7** | "Nothing refuses a media-less post." | **PARTLY WRONG.** The YouTube adapter *does* refuse, with a clear message: *"YouTube requires a video. This post has no media attached."* That is correct behaviour. The defect is **upstream**: posts are created with no media at all. |

The `0/5` columns finding **was** correct — `platform_post_id`,
`platform_post_url`, `failure_reason`, `consecutive_failure_count` and
`last_failure_at` are all absent. The migration's functions and cron
registration ran; its trailing `ALTER TABLE` did not. A partial apply, and
cosmetic rather than blocking.

### What Phase 0 proved instead — the real defect, with a timestamp

```
post 7bba182a   platform=youtube
  generation_id IS NULL ......... TRUE
  account_id IS NULL ............ false
  workflow_state.youtube ........ present
  created 2026-09-11T14:50:28     failed 2026-09-11T14:50:42
  error: "YouTube requires a video. This post has no media attached."
```

Created and failed **14 seconds apart** — a manual publish, not a scheduled one.
It carried YouTube options and a chosen account. What it never carried was media.

This is systemic, not a one-off:

| `posts.status` | total | **without `generation_id`** |
|---|---|---|
| draft | 128 | **83  (65%)** |
| failed | 63 | **48  (76%)** |
| published | 11 | 3 |
| scheduled | 1 | 0 |

And for video specifically:

```
video_clips WHERE render_status = 'complete' .................. 5
generations WHERE metadata->>'storage_bucket' = 'video-clips' .. 1
```

**Four of five rendered clips have never become publishable.** G1 confirmed in
production.

### Historical failures, explained

- **40 ×** *"No active connected account could be matched for this scheduled
  post"* — last 2026-08-06. The account-matching join in
  `process_scheduled_posts` failing outright; related to G12.
- **20 ×** *"Publishing timed out — left mid-publish, failed automatically"* —
  all stamped 2026-08-21T20:55:30. This is the **reaper's first run** clearing
  the 20 historically-stuck posts its own migration documents. Resolved, and
  positive evidence the reaper works.
- **19** failed cron runs of `process-scheduled-posts`, last 2026-09-11T14:48 —
  two minutes before the YouTube failure above. Worth investigating; not yet
  explained.

### Revised priority

Phase 3 (scheduler resilience) **drops sharply** — scheduler and reaper both
work. Phase 1 (reconnect what exists) and Phase 2 (media integrity) are now the
whole story, with G13 below as the top item.

### G13 — Posts are created without media · **BLOCKER** · confirmed live

65% of drafts and 76% of failed posts have `generation_id IS NULL`. The
auto-draft trigger always sets it
(`supabase/migrations/20260227103000_generation_post_unification_and_rls.sql:85-125`),
so these rows come from **other** creation paths that never link the asset. This
is the direct cause of the reported symptom and of the 2026-09-11 failure above.

### G13a — ENUMERATION COMPLETE (2026-09-12)

Every `posts` insert site in personal scope, checked for `generation_id`:

| # | Site | Triggered by | Sets it? | Verdict |
|---|---|---|---|---|
| 1 | `ensure_draft_post_for_generation()` trigger | any generation completes | **always** | safe |
| 2 | `src/stores/SessionStore.js:3682,3836,3949,3989` | Studio save-draft / approve / publish | **always** (`selectedGeneration.id`) | safe |
| 3 | `app/api/video/clips/[id]/publish/route.ts:212` | — | **always** | safe but **unreachable** (G1) |
| 4 | `src/calendar/services/calendarService.js:443` | Calendar **Quick Post** | **conditional** — `asset?.generation_id \|\| null` (`:395`) | **DROP POINT A** |
| 5 | `src/pages/Calendar/CalendarPage.jsx:480` | "create draft" on an empty day | **never** | **DROP POINT D** |
| 6 | `src/pages/Calendar/CalendarPage.jsx:701` | apply AI content plan | `item?.draftId \|\| null` | **DROP POINT E** |
| 7 | `src/pages/Calendar/CalendarPage.jsx:453` | duplicate a post | inherits `post.generation_id \|\| null` | propagates only |

**The Studio path is clean.** Every Studio insert carries the link. The losses
are all in the **Calendar**.

#### Drop point A — Quick Post lets you publish with no media
`QuickPostComposer.jsx:289` labels the picker *"Library asset (optional)"*. The
submit guard is
`disabled={isSubmitting || activePlatforms.length === 0 || youtubeNeedsAudience}`
(`:468`) — it validates platform selection and the made-for-kids answer, and
**never checks that media exists**, even when the selected platform mandates
video. Draft submission (`:463`) is guarded only by `isSubmitting`.

**This is the 2026-09-11 failure.** That post carried `workflow_state.youtube`,
and `calendarService.js:425-436` is the only code that writes that key — so it
came from Quick Post.

#### Drop point B — the asset picker is usually empty
`CalendarPage.jsx:1001`: `libraryAssets={prefillAsset ? [prefillAsset] : []}`.
`prefillAsset` is populated **only** from a `?prefillAssetId=` URL parameter
(`:195-215`). Open Quick Post directly from the Calendar and the picker contains
**nothing** — media cannot be attached at all, whatever the user intends.

#### Drop point C — uploaded assets have no `generation_id`
`fetchAssetForHandoff` → `fetchPersonalAssetById`
(`src/services/assetLibraryService.js:245-247`) reads `personal_assets`, where
`source='upload'` rows have `generation_id = NULL` by schema
(`20260625100000_personal_assets_table.sql:41`). So even the Library→Calendar
handoff silently yields null media for anything **uploaded** rather than
generated. This is G10 made concrete: the Library shows assets the publisher
cannot reach.

#### Drop point D — empty day-drafts
`CalendarPage.jsx:480` creates a post with no platform, no media, empty caption.
Deliberate empty shells; likely a large share of the 83 media-less drafts.

#### Drop point E — type confusion in the AI content plan
`CalendarPage.jsx:701` assigns `generation_id: item?.draftId || null`. A
`draftId` is not a `generations.id`. Either the FK rejects the row or the value
is null — neither is the intended behaviour. **Needs a decision, not just a fix.**

### The fix, in priority order

1. **Block the submit.** Quick Post must refuse when a selected platform requires
   media and none is attached — the single change that would have prevented the
   2026-09-11 failure.
2. **Populate the picker.** Feed `libraryAssets` from the Library instead of only
   a URL prefill.
3. **Give uploads a media identity** the publisher can resolve (the G10 decision).
4. Resolve the `draftId` confusion at `CalendarPage.jsx:701`.

---

## 0. Why this audit exists

Reported symptom: *"the media file that I generate and want to post gets dropped
along the way, such that when I'm getting to the point of posting, the file is
nowhere to be found."*

That symptom has three distinct causes with three distinct fixes — G1, G7 and G2
below. **G1 is almost certainly the one actually experienced.**

---

## 1. The media contract

A post carries **exactly one** link to its media:

```sql
generation_id uuid REFERENCES public.generations(id) ON DELETE SET NULL
```
`supabase/migrations/20260710090000_baseline_core_tables.sql:170`

The publisher resolves the real file by joining through it
(`supabase/functions/publish-post/index.ts:81-88`) and then either uses a durable
`output_url` or mints a **fresh short-lived signed URL** from `storage_path` +
`metadata.storage_bucket` seconds before upload
(`supabase/functions/publish-post/index.ts:140-195`).

**That resolution logic is correct and should not be changed.** Minting on demand
rather than storing a signed URL is exactly right for posts scheduled weeks out.
Everything wrong with media in this product is upstream of it.

Three consequences of the contract as written:

| Property | Consequence |
|---|---|
| Single FK | One post = one media asset. No carousel, no multi-image, **no separate thumbnail asset**. |
| Nullable | Nothing requires a post to have media, on any platform. |
| `ON DELETE SET NULL` | A post **outlives its own file**. Deleting a generation silently empties a scheduled post, which then still publishes. |

`posts.platform` is likewise a single text column
(`...baseline_core_tables.sql:175`) — one post = one platform, so a five-platform
publish is five rows. There are **no per-platform metadata columns**; per-post
platform settings live under `workflow_state.<provider>` jsonb, read at
`supabase/functions/publish-post/index.ts:254-262`.

---

## 2. Gap register

Severity reflects user-visible consequence, not effort.

### G1 — A rendered clip cannot reach a post · **BLOCKER**

`app/api/video/clips/[id]/publish/route.ts` converts a `video_clips` row into a
publishable `generations` row. It is well built: it deliberately stores the
storage **path plus bucket** rather than a signed URL, precisely so a
far-scheduled post cannot carry a dead signature. Its own header states clips were
previously *"unpublishable, not by a bug, but because the link was never built."*

**Nothing calls it.** `src/services/videoEngineApi.js:3-235` exports
`submitVideoJob`, `requestUploadTicket`, `refreshClipUrl`, `deleteVideoJob`,
`rerunVideoJob`, `fetchJobsPage`, `downloadAuthedFile`, `downloadJobArchive`,
`downloadJobTranscript`, `uploadSourceToWorker` — and **no publish function**. No
file under `src/` references the route.

**Effect:** every video this product renders is unpublishable. From the Video Jobs
panel a finished clip can be downloaded, and nothing else. *This is the reported
bug.*

**Fix:** add the API client function and the panel action. The backend is done.

---

### G2 — Per-platform options exist, on the wrong path · **BLOCKER**

`src/components/Publishing/` contains real, complete `TikTokOptionsPanel.jsx` and
`YouTubeOptionsPanel.jsx`. The YouTube panel collects `made_for_kids`,
`privacy_status`, `category_id` and a synthetic-media disclosure
(`src/components/Publishing/YouTubeOptionsPanel.jsx:80-95`) and refuses to
proceed while made-for-kids is unanswered (`:85`).

They are imported by exactly one production component:
`src/components/Generate/PostProductionPanel.jsx:19-20` — which is the **org**
composer, used by `src/org/components/OrgGenerateComposer.jsx:10`.

The **personal** Studio panel, `src/pages/Studio/PostProductionPanel.jsx`, imports
neither; its imports at `:3-8` are only `PlatformFitStrip` and
`platformCaptionSpecs`. It collects caption, title, hashtags and an account.

**Effect, per platform:**
- **TikTok** — the adapter refuses to publish without a privacy level chosen by
  the user (`supabase/functions/publish-post/index.ts:271-278`). This is
  *correct* behaviour; but from Studio the field can never be filled, so the
  route always fails.
- **YouTube** — the adapter defaults `privacyStatus` to `private` and says so
  (`...index.ts:264-268`). The upload succeeds, the UI reports success, and the
  video is invisible. **This is the most dangerous outcome of the three, because
  nothing looks wrong.**

**Fix:** render the existing panels in the personal Studio panel, conditioned on
selected platform. No new components.

---

### G3 — `publishing` is a one-way door · **BLOCKER**

`supabase/migrations/20260601000000_scheduled_publish_worker.sql`:

- `:91-99` sets `status = 'publishing'` **before** dispatching.
- `:33-44` dispatches via `net.http_post` — fire and forget, result never read.
- `:86` the worker's own query selects only `status = 'scheduled'`.

A failed dispatch therefore strands the post in a state the worker can never
select again. **No reaper exists.** This matches the historical pattern recorded
elsewhere in `audit/` of posts freezing for months undetected.

**Fix:** make `publishing` a lease — claim with an expiry, reap anything past it
back to `scheduled`.

---

### G4 — The scheduler may not be installed · **BLOCKER** · needs live check

`supabase/migrations/20260710090000_baseline_core_tables.sql:206-212` records
that `platform_post_id`, `platform_post_url`, `failure_reason`,
`consecutive_failure_count` and `last_failure_at` — all added by
`20260601000000_scheduled_publish_worker.sql` — **do not exist on the live
table**; that migration's `ALTER TABLE` statements never ran.

The `cron.schedule('process-scheduled-posts', ...)` call is in the same file
(`:129-133`). If the ALTERs never ran, the cron registration very likely never ran
either.

**Status: UNVERIFIED.** This is the single highest-value question in this audit
and is answerable with one query. If the cron is absent, **no scheduled post has
ever published**, and G3/G5 are moot until it exists.

---

### G5 — Scheduler and publisher disagree about authentication · **BLOCKER**

`dispatch_scheduled_post` sends only
`'Authorization', 'Bearer ' || v_service_key`
(`...scheduled_publish_worker.sql:35-38`).

`publish-post` identifies a machine caller via `presentsInvokeSecret(req)` — a
shared invoke-secret header (`supabase/functions/publish-post/index.ts:41-43`) —
and otherwise falls through to `createAuthClient(...)` + `requireUser()`
(`:56-58`). The SQL never sends that header.

The comment at `index.ts:38-40` states this change *"only changes what a MACHINE
must show, which is the half that had been failing"* — the publisher was fixed;
the SQL dispatcher was not updated to match.

Compounding: the URL comes from `current_setting('app.supabase_url', true)`
(`:25-26`). The `true` argument means **NULL is returned silently** if the GUC is
unset, producing a NULL URL and a silent no-op.

---

### G6 — Instagram and Facebook have no adapter · **BLOCKER**

`supabase/functions/publish-post/index.ts:234-241` routes `linkedin`, `tiktok`
and `youtube` to direct adapters. Everything else — including Meta — falls to
`publishToZernio` at `:283-284`, the vendor this project moved off.

Both platforms connect cleanly: `app/api/_lib/socialProviders.js:36-37` maps
`facebook` and `instagram` to the `meta` provider, and `:59-71` requests
`instagram_basic` and `instagram_content_publish`.

**Effect:** the account connects, shows as ready, and cannot publish. Instagram's
real API requires a create-container-then-publish two-step that nothing in this
repo implements.

**Interim fix, same-day, independent of the adapters:** mark both as
not-publishable in the UI so a connected account never misrepresents itself.

---

### G7 — Nothing refuses a media-less post · **MAJOR**

If `generation_id` is null — or was nulled by `ON DELETE SET NULL` — `mediaUrl`
resolves to null (`supabase/functions/publish-post/index.ts:140-195`; the
sign-failure branch at `:184-190` logs and continues) and the publish proceeds.
No platform branch refuses on null media.

**Effect:** a post can publish as text-only to a platform where media is
mandatory, or fail with a platform error that names nothing useful.

---

### G8 — No preflight validation · **MAJOR**

`src/pages/Studio/PostProductionPanel.jsx:107-120` computes `overLimitPlatforms`
against per-platform caption caps and blocks publish on overrun — good, and the
only validation that exists.

Not checked anywhere: video duration, aspect ratio, file size, missing thumbnail,
missing mandatory disclosures, media present at all.

**Effect:** the first time a user learns a video is too long for a platform is
when the platform rejects it.

---

### G9 — One media slot per post · **MAJOR**

Direct consequence of the single FK (`...baseline_core_tables.sql:170`).
YouTube custom thumbnails and Instagram carousels are unreachable **by schema**,
not by code. Any per-platform composer work will hit this ceiling.

---

### G10 — Three asset models, read by different surfaces · **MAJOR**

`generations`, `content_library_items` (trigger-maintained, older) and
`personal_assets` coexist. The `personal_assets` migration header states
explicitly that it runs *"ALONGSIDE the existing, untouched
ensureLibraryRowsForPosts() ... never calling, modifying, or replacing them"*
(`supabase/migrations/20260625100000_personal_assets_table.sql:11-20`), with its
own `generation_id` and `post_id` at `:41-42`.

The publisher reads only `generations`. A Library surface reading a different
model can show the user an item the publisher cannot reach.

---

### G11 — Retry is counted, not performed · **MAJOR**

`MAX_RETRIES = 3` at `supabase/functions/publish-post/index.ts:36`; the counter is
tracked under `workflow_state.publish.retry_count` (header comment, `:15-16`).
No re-queue mechanism was found. The number increments; nothing re-invokes.

---

### G12 — Publish can target an unchosen account · **MINOR**

`...scheduled_publish_worker.sql:76-83`: when `p.account_id IS NULL`, the worker
joins **any** active account matching `ca.platform = p.platform`. With two
connected accounts on one platform, which receives the post is arbitrary.

---

## 3. Also noted, not gaps

- **The auto-draft trigger.** `ensure_draft_post_for_generation()` creates a draft
  post for every completed generation, with `caption = generation.prompt`
  (`supabase/migrations/20260227103000_generation_post_unification_and_rls.sql:85-125`).
  Working as designed, but drafts therefore arrive captioned with raw prompt text.
- **Dispatch ignores `can_publish`.** `publish-post` routes by provider alone and
  does not consult `connected_accounts_health_summary` — stated outright at
  `supabase/functions/publish-post/index.ts:228-232`. The registry must be kept
  honest by hand.
- **The frontend's only publish caller is `mockPublishService.js`.** Despite the
  name it invokes the real `publish-post`
  (`src/services/platforms/mockPublishService.js:32`, via
  `mockPublishWorkflow.js:86`). Naming only — but it makes the real publish path
  hard to find.
- **TikTok sound selection is not possible via API.** The Content Posting API has
  no track parameter; commercial sounds are applied in-app. The product answer is
  draft-to-app, which unaudited clients are limited to regardless.

---

## 4. Build plan

Ordered so each phase makes the next provable. Phases 1 and 2 have no dependency
on each other and can run in parallel.

### Phase 0 — Establish whether the scheduler runs · hours
Query `cron.job` on the live DB for `process-scheduled-posts`; check the
`app.supabase_url` / `app.service_role_key` GUCs; count posts in `publishing`.
**Closes G4**, and determines whether Phase 3 is a repair or a build.

### Phase 1 — Stop losing media, and reconnect what exists

Ordered within the phase. **1.1 is the smallest change that would have prevented
the 2026-09-11 failure** and is the reason this phase leads.

**1.1 — Block a media-less publish at the composer.** Quick Post must refuse
submit when a selected platform requires media and none is attached. Today the
guard at `QuickPostComposer.jsx:468` checks platform selection and the
made-for-kids answer and nothing else. Media requirement is per platform, so the
check reads from a platform capability source rather than a hardcoded list —
see the capability-registry question in G-notes. **Closes G13 drop point A.**

**1.2 — Make the asset picker usable.** `CalendarPage.jsx:1001` feeds
`libraryAssets` only from a `?prefillAssetId=` URL parameter, so opening Quick
Post from the Calendar shows an empty picker. Feed it from the Library.
Without this, 1.1 turns a silent failure into a dead end — **1.1 and 1.2 ship
together or not at all.** **Closes G13 drop point B.**

**1.3 — Wire the clip bridge.** Add the `videoEngineApi` publish function and a
publish / send-to-library action in the Video Jobs panel, calling the existing
`app/api/video/clips/[id]/publish/route.ts`. **Closes G1.** Backend is done.

**1.4 — Render the per-platform panels on the personal path.** Import the
existing `TikTokOptionsPanel` and `YouTubeOptionsPanel` into
`src/pages/Studio/PostProductionPanel.jsx`, conditioned on selected platform.
**Closes G2.** Components are built; only the import is missing.

**1.5 — Resolve the `draftId` confusion.** `CalendarPage.jsx:701` assigns
`generation_id: item?.draftId || null`. Decide what the AI content plan is
meant to attach, then make it do that. **Closes G13 drop point E.**

Deferred out of this phase: **drop point C** (uploaded assets carry no
`generation_id`) depends on the canonical-asset-model decision and stays in
Phase 2 with G10.

Nothing in 1.3 or 1.4 is newly designed — both are built and unwired.

### Phase 2 — Make media loss impossible rather than unlikely · schema + guard
- Refuse at publish when a media-mandatory platform has a null `mediaUrl`, with a
  reason naming the post. **Closes G7.**
- Move to ordered media plus a thumbnail slot, and stop `ON DELETE SET NULL`
  quietly emptying a scheduled post. **Closes G9**; unblocks carousels and
  YouTube thumbnails.
- Pick the canonical asset model; make Library read what the publisher reads.
  **Closes G10.**

### Phase 3 — Make the scheduler survive its own failures
- Send the invoke secret from the SQL dispatcher. **Closes G5.**
- Convert `publishing` to a lease with a reaper. **Closes G3.**
- Make retry re-queue with backoff; pin the account at schedule time.
  **Closes G11, G12.**

### Phase 4 — The composer
- Shared base caption + a tab per selected platform carrying only that platform's
  real fields; media pinned and visible throughout.
- Per-platform preflight badges — duration, aspect, caption cap, disclosures,
  media present — blocking publish while any is red. **Closes G8.**
- A Needs-attention queue surfacing failed and stranded posts with the platform's
  own reason and one-click retry.

### Phase 5 — Meta
- Real Instagram (container → publish; feed, reel, story) and Facebook (Page,
  correct endpoint per media type) adapters. **Closes G6.**
- Ship the UI not-publishable marking first — it does not wait for the adapters.

---

## 5. Guards required (Law 1: fixed + proven + guarded)

No phase above is complete without its detector. Minimum set:

| Guard | Catches | Phase |
|---|---|---|
| **Assert no composer can submit a post for a media-mandatory platform with a null media link** | **G13-A regression — the reported bug** | **1** |
| Assert the Quick Post asset picker is non-empty when the Library has assets | G13-B regression | 1 |
| Query: count posts created in the last 24h with `generation_id IS NULL` on a media-mandatory platform — alert above zero | G13 at large, in production | 1 |
| Unreferenced-route check — every `app/api/**/route.ts` has ≥1 caller in `src/` | The G1 class: built-but-unwired | 1 |
| Assert each platform's required fields are collected by every composer that can select it | G2 regression | 1 |
| Alert on any post in `publishing` older than its lease | G3 | 3 |
| Alert on `cron.job` missing `process-scheduled-posts` | G4 | 0 |
| Reject at publish when media is null on a media-mandatory platform | G7 | 2 |
| Alert on any provider fallback firing (Zernio) | G6 | 5 |

The first of these is Gate 3 in `11-lockdown-plan.md`, still open. **G1 is exactly
the defect it was specified to catch** — which is itself evidence for building it.
