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
