# Task Matrix

Status values:

- `missing`: not implemented yet.
- `partial`: implemented partly or with known gaps.
- `done`: implemented and verified.

Verification values:

- `pending`
- `pass`
- `fail`

## Locked Acceptance Source

Acceptance criteria below are locked from roadmap “How to verify” plus stage requirements in the execution plan.

| Task ID | Scope | Baseline Status | Current Status | Verification | Acceptance Criteria (Locked) |
| --- | --- | --- | --- | --- | --- |
| 1A-1 | Canonical generation path + legacy quarantine | partial | done | pass | Generate page loads, single generation completes, no imports to old `state/` paths. |
| 1A-2 | Publish idempotency | missing | done | pass | Double publish click creates one publish log per post/account and disables button in-flight. |
| 1B-1 | Secure + real doc extraction | missing | done | pass | Real extraction output, 401 without token, 403 on non-owned storage path. |
| 1B-2 | Conversational brand kit capture | partial | done | pass | 6-question flow yields structured reviewable brand-kit output and save succeeds. |
| 1B-3 | Brand kit version tracking | missing | done | pass | `brand_kit.version_hash` persists and generation metadata stores applied hash. |
| 1C-1 | AI caption + hashtags edge flow | missing | done | pass | Generate Caption uses new edge function and respects platform constraints. |
| 1C-2 | AI SEO optimization edge flow | partial | done | pass | Optimize action returns diff-capable output, score badge, accept/reject UX. |
| 1C-3 | Brand-aware prompt enhancement | missing | done | pass | `enhance-prompt` accepts `brandKit` + `previousPrompts` and output is shown. |
| 1D-1 | Post status machine guard | missing | done | pass | Invalid transitions are blocked; valid transitions succeed. |
| 1D-2 | Deterministic save draft + library link | partial | done | pass | Save draft upsert is deterministic and library linkage always occurs. |
| 1E-1 | Drag-drop reschedule verification | partial | done | pass | Drag updates `scheduled_at`; terminal statuses are protected; clear success/failure feedback. |
| 1E-2 | Ghost-slot empty explanation | missing | done | pass | Empty ghost state explains warm-up behavior and worker TODO is documented in code. |
| 1F-1 | Library to generate handoff | missing | done | pass | Use-in-post preloads media context and validates ownership. |
| 1G-1 | Forgot/reset password flow | missing | done | pass | `/forgot-password` and `/reset-password` end-to-end recovery works. |
| 1H-1 | Help complaint timeline | missing | done | pass | Timeline shows status/comment history excluding internal comments. |
| 2A-1 | Org calendar crash import fix | missing | done | pass | Org calendar schedule/publish does not throw missing symbol `ReferenceError`. |
| 2B-1 | Pipeline deep-link state consistency | partial | done | pass | All route sources pass `pipelineItemId` and focused card scroll/highlight works. |
| 2B-2 | Pre-submit draft validation | missing | done | pass | Incomplete draft prompts warning modal with submit-anyway path. |
| 2B-3 | Pipeline drawer actions + gating | missing | done | pass | Reviewer actions run from board drawer; role-gated read-only behavior enforced. |
| 2C-1 | Client review link surfacing + expiry checks | partial | done | pass | UI exposes link generation and expired tokens are rejected in edge paths. |
| 2D-1 | Credits approve/deny/partial actions | missing | done | pass | Credits table actions execute edge flow and refresh row states with reviewer details. |
| 3A | Secure credit monthly reset endpoint | missing | done | pass | Non-service calls blocked, service call succeeds, audit row written. |
| 3B | Admin role authority unification | missing | done | pass | Shared admin-role capability logic used by route and admin RBAC paths. |
| 4A | At-risk user drilldown nav | missing | done | pass | At-risk list item navigates to `/app/admin/users/:userId`. |
| 4B | Moderation reviewer assignment | missing | done | pass | Reviewer assignment persists and My Queue filter works by assigned moderator. |
| 4C | Admin notification schema canonization | partial | done | pass | Canonical fields used consistently after backfill migration. |
| XC-1 | Deep-link payload builder adoption | missing | done | pass | Standard payload utility is used across relevant navigation handlers. |
| XC-2 | Dead code quarantine + legacy table guardrails | partial | done | pass | Legacy files moved under `src/legacy`, legacy references are explicitly marked. |

## Verification Basis

- Source-level verification via targeted `rg` audits across `src/` and `supabase/`.
- Build gate verification via `npm run build` (passed on 2026-03-30).
- Migration verification via additive SQL migrations introduced for roadmap deltas.
