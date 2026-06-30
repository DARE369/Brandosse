# Org Admin Page: Overview

## Page Purpose (Plain Language)
This page gives organization admins a quick operational pulse: member activity, schedule pressure, review bottlenecks, assets, and shared account health.

## Route and Access Rules
- Route: `/app/org/:orgId/overview`
- Guard: `OrgAdminRoute` (requires active org membership plus `isOrgAdmin=true`)
- Entry paths:
  - `/app/org/:orgId` redirect for org-admin roles
  - Org sidebar `Overview` item (admin only)

## Component Composition
- Container: `src/org/pages/OrgOverview.jsx`
- Key child components:
  - `OrgStatCard`
  - `OrgAccountHealthCard`
  - `OrgEmptyState`

## State, Hooks, Services Used
- `useOrgContext` for org metadata and role flags.
- `useOrgCalendar` for posts, queue stats, pipeline items, and bottleneck lanes.
- `useOrgAssets` for recent asset availability.
- Local derived state with `useMemo`:
  - upcoming schedule list
  - top bottleneck lanes

## Data Contracts Touched
- Reads:
  - `organization_members`
  - `posts`
  - `generations`
  - `pipeline_items`
  - `pipeline_configs`
  - `org_tasks`
  - `org_task_statuses`
  - `org_asset_library`
  - `org_post_asset_links`
  - `connected_accounts`
  - `profiles`
- Realtime (via `useOrgCalendar`):
  - `posts`, `pipeline_items`, `org_tasks`, `org_task_statuses`

## Inbound Dependencies
- Redirect entry from `OrgHomeRedirect`.
- Org shell dependencies:
  - `OrgContextProvider`
  - `OrgWorkspaceShell`
  - `OrgSidebar` admin navigation

## Outbound Dependencies
- Deep links to:
  - `/app/org/:orgId/calendar`
  - `/app/org/:orgId/library`
  - `/app/org/:orgId/admin/settings` (manage account health action)

## Current Working Relationships
- Stats and panels are populated from live org snapshot data.
- Account health card connects to organization-scoped connected-account health and recent publish activity.
- Admin vs member card set is role-aware (admin receives operational/admin cards).

## Missing or Partial Relationships
- Cards and list rows mostly deep-link to broad pages, not entity-specific filtered views.
- No alert threshold configuration per organization for bottleneck/account-health signals.
- Upcoming schedule list does not open specific post/task detail context.

## No Relation Exists Yet
- No direct relation to a historical trend page for overview metrics.
- No relation from bottleneck lane cards to a pre-filtered pipeline board state.

## Recommended Wiring Contract
- Add route query/state contracts:
  - `/calendar?focus=scheduled&postId=<id>`
  - `/pipeline?lane=<assigneeRole>&status=in_review`
  - `/admin/settings?panel=connected-accounts&accountId=<id>`
- Standardize metric definitions between overview and downstream pages to prevent count drift.

## Risks If Wired Incorrectly
- Inconsistent filter contracts can cause admins to see mismatched counts between overview and destination pages.
- Missing org scoping in drill-down routes can leak cross-organization data.

