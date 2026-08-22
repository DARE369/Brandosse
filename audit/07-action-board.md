# D7 — Prioritized Action Board
**Deep Launch-Readiness Audit · Brandosse** · 2026-08-21

Flat, sortable, tracker-importable. Effort in weeks of solo-founder work with AI assistance.
`DoC-n` references trace to D4. `EXISTS` = complete/connect what is there; `BUILD` = genuinely new.

| ID | Pri | Title | Pillar | Findings | Type | Effort | Depends on | Acceptance |
|---|---|---|---|---|---|---|---|---|
| A1 | **P0** | Close cross-user RLS gap on `posts`/`generations` + cross-tenant test | P10 | P10s-001/002 | EXISTS | M | — | DoC-10 |
| A2 | **P0** | Rotate committed `WORKER_WEBHOOK_SECRET`, purge history, add secret scanning | P10 | P10s-005 | EXISTS | S | — | DoC-10 |
| A6 | **P0** | Stop writing fabricated trend data (`daily-analysis:337-372`) | P8 | P8-001 | EXISTS | XS | — | DoC-5 |
| A7 | **P0** | Mock flags default to `False`; validate keys at startup | P4/P10 | P4-004, P5-010 | EXISTS | XS | — | DoC-8 |
| A5 | P1 | Delete cron-monitoring allowlist; alert on unknown/failing jobs | P10 | P7-005 | EXISTS | XS | — | DoC-10 |
| A3 | P1 | Fix `admin-list-posts` privilege path | P10 | P10s-006 | EXISTS | S | — | DoC-10 |
| A4 | P1 | Add CSRF state to Zernio OAuth callback | P10 | P10s-007 | EXISTS | S | — | DoC-10 |
| A8 | P1 | Delete dead `src/app/**` + `src/api/**` (17 files) | P10 | ARCH-001 | DELETE | XS | — | ARCH-001 |
| B2-1 | **P0** | Set `WORKER_GROQ_API_KEY` | P5 | P5-008, P5-002 | EXISTS | **XS** | — | DoC-2 |
| B2-2 | **P0** | Fix YouTube ingestion (cookies → durable rotation) | P5 | P5-007 | EXISTS | S→L | — | DoC-2 |
| B1 | **P0** | Reaper for `publishing` / `background_jobs.queued` / `video_clips.pending` + backfill 20 rows | P6 | P6-003 | BUILD | S | — | DoC-1 |
| B2 | **P0** | Truthful account state; migrate `provider='direct'`; badge from capability | P6 | P6-002, P9-004 | EXISTS | M | — | DoC-1, DoC-9 |
| B3 | **P0** | Expand real publishing to ≥4 platforms via Zernio | P6 | P6-001 | EXISTS | **L** | B5 | DoC-1 |
| B5 | P1 | Verify Zernio SLA, limits, token refresh, pricing | P6 | P6-004 | EXISTS | S | — | Risk #3 |
| B4 | P1 | Publish-failure notifications to `user_notifications` | P6 | P6-006 | BUILD | M | B3 | DoC-1 |
| B2-3 | P1 | Fix clip-analysis truncation on long videos | P5 | P5-004 | EXISTS | M | B2-1 | DoC-2 |
| B2-5 | P1 | Stop rendering raw tracebacks; fix false "credits refunded" | P5 | P5-xxx | EXISTS | S | — | DoC-2 |
| C9 | **P0** | Reprice video generation; remove silent 3× tier upgrade; reconcile cost table | P4/P10 | P10o-001/002/003 | EXISTS | M | — | DoC-8 |
| C2 | P1 | Set `ANTHROPIC_MODEL` explicitly; per-task policy; alert on fallback | P3 | P3-010, P3-001 | EXISTS | S | — | DoC-3 |
| C4 | P1 | Implement or remove the 4 no-op calendar AI actions | P2 | P2-004 | EXISTS | M | — | DoC-4 |
| C1 | P1 | Text versioning + instruction-based refinement via `content_versions` | P3 | P3-003 | EXISTS | M | — | DoC-3 |
| C3 | P2 | Reconnect `generate-caption` to the regenerate path | P3 | P3-005 | EXISTS | S | C1 | DoC-3 |
| C6 | P1 | Finish ui-v2 migration (5 routes); fixes unstyled billing page | P9 | P9-008, ARCH-002 | EXISTS | L | — | DoC-9 |
| C7 | P2 | Shared nav component; add missing video-gen entry | P9 | P9-001/002 | EXISTS | S | C6 | DoC-9 |
| C8 | P2 | Connect or remove the dead header search box | P9 | P9-010 | EXISTS | S | C6 | DoC-9 |
| C5 | P2 | Bulk calendar operations (multi-select, reschedule, delete) | P2 | P2-005/006 | BUILD | M | — | DoC-4 |
| C10 | P2 | Relabel discovery score as a stylistic checklist | P7 | P7-001 | EXISTS | S | — | DoC-7 |
| C11 | P2 | Complete brand-kit conversation | P1 | P1-004 | EXISTS | M | — | DoC-5 |
| B2-4 | P2 | Platform export presets (9:16 / 1:1 / 16:9) | P5 | P5-006 | BUILD | M | B2-1 | DoC-2 |
| B2-6 | P2 | Delete dead clipping modules (~800 lines) | P5 | ARCH-003 | DELETE | XS | B2-1 | ARCH-003 |
| D1 | **P0** | Ingest real platform metrics against `external_post_id` | P8 | P8-006 | **BUILD** | **L** | B3 | DoC-6 |
| D2 | **P0** | Close P8→P3: top performers into generation prompts | P8/P3 | P8-002, P7-002 | **BUILD** | M | D1 | DoC-6 |
| D3 | P1 | Reconnect `OptimalTimesService` to real performance | P2/P8 | P2-003 | EXISTS | M | D1 | DoC-6 |
| D4 | P1 | Analytics export, date-range, per-platform, drill-down | P8 | P8-xxx | BUILD | M | D1 | DoC-6 |
| D5 | P2 | Loop-closure health dashboard | P8 | — | BUILD | S | D2 | DoC-6 |
| E1 | P1 | Error tracking + alerting (Sentry or equivalent) | P10 | P10q-xxx | BUILD | M | — | DoC-10 |
| E3 | P1 | CI runs tests; wire guard scripts; cross-tenant test blocking | P10 | P10q-xxx | EXISTS | S | A1 | DoC-10 |
| E2 | P1 | Timeouts on every outbound provider call | P10 | P10q-xxx | EXISTS | S | — | DoC-10 |
| E7 | P1 | Close remaining audit gaps: persona walkthroughs; **run** the test suite and guard scripts | — | D5 §7 | AUDIT | S | — | D5 §7 |
| C12 | P1 | Add timeouts to all provider calls — `zernio.service.ts` has 4 fetch calls, 0 timeouts | P10 | P10q-005 | EXISTS | S | — | DoC-10 |
| C13 | P2 | Store hotlinked image assets in Supabase; reclassify placeholder rows | P4i | P4i-004 | EXISTS | M | — | DoC-8 |
| E5 | P2 | Cost-per-user tracking + video ceiling + deviation alerts | P10 | P10o-002 | BUILD | M | C9 | DoC-10 |
| E4 | P2 | Onboarding to first value ≤5 min | P9 | P9-xxx | EXISTS | M | C6 | DoC-9 |
| E6 | P2 | Empty states with guidance on every zero-data surface | P9 | P9-xxx | EXISTS | S | C6 | DoC-9 |
| F1 | P3 | Repair video generation end-to-end | P4 | P4-002 etc. | EXISTS | XL | **C9** | DoC-8 |
| F2 | P3 | Audio/voiceover for generated video | P4 | P4-012 | BUILD | L | F1 | DoC-8 |

---

## Sort orders

**By "do this first" (P0, ordered):**
`A1` → `A2` → `A6` → `A7` → `B2-1` → `B1` → `C9` → `B2-2` → `B2` → `E7` → `B3` → `D1` → `D2`

**Cheapest wins (XS/S, high impact):**
`B2-1` (one env var, unblocks the whole clipping pillar) · `A6` · `A7` · `A5` · `A8` · `B1` · `C2` · `B2-6`

**By type:** 33 `EXISTS` · 9 `BUILD` · 3 `DELETE` · 1 `AUDIT`

---

## The five that matter most

1. **A1** — cross-user data exposure. Nothing ships until this is closed.
2. **B2-1** — one environment variable unblocks the strongest asset in the product (~96% margin).
3. **C9** — reprice video **before** repairing it, or scale losses.
4. **B3** — publishing breadth is the keystone; four pillars are blocked behind it.
5. **D2** — closing one loop handoff is what converts the thesis from claim to product.

> `F1`/`F2` are listed for completeness. **D5 recommends cutting video generation from v1**; if kept, `C9` must precede `F1`.
