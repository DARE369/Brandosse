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

## ⚠️ Open decisions — check before planning work

[`OPEN-DECISIONS.md`](OPEN-DECISIONS.md) holds founder decisions that are
**blocking engineering work**. Read it before proposing a plan — some work is
blocked on a decision, not on effort, and proposing it anyway wastes a cycle.

Currently open: **OD-1 — Zernio per-account pricing.** It blocks L5.1, and four
pillars sit behind that (analytics needs published posts; the loop needs
analytics; reach needs the loop). It is also ~3× the entire rest of the cost
model, as a *fixed* cost against usage-priced revenue.

## 🔒 Completion Lockdown is ACTIVE

Per [`audit/11-lockdown-plan.md`](audit/11-lockdown-plan.md): **no new capability until everything pending is locked.** Finish, connect, or delete what exists. New ideas go to [`audit/08-horizon-register.md`](audit/08-horizon-register.md) — do not smuggle them in as "completion work." If it needs a new table, a new third-party integration, or a new nav item, it is new.

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
