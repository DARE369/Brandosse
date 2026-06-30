# Dirty Tree and Work-Cluster Audit

## Snapshot Context
Dirty tree snapshot was taken from `git status --porcelain` during Stage 5 execution on 2026-03-29.

## Top-Level Change Concentration
- `src`: 168 paths
- `supabase`: 84 paths
- `docs`: 42 paths

This indicates simultaneous product, backend, and documentation work in one branch.

## Highest-Volume Subtrees
- `src/admin`: 52
- `supabase/migrations`: 43
- `supabase/functions`: 40
- `src/pages`: 29
- `src/components`: 28
- `src/styles`: 22
- `src/services`: 16

## Likely Work Clusters
1. Platform admin expansion:
   - `src/admin/**`
   - admin-related functions and migrations
2. Org workspace rollout:
   - `src/org/**`, org pages, org functions, org migrations
3. Personal workspace refactor:
   - generate/calendar/settings/services/styles churn
4. Documentation uplift:
   - handoff suite plus historical audit docs

## Risks from Current Tree Shape
- Merge conflicts are likely across cross-cutting files (`router`, shared services, migrations).
- Regression isolation is difficult because features and infra changes are mixed.
- Rollback blast radius is high when one branch contains unrelated domains.

## Recommended Working Structure

### Branch Strategy
- Branch by domain and release boundary:
  - `feat/personal-*`
  - `feat/platform-admin-*`
  - `feat/org-admin-*`
  - `feat/org-member-*`
  - `infra/supabase-*`
  - `docs/handoff-*`

### Migration Strategy
- Keep one migration theme per PR:
  - auth/profile
  - admin governance
  - org workflow
  - publishing/accounts
- Require migration notes:
  - backward compatibility
  - data backfill impact
  - rollback constraints

### Ownership Strategy
- Assign code ownership by directory:
  - `src/admin/**`: platform-admin team
  - `src/org/**`: org-workspace team
  - `src/pages/**` and `src/components/**`: shared product team
  - `supabase/functions/**`: backend integration team
  - `supabase/migrations/**`: data platform owner

## Immediate Operational Actions
1. Split the current branch into domain PRs before further feature additions.
2. Run fast smoke verification per split:
   - routing/auth
   - generation flow
   - org invite/pipeline
   - admin moderation
3. Freeze new migration additions until active migrations are grouped and reviewed.

