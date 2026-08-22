# P4 — VIDEO GENERATION: pipeline narrative

**Agent:** A5 (video-pipeline-specialist) · **Date:** 2026-08-21
**Findings file:** `audit/findings/A5-P4.yaml` (20 findings, P4-001 … P4-020)
**Scope:** generation. `video-worker/stages/*` clipping logic belongs to A6 and is not audited here.

---

## 0. Verdict

**Pillar maturity: L1.**

Not L2, because L2 requires a working demo case, and the shipping generative path has
never produced a single video in the product's entire history. The clip-repurposing half
reaches L2 in isolation, but it has been silent for seven weeks and last succeeded two
months ago.

The founder has confirmed P4 is a launch surface that must reach L3+. It is currently two
pillars below that, and the gap is not polish — it is that the primary path has never
worked once.

---

## 1. The first thing to understand: P4 is two products

This is the single most important structural fact, and it reframes every other finding.

| | **A — Generative** | **B — "Video Engine"** |
|---|---|---|
| What it does | prompt (+image) → new video | YouTube/Twitter URL → clips cut from it |
| Category | Runway / Kling / Veo | Opus Clip / Vizard |
| Entry point | Studio (`startVideoGeneration`) | sidebar "Video Lab" → `/app/video/jobs` |
| Backend | `supabase/functions/generateVideo` | `app/api/video/submit` → Python worker |
| Provider | fal.ai | yt-dlp + Whisper + Claude |
| Queue | `background_jobs` | `video_jobs` |
| Output | `generations` (media_type='video') | `video_clips` |
| Storage | `generated_assets` — **public, permanent** | `video-clips` — **private, 48h signed** |
| Credits | atomic `reserveCredits` RPC | non-atomic Python read-modify-write |
| Cancel | works (`cancel-video-job`) | impossible after 'queued' |

**They share no code.** Not a table, not a queue, not a credit function, not a storage
model, not a cancel semantic. Two teams' worth of divergent engineering standards living
under one noun (P4-001).

The core question was "does this system generate video, at what cost/quality/latency/
reliability versus Runway/Kling/Veo-class tools?" Only column A is that comparison. Column
B is a different product answering a different question, and it is the one the navigation
actually points at.

---

## 2. THE MOCK QUESTION — answered unambiguously

Three flags were named. Here is every read of each, repo-wide (P4-004).

| Flag | Code reads | Default when unset |
|---|---|---|
| `VIDEO_ENGINE_USE_MOCK_ANTHROPIC` | **zero** | irrelevant — nothing reads it |
| `VIDEO_ENGINE_USE_MOCK_REPLICATE` | **zero** | irrelevant — nothing reads it |
| `VIDEO_ENGINE_USE_MOCK_PAYMENTS` | one (`app/api/credits/purchase/route.ts:20`) | **REAL payments** |

Two of the three flags are decoration. They sit in `.env.example:72-73` and `.env.local:36-37`
with the comment "set to false in production", and **no line of code anywhere in the repo
ever reads them**. This was confirmed by an exhaustive grep with no path exclusions at all
(`--include=*`, including `node_modules/` and the `.next/` build output): 30 hits total, of
which the only non-doc, non-env, non-build-artifact files are the two
`credits/purchase/route.ts` copies — i.e. `_PAYMENTS` only. Setting `_ANTHROPIC` or
`_REPLICATE` to `false` for production changes nothing; leaving them `true` protects nothing.

**The flags that actually gate mocking have different names**, and live in the Python
worker (`video-worker/config.py:21-22`):

```python
use_mock_anthropic: bool = Field(default=True,  alias="WORKER_USE_MOCK_ANTHROPIC")
use_mock_replicate: bool = Field(default=True,  alias="WORKER_USE_MOCK_REPLICATE")
```

`default=True`. **The default is MOCK.** This is the answer to the question, and it is the
dangerous direction to fail. `WORKER_USE_MOCK_REPLICATE` is never read either — so of four
flags, exactly one (`..._PAYMENTS`) does anything, and one (`WORKER_USE_MOCK_ANTHROPIC`)
silently controls whether the product's AI is real.

When it is on, `video-worker/utils/llm_client.py:123-131` returns canned clip JSON:

```
hook_score 0.78, content_score 0.76, overall_score 0.76,
start_time_secs 180.0, end_time_secs 240.0
```

Fixed scores, fixed timestamps. The downstream stages then really cut, really render,
really upload and really charge credits — at a hardcoded 180s–240s window, regardless of
the video. Nothing marks the row as mocked. A Railway deploy that omits the variable
(which is exactly what happens if someone copies `.env.local`'s differently-named
`VIDEO_ENGINE_*` flags) ships fabricated analysis as product output, invisibly.

**Is real generation happening, or is output canned?** For the generative path: real calls
are attempted, and they have never succeeded. For the clip path: real work happens, but
whether the *analysis* is real depends on an env var whose default is fake and whose
production value is unverifiable from the repo.

---

## 3. Provider reality, settled by live data

`replicate` is in `package.json:51`. `REPLICATE_API_TOKEN` is in `.env.local:20` — and
empty. `video-worker/config.py:20,22` declare a Replicate token and mock flag.
`docs/TECHNICAL_CONSTRAINTS.md:166` describes a Replicate video path.

**Nothing calls Replicate.** Greps for `from 'replicate'`, `require('replicate')` and
`api.replicate.com` return zero hits across `src/`, `app/` and `supabase/`. In the worker,
`config.replicate_api_token` and `config.use_mock_replicate` are declared and read nowhere
— their only occurrences are their own declarations. `docs/video-engine/api-keys-and-mocks.md:60`
explains why: enabling it still requires "replacing the WhisperX model version placeholder".
It was never finished (P4-005).

**The only generative provider is fal.ai**, via `FAL_API_KEY` read from Supabase secrets
(`fal.service.ts:95-99`). `FAL_API_KEY`'s absence from `.env.local` is expected, not a
defect — `generateVideo` is an edge function.

### What the live database says

`generations WHERE media_type='video'` — **32 rows, the product's entire history:**

| Rows | Date | Status | What is actually in `storage_path` |
|---|---|---|---|
| 17 | 2025-11-22 → 11-26 | completed | `commondatastorage.googleapis.com/.../ForBiggerJoyrides.mp4` — Google's sample video |
| 1 | 2025-12-30 | completed | `placehold.co/1024x576/png?text=Video+Generating...` — a **PNG** stored as a video |
| 5 | 2026-01-05 → 02-19 | completed | `video.pollinations.ai/prompt/...` — free endpoint, hotlinked |
| 1 | 2026-02-22 | completed | a genuine Supabase object (freepik) |
| 1 | 2026-06-25 | processing | the Google sample again ("QA verify video thumbnail re-test") |
| 2 | 2026-08-19 | **failed** | NULL — `provider: 'fal-ai'` |

`background_jobs WHERE job_type='video_generation'` — **2 rows, both failed:**
- `"fal.ai reported ERROR via webhook"`
- `"Gave up after 20 reconciliation attempts with no terminal fal.ai status"`

**The fal.ai path has a lifetime success rate of 0/2.** Every "completed" video in the
database is canned, a placeholder image, hotlinked from a free service, or from a provider
no longer in the code (P4-002).

`video_jobs` — 15 rows lifetime, 6 complete / 9 failed (40%). Last row 2026-07-02; last
success 2026-06-23. Four of the nine failures are `"Sign in to confirm you're not a bot"`
— yt-dlp blocked from a server IP, a structural condition, not a bug. `WORKER_YOUTUBE_COOKIES`
exists specifically to work around it and is empty (P4-003).

---

## 4. Why the fal path fails: the model routing is inverted

`fal.service.ts:86`:

```ts
videoHailuo23: "fal-ai/minimax/video-01",   // Hailuo 2.3 standard — image-to-video
```

The id and the comment describe different things. `minimax/video-01` is MiniMax's
first-generation endpoint, not Hailuo 2.3, and on fal.ai the image-to-video variant is a
separate endpoint id.

`generateVideo/index.ts:99-104` then builds the entire tier system on the *comment*:

```ts
// Hailuo 2.3 (the "standard" tier engine) is image-to-video only
const tierUpgraded = requestedQuality === "standard" && !isI2V;
```

So both branches are wrong, in opposite directions:

- **standard + image** → `submitVideoHailuo` POSTs `{prompt, image_url, duration, aspect_ratio}`
  to a text-to-video endpoint that does not accept those fields.
- **standard + no image** → force-promoted to premium and billed **15 credits instead of 5**.

The live failures match the first branch exactly: both fal rows carry
`quality: 'standard'`, `is_image_to_video: true`. This is the most probable single cause of
the 0/2 record (P4-006).

---

## 5. Cost per output

From the code's own constants (`fal.service.ts:585-593`, `generateVideo/index.ts:32-33,151-156`):

| Tier | Model | Provider cost | Credits | **Cost per credit** |
|---|---|---|---|---|
| standard | `minimax/video-01` | $0.500 flat/clip | 5 | **$0.1000** |
| premium 5s | `kling-video/v2.5/pro` | $0.070 × 5 = $0.350 | 15 | **$0.0233** |
| premium 10s | same | $0.070 × 10 = $0.700 | 15 | **$0.0467** |

**The tiers are economically inverted.** At the same 5-second duration, "premium" costs the
business 30% *less* in real dollars than "standard" ($0.35 vs $0.50) while charging the
user 3× the credits. Standard is 4.3× worse margin per credit than premium-5s.

**Duration is not priced at all.** A 10s premium clip costs exactly 2× a 5s one and the
user exactly the same 15 credits — and the *default* is 10s, because
`media.service.js:306` defaults `duration = 6` and `:323` resolves `>5 → '10'`. Every user
who never touches the control is silently on the worst-margin configuration (P4-007, P4-016).

Realised cost is never aggregatable: `cost_usd` is written into `metadata` while the
`generations.cost` column is **0 on all 32 rows**. No query can answer "what did video
cost us".

---

## 6. E2E TRACE — `T-P4-02` (generative), the primary trace

Every hop cited. This is the path that has run twice and failed twice.

```
[1] UI          src/pages/Studio/StudioPage.jsx:113 → startVideoGeneration
[2] STORE       src/stores/SessionStore.js:2643-2690
                  progress seeded at a hardcoded 10%, label "Queuing video job..."
[3] SERVICE     src/services/media.service.js:303-335  createVideoJob
                  duration 6 → '10'  (:323)   ← silently the expensive default
[4] EDGE FN     supabase/functions/generateVideo/index.ts
      :67-70      auth + rate limit
      :78-94      request_id idempotency replay        ✅ concurrent submit is safe
      :111-114    reserveCredits (atomic)              ✅ deduct-at-submit
      :131-149    prompt enhancement, claude-haiku-4-5-20251001, 200 tok, 15s timeout
                  ⚠️ wrapped in `catch (_) { finalPrompt = rawPrompt }` — SILENT
      :99-104     tier routing                          ❌ INVERTED (§4)
      :162-180    generations row born 'processing'
      :189-203    background_jobs row born 'queued'
      :210-223    fal.ai queue submit + capability-URL webhook
      :230-253    → 'running', persists fal's own status/response/cancel URLs
[5] PROVIDER    fal.ai — ❌ returned ERROR both times
[6a] WEBHOOK    supabase/functions/job-webhook/index.ts:54-77
                  token check, status='running' guard, then finalizeFromWebhookPayload
[6b] POLLER     supabase/functions/process-jobs/index.ts (pg_cron, 1/min)
                  ✅ PROVEN RUNNING IN PRODUCTION: job 68d203bb started 21:03:09,
                     finished 21:24:00 with "Gave up after 20 reconciliation attempts"
                     — 20m51s ≈ 20 sweeps at 1/min. Behavioural proof, not an RPC claim.
[7] FINALIZE    supabase/functions/_shared/videoJobFinalize.ts
      :35-43      fetch video from fal, upload to storage   ← ⚠️ BEFORE the claim
      :47-57      guarded UPDATE ... WHERE status='running' ✅ duplicate-webhook safe
      :61-66      generations → completed + public URL
      :88-97      on failure: refund via refund_credits RPC ✅
[8] UI          generic Studio progress bar. No stages, no estimate, no elapsed timer.

BREAKS AT [5]. Has never reached [7]'s success branch.
```

### Attacking the queue

| Attack | Result |
|---|---|
| Duplicate webhook | ✅ Safe — single conditional UPDATE guarded on `status='running'`, returns whether this caller won; only the winner touches credits |
| Concurrent submit | ✅ Safe — `request_id` replay returns the existing job |
| Provider timeout | ✅ Covered — `process-jobs` sweeps stale 'running', bounded at `MAX_ATTEMPTS=20`, then fails **and refunds** |
| Webhook never arrives | ✅ Covered by the same sweep |
| User cancels | ✅ Honest — `cancel-video-job` marks cancelled under a status guard, so a late webhook cannot resurrect it; refunds |
| **Worker/function dies mid-submit** | ❌ **STUCK FOREVER** |
| **Storage/fetch error in finalize** | ❌ **STRANDED + duplicate uploads** |

**Hole 1 — `queued` is unreaped (P4-009).** `process-jobs:53-54` selects only
`status='running'` AND `started_at < staleBefore`. `started_at` is written only on the
transition to running (`index.ts:234`), so a queued row has it NULL and is excluded twice
over. If the edge function dies between the `background_jobs` insert (`:189`) and the fal
submit (`:220`) — Deno timeout, cold-start kill, deploy mid-request — the row is stranded
at 'queued', the generations row at 'processing', and **the reserved credits are never
refunded**, because only the in-function catch can refund them.

**This is the identical stuck-state class P6 found in posts:** a transient state with no
reaper. It has not yet *happened* here only because `background_jobs` has held two rows in
its life.

**Hole 2 — expensive work before the claim (P4-009).** `finalizeCompleted` fetches the
video and uploads it to storage *before* the guarded UPDATE. Any throw there propagates to
`job-webhook`'s catch, which **deliberately returns HTTP 200** so fal will not redeliver.
The job stays 'running'; `process-jobs` re-attempts the same fetch+upload up to 20 times,
then fails a job whose video fal actually rendered — which is exactly the second live
failure. It also means the same video can be downloaded and uploaded 20 times, and a race
loser pays for a full download+upload before discovering it lost.

---

## 7. E2E TRACE — `T-P4-03` (clip engine), the one users can actually reach

```
[1] NAV      src/components/User/UserSidebar.jsx:53  "Video Lab" [BETA] → /app/video/jobs
[2] ROUTE    app/app/video/new/page.jsx → src/pages/VideoEngine/VideoSubmitPage
[3] API      app/api/video/submit/route.ts
      :18-35   zod: url ≤500 chars, platform ∈ {youtube,twitter,upload}
      :49-110  URL shape validation, platform-mismatch detection   ✅ good input handling
      :113-134 balance ≥ MIN_CREDITS_TO_SUBMIT(5) — a CHECK, not a reservation ❌
      :136-139 rate limit — ❌ fails OPEN, races, bypassable by deleting rows
      :141-150 INSERT video_jobs status='queued'
      :157-160 notifyJobSubmitted — best-effort, 3s timeout, warn-only
[4] TRANSPORT src/lib/video-engine/worker-client.ts:5
      WORKER_URL = process.env.WORKER_WEBHOOK_URL || 'http://localhost:8001'   ⚠️
[5] WORKER   video-worker/poller.py:15-45 — independent claim loop every 5s
             ✅ so a dropped notification self-heals; the webhook is an optimisation
[6] STAGES   download → transcribe → analyze → render → stitch     (A6's scope)
      credits deducted here, not at submit: video-worker/stages/download.py:271
      via database.py:329-380 — ❌ non-atomic SELECT-then-UPDATE
[7] DB       video_clips rows; job → complete | failed
[8] UI       src/components/video-engine/JobStatusPipeline.jsx — realtime, 6 stages
```

### Live outcome of this trace: 6 complete, 9 failed, nothing since 2026-07-02.

### The failure taxonomy, verbatim from production

```
x4  Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies …
    Requested format is not available. Use --list-formats for a list of available formats
    Stitched video upload failed:                      ← empty reason, swallowed error
    Job timed out after 90 minutes.
    No valid clips could be created from Claude response
    Transcription failed: mkl_malloc: failed to allocate memory
    Download failed: [SSL: DECRYPTION_FAILED_OR_BAD_RECORD_MAC] … Giving up after 3 retries
```

`JobStatusPipeline.jsx:215` renders `{errorMessage}` **verbatim** under the heading "What
went wrong". That is how a yt-dlp traceback reaches a paying user's screen. One live
message is the empty string, which renders a heading with nothing beneath it (P4-015).

Directly below it, line 217 states unconditionally:

> "Credits for this job have been refunded."

This is **static copy wired to no refund state**. The worker's refund is conditional
(`should_refund`) and can itself fail — `database.py:150-155` logs
`credit_refund_failed_manual_review_required` and continues. In both cases the UI still
tells the user their money came back. The product makes a financial assertion it has not
verified (P4-015).

---

## 8. Pipeline depth — the generative pipeline, stage by stage

| # | Stage | Status | Evidence |
|---|---|---|---|
| 1 | prompt → script | **MISSING** | no script/beat stage exists anywhere |
| 2 | prompt enhancement | BUILT | `generateVideo:131-149`, Haiku 4.5, 200 tok — but silently swallowed (P4-013) |
| 3 | shot planning / storyboard | **MISSING** | `FalVideoDuration = "5" \| "10"` — one single-shot clip, no sequence, no continuity |
| 4 | first-frame approval | BUILT ✨ | `SessionStore.js:2617-2641` — genuinely good idea, billed separately as an image |
| 5 | generation | BUILT-BUT-BROKEN | 0/2 lifetime (P4-006) |
| 6 | assembly / stitching | **MISSING** | nothing concatenates two generated clips |
| 7 | **audio / VO / music** | **MISSING ENTIRELY** | greps for elevenlabs, voiceover, tts, musicgen, soundtrack across the whole repo: **zero hits**. The word "audio" does not appear in `fal.service.ts` or `generateVideo/index.ts` |
| 8 | captions / subtitles | **MISSING** | exist only in the clip engine |
| 9 | render / encode | N/A | provider returns mp4; no re-frame, watermark, brand overlay, intro/outro |
| 10 | storage | BUILT | `videoJobFinalize.ts:39-45` |
| 11 | delivery | BUILT-BUT-INADEQUATE | public permanent URL (§9) |

**Every video this product generates is silent.** Both models return no audio track and
nothing adds one. For a social-video tool in late 2026 — against Veo-class tools that
generate synchronised dialogue and sound effects natively — a mute, captionless,
single-shot 5-second clip is a 2024-era capability (P4-012).

What actually exists is: one prompt → one Haiku rewrite → one silent 5-or-10-second
single-shot clip → a public URL.

---

## 9. Storage & delivery — two incompatible models

**Clip engine** — bucket `video-clips`, **private**. Delivery via signed URL,
`SIGNED_URL_EXPIRY = 172800` (48 hours), `refresh-url/route.ts:13`.

**This is why `refresh-url` exists.** The URL persisted in `video_clips.public_url` is a
time-limited signature. After 48 hours every stored link 404s and the row must be re-signed
(`route.ts:52-68`). The column name is actively misleading — it holds an expiring
credential. Any copy a user pasted into Slack, a client email, or a scheduled post silently
dies after two days. Worse, `jobs/[id]/route.ts:27-45` only mints a fresh URL when
`public_url` is *empty* — an expired-but-present URL is never refreshed automatically.

**Generative engine** — bucket `generated_assets`, **public**.
`videoJobFinalize.ts:45` calls `getPublicUrl()` and writes that unsigned, non-expiring URL
into both `output_url` and `storage_path` (`:64`). Permanent unauthenticated access, no
revocation. The object key is `${job.user_id}/${Date.now()}_${model}.mp4` (`:39`) — **the
owner's raw user UUID is embedded in a world-readable URL**, a cross-user correlation
handle leaked with every share.

Line `:64` also breaks the schema's semantics by putting a full URL in a column named for a
path — which is why legacy rows hold `pollinations.ai` and `googleapis.com` URLs in
`storage_path`.

**Egress:** the public bucket is served straight from Supabase storage — no CDN, no
hotlink protection, no per-user cap, no attribution. And because of Hole 2 (§6), a single
stuck job can write the same video up to 20 times (P4-011).

---

## 10. The duplicate UI — definitive

The premise that "one is presumably dead" is **wrong. Both are routable and both are in the
build.** `.next/server/app-paths-manifest.json` contains all six page routes.

`(video-engine)` is a route *group*, so its pages serve at `/video/*` — different URLs from
`/app/video/*`.

- **LIVE: `/app/video/*`.** The only nav link (`UserSidebar.jsx:53`, badged BETA) and every
  internal `navigate()` target it. Mounts the real SPA components under `app/app/layout.jsx`
  → `NextAppProviders` (auth/session).
- **DEAD-BUT-SERVING: `/video/*`.** All three `.tsx` pages are literally
  `return <div>Submit Page - Coming Stage 8</div>` / `"Jobs Page - Coming Stage 8"` /
  `"Job Detail - Coming Stage 8"`. There is **no `layout.tsx` in the route group**, so they
  fall through to the root `app/layout.jsx`, which has no auth provider and no session gate.
  These are publicly reachable unauthenticated URLs on the production domain rendering
  internal build-stage language.
- **NEVER COMPILED: `src/app/(video-engine)/**` and `src/api/video/**`.** Next.js resolves
  the app directory as root `app/` — every manifest entry maps to `app/...`, none to
  `src/app/...`. `src/app/(video-engine)/video/new/page.tsx` is **byte-identical** to the
  `app/` copy (`diff -q` reports no difference).

Three copies of the video route tree: one live, one shipping a placeholder to anonymous
visitors, one dead weight (P4-008).

---

## 11. Unhappy paths — what actually happens

| Path | Generative | Clip engine |
|---|---|---|
| Empty input | ✅ 400 "prompt is required" (`generateVideo:74`) | ✅ zod "URL is too short" |
| Huge input | ⚠️ no prompt length cap at all | ✅ `.max(500)` on URL |
| Rate limit | ✅ `enforceRateLimit` (`:70`) | ❌ **fails open** on any DB error (P4-017) |
| Provider 500 | ✅ refund + failed (`:257-265`) | ⚠️ raw traceback shown to user |
| Expired token | ✅ `requireUser` | ✅ `getAuthenticatedUser` |
| Network drop | ✅ poller reconciles | ✅ worker poller claims independently |
| Concurrent request | ✅ `request_id` replay | ❌ **TOCTOU** — count-then-insert, no lock |
| **Mid-job cancel** | ✅ honest cancel + refund | ❌ **impossible** after 'queued' — 409, and jobs run up to 90 min |

Cancel deserves emphasis. `CANCELLABLE_STATUSES = ['queued']` (`jobs/[id]/route.ts:15`).
Every other active status returns *"cannot be cancelled. Wait for it to complete or fail."*
Live evidence shows a job running **90 minutes** before the worker's own timeout. A user who
pastes the wrong URL is locked out for up to an hour and a half with credits spent.

And when the status *is* 'queued', the same `DELETE` handler cancels **and hard-deletes the
row and its storage** — there is no cancel-without-destroy. The cancel notification is
fire-and-forget (3s timeout, return value discarded at `:99`), and the delete carries **no
status guard**, so it races the worker's claim (P4-014).

---

## 12. Systemic patterns confirmed inside P4

The cross-agent context said to build on these. All three reproduce here:

1. **Substantial code disconnected from the product.** `src/app/(video-engine)/**` and
   `src/api/video/**` are complete, byte-identical, never compiled. `VideoEngineLab.jsx` is a
   full build-status dashboard with no importer, polling a hardcoded
   `http://localhost:8001/health` (P4-019). `replicate` — a dependency, an env var, two
   config fields, a docs page — called by nothing (P4-005).
2. **Silent AI-provider failure.** `generateVideo:146` — `catch (_) { finalPrompt = rawPrompt }`.
   Binds nothing, logs nothing, records nothing. And if `ANTHROPIC_API_KEY` is unset,
   `llm.ts:345-355` silently reroutes to **Groq — the provider known to have failed 100%
   for 2+ days** — and that failure is swallowed too. A degraded generation is
   indistinguishable in the DB from `enhance_prompt: false`: both store NULL (P4-013).
3. **Blind cron.** Correctly *not* concluded from `get_cron_job_status()`. `process-jobs`
   was proven running by behaviour: a live job finished 20m51s after start with the exact
   `MAX_ATTEMPTS=20` message, ≈20 sweeps at 1/min.
4. **P6's frozen-state class.** Two instances. `background_jobs.queued` is unreaped by
   construction (P4-009). And it has **already happened** in the clip pipeline: four
   `video_clips` rows have sat at `render_status='pending'` since **2026-06-17** — over two
   months — because their parent job failed with "Job timed out after 90 minutes" and the
   failure was never cascaded to its children (P4-010).

---

## 13. Docs vs code disagreements (findings in themselves, per Rule 1)

- `.env.example:71` — *"Video engine mock flags (set to false in production)"*. Two of the
  three are read by no code (P4-004).
- `docs/TECHNICAL_CONSTRAINTS.md:166` — Replicate as the *"Legacy/start-generation video
  path"*. No such path exists (P4-005).
- `fal.service.ts:12,86` — comment says "Hailuo 2.3 — image-to-video"; the id is
  `minimax/video-01`. The tier logic trusts the comment (P4-006).
- `video-worker/database.py:181` — docstring: *"Updates balance and lifetime_consumed
  atomically via RPC."* The implementation immediately below is a SELECT then an UPDATE,
  no RPC. **A doc/code contradiction inside one function, about money** (P4-018).
- `VideoEngineLab.jsx:16-35` — reports three build stages "Implemented" and calls the worker
  stages "stubs"; they have really run in production (P4-019).
- `JobStatusPipeline.jsx:217` — *"Credits for this job have been refunded."* Wired to no
  refund state (P4-015).

---

## 14. Persona verdicts

**The Power Migrant** — has used Runway or Kling. Clicks "Video Lab" and finds a
YouTube-URL box, not a prompt box. Finds the generative surface buried in Studio, uploads a
reference image (the flagship workflow), and hits a provider error — the 3rd such attempt in
the product's history. If it had worked, they would receive a **silent, captionless,
single-shot 5-second clip** they cannot assemble, score or subtitle in-product. They notice
10s costs the same as 5s. They notice clip links die after 48 hours while generated videos
are permanently public. They churn inside ten minutes, and the missing bulk actions never
even come up.

**The Casual Operator** — wants one video for Instagram. Two screens are called "video" and
ask for two different inputs with no explanation. If they choose clips, there is a 40%
chance of success and a `--cookies-from-browser` traceback if not, followed by an
unverified promise that their credits came back. If they choose generation, they get an
error, or — historically — Google's `ForBiggerJoyrides.mp4`. They cannot cancel. They have
no vocabulary for any of it.

---

## 15. The single most important uncertainty

**Whether the Railway worker is deployed and running, and what `WORKER_USE_MOCK_ANTHROPIC`
is set to there.**

These two unknowns swing the entire clip-engine assessment:

- If the worker is **down**, P4's only user-reachable surface is fully non-functional and the
  7-week silence in `video_jobs` is the symptom, not an absence of demand.
- If it is **up but mocking**, the 6 "complete" jobs were clips cut at a hardcoded
  180s–240s window with invented 0.78 hook scores, sold as AI analysis.
- If it is **up and real**, the clip engine is a genuine L2 with a 40% success rate.

Nothing in the repo can distinguish these. Resolving it needs the Railway dashboard and its
env vars, and it should be the first thing checked — it is a five-minute answer that
changes the grade.

**Second uncertainty:** whether `ANTHROPIC_API_KEY` is set in Supabase edge secrets. If it
is not, every video prompt has been silently routed to the known-dead Groq path, meaning
prompt enhancement has never run for the fal path at all.

---

## 16. What would move P4 to L3

Ordered by dependency, not by comfort. Nothing below is optional for a launch surface.

1. **Make one fal.ai video succeed.** Fix the inverted model routing (P4-006). Until a
   single end-to-end success exists, every other number in this document is theoretical.
   *Effort: S — but it gates everything.*
2. **Flip `WORKER_USE_MOCK_ANTHROPIC` to `default=False`**, delete the two dead
   `VIDEO_ENGINE_*` flags, unify the naming, and stamp mocked responses on the row (P4-004).
   *Effort: S.*
3. **Reap `queued`** in `process-jobs`, and **cascade parent failure to child clips** (P4-009,
   P4-010). *Effort: S–M.*
4. **Move the claim above the fetch/upload** in `finalizeCompleted` (P4-009). *Effort: S.*
5. **Translate provider errors** and **derive the refund claim from the ledger** (P4-015).
   *Effort: S.*
6. **Re-derive the credit table** from `FAL_COST_USD`, price duration, default to 5s, write
   `generations.cost` (P4-007, P4-016). *Effort: S.*
7. **Unify storage** on private buckets with mint-on-read signed URLs; stop embedding user
   UUIDs in object keys (P4-011). *Effort: M.*
8. **Real cancel at every stage**, split from delete, with a status guard (P4-014).
   *Effort: M.*
9. **Atomic credits** in the clip path via the existing RPCs (P4-018). *Effort: M.*
10. **Delete the two dead route trees** and the unrouted lab page (P4-008, P4-019).
    *Effort: XS.*
11. **Audio and captions for generated video** (P4-012). This is the one that is genuinely
    large — a subsystem, not a fix — and it is also the one without which the output is not
    postable. *Effort: XL.*

Items 1–10 are collectively a few weeks and would take the generative path to a defensible
L3. **Item 11 is the difference between L3 and a product a Runway user would consider.**
It should not be sequenced away because it is expensive; it should be sequenced *because*
it is the reason the output is currently unusable.

---

## 17. Parked ideas

- `HORIZON:` The two pipelines could compose — generate a clip, then run it through the
  worker's existing reframe/caption stages. That bridge is the cheapest path to captions on
  generated video and would make P4 one product instead of two. Parked, not scheduled.
