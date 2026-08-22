# Engineering Standards

Production standards for Brandosse. **These are enforced, not aspirational** — every rule here exists because the 2026-08 launch audit found a specific defect it would have prevented.

| Doc | Covers | Exists because |
|---|---|---|
| [01-versioning.md](01-versioning.md) | Schema, edge functions, releases, config | Live DB had **89 tables vs 65 in migrations** — deployed state was unknowable |
| [02-code-review.md](02-code-review.md) | Agentic review protocol | 117 findings shipped without review catching them |
| [03-documentation.md](03-documentation.md) | What to write, what to delete | **107 docs**, many contradicted by the code they describe |
| [04-production-readiness.md](04-production-readiness.md) | Definition of Done, release gate | Features shipped that had never once worked |

---

## The three laws

Everything else is detail. These are absolute.

### 1. A change is not done until it is **fixed + proven + guarded**

- **Fixed** — the defect is corrected
- **Proven** — an automated check demonstrates it is correct *now*
- **Guarded** — that check runs continuously, so it cannot silently regress

**Why:** every serious finding in the audit was working code that silently degraded. Groq failed 100% for days. Trend data was fabricated daily for five months. Twenty posts froze in April. Four accounts were unpublishable for months while displaying "active." **Not one was detected.** A fix without a detector has a demonstrated half-life in this codebase.

### 2. Code is the source of truth. Documentation is a claim.

Where a document and the code disagree, **the document is a bug**. Fix or delete it — never leave both standing. The audit had to disregard 107 markdown files and a 112KB spec because none of them could be trusted against the running system.

### 3. Nothing user-facing may silently no-op, display fabricated data, or lose user content

The minimum trust contract. All three were being violated when the audit ran:

- `week_plan` in the calendar generated a real plan and its handler didn't exist — the dialog just closed
- `trending_topics` held ~1,200 rows containing two invented topics
- 20 posts entered `publishing` and never came out

---

## How this is enforced

| Layer | Mechanism |
|---|---|
| **Every session** | `CLAUDE.md` loads these rules into every Claude Code conversation |
| **Pre-merge** | Agentic review per [02-code-review.md](02-code-review.md) |
| **CI** | Guards from [04-production-readiness.md](04-production-readiness.md); the Regression Register is blocking |
| **Runtime** | Alerts, not dashboards — a check nobody looks at is not a guard |

---

## Current state

The [Completion Lockdown](../audit/11-lockdown-plan.md) is in progress. **No new capability is built until it lifts.** These standards apply to lockdown work and to everything after.

Audit source material lives in [`../audit/`](../audit/) — 117 findings, 12 deliverables.
