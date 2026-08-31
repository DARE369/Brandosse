# OPEN DECISIONS

> Decisions that are **blocking work** and belong to the founder, not to engineering.
> Referenced from `CLAUDE.md`, so it loads into every session — this file exists
> because an open question buried in a 12-document audit is an open question
> nobody sees again.
>
> **Rule:** an item leaves this file only when the decision is *made*, not when it
> is discussed. Record the decision and the date inline, then delete the entry.

---

## 🔴 Open decisions

Opened 2026-08-31 by the video-compiler pricing analysis. **OD-4 is closed**
(see below). OD-2 and OD-3 are parked by founder decision rather than resolved —
both have longer lead times than any engineering task in the plan, so parking
them is a choice about sequencing, not a removal of the risk.

### OD-2 — Zernio per-account pricing is now due

The free tier is **2 connected accounts across the whole API key**, not per
user. When OD-1 closed on 2026-08-23 the standing note said the pricing question
*"returns the moment a second person needs to connect an account — deferred, not
answered."*

**That moment has arrived.** The B2B tier structure sells multi-brand
publishing, and it cannot sit on 2 shared accounts. Any published price depends
on a per-connected-account cost we do not have.

**Blocks:** lock L5.1 (publish to ≥4 platforms), and every price in the video
compiler's Growth and Scale tiers.
**Needs:** Zernio's per-account rate at our expected volume, then a
re-derivation of tier margins against it as a fixed cost.

### OD-3 — Payment rail for USD B2B revenue

`GRAPHICS_CREDIT_MODEL.md:16` establishes that **Stripe cannot pay out to a
Nigerian business in 2026**. The 2026-08-30 decision to sell **USD B2B
subscriptions** — to US and EU companies — makes the naira/Paystack rail
insufficient rather than merely suboptimal.

Two routes, both with lead times measured in weeks:
1. A **merchant of record** that will onboard a Nigerian beneficiary.
2. A **foreign entity** (US LLC or UK Ltd) with its own banking.

This is a legal, tax and banking structure decision that sits **upstream of all
engineering**. The pricing model assumes a 5% blended fee as the pessimistic
case; the real figure follows from this choice.

**Blocks:** collecting any revenue for this capability.
**Needs:** a cross-border accountant, engaged now rather than at launch.

### ✅ OD-4 — CLOSED 2026-08-31: customers pay for retries

**Founder decision: retries are charged to the customer's credits.** The
existing rule at `GRAPHICS_CREDIT_MODEL.md:22` stands; the pricing analysis's
recommendation to absorb retries as COGS is **overruled**.

**What this means downstream, so it is not rediscovered later:**

- The video-compiler allowance is **not** denominated in finished videos. A
  retry is a billable event like any other generation.
- The category's most-cited complaint — *"credits consumed faster than users
  expect"* — is therefore **not** structurally avoided, and has to be managed
  in the interface instead: the price of a retry must be shown before it is
  incurred, and the estimate-versus-actual reconciliation on the delivery
  screen becomes more important, not less.
- The incentive noted in the original argument still applies: our revenue rises
  when generation quality falls. That is now a thing to **watch deliberately**
  rather than something the pricing structure prevents. The retry multiplier
  `R` in the cost ledger (L5.14) is the metric that makes it visible, and it
  should be reviewed rather than left to accumulate.

The original argument for the other choice is preserved below, because it will
come up again with the first enterprise customer.

<details>
<summary>Superseded recommendation (kept for the reasoning)</summary>

### OD-4 — Do customers pay for retries?

`GRAPHICS_CREDIT_MODEL.md:22` locks *"Auto-retry — charged from credits (2 cr).
Founder decision — no free retries."* The pricing analysis recommends
**overturning this** for the video compiler: the customer's allowance is
denominated in *finished videos*, retries are absorbed as our COGS, and the
customer never sees a credit.

The argument for overturning it, which deserves a decision rather than a drift:

- *"Credits consumed faster than users expect"* is the single most common
  complaint recorded against every competitor surveyed. The abstraction itself
  is the defect, not its explanation.
- Under a credit model, **our revenue rises when our generation quality falls.**
  That incentive points the wrong way. Under a video allowance, every retry
  costs us money, so improving the QC gate has a direct P&L return.
- It converts the category's biggest complaint into one sentence of
  positioning: *"you pay for finished videos, not for attempts."*

**The cost of being wrong is bounded and known:** at the base model price the
Growth tier tolerates a retry multiplier up to ~4.1× before margin drops under
60%. But that is only true if the multiplier is *measured*, which today it is
not — see the note on L5.14 below.

**Note:** this decision applies to the video compiler. Whether it also
supersedes the existing credit model for images and single-clip video is part of
the same call.

</details>

---

## 🔁 Standing reminders — raise these unprompted

Founder asked to be reminded of these each session. None blocks work today.

| # | Item | Status | Why it will bite |
|---|---|---|---|
| **OD-2** | Zernio per-account pricing | **Parked.** Staying on Zernio for now, but the intent is to move to the official platform APIs (worked on outside this repo). | The free tier is 2 connected accounts across the whole API key. Any B2B tier promising multi-brand publishing cannot ship on that, whichever provider it ends on. |
| **OD-3** | USD payment rail | **Parked.** Stripe is the eventual intent. | Stripe cannot pay out to a Nigerian business (`GRAPHICS_CREDIT_MODEL.md:16`). Selling USD subscriptions needs a merchant of record or a foreign entity — weeks of lead time, longer than any engineering task here. Revenue cannot be collected until it is resolved. |
| **PDFs** | `legal/*.pdf` untracked | **Dropped for now.** | 8.9MB of near-duplicate binaries; the markdown carries the content. If a *signed* version ever becomes the authoritative copy, it needs tracking somewhere — git history keeps binaries forever, so decide before adding. |

---

**Related engineering prerequisite, not a founder decision:** none of the eight
cost-danger metrics behind these tiers is measurable today, because
`FAL_COST_USD` (`supabase/functions/_shared/fal.service.ts:619`) is explicitly
labelled *"Cost estimates (informational)"* and no per-job ledger records
**actual** provider spend. That ledger is lock **L5.14**, already open. Until it
exists, any pricing here is a spreadsheet rather than a control system.

---

## Decision log

*(Move entries here when decided — keep the reasoning, it is the expensive part.)*

| Date | Decision | Rationale |
|---|---|---|
| 2026-08-23 | **OD-1 CLOSED — stay on the Zernio free tier (2 accounts)** | Unblocks the loop at zero cost. L5.1 rescopes from "publish to ≥4 platforms" to "the multi-platform path works, proven across 2 real accounts" — the engineering is the same minus the spend, and 2 platforms produce enough real `platform_analytics` rows to close P8→P3. **Consequence recorded deliberately:** 2 accounts is the total across the API key, so this is a development configuration, not a launch one. DoC-1's launch floor drops to 2 platforms. The per-account pricing question (and the aggregate-vs-per-profile question that moves it 4×) is deferred to the first real user, not resolved |
| 2026-08-23 | Video generation **kept, labelled experimental** — qualifies the 2026-08-21 cut | The cut was recorded and never implemented; the feature stayed fully reachable in Studio for two days, which is a decision that only existed on paper. Keeping it visible but honestly labelled stops it presenting as a finished feature while avoiding the removal work. **The negative-margin path stays open to users** — that is the accepted cost of this choice, and L5.14's per-user ceiling is what bounds it |
| 2026-08-21 | Video generation (P4) **cut from v1** | Never produced a video (1 real asset in 32 attempts); negative margin at the cheapest credit tier; repairing it makes unit economics worse, not better (P10o-002). D5 §3 |
| 2026-08-21 | Worker migrates **Railway → Fly.io**, after lockdown | Infrastructure relocation, not new capability. Sequenced as Wave 7 so the first Fly deploy is also the first *working* deploy |
| 2026-08-22 | Worker env vars **not** set on Railway | No point configuring a host being decommissioned. Deferred to Wave 7 |
| 2026-08-22 | **OD-3 CLOSED — repository made private** | It had been public for its entire life, which is how the committed `WORKER_WEBHOOK_SECRET` was publicly readable until rotation. Assume that old value was harvested; bots scrape public GitHub for credential patterns continuously. Going private also removes `audit/` — 117 findings with `file:line` precision plus live data volumes — from public view |
| 2026-08-22 | **OD-2 CLOSED — Sentry chosen** for error tracking | Free Developer plan: 5,000 errors/mo, 30-day retention, 1 user — ample at current scale (14 users) and likely until real launch traffic. Configured for Next.js *and* Supabase Edge Functions; verified by planting two deliberate failures, both ingested HTTP 200. Python worker deferred to Wave 7, since it cannot boot today anyway |
