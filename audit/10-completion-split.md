# D10 — The Completion Split
## What already exists vs. what must be built

**Deep Launch-Readiness Audit · Brandosse** · 2026-08-21

> The deliverable requested at Gate 0: everything that needs completing, separated into **what is already there** and **what genuinely does not exist yet**.
>
> The split is derived from finding status, not judgement: `BUILT-BUT-INADEQUATE` and `STUBBED` = exists; `MISSING` = build.

---

## The headline number

| Category | Findings | Share |
|---|---|---|
| **EXISTS — needs finishing or connecting** | **105** | **90%** |
| **MUST BE BUILT — does not exist** | **12** | **10%** |

**Roughly 9 out of every 10 items on this list are already in your repository.**

That is the most important finding in the entire audit, and it reframes everything else in it. This codebase is not underbuilt — it is **underconnected**. Substantial, competent engineering exists and is not wired to the running product. That is far cheaper to fix than it looks, and it explains why the repo's own documentation reads as more finished than the product behaves: the code genuinely is there.

---

# PART 1 — ALREADY EXISTS

## 1A. Built, correct, and working — leave alone ✅

Do not touch these. They are the foundation the rest builds on.

| Capability | Evidence | Note |
|---|---|---|
| Publish queue: idempotency, retries, double-publish guard | `publish-post/index.ts:34,119-122,192-206` | `MAX_RETRIES=3`, `publish_request_id` |
| Ownership/tenancy checks in publishing | `publish-post/index.ts:98-117` | The reference standard for other endpoints |
| pg_cron scheduled-post worker | live: runs every minute, last status `succeeded` | Healthy |
| Brand-kit injection into prompts | `brandKitLoader.js:13-79` → `briefBuilder.js` → `generate-content-plan:145-171` | Verified end-to-end on live data |
| Client-side quality gate | `src/services/qualityGate.js` | Fails **closed** — correct |
| Credit reserve/refund atomicity | `deduct_credits` / `refund_credits` RPCs | Correct primitive for spend control |
| Clip moment-scoring rubric | `video-worker/stages/analyze.py:29-45,249` | Real 4-dimension rubric on Claude Sonnet 4.6 |
| Transcription pipeline | `video-worker/stages/transcribe.py:13-41` | Word-level timing, 30-min chunking, $0.04/hr |
| Worker stuck-job detection | `video-worker/config.py:35` | 45-min threshold — the safeguard publishing lacks |
| Scheduling data layer | `src/calendar/hooks/useScheduleAction.js:103-234` | Optimistic concurrency, realtime, conflict detection |
| SEO scorer error handling | `_shared/seo.ts:258-272` | Corrective retry, then fails visible — never a fake 0 |
| Video-generation queue plumbing | `A5-P4-pipeline.md` | Claim guards, refunds, honest cancel |
| **Image credit integrity** | `generateImage/index.ts:185-211,360` | **Reserve→refund, race closed, double-refund guard. Best money code in the repo** |
| Image brand-context injection | `generateImage/index.ts:67-81,228` | 7 brand fields incl. `avoid_visual_elements` |

---

## 1B. Built but DISCONNECTED — just needs wiring 🔌

**This is the cheapest, highest-leverage work in the entire audit.** The code is written, reviewed, and sitting inert.

| What exists | Size | Current state | To finish |
|---|---|---|---|
| `WORKER_GROQ_API_KEY` | — | **Absent** — pipeline dies at stage 2 | **Set one variable** |
| `WORKER_YOUTUBE_COOKIES` | — | **Absent** — kills 2/3 of clip jobs; mitigation designed at `config.py:24-26` | **Set one variable**, then durable rotation |
| `generate-caption` edge function | — | Fully wired, best caption prompt in the codebase, **called by no UI** | Connect to the regenerate path |
| `OptimalTimesService.js` | 466 lines | Full Groq pipeline, **imported nowhere**; `optimal_posting_times` = 0 rows | Feed real performance, wire to scheduler |
| Ghost-slot logic | `daily-analysis:230-324` | Complete server-side; gated behind a flag `false` for all 7 users with **no UI to change it** | Expose the setting |
| `content_versions` table | — | Exists; **zero application references** | Write revisions on regenerate |
| `week_plan` / `suggest_slots` / `add_draft_post` / `delete_post` | — | Generated correctly by `calendar-ai`; **handler missing** at `CalendarPage.jsx:605` | Add 4 handler cases |
| `external_post_id` | `publish-post:212` | **Written and read by nothing** — the attribution key the whole loop needs | Fetch metrics against it |
| `user_notifications` table | — | Exists; publish failures don't write to it | Write on final failure |
| `health_score` / `last_failure_reason` | — | Fetched by the dashboard, **never rendered** | Use in the badge |
| Header search box | 4 routes | Rendered, wired to **no-op default props** | Connect or remove |
| Guard scripts | 8 scripts | Exist; **not in CI** (build-only) | Add to workflow |

> **Twelve items. Several are literally one environment variable or one `case` statement.** Together they account for a large share of what makes the product feel broken.

---

## 1C. Built but INADEQUATE — needs real work 🔧

Works; fails the D4 bar.

| Capability | What's wrong | Effort |
|---|---|---|
| **Publishing breadth** | 1 platform, 1 account, 6 posts lifetime. Buffer's *free* tier beats it | **L** |
| **Account state truthfulness** | 4 accounts show "active", structurally cannot publish (`provider='direct'`) | S |
| **Publish state machine** | 20 posts frozen in `publishing` since 2026-04-04; **no reaper exists** | S |
| **Text iteration** | "Regenerate" is a blind overwrite — no instruction, no diff, no revert | M |
| **Default LLM model** | `claude-3-5-sonnet-latest` (2024) at `llm.ts:51`; `ANTHROPIC_MODEL` unset | S |
| **Provider fallback** | Works silently — Groq failed 100% for days, nothing alerted | S |
| **Discovery score** | 9 LLM dimensions, hand-assigned weights, **no external signal, cannot learn** | XL to ground / S to relabel |
| **Clip analysis truncation** | `max_tokens=4096` truncates long videos — moments silently lost | M |
| **Clip export presets** | No 9:16 / 1:1 / 16:9 platform presets | M |
| **ui-v2 migration** | 71% done; 5 routes on a legacy shell that **renders unstyled**, including billing | L |
| **Navigation** | 9 pages hand-copy `NAV_ITEMS`, 5 omit Analytics, video gen has no entry at all | S |
| **Video generation** | Never succeeded; 18 of 32 rows are a Google demo MP4; silent single-shot output | XL |
| **Video pricing** | Standard tier loses money at the cheapest credit tier; silent 3× tier upgrade | M |
| **Credit unit** | One unit spans a 20–30× cost spread between clipping and video generation | M |
| **Worker mock default** | `use_mock_anthropic` **defaults to `True`** — omitting it yields fake output | XS |
| **Cron monitoring** | Hardcoded 3-name allowlist; `healthCheck` calls it | XS |
| **Error handling** | Raw tracebacks rendered to users under a hardcoded "Credits refunded" that refunds nothing | S |
| **Test coverage** | 1 Playwright spec vs ~109k lines; CI builds only | M |
| **RLS on posts/generations** | **Cross-user reads confirmed live** | M |
| **Dead duplicate tree** | `src/app/**` + `src/api/**`, 17 files incl. a dead Stripe webhook | XS |
| **Hotlinked image assets** | 32 live rows point at `image.pollinations.ai`; product owns no file. 22 more are picsum/Unsplash placeholders marked `completed` | M |
| **Image brand fidelity** | Brand reaches the prompt as text only; colors/logo not deterministically composited | M |
| **Client credit display** | `media.service.js:275` falls back to `?? 3` while the server charges 1 | XS |
| **Provider call timeouts** | `zernio.service.ts` — the sole publishing provider — has 4 fetch calls and **0 timeouts** | S |

---

## 1D. Built and should be DELETED 🗑️

| What | Size | Why |
|---|---|---|
| `src/app/**`, `src/api/**` | 17 files | Unroutable duplicate incl. Stripe webhook; still type-checked, so it looks maintained |
| `video-worker/utils/clip_selector.py` | 292 lines | Superseded by `analyze.py`; imported by nothing |
| `video-worker/utils/llm_client.py` | 242 lines | Imported by nothing; contains hardcoded fake scores |
| `transcript_parser.py`, `video_reframer.py` | — | Imported by nothing |
| `daily-analysis` `mockTrends` writer | `:337-372` | **Fabricates trend data daily. Delete before anything else.** |
| Legacy shell + stylesheets | — | After ui-v2 migration completes |
| `src/legacy/supabase.js` | — | Superseded |

---

# PART 2 — MUST BE BUILT

Only **12 findings** describe things that genuinely do not exist. Ordered by importance.

## 2A. Required for the product thesis 🎯

| # | What | Why it matters | Effort |
|---|---|---|---|
| 1 | **Real platform metrics ingestion** | No code anywhere calls a platform insights API. `platform_analytics` = 0 rows. **Without this the loop cannot close and the product has no differentiator.** The attribution key already exists | **L** |
| 2 | **P8→P3 carrier** — performance into prompts | No prompt includes the user's own results. This one connection converts the thesis from claim to demonstrated | M |
| 3 | **Cold-start reach mechanism** | Thesis hard constraint. Currently *zero* working mechanisms — an LLM rates caption text, that is the entire list | XL |

## 2B. Table stakes competitors have 📋

| # | What | Benchmark | Effort |
|---|---|---|---|
| 4 | **Bulk calendar operations** | Publer's core selling point; every action here is single-post | M |
| 5 | **Analytics export + date-range comparison** | Metricool gives this away free | M |
| 6 | **Publish-failure notification** | Buffer/Later push these; 22% of live posts failed silently | M |
| 7 | **Stuck-state reaper** | Nothing recovers a frozen post | S |
| 8 | **Cross-tenant security test** | The single highest-value test that could exist here | M |
| 9 | **Error tracking / alerting** | No Sentry or equivalent. If a generation fails at 3am, no evidence exists | M |

## 2C. Missing from existing pillars 🧩

| # | What | Note | Effort |
|---|---|---|---|
| 10 | **Idea capture** | No way to save an idea for later | S |
| 11 | **AI brief generation** | `ai-generate-brief` is MISSING; idea→brief handoff is lossy | M |
| 12 | **Audio in generated video** | Zero hits for elevenlabs/tts/voiceover repo-wide. Output is silent | L |

---

## What is NOT on this list

Per the Completion Lock, and worth stating explicitly:

- **Campaigns, series, repurposing plans** — genuinely new surface. Parked in D8.
- **B-roll, multi-language dubbing, caption editors** — new. D8.
- **Team/agency/multi-tenant** — out of audit scope by definition.
- **Keyword-volume tooling, SERP tracking, competitor monitoring** — new integrations. D8.

---

## How to read this

**If you do nothing else, do Part 1B.** Twelve disconnected items, several of them a single environment variable or a missing `case` statement. They cost days, not weeks, and they account for a large share of why the product feels broken.

**Then Part 2A #1.** Real metrics ingestion is the only genuinely new build that the product thesis cannot survive without — and the plumbing it needs (`external_post_id`) is already written and waiting.

**The uncomfortable one:** video generation (P4) is the largest single body of remaining work, has never once worked, has negative margin at the cheapest credit tier, and **repairing it makes your unit economics worse rather than better**. D5 recommends cutting it from v1. That recommendation conflicts with the Gate 0 "all pillars, non-negotiable" answer, and it is the decision worth the most deliberate thought.

---

## Coverage note — resolved

**Image generation (P4i) has now been audited** (2026-08-21), after its agent was killed four times. The result went in the product's favour and is worth stating plainly:

- **Users are NOT charged for failed image generations.** All three endpoints reserve credits before provider work and refund from a single top-level catch, with a double-refund guard and an explicitly documented concurrency-race fix (`generateImage/index.ts:185-211,360`). This is the best money-handling code in the codebase.
- **Margins are positive at every tier** — 39–70% on images, 87% on edits, 80% on upscales.
- **Brand kit mechanically reaches the image prompt**, including a negative-constraint field (`avoid_visual_elements`) that most tools omit.

Two real gaps remain: 32 live rows hotlink to `image.pollinations.ai` rather than storing assets the product owns, and 22 rows point at placeholder/stock services (`picsum.photos`, Unsplash) while marked `completed`.

**Remaining coverage gaps:** the persona walkthroughs never ran, and part of the quality inventory (running the test suite and guard scripts) is outstanding.
