# Org Member Data Model and Supabase Contracts (Stage 4)

## Purpose
This file maps org-member routes to concrete SQL tables/views/functions and edge-function contracts currently used by implementation.

## Route-to-Contract Matrix
| Route | Main Contract Surface | Reads | Writes | Realtime |
| --- | --- | --- | --- | --- |
| `/app/org/:orgId/workspace` | Personal execution dashboard in org context | `org_member_dashboard_state`, `posts`, `pipeline_items`, `org_tasks`, `org_task_statuses`, `org_calendar_view_presets`, `organization_members`, `profiles` | `org_member_dashboard_state` | via `useOrgCalendar`: `posts`, `pipeline_items`, `org_tasks`, `org_task_statuses` |
| `/app/org/:orgId/office` | Draft management and submission | `posts` (drafts), `pipeline_items`, `pipeline_configs`, `organization_members`, `profiles` | `posts` (draft delete), `pipeline_items` (submission insert), `posts.pipeline_item_id` update | via `usePipelineItems`: `pipeline_items` |
| `/app/org/:orgId/pipeline` | Review state board | `pipeline_items`, `posts`, `generations`, `pipeline_configs`, `org_post_asset_links` | none at page level | via `usePipelineItems`: `pipeline_items` |
| `/app/org/:orgId/calendar` | Scheduling/publishing/tasks/calendar views | `posts`, `pipeline_items`, `pipeline_configs`, `org_tasks`, `org_task_statuses`, `org_asset_library`, `org_post_asset_links`, `org_calendar_view_presets`, `organization_members`, `profiles` | `posts`, `pipeline_items`, `org_tasks`, `org_task_statuses`, `org_calendar_view_presets` | via `useOrgCalendar`: `posts`, `pipeline_items`, `org_tasks`, `org_task_statuses` |
| `/app/org/:orgId/library` | Shared asset management and provenance | `org_asset_library`, `org_asset_folders`, `org_post_asset_links`, `posts`, `pipeline_items`, `org_tasks`, `profiles` | `org_asset_library`, `org_asset_folders` | none |
| `/app/org/:orgId/common-room` and `:channelId` | Channel collaboration, references, AI responses | `common_room_channels`, `common_room_messages`, `common_room_channel_reads`, `organization_members`, `profiles`, `org_asset_library`, `pipeline_items` | `common_room_channels`, `common_room_messages`, `common_room_channel_reads` | `common_room_channels`, `common_room_messages`, `common_room_channel_reads` |
| `/app/org/:orgId/team-activity` | Simplified team feed | `pipeline_items` | none | via `usePipelineItems`: `pipeline_items` |
| `/join` | Invitation onboarding and acceptance | `org_invitations`, `organizations`, `brand_projects`, `profiles`, `context_last_used` | `organization_members`, `org_invitations`, `profiles`, `context_last_used`, `organizations` owner fields for owner invitations | none |
| `/review/:clientReviewToken` | External tokenized review action | `pipeline_items`, `posts`, `generations`, `organizations` | `pipeline_items` status/history/token-used fields | none |

## Access and Permission Contracts (Core)
### Frontend modules
- Org context and capability model:
  - `OrgContextProvider` resolves role, membership, and merged permissions.
  - `OrgMemberRoute` enforces active org membership for `/app/org/:orgId/*`.
- Permission-aware page behavior:
  - Calendar actions gated by `can_schedule`, `can_publish`, `can_manage_tasks`.
  - Library mutations gated by `can_manage_library` and `can_approve_library_uploads`.
  - Common-room channel management gated by `can_create_channels` and private-group admin identity.

### SQL helper functions used by policies/services
- `org_current_user_is_active_member`
- `org_current_user_role`
- `org_current_user_has_brand_access`
- `get_member_permission`
- `can_user_post_to_account`
- `get_common_room_channel_summaries`
- `common_room_leave_channel`
- `enqueue_org_notification_reminders`

## Edge Function Contracts Used by Stage 4
### `org-calendar-publish`
- Supports `schedule` and `publish_now` actions for pipeline-linked posts.
- Enforces org membership and schedule/publish permissions.
- Validates shared-account publish access via `can_user_post_to_account`.
- Writes post/pipeline status and dispatches notification/audit paths.

### `org-get-schedule-context`
- Returns scheduling-ready context for pipeline item or standalone post:
  - owner/reviewer, destinations, task, attached assets, permission flags, lifecycle resolution.
- Used by schedule modal paths and expected by calendar publishing logic.

### `pipeline-advance`
- Executes stage transitions (`approve`, `request_revision`, etc.) and updates `pipeline_items`.

### `pipeline-client-action`
- Handles external client token flows:
  - `preview`
  - `approve`
  - `request_revision`
- Marks token usage after non-preview action.

### `pipeline-generate-client-link`
- Generates review token and URL for stages where `generates_client_review_link` is enabled.
- Requires actor ability to advance current stage.
- Backend is available; explicit Stage 4 route-page invocation is currently weak.

### `org-accept-invitation`
- Invitation preview and acceptance endpoint.
- Enforces token state, signed-in email match, membership upsert, and redirect target.

### `org-complete-invitation-signup`
- Password-based invited-account provisioning when needed.
- Creates auth user/profile and ties invitation to invited user.

### `org-asset-upload`
- Handles multipart upload, folder assignment checks, permission validation, and asset insert into `org_asset_library`.

### `ai-org-chat`
- Creates AI channel replies, checks access and credits, writes AI message, logs session, and records credit usage.

### `org-task-notify`
- Writes task-notification rows into `user_notifications` for provided recipients.

## Primary SQL Contracts Referenced by Stage 4
- Org and membership foundation:
  - `organizations`
  - `organization_members`
  - `brand_projects`
  - `org_invitations`
  - `context_last_used`
  - `profiles`
- Content lifecycle:
  - `posts`
  - `generations`
  - `pipeline_configs`
  - `pipeline_items`
- Calendar and task operations:
  - `org_calendar_view_presets`
  - `org_tasks`
  - `org_task_statuses`
  - `connected_accounts`
- Asset layer:
  - `org_asset_library`
  - `org_asset_folders`
  - `org_post_asset_links`
- Collaboration and notifications:
  - `common_room_channels`
  - `common_room_messages`
  - `common_room_channel_reads`
  - `user_notifications`
  - `ai_session_logs`
  - `credit_events`

## Realtime Contracts Relevant to Stage 4
- `useOrgCalendar`:
  - `posts`
  - `pipeline_items`
  - `org_tasks`
  - `org_task_statuses`
- `usePipelineItems`:
  - `pipeline_items`
- `useCommonRoom`:
  - `common_room_channels`
  - `common_room_messages`
  - `common_room_channel_reads`
- `useOrgNotifications`:
  - `user_notifications`
  - `common_room_messages`
  - `common_room_channel_reads`

## No Relation Exists Yet (Data Contract Level)
- No single contract that returns full post-pipeline-task-asset lineage for one entity in one query.
- No canonical event feed contract behind `/team-activity`; current page reuses only pipeline-items reads.
- No explicit Stage 4 page-level contract for generating client-review links even though edge support exists.
- No enforced deep-link payload contract between message references and destination pages.

## Contract Hardening Priorities
1. Resolve calendar scheduling-context contract drift in `orgCalendarService` by importing and using `fetchOrgScheduleContext` and `toEdgeFunctionError` from `orgScheduleService`.
2. Standardize deep-link payload schema across pages (`pipelineItemId`, `taskId`, `postId`, `assetId`) and use it from notifications/common-room/library/office.
3. Add integration tests for invite acceptance permutations:
   - signed-in match
   - signed-in mismatch
   - password-setup flow
   - expired/revoked/accepted token behavior
4. Add explicit UI wiring for client-review link generation with stage-capability validation.
5. Add a consolidated member-activity contract for `/team-activity` (pipeline, tasks, schedule, and common-room activity).
