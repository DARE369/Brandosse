# Org Admin Wiring Gap Report (Stage 3)

## Purpose
This report tracks missing or partial org-admin relationships as first-class handoff content.

Each gap is documented as:
1. Current state
2. Intended relationship
3. Exact missing connection point
4. Likely implementation path
5. Constraints and risks

## Gap 1: Bootstrap readiness is implicit, not explicit
### Current state
- Bootstrap logic is centralized in `ensureOrganizationBootstrap` but invoked from multiple entry points (`org-self-signup`, `org-setup`, invite-based owner flows).
- No single readiness object is consumed by org-admin pages.

### Intended relationship
- Org-admin screens should know whether prerequisites are complete and exactly what is missing.

### Missing connection point
- No explicit bootstrap readiness contract exposed to frontend.

### Likely implementation path
- Add structured readiness state in `organizations.settings` (or dedicated table).
- Add verify/repair endpoint and preflight check in org-admin shell.

### Constraints and risks
- Partial writes during bootstrap can create hidden misconfiguration.
- Retrying bootstrap without idempotent checks can duplicate seeded objects.

## Gap 2: Brand-kit entitlement model is partially connected
### Current state
- `/admin/brand-kit` route is not wrapped by `OrgAdminRoute`.
- Page edit rights support delegated editors.
- Sidebar admin link is admin-only.

### Intended relationship
- Route access, nav discovery, and edit authorization should reflect one consistent entitlement model.

### Missing connection point
- No shared route-level entitlement for “brand-kit editor” access.

### Likely implementation path
- Introduce `OrgBrandKitEditorRoute` or equivalent shared guard.
- Show contextual nav entry for delegated editors.

### Constraints and risks
- Expanding access without explicit scoping can expose admin-adjacent surfaces.
- Keeping current split creates hidden capability and onboarding friction.

## Gap 3: Member lifecycle stops at invite and permission edits
### Current state
- Invite lifecycle is implemented.
- Member role/scope/override updates are implemented.
- No UI controls for `organization_members.status` transitions.

### Intended relationship
- Admins should manage full lifecycle: activate, suspend/reactivate, remove.

### Missing connection point
- No member status mutation workflow in org-admin UI/services.

### Likely implementation path
- Add status action controls in member drawer/table.
- Persist with audited mutations and clear guard rails.

### Constraints and risks
- Incorrect status writes can desynchronize session access and RLS expectations.
- Missing audit metadata reduces accountability for access changes.

## Gap 4: Permission contracts are duplicated across frontend and SQL
### Current state
- Frontend resolves capabilities with `resolveOrgPermissions`.
- SQL policies/functions resolve capabilities with `get_member_permission` and template fallbacks.

### Intended relationship
- One canonical capability contract should drive both layers.

### Missing connection point
- No shared schema/versioning mechanism for permission key definitions.

### Likely implementation path
- Define canonical permission schema and parity tests.
- Refactor both layers to consume the same contract source.

### Constraints and risks
- Drift causes UI to show actions that backend rejects, or vice versa.

## Gap 5: Credits governance backend is present but page is read-only
### Current state
- `credit-request-action` edge function is implemented.
- `/admin/credits` currently displays requests only.

### Intended relationship
- Admins should resolve requests directly in credits UI.

### Missing connection point
- No UI action wiring for approve/deny/partial request resolution.

### Likely implementation path
- Add row-level actions bound to `credit-request-action`.
- Surface reviewer/outcome metadata in table.

### Constraints and risks
- Bypassing edge function with direct writes skips notification and limit-update logic.

## Gap 6: Pipeline config changes have no impact preview or versioning
### Current state
- Pipeline configs are editable and default can be switched.
- No in-page visibility of how many live items depend on selected config.

### Intended relationship
- Config changes should include impact awareness and controlled rollout.

### Missing connection point
- No “usage linkage” between `pipeline_configs` editor and active `pipeline_items`.

### Likely implementation path
- Add usage metrics per config.
- Add immutable versioning for active configs.

### Constraints and risks
- Live workload can be disrupted by unreviewed stage edits.

## Gap 7: Org settings domain is over-coupled and incomplete
### Current state
- `/admin/settings` combines connected accounts and task-status management with summary cards.
- Core org settings (name/logo/plan defaults) are not editable there.

### Intended relationship
- Settings should be domain-scoped and complete.

### Missing connection point
- No route/domain split and no general-settings mutation contract.

### Likely implementation path
- Split settings into sub-routes and add controlled organization profile/settings mutations.

### Constraints and risks
- Coupled settings pages increase accidental operational changes and maintenance cost.

## Gap 8: Role-template governance lacks hard server safeguards
### Current state
- UI prevents deleting templates with assigned members using current in-memory counts.
- No explicit server-enforced assignment check surfaced in this workflow.

### Intended relationship
- Role deletion should be transaction-safe with assignment integrity guarantees.

### Missing connection point
- No backend guard contract dedicated to role-template deletion safety.

### Likely implementation path
- Add backend delete function that validates assignment count in transaction.
- Optionally force reassignment workflow before delete.

### Constraints and risks
- Race conditions can delete templates still referenced by members.

## Gap 9: Brand-kit asset references are weakly validated
### Current state
- Brand-kit saves accept `primary_logo_asset_id` and `secondary_logo_asset_id`.
- Edge function does not explicitly validate that referenced asset ids belong to same org/project context.

### Intended relationship
- Brand-kit asset references should be constrained to authorized project/org assets.

### Missing connection point
- No explicit validation query/constraint during save.

### Likely implementation path
- Add asset ownership/project-scope validation in `org-brand-kit-upsert`.
- Return explicit validation errors.

### Constraints and risks
- Cross-project references can create inconsistent branding and broken asset ownership semantics.

## Required Stage-3 Gap Buckets Check
### Incomplete invite/bootstrap relationships
- Covered by Gap 1 and Gap 3.

### Permissions not fully propagated
- Covered by Gap 2, Gap 4, and Gap 8.

### Config screens not fully driving member-facing behavior
- Covered by Gap 5, Gap 6, and Gap 7.

### Backend structures present without full UI enforcement
- Covered by Gap 5, Gap 8, and Gap 9.

