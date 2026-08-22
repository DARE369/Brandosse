# D3 — Gap Analysis
**Deep Launch-Readiness Audit · Brandosse** · Phase 3 · 2026-08-21

Merges D1 (ground truth, 117 findings) × D2 (market reality).

---

## 1. The Gap Ledger — BLOCKERS

29 findings are rated BLOCKER. Deduped and ranked by severity × blast radius.

| # | Finding | Pillar | What it is | Blast radius |
|---|---|---|---|---|
| 1 | **P10s-001/002** | P10 | Any authenticated user reads other users' `posts` and `generations`, full content. Verified live with an ordinary JWT | ALL |
| 2 | **P10s-005** | P10 | Live `WORKER_WEBHOOK_SECRET` committed at `docs/VIDEO_LAB_COMPLETE_GUIDE.md:538`; matches current `.env.local` and `video-worker/.env` | ALL |
| 3 | **P10s-006** | P10 | `admin-list-posts:167-205` trusts the user's own self-writable `profiles.role`; plausible self-service privilege escalation | ALL |
| 4 | **P6-003** | P6 | 20 posts frozen in `publishing` since 2026-04-04. No reaper exists anywhere | P2, P8 |
| 5 | **P6-002** | P6 | 4 accounts display "active" but are structurally unpublishable (`provider='direct'`, path deleted) | P2, P8, P9 |
| 6 | **P6-001** | P6 | Real publishing = 1 platform, 1 account, 6 posts. Buffer's *free* tier beats this | P2, P8 |
| 7 | **P8-001/006** | P8 | Zero real engagement data anywhere; no platform insights API is ever called. `trending_topics` is fabricated | P1, P2, P7 |
| 8 | **P7-002** | P7 | Discovery score cannot learn — weights are compile-time constants, no outcome ever feeds back | P1, P2, P3 |
| 9 | **P7-004** | P7 | No working cold-start mechanism for a zero-audience account. The thesis's hard constraint is unmet | P1, P2, P3 |
| 10 | **P3-003** | P3 | No text iteration or versioning. "Regenerate" is a blind overwrite | P2 |
| 11 | **P2-004** | P2 | "Apply week plan" silently does nothing — 4 of 7 AI actions unhandled | P1, P3 |
| 12 | **P5-007** | P5 | YouTube bot detection kills 10 of 15 jobs. Mitigation exists in config, unset | P4, P9 |
| 13 | **P5-008/002** | P5 | `WORKER_GROQ_API_KEY` absent — pipeline cannot pass stage 2 | P4 |
| 14 | **P5-004** | P5 | Analysis output-token truncation on long videos | P4 |
| 15 | **P4-002** | P4 | Video generation has never succeeded. 18 of 32 rows point at a Google demo MP4 | P9, P10 |
| 16 | **P4-004** | P4 | `WORKER_USE_MOCK_ANTHROPIC` **defaults to True** — omitting it silently yields fake AI output | P5, P10 |
| 17 | **P9-008** | P9 | Unstyled nav renders as raw text on 4 legacy routes, including `billing/credits` | — |
| 18 | **P1-004** | P1 | Brand-kit conversation stubbed — upstream of every ideation prompt | P2, P3 |
| 19 | **P10o-001** | P10 | One credit unit spans a 20–30× cost spread; video generation loses money at the cheapest tier | P4, P5 |
| 20 | **P10o-002** | P10 | **Fixing P4 makes unit economics worse.** Pricing must be corrected *before* P4 is repaired | P4 |

*(Remaining BLOCKERs are pillar-internal variants of the above; full list in `audit/findings/*.yaml`.)*

---

## 2. The Inadequacy List

> The charter singles this section out: BUILT-BUT-INADEQUATE is the class most audits miss. **77 of 117 findings fall here** — the largest class by far. These are things that run, that a demo would survive, and that a real user would reject.

### 2.1 Discovery score — sophisticated machinery, no ground truth
**Built:** Claude rates 9 dimensions; weighted sum; corrective retry on bad JSON; fails visible rather than fabricating a 0 (`_shared/seo.ts:212-297`).
**Required:** a score anchored to something observable.
**The delta:** `SeoScoreInput` is `{title, caption, hashtags, platform, mediaType, visualPrompt}` — every input comes from the post being scored. Nothing external. Weights are constants.
**Why it fails:** Opus Clip ships a virality score too, so this is table stakes, not differentiation — and neither product validates against outcomes. A Power Migrant identifies an unvalidated LLM opinion quickly and stops trusting it; a Casual Operator trusts it *because* it looks authoritative and optimises toward a target with no demonstrated relationship to reach. **The persona that can't detect the problem is the one it harms.**

### 2.2 Text generation — real quality, capped by an unexamined default
**Built:** brand kit mechanically reaches the prompt (verified end-to-end against a live "Oríkì Soda Co." kit); platform-differentiated output; a client-side quality gate that genuinely fails closed.
**Required:** output competitive with the ChatGPT/Claude subscription the user already pays for.
**The delta:** `_shared/llm.ts:51` defaults to `claude-3-5-sonnet-latest` — a 2024 model — and `ANTHROPIC_MODEL` is unset. With Groq failing 100%, *every* piece of content is produced by it.
**Why it fails:** we are asking users to pay for weaker inference than they already have. Compounded by no revision model (P3-003) — one-shot generation with a blind-overwrite "Regenerate" is below what a chat window offers.

### 2.3 Publishing — correct engineering, one working account
**Built:** thorough ownership checks (`publish-post:98-117`), double-publish guard, `MAX_RETRIES=3`, idempotency via `publish_request_id`, healthy per-minute cron.
**Required:** reliable multi-platform publishing — Buffer's free tier does 3 channels.
**The delta:** one real account; four accounts that lie about being active; no reaper for the `publishing` state; publish failures likely never notify the user, at a 22% live failure rate.
**Why it fails:** the queue is sound and the *fleet* is not. A Power Migrant connects Instagram, schedules a week, and every post fails against an account the UI called healthy.

### 2.4 Clipping — the best asset in the product, blocked by two unset variables
**Built:** a real Claude rubric (hook/flow/+2, `analyze.py:29-45`); word-level Whisper transcription with 30-minute chunking for unlimited length; speaker tracking, scene classification, karaoke captions; 45-minute stuck-job detection; ~96% margin.
**Required:** paste a URL, get clips — Klap does it in under 2 minutes.
**The delta:** `WORKER_GROQ_API_KEY` absent, `WORKER_YOUTUBE_COOKIES` absent, output truncation on long videos, no platform export presets, dead parallel implementation (`clip_selector.py`).
**Why it fails today:** two thirds of jobs die at ingestion. **This is the highest value-to-effort ratio in the entire audit** — genuinely competitive machinery gated behind configuration.

### 2.5 The dashboard tells the user things that are not true
**Built:** 71% migrated to ui-v2; a real dashboard with live data.
**Required:** the UI must not misrepresent system state.
**The delta:** an account with `health_score=20/100` and a recorded failure reason renders as green **"Healthy"** (`toAccountCard():117-140` derives the badge from `connection_status` alone). Posts stuck in `publishing` for months are excluded from Content Flow totals and labelled "now" in the calendar. The header search box on 4 routes is wired to no-op props and cannot accept input.
**Why it fails:** this is worse than a missing feature. A user who is told "Healthy" has no reason to investigate, and the product's own UI is what prevents them discovering the truth.

### 2.6 Analytics — a page that cannot become useful
**Built:** a real analytics page rendering genuine post counts, platform breakdown, account health.
**Required:** engagement data.
**The delta:** `platform_analytics` and `analytics_summary` are 0 rows; nothing calls a platform insights API; a stale disclaimer references "illustrative engagement figures" that are not on the page.
**Why it fails:** it cannot improve without P6 publishing at volume. The dependency is absolute, and it is why loop closure is BROKEN rather than lossy.

### 2.7 Video generation — the inverse of clipping
**Built:** the best-engineered queue in the codebase — claim guards, idempotency, refunds, honest cancel.
**Required:** produce a video.
**The delta:** never has. Silent output only: no script stage, no shot planning, no audio, no captions (`P4-012`, zero hits for elevenlabs/tts/voiceover across the repo). Competitors at this price ship audio.
**Why it fails:** excellent plumbing around a capability that does not function, at the worst cost-to-value ratio in the product.

### 2.8 Worker config fails open to fake
**Built:** strict startup validation for Supabase URL, service key, webhook secret — the worker refuses to start without them.
**Required:** the same strictness for the flags that decide whether the AI is real.
**The delta:** `video-worker/config.py:21-22` — `use_mock_anthropic` and `use_mock_replicate` **default to `True`**.
**Why it fails:** an environment that merely omits a variable produces fabricated AI output while reporting healthy. The correct pattern already exists seven lines above in the same file.

---

## 3. Loop Integrity Analysis

The product thesis requires the loop to compound. Walking every handoff:

| Handoff | Verdict | Evidence |
|---|---|---|
| Idea → Plan | **LOSSY** | Ideation produces prompts, not structured briefs. `ai-generate-brief` is MISSING (P1-005); no idea capture (P1-006) |
| Plan → Generate | **LOSSY** | Content plans generate correctly, but "Apply week plan" writes nothing (P2-004). The user re-enters intent manually |
| Generate → Media | **INTACT** | Carrier: `generations.storage_path` / `output_url` → `posts.generations` join (`publish-post:78-90`) |
| Generate → Calendar | **LOSSY** | Studio output reaches `posts`, but revision history is never written (P3-003); prior versions are lost on regenerate |
| Calendar → Publish | **INTACT (narrow)** | Carrier: `process_scheduled_posts()` → `dispatch_scheduled_post()` → `publish-post`. Genuinely works — for the one real account |
| Publish → Platform | **BROKEN for 21 of 22 accounts** | 1 real Zernio account works; 4 marked-real accounts fail at `publish-post:164`; the rest are mock |
| Platform → Analytics | **BROKEN** | No platform insights API is called anywhere. `external_post_id` is stored (`publish-post:212`) and never used to fetch anything |
| Analytics → Idea (P8→P1) | **BROKEN** | No carrier exists. `trending_topics` is fabricated and read by nothing |
| Analytics → Plan (P8→P2) | **BROKEN** | `optimal_posting_times` = 0 rows; `OptimalTimesService.js` imported nowhere |
| Analytics → Generate (P8→P3) | **BROKEN** | No prompt anywhere includes the user's own performance history |

### The verdict on the thesis

**The loop does not close. It does not even mostly close — it terminates at "Platform → Analytics" and every downstream handoff is BROKEN with no carrier.**

The chain currently runs: idea → plan → generate → publish (one account) → **stop**.

This is not a gap in the product; it is a gap in the *premise*. The differentiation argument — one context flowing through the whole chain, compounding — has no implementation. Everything before publish is a competent content generator. Everything after publish is absent.

**The one encouraging fact:** the break has a single root cause. There is no real performance data because there is almost no real publishing. Fix P6 and the loop *becomes buildable* — the attribution key (`external_post_id`) is already stored and waiting. **P6 is the keystone of the entire thesis, not merely one pillar of ten.**

---

## 4. Silent Failures

Things that look like they work and will fail on contact with real users:

| # | Silent failure | Detection today |
|---|---|---|
| 1 | Cross-user data readable by any account | **None.** Found only by direct probing |
| 2 | Posts frozen in `publishing` forever | **None.** 20 accumulated over 4 months |
| 3 | Groq failing 100%, Claude absorbing cost | **None.** Fallback works, so nothing alerts |
| 4 | 4 accounts that can never publish, shown "active" | **None.** UI derives health from the wrong column |
| 5 | `daily-analysis` writing fabricated trends for 5 months | **None.** Invisible to the monitoring RPC by construction |
| 6 | Worker silently in mock mode if a flag is omitted | **None.** Reports healthy |
| 7 | Browser Groq token hardcoded `''` → "AI suggestions" are 2 static strings | **None.** Permanent, silent |
| 8 | Standard video silently billed at 3× | **None.** User discovers via credit balance |
| 9 | `background_jobs.queued` unreapable; credits never refunded | **None** |
| 10 | Edits to `src/app/**` payment routes have no effect | **None.** Type-checks fine |

**The pattern:** every one of these is invisible to the operator. The audit's root finding for P10 is not any individual bug — it is that **the system has no capacity to tell you when it is broken.**

---

## 5. Autonomy Ladder Assessment

*Assessment only — no new features proposed.*

**Current rung: Assisted.** The system generates content a human reviews and acts on. It is not Supervised-Agentic: nothing proposes and executes multi-step work under review.

### Runway — decisions that will support progressive autonomy

1. **Durable job infrastructure exists.** `background_jobs`, `process-jobs`, pg_cron running reliably every minute, a Python worker with claim guards and stuck-job detection. Agentic loops need exactly this, and it works.
2. **Credit metering with atomic reserve/refund** (`deduct_credits`/`refund_credits`) — autonomous systems need spend limits, and the primitive is built and correct.
3. **Structured artifacts, not chat logs.** `content_plans`, `posts`, `generations`, `video_clips` are queryable rows. An agent can act on this; it could not act on a transcript.
4. **A real provider-routing abstraction** (`_shared/llm.ts`) with fallback — model swaps do not require rewrites.
5. **`external_post_id` is stored**, so the attribution key an autonomous loop would need already exists.

### Walls — decisions that block it

1. **No feedback signal.** Autonomy requires an outcome measure. There is none (§3). An autonomous system with no ground truth optimises noise — and would do so faster than a human.
2. **No observability.** You cannot safely delegate to a system that cannot report its own failures (§4). This is the hard blocker: autonomy without monitoring is unbounded risk.
3. **Fail-open defaults.** `use_mock_anthropic=True` means an autonomous run could produce fabricated output at scale while reporting success.
4. **No revision model.** `content_versions` is unused (P3-003). Autonomous iteration requires a version history to iterate *over*.
5. **Client-side architecture.** Logic in `src/**` running in a browser cannot be driven headlessly by a scheduler; agentic execution would need the logic server-side.
6. **No cost ceiling per user.** One heavy user can consume a full package's revenue (D2 §5) — unacceptable when an agent, not a human, is deciding how often to act.

**Assessment: the infrastructure is runway; the information architecture is a wall.** Jobs, credits, and structured artifacts are the hard parts and they are built. What is missing is the sensory layer — the system cannot see outcomes or its own state. Progressive autonomy is blocked on precisely the same thing the product thesis is blocked on: **closing the loop.** That is a strategically fortunate alignment, because one body of work unlocks both.
