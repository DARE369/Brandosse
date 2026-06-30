# Org Member Page: Org Calendar

## Page Purpose (Plain Language)
This page is the main operational planning and execution surface for organization content. Members use it to schedule approved work, publish content, act on review items, manage tasks, and attach assets.

## Route and Access Rules
- Route: `/app/org/:orgId/calendar`
- Guard: `OrgMemberRoute`
- Role-aware view exposure:
  - advanced roles see full view set (`calendar`, `week`, `timeline`, `board`, `queue`, `approval`, `workload`, `tasks`)
  - basic roles see limited views (`calendar`, `week`, `tasks`)

## Component Composition
- Container: `src/org/pages/OrgCalendar.jsx`
- Key child domains:
  - multi-view calendar canvas (month/week/timeline/board/queue/approval/workload/tasks)
  - filter and saved-view toolbar
  - queue and bottleneck side panels
  - `OrgScheduleModal`
  - `TaskCreateModal`
  - `TaskDetailDrawer`
  - `CalendarLibraryPicker`
  - `CalendarBatchScheduleModal`
  - `OrgGenerateComposer`

## State, Hooks, Services Used
- `useOrgCalendar`:
  - snapshot loading
  - schedule/publish actions
  - pipeline actions
  - task CRUD and notes
  - preset CRUD
  - batch schedule preview/execute
- `useOrgContext` for org/user/permission context.
- Task utilities (`src/org/utils/tasks`).

## Data Contracts Touched
- Reads:
  - `posts`
  - `pipeline_items`
  - `pipeline_configs`
  - `org_tasks`
  - `org_task_statuses`
  - `org_asset_library`
  - `org_post_asset_links`
  - `org_calendar_view_presets`
  - `organization_members`
  - `profiles`
  - `connected_accounts` (through schedule-context and publish flows)
- Writes:
  - `posts` (schedule/update metadata)
  - `pipeline_items` (advance or publish/schedule transitions)
  - `org_tasks`
  - `org_task_statuses`
  - `org_calendar_view_presets`
  - task notifications into `user_notifications` via edge
- Edge/RPC:
  - `org-calendar-publish`
  - `pipeline-advance`
  - `org-task-notify`
  - schedule context uses `org-get-schedule-context` contract
- Realtime:
  - `posts`
  - `pipeline_items`
  - `org_tasks`
  - `org_task_statuses`

## Inbound Dependencies
- Workspace task and schedule actions deep-link here (`?taskId=...`).
- Library and task flows open schedule modal from this route.
- Top navigation and sidebar route entry.

## Outbound Dependencies
- Opens pipeline with optional focused item state.
- Opens library picker and generation composer.
- Drives publish/schedule outcomes consumed by workspace, pipeline, and notification center.

## Current Working Relationships
- The page is the strongest integration hub across content lifecycle, tasks, and assets.
- Drag/drop scheduling and task status movement are implemented.
- Task drawer links to pipeline and schedule actions.
- Saved calendar views support personal/shared scope and defaults.
- Batch scheduling supports preview and execution strategies.

## Missing or Partial Relationships
- `orgCalendarService` references `fetchOrgScheduleContext` and `toEdgeFunctionError` without local import, creating a likely runtime break in schedule/publish code paths.
- Several route handoffs into this page provide weak focus context (page-level, not entity-level).
- Error explainability for denied actions is uneven across views.

## No Relation Exists Yet
- No canonical event/audit panel in calendar showing who changed stage, task, or schedule state and why.
- No unified "lineage" panel that fully joins task, pipeline item, post, and attached assets in one view.

## Recommended Wiring Contract
- Import and use schedule-context helpers from `orgScheduleService` in `orgCalendarService`.
- Standardize entity-focus payloads:
  - `taskId`
  - `pipelineItemId`
  - `postId`
- Add reason-code mapping for permission or stage-rule failures.
- Add timeline/audit rail for state transitions and actor context.

## Risks If Wired Incorrectly
- Calendar is on the critical workflow path; incorrect scheduling/publish behavior can create immediate operational failures.
- Weak permission/error contracts can surface actions that backend later rejects, causing repeated failed attempts.

