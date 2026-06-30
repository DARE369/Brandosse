# Org Member Master Handoff (Stage 4)

## Plain-Language Overview
The org-member workspace is where contributors and reviewers do daily execution work: create drafts, submit work into review, schedule or publish approved content, collaborate in shared channels, manage task workload, and track assets tied to pipeline and calendar activity.

## Technical Architecture Summary
- Route scope under `/app/org/:orgId/*`:
  - `/app/org/:orgId/workspace`
  - `/app/org/:orgId/office`
  - `/app/org/:orgId/pipeline`
  - `/app/org/:orgId/calendar`
  - `/app/org/:orgId/library`
  - `/app/org/:orgId/common-room`
  - `/app/org/:orgId/common-room/:channelId`
  - `/app/org/:orgId/team-activity`
- Public route surfaces that feed org-member workflows:
  - `/join`
  - `/review/:clientReviewToken`
- Shell/runtime:
  - Route entry and guards: `src/router/router.jsx`, `src/utils/protectedRoute.jsx`
  - Org shell: `src/layouts/OrgWorkspaceShell.jsx`
  - Org context boundary: `src/org/context/OrgContextProvider.jsx`
  - Org navigation: `src/org/components/OrgSidebar.jsx`, `src/org/components/OrgTopNavbar.jsx`
- Data/services:
  - Org context and membership: `src/org/services/orgService.js`
  - Member workspace state: `src/org/services/memberWorkspaceService.js`
  - Pipeline and client review: `src/org/services/pipelineService.js`
  - Calendar and scheduling: `src/org/hooks/useOrgCalendar.js`, `src/org/services/orgCalendarService.js`, `src/org/services/orgScheduleService.js`
  - Tasks: `src/org/services/taskService.js`
  - Assets/folders/linkage: `src/org/services/assetLibraryService.js`
  - Common-room collaboration: `src/org/hooks/useCommonRoom.js`, `src/org/services/commonRoomService.js`
  - Org notification center in shell: `src/org/hooks/useOrgNotifications.js`, `src/org/services/orgNotificationService.js`
- Primary SQL contracts from:
  - `20260324100000_org_workspace_foundation.sql`
  - `20260324110000_org_pipeline_tables.sql`
  - `20260324120000_org_common_room_tables.sql`
  - `20260324130000_org_asset_library_table.sql`
  - `20260324150000_org_posts_generations_columns.sql`
  - `20260324160000_org_rls_policies.sql`
  - `20260324190000_org_invitation_owner_provisioning.sql`
  - `20260324200000_org_calendar_schedule_write_policy.sql`
  - `20260325110000_org_calendar_view_presets_and_asset_links.sql`
  - `20260325130000_common_room_reads_and_summaries.sql`
  - `20260326110000_org_asset_library_permission_alignment.sql`
  - `20260327020000_org_asset_folders_stage2.sql`
  - `20260327022000_org_asset_folder_rls_recursion_fix.sql`
  - `20260327030000_org_tasks_stage4.sql`
  - `20260327040000_common_room_groups_stage5.sql`
  - `20260327050000_org_member_workspace_state_stage6.sql`
  - `20260328005000_org_accounts_helpers.sql`
  - `20260328010000_org_notification_center_stage7.sql`

## Page Relationship Map
- Daily execution:
  - `/workspace` aggregates personal draft, review, task, and schedule pressure and launches generation/scheduling actions.
  - `/office` is draft-first authoring and pipeline submission.
  - `/pipeline` is the review-state board for submitted work.
  - `/calendar` is the operational control surface for scheduling, publishing, approvals, views, tasks, and asset linking.
- Asset and collaboration surfaces:
  - `/library` manages shared org assets/folders and origin linkage to post/pipeline/task context.
  - `/common-room` and `/common-room/:channelId` handle channel collaboration, asset references, and pipeline references.
  - `/team-activity` is a lightweight recent pipeline-activity feed.
- External entry points:
  - `/join` is invitation acceptance and account bootstrap into org membership.
  - `/review/:clientReviewToken` is tokenized external client approval/revision.

## UI-Service-Edge-Schema Relationship Map
| UI Domain | Services/Hooks | Edge Functions/RPC | Primary Schema Contracts |
| --- | --- | --- | --- |
| Workspace home (`/workspace`) | `useOrgCalendar`, `memberWorkspaceService`, `OrgGenerateComposer`, `OrgScheduleModal` | none direct | `org_member_dashboard_state`, `posts`, `pipeline_items`, `org_tasks`, `org_task_statuses`, `org_calendar_view_presets`, `org_post_asset_links`, `organization_members` |
| Draft workbench (`/office`) | `fetchOrgDrafts`, `deleteOrgDraft`, `submitPostToPipeline`, `usePipelineItems` | none direct | `posts`, `pipeline_items`, `pipeline_configs`, `organization_members`, `profiles` |
| Pipeline board (`/pipeline`) | `usePipelineItems` | none direct | `pipeline_items`, `posts`, `generations`, `pipeline_configs`, `org_post_asset_links` |
| Calendar ops (`/calendar`) | `useOrgCalendar`, `orgCalendarService`, `taskService`, `OrgScheduleModal`, task/calendar modals | `org-calendar-publish`, `org-task-notify` | `posts`, `pipeline_items`, `pipeline_configs`, `org_tasks`, `org_task_statuses`, `org_calendar_view_presets`, `org_post_asset_links`, `org_asset_library`, `connected_accounts` |
| Asset library (`/library`) | `useOrgAssets`, `assetLibraryService`, `OrgScheduleModal` | `org-asset-upload` | `org_asset_library`, `org_asset_folders`, `org_post_asset_links`, `posts`, `pipeline_items`, `org_tasks`, `profiles` |
| Common room (`/common-room*`) | `useCommonRoom`, `commonRoomService`, `useOrgAssets`, `usePipelineItems` | `ai-org-chat`, RPCs `get_common_room_channel_summaries`, `common_room_leave_channel` | `common_room_channels`, `common_room_messages`, `common_room_channel_reads`, `organization_members`, `profiles` |
| Team activity (`/team-activity`) | `usePipelineItems` | none | `pipeline_items` |
| Invitation acceptance (`/join`) | `previewOrganizationInvitation`, `completeOrganizationInvitationSignup`, `acceptOrganizationInvitation` | `org-accept-invitation`, `org-complete-invitation-signup` | `org_invitations`, `organization_members`, `organizations`, `brand_projects`, `context_last_used`, `profiles` |
| External client review (`/review/:token`) | `fetchClientReviewPreview`, `submitClientReviewAction` | `pipeline-client-action` | `pipeline_items`, `posts`, `generations` |
| Org shell notifications | `useOrgNotifications`, `orgNotificationService` | RPC `enqueue_org_notification_reminders` | `user_notifications`, `common_room_messages`, `common_room_channel_reads`, `org_tasks`, `org_task_statuses`, `pipeline_items` |

## Implemented vs Missing Relationship Summary
### Implemented and working
- Route protection and org-membership gating are active for all org-member routes under `/app/org/:orgId/*`.
- Workspace to office/pipeline/calendar flow is wired with concrete route handoffs.
- Draft to pipeline submission and realtime pipeline refresh are active.
- Calendar integrates scheduling, publish-now, batch scheduling, preset saving, and task management.
- Library foldering and metadata management are active, including asset provenance enrichment.
- Common room supports channel management, message references, and AI reply integration.
- Invitation acceptance and password-setup flow are active and tied to membership creation.
- Client review token execution is active for approve or request-revision actions.

### Partially wired
- Pipeline board is mostly read-only; stage transition actions are routed through calendar modals or backend calls elsewhere.
- Cross-surface deep links often route to page roots instead of focused entities:
  - Common-room references open `/pipeline` or `/library` without item focus.
  - Office and library route to pipeline root in multiple places.
- Team Activity currently reflects pipeline state only, not task, calendar, notification, or channel events.
- Client-review link generation backend exists, but a clear member-facing UI trigger is not present in Stage 4 route pages.

### No relation exists yet (observed)
- No end-to-end lineage explorer for post, pipeline item, task, schedule state, and linked assets in one unified page.
- No explicit handoff from Team Activity into task drawers or common-room thread context.
- No dedicated member-facing troubleshooting surface for invitation acceptance failures beyond generic error states.
- No canonical workflow state machine UI that shows lifecycle transitions from draft through client review to publish.

## Missing-Link Inventory (Org Member)
See `org-member/wiring-gaps.md` for the structured gap inventory with current state, intended relationship, exact missing connection, implementation path, and risks.

## How To Complete Unfinished Wiring Safely
1. Fix schedule-context contract consistency in calendar services before adding new scheduling features.
2. Add entity-deep-link contracts (`pipelineItemId`, `taskId`, `postId`, `assetId`) across office, library, common-room, and notifications.
3. Wire client-review link generation into pipeline/calendar UI with stage capability checks.
4. Expand Team Activity into a multi-domain event timeline backed by existing audit/notification/task/pipeline sources.
5. Add explicit contract tests for role/permission behavior across scheduling, publishing, channel management, and library actions.
