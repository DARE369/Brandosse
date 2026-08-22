# 04 — Production Readiness

> **The failure this prevents:** features shipped that had never once worked. Video generation: 32 attempts, 1 real asset, 18 rows pointing at a Google demo MP4. Four connected accounts displaying "active" while structurally unable to publish. A calendar button that generated a real plan and then silently discarded it. **All of it looked shipped.**

---

## Definition of Done

A change is done when it is **fixed + proven + guarded**.

| | Question | Fails if |
|---|---|---|
| **Fixed** | Is the defect corrected? | The happy path works but unhappy paths were never traced |
| **Proven** | What automated check demonstrates it is correct *now*? | "I tested it manually" |
| **Guarded** | Where does that check run continuously? | The check exists but nothing runs it |

**The third is where this codebase failed.** Every serious finding was working code that silently degraded. Guards are not optional polish; they are the difference between a fix and a temporary fix.

---

## Regression Register

**Every guard gets a permanent row. A lock without a row is not locked.**

| Lock | Guard | Runs | Fails how |
|---|---|---|---|
| L1.1 / L1.5 Tenant isolation + no self-escalation | `scripts/security/cross-tenant-probe.mjs` | CI `live-invariants`, daily 06:00 UTC + manual | Job fails |
| L1.4 Fail-closed worker | `config.validate_runtime_credentials()` | Worker startup | Refuses to boot |
| L1.6 Signed OAuth state | `scripts/security/oauth-state.test.mjs` | CI `guards`, **every PR** | Build fails |
| L2.3 No frozen records | `scripts/security/stuck-records-probe.mjs` | CI `live-invariants`, daily | Job fails |
| L0.5 No committed secrets | `scripts/security/secret-scan.mjs` | CI `guards`, **every PR** | Build fails |
| L0.3 All jobs visible | `get_cron_job_status()` — no allowlist, `is_known` flag | `healthCheck` | Unknown job surfaces |
| L0.7 Status constants | `scripts/check-status-literals.cjs` | CI `guards`, every PR | Build fails |
| L0.7 Env/secret hygiene | `scripts/check-env-security.cjs` | CI `guards`, every PR | Build fails |
| L0.7 Edge fn drift | `scripts/check-edge-functions.cjs` | CI `guards`, every PR | Build fails |
| L0.7 (+4 more) | `check-{production-workflow,docs-canonical,ui-consistency,e2e-env,production-ready}.cjs` | CI `guards`, every PR | Build fails |
| L4.7 Provider health | `llm_provider_fallback` logged at error level | Runtime | ⬜ **needs alerting (L0.4)** |
| — Cost per user | deviation alert | Runtime | ⬜ **not built (Wave 5, E5)** |

**Status 2026-08-22:** 12 of 14 guards run automatically. The two outstanding
both depend on error tracking (L0.4), which is the last piece of Wave 0.

**Rule:** if a guard cannot be written for a change, the change is not understood well enough to merge.

---

## The demonstration rule

> **A gate that has not been demonstrated is not passed.**

Not "the test exists." **Plant a failure and confirm the machinery catches it.**

Worked example, from `video-worker/config.py`: the credential guard was verified by running it against the real environment and observing it refuse to start with a specific, actionable message. That is a demonstration. "The validator is implemented" is not.

---

## Release gate

Nothing ships unless every line is true.

### Security
- [ ] Cross-tenant probe passes — **blocking**
- [ ] No secret in the diff, including documentation
- [ ] Ownership verified on every new ID-taking endpoint
- [ ] Every default fails closed

### Correctness
- [ ] Unhappy paths traced: empty, huge, 500, timeout, expired token, concurrent, cancel
- [ ] Every outbound call has a timeout
- [ ] Every non-terminal state has a timeout and a reaper
- [ ] No UI affordance without a handler
- [ ] No fabricated or placeholder data on a user-visible path

### Observability
- [ ] Failures reach a human — alert, not a dashboard nobody opens
- [ ] The new path is visible to monitoring (**no allowlists** — `get_cron_job_status()` filtered `cron.job` through three hardcoded names and hid a job for five months)
- [ ] Cost impact known where AI providers or storage are touched

### Versioning
- [ ] Schema change is a migration: idempotent, transactional, asserts its post-condition
- [ ] Drift checked before and after
- [ ] `.env.example` current
- [ ] Model IDs pinned, never `-latest`
- [ ] `CHANGELOG.md` entry citing the finding

### Documentation
- [ ] Decisions recorded **in the code**, at the decision site
- [ ] No document contradicts the change — fix or delete
- [ ] No new status report

### The guard
- [ ] Regression Register row exists
- [ ] Guard demonstrated against a planted failure

---

## Maturity bar

From the audit's scale. **Nothing user-facing ships below L3.**

| | |
|---|---|
| L0 | Absent |
| L1 | Scaffolded — files exist, no working path |
| L2 | Happy path only — breaks on real input |
| **L3** | **Functional — handles real input and errors. Launch floor** |
| L4 | Competitive — matches category leaders |
| L5 | Differentiated — a reason to switch |

---

## What "production ready" is not

- **Not "it works on my machine."** The worker booted cleanly and failed every job at stage 2 for want of one environment variable.
- **Not "the code is written."** 105 of 117 findings describe code that already existed. Written is not wired.
- **Not "tests pass."** One spec covered ~109,000 lines, and CI never ran it.
- **Not "the docs say it's done."** Several documents described features that had never executed.

---

## The standing question

Before shipping anything, answer it honestly:

> **If this breaks silently in production tonight, what tells me before a user does?**

If the answer is "nothing," it is not production ready — regardless of how well it works right now.
