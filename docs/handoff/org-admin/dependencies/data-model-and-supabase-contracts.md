# Org Admin Data Model and Supabase Contracts (Stage 3)

## Purpose
This file maps org-admin routes to concrete SQL tables/views/functions and edge-function contracts currently used by implementation.

## Route-to-Contract Matrix
| Route | Main Contract Surface | Reads | Writes | Realtime |
| --- | --- | --- | --- | --- |
| `/app/org/:orgId/overview` | Org operations summary | `organization_members`, `posts`, `generations`, `pipeline_items`, `pipeline_configs`, `org_tasks`, `org_task_statuses`, `org_asset_library`, `org_post_asset_links`, `connected_accounts`, `profiles` | none at page level | `posts`, `pipeline_items`, `org_tasks`, `org_task_statuses` (via `useOrgCalendar`) |
| `/app/org/:orgId/admin/brand-kit` | Brand governance | `org_brand_kits`, `org_brand_kit_editors`, `organization_members`, `profiles`, `org_asset_library`, `org_asset_folders` | `org_brand_kits` + `brand_projects.brand_settings` via edge function, `org_brand_kit_editors` direct writes | none |
| `/app/org/:orgId/admin/members` | Member/invite governance | `organization_members`, `profiles`, `org_role_templates`, `org_invitations` | `organization_members`, invitation lifecycle via edge functions | none |
| `/app/org/:orgId/admin/roles` | Role-template governance | `org_role_templates`, `organization_members`, `profiles` | `org_role_templates` | none |
| `/app/org/:orgId/admin/pipelines` | Pipeline configuration | `pipeline_configs`, `organization_members`, `profiles`, `organizations.settings` | `pipeline_configs`, `organizations.settings.default_pipeline_id` | none |
| `/app/org/:orgId/admin/credits` | Credit pool/request oversight | `organizations`, `credit_requests` | none in current page | none |
| `/app/org/:orgId/admin/settings` | Shared account + task-status config | `organizations`, `connected_accounts_health_summary`, `platform_registry`, `organization_members`, `posts`, `profiles`, `org_task_statuses` | `connected_accounts`, `connection_events`, `org_task_statuses` | shared org notifications channels from top navbar (`user_notifications`, `common_room_messages`, `common_room_channel_reads`) |

## Access and Permission Contracts (Core)
### Frontend modules
- `OrgContextProvider` resolves:
  - membership
  - role
  - merged permissions
  - active brand project
- `OrgAdminRoute` enforces admin-only page access for all stage-3 routes except `/admin/brand-kit`.
- `resolveOrgPermissions` merges defaults, template permissions, and member overrides in frontend.

### SQL helper functions used by policies/services
- `org_current_user_is_active_member`
- `org_current_user_role`
- `org_current_user_has_brand_access`
- `get_member_permission`
- `can_user_post_to_account`

### Important route contract nuance
- `/app/org/:orgId/admin/brand-kit` is not wrapped by `OrgAdminRoute`.
- Edit control is enforced in-page and edge-function level (admin or delegated editor).

## Edge Function Contracts Used by Stage 3
### `org-brand-kit-upsert`
- Validates membership and brand-project access.
- Admins can create first brand-kit record.
- Non-admin editors can update only when editor record exists.
- Upserts `org_brand_kits` and mirrors selected fields into `brand_projects.brand_settings`.

### `org-invite-member`
- Requires org admin/super admin authority.
- Validates role against `org_role_templates`.
- Revokes prior pending invite for same email before creating new pending invite.
- Supports manual-link/email/hybrid delivery modes.
- Writes audit events and optional user notification.

### `org-revoke-invitation`
- Revokes non-accepted invitations and writes audit log.

### `org-delete-invitation`
- Deletes only terminal invite states (revoked/expired) and writes audit log.

### `credit-request-action` (backend available, UI wiring pending)
- Approve/deny/partial request actions.
- Updates request state and reviewer fields.
- On approval/partial, updates member `monthly_credit_limit` in `organization_members.permissions`.
- Sends user notification.

### Bootstrap-related functions used by stage-3 workflow prerequisites
- `org-self-signup`
- `org-setup`
- Shared bootstrap helper: `ensureOrganizationBootstrap`

## Primary SQL Contracts Referenced by Stage 3
- Organization foundation:
  - `organizations`
  - `organization_members`
  - `brand_projects`
  - `org_role_templates`
  - `org_invitations`
  - `context_last_used`
- Brand and assets:
  - `org_brand_kits`
  - `org_brand_kit_editors`
  - `org_asset_library`
  - `org_asset_folders`
  - `org_post_asset_links`
- Workflow configuration:
  - `pipeline_configs`
  - `pipeline_items`
- Credits:
  - `credit_requests`
  - `credit_events`
- Task system surfaced in org settings:
  - `org_task_statuses`
  - `org_tasks`
- Connected account ops in org settings:
  - `connected_accounts`
  - `connection_events`
  - `connected_accounts_health_summary` view
  - helpers in `20260328005000_org_accounts_helpers.sql`

## Realtime Contracts Relevant to Stage 3
- `useOrgCalendar` channel:
  - `posts`
  - `pipeline_items`
  - `org_tasks`
  - `org_task_statuses`
- `useOrgNotifications` (global org shell/top navbar):
  - `user_notifications`
  - `common_room_messages`
  - `common_room_channel_reads`

## No Relation Exists Yet (Data Contract Level)
- No dedicated stage-3 UI mutation path for `credit-request-action`, despite backend readiness.
- No dedicated audit surface for org-admin configuration and membership actions.
- No explicit persisted config-version model for `pipeline_configs` edits.

## Contract Hardening Priorities
1. Align brand-kit route entitlement (router, nav visibility, page edit policy, edge-function checks).
2. Wire credits actions through `credit-request-action` and avoid direct table update bypass.
3. Add server-side safety for role-template deletion with assignment checks.
4. Introduce config-change lineage for pipeline and org settings mutation domains.

