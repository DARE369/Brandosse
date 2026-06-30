# Page: `/app/settings`

## Page Purpose (Plain Language)
This page manages connected social accounts. Personal accounts are fully editable; organization-shared accounts are view-only here.

## Route and Access Rules
- Route: `/app/settings`
- Access: authenticated user under protected app shell.
- Alias route `/app/profile` redirects here.

## Component Composition
- `src/pages/Settings.jsx`
- Shared shell: `UserNavbar`, `UserSidebar`
- Tab components:
  - `ConnectedAccountsTab` (personal writable)
  - `OrgAccountsReadOnlyTab` (org shared read-only view)

## State, Hooks, Services
- Auth source: `useAuth()` for user and org memberships.
- Account services:
  - `connectionService` (`connectAccount`, `disconnectAccount`, `triggerReconnect`, `getAccountsForUser`, `getAccountHealth`)
  - `platformRegistry` (`getAllPlatforms`, `getPlatform`)
- UI modals/cards:
  - `MockOAuthScreen`
  - `ConnectedAccountCard`
  - `AccountHealthModal`.

## Data Contracts Touched
- Tables/views:
  - `connected_accounts`
  - `connected_accounts_health_summary`
  - `connection_events`
  - `platform_registry`
  - `organization_members` and `profiles` (org read-only context enrichment)
- Realtime channels: none in this page; state refresh is request-driven.
- RPC/edge functions: none directly.

## Inbound Dependencies
- Dashboard account health card links to this page.
- Generate/calendar publish flows rely on account connectivity managed here.

## Outbound Dependencies
- Org account banners deep-link to org workspace routes:
  - `/app/org/:orgId/admin/settings` for org admins/owners
  - `/app/org/:orgId/workspace` for non-admin members.

## Current Working Relationships
- Personal connect/edit/reconnect/disconnect flows persist correctly via connection service.
- Org account visibility is partitioned and clearly read-only in personal settings.

## Missing or Partial Relationships
- Deep-link to org workspace is generic; target account context is not passed.
- No unified UX for explaining shared-account permission model and `granted_member_ids` behavior.

## No Relation Exists Yet
- No relation from account health issues directly into help complaint prefill flow.

## Recommended Wiring Contract
- Add context payload to org deep-links:
  - target account id
  - desired action
  - required role.
- Render permission policy summary from shared account schema fields.

## Risks if Wired Incorrectly
- Incorrect scope handling can let personal user operations affect org-scoped accounts.
- Weak permission guidance can lead to support load and accidental publish failures.
