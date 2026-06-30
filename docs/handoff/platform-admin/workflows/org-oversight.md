# Workflow: Organization Oversight

## Current Implemented Flow
1. Super admin opens `/app/admin/organizations`.
2. Page loads organizations via `orgAdminService.fetchAdminOrgs`:
  - merges org rows with latest owner invitation
  - enriches owner identity from profiles
  - derives onboarding/provisioning states.
3. Super admin can:
  - create organization
  - generate/regenerate owner onboarding link
4. Detail route `/app/admin/organizations/:orgId` provides read-only tenant context:
  - owner snapshot
  - onboarding/provisioning snapshot
  - members list
  - recent complaints

## Expected Target Flow
- Full tenant-governance lifecycle: provisioning, owner lifecycle, membership controls, status controls, and audited remediation actions.

## Breakpoints and Gaps Between Current and Target
- Organization detail is read-only; no direct tenant mutation controls.
- Invitation/provisioning state is heavily stored in `organizations.settings` JSON rather than normalized governance objects.
- No direct handoff from platform-admin org detail into org workspace admin surfaces.
- Failed invite/provisioning states do not escalate through dedicated alerting policy.

## Required Integration Points to Close the Gap
- Controlled mutation workflows for:
  - owner reassignment
  - org suspension/reactivation
  - member status overrides
- Canonical onboarding state model (reduce opaque settings-blob dependence).
- Cross-workspace navigation contracts (`/app/org/:orgId/admin/*`) with scope checks.
- Governance action auditing with correlation IDs.

## Suggested Order of Implementation
1. Add explicit org-governance mutation endpoints with strict authorization.
2. Normalize onboarding state fields and migration path from settings blob.
3. Add actionable controls to org detail page with approval gating.
4. Add escalation notifications for repeated invite/provisioning failures.
