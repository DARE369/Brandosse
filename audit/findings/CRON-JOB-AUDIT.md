# Cron Job Audit — the four jobs the allowlist was hiding

**2026-08-21** · Triggered by LOCK L0.3 un-blinding `get_cron_job_status()`

Before L0.3, monitoring reported 3 jobs. There are **7**. This is an audit of the 4 that were invisible: what each talks to, and whether it is still needed.

---

## Summary

| Job | Schedule | Talks to | In a migration? | Needed? |
|---|---|---|---|---|
| `cleanup-rate-limit-events` | `0 * * * *` | Pure SQL — `rate_limit_events` | ✅ `20260711010000` | ✅ **Keep** |
| `process-jobs` | `* * * * *` | pg_net → `process-jobs` edge fn | ✅ `20260712120000` | ✅ **Keep** |
| `reap-stuck-records` | `*/5 * * * *` | Pure SQL — 4 tables | ✅ `20260821160000` | ✅ **Keep** (new) |
| `daily-calendar-analysis` | `0 2 * * *` | pg_net → `daily-analysis` edge fn | ❌ **NONE** | ⚠️ **Produces nothing** |

**Three of four are legitimate and correctly registered. One is undocumented and currently does nothing at all.**

---

## 1. `cleanup-rate-limit-events` — KEEP ✅

**Registered:** `20260711010000_edge_function_rate_limiting.sql:132-142`
**Command:** pure SQL, no external call.

```sql
DELETE FROM public.rate_limit_events WHERE created_at < now() - interval '24 hours';
```

**Verdict: needed.** `check_rate_limit()` does opportunistic per-call cleanup, but only for keys that are still being called. Abandoned user/function pairs would accumulate forever without this hourly sweep. 24h retention is a generous multiple of the longest configured window (60s in `_shared/rateLimit.ts`).

Low risk, self-contained, correctly documented. No action.

---

## 2. `process-jobs` — KEEP ✅

**Registered:** `20260712120000_week3_process_jobs_cron.sql`
**Command:** pg_net call to the `process-jobs` edge function, using the vault-based service-role-key pattern from `20260710120000`.

**Verdict: needed.** It is the fallback reconciliation sweep for the video job queue — it only touches `running` video jobs whose `started_at` is more than 45s old, so the 1-minute cadence does not fight the webhook that normally finalizes them.

**Currently idle** (all 15 video jobs are terminal, and the worker is down pending its Groq key), but it becomes load-bearing the moment the worker returns. Keep.

---

## 3. `reap-stuck-records` — KEEP ✅

Added today under LOCK L2.3. Confirmed active, last run succeeded. Recovered 24 stranded records on first run.

---

## 4. `daily-calendar-analysis` — ⚠️ UNDOCUMENTED, AND PRODUCES NOTHING

**Registered: nowhere.** No migration in the repository schedules this job. It was created by hand — almost certainly through the SQL Editor — which is exactly the practice `engineering/01-versioning.md` forbids, and the reason nobody could name it during the audit.

**Talks to:** the `daily-analysis` edge function, daily at 02:00 UTC. (Inferred and then confirmed: `trending_topics` rows carried `02:00:03` timestamps, and invoking the function directly reproduces the behaviour.)

### It has three output paths. All three are dead.

**(a) Trending topics — disabled today.** This was the only path producing output, and the output was fabricated: two hardcoded strings across four platforms, every night for ~5 months. Disabled under LOCK L1.3 and verified — a live invocation now writes zero rows.

**(b) Optimal posting times — gate never opens.** Requires ≥5 published posts *per platform* (`daily-analysis/index.ts:130,141`). The whole system has 9 published posts total. `optimal_posting_times`: 0 rows.

**(c) Ghost slots — blocked by a three-way gate that no user satisfies.**

This is the interesting one. Ghost slot creation requires *all three* of:

| Gate | Where | Users passing |
|---|---|---|
| `profiles.status = 'active'` | `index.ts:41-43` | 12 of 14 |
| `calendar_settings.ghost_slots_enabled = true` | `index.ts:238` | **2** |
| Has ≥1 `content_pillars` row | `index.ts:246-250` | 5 |

**The intersection is empty:**

- `29944d39` — enabled ✅, has pillars ✅, but `status = null` ❌ → excluded from the loop entirely
- `8baf52b4` — `status = 'active'` ✅, enabled ✅, but **no content pillars** ❌ → returns at gate 2

So a fully-implemented feature has produced 0 rows in 5 months because no single user clears all three gates. Not one gate is "broken" — they are individually reasonable and collectively impossible.

### Corrections to the original audit

The launch audit (finding P2-002) stated ghost slots were "gated behind a flag `false` for all 7 users". That was wrong on two counts, corrected here:

- **2 users have `ghost_slots_enabled = true`**, not zero.
- The operative blocker is the **three-way intersection**, not the flag alone. Flipping the flag for everyone would still produce nothing.

Also: `content_pillars` holds **3 distinct names** (Educational, Entertainment, Promotional) across 5 users — the audit called it "byte-identical seed data" with one pillar. Still seed data, but less uniform than described.

### Recommendation

**Keep the job, but register it properly and fix the gate chain as reconnection work.**

1. **Register it in a migration** so the repo describes the deployed state. Right now the job exists only in the live database — the precise failure class this lockdown exists to eliminate.
2. **Add it to the `is_known` list** in `get_cron_job_status()` once registered, so genuinely unexpected jobs still stand out.
3. **Treat the gate chain as Wave 4 (L4.6) reconnection**, not new work: the feature is fully built. Making it produce output needs `profiles.status` backfilled for the 2 null rows, and content pillars for users who have the flag on — configuration, not code.

**Do not unschedule it.** It is harmless now that fabrication is off, and it is the driver for a feature that is one configuration fix away from working.

---

## Cross-cutting finding

**Three of the seven jobs were invisible to monitoring, and one of those had no migration at all.** The allowlist did not merely hide a job — it hid the fact that a job could exist without being in version control. That combination is what let fabricated data ship nightly for five months with nobody able to name the process responsible.

`get_cron_job_status()` now reports every row in `cron.job` with an `is_known` flag, so an unregistered job is visible on the next health check rather than in five months.
