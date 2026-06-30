# Org Admin Page: Settings

## Page Purpose (Plain Language)
This page is the operational settings hub for shared publishing destinations and task workflow statuses inside an organization.

## Route and Access Rules
- Route: `/app/org/:orgId/admin/settings`
- Guard: `OrgAdminRoute`

## Component Composition
- Container: `src/org/admin/OrgSettingsPage.jsx`
- Key child domains:
  - `ConnectedAccountsAdmin`
  - `TaskStatusManager`
  - org summary cards (name, plan, default pipeline id, status count)

## State, Hooks, Services Used
- `useOrgContext` for organization context.
- `useOrgCalendar` for `taskStatuses`, `refresh`, and fallback user id.
- `useAuth` for active user id.
- Connected account services:
  - `getAllPlatforms`
  - `getAccountsForOrganization`
  - `connectAccount`
  - `updateConnectedAccountDetails`
  - `triggerReconnect`
  - `disconnectAccount`
  - `updateOrganizationAccountAccess`
- Task status services:
  - `createOrgTaskStatus`
  - `updateOrgTaskStatus`
  - `deleteOrgTaskStatus`

## Data Contracts Touched
- Reads:
  - `organizations`
  - `org_task_statuses`
  - `connected_accounts_health_summary` view
  - `organization_members`
  - `posts`
  - `profiles`
  - `platform_registry`
- Writes:
  - `connected_accounts`
  - `connection_events`
  - `org_task_statuses`
  - mock OAuth connection metadata through account connect/edit flows

## Inbound Dependencies
- Admin sidebar `Org Settings`.
- Overview account-health card `Manage` action links here.

## Outbound Dependencies
- Account access updates influence who can publish to organization-scoped accounts.
- Task status changes propagate to task/calendar/pipeline workflow behavior.

## Current Working Relationships
- Shared connected account CRUD and access control work in-page.
- Publish eligibility for access grants is permission-aware (`can_publish`).
- Task status taxonomy can be created/updated/deleted and refreshes org calendar state.

## Missing or Partial Relationships
- Page mixes unrelated domains (connected accounts + task status + org summary) without sub-route separation.
- No in-page mutations for core organization settings (name/logo/plan/default pipeline).
- Task status deletion has no preflight impact view for linked tasks before execution.

## No Relation Exists Yet
- No relation from this page into an org-wide configuration audit history.
- No relation from default pipeline summary card to an edit action.

## Recommended Wiring Contract
- Split into scoped sub-panels/routes:
  - `/admin/settings/general`
  - `/admin/settings/connected-accounts`
  - `/admin/settings/task-statuses`
- Add impact checks for status deletion and account disconnection.
- Add direct action links to pipeline default management and organization profile settings.

## Risks If Wired Incorrectly
- Coupled settings mutations can increase accidental changes across unrelated domains.
- Deleting active task statuses without migration may leave tasks in invalid states.
- Weak account-access updates can expose shared publishing endpoints to wrong members.

