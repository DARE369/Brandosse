# Platform Admin Page: Organizations

## Page Purpose (Plain Language)
This page is used to provision organizations, inspect owner onboarding state, and open tenant-level details.

## Route and Access Rules
- Route: `/app/admin/organizations`
- Parent guard: `<ProtectedRoute requireAdmin>`
- In-page restriction:
  - Hard limited to `adminAccess.isSuperAdmin`.
  - Org admins see a blocked-state panel.

## Component Composition
- Container: `src/admin/pages/AdminOrgsPage.jsx`
- Uses:
  - `CreateOrgPanel`
  - `OrgInvitePanel`
- Service layer:
  - `fetchAdminOrgs`
  - `createOrganization`
  - `sendOwnerInvitation`

## State, Hooks, Services Used
- Local state:
  - organization list
  - create panel open/close
  - invite modal target and busy state
- `orgAdminService` handles:
  - slug uniqueness
  - plan allocation lookup
  - owner invitation generation via edge function
  - onboarding status normalization from `organizations.settings` and latest invitation rows

## Data Contracts Touched
- Tables read:
  - `organizations`
  - `org_invitations`
  - `profiles`
- Tables written:
  - `organizations` (create + invite-state settings updates)
- Edge/RPC:
  - `org-invite-member`
  - audit logging via `write_audit_log` helper path in service

## Inbound Dependencies
- Opened from admin sidebar.
- Depends on admin identity scope resolved in shell.

## Outbound Dependencies
- Opens `/app/admin/organizations/:orgId`.
- Create/invite workflows produce links that feed `/join?token=<invitation_token>` in member onboarding flow.

## Current Working Relationships
- Organization rows are merged with latest owner invitation and owner profile details.
- Create flow:
  - inserts organization
  - requests owner onboarding link
  - stores invite failure metadata when edge function fails.
- Invite flow can regenerate onboarding link for pending/expired/failed/no-link states.

## Missing or Partial Relationships
- No inline org search/filter/sort controls for large tenant sets.
- No tenant lifecycle controls (suspend, delete, ownership transfer) from this page.
- No direct drill-down to org-admin workspace routes for the created tenant.

## No Relation Exists Yet
- No relation between onboarding status and automated retry/backoff policy.
- No relation from invitation failures to admin notification center alerts.

## Recommended Wiring Contract
- Add org lifecycle actions via explicit request workflow (`admin_action_requests`).
- Add structured onboarding retry policy and status timestamps as first-class fields (not only settings blob).
- Emit admin notifications for repeated invitation failures with dedupe key by org.

## Risks If Wired Incorrectly
- Direct destructive org actions without approval flow can break active member workspaces.
- Overloading `organizations.settings` with uncontrolled keys can create migration drift.
- Invitation link generation without strict owner email validation can create account takeover risk.
