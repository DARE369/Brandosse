# SocialAI Canonical Handoff Index

This directory is the canonical handoff and integration documentation set for the current codebase.

Source-of-truth priority for this set:
1. Implemented frontend/backend code (`src/**`, `supabase/functions/**`)
2. Active migrations and SQL contracts (`supabase/migrations/**`)
3. Existing docs only after verification

## Stage Tracker

| Stage | Scope | Status | Output |
| --- | --- | --- | --- |
| Stage 1 | Shared foundations + personal workspace | Delivered | `shared/*`, `personal/*` |
| Stage 2 | Platform admin workspace | Delivered | `platform-admin/*` |
| Stage 3 | Org admin workspace | Delivered | `org-admin/*` |
| Stage 4 | Org member workspace | Delivered | `org-member/*` |
| Stage 5 | Dormant code/schema/security/structure audits | Delivered | `audits/*` |

## Reading Order

1. `shared/master-foundations.md`
2. `shared/route-ownership-matrix.md`
3. `personal/master-handoff.md`
4. `personal/dependencies/data-model-and-supabase-contracts.md`
5. `personal/wiring-gaps.md`
6. `personal/pages/*`
7. `personal/workflows/*`
8. `personal/coverage-checklist.md`
9. `platform-admin/master-handoff.md`
10. `platform-admin/dependencies/data-model-and-supabase-contracts.md`
11. `platform-admin/wiring-gaps.md`
12. `platform-admin/pages/*`
13. `platform-admin/workflows/*`
14. `platform-admin/coverage-checklist.md`
15. `org-admin/master-handoff.md`
16. `org-admin/dependencies/data-model-and-supabase-contracts.md`
17. `org-admin/wiring-gaps.md`
18. `org-admin/pages/*`
19. `org-admin/workflows/*`
20. `org-admin/coverage-checklist.md`
21. `org-member/master-handoff.md`
22. `org-member/dependencies/data-model-and-supabase-contracts.md`
23. `org-member/wiring-gaps.md`
24. `org-member/pages/*`
25. `org-member/workflows/*`
26. `org-member/coverage-checklist.md`
27. `audits/master-audit.md`
28. `audits/dormant-code-and-schema.md`
29. `audits/dirty-tree-work-clusters.md`
30. `audits/security-rbac-rls-token-gaps.md`
31. `audits/communication-contract-gaps.md`
32. `audits/target-repo-and-architecture-structure.md`
33. `audits/system-integration-map.md`
34. `audits/coverage-checklist.md`

## Canonical Structure

- `shared/`: app-wide foundations used by all workspaces
- `personal/`: Stage 1 personal workspace handoff
- `platform-admin/`: Stage 2 target docs
- `org-admin/`: Stage 3 target docs
- `org-member/`: Stage 4 target docs
- `audits/`: Stage 5 audits and system consolidation

## Stage 1 Coverage Matrix

| Area | Covered In |
| --- | --- |
| App shell, providers, auth, redirects, workspace switching | `shared/master-foundations.md` |
| Route ownership and stage assignment | `shared/route-ownership-matrix.md` |
| Personal workspace architecture and relationships | `personal/master-handoff.md` |
| Personal pages | `personal/pages/*.md` |
| Personal workflows | `personal/workflows/*.md` |
| Personal data and Supabase contracts | `personal/dependencies/data-model-and-supabase-contracts.md` |
| Personal missing-link inventory | `personal/wiring-gaps.md` |
| Stage 1 checklist and confidence note | `personal/coverage-checklist.md` |

## Stage 2 Coverage Matrix

| Area | Covered In |
| --- | --- |
| Platform-admin architecture and relationships | `platform-admin/master-handoff.md` |
| Platform-admin routes/pages | `platform-admin/pages/*.md` |
| Platform-admin workflows | `platform-admin/workflows/*.md` |
| Platform-admin schema and Supabase contracts | `platform-admin/dependencies/data-model-and-supabase-contracts.md` |
| Platform-admin missing-link inventory | `platform-admin/wiring-gaps.md` |
| Stage 2 checklist and confidence note | `platform-admin/coverage-checklist.md` |

## Stage 3 Coverage Matrix

| Area | Covered In |
| --- | --- |
| Org-admin architecture and relationships | `org-admin/master-handoff.md` |
| Org-admin routes/pages | `org-admin/pages/*.md` |
| Org-admin workflows | `org-admin/workflows/*.md` |
| Org-admin schema and Supabase contracts | `org-admin/dependencies/data-model-and-supabase-contracts.md` |
| Org-admin missing-link inventory | `org-admin/wiring-gaps.md` |
| Stage 3 checklist and confidence note | `org-admin/coverage-checklist.md` |

## Stage 4 Coverage Matrix

| Area | Covered In |
| --- | --- |
| Org-member architecture and relationships | `org-member/master-handoff.md` |
| Org-member routes/pages | `org-member/pages/*.md` |
| Org-member workflows | `org-member/workflows/*.md` |
| Org-member schema and Supabase contracts | `org-member/dependencies/data-model-and-supabase-contracts.md` |
| Org-member missing-link inventory | `org-member/wiring-gaps.md` |
| Stage 4 checklist and confidence note | `org-member/coverage-checklist.md` |

## Stage 5 Coverage Matrix

| Area | Covered In |
| --- | --- |
| Stage 5 audit scope and execution summary | `audits/master-audit.md` |
| Dormant code and schema drift | `audits/dormant-code-and-schema.md` |
| Dirty tree paths and work clusters | `audits/dirty-tree-work-clusters.md` |
| Security/RBAC/RLS/token gaps | `audits/security-rbac-rls-token-gaps.md` |
| Broken communication contracts | `audits/communication-contract-gaps.md` |
| Recommended repo and architecture structure | `audits/target-repo-and-architecture-structure.md` |
| System-wide integration status map | `audits/system-integration-map.md` |
| Stage 5 checklist and confidence note | `audits/coverage-checklist.md` |

## Scope Notes

- Stage 1 includes personal workspace and onboarding/auth flows that feed it:
  - `/login`, `/register`, `/auth/callback`, `/complete-signup`, `/select-context`
  - `/app/dashboard`, `/app/generate`, `/app/generate/:sessionId`, `/app/calendar`, `/app/library`, `/app/settings`, `/app/settings/brand-kit`, `/app/help`
- Existing docs in `docs/` remain reference material until re-verified into this canonical set.
