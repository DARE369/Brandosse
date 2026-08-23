# Video Engine — Current State

**Written 2026-08-23, from a full audit of the original clipping spec ("Packs
6–15") against the code, with every claim behaviourally tested against the
deployed worker.** Everything else in this folder is the historical build
journal — where it disagrees with this file or the code, it is wrong.

Scaling analysis (what breaks at volume, and in what order):
[SCALING.md](SCALING.md).

## Feature audit: original spec vs. what exists and works

| Spec (pack) | Status | Evidence |
|---|---|---|
| Backend bug fixes — caption path escaping, natural clip length/count (6) | ✅ implemented | `video-worker/stages/analyze.py:79` dynamic count/duration prompts |
| Gallery — split panel / list / table + persistence (7, 15) | ✅ implemented | `src/components/video-engine/ClipsGallery.jsx:227` `useLocalStorage("video-lab-layout-mode")` |
| Job settings columns + worker reads them (8) | ✅ implemented | `video_jobs` has all six columns; `video-worker/stages/render.py:340` reads them |
| Submission form pickers (9) | ✅ implemented | `AspectRatioPicker`, `CaptionStylePicker`, `ClipSettingsPanel` render via `SubmitForm.jsx` |
| **API route passes settings through (8)** | ❌→✅ **fixed 2026-08-23** | zod stripped all six fields silently; every job ran with defaults. Now validated + inserted (`app/api/video/submit/route.ts:31`), guarded by `scripts/check-video-prefs-contract.cjs` in CI |
| MediaPipe face tracker (10) | ✅ implemented | `video-worker/utils/face_tracker.py` |
| Scene classifier (11) | ✅ implemented + working | `video-worker/utils/scene_classifier.py`; test job classified SCREEN_ONLY correctly |
| Split layout compositor + aspect ratios (12) | ✅ implemented | `video-worker/stages/render.py:50` `calculate_output_dimensions` |
| Cursor tracker (13) | ✅ implemented + **verified visually** | `video-worker/utils/cursor_tracker.py:59`; extracted frames show the crop following the cursor |
| Hook text overlay (13) | ❌→✅ **fixed 2026-08-23** | overflowed narrow frames (drawtext cannot wrap); now 7-word cap + width-scaled font |
| Thumbnails (13) | ✅ implemented + working | `thumbnail_url` populated on real clips |
| Caption style presets ×6 (14) | ✅ implemented | `video-worker/utils/caption_generator.py:35` `STYLE_CONFIGS` |
| **Karaoke captions actually burn in (3/14)** | ❌→✅ **fixed 2026-08-23** | every transcript save failed on NOT NULL `raw_transcript` (schema drift) and was swallowed as a warning → 100% of clips shipped captionless. Save fixed, read-back verified, failure now fails the job (`video-worker/stages/transcribe.py:210`). Verified visually: karaoke sweep present in extracted frames |
| Progress display (15) | ✅ variant | `download_progress` column + per-clip realtime, instead of the spec's `progress_pct` |
| Stitched output (extra) | ✅ implemented | `stitched_output_url` on `video_jobs` |

**End-to-end proof (2026-08-23):** upload → transcribe → analyze
(`clip_count_target=1` honored) → render → captions visible, hook fits,
cursor-tracked crop correct → thumbnail → stitch → storage. Job
`46c02358` in `video_jobs`.

## YouTube ingestion — status and plan

### The stack, all deployed and proven

YouTube withholds format URLs behind three independent gates. All three are now
handled in the worker image:

1. **JS signature / n-challenge** — needs a JS runtime yt-dlp ≥ 2026 will
   accept: Node ≥ 22 installed from official tarball, explicitly enabled at
   `video-worker/stages/download.py:41` — *and* the challenge-solver scripts,
   which yt-dlp is not allowed to fetch remotely by default. Bundled locally
   via `yt-dlp-ejs` (`video-worker/requirements.txt:21`). Without it the
   failure masquerades as "Requested format is not available".
2. **PO tokens (BotGuard attestation)** — minted per-request in script mode by
   `bgutil-ytdlp-pot-provider`; Node half built in the image
   (`video-worker/Dockerfile:43`), plugin wired at
   `video-worker/stages/download.py:55`.
3. **IP reputation** — the residual gate. Measured 2026-08-23 from the
   worker's Fly IP: with the full stack, a real video **downloaded
   successfully as a guest** (11.8MB, full speed, valid MP4) — but most tested
   videos still answer "Sign in to confirm you're not a bot", across every
   player client (web, tv, mweb, web_embedded, android). Per-video enforcement
   varies.

### Cookies — WORKING since 2026-08-23 evening

Fresh burner-account cookies were exported correctly ("Get cookies.txt
LOCALLY" on a logged-in youtube.com tab, window closed immediately) and set on
Fly. **All previously bot-blocked test videos now extract: 3/3**, including
the ones that failed on every player client that morning.

Two export traps got fixed in code so cookie refreshes stay easy:

1. **HttpOnly cookies missing** — some exporter extensions cannot read the
   protected login cookies (`LOGIN_INFO`, `__Secure-1PSID`, `__Secure-3PSID`),
   producing a file that looks valid but authenticates nothing. Use
   "Get cookies.txt LOCALLY" specifically.
2. **The Fly dashboard strips newlines from pasted secrets** — a correct
   24-row export arrived as one line and parsed to zero cookies. The worker
   now self-heals this (`video-worker/stages/download.py:70`
   `_repair_cookie_newlines`, unit-tested four ways) and logs
   `youtube_cookies_loaded` with the row count, or warns loudly when the
   export is genuinely unparseable instead of silently going guest.

**Cookie refresh procedure (when they eventually expire):** burner account →
private window → youtube.com logged in → export → close window immediately →
paste into the Fly secret → `fly secrets deploy` (setting a secret while the
machine sleeps leaves it *Staged*, not deployed).

### Escalation tiers if cookies prove insufficient

| tier | cost | note |
|---|---|---|
| Valid burner cookies (above) | free | ✅ **confirmed working 2026-08-23** |
| Rotate Fly machine → new IP | free | new IP starts unflagged; degrades with use |
| Residential/mobile proxy | ~$1–8/GB | conflicts with the $5/mo ceiling — **founder decision** |
| Transcript-first architecture | rebuild | different product shape; horizon item |

Rate discipline regardless: guest sessions tolerate roughly 300 videos/hour
before throttling; we are nowhere near it, but bulk features should never
assume unlimited pulls.

**The upload path is the permanent fallback** and is fully working —
browser → HMAC ticket → Fly volume → pipeline (`video-worker/uploads.py`).

## End-to-end YouTube proof (2026-08-23, job `5e77c665`)

A 14-minute TED talk, submitted as a plain YouTube URL, ran the whole pipeline
in **under 4 minutes**: download ~45s (tv client) → transcribe → analyze
(`clip_count_target=2` honored, real hook titles) → two clips of 235s and 174s
rendered sequentially with thumbnails → storage. Frame inspection confirmed
face-tracked crop and burned-in captions on the YouTube-sourced output.

Also learned: YouTube's SABR-only streaming is **intermittent per request** —
the same video downloaded at 11:31 and failed at 11:52 with "Requested format
is not available". The `tv` player client is outside the SABR experiment and
fixed it (`video-worker/stages/download.py`).

**Resolved 2026-08-23 (and it was not a horizon item).** That "tv client tops
out low" note was the single biggest quality defect in the product, not a
future concern: `tv+ios+web` returned **5 formats, max 360p**, so every clip
ever rendered was built from a 360p source no matter how good the render
pipeline was. Probed against one video at one moment:

| clients | formats | max height |
|---|---|---|
| tv+ios+web (old default) | 5 | **360p** |
| mweb | 166 | 2160p |
| web_safari | 143 | 1080p |
| tv_embedded | 119 | — |

Default is now `['mweb','web_safari','tv_embedded','web']`, and both the
metadata probe and the download walk `CLIENT_LADDER`
(`video-worker/stages/download.py`), advancing only on errors meaning "this
client returned nothing usable" — a private or deleted video still fails
immediately with the right message. Verified end to end: a 20-minute source
rendered a clip at **608×1080** (was 404×720), sharp, with the hook fitting and
karaoke captions highlighting correctly.

Cost of the win: 1080p sources are several times larger, so downloads and
renders take longer on a 1-vCPU machine. That strengthens the case for a bigger
machine (see [SCALING.md](SCALING.md)) rather than weakening the quality gain.

## The recurring "format is not available" failure — root cause (2026-08-23)

This failure recurred all day and survived four patches: PO tokens, fresh
cookies, the `tv` client, and a four-rung client fallback ladder. Every one of
those changed WHICH CLIENT was asked. None could work, because the failure was
in what was asked FOR.

`_get_video_metadata` inherited the DOWNLOAD format selector from
`YTDLP_BASE_OPTIONS`, and yt-dlp applies that selector inside `extract_info`.
So the preflight stage — which only needs a title and a duration, both of which
come from the video page — could be failed by the absence of a matching
downloadable format. Any moment YouTube returned SABR streams without URLs, or
formats without height metadata, a perfectly downloadable video died at
preflight.

Proven by forcing the condition with a selector that can never match:

    metadata, format selector applied   FAIL on all 4 ladder rungs
    metadata, selector dropped          OK, title + duration returned

A fallback that varies the client cannot rescue a constraint that does not
vary. That is why four patches in a row appeared to work and then failed again.

**The fix has three parts, because the problem had two halves.**

*Half one — a constraint that never should have applied.* The metadata probe now
extracts with `process=False`, which skips format selection entirely. Dropping
the `format` key alone was NOT enough: yt-dlp then applies its own default
selector and can still raise the same error. Title and duration come from the
page, so this stage now cannot be failed by format availability at all. The
download stage's selector separately degrades through four fallbacks to a bare
`best`, so a height filter can never fail a source that has *something* usable.

*Half two — the failure is transient, so waiting is the only cure.* The same
source failed and then returned 304 usable formats minutes later on unchanged
code. When every client is poisoned in the same instant, switching clients
cannot help. The ladder is now walked up to three times with pauses
(`YOUTUBE_RETRY_PAUSES = [0, 12, 25]`), costing at most ~35s on a job that
previously failed outright. Errors that will never change — private, deleted,
geo-blocked — still stop on the FIRST attempt with the correct message rather
than burning the retries.

Both proven by fault injection on the live worker: a first pass poisoned on all
four rungs recovered on retry; a private video stopped after one call.

**Guarded:** `scripts/check-metadata-format-decoupling.cjs`, in CI, verified by
deliberately restoring the coupling and by removing the `/best` fallback.

## Long renders vs. scale-to-zero (fixed 2026-08-23)

Fly's proxy stops this machine after a few minutes without edge traffic. A
long render is pure internal work, so the proxy idle-stopped the machine
MID-JOB — graceful shutdown, job stranded in `rendering`, both clips lost.
Three fixes, layered so any one failing still leaves the others:

1. **Sequential renders** (`MAX_CONCURRENT_RENDERS = 1`) — two encodes on one
   shared vCPU thrash so hard neither finishes; one at a time commits each
   clip as it completes, bounding any interruption to one clip of loss.
2. **Self-keepalive** — while a job is active the poller pings the app's own
   public URL every 60s, resetting the proxy's idle clock
   (`video-worker/poller.py`). Idle machines still scale to zero.
3. **Requeue on cancellation** — if shutdown interrupts a job anyway, it goes
   back to `queued` instead of stranding; reruns are idempotent because
   analyze deletes the job's clips before inserting.
