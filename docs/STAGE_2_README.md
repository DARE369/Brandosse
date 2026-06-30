# Stage 2 - Task System Implementation

## Summary
Stage 2 implemented a dedicated task workspace under Pipeline so members can see and update assigned work outside the calendar view. Admin task creation was integrated into the same Pipeline surface, and task status changes now flow through member/admin views with a pipeline notification badge. Database task policies were aligned so members can read assigned/created tasks, assignees can update status, and admin roles control task creation/deletion.

## Files Created
- `src/org/components/tasks/PipelineTasksPanel.jsx` - Dedicated `Pipeline > Tasks` UI with sections, filters, task cards, and status updates.
- `src/org/hooks/usePipelineTaskBadgeCount.js` - Sidebar badge counter hook for open tasks assigned to the current user.
- `supabase/migrations/20260404134000_stage2_task_access_alignment.sql` - Stage 2 task RLS alignment + assignee update guard trigger.
- `docs/STAGE_2_README.md` - Stage deliverable summary and verification checklist.

## Files Modified
- `src/router/router.jsx` - Added `/app/org/:orgId/pipeline/tasks` route.
- `src/org/pages/PipelineBoard.jsx` - Added Pipeline tabs (`Content Pipeline`, `Tasks`) and wired the new tasks panel.
- `src/org/styles/PipelineBoard.css` - Added styles for pipeline tabs, task filters, task cards, and task status controls.
- `src/org/components/OrgSidebar.jsx` - Added Pipeline nav badge to show assigned open task count.
- `src/styles/OrgWorkspace.css` - Added shared `OrgSelect` base styles + select search styles; added sidebar badge style.
- `src/org/components/OrgSelect.jsx` - Added searchable dropdown support.
- `src/org/components/tasks/TaskCreateModal.jsx` - Enabled searchable linked-post and linked-pipeline dropdowns.
- `src/org/services/taskService.js` - Expanded linked post fetch payload to include title and generation media for task card linking.
- `src/org/hooks/useOrgCalendar.js` - Updated task notification deep links to `Pipeline > Tasks`.
- `src/org/pages/MyWorkspace.jsx` - Updated "Open Tasks" navigation target to `Pipeline > Tasks`.

## Database Changes
- Migration: `supabase/migrations/20260404134000_stage2_task_access_alignment.sql`
- Tables altered:
  - `public.org_tasks` (policy/trigger behavior updated)
- Functions/Triggers:
  - `public.enforce_org_task_member_status_updates()` (new trigger function)
  - `trg_org_task_member_status_guard` on `public.org_tasks` (new trigger)
- RLS policies:
  - Replaced legacy org task policies with:
    - `org_workspace_member_read_tasks`
    - `org_workspace_admin_insert_tasks`
    - `org_workspace_member_update_task_status`
    - `org_workspace_admin_delete_tasks`

## How to verify this stage is working

### Step 1
Log in as an org admin and open `Pipeline`.

### Expected result
You can switch between `Content Pipeline` and `Tasks` tabs. `Tasks` opens a dedicated task workspace, not the calendar tasks view.

### Step 2
From `Pipeline > Tasks`, click `New Task`, fill Title + Assignee + Due Date, and optionally link generated content using the searchable dropdown.

### Expected result
Task is created successfully and appears under `Created by Me`.

### Step 3
Log in as the assigned member and open `Pipeline > Tasks`.

### Expected result
Task appears under `Assigned to Me` with:
- task title
- due label (`Due Apr XX` or `Overdue - Apr XX`)
- status badge
- `Assigned by` creator name
- linked content block (if linked)

### Step 4
As the assigned member, change task status (Pending/In Progress/Completed/Blocked).

### Expected result
Status saves and updates card state. Re-open as admin and confirm status change is visible in `Created by Me`.

### Step 5
Assign at least one open task to a member and check the sidebar.

### Expected result
`Pipeline` nav item shows a red badge count for that member.

## Known limitations or follow-up tasks
- Linked post click currently routes to Office/Pipeline surfaces; deep-linking directly to a specific post editor can be improved in a follow-up.
- Assignee updates are restricted to status fields by trigger; if future product scope needs member-editable due dates or notes, policy/trigger updates will be required.
- Editors who are not org admins now follow stricter Stage 2 task access constraints by design.
