# System-Wide Integration Map

## Purpose
Map the current integration state across product domains using three statuses:
- Wired
- Partially wired
- No relationship yet

This map consolidates Stage 1-4 findings into one operational view.

## Domain Integration Matrix

| Domain | Current Status | What is Wired | What is Partial | What Has No Relationship Yet |
| --- | --- | --- | --- | --- |
| Auth and context switching | Wired | login/register/callback/signup completion/context selection routes and guards | role normalization differs across some admin boundaries | none identified |
| Personal generation to post | Partially wired | session, generation, post lifecycle and calendar handoff | legacy generation modules still present; idempotency contract is weak | direct legacy cleanup contract not enforced |
| Personal library and generate handoff | Partially wired | library listing and navigation to generate route | media selection does not consistently carry payload | deterministic media-to-generate contract |
| Help and complaint lifecycle | Partially wired | complaint submission and admin notification bridge | user timeline for complaint status/comments is limited | full end-user complaint conversation relation |
| Platform admin moderation | Partially wired | users/org/complaints/moderation pages and action services | moderation assignment/approval lineage remains incomplete | canonical reviewer ownership relation |
| Platform admin analytics | Partially wired | core counters from live tables | platform cards include placeholder path | canonical platform analytics ingestion-to-UI relation |
| Org admin bootstrap and governance | Partially wired | invites, role templates, pipeline configs, brand-kit editing | readiness and member status lifecycle are incomplete | explicit bootstrap readiness contract consumed by all admin pages |
| Org member pipeline and calendar | Partially wired | pipeline list/detail actions, calendar reads/writes, publish invocation | schedule-context helper contract break in calendar service | stable closed-loop navigation contract across task/pipeline/calendar/library |
| Common room collaboration | Partially wired | channels, messages, reads, basic references | message reference metadata is weakly typed | strict typed reference schema with guaranteed deep-link resolution |
| Client review workflow | Partially wired | token-based review page and action endpoint | generation of review links is not clearly surfaced in member UI; token expiry absent | governed end-to-end review-link lifecycle contract |
| Credits governance | Partially wired | request creation and action endpoint exist | org-admin credits page is read-heavy | full approve/deny/partial UI-action loop |
| Account health and risk | Partially wired | health views, risk counters, risk processing functions | tenant-scoped view exposure requires grant verification | canonical operator dashboard for all account-risk signals |

## Cross-Cutting Integration Gaps
1. Role authority drift:
   - routing and RBAC do not share one canonical contract.
2. Deep-link inconsistency:
   - payload semantics vary across pages.
3. Function auth-mode inconsistency:
   - some admin-client endpoints lack explicit gates.
4. Legacy model overlap:
   - old and canonical generation/scheduling models coexist.

## Canonical Direction
- Keep one canonical flow per domain.
- Record all non-canonical but retained surfaces as explicit legacy compatibility.
- Require every new route/service/function to declare:
  - inbound dependencies
  - outbound dependencies
  - missing relation assumptions

## No-Relationship-Yet Inventory (High Signal)
- `content_versions` to active runtime flows (schema exists, runtime linkage absent).
- Member pipeline UI to `generateClientReviewLink` action path.
- Personal complaint UI to full complaint comment/history timeline.
- Unified activity feed relation between pipeline, tasks, scheduling, and common-room events.
- Strict typed reference contract between common-room messages and destination pages.

