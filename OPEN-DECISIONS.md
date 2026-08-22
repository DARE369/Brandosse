# OPEN DECISIONS

> Decisions that are **blocking work** and belong to the founder, not to engineering.
> Referenced from `CLAUDE.md`, so it loads into every session — this file exists
> because an open question buried in a 12-document audit is an open question
> nobody sees again.
>
> **Rule:** an item leaves this file only when the decision is *made*, not when it
> is discussed. Record the decision and the date inline, then delete the entry.

---

## 🔴 OD-1 — Zernio: pay for connected accounts, and at what model?
**Opened:** 2026-08-22 · **Blocks:** L5.1 (publishing to ≥4 platforms), L5.8 (repricing), D5 §5 (unit economics)
**Status:** OPEN — deliberately parked by the founder 2026-08-22

### What was established

API access is **not** the blocker. `ZERNIO_API_KEY` works; the live API was
queried read-only and returns the one connected account (`tiktok | titan_drex`),
matching the database. Zernio supports **16 platforms**, including all four
DoC-1 targets (TikTok, Instagram, LinkedIn, YouTube).

The blocker is **cost**. Zernio charges per connected account per month:

| Accounts | $/account/month |
|---|---|
| 1–2 | free |
| 3–10 | $6 |
| 11–100 | $3 |
| 101+ | $1 |

Currently on the free tier, **1 of 2 free accounts used**.

### The immediate decision

Reaching the 4-platform launch floor means 4 accounts = **~$12/month**. Small in
absolute terms, but it gates L5.1, and L5.1 gates four pillars.

### The decision that actually matters — at scale

Projected (formula validated against Zernio's own published examples — $48 at
10 accounts, $318 at 100):

| Users | Accounts each | Total | **Per month** | Per user | Per year |
|---|---|---|---|---|---|
| 5,000 | 6 | 30,000 | **$30,218** | $6.04 | $362,616 |
| 5,000 | 3 | 15,000 | $15,218 | $3.04 | $182,616 |
| 10,000 | 6 | 60,000 | **$60,218** | $6.02 | $722,616 |
| 10,000 | 3 | 30,000 | $30,218 | $3.02 | $362,616 |

**Why this is structural, not just expensive.** This is a *fixed monthly cost per
connected account*, not a usage cost. A user who connects 6 accounts, posts
nothing, and never opens the app still costs **$6.02/month**. Revenue is credit
packs — usage-priced. Costs that do not fall when usage falls are precisely what
kills a usage-priced business.

For scale: the cost model puts a *typical* user at **~$2.12/month** across all AI
spend combined. **Zernio at 6 accounts is ~3× the entire rest of the cost model**,
and it is the one line that does not respond to how much the product is used.

A Starter user paying $15 for 100 credits would spend **$6.04 of it on connection
fees before a single generation** — ~40% of revenue.

### Two things to confirm before committing

1. **Do the tiers aggregate across the whole API key, or apply per profile?**
   The projections above assume **aggregate** (one key, users as Zernio
   "profiles") — the favourable reading, and the one the architecture implies.
   If tiers apply **per profile**, every user pays 2 free + 4 × $6 =
   **$24/user/month** — 4× worse, **$120,000/month at 5,000 users**.
   *This single question moves the number by 4×. Confirm with Zernio directly.*
2. **Nobody pays list at 30,000 accounts.** That is a $360k–$720k/year contract
   and warrants an enterprise conversation. Plan on list until one has happened.

### The options

| Option | Consequence |
|---|---|
| **Pay ~$12/mo now**, decide scale pricing later | Unblocks L5.1 immediately; defers the structural question |
| **Stay on free tier (2 accounts)** | Launch floor drops to 2 platforms; DoC-1 needs revising; D5's MCL narrows |
| **Restructure revenue** — base subscription covering connected accounts, credits for usage on top | The only model that structurally carries a fixed per-account cost. A business-model change, not a pricing tweak |
| **Find an alternative provider or direct platform OAuth** | Direct OAuth was already removed once because no platform had app credentials configured (`publish-post/index.ts:161-163`). Re-entering that path is expensive |

### What is blocked while this is open

- **L5.1** — publishing to ≥4 platforms. Four pillars sit behind it (analytics
  needs published posts; the loop needs analytics; reach needs the loop).
- **L5.8** — repricing cannot be decided without knowing the per-account cost.
- **L5.14** — cost-per-user tracking needs the real figure.
- **D5 §5** — the unit-economics section understates cost until this lands.

---

## 🟡 OD-3 — Repository visibility
**Opened:** 2026-08-22 · **Status:** OPEN

`github.com/DARE369/Brandosse` is **public** (`private: false`, confirmed via the
GitHub API).

Two consequences:

1. The `WORKER_WEBHOOK_SECRET` committed in `docs/VIDEO_LAB_COMPLETE_GUIDE.md`
   was publicly readable for the repository's entire life. It is rotated, so the
   current value is safe — but the old one should be assumed harvested, since
   bots scrape public GitHub for credential patterns continuously.
2. `audit/` is now public: 117 findings describing, with `file:line` precision,
   every weakness in the product, plus live data volumes and user counts. The
   specific defects are fixed, so it is not a live exploit map — but it is a
   detailed profile of the system.

**Decision needed:** make the repository private, or move `audit/` out of it.

---

## Decision log

*(Move entries here when decided — keep the reasoning, it is the expensive part.)*

| Date | Decision | Rationale |
|---|---|---|
| 2026-08-21 | Video generation (P4) **cut from v1** | Never produced a video (1 real asset in 32 attempts); negative margin at the cheapest credit tier; repairing it makes unit economics worse, not better (P10o-002). D5 §3 |
| 2026-08-21 | Worker migrates **Railway → Fly.io**, after lockdown | Infrastructure relocation, not new capability. Sequenced as Wave 7 so the first Fly deploy is also the first *working* deploy |
| 2026-08-22 | Worker env vars **not** set on Railway | No point configuring a host being decommissioned. Deferred to Wave 7 |
| 2026-08-22 | **OD-2 CLOSED — Sentry chosen** for error tracking | Free Developer plan: 5,000 errors/mo, 30-day retention, 1 user — ample at current scale (14 users) and likely until real launch traffic. Configured for Next.js *and* Supabase Edge Functions; verified by planting two deliberate failures, both ingested HTTP 200. Python worker deferred to Wave 7, since it cannot boot today anyway |
