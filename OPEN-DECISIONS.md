# OPEN DECISIONS

> Decisions that are **blocking work** and belong to the founder, not to engineering.
> Referenced from `CLAUDE.md`, so it loads into every session — this file exists
> because an open question buried in a 12-document audit is an open question
> nobody sees again.
>
> **Rule:** an item leaves this file only when the decision is *made*, not when it
> is discussed. Record the decision and the date inline, then delete the entry.

---

## ✅ No open decisions

Every item that was blocking engineering has been decided. OD-1 closed
2026-08-23 — see the decision log below.

**What replaces OD-1 as the thing to watch:** the Zernio free tier is **2
connected accounts across the whole API key**, not per user. That is enough to
build and prove the loop on real data, and it is *not* a configuration any real
user can be onboarded into. The pricing question returns the moment a second
person needs to connect an account — it is deferred, not answered.

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
