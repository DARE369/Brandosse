# D8 — Horizon Register
**Deep Launch-Readiness Audit · Brandosse** · 2026-08-21

> **Parked. Dated. Unscheduled. Explicitly excluded from D6 and D7.**
>
> Per the Completion Lock: no new feature enters the roadmap until everything already in the codebase has a costed plan to completion. Everything here is a genuinely new capability — new table, new integration, or new top-level surface.
>
> Each carries the **trigger condition** that would un-park it. Nothing here should be built before its trigger fires.

---

## H1 · Ground the discovery score in external data
**Dated:** 2026-08-21 · **Origin:** P7-001/002
Keyword volume, competition data, or platform trend APIs feeding the scoring rubric so the score predicts something.
**Why parked:** requires a new third-party integration. D6 item C10 relabels the score honestly instead, which is the correct interim move.
**Trigger:** loop closure (D6 Phase D) is INTACT *and* score-to-outcome correlation has been measured for ≥3 months. Ground it in the user's own data before buying anyone else's.

## H2 · Learned scoring weights
**Dated:** 2026-08-21 · **Origin:** P7-002
Replace the hand-assigned `BREAKDOWN_WEIGHTS` with weights trained on the user's actual outcomes.
**Why parked:** needs a real performance corpus that does not exist yet.
**Trigger:** ≥1,000 published posts with metrics across the user base. **This is the most likely genuine L5 in the product** — an actual reason to switch.

## H3 · Campaigns, series, and repurposing plans
**Dated:** 2026-08-21 · **Origin:** P2-005/006
Multi-post campaign structures, recurring series, automated repurposing chains.
**Why parked:** new DB tables and a new top-level surface. D6 delivers bulk operations (C5) instead, which covers most of the practical need.
**Trigger:** users request it unprompted after the calendar reaches L4.

## H4 · B-roll insertion for clips
**Dated:** 2026-08-21 · **Origin:** P5 gap
Automatic stock or generated footage over talking-head segments.
**Why parked:** new asset pipeline and licensing surface. Category leaders ship it, so it is genuine competitive pressure — but it is new.
**Trigger:** clipping reaches L4 and clip acceptance rate plateaus with B-roll named as the reason.

## H5 · Multi-language subtitles and dubbing
**Dated:** 2026-08-21 · **Origin:** D2 §1.1 (Vizard ships 100+ languages)
**Why parked:** new capability. Transcription already returns a language field, so the substrate exists.
**Trigger:** ≥15% of ingested content is non-English.

## H6 · Thumbnail generation and testing
**Dated:** 2026-08-21 · **Origin:** P7-005 (thumbnails MISSING entirely)
**Why parked:** new surface; meaningful for YouTube reach.
**Trigger:** YouTube becomes a top-two publishing destination by volume.

## H7 · Competitor content monitoring
**Dated:** 2026-08-21 · **Origin:** P1-001 (no external signal)
Track competitor accounts to inform ideation.
**Why parked:** new integration, new tables, and a platform-ToS question that needs answering first.
**Trigger:** ideation reaches L4 on first-party signal and users still say suggestions are generic.

## H8 · Server-side rendering migration
**Dated:** 2026-08-21 · **Origin:** ARCH-004
Move meaningful surfaces to React Server Components.
**Why parked:** structural change across 94k lines; not required for launch. **Also blocks progressive autonomy** (D3 §5) since client-side logic cannot be driven headlessly.
**Trigger:** measured production cold-load exceeds acceptable TTFV *or* agentic execution moves onto the roadmap.

## H9 · Multi-shot video assembly with audio
**Dated:** 2026-08-21 · **Origin:** P4-012
Script → shot planning → multi-clip assembly → voiceover → captions → render.
**Why parked:** effectively a new product inside the product. Current output is a single mute shot.
**Trigger:** single-shot generation works reliably (F1), is repriced profitably (C9), and shows real usage.

## H10 · Team / agency / multi-tenant surfaces
**Dated:** 2026-08-21 · **Origin:** out of audit scope
**Why parked:** explicitly out of scope. `src/org/**` exists but was not audited.
**Trigger:** personal dashboard reaches L4 and paying users request collaboration.
**Note:** the audit found no architectural decision in the personal surface that *forecloses* this — org tables and RLS scaffolding already exist.

## H11 · Cross-tenant automated security suite
**Dated:** 2026-08-21 · **Origin:** P10s-001
Beyond the single cross-tenant test in D6 A1: continuous authorization fuzzing across all endpoints.
**Why parked:** A1 delivers the essential coverage. This is the mature version.
**Trigger:** first paying customers, or any second authorization incident.

## H12 · Idea → brief → campaign chain
**Dated:** 2026-08-21 · **Origin:** P1-005
A structured brief object flowing from ideation through generation.
**Why parked:** `ai-generate-brief` is MISSING and the brief would be a new artifact type.
**Trigger:** ideation and planning both at L4 and the idea→plan handoff still measures LOSSY.

## H13 · Make an account deletable
**Dated:** 2026-08-22 · **Origin:** discovered while building the L5.15 first-run test
Deleting a user that owns content fails outright. 56 of the 96 foreign keys to `auth.users` in this schema carry no `ON DELETE CASCADE`, so Postgres raises 23503 and refuses the whole delete.

**Evidence (live, 2026-08-22):** `DELETE /auth/v1/admin/users/<id>` on an account with one generated post returned 500 `23503 — violates foreign key constraint "posts_user_id_fkey" on table "posts"`. Clearing `posts` then exposed the next layer: `sessions` blocked by `content_plans`. Four tables had to be emptied in dependency order before the user could be removed — `posts → generations → content_plans → sessions`.

**What this means:** the admin "Delete Account" control at `src/admin/components/UserDetailsPanel/UserDetailsPanel.jsx:250` cannot succeed for any user who has ever generated anything. A right-to-erasure request currently has no working path.

**Why parked:** the fix is a migration rewriting FK constraints across ~56 relationships — a schema change, not completion work — and the surface that needs it is admin, which is outside this audit's scope. Doing it carelessly is worse than not doing it: `CASCADE` on the wrong FK silently destroys data that should have been retained.

**Trigger:** the first deletion request, or admin entering scope — whichever comes first. Not before, but not much after either: this one has a legal clock attached rather than a product one.

**Interim:** `tests/e2e/time-to-first-value.spec.js` resolves the chain itself for its own test accounts, so the suite does not leak users. That is a workaround inside a test, not a fix.

---

---

## Register discipline

**Nothing here enters D6 or D7.** If an item feels urgent, that urgency is evidence its trigger condition should be examined — not evidence it should skip the queue.

Two items are worth watching specifically:

- **H2 (learned scoring weights)** is the most credible path to a genuine L5, and it un-parks naturally once the loop closes. It is the strategic prize.
- **H8 (SSR migration)** is the quiet one — it will be forced eventually by either performance or the autonomy trajectory, and it gets more expensive the more surface area accumulates on the client.
