# Org Workspace Stage 4: Task System Implementation

Updated: 2026-03-27  
Stage status: implemented  
Validation status: `npm run build` passed

## What was implemented

### 1. Stage 4 schema slice and task lifecycle migration

Added:

- `supabase/migrations/20260327030000_org_tasks_stage4.sql`

This migration adds:

- `org_task_statuses`
- `org_tasks`
- `posts.task_id`
- `pipeline_items.task_id`
- default system task statuses for every existing org:
  - `todo`
  - `in_progress`
  - `in_review`
  - `completed`
- RLS for task reads/writes and task-status management
- database permission defaults expanded with `can_manage_tasks`
- trigger-based linkage sync so:
  - linking a task to a post updates `posts.task_id`
  - linking a task to a pipeline item updates `pipeline_items.task_id`
- trigger-based task progress syncing from pipeline/post status changes

Current database behavior:

- task rows are validated against org and brand boundaries before insert/update
- linked post and linked pipeline references are normalized onto the task row
- a `completed` task status sets `completed_at` automatically
- moving a linked post or pipeline item through the workflow updates the linked task status without relying on client code

### 2. Org bootstrap and permission defaults

Updated:

- `supabase/functions/_shared/org.ts`
- `supabase/functions/_shared/org-bootstrap.ts`
- `src/org/constants/permissions.js`
- `src/org/services/orgService.js`

Current behavior:

- role defaults now include `can_manage_tasks`
- new organizations bootstrap with the four system task statuses automatically
- the org role editor surface can now reason about task-management permissions in the same way it already handles publishing and library permissions

### 3. Task service layer

Added:

- `src/org/services/taskService.js`
- `src/org/utils/tasks.js`

Current task service behavior:

- fetches task statuses
- fetches tasks with normalized linked post, linked pipeline item, assignee profile, creator profile, and note-author profiles
- creates, updates, and deletes tasks
- appends task notes
- creates, updates, and deletes task statuses
- sends best-effort task notifications through `org-task-notify`

Compatibility behavior:

- linked-post and linked-pipeline fetches already fall back cleanly if `task_id` is not present yet
- task fetch no longer over-filters to org-level-only rows when no active brand project is selected

### 4. Calendar snapshot and hook integration

Updated:

- `src/org/services/orgCalendarService.js`
- `src/org/services/pipelineService.js`
- `src/org/hooks/useOrgCalendar.js`

Current behavior:

- the org calendar snapshot now loads:
  - task statuses
  - tasks
  - task KPI counts
- pipeline item fetches are compatibility-safe across environments with and without `pipeline_items.task_id`
- the calendar hook now exposes:
  - `canManageTasks`
  - `taskStatuses`
  - `tasks`
  - task mutation methods
- realtime refresh now listens to:
  - `org_tasks`
  - `org_task_statuses`

Task notification behavior:

- task assignment, task updates, and task note additions trigger best-effort notifications
- if `org-task-notify` is not deployed to the active Supabase project, task mutations still succeed and only the notification side-effect is skipped

### 5. Task mode inside org calendar

Added:

- `src/org/components/tasks/TaskBoardView.jsx`
- `src/org/components/tasks/TaskTableView.jsx`
- `src/org/components/tasks/TaskCreateModal.jsx`
- `src/org/components/tasks/TaskDetailDrawer.jsx`

Updated:

- `src/org/pages/OrgCalendar.jsx`
- `src/org/styles/OrgCalendar.css`

Current UI behavior:

- `Tasks` is now a first-class org calendar view mode
- the task view supports:
  - board presentation
  - table presentation
  - search
  - assignee filter
  - status filter
  - priority filter
  - blocked-state filter
  - include-completed toggle
- members with `can_manage_tasks` can:
  - create tasks
  - drag tasks between status columns
  - edit task details
  - delete tasks
  - add task notes
- the task drawer shows:
  - ownership
  - due date
  - blocked state
  - linked post / linked pipeline item
  - notes
- linked content can open:
  - the org schedule modal
  - the pipeline workspace

### 6. Task status admin configuration

Updated:

- `src/org/admin/OrgSettingsPage.jsx`
- `src/org/components/tasks/TaskStatusManager.jsx`
- `src/org/styles/OrgAdmin.css`

Current behavior:

- org settings now surface task-status configuration
- admins can create custom task statuses
- system statuses are visually locked in the UI and cannot be deleted
- system status color editing is also locked in the UI for consistency with the “system status” constraint

### 7. Schedule modal task context

Updated:

- `supabase/functions/org-get-schedule-context/index.ts`
- `src/org/services/orgScheduleService.js`
- `src/org/components/calendar/OrgScheduleModal.jsx`

Current behavior:

- when the opened record is linked to a task, the schedule modal now shows task context
- the modal can render:
  - task title
  - task status label
  - task due label
  - blocked state

This keeps the schedule surface aligned with the task system instead of creating a second task-summary UI.

### 8. Task notification edge function

Added:

- `supabase/functions/org-task-notify/index.ts`

Current behavior:

- validates active org membership
- inserts in-app `user_notifications` rows for supplied recipients
- carries task metadata through the notification payload

## What was intentionally left out

These items were not completed in this Stage 4 pass:

1. **Due-soon reminder sweep**
   - task assignment/update/note notifications are implemented
   - scheduled reminder sweeps or cron-based due-date reminders were not added yet

2. **Automatic notification fan-out from DB-trigger status sync**
   - linked post/pipeline status changes can auto-move the task status
   - those automatic DB-driven transitions do not yet emit a matching notification event

3. **Task status reorder UI**
   - custom task statuses can be added, edited, and deleted
   - drag reordering or explicit move-up/move-down controls were not added yet

4. **Dedicated task analytics surface**
   - task KPIs are present inside the calendar task mode
   - no separate reporting page or historical task analytics panel was added

5. **Reminder/escalation ownership rules**
   - task blocking and assignee state exist
   - escalation workflows and advanced SLA policies remain deferred

## How the system works now

### Task creation and linkage

- tasks can be created directly from the org calendar task mode
- a task can link to:
  - a post
  - a pipeline item
  - both, when the relationships resolve to the same content chain
- linked rows stay synchronized through DB triggers

### Task progression

- manual board moves update `org_tasks.status_id`
- pipeline and post status changes can also advance the linked task automatically
- completed tasks receive `completed_at`
- blocked tasks stay visible in both the board and table views

### Calendar integration

- the org calendar remains the single workspace entry for task operations
- task mode lives beside calendar, queue, approval, and workload modes
- the task drawer can open schedule context for linked content without leaving the page

### Settings integration

- task status configuration now lives under org settings
- default statuses are always present once the Stage 4 migration is applied or org bootstrap runs

### Permission model

- task editing depends on `can_manage_tasks`
- read access follows org membership and brand-access rules
- admin settings remain the configuration surface for status management

## Stage 4 deviations from the original staged spec

These were deliberate and align with the repo’s current structure:

1. **Calendar-first integration**
   - the staged spec described tasks conceptually as a system
   - this implementation keeps tasks inside `OrgCalendar` instead of creating a separate top-level page

2. **Service + hook split**
   - the staged spec focused mainly on page/component outcomes
   - this repo already uses service/hook separation, so task data and task mutations were added through `taskService` and `useOrgCalendar`

3. **Best-effort notifications**
   - task notifications are implemented
   - they are intentionally non-blocking so missing Edge Function deployment does not break task CRUD flows

## Validation completed

Executed:

```bash
npm run build
```

Result:

- success
- Stage 4 task schema references, calendar task mode, settings integration, and schedule-modal task context build cleanly

## Next-stage dependency note

Stage 5 can now attach task-aware collaboration and notification affordances without inventing a second task model. Stage 6 can consume the same task data for the member-facing workspace dashboard and action cards.
