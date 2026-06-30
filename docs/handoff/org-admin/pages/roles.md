# Org Admin Page: Roles & Permissions

## Page Purpose (Plain Language)
This page defines reusable role templates that control default permissions for members across publishing, library management, scheduling, tasks, collaboration, and credit limits.

## Route and Access Rules
- Route: `/app/org/:orgId/admin/roles`
- Guard: `OrgAdminRoute`

## Component Composition
- Container: `src/org/admin/RolesPage.jsx`
- Key UI blocks:
  - Role template sidebar list
  - Role editor (name, permission groups, summary)
  - Actions: create, duplicate, save, delete, reset defaults

## State, Hooks, Services Used
- `useOrgContext` for org id.
- Service calls:
  - `fetchOrgRoleTemplates`
  - `fetchOrganizationMembers`
  - `createOrgRoleTemplate`
  - `updateOrgRoleTemplate`
  - `duplicateOrgRoleTemplate`
  - `deleteOrgRoleTemplate`
- Constants/helpers:
  - `ORG_PERMISSION_GROUPS`
  - `ORG_ROLE_DEFAULTS`
  - `SYSTEM_ROLE_ORDER`
  - `summarizePermissions`

## Data Contracts Touched
- Reads:
  - `org_role_templates`
  - `organization_members`
  - `profiles` (indirect via members fetch)
- Writes:
  - `org_role_templates` CRUD

## Inbound Dependencies
- Admin sidebar `Roles & Permissions` route entry.
- Member assignment page (`/admin/members`) depends on these templates for role options and defaults.

## Outbound Dependencies
- Role template permissions are consumed by:
  - member effective permission resolution (`resolveOrgPermissions`)
  - RLS helper `get_member_permission`
  - connected-account publish eligibility checks
  - scheduling, library, task, and invite capability gating

## Current Working Relationships
- System roles exist and are editable for permissions/display name but not deletable.
- Custom roles can be created, duplicated, and deleted.
- Role membership counts are displayed from live member assignments.

## Missing or Partial Relationships
- No server-side guard in this page flow that blocks deleting a role if assignments change between read and delete click (UI checks current count only).
- No native migration workflow for changing `role_key` on existing templates; editor effectively treats key as immutable.
- No audit/event stream surfacing role-template changes for compliance traceability.

## No Relation Exists Yet
- No direct “assign members” action from this page; assignment is a separate flow in `/admin/members`.
- No relation to a sandbox/simulation showing how a template affects real member capabilities before saving.

## Recommended Wiring Contract
- Add backend-enforced delete constraints or transactional “reassign then delete” endpoint.
- Keep `role_key` immutable and expose only display-name/permissions edits in UI contract.
- Emit structured audit events for create/update/delete and include before/after permissions.

## Risks If Wired Incorrectly
- Role deletion without assignment safeguards can strand members on invalid role keys.
- Divergent frontend/backend permission schemas can produce silent authorization mismatches.
- Missing audit coverage makes incident and access-forensics work difficult.

