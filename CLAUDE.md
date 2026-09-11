# ⚠️ Engineering Standards — read before writing any code

Full standards in [`engineering/`](engineering/). They are enforced, not aspirational: every rule exists because the 2026-08 launch audit (117 findings, [`audit/`](audit/)) found a specific defect it would have prevented.

## The three laws

**1. A change is not done until it is `fixed + proven + guarded`.**
Fixed = defect corrected. Proven = an automated check shows it is correct now. Guarded = that check runs continuously.
*Every serious finding in this codebase was working code that silently degraded — Groq failed 100% for days, trend data was fabricated for five months, 20 posts froze for four months. **None was detected.** A fix without a detector has a demonstrated half-life here.*

**2. Code is the source of truth. Documentation is a claim.**
Where a doc and the code disagree, **the doc is a bug** — fix or delete it. This repo has **264 markdown files under `docs/`** (170 tracked). Measured 2026-08-22: 38 current-state docs still make claims the code contradicts — dead providers, deleted directories, `-latest` model IDs. Do not trust them; verify against code. Do not add to them (see `engineering/03-documentation.md`).

**3. Nothing may silently no-op, show fabricated data, or lose user content.**
All three were being violated when the audit ran.

## Non-negotiables

- **Evidence or silence.** Every claim about what exists carries `file:line`. Cannot cite it → write `UNVERIFIED`. Never infer behaviour from a filename, route name, README, comment, type, or UI label. **A component that renders is not a feature that works** — trace to the handler, worker, DB write, or third-party call.
- **Check the caller, not just the code.** This repo's dominant defect is *disconnection, not absence*. Still true today: `OptimalTimesService.js` — 466 lines, imported nowhere (verified 2026-08-22). Closed by the lockdown, and worth knowing because each was working code nobody could reach: `generate-caption` was correct and called by nothing (L4.3), `week_plan` was generated and thrown away (L2.4), `clip_selector.py` was 292 dead lines (L3.2, deleted). Before writing something new, check whether it already exists unwired.
- **Migrations are the only way schema changes.** No SQL Editor edits. **Never `supabase db push` without a diff** — live schema is drifted (89 tables live vs 65 in migrations). Migrations must be idempotent, transactional, and assert their post-condition.
- **RLS changes require the behavioural probe**, not policy reading: `node scripts/security/cross-tenant-probe.mjs`. Service-role reads bypass RLS and prove nothing.
- **Fail closed.** Mock modes are opt-in and never default. Missing credentials refuse startup rather than failing at runtime.
- **Every outbound call needs a timeout.** Every non-terminal state needs a reaper.
- **Pin model IDs explicitly.** Never `-latest` for production output. A provider fallback firing is an alerting event.
- **No secrets in git**, including in documentation.

## 👥 The twenty-specialist standard — how output is calibrated

**Founder ruling, 2026-08-30:** one person builds this repo, but **nothing in it
may be scoped, designed, or shipped as if one person built it.** Calibrate every
result to what a team of twenty highly skilled specialists — each strong in a
different discipline — would have produced. Solo capacity is not a constraint
here and must never be used as a reason for a smaller answer.

**What this forbids, concretely.** These are the tells that a decision was sized
to one person's effort rather than to the problem:

- Choosing the approach that is less work over the approach that is correct.
- "Good enough for now", "MVP-quality", "we can improve this later", "acceptable
  for a solo project" — as *justifications*. Deferring work is fine when the
  reason is sequencing or evidence; it is not fine when the reason is effort.
- Capping a feature at what is easy to hand-write (a 7-word text limit because
  the text engine cannot wrap is a defect, not a spec).
- Shipping a change reviewed only for "does it work", when a security, data
  integrity, performance, accessibility, mobile, or cost specialist would each
  have had a distinct objection.
- Serialising work that has no dependency between its parts.

**What this requires.**

1. **Every change gets the specialist passes it deserves**, not just the ones
   that are convenient — the review chain in `engineering/02-code-review.md` is
   the floor, not the ceiling.
2. **Parallelise by discipline.** Where a task decomposes into independent
   specialisms, spawn an agent per specialism rather than doing them in
   sequence. `.claude/agents/` already holds the roster; treat each as the
   employee who owns that discipline.
3. **Depth is judged against the specialist, not the generalist.** The bar for
   the render layer is what a broadcast engineer would accept; for RLS, what an
   appsec reviewer would accept; for a screen, what a senior product designer
   would accept.
4. **When effort and quality conflict, quality wins, and the cost is stated** —
   surface the extra work as a plan, never silently absorb it as a smaller
   deliverable.

This standard governs planning, scoping, code, review, and documentation alike.

## ⚠️ Open decisions — check before planning work

[`OPEN-DECISIONS.md`](OPEN-DECISIONS.md) holds founder decisions that are
**blocking engineering work**. Read it before proposing a plan — some work is
blocked on a decision, not on effort, and proposing it anyway wastes a cycle.

Currently open: **none.** OD-1 closed 2026-08-23 — stay on the Zernio free
tier, which unblocks L5.1 and the four pillars behind it at zero cost.

**The standing consequence, because it will bite exactly once:** the free tier
is **2 connected accounts across the whole API key**, not per user. Enough to
build and prove the loop; not a configuration any real user can be onboarded
into. The per-account pricing question is deferred to the first real user, not
answered — do not plan a launch that assumes it is.

## 🔓 Completion Lockdown — LIFTED

**LIFTED 2026-08-31 by founder decision.** The bar on new capability is removed. New work — new tables, new third-party integrations, new surfaces — is now in scope and is planned and built like any other work.

**What the lockdown produced, which survives it.** The three laws above, the non-negotiables, the review chain, and the guard requirement all remain. They were never about *whether* to build; they were about how a change is proven and kept working. A new capability is held to exactly the same `fixed + proven + guarded` bar as a repair.

**What is still genuinely outstanding** (tracked in [`audit/11-lockdown-plan.md`](audit/11-lockdown-plan.md), not blocking): the cost ledger (L5.14), clip analysis truncation (L5.3a), Python worker error instrumentation (L0.4b), and the unreferenced-module detector (Gate 3). These are finished on their merits, not as a gate on other work.

**One rule kept from the lockdown, because it earned its place:** before building something, check whether it already exists unwired. This repo's dominant defect is disconnection, not absence — five separate surfaces were found holding live brand data that no consumer reads. Connecting is usually cheaper than building, and it is the first thing to rule out, not a reason to refuse the build.

## Review before merge

Run the agentic passes in [`engineering/02-code-review.md`](engineering/02-code-review.md): correctness → security → **wiring** → **guard** (blocking) → red team. **A change with no guard is not approved.**

---

# Solo Founder Agent Team

Six advisory subagents live in `.claude/agents/` to cover the non-engineering
sides of running this project solo: business validation, product/UX critique,
architecture review, adversarial QA/security, growth/marketing, and
finance/ops. Invoke one explicitly (e.g. "use the tech-lead agent") or let
Claude delegate automatically — each agent's `description` includes
"use PROACTIVELY" triggers.

| Agent | Role | When it fires |
|---|---|---|
| `biz-cofounder` | Non-technical cofounder / BD manager | Before building anything; validates demand, designs Mom-Test interviews, researches competitors, gives go/no-go |
| `product-design-critic` | Senior product designer + PM | Reviews every feature scope, flow, screen, and UX copy against Nielsen heuristics and business goals |
| `tech-lead` | Pragmatic architecture & code reviewer | Stack decisions, prevents over-engineering, reviews significant code |
| `qa-security` | Adversarial QA + appsec | After every feature, before every release; hunts edge cases and OWASP-style holes |
| `growth-marketer` | Positioning, copy, launch | Landing pages, launch plans, channel strategy — planned before the build finishes |
| `finance-ops` | Unit economics & ops hygiene | Pricing, cost sanity checks, runway math, compliance flags |

## Intentional-builder workflow

For any new idea or feature, run this loop:

1. **Validate** — `biz-cofounder`: is the riskiest assumption tested? Get a
   GREEN/YELLOW/RED verdict and, if yellow, do the no-code test it prescribes.
2. **Scope** — `product-design-critic`: what's the smallest right version?
   Get the cut list and the flow critique before writing code.
3. **Architect** — `tech-lead`: simplest design that works; flag one-way doors.
4. **Build** — you + Claude Code, normally.
5. **Break** — `qa-security`: adversarial pass before it ships.
6. **Model** — `finance-ops`: does the pricing and cost math still hold?
7. **Launch** — `growth-marketer`: positioning, page, and launch plan (ideally
   drafted back in step 2 — the launch post is a spec).

Then feedback from real users flows back to step 1.

Notes:
- `biz-cofounder`, `product-design-critic`, `growth-marketer`, and
  `finance-ops` are advice-only (no write/edit tools) so they can't drift
  into coding.
- This repo also has a larger set of feature-specific agents (Calendar/Library
  design, QA personas, security, devops-scalability, etc.) already in
  `.claude/agents/` — prefer those for their specific domains; use the six
  above for the broader business/product/growth angles they don't cover.

---

# 🔌 ECC plugin — routing guide

Installed 2026-09-08: `ecc@ecc` v2.2.1, user scope, from
`https://github.com/affaan-m/ECC.git`. Verified on disk at
`~/.claude/plugins/cache/ecc/ecc/2.2.1`: **286 skill dirs (380 registered),
68 agents, 94 commands, 23 rules, 7 hook events, 1 MCP server**.
Config: `hooks_enabled: true`, `hook_profile: standard`.

## Precedence — read this first

Bare name = built-in or this repo. `ecc:` prefix = ECC.

| You type | You get |
|---|---|
| `/code-review`, `/security-review` | **built-in** Claude Code |
| `/ecc:code-review`, `/ecc:security-scan` | ECC's versions |
| `tech-lead`, `qa-security`, `security-auditor`, … | this repo's `.claude/agents/` |
| `ecc:code-reviewer`, `ecc:security-reviewer` | ECC's generalists |

**Order of reach: repo agent → built-in → ECC.** The 23 agents in
`.claude/agents/` know this product, its personas, and its packet gates. ECC
knows *frameworks*. Use ECC where no repo agent owns the discipline.
(Agent names resolve in the agent list after a restart; the `ecc:` prefix
disambiguates a collision.)

## Reach for ECC here

| Situation | Use | Note |
|---|---|---|
| React/Next changes need a specialist read | `/ecc:react-review`, `ecc:react-patterns`, `ecc:react-performance` | No repo agent covers React idiom or render cost |
| Next.js build/bundler behaviour | `ecc:nextjs-turbopack` | We are on Next, not Vite |
| Supabase schema, indexes, query cost | `ecc:postgres-patterns`, `ecc:database-migrations`, agent `ecc:database-reviewer` | **Does not** substitute for the migration rules above |
| `video-worker/` Python | `/ecc:python-review`, `ecc:python-patterns`, agent `ecc:python-reviewer` | L0.4b instrumentation is still open |
| Build or type errors | `/ecc:build-fix` | Auto-delegates to the right build-resolver |
| Swallowed errors, bad fallbacks, no-ops | agent `ecc:silent-failure-hunter` | **Highest-value ECC agent here** — Law 3 is exactly this defect class |
| Unwired / dead modules | agent `ecc:refactor-cleaner`, `/ecc:prune` | The `OptimalTimesService.js` class of defect. Not a replacement for Gate 3 |
| Coverage gaps | `/ecc:test-coverage`, `ecc:tdd-workflow` | Feeds the *proven* half of Law 1 |
| E2E patterns, Playwright config | `ecc:e2e-testing`, `ecc:browser-qa` | For *how to write* them. To actually drive the app, `frontend-visual-qa` already logs in with the QA account |
| Context/token bloat, spend | `ecc:context-budget`, `ecc:cost-tracking` | Relevant to the open cost ledger (L5.14) |
| Accessibility | agent `ecc:a11y-architect`, `ecc:frontend-a11y` | WCAG 2.2 — nothing in this repo covers it |
| UI polish, motion, token audit | `ecc:make-interfaces-feel-better`, `ecc:motion-ui`, `ecc:design-system` | Subordinate to the locked v2 design system, never overriding it |

## Do **not** reach for ECC here

- **Product, business, growth, pricing calls** → the six advisory agents above.
  ECC has no context on this market or this founder's constraints.
- **Calendar / Library design packets** → repo designers + the packet gate.
- **RLS or tenant isolation** → `node scripts/security/cross-tenant-probe.mjs`.
  A reviewer agent reading policies proves nothing. Non-negotiable, unchanged.
- **Social publishing code** → `ecc:social-publisher` targets *SocialClaw*, a
  third-party service. This repo does **direct per-platform OAuth**. Keep it
  away from `supabase/functions/` publishing paths.
- **Any claim about this codebase.** Law 2 governs ECC output too: `file:line`
  or `UNVERIFIED`.

## Hooks — two gates now fire, not one

ECC registers `PreToolUse` on **Bash, PowerShell, and Write**, plus
`PostToolUse`, `PostToolUseFailure`, `SessionStart`, `Stop`, `SessionEnd`,
`PreCompact`. Its **GateGuard** blocks Edit/Write/Bash until concrete
investigation (importers, data schema, user instruction) is produced — which is
the *"check the caller, not just the code"* rule enforced mechanically.

This repo's own `block-prod-code-until-mockup-approved.js` (`Write|Edit`) still
runs. **Both gates fire and both must pass.**

If a gate obstructs: `/plugin configure ecc@ecc` → `hook_profile: minimal`, or
`hooks_enabled: false`. **Never disable a gate to get past a block you have not
read** — that is the failure mode the three laws exist to prevent.

## Cost

**~40,637 tokens always-on**, every session. Breakdown:
`claude plugin details ecc@ecc`. Trim with `ecc:context-budget`.

## Full inventory

`/ecc:ecc-guide`, or `COMMANDS-QUICK-REF.md` in the install path.
