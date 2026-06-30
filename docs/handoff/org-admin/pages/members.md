# Org Admin Page: Members

## Page Purpose (Plain Language)
This page manages team access. Admins can invite members, assign role templates, scope brand-project access, and apply member-specific permission overrides.

## Route and Access Rules
- Route: `/app/org/:orgId/admin/members`
- Guard: `OrgAdminRoute`
- Only org owner/admin can access.

## Component Composition
- Container: `src/org/admin/MembersPage.jsx`
- Key child components:
  - `InviteMemberPanel`
  - Member table with manage drawer
  - Active invite links and invite history tables
  - Permission override controls and effective summary chips

## State, Hooks, Services Used
- `useOrgContext` for organization scope, brand projects, agency mode.
- Service calls:
  - `fetchOrganizationMembers`
  - `fetchOrgRoleTemplates`
  - `fetchOrganizationInvitations`
  - `updateOrganizationMember`
  - `inviteOrganizationMember`
  - `revokeOrganizationInvitation`
  - `deleteOrganizationInvitation`
- Local state:
  - member drawer draft state
  - invite panel state
  - invitation action loading state

## Data Contracts Touched
- Reads:
  - `organization_members`
  - `profiles`
  - `org_role_templates`
  - `org_invitations`
- Writes:
  - `organization_members` updates (`org_role_key`, `permissions`, `brand_project_ids`)
  - invitation lifecycle through edge functions:
    - `org-invite-member`
    - `org-revoke-invitation`
    - `org-delete-invitation`
  - downstream audit/user-notification writes happen inside edge functions

## Inbound Dependencies
- Admin sidebar `Members` navigation.
- Role template definitions from `/admin/roles` are consumed here for assignment and preview.

## Outbound Dependencies
- Membership role and permissions affect:
  - route access
  - calendar/publish/task/library permissions
  - connected-account posting eligibility
  - credit governance behavior
- Invitation links feed `/join` onboarding flow.

## Current Working Relationships
- Invite creation is manual-link oriented by default (`delivery_mode=manual_link`) with copy/regenerate/revoke/delete controls.
- Member management combines template defaults with per-member tri-state permission overrides.
- Owner role is protected in UI against direct reassignment.

## Missing or Partial Relationships
- No in-page controls for membership status transitions (`active`, `suspended`, `removed`), though schema supports status lifecycle.
- No bulk member operations for role/scope updates.
- No direct link from a member row into that member’s workspace activity timeline.

## No Relation Exists Yet
- No relation from invite records to a centralized admin case timeline beyond audit logs.
- No relation from member drawer save actions to explicit “permission impact preview” on affected pages.

## Recommended Wiring Contract
- Add explicit member status actions with audited writes and confirmation workflow.
- Add impact preview before save:
  - list capabilities gained/lost from role/scope/override changes.
- Add row-level jump links to team activity, task ownership, and pipeline workload views.

## Risks If Wired Incorrectly
- Improper status transitions can orphan active sessions or leave stale access in downstream flows.
- Overwriting permissions without merge semantics can unintentionally revoke critical access.
- Regenerate/revoke invite operations without audit consistency can break invite lineage tracing.

