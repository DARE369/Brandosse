# Org Admin Master Handoff (Stage 3)

## Plain-Language Overview
The org-admin workspace is where organization owners and admins configure how their team operates. It controls who can join, what each role can do, how content review pipelines run, how brand rules are managed, how credits are governed, and how shared publishing accounts and task statuses are maintained.

## Technical Architecture Summary
- Route scope under `/app/org/:orgId/*`:
  - `/app/org/:orgId/overview`
  - `/app/org/:orgId/admin/brand-kit`
  - `/app/org/:orgId/admin/members`
  - `/app/org/:orgId/admin/roles`
  - `/app/org/:orgId/admin/pipelines`
  - `/app/org/:orgId/admin/credits`
  - `/app/org/:orgId/admin/settings`
- Shell/runtime:
  - Route entry and guards: `src/router/router.jsx`, `src/utils/protectedRoute.jsx`
  - Org shell: `src/layouts/OrgWorkspaceShell.jsx`
  - Org context boundary: `src/org/context/OrgContextProvider.jsx`
  - Org navigation: `src/org/components/OrgSidebar.jsx`, `src/org/components/OrgTopNavbar.jsx`
- Data/services:
  - Core org access and membership: `src/org/services/orgService.js`
  - Pipeline configuration: `src/org/services/pipelineService.js`
  - Brand kit: `src/org/services/brandKitService.js`
  - Assets and folders: `src/org/services/assetLibraryService.js`
  - Credits: `src/org/services/creditService.js`
  - Calendar/task state used by overview/settings: `src/org/hooks/useOrgCalendar.js`, `src/org/services/orgCalendarService.js`, `src/org/services/taskService.js`
- Primary SQL contracts from:
  - `20260324100000_org_workspace_foundation.sql`
  - `20260324110000_org_pipeline_tables.sql`
  - `20260324130000_org_asset_library_table.sql`
  - `20260324140000_org_credit_tables.sql`
  - `20260324150000_org_posts_generations_columns.sql`
  - `20260324160000_org_rls_policies.sql`
  - `20260324170000_org_helper_functions.sql`
  - `20260324190000_org_invitation_owner_provisioning.sql`
  - `20260324200000_org_calendar_schedule_write_policy.sql`
  - `20260325110000_org_calendar_view_presets_and_asset_links.sql`
  - `20260326110000_org_asset_library_permission_alignment.sql`
  - `20260327010000_org_brand_kit_stage1.sql`
  - `20260327020000_org_asset_folders_stage2.sql`
  - `20260327021000_org_permission_template_backfill.sql`
  - `20260327022000_org_asset_folder_rls_recursion_fix.sql`
  - `20260327030000_org_tasks_stage4.sql`
  - `20260328005000_org_accounts_helpers.sql`

## Page Relationship Map
- Org home and admin summary:
  - `/overview` is the admin landing route and summarizes schedule, review pressure, asset activity, and account health.
  - Overview links operational actions to `/calendar`, `/library`, and `/admin/settings`.
- Membership and access governance:
  - `/admin/members` handles invitations, role assignment per member, project scope, and permission overrides.
  - `/admin/roles` manages reusable role templates consumed by members.
- Workflow design:
  - `/admin/pipelines` configures review stages, assignments, SLAs, escalation, and default pipeline selection.
  - Configured defaults are persisted to `organizations.settings.default_pipeline_id`.
- Brand and publishing configuration:
  - `/admin/brand-kit` stores project-level brand instructions and optional delegated editor access.
  - `/admin/settings` manages shared connected accounts and task-status taxonomy.
- Credit governance:
  - `/admin/credits` displays pool usage and request backlog.

## UI-Service-Edge-Schema Relationship Map
| UI Domain | Services/Hooks | Edge Functions/RPC | Primary Schema Contracts |
| --- | --- | --- | --- |
| Org context + admin shell | `useOrgContext`, `OrgContextProvider`, `OrgSidebar`, `OrgTopNavbar` | none | `organization_members`, `organizations`, `brand_projects`, `context_last_used`, `org_role_templates` |
| Overview | `useOrgCalendar`, `useOrgAssets`, `OrgAccountHealthCard` | none | `posts`, `pipeline_items`, `pipeline_configs`, `org_tasks`, `org_task_statuses`, `org_asset_library`, `org_post_asset_links`, `connected_accounts`, `profiles` |
| Brand kit | `fetchOrgBrandKit`, `upsertOrgBrandKit`, `syncOrgBrandKitEditors`, `fetchOrgAssets`, `fetchOrganizationMembers` | `org-brand-kit-upsert` | `org_brand_kits`, `org_brand_kit_editors`, `org_asset_library`, `brand_projects`, `organization_members`, `profiles` |
| Members | `fetchOrganizationMembers`, `fetchOrgRoleTemplates`, `updateOrganizationMember`, invitation helpers | `org-invite-member`, `org-revoke-invitation`, `org-delete-invitation` | `organization_members`, `org_role_templates`, `org_invitations`, `profiles`, `audit_logs`, `user_notifications` |
| Roles | `fetchOrgRoleTemplates`, `create/update/delete/duplicate role template`, `fetchOrganizationMembers` | none | `org_role_templates`, `organization_members` |
| Pipelines | `fetch/create/update/delete/setDefault pipeline config`, template helpers, `fetchOrganizationMembers` | none at config page level | `pipeline_configs`, `organizations.settings` |
| Credits | `useOrgCredits`, `fetchCreditRequests` | `credit-request-action` (implemented but not wired on page) | `organizations`, `credit_requests`, `organization_members.permissions.monthly_credit_limit` |
| Org settings | `ConnectedAccountsAdmin`, `TaskStatusManager`, `connectionService`, `taskService`, `platformRegistry` | none directly from settings page | `connected_accounts`, `connected_accounts_health_summary` view, `connection_events`, `organization_members`, `org_task_statuses`, `posts`, `profiles`, `platform_registry` |

## Implemented vs Missing Relationship Summary
### Implemented and working
- Org context resolution, role/permission derivation, and home-path routing are active.
- Member administration supports invitation lifecycle (create, copy, regenerate, revoke, delete).
- Role templates and member-level overrides are both implemented and persisted.
- Pipeline builder supports stage-level assignee type, SLA, escalation, and default pipeline.
- Brand kit persistence is active through `org-brand-kit-upsert` and mirrors into `brand_projects.brand_settings`.
- Shared connected account management and task status management are active from org settings.

### Partially wired
- Credits page is read-only despite existing `credit-request-action` backend.
- Brand-kit editor role is supported by backend and page-level checks, but route/nav exposure is not fully aligned.
- Pipeline client-review stage flag (`generates_client_review_link`) is configurable but not validated against runtime feature availability from this page.

### No relation exists yet (observed)
- No dedicated org-admin page for editing core organization identity/settings (name, slug, logo, plan policy fields).
- No org-admin page that directly manages member status lifecycle (`active`, `suspended`, `removed`) even though schema supports it.
- No unified org-admin audit timeline joining invitation, membership, role, pipeline, brand, and connected-account admin actions.

## Missing-Link Inventory (Org Admin)
See `org-admin/wiring-gaps.md` for the structured gap inventory with current state, intended relationship, exact missing connection, implementation path, and risks.

## How To Complete Unfinished Wiring Safely
1. Align brand-kit route access, navigation, and editor entitlement contract so UI entry points match backend permissions.
2. Promote credits from read-only to action-capable using `credit-request-action` with explicit audit + notification feedback.
3. Add organization core-settings mutation surfaces with strict admin-only checks and audited write paths.
4. Add role-impact safety checks before role deletion or major permission changes (member reassignment and preview).
5. Add a single org-admin audit explorer for invitations, membership changes, role updates, pipeline config changes, and shared account actions.

