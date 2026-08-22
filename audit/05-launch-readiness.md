# D5 — Launch Readiness Assessment
**Deep Launch-Readiness Audit · Brandosse** · Phase 5 · 2026-08-21

---

## 1. Scorecard

Target is the **L4 launch gate** from D4 (L5 on every pillar is the founder's stated end-state, sized separately in §6).

| Pillar | Current | Target | Gap | Effort | Dominant blocker |
|---|---|---|---|---|---|
| P1 Ideation | L1 | L4 | 3 | L | No real signal; brand-kit conversation stubbed |
| P2 Planning | L1.5 | L4 | 2.5 | L | AI actions silently no-op; no bulk ops |
| P3 Text gen | L2.5 | L4 | 1.5 | M | No versioning; stale default model |
| P4 Video gen | L1 | L4 | 3 | XL | Never produced a video; economics negative |
| P4i Image gen | **L3.5** | L4 | 0.5 | S | Hotlinked assets; brand colors not deterministic |
| P5 Clipping | L2 | L4 | 2 | **S–M** | Two unset env vars; truncation; presets |
| P6 Publishing | L2 | L4 | 2 | L | 1 working account; no reaper; lying UI |
| P7 SEO/reach | L2 | L4 | 2 | XL | No ground truth; cannot learn |
| P8 Analytics | L1 | L4 | 3 | XL | No real data; loop BROKEN |
| P9 Shell | L2 | L4 | 2 | L | 29% un-migrated; UI misreports state |
| P10 Foundations | L1 | L4 | 3 | L | **Cross-user data exposure** |

### Overall readiness

```
Readiness = Σ(current maturity) ÷ Σ(target maturity)
          = (1 + 1.5 + 2.5 + 1 + 3.5 + 2 + 2 + 2 + 1 + 2 + 1) ÷ (11 × 4)
          = 19.5 ÷ 44
          = 44%
```

*(Eleven pillars scored. P4i added 2026-08-21 at L3.5 — the highest-rated pillar in the audit.)*

**Blocker-adjusted readiness: lower than 40%.** The raw figure treats maturity as linear and additive, which flatters the result in two ways: a security pillar at L1 is not 25% of a shippable security posture — it is a hard gate at zero; and 29 BLOCKER findings do not scale, they veto. **A defensible headline is "44% by maturity, 0% by gate"** — because no launch is possible at any maturity while cross-user data is readable.

---

## 2. Go / No-Go Verdict

# 🔴 NO-GO

**This is unambiguous and rests on three independent grounds, any one of which is sufficient.**

**1. Live data exposure.** Any authenticated user can read other users' `posts` and `generations` — full captions and prompts — with an ordinary JWT. I verified this personally: 30 foreign posts from 7 users, including identifiable business content from a named school. **Launching would expose real customers' unpublished content to each other.** No product consideration outweighs this.

**2. The core product does not do what it claims.** Publishing reaches one platform on one account (6 posts, lifetime). Four accounts display "active" and cannot publish at all. Twenty posts have been frozen in a non-terminal state since April. Buffer's *free* tier — 3 channels, real publishing — exceeds our paid capability today.

**3. The differentiator is unimplemented.** The thesis is a closing loop. It does not close: every handoff from "Platform → Analytics" onward is graded BROKEN with no carrier. There is no real engagement data anywhere in the system, and the one scheduled job that does run writes fabricated trend data. **Without the loop, this is a content generator competing with ChatGPT — on a two-year-old model.**

**What a No-Go does not mean.** This is not a verdict that the work is bad. The audit found genuinely strong engineering — a correct publish queue with idempotency and retries, brand-voice injection that verifiably works, a real clip-scoring rubric, best-in-class transcription at $0.04/hour, and a credit system with atomic reserve/refund. **The problem is overwhelmingly disconnection, not absence: 105 of 117 findings describe things that already exist.** That is a far better position than it feels like from this document.

---

## 3. Minimum Credible Launch (MCL)

The smallest scope where a Power Migrant would pay and a Casual Operator can succeed on day one.

**The MCL is not "all ten pillars at L4." It is a narrower product, launched honestly.**

### Proposed MCL: *"Clip your long-form video and publish it everywhere."*

| In | Why |
|---|---|
| **P10 security** to L4 | Non-negotiable gate |
| **P6 publishing** to L4 (≥4 real platforms, reaper, truthful account state, failure notifications) | The keystone; without it nothing downstream can exist |
| **P5 clipping** to L4 (ingestion fixed, transcription key, truncation fixed, export presets) | Our strongest asset, ~96% margin, cheapest unblock in the audit |
| **P3 text gen** to L4 (versioning, current model, refinement) | Needed to caption the clips |
| **P9 shell** to L4 (finish ui-v2, truthful UI, working nav) | Founder-designated requirement; also fixes a broken billing page |
| **P2 calendar** to L3 (remove no-op actions, add bulk ops) | Scheduling is how clips reach platforms |

| Cut | What the cut costs |
|---|---|
| **P4 video generation** | Loses a headline capability — but it has never worked, has negative margin at the cheapest tier, produces silent single-shot output, and **fixing it makes unit economics worse** (P10o-002). Cutting it is the single highest-leverage scope decision available |
| **P8 analytics → real data only, no loop** | Ship truthful post/account stats; do **not** claim insight. The loop becomes the first post-launch programme |
| **P7 discovery score → relabelled** | Keep it, present it as a stylistic checklist, not a reach predictor. Costs the "reach engineering" claim |
| **P1 ideation → generic starters, honestly labelled** | Costs the "trend-driven" claim. Fabricated trends must be switched off regardless |

**What this cut costs strategically:** the pitch narrows from "unified content OS with a closing loop" to "the best clip-to-publish pipeline." That is a real reduction in ambition — **and it is a defensible product that beats named competitors on a specific job**, which the current scope does not for any job.

**The honest tension to name:** the founder's Gate 0 answer was "all pillars, non-negotiable." The MCL contradicts that. The reconciliation is sequencing, not abandonment — with no fixed date, all pillars *can* reach L5, but not simultaneously and not before first revenue. **The MCL is the first increment of that path, not a replacement for it.**

---

## 4. Three Launch Scenarios

Effort is in **weeks of solo-founder work with AI assistance**, per Gate 0 (no fixed date; quality gates the launch).

### Aggressive — ~8–10 weeks
**Scope:** Security + P6 publishing + P5 clipping + minimal P9 fixes. Everything else hidden or labelled beta.
**Risk accepted:** launching with no analytics story and no differentiator beyond clip quality. Competing head-on with Opus Clip/Klap on their turf, with a weaker feature set but a publishing pipeline they lack.
**Fails if:** Zernio cannot deliver 4 platforms reliably, or clip quality does not hold on real user content.

### Realistic — ~16–20 weeks ✅ *recommended*
**Scope:** Full MCL (§3) at L4, plus P8 real metrics ingestion and one INTACT loop handoff (P8→P3: top-performing posts as prompt context).
**Risk accepted:** P4 video generation cut from v1; ideation and reach claims softened to what is true.
**Why this one:** it is the shortest path that produces a product with a *defensible* answer to "why switch" — clip-to-publish in one pipeline, with content that learns from what actually performed. **It closes one loop handoff, which converts the thesis from aspiration to demonstrated.**

### Safe — ~28–36 weeks
**Scope:** All ten pillars to L4 including P4 video generation repaired and repriced, full loop closure, full ui-v2 migration, test coverage and observability built out.
**Risk accepted:** long time to first revenue and no market feedback during the build — the most dangerous risk in the list, because every finding in this audit describes something built without contact with real usage.
**Note:** this is closest to the founder's stated "all pillars" position. **Its principal danger is not execution — it is building for another eight months against assumptions no user has tested.**

---

## 5. Top 10 Launch-Blocking Risks

| # | Risk | P | Impact | Mitigation | Early-warning signal |
|---|---|---|---|---|---|
| 1 | **Cross-user data exposure reaches production** | Certain if unfixed | Catastrophic — breach, trust, legal | Run the `pg_policies` query; fix RLS; add the cross-tenant test | Automated test logging in as A reading B's rows |
| 2 | **Committed webhook secret abused** | Medium | High — forged job callbacks | Rotate now; purge history; secret scanning in CI | Unexplained `video_jobs` state changes |
| 3 | **Zernio is a single point of failure for all publishing** | Medium | Critical — publishing is the keystone | Verify Zernio SLA/limits; design for provider swap | Publish failure rate by platform |
| 4 | **Fixing P4 destroys unit economics** | High if P4 ships unrepriced | High — loss per heavy user | Reprice *before* repairing (P10o-002); per-user ceiling | Cost-per-user tracking (does not exist) |
| 5 | **No observability means the next silent failure also goes unnoticed** | Certain | High — compounding | Fix `get_cron_job_status` allowlist; add error tracking + alerts | Any incident found by a user before the operator |
| 6 | **Clip quality does not survive real user content** | Medium | High — it is the strongest asset | Test on 20 varied real videos before launch | Clip acceptance/edit rate |
| 7 | **YouTube ingestion remains unreliable** | High | High — blocks the primary input | Cookie rotation now; residential proxies durably | Ingestion success rate by source |
| 8 | **Loop never closes; no differentiation emerges** | Medium | Existential — removes the reason to exist | Sequence P6 → P8 → one INTACT handoff | Count of generations informed by prior performance |
| 9 | **Stale default model caps output quality** | Certain today | Medium — users compare to their own ChatGPT | Set `ANTHROPIC_MODEL` explicitly; re-tune prompts | Blind A/B of output vs current models |
| 10 | **Building 8 more months with zero user contact** | High in the Safe scenario | High — the audit's own root cause | Ship the MCL; get real usage early | Weeks since last real-user feedback |

**Risk 10 deserves emphasis.** Nearly every finding here — dead code, unset variables, fabricated trends, a silently broken week-plan button — shares one cause: **features were built and never exercised by a real user.** Extending that period is the most reliable way to reproduce this audit in six months.

---

## 6. On "all pillars at L5"

Recorded honestly, because it was a Gate 0 answer and it shapes everything.

L5 means *better than the category leader*. Reaching it on ten pillars simultaneously means beating Opus Clip at clipping, Buffer at publishing, Jasper at copy, Metricool at analytics, Runway at video generation, and VidIQ at reach — as one person.

**That is not achievable as a launch gate.** It is achievable as a *direction*, and the sequencing matters more than the ambition: L5 must be earned on one pillar first, and that pillar should be **the loop** — because it is the only one where no competitor has an entrenched position, and because closing it makes every other pillar better automatically. A post that learns from what performed improves P1, P2, P3, and P7 at once.

**Recommendation: target L4 broadly, L5 on loop closure.** That is one defensible "reason to switch," which is all a launch needs.

---

## 7. Audit Coverage Caveats

Stated plainly, per the charter's honesty requirement:

1. ~~P4i was never audited~~ — **CLOSED 2026-08-21.** Audited directly after the agent was killed four times. Result: credit integrity is **correct** (users are not charged for failed generations), margins are positive at every tier, and brand kit reaches the prompt. It is the strongest pillar in the audit. 5 findings in `findings/A7-P4i.yaml`.
2. **P10 quality/observability is partial** — 3 of ~9 findings. The swallowed-error inventory, timeout/retry table, and actual test-suite results are missing.
3. **Persona walkthroughs never ran.** UX findings are code-derived or single-agent observations, not a full unaided first-run session.
4. **Production environment is unverified throughout.** Vercel, Supabase edge secrets, and Railway variables were not readable. Several findings (worker deployment, `ANTHROPIC_MODEL`, mock flags, `WORKER_GROQ_API_KEY`) may differ in production. **Each is flagged in its finding; none changes the verdict**, which rests on the RLS exposure, live DB evidence, and code paths that are environment-independent.
