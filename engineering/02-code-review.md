# 02 — Agentic Code Review

> **The failure this prevents:** 117 findings reached a production database serving real users. Among them: a cross-tenant data leak, twenty posts frozen for four months, a daily job fabricating market data for five months, and a headline feature that had never once worked. **None of this is exotic.** Every one was findable by reading the code — which is exactly what no review pass was doing.

---

## The governing rule

> **Reviewers verify claims against code. They do not accept claims.**

The audit's most instructive moment: a sub-agent reported mid-stream that clip selection was naive chunking, based on finding `clip_selector.py` dead. The claim was plausible, and relaying it would have condemned the strongest asset in the product. Tracing the actual live path found `analyze.py` running a real Claude rubric. **The dead module and the live one had opposite characters.**

A review that reads summaries instead of code reproduces the failure it exists to catch.

---

## When review runs

| Trigger | Depth |
|---|---|
| Any change to `supabase/migrations/**` | **Full** — schema and RLS are where the worst defect lived |
| Any change to `_shared/**` | **Full** — one file, many consumers, no version pin |
| Money paths: credits, billing, Stripe, Paystack | **Full** |
| Auth, RLS, tokens, webhooks | **Full** |
| Publish path | **Full** |
| Feature work | **Standard** |
| Docs, comments, tests | **Light** |

---

## The review passes

Run these as sub-agents. Each has a scope boundary and an anti-goal; overlapping scopes produce duplicate work and blind spots at the seams.

### Pass 1 — Correctness (`code-reviewer`)

- Does it do what the PR claims? **Trace it, don't read the description.**
- Unhappy paths: empty input, huge input, provider 500, timeout, expired token, concurrent request, mid-operation cancel.
- **Every outbound call has a timeout.** `zernio.service.ts` — the sole real publishing provider — had four calls and zero timeouts, which is a direct mechanism for the frozen-post bug.
- Errors surface to someone. Not `.catch(() => {})` on anything that matters.

### Pass 2 — Security (`security-auditor`)

Mandatory when auth, RLS, secrets, or user data are touched.

- Ownership verified on every endpoint taking a client-supplied ID.
- **RLS changes require the behavioural probe, not policy reading.** `node scripts/security/cross-tenant-probe.mjs` — service-role reads bypass RLS and prove nothing.
- No secret in the diff, including in documentation.
- Fail-closed on every default.

### Pass 3 — Wiring (`general-purpose`)

> **The pass most specific to this codebase.** Its dominant defect is *disconnection, not absence*: `OptimalTimesService.js` (466 lines, imported nowhere), `generate-caption` (correct, called by nothing), ghost-slot logic (behind a flag false for all users), `week_plan` (generated, handler missing), `clip_selector.py` (292 lines, dead).

- Is the new code actually **reachable from a live entry point**? Prove the caller.
- Does every UI affordance have a handler? *Count them: offered must equal handled.*
- Is anything now orphaned by this change?
- Is there a second implementation of this that just became dead?

### Pass 4 — Guard (`general-purpose`)

**Blocking. No exceptions.**

- What automated check proves this is correct *now*?
- Where does that check run, and what breaks when it fails?
- Is it in the [Regression Register](04-production-readiness.md#regression-register)?

**A change with no guard is not approved.** If a guard cannot be written, the fix is not understood well enough to merge.

### Pass 5 — Red team (`devils-advocate`), full-depth reviews only

- What did the other passes accept without tracing?
- Which estimate is optimistic, and by how much?
- What was left out because it was inconvenient?
- What is the most likely way this breaks that nobody has listed?

---

## Evidence standard

Every review finding carries `path/to/file.ts:120-168`. If you cannot cite it, write **UNVERIFIED** and state what you'd need to check.

**Never infer implementation from a filename, route name, README, comment, type definition, or UI label.** A component that renders is not a feature that works. Trace to the thing doing the work — the handler, the worker, the DB write, the third-party call.

---

## Verdicts

| Verdict | Meaning |
|---|---|
| **APPROVE** | Fixed, proven, guarded. Ships. |
| **APPROVE WITH FOLLOW-UP** | Ships; a specific tracked item remains. Not a place to park a missing guard. |
| **REQUEST CHANGES** | A cited defect. |
| **BLOCK** | Security, data loss, silent failure, or fabricated data. Does not ship at any deadline. |

---

## Anti-goals for reviewers

1. Approving because tests pass — this repo had **one** spec against ~109,000 lines, and CI never ran it.
2. Approving because the description is convincing.
3. Softening a finding because the fix is expensive. Difficulty is an input to sequencing, never a filter on truth.
4. Rating something complete without a written definition to check against.
5. Reviewing the diff alone when the risk is in what the diff *disconnects*.
