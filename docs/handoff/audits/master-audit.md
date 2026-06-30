# Stage 5 Master Audit

## Purpose
Stage 5 is the system-wide technical audit for dormant code/schema, dirty tree clusters, security boundaries, communication contracts, and target repository structure.

This stage consolidates findings across Stages 1-4 and adds implementation-grade recommendations for completing unfinished wiring safely.

## Scope
- Dormant frontend/backend code and SQL objects
- Duplicate or parallel data models
- Dirty working tree concentration and likely work clusters
- Security, RBAC, RLS, token, and endpoint-boundary gaps
- Broken or weak contracts between pages, services, edge functions, and schema
- Canonical target structure for code and schema organization
- System-wide integration status map:
  - wired
  - partially wired
  - no relationship yet

## Evidence Baseline
- Frontend code in `src/**`
- Edge functions in `supabase/functions/**`
- Active migrations in `supabase/migrations/**`
- Stage 1-4 handoff gap reports in `docs/handoff/{personal,platform-admin,org-admin,org-member}/wiring-gaps.md`
- Dirty tree snapshot from `git status --porcelain` (captured during Stage 5 execution on 2026-03-29)

## Stage 5 Outputs
1. `dormant-code-and-schema.md`
2. `dirty-tree-work-clusters.md`
3. `security-rbac-rls-token-gaps.md`
4. `communication-contract-gaps.md`
5. `target-repo-and-architecture-structure.md`
6. `system-integration-map.md`
7. `coverage-checklist.md`

## Priority Order for Engineering Follow-up
1. Lock down unauthenticated admin-client edge endpoints.
2. Fix schedule/publish contract break in org calendar service.
3. Enforce client-review token expiration in generation and verification flows.
4. Collapse legacy/dormant generation schema usage into canonical models.
5. Normalize role/authority contracts across routing and admin RBAC.
6. Execute repository/domain structure split to reduce coupling and merge risk.

## Confidence Notes
- High confidence for file-level findings tied to explicit line-level code evidence.
- Medium confidence for dormant-surface classification where behavior may be triggered by jobs, external callers, or undocumented tooling.
- Medium confidence for long-term architecture recommendations because implementation sequencing depends on team release constraints.

