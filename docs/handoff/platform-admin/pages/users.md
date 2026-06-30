# Platform Admin Page: Users

## Page Purpose (Plain Language)
This is the admin directory for searching users, checking activity and platform usage, and running quick account operations such as suspension and password reset.

## Route and Access Rules
- Route: `/app/admin/users`
- Parent guard: `<ProtectedRoute requireAdmin>`
- Scope behavior:
  - Super admin can filter all organizations.
  - Org admin is scoped to own organization.

## Component Composition
- Container: `src/admin/pages/AdminUsersPage.jsx`
- Uses:
  - `ActivityStatusBadge`
  - `SuspendUserModal`
  - toolbar and bulk-action table UI

## State, Hooks, Services Used
- `useQuery` for paginated directory data.
- `useQueryClient` for optimistic row patching and refresh.
- `useDebouncedValue` for search input.
- Local state:
  - filters (`search`, `activityStatus`, `organizationId`)
  - selection (`selectedIds`)
  - suspend modal targets
  - password reset status per row
- `adminClient` helpers:
  - `fetchConnectedAccountCountMap`
  - `fetchGenerationCountMap`
  - `fetchPostCountMap`
  - `fetchOrganizationsByIds`
  - `updateAdminUserStatus`
  - `sendAdminPasswordReset`

## Data Contracts Touched
- Tables read:
  - `profiles`
  - `organizations`
  - `connected_accounts`
  - `generations`
  - `posts`
- Tables written:
  - `profiles` (activity/suspension fields)
  - `user_status_events`
  - `audit_logs` (through `write_audit_log` helper path)
- Auth API:
  - `supabase.auth.resetPasswordForEmail`
- Realtime:
  - `profiles` channel subscription for table updates

## Inbound Dependencies
- Entered from admin sidebar.
- Relies on `adminAccess` from outlet context.

## Outbound Dependencies
- Navigates to `/app/admin/users/:userId`.
- Bulk or row suspend operations affect:
  - user detail state
  - audit/log workflows
  - complaint access context indirectly

## Current Working Relationships
- Directory query joins profile rows with connected account/generation/post counts.
- Realtime profile changes patch local cache.
- Suspension and unsuspension actions write status events and audit logs.
- CSV export supports current filtered rows or selected subset.

## Missing or Partial Relationships
- No bulk unsuspend workflow.
- Organization membership details (role templates/permissions) are not surfaced here.
- Page-size preference from admin settings is not consumed.

## No Relation Exists Yet
- No direct relation from this page to complaint queue for a selected user.
- No direct relation from user role column to org role template management screens.

## Recommended Wiring Contract
- Add explicit cross-page deep links:
  - user row -> complaints filtered by user
  - user row -> moderation filtered by user
- Wire global admin preference contract for default pagination and unread-only views.
- Add bulk unsuspend API path with the same audit guarantees as suspension.

## Risks If Wired Incorrectly
- Incorrect scope checks on organization filter can leak users across org boundaries.
- Bulk actions without per-target result handling can create partial, silent failures.
- Weak audit correlation can make suspension events hard to reconstruct during incident review.
