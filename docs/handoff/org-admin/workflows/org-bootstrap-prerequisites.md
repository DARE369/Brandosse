# Workflow: Org Bootstrap Prerequisites

## Current Implemented Flow
1. Organization creation can start from multiple entry points:
   - `org-self-signup` (self-service signup)
   - `org-setup` (owner bootstrap endpoint)
   - `org-invite-member` with bootstrap flags in owner-invite paths
2. `ensureOrganizationBootstrap` seeds core org structures:
   - default brand project
   - default role templates
   - default pipeline configs
   - default common-room channel
   - default asset folders
   - default task statuses
   - default brand-kit row for default project
3. Owner membership is upserted as `org_owner` when bootstrap activation is enabled.
4. Organization settings are updated with `default_pipeline_id`.
5. Last-used context is updated for owner in signup/bootstrap flows.

## Expected Target Flow
- A single canonical bootstrap contract should define when an organization is “admin-operationally ready” and expose that state consistently to UI and services.

## Breakpoints and Gaps Between Current and Target
- Bootstrap logic is implemented in one shared function but invoked from multiple independent edge-function entry points.
- No explicit readiness state model is exposed to org-admin pages.
- Partial-failure scenarios can create mixed readiness states (some seeded artifacts exist, others missing).

## Required Integration Points to Close the Gap
- Add canonical bootstrap state schema (for example, `organizations.settings.bootstrap_state` with step-level checksums/timestamps).
- Add one “verify + repair” endpoint callable from org admin.
- Gate org-admin pages that require prerequisites (roles/pipelines/settings) behind bootstrap readiness checks with actionable remediation.

## Suggested Order of Implementation
1. Define bootstrap state contract and migration.
2. Update all bootstrap entry points to write the same state contract.
3. Add verification endpoint returning missing prerequisite inventory.
4. Add org-admin UI preflight checks and repair action.
5. Add regression tests for idempotent repeated bootstrap.

