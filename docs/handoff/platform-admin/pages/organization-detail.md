# Platform Admin Page: Organization Detail

## Page Purpose (Plain Language)
This page provides a focused tenant snapshot: owner identity, onboarding/provisioning status, active member list, and recent complaints linked to the organization.

## Route and Access Rules
- Route: `/app/admin/organizations/:orgId`
- Parent guard: `<ProtectedRoute requireAdmin>`
- In-page restriction:
  - Super admin only (`adminAccess.isSuperAdmin`).

## Component Composition
- Container: `src/admin/pages/AdminOrgDetailPage.jsx`
- Read-only sections:
  - owner
  - onboarding/provisioning
  - members
  - complaint summary

## State, Hooks, Services Used
- Local `loading` and `detail` state.
- Data loading in `useEffect`.
- Utility helpers:
  - `getOrganizationSettings`
  - `getProvisioningLabel`

## Data Contracts Touched
- Tables read:
  - `organizations`
  - `organization_members`
  - `complaints`
  - `profiles`
- No writes from this page.
- No edge functions called from this page.

## Inbound Dependencies
- Usually opened from `/app/admin/organizations`.

## Outbound Dependencies
- Currently none from member/complaint rows (display only).

## Current Working Relationships
- Merges organization row with member profile lookups.
- Displays provisioning source/status from settings (`self_signup` vs admin-provisioned invite flow).
- Shows complaint list as quick tenant support signal.

## Missing or Partial Relationships
- Member rows are not linked to `/app/admin/users/:userId`.
- Complaint rows are not linked to `/app/admin/complaints/:complaintId`.
- No actions for owner reassignment, membership edits, or org status changes.

## No Relation Exists Yet
- No direct relation to org-admin workspace pages (`/app/org/:orgId/admin/*`) from this detail view.
- No relation between onboarding failure state and remediation workflow execution.

## Recommended Wiring Contract
- Add action-safe links:
  - member -> user detail
  - complaint -> complaint detail
- Add controlled actions panel that writes through approval workflow tables and audit logs.
- Expose organization status transitions only through explicit approval gates.

## Risks If Wired Incorrectly
- Allowing direct org mutation without audit and approvals can bypass governance controls.
- Incomplete owner reassignment logic can leave organizations without a recoverable owner path.
