# D0 — Audit Charter
**Deep Launch-Readiness Audit · Brandosse (repo: `social-media-agent`)**
Date: 2026-08-20 · Phase 0 output · **Status: awaiting Gate 0 approval**

> This document contains **no audit findings**. Phase 0 is recon and orchestration design only.
> Every "exists" statement below is backed by a path from a directory listing or file read.
> Every statement about *behavior* is marked **UNVERIFIED** and deferred to Phase 1.

---

## 1. Repo Map

### 1.1 Stack (verified from manifests)

| Layer | Technology | Evidence |
|---|---|---|
| Framework | Next.js 16.2.6, App Router | `package.json:39` |
| UI runtime | React 18.3.1 | `package.json:40-41` |
| Language | Mixed JS/JSX (majority) + TS/TSX (video-engine, API routes only); TypeScript 6.0.3 | `package.json:57`, route table §1.2 |
| Styling | Tailwind 4.3 + Chakra UI 3.29 + Emotion + SCSS (`sass-embedded`) — **four styling systems in one app** | `package.json:22,26,34,55` |
| State | Zustand 5, XState 5, TanStack Query 5 (+ persist) | `package.json:30-33,46-47` |
| Backend | Supabase (Postgres + Auth + Storage + Edge Functions/Deno) | `package.json:27-28`, `supabase/functions/**` |
| Async worker | Python service (`video-worker/`), Railway-targeted | `video-worker/railway.toml`, `video-worker/main.py` |
| AI SDKs | `groq-sdk` 0.37, `replicate` 1.4; Anthropic + fal.ai via HTTP (no SDK in manifest) | `package.json:37,42`; `.env.example` keys |
| Payments | Stripe SDK 22.1 **and** Paystack (env keys only, no SDK) | `package.json:43`; `.env.example` `PAYSTACK_SECRET_KEY` |
| E2E | Playwright 1.60, one spec file | `playwright.config.cjs`, `tests/e2e/real-user-flows.spec.js` |
| CI | GitHub Actions — **build-only, no test or lint job** | `.github/workflows/ci.yml:9-40` |

### 1.2 Size

| Area | Lines | Notes |
|---|---|---|
| `src/` | 93,829 | The application. Largest single file: `src/stores/SessionStore.js` (4,213 lines) |
| `supabase/functions/` | 15,565 | 51 edge functions |
| `video-worker/` (stages + utils) | 4,785 | Python pipeline |
| `app/` | 1,958 | Next.js route shells that mount `src/pages/*` |
| `tests/` | 300 | 1 Playwright spec |
| `scripts/` | 194 (+ ~40 ad-hoc `qa-*.cjs` files) | Verification scripts |

**Structural note (recon-level):** `app/**` is a thin route shell; nearly all logic lives in `src/pages/**`, `src/components/**`, `src/services/**` — i.e. a client-side SPA wearing an App Router skin. Illustrated by `app/[...path]/page.jsx:1-11`, which mounts `@/pages/NotFoundPage` inside a provider wrapper. **Implication: server components / RSC data-fetching may not be in use, which bears on P9 (time-to-first-value) and P10 (cost/latency). UNVERIFIED — Phase 1 confirms.**

### 1.3 Route table (79 routes, from `find app -type f`)

**Public / auth (12):** `app/page.jsx`, `login`, `register`, `complete-signup`, `forgot-password`, `reset-password`, `auth/callback`, `join`, `select-context`, `generate` (public), `review/[clientReviewToken]`, `app/[...path]` (404 catch-all)

**Personal dashboard — IN SCOPE (19):**
`app/app/page.jsx`, `dashboard`, `generate`, `generate/[sessionId]`, `calendar`, `library`, `analytics`, `onboarding`, `help`, `profile`, `settings`, `settings/brand-kit`, `settings/connect`, `billing`, `billing/credits`, `design`, `video/new`, `video/jobs`, `video/jobs/[id]`

**Video engine — duplicate surface (3):** `app/(video-engine)/video/new`, `video/jobs`, `video/jobs/[id]` (`.tsx`) exist **alongside** `app/app/video/*` (`.jsx`). **Two video UIs in the tree. UNVERIFIED which is live — Phase 1 must determine and flag the dead one.**

**Org / multi-tenant — OUT OF SCOPE per brief §1 (17):** `app/app/org/[orgId]/**`

**Admin — OUT OF SCOPE (13):** `app/app/admin/**`

**API routes (11):** `api/video/submit`, `api/video/jobs`, `api/video/jobs/[id]`, `api/video/clips/[id]/refresh-url`, `api/credits/balance`, `api/credits/purchase`, `api/webhooks/stripe`, `api/session-title`, `api/health/video-schema`, `api/auth/zernio/{connect,callback,available}`

### 1.4 Edge functions (51, `supabase/functions/`)

Grouped by probable pillar (**mapping UNVERIFIED — Phase 1 confirms**):

- **Ideation / planning (P1/P2):** `prompt-suggestions`, `ai-generate-brief`, `generate-content-plan`, `calendar-ai`, `enhance-prompt`
- **Text generation (P3):** `generate-caption`, `generate-post-metadata`, `ai-brand-consistency-check`, `quality-gate`, `extractBrandKit`
- **Media generation (P4):** `generateImage`, `editImage`, `upscaleImage`, `generateVideo`, `cancel-video-job`, `job-webhook`, `process-jobs`
- **Publishing (P6):** `publish-post`, **`mock-publish`**, `org-calendar-publish`, `detect-account-failures`
- **SEO (P7):** `optimize-seo`, `seo-score`
- **Analytics (P8):** `daily-analysis`, `process-risk-alerts`
- **Credits / ops (P10):** `credit-monthly-reset`, `credit-request-action`, `healthCheck`, `_shared/*`
- **Org / admin (out of scope):** ~20 `org-*`, `admin-*`, `pipeline-*` functions

### 1.5 Data model (65 tables, from `CREATE TABLE` across 90 files in `supabase/migrations/`)

Pillar-relevant tables: `sessions`, `generations`, `posts`, `content_plans`, `content_versions`, `content_templates`, `content_library_items`, `studio_projects`, `brand_kit`, `brand_assets`, `brand_projects`, `personal_assets`, `media_assets`, `connected_accounts`, `connection_events`, `platform_registry`, `mock_publish_logs`, `video_jobs`, `video_clips`, `video_transcripts`, `background_jobs`, `user_credits`, `credit_transactions`, `credit_events`, `rate_limit_events`, `audit_logs`, `ai_session_logs`, `user_settings`, `user_notifications`.

> ⚠️ **Known schema-truth risk:** the live Supabase schema is ahead of the CLI migration-history table. Migrations are therefore **evidence of intent, not proof of live schema**. Phase 1 must state which claims rest on migration files versus verified live schema. See Q4.

### 1.6 Video pipeline (`video-worker/`, Python)

Stages: `download.py`, `transcribe.py`, `analyze.py`, `render.py`, `stitch.py` (`video-worker/stages/`)
Utils: `clip_selector.py`, `face_tracker.py`, `cursor_tracker.py`, `scene_classifier.py`, `caption_generator.py`, `video_reframer.py`, `transcript_parser.py`, `ffmpeg_utils.py`, `storage_uploader.py`, `llm_client.py`, `url_validator.py`
Orchestration: `main.py`, `job_runner.py`, `poller.py`, `database.py` (19KB)

**This is the P5 (clipping) engine, and it is substantial.** Whether it is deployed, reachable, and producing quality output is **UNVERIFIED** — Phase 1 plus Q6.

### 1.7 Environment surface (30 keys)

Recon-level signals for Phase 1 to chase:

- `VIDEO_ENGINE_USE_MOCK_ANTHROPIC`, `VIDEO_ENGINE_USE_MOCK_REPLICATE`, `VIDEO_ENGINE_USE_MOCK_PAYMENTS` (`.env.example`) — three mock switches in the video path.
- `FAL_API_KEY` is present in `.env.example` and `.github/workflows/ci.yml:37` but **absent from `.env.local`**; `REPLICATE_API_TOKEN` is present in `.env.local` but **absent from `.env.example`** — provider drift between documented and actual config.
- Both `STRIPE_SECRET_KEY` and `PAYSTACK_SECRET_KEY` — two payment providers.
- `ZERNIO_API_KEY` plus `app/api/auth/zernio/*` — a publishing-provider integration.
- Files `src/services/platforms/mockPublishService.js`, `mockPublishWorkflow.js`, `mockOAuthProvider.js`, `src/services/MockOAuthService.js`, and edge function `mock-publish` exist. **Whether real publishing exists alongside these is UNVERIFIED and is the single highest-priority Phase 1 question for P6.**

### 1.8 Two design systems in-tree

`src/ui-v2/` (23 primitives + 8 shell files) exists alongside `src/styles/` (25 files) and Chakra/Emotion/Tailwind. Prior session state records a locked "Design System v2" rewrite intended to proceed screen-by-screen. **Migration completeness UNVERIFIED** — material to P9 and to what "complete" means. See Q7.

### 1.9 Existing documentation (not treated as evidence)

`docs/` (107 files), `audit-brief/` (12 files), `FUNCTIONAL-SPEC.md` (112KB), `GRAPHICS_*.md` (4 files), `praise-presentation/`.
**Per §2.1, none of this counts as evidence of what works.** Docs will be used only to (a) locate code and (b) generate falsifiable claims to test against code. Where docs and code disagree, that disagreement is itself a finding.

### 1.10 Tooling constraint

`.claude/hooks/block-prod-code-until-mockup-approved.js:9-11` denies Write/Edit against `src/**`, `supabase/migrations/**`, and `supabase/functions/**` unless `docs/calendar-library-rebuild/MOCKUP_APPROVED` exists. **This audit is read-only and therefore unaffected**, but it will block Phase 6 execution work later. Noted for the roadmap, not for this pass.

---

## 2. Skill Plan

**Finding: `/mnt/skills` does not exist in this environment, and there is no project-local `.claude/skills/` directory** (verified). The skills named in the brief (`spec-miner`, `the-fool`, `feature-forge`, `security-reviewer`, `code-reviewer`, `test-master`, `architecture-designer`, `api-designer`, `monitoring-expert`, `database-optimizer`, `playwright-expert`, `debugging-wizard`) **do exist** — as part of the installed `fullstack-dev-skills` plugin, invocable via the Skill tool. Mapping below.

| Phase | Skill | Why |
|---|---|---|
| 1 | `fullstack-dev-skills:spec-miner` | Reverse-engineer actual behavior from undocumented code — exactly the problem in a 94k-line codebase carrying 107 possibly-stale docs. |
| 1 | `fullstack-dev-skills:debugging-wizard` | Trace execution paths end-to-end (the brief's mandatory per-pillar E2E trace). |
| 1 | `fullstack-dev-skills:code-reviewer` | Broad correctness and smell sweep, feeding the BUILT-BUT-INADEQUATE hunt. |
| 1 (P10) | `fullstack-dev-skills:security-reviewer` | Secrets, token storage, RLS and tenancy leakage. |
| 1 (P10) | `fullstack-dev-skills:postgres-pro` + `database-optimizer` | 65 tables, RLS-dependent; index, N+1, and scale review. |
| 1 (P10) | `fullstack-dev-skills:monitoring-expert` | Observability gap assessment — what is logged, what can be known in production. |
| 1 (P10) | `fullstack-dev-skills:test-master` | Coverage reality: 1 spec file against 94k lines. |
| 1 | `fullstack-dev-skills:nextjs-developer` | Judge the App-Router-as-SPA pattern against framework-correct usage. |
| 1 (P4/P5) | `fullstack-dev-skills:python-pro` | `video-worker` is Python; required for a real read of the clipping pipeline. |
| 3 | `fullstack-dev-skills:architecture-designer` | Autonomy-ladder assessment as an architectural judgment. |
| 4 | `fullstack-dev-skills:feature-forge` | EARS-format acceptance criteria — mandated for D4. |
| 7 | `fullstack-dev-skills:the-fool` | Red team, per brief §4 Phase 7. |
| — | `dataviz` | Only if D5's scorecard warrants a visual. Optional. |

**Explicitly NOT used, with reason:** `architecture-designer`'s ADR-authoring mode (we are auditing, not deciding); `secure-code-guardian` and `fullstack-guardian` (implementation skills — this pass writes no product code); every framework-specific builder skill (Django, Rails, Laravel, Spring, Vue, Angular, Flutter, etc. — wrong stack, wrong mode); `api-designer` (we assess the existing interface, we do not design a new one); `code-documenter` (this repo's problem is too much documentation, not too little).

**Note on `playwright-expert` and live-app skills:** relevant only if Q3 is answered "yes, run the app." Held pending.

---

## 3. Sub-Agent Roster

Agents are drawn from the installed roster in `.claude/agents/` plus built-ins. Each entry gives mission, boundary, base type, output, and anti-goal.

> **Global anti-goals binding on every agent:**
> 1. Never assert behavior without a `file:line` citation — write `UNVERIFIED` instead.
> 2. Never rate a capability `COMPLETE`. Only `completion-architect` and `gap-synthesizer` may, and only against D4.
> 3. Never propose a new feature. Ideas route to the Horizon Register.
> 4. Never soften a finding because the fix looks expensive.

### 3.1 Phase 1 — Ground Truth

| # | Agent | Base type | Mission | Boundary | Output | Anti-goal |
|---|---|---|---|---|---|---|
| A1 | `codebase-cartographer` | `Explore` (very thorough) | Architecture, module dependency graph, data-model map, dead code, duplicate surfaces (the two video UIs, ui-v2 vs legacy) | Structure only, no quality judgments | `findings/A1-cartography.yaml` + diagram source | Does not audit features or rate maturity |
| A2 | `pillar-auditor:P1` | `backend-functionality` | Ideation: `prompt-suggestions`, `ai-generate-brief`, `enhance-prompt`, `intentExtractor.js`, `suggestedPrompts.js`, `briefBuilder.js` | P1 only; hands off at brief→plan | `findings/P1-*.yaml` | Does not fix; does not stray into adjacent pillars |
| A3 | `pillar-auditor:P2` | `backend-functionality` | Planning: `generate-content-plan`, `calendar-ai`, `src/calendar/**`, `src/pages/Calendar/**`, `content_plans` | Personal calendar only; `src/org/**` excluded | `findings/P2-*.yaml` | Same |
| A4 | `pillar-auditor:P3` | `backend-functionality` | Text generation: `generationPipeline.js`, `llmClient.js`, `groqClient.js`, `_shared/llm.ts`, `generate-caption`, `quality-gate`, `SessionStore.js`, Studio | Text only; media routes to A5/A7 | `findings/P3-*.yaml` | Must not stop at "it returns text" — must judge prompt, model, versioning, cost |
| A5 | `video-pipeline-specialist:P4` | `general-purpose` + `python-pro` | Video **generation**: `generateVideo`, `job-webhook`, `process-jobs`, `api/video/*`, `src/lib/video-engine/**`, `video_jobs`; providers, cost/sec, queue, failure handling | Generation only | `findings/P4-*.yaml` | Must trace mock-flag behavior, not assume real providers |
| A6 | `video-pipeline-specialist:P5` | `general-purpose` + `python-pro` | Video **clipping**: all of `video-worker/**` — ingest → transcribe → `clip_selector` → `face_tracker`/`video_reframer` → `caption_generator` → `stitch` → `storage_uploader` | Clipping only | `findings/P5-*.yaml` | **Must answer explicitly whether moment selection is intelligent or naive chunking.** No hedging |
| A7 | `pillar-auditor:P4-image` | `backend-functionality` | Image generation: `generateImage`, `editImage`, `upscaleImage`, fal/Freepik/Replicate routing, credit deduction | Image only | `findings/P4i-*.yaml` | Same |
| A8 | `pillar-auditor:P6` | `backend-functionality` | Publishing: `publish-post` vs `mock-publish`, `connected_accounts`, Zernio OAuth, scheduling cron (`process_scheduled_posts`), retries, token refresh | Personal publishing only | `findings/P6-*.yaml` | **Must state unambiguously whether any real post ever reaches any platform** |
| A9 | `pillar-auditor:P7` | `backend-functionality` | SEO and reach: `optimize-seo`, `seo-score`, the discovery-score system, hashtags, hooks, cold-start path | P7 only | `findings/P7-*.yaml` | Must not credit an "SEO score" as reach engineering without tracing what computes it |
| A10 | `pillar-auditor:P8` | `backend-functionality` | Analytics and **loop closure**: `daily-analysis`, `src/pages/AnalyticsPage/**`, data provenance (real platform data or synthetic?), and whether any output mechanically re-enters P1/P2/P3 | P8 only | `findings/P8-*.yaml` | Must grade loop closure by tracing a write path, not by the existence of a chart |
| A11 | `pillar-auditor:P9` | `ux-product-critic` | Shell: IA and navigation, onboarding, empty states, TTFV, cross-pillar state continuity, search, notifications, responsive, accessibility | Personal dashboard shell | `findings/P9-*.yaml` | Not aesthetics — judged against persona task completion |
| A12 | `foundations-auditor:P10-sec` | `security-auditor` | Auth, RLS, token storage, secrets, IDOR, tenancy leakage, rate limits | Security only | `findings/P10s-*.yaml` | No fixes; no CVE theater |
| A13 | `foundations-auditor:P10-scale` | `devops-scalability` | Jobs and queues, cron reliability, storage/media pipeline, N+1s, indexes, CI/CD, cost per active user | Scale and ops only | `findings/P10o-*.yaml` | Must produce a real cost-per-user number or say UNVERIFIED with what is needed |
| A14 | `foundations-auditor:P10-qual` | `general-purpose` + `test-master` | Test coverage, error handling, `catch {}` swallows, unhandled promises, observability, env config drift | Quality and observability | `findings/P10q-*.yaml` | Same |

### 3.2 Phase 1b — Persona reality

| # | Agent | Base type | Mission | Output | Anti-goal |
|---|---|---|---|---|---|
| A15 | `persona-simulator:power-migrant` | `frontend-visual-qa` (live) or `ux-product-critic` (static) | Walk the golden path as someone migrating from Buffer / Opus Clip / Jasper; log friction step by step | `findings/PM-*.yaml` | Must not grade on intent — only on what the screen actually does |
| A16 | `persona-simulator:casual-operator` | same | Walk first-run unaided: signup → brand kit → first post; log every decision demanded before first value | `findings/CO-*.yaml` | Same |

> Mode depends on Q3. Static mode is materially weaker and will be labeled as such in D1.

### 3.3 Phase 2 — External reality

| # | Agent | Base type | Mission | Output | Anti-goal |
|---|---|---|---|---|---|
| A17 | `market-analyst:suites` | `biz-cofounder` | All-in-one competitors (Buffer, Hootsuite, Later, Metricool, Publer, Postiz, …): features, pricing, complaints, last-12-months shipping | `02-market-reality.md` §1 | No invented features; URL plus access date on every claim |
| A18 | `market-analyst:point-tools` | `general-purpose` | Best-in-class single-purpose tools per pillar (Opus Clip / Vizard / Klap for P5; Runway / Kling / Veo / Sora for P4; Jasper / Copy.ai for P3; VidIQ / TubeBuddy for P7) | §2, §5 | Same |
| A19 | `reach-analyst` | `growth-marketer` | P7 reality check: current platform discovery mechanics; what genuinely helps a zero-audience account versus cargo cult | §4 | Must separate evidence from folklore explicitly |
| A20 | `unit-economist` | `finance-ops` | Cost per active user per month at current architecture, per pillar; model viability | §6 | Must show the arithmetic |

### 3.4 Phases 3–7 — Synthesis

| # | Agent | Base type | Mission | Output | Anti-goal |
|---|---|---|---|---|---|
| A21 | `gap-synthesizer` | `general-purpose` | Merge D1 × D2; dedupe; classify into the four failure classes; rank by severity × blast radius; build the Inadequacy List and Silent Failures | `03-gap-analysis.md` | May not drop a finding for being large; may not merge distinct classes |
| A22 | `loop-integrity-analyst` | `technical-cofounder` | Walk P1 → P2 → P3 → P4/5 → P6 → P7 → P8 → P1; mark every handoff INTACT / LOSSY / BROKEN with the code that carries or drops context | `03` §Loop Integrity | Must cite the carrier — the field, table, or param — for every INTACT verdict |
| A23 | `autonomy-assessor` | `technical-cofounder` + `architecture-designer` | Rate Manual → Assisted → Supervised-Agentic → Autonomous readiness; name the specific runway and wall decisions | `03` §Autonomy Ladder | **Assessment only — proposes nothing** |
| A24 | `completion-architect` | `general-purpose` + `feature-forge` | Definition of Complete per existing capability: EARS criteria, measurable quality bar, persona acceptance tests, edge cases, observability, out-of-scope | `04-definition-of-complete.md` | May not define completion for anything that does not already exist |
| A25 | `roadmap-sequencer` | `tech-lead` | Dependency-ordered Phase A–E plan; critical path; parallelization map; effort and risk per item | `06`, `07` | **Completion Lock enforcement point — zero new features** |
| A26 | `red-team` | `devils-advocate` + `the-fool` | Attack the audit: untraced claims, generous ratings, optimistic estimates, omissions, what would break the verdict | `09-red-team.md` | May not defend prior work; must name at least one thing the audit omitted |
| A27 | `verdict-owner` | orchestrator (me) | Scorecard, readiness %, Go/No-Go, MCL, three scenarios, top-10 risks | `05-launch-readiness.md` | Verdict must be unambiguous; no "it depends" |

**Roster total: 26 sub-agent runs plus the orchestrator.** Sequencing and cost are Q1.

---

## 4. Shared Finding Schema

The brief's schema is adopted **verbatim**, with three additions (marked ➕) that the synthesis phases need:

```yaml
finding_id: P4-017              # <PILLAR>-<3-digit seq>
pillar: P4
capability: "video render queue"
status: BUILT-BUT-INADEQUATE    # MISSING | STUBBED | BUILT-BUT-INADEQUATE | COMPLETE
maturity: L2                    # L0..L5
evidence:                       # REQUIRED, non-empty, file:line-line
  - "src/jobs/render.ts:44-91"
  - "src/api/video/route.ts:12-30"
observed_behavior: "..."        # what the code actually does
expected_behavior: "..."        # from persona + competitor benchmark
persona_impact:
  power_migrant: "..."
  casual_operator: "..."
severity: BLOCKER               # BLOCKER | MAJOR | MINOR | POLISH
blast_radius: ["P6", "P8"]
effort: L                       # XS|S|M|L|XL
confidence: HIGH                # HIGH | MEDIUM | LOW
unverified_notes: "..."
# ➕ additions
effort_reasoning: "..."         # why that size — blocks unfalsifiable estimates
trace_id: "T-P4-01"             # links to the E2E trace in D1 that produced it
source_agent: "A5"              # attribution, so the red team can target a weak auditor
```

**Validation rules enforced at synthesis:**

1. Empty `evidence` → the finding is rejected, unless `status: MISSING` **and** `unverified_notes` names the searches performed.
2. `status: COMPLETE` is rejected outright in Phase 1. It can only be assigned in Phase 4+ against a written D4 definition.
3. `severity: BLOCKER` requires either a table-stakes citation from D2 or a data-loss / security trace.
4. Both `persona_impact` keys are required, non-empty, and non-identical.

Files land in `audit/findings/<AGENT>-<PILLAR>.yaml`, one document per agent per pillar.

---

## 5. Phase Gates

| Gate | After | I stop and present | You approve |
|---|---|---|---|
| **Gate 0** | Phase 0 | This charter plus open questions | Roster, scope, budget → **YOU ARE HERE** |
| **Gate 1** | Phase 1 | D1 summary plus the full maturity table | Ground truth before market-research spend |
| — | Phase 2 | D2 emitted, no gate (brief specifies none) | — |
| **Gate 3** | Phase 3 | D3 gap analysis | Gap picture before writing completion definitions |
| — | Phases 4–6 | D4–D8 emitted, no gate | — |
| **Final** | Phase 7 | D9 plus revised D1–D7 plus README | — |

---

## 6. Assumptions (correct any that are wrong)

| # | Assumption | Impact if wrong |
|---|---|---|
| A-1 | "Personal dashboard" means the 19 `app/app/*` routes in §1.3, excluding `org/**` and `admin/**` | Scope changes by roughly 40% of `src/` |
| A-2 | `src/org/**` and `src/admin/**` are audited **only** where they foreclose the personal-dashboard trajectory | Otherwise, two more pillars of work |
| A-3 | Launch means a public, paid launch of the personal dashboard — not a private beta | Changes the entire launch floor and the MCL |
| A-4 | Migration files are evidence of intent; live schema is authoritative and may differ | Data-model findings drop to MEDIUM confidence without live access |
| A-5 | "We" is a solo founder plus AI assistance, not a team | Every effort→timeline conversion in D5/D6 changes |
| A-6 | The audit is read-only; no code changes this pass | — |
| A-7 | Video generation (P4) and clipping (P5) are both intended launch surfaces, not experiments | If experimental, they leave the launch floor and the readiness % changes materially |
| A-8 | Web research in Phase 2 is permitted and expected | D2 becomes UNVERIFIED throughout |

---

## 7. Open Questions — answers needed before Phase 1

**Q1 — Agent budget.** The roster is 26 sub-agent runs against a 94k-line codebase. This is the dominant cost of the audit. Options: (a) full 26-agent roster, Opus for A5/A6/A12/A21/A26 and Sonnet elsewhere; (b) a compressed ~12-agent roster merging related pillars; (c) I run Phase 1 myself with no sub-agents — slowest wall-clock, cheapest, most consistent voice. My standing instruction is not to spawn agents unless asked; your brief asks, so I want this confirmed explicitly.

**Q2 — Org and Admin scope.** `src/org/**` and `src/admin/**` are a large share of the codebase and 30 of 79 routes. Confirm: ignore entirely except where they foreclose the personal trajectory? Or does admin count under P10 foundations, given it touches moderation, credits, and user state?

**Q3 — Live app access.** May I run the app (`npm run dev`) and drive it with Playwright using the QA test account, for the persona simulations and E2E traces? Prior tooling exists (`scripts/qa-*.cjs`, `tests/e2e/real-user-flows.spec.js`). Without it, persona findings are code-inferred — materially weaker, and §2.1 forbids me from dressing inference up as observation.

**Q4 — Database truth.** Migration history is known to have drifted from the live schema. May I query the live Supabase schema read-only (CLI / psql / MCP)? If not, data-model findings ship at MEDIUM confidence and I will label every one.

**Q5 — Publishing reality.** Both `publish-post` and `mock-publish` edge functions exist, plus four mock modules under `src/services/platforms/`. Rather than guess: is real publishing to any platform live today, and if so, which? I will verify in code regardless — your answer tells me whether a mismatch is a finding or a known state, which changes severity.

**Q6 — Video worker deployment.** Is `video-worker/` actually deployed and running on Railway, or local-only? And is `FAL_API_KEY` missing from `.env.local` deliberate — i.e. did you move to Replicate?

**Q7 — `ui-v2` status.** Is the Design System v2 rewrite in flight, paused, or abandoned? This decides whether "complete" for P9 means *finish the v2 migration* or *polish what ships today* — a large difference in D4 and D6.

**Q8 — Launch target.** Is there a date or a runway constraint? D5 asks for Aggressive / Realistic / Safe scenarios with timelines; without an anchor those are unanchored guesses, and unanchored guesses are what §2.7 forbids.

**Q9 — The L5 candidate.** The brief requires at least one pillar at L5 or the product has no reason to exist. Which pillar do *you* believe is the differentiator? I will assess it honestly either way — but if my read differs from yours, that gap is itself one of the most important outputs of this audit, and I want it on the record before I start rather than after.

---

## 7b. Gate 0 Resolutions (answered 2026-08-20)

| Q | Answer | Effect on the audit |
|---|---|---|
| **Q1 — Agent budget** | **Full 26-agent roster.** Opus for A5, A6, A12, A21, A26; Sonnet elsewhere | §3 roster runs as designed |
| **Q2 — Org/admin scope** | **Exclude; note foreclosures only** | Assumptions A-1 and A-2 confirmed. `src/org/**` and `src/admin/**` are audited only where they foreclose the personal-dashboard trajectory |
| **Q3 — Live app** | **Yes — run it with the QA account** | A15/A16 run in live mode via Playwright. **Blocked on credentials — see §7c** |
| **Q4 — DB truth** | **Yes — read-only live schema access** | Resolved and already exercised, see below. Assumption A-4 upgraded: live schema is now directly observable |

### Q4 — access method verified

Live schema is readable read-only through the PostgREST OpenAPI document, using `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` already present in `.env.local`. No database password and no `supabase link` required. Verified: `GET {SUPABASE_URL}/rest/v1/` → HTTP 200, 608KB, full table/column/RPC definitions.

**This yields table, column, type, and RPC ground truth. It does NOT expose RLS policies** — policy claims will still rest on `supabase/migrations/**` plus behavioral probing, and will be labeled MEDIUM confidence where unverified.

**Immediate result — the drift is real and larger than expected:**

- **89 live tables/views** versus **65 `CREATE TABLE` statements in migrations**.
- **50 live RPC functions.**
- Live-only tables with direct pillar relevance, absent from migration files: `trending_topics`, `content_pillars`, `optimal_posting_times`, `platform_analytics`, `analytics_summary`, `ghost_slots`, `scheduled_generations`, `generation_sessions`, `generated_content`, `generation_assets`, `generation_metadata`, `calendar_settings`, `platforms`, `profiles`, `moderation_queue`, `notification_tasks`, `contact_inquiries`, `admin_keys`, `admin_logs`.
- **Lead for Phase 1 (UNVERIFIED, not yet a finding):** live-only objects `learning_gaps`, `milestones`, `progress_summaries`, `seed_parent_dashboard()`, `is_tutor_for_session()` are education/tutoring-domain objects with no plausible role in a content system. This is consistent with the database having been forked from a prior tutoring product. A1 and A12 must determine whether these are inert residue or load-bearing — `is_tutor_for_session()` appearing in RLS policy paths would be a security concern, not merely dead schema.

> Consequence for the whole audit: `trending_topics`, `content_pillars`, and `optimal_posting_times` are exactly the P1/P2/P7 substrate the product thesis needs. That they exist live but not in migrations means **neither the migrations nor the docs can be trusted to describe this system.** Phase 1 works from live schema plus code, and nothing else.

## 7c. Remaining blocker before Phase 1

**QA account credentials.** `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` / `E2E_BASE_URL` are documented in `.env.example` but **carry no values in `.env.local`** (verified — zero `e2e_`/`qa_` matches). Live persona simulation therefore cannot start. Options:

1. You supply the QA account email and password.
2. You authorize me to run `scripts/qa-create-test-user.cjs`, which would create a test user in the **live** Supabase project using the service-role key — a write to production auth, so I will not do this unsolicited.
3. Fall back to static mode for A15/A16, with every persona finding explicitly labeled code-inferred.

Q5 through Q9 remain open but are **not blocking**: Q5 (publishing reality), Q6 (worker deployment), and Q7 (`ui-v2` status) are things Phase 1 verifies in code regardless — your answers only change whether a mismatch is graded as a surprise or a known state. Q8 (launch target) and Q9 (your L5 candidate) are first needed at D3/D5.

---

## 8. What happens on approval

Phase 1 begins immediately: A1 maps the architecture; A2–A14 run per pillar with mandatory end-to-end traces; A15 and A16 walk the personas. Output: `audit/01-ground-truth.md` plus `audit/findings/*.yaml`, then **Gate 1**.

---

## 7d. Gate 0 Resolutions — round 2 (answered 2026-08-20, late)

| Q | Answer | Effect |
|---|---|---|
| **Q8 — Launch target** | **No fixed date; quality gates the launch** | D5 scenarios express effort in weeks of solo-founder work, not calendar dates. Assumption A-3 holds (public launch), A-5 holds (solo). |
| **Q9 — L5 candidate** | **"All have to be there — it's all non-negotiable"** | Recorded as founder intent. Coherent with Q8: unlimited time + universal excellence. D5 must still state honestly what all-pillars-L5 costs and what the dependency order must be, since they cannot be built simultaneously. |
| **Q7 — ui-v2** | **Target state — finish the migration** | P9 "complete" = every in-scope route runs on `src/ui-v2/`. Migration completion fraction becomes a required D1 measurement. |
| **Q6 — Video scope** | **Both P4 and P5 are launch surfaces; worker is deployed** | Both stay in the launch floor at L3+ minimum. NOTE: conflicts with finding P5-001 (worker deployment graded BLOCKER). Orchestrator to verify against the live system — neither the founder's belief nor the agent's finding is accepted without evidence. |

**Operating change requested:** run slower and more carefully; prefer depth over parallelism. Agent concurrency capped at 2.

**Final deliverable clarified by the founder:** beyond D0–D9, the audit must end with an explicit completion list **separated into (a) what already exists and needs finishing/reconnecting, and (b) what must be built from scratch.** This is the Completion Lock made concrete and maps directly onto finding status: `BUILT-BUT-INADEQUATE` + `STUBBED` = exists; `MISSING` = new build. It will be emitted as `10-completion-split.md`.
