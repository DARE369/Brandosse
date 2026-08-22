# D11 — The Completion Lockdown Plan
## Finish and lock everything pending, before any new implementation

**Brandosse** · 2026-08-21 · Derived from 117 audit findings

---

## The governing rule

> **No new capability is built until every item below is LOCKED.**

And the definition that makes this plan different from an ordinary backlog:

> ### A thing is LOCKED when it is: **fixed + proven + guarded.**
>
> - **Fixed** — the defect is corrected
> - **Proven** — an automated check demonstrates it is correct *now*
> - **Guarded** — that check runs continuously, so it cannot silently regress

**Why the third clause is non-negotiable here.** This codebase's defining pathology is not that things break — it is that things break *invisibly*. Groq failed 100% for days. Trend data was fabricated daily for five months. Twenty posts froze in April. Four accounts have been unable to publish for months while displaying "active." **Every one of these was fixed-quality code that silently degraded, and nothing noticed.**

A fix without a guard, in this repository, has a demonstrated half-life. So the plan starts by building the locking mechanism itself — otherwise every subsequent lock is a lock with no bolt.

---

## What counts as "pending" — the scope line

The audit produced 117 findings. They divide cleanly, and the division decides what is in this plan:

| Class | Count | In lockdown? |
|---|---|---|
| **Exists, needs finishing/connecting/deleting** | 105 | ✅ **Yes — all of it** |
| **New build required to make an EXISTING capability correct** | 7 | ✅ **Yes** — see below |
| **New build that adds NEW capability** | 5 | ❌ **No — this is the "new implementation" the lock defers** |

**The 7 that count as completion**, despite being new code: a reaper for an existing state machine; publish-failure notifications into an existing table; the cross-tenant test; error tracking; timeouts; bulk calendar operations; analytics export. Each makes something that already exists behave correctly. **None adds a capability the product doesn't claim to have.**

**The 5 deferred as new implementation:** platform metrics ingestion, the P8→P3 loop carrier, `optimal_posting_times` from real data, the loop-closure dashboard, and audio for generated video. These are the first things built *after* lockdown lifts.

> **The honest tension, stated once:** closing the loop is your differentiator, and it sits on the wrong side of this line. Lockdown delays it. That is the correct trade — the loop built on top of a product that leaks data between users, freezes posts, and can't tell you when it breaks would be a differentiator on sand. **Lock first. The loop is the reward.**

---

## Wave −1 — Engineering standards *(~3 days) — ✅ DONE 2026-08-21*

The standards every later wave is judged against. Done first so the rules exist before the work does.

| Lock | What | Status |
|---|---|---|
| **L-1.1** | [`engineering/01-versioning.md`](../engineering/01-versioning.md) — schema, edge functions, releases, model pinning, config | ✅ |
| **L-1.2** | [`engineering/02-code-review.md`](../engineering/02-code-review.md) — agentic review protocol: correctness → security → **wiring** → **guard** → red team | ✅ |
| **L-1.3** | [`engineering/03-documentation.md`](../engineering/03-documentation.md) — what to write, what to **delete** | ✅ |
| **L-1.4** | [`engineering/04-production-readiness.md`](../engineering/04-production-readiness.md) — Definition of Done, Regression Register, release gate | ✅ |
| **L-1.5** | `CLAUDE.md` updated so the standards load into **every session** | ✅ |
| **L-1.6** | `docs/` triage — 107 files → keep-and-verify / rewrite / delete | ⬜ *runs during Wave 5* |

**Three design choices worth noting**, because they invert the usual advice:

- **The documentation standard is mostly about deletion.** This repo's problem is 107 docs that produce confident wrong answers, not missing docs. Decisions belong in code at the decision site; status reports are banned outright.
- **Review adds a "wiring" pass** that most checklists lack — because the dominant defect here is *disconnection, not absence*. The question "is this reachable from a live entry point?" would have caught five separate findings.
- **The "guard" pass is blocking.** A change with no guard is not approved, because a fix without a detector has a demonstrated half-life in this codebase.

---

## Wave 0 — Build the lock mechanism *(~1 week)*

**Nothing else can be locked until this exists.** This wave produces no user-visible change and is the highest-leverage week in the plan.

| Lock | What | Proven by | Guarded by |
|---|---|---|---|
| **L0.1** | CI runs tests, not just a build | The existing Playwright spec executes in CI | `.github/workflows/ci.yml` test job, required to pass |
| **L0.2** | Cross-tenant test harness | Log in as user A, attempt B's rows across all 89 tables | Blocking CI job |
| **L0.3** | Un-blind job monitoring | Delete the 3-name allowlist at `20260710110000_...sql:55` | `healthCheck` enumerates *all* `cron.job` rows; alerts on unknown/failing |
| **L0.4** | Error tracking + alerting | Sentry (or equivalent) receives a deliberately thrown test error | Alert rules on: provider fallback, failure rate >5%/hr, any non-terminal state >15 min |
| **L0.5** | Secret scanning | A test commit containing a fake key fails CI | Pre-commit hook + CI job |
| **L0.6** | Startup env validation | Worker and edge functions refuse to start with a missing required key | Extend the pattern already at `video-worker/config.py:14-15` |
| **L0.7** | Wire the 8 existing guard scripts | Each `scripts/check-*.cjs` runs and passes | CI job — *or delete the script if it no longer earns its place* |

**Gate 0 — the lock is functional.** Deliberately break something (revoke a key, freeze a post, stage a fake secret) and confirm the machinery catches it **within one CI run or one alert cycle**. Until a planted failure is caught, Wave 0 is not done.

---

## Wave 1 — Stop the bleeding *(~1 week)*

Live issues. Two are actively exploitable right now.

| Lock | What | Proven by | Guarded by |
|---|---|---|---|
| **L1.1** ✅ | Cross-user RLS on `posts`/`generations` | **PASS 2026-08-21** — probe green; posts 73→0 foreign, generations 39→0 | ⬜ CI wiring pending (L0.2) |
| **L1.2** ✅ | Rotate `WORKER_WEBHOOK_SECRET` | New 32-char secret in both env files; old value removed from `docs/VIDEO_LAB_COMPLETE_GUIDE.md`; 0 tracked files contain it | ⬜ Secret scanning pending (L0.5) |
| **L1.3** ✅ | Stop fabricating trend data (`daily-analysis:337-372`) | Writer disabled; returns `{skipped:true}` and warns | ⬜ CI assertion pending (Wave 0) |
| **L1.4** ✅ | Mock flags default to `False`; worker uses the **real** Anthropic key | **Demonstrated**: validator refuses startup with a specific message. `analyze.py` now reads the key from `config`, has no mock branch, and raises rather than falling back to simulated scores | ✅ `config.validate_runtime_credentials()` at startup |
| **L1.5** ✅ | `profiles` self-update — privilege escalation + credit display integrity | **PASS 2026-08-21** — both blocked with HTTP 403. Took two attempts: `20260821120000` dropped policies by name and had no effect; `20260821140000` swept by allowlist and worked | Probe asserts both exploits every run |
| **L1.6** ✅ | Zernio OAuth CSRF — signed state replaces the unsigned `profileId` | **8/8 tests pass**; live callback without state → `reason=oauth_state_missing` | `scripts/security/oauth-state.test.mjs` |

**Gate 1 — nothing is actively leaking.** Cross-tenant test green. No live secret in history. No fabricated data written anywhere. No fail-open default remains.

---

## Wave 2 — The UI must stop lying *(~2 weeks)*

Everything here is a case where the product actively misinforms the user. **This class is worse than a missing feature**: a user told "Healthy" has no reason to investigate.

| Lock | What | Proven by | Guarded by |
|---|---|---|---|
| **L2.1** 🟡 | Account badge derives from capability + `health_score`, not `connection_status` alone | Code done — `toAccountCard` now runs hard-blocked → degraded → state → unknown, with **no assume-healthy branch** | Migration `20260821220000` **awaiting apply** |
| **L2.2** 🟡 | Surface accounts that cannot publish | `can_publish` / `publish_block_reason` computed **in the view**, so every consumer inherits it | Same migration — post-condition rejects any false positive |
| **L2.3** ✅ | Reapers + backfill | **PASS** — 24 stranded rows recovered (20 posts / 4 clips); cron confirmed active | `scripts/security/stuck-records-probe.mjs` |
| **L2.4** ✅ | The 4 no-op calendar AI actions | `week_plan`, `add_draft_post`, `delete_post` implemented; `suggest_slots` confirms honestly; unknown types now warn loudly | Unhandled type → visible error, never silence |
| **L2.5** ✅ | Dead header search box | Rendered only when a real handler is supplied; default changed from a no-op to `null` so "unwired" is detectable | Guard in `UserNavbar.jsx` |
| **L2.6** ✅ | Credit display | `?? 3` → `?? null`; server charges **1**, so the UI was showing **3×** the true cost whenever the field was absent | — |
| **L2.7** ✅ | Raw tracebacks + false refund claim | `explainJobError()` humanises 6 known failures incl. the YouTube bot block; raw text demoted to `<details>`; **the unconditional "credits refunded" claim is gone** | — |

**Gate 2 — the UI tells the truth.** Every surface reflects real system state. Nothing silently no-ops. No fabricated or placeholder value is presented as real.

---

## Wave 3 — Delete what should not exist *(~2 days)*

Fast, and it makes everything after it easier to reason about.

| Lock | What | Size |
|---|---|---|
| **L3.1** | `src/app/**` + `src/api/**` — unroutable duplicate incl. a dead Stripe webhook | 17 files |
| **L3.2** | `clip_selector.py`, `llm_client.py`, `transcript_parser.py`, `video_reframer.py` | ~800 lines |
| **L3.3** | `src/legacy/supabase.js`; resolve the duplicate `Calendar` / `CalendarPage` directories | — |

**Guarded by:** a CI check for unreferenced modules, so dead code cannot silently re-accumulate.

**Gate 3 — no dead code.** Every file in the tree is reachable from a live entry point.

---

## Wave 4 — Connect what is already built *(~1–2 weeks)*

> **The cheapest wave in the plan and the one that changes the product most.** Every item is finished code that was never wired up.

| Lock | What | Effort |
|---|---|---|
| **L4.1** ⏭ | Set `WORKER_GROQ_API_KEY` | Deferred to **Wave 7** (Fly migration) — not set on Railway |
| **L4.2** ⏭ | Set `WORKER_YOUTUBE_COOKIES` | Deferred to **Wave 7** |
| **L4.3** ✅ | Reconnect `generate-caption` | Caption-only regeneration now routes to `SessionStore.generateCaption()`, which loads the brand kit and passes the 5 most recent captions as anti-repetition context. Title/hashtags stay on the metadata path |
| **L4.4** 🟡 | Revisions to `content_versions` | `snapshotCurrentVersion()` added and wired before every caption overwrite (best-effort, never blocks the user). **Migration `20260822090000` awaiting apply** — owners had read but not INSERT |
| **L4.5** ✅ | Render `health_score` / `last_failure_reason` | Done in Wave 2 (L2.1) |
| **L4.6** 🟡 | Ghost-slot gate chain | Root cause found: `profiles.status` is NULL on the 2 oldest accounts (QA + **admin**), silently excluding them from every `status='active'` filter. **Migration `20260822100000` awaiting apply** |
| **L4.7** ✅ | Model pinning + fallback alerting | Default `claude-3-5-sonnet-latest` → `claude-sonnet-5` (same price, current generation); second stale default at `:325` also fixed; **provider fallback now logs `llm_provider_fallback` at error level** — the tripwire whose absence hid the Groq outage |

**Guarded by:** L0.6 startup validation for the env vars; a test asserting `generate-caption` is on the live path; a test asserting a revision row is written per regenerate.

**Gate 4 — nothing built is left disconnected.** For every module in the repo: it is on a live path, or it is deleted.

---

## Wave 5 — Complete the inadequate *(~6–8 weeks)*

The largest wave. Everything here works but fails its D4 bar.

| Lock | What | Effort | D4 |
|---|---|---|---|
| **L5.1** | Publishing to ≥4 real platforms via Zernio | **L** | DoC-1 |
| **L5.2** | Publish-failure notifications → `user_notifications` | M | DoC-1 |
| **L5.3** | Clipping: fix analysis truncation; platform export presets | M | DoC-2 |
| **L5.4** | Text: instruction-based refinement replacing blind overwrite | M | DoC-3 |
| **L5.5** | Bulk calendar operations | M | DoC-4 |
| **L5.6** | Finish ui-v2 migration (5 routes) + delete legacy shell — fixes the unstyled billing page | **L** | DoC-9 |
| **L5.7** | Shared nav component; add the missing video-generation entry | S | DoC-9 |
| **L5.8** | **Reprice video generation**; remove the silent 3× tier upgrade; reconcile the cost table | M | DoC-8 |
| **L5.9** ✅ | Timeouts on all provider calls | S | **28/28 bounded.** `zernio.service.ts` had 4 calls and 0 timeouts — the direct mechanism behind the frozen posts. Every value sits under the reaper threshold so a hung provider retries cleanly |
| **L5.10** | Store hotlinked image assets; reclassify placeholder rows | M | DoC-8 |
| **L5.11** | Relabel the discovery score as a stylistic checklist until grounded | S | DoC-7 |
| **L5.12** | Complete the brand-kit conversation | M | DoC-5 |
| **L5.13** | Analytics export + date-range comparison | M | DoC-6 |
| **L5.14** | Cost-per-user tracking + per-user video ceiling | M | DoC-10 |
| **L5.15** | Onboarding to first value ≤5 min; empty states everywhere | M | DoC-9 |

**Gate 5 — every existing capability meets its D4 bar**, with a test proving it and a guard keeping it.

---

## Wave 6 — Close the audit's own gaps *(~1 week)*

The audit is not complete until these are done — its own self-check says so.

| Lock | What |
|---|---|
| **L6.1** | Persona walkthroughs: unaided first-run as Casual Operator, migration flow as Power Migrant |
| **L6.2** | **Run** the test suite and all 8 guard scripts; record real pass/fail |
| **L6.3** | Verify production environment: Vercel, Supabase edge secrets, Railway — reconcile against every `unverified_notes` in the findings |
| **L6.4** | Confirm whether cross-tenant **writes** leak (read exposure is confirmed; writes were deliberately not tested) |

**Gate 6 — no unverified claims remain in the audit.**

---

## 🔓 LOCKDOWN LIFTS HERE

Only after Gates 0–6 all pass does new implementation begin — starting with the deferred five, in this order:

1. Real platform metrics ingestion (against the already-written `external_post_id`)
2. **P8→P3 carrier** — top-performing posts into generation prompts. *This is the loop closing.*
3. `optimal_posting_times` from real performance data
4. Loop-closure health dashboard
5. Everything in the Horizon Register (D8), subject to its trigger conditions

---

## Wave 7 — Worker migration to Fly.io *(~1 week, after Gate 6)*

Infrastructure relocation of the Python worker (and any future workers) from Railway to Fly.io. Not new capability — it does not breach the Completion Lock.

| Lock | What | Proven by | Guarded by |
|---|---|---|---|
| **L7.1** | Commit `fly.toml`; **delete `railway.toml`** in the same change | Repo describes exactly one host | CI check: exactly one deploy config present |
| **L7.2** | Set worker env on Fly: `WORKER_GROQ_API_KEY`, `WORKER_WEBHOOK_SECRET`, `WORKER_ANTHROPIC_API_KEY`, `WORKER_YOUTUBE_COOKIES` | Worker boots — `config.validate_runtime_credentials()` passes, which it cannot today | Startup validation (already built, L1.4) |
| **L7.3** | Point `WORKER_WEBHOOK_URL` at the Fly host in Vercel | App→worker call succeeds with the rotated shared secret | Health check on the round trip |
| **L7.4** | Verify the P5 pipeline end to end on Fly | A real YouTube URL produces captioned clips | Ingestion success-rate metric (DoC-2) |
| **L7.5** | Confirm ffmpeg and disk sizing on Fly | A 60-min source renders without OOM or disk-full | Per-stage failure metrics |

**Why after lockdown, not before:** migrating a worker that cannot currently boot would move a broken service to a new host and prove nothing. Fixing configuration first (L7.2) means the first Fly deploy is also the first working deploy, and any failure is attributable to the migration rather than to pre-existing breakage.

**Note:** `config.validate_runtime_credentials()` built in L1.4 makes this migration self-verifying — a Fly deploy missing a required key refuses to start rather than accepting jobs and failing every one, which is exactly how the Railway deployment ended up silently broken.

---

## Timeline

| Wave | Duration | Cumulative |
|---|---|---|
| −1 — Standards | 3 days | ✅ done |
| 0 — Lock mechanism | 1 wk | 1 |
| 1 — Stop the bleeding | 1 wk | 2 |
| 2 — UI truth | 2 wks | 4 |
| 3 — Delete | 2 days | 4.5 |
| 4 — Connect | 1–2 wks | 6 |
| 5 — Complete | 6–8 wks | 14 |
| 6 — Audit gaps | 1 wk | 15 |
| 7 — Fly.io worker migration | 1 wk | 16 |
| **Lockdown total** | | **~16 weeks** |
| *(with the red team's 1.4× correction)* | | **~19–21 weeks** |

Waves 3 and 4 can run parallel to Wave 2. Wave 6 can run parallel to Wave 5.

---

## The Regression Register

The mechanism that keeps locks locked. **One row per lock, permanently.**

| Lock | Guard | Where it runs | Fails how |
|---|---|---|---|
| L1.1 RLS | Cross-tenant test | CI, blocking | Build fails |
| L1.3 No fabrication | Constant-write assertion | CI | Build fails |
| L1.4 Fail-closed | Startup validation | Deploy | Worker refuses to boot |
| L2.1 Truthful badges | Badge↔state test | CI | Build fails |
| L2.3 No frozen rows | Non-terminal >15 min | Runtime alert | Pages you |
| L2.4 No no-ops | offered == handled | CI | Build fails |
| L4.x Connected | Live-path assertions | CI | Build fails |
| L5.9 Timeouts | Lint: no `fetch` without signal | CI | Build fails |
| — Provider health | Fallback-activation alert | Runtime | Pages you |
| — Cost | Per-user deviation alert | Runtime | Pages you |

**Rule:** a lock without a row here is not locked. If a guard cannot be written for an item, that item does not pass its gate — and that is a signal the fix is not well understood yet.

---

## Three rules for the duration

1. **No new capability.** If it needs a new table, a new third-party integration, or a new nav item, it goes to D8 — regardless of how good the idea is.
2. **No fix without a guard.** Fixed-but-unguarded is how this codebase got here.
3. **A gate that cannot be demonstrated is not passed.** Not "I believe it works" — a planted failure gets caught, or the gate stays shut.

---

## Status — 2026-08-22

| Wave | State |
|---|---|
| −1 Standards + `CLAUDE.md` | ✅ complete |
| 0 Lock mechanism | ✅ except **L0.4** (error tracking — needs a Sentry account) |
| 1 Stop the bleeding | ✅ complete, all verified live |
| 2 UI stops lying | ✅ complete |
| 3 Delete dead code | ✅ complete — ~1,900 lines |
| 4 Connect what exists | ✅ complete |
| 5 Complete the inadequate | 🟡 **L5.9 done**, 14 items remain |
| 6 Audit gaps · 7 Fly migration | ⬜ not started |

**9 migrations applied and verified. 12 of 14 guards run automatically.**

Outstanding, all on the founder side:
- Deploy the 14 modified edge functions (also the first real Deno type-check)
- 5 GitHub secrets for the daily `live-invariants` job
- Sentry account for L0.4
- Zernio dashboard access — L5.1 is the keystone and four pillars sit behind it

## Progress

| | Item | State |
|---|---|---|
| ✅ | **Wave −1** — engineering standards + `CLAUDE.md` | Done |
| ✅ | **L0.2** — cross-tenant probe built (`scripts/security/cross-tenant-probe.mjs`) | Built; CI wiring pending |
| ✅ | **L1.3** — fabricated trend writer disabled | Code done |
| ✅ | **L1.4** — fail-closed defaults + real Anthropic key enforced | **Demonstrated** |
| ✅ | **L1.1** — RLS fix applied to production | **VERIFIED GREEN** |
| ✅ | **L1.2** — `WORKER_WEBHOOK_SECRET` rotated + redacted | Local done; **paste into Railway + Vercel** |
| ✅ | **L1.5** — privilege escalation closed | **VERIFIED — 403 on both exploits** |
| ✅ | **L1.6** — Zernio OAuth CSRF closed | Demonstrated live |
| | | |
| 🎉 | **WAVE 1 COMPLETE — Gate 1 passed** | Nothing is actively leaking |

### Before → after (the lock demonstrated)

`node scripts/security/cross-tenant-probe.mjs`

| | Before (FAIL) | After (PASS) |
|---|---|---|
| `posts` | 188 visible, **73 foreign from 6 users** | 110 visible, **0 foreign** |
| `generations` | 159 visible, **39 foreign from 6 users** | 115 visible, **0 foreign** |
| 16 other tables | clean | clean |

The visible-row counts dropping is the confirmation: the probe account now sees only its own rows plus legitimately org-shared ones.

**This narrows the finding usefully:** tenant isolation is correct on 16 of 18 tables, including credits, connected accounts, and brand kits. Exactly two tables carry a stray policy. Both innocent explanations were ruled out — the probe account holds no `admin_roles` row, `is_super_admin_user` returns null for it, and 73 of the leaked posts have no `organization_id` at all.

## ✅ L1.5 — closed (record of what it took)

**Resolved 2026-08-21.** Kept here because the two-attempt sequence is the clearest illustration of this codebase's core defect.

```
PATCH /rest/v1/profiles?id=eq.<self>  {"role":"admin"}   ->  HTTP 200
```

Write-confirmed on a real non-admin account (`"parent"` -> `"admin"`, reverted immediately). The chain:

`profiles.role='admin'` -> `get_admin_role()` returns `super_admin` -> `is_admin_user()` / `is_super_admin_user()` true -> `can_admin_access_user(anyone)` true -> the `posts` and `generations` policies grant **every row**.

`profile_self_update_guard()` already exists and is correct, and migration `20260513160000:194-214` already wires it in — **that policy is simply not what is live.** The same "migrations lie" pattern.

**It took two migrations, and the first one failing is the lesson.**

`20260821120000` dropped the two known policies BY NAME and recreated them correctly — and changed nothing observable, because RLS policies are OR-ed and an additional live-only permissive policy kept granting the write. Exactly the defect class as the original `posts` leak.

`20260821140000` applied the allowlist sweep instead (drop everything not on a known-good list, then assert exactly two UPDATE policies survive). That worked: both exploits now return **HTTP 403** rather than the earlier 204-with-no-effect.

**Generalised rule, now in `engineering/01-versioning.md`:** never fix RLS by dropping named policies. Assert the end state with an allowlist sweep, because the policy causing the problem is by definition the one you do not know about.

### Correction recorded

An intermediate report claimed users could mint unlimited spendable credits. **That was wrong and is retracted.** Two columns exist: `profiles.credits` (self-writable, display only) and `user_credits.balance` (the real spend gate, verified NOT self-writable — the PATCH returned 204 but the value was unchanged, which is what PostgREST returns when RLS filters the row). Impact was display integrity, not free AI. Finding P10s-010 downgraded BLOCKER -> MAJOR.

## What to do next

### Worker hosting — Railway today, Fly.io planned

Confirmed with the founder 2026-08-21: the Python worker currently runs on **Railway**; migrating it (and the workers generally) to **Fly.io** is planned for after lockdown. The repo contains only `video-worker/railway.toml` and no Fly config, which matches.

**Consequence for this plan:** the two outstanding worker env vars (`WORKER_WEBHOOK_SECRET`, `WORKER_GROQ_API_KEY`) are deliberately NOT being set on Railway — they will be set on Fly during the migration instead. Until then the worker stays down, which is acceptable because it is already down (no Groq key) and P5 clipping is not on the critical path for Waves 2-4.

**Scope ruling:** the Fly migration is infrastructure relocation, not new capability, so it does not violate the Completion Lock. It is sequenced as **Wave 7** below rather than deferred to the Horizon Register. It carries two standards obligations from `engineering/01-versioning.md`: commit `fly.toml` to the repo, and delete `railway.toml` in the same change so the repo never describes two hosts at once.

## What to do next

1. ~~Paste the rotated secret into your worker host and Vercel~~ — **Vercel done.** Worker side deferred to the Fly migration (Wave 7). (`WORKER_WEBHOOK_SECRET` and `VIDEO_WORKER_WEBHOOK_SECRET` respectively). Until then the hosted worker and hosted app disagree and worker callbacks will 401.
2. ~~Set `OAUTH_STATE_SECRET` in Vercel~~ — **done.**
3. **Set `WORKER_GROQ_API_KEY`** — deferred to the Fly migration (Wave 7). One variable brings the clipping pillar online; the worker refuses to boot without it by design.
