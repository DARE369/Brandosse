# Org Member Page: My Workspace

## Page Purpose (Plain Language)
This page is the member execution dashboard inside an org. It shows what the current member should act on now: revisions, scheduling-ready items, assigned tasks, and upcoming scheduled posts.

## Route and Access Rules
- Route: `/app/org/:orgId/workspace`
- Guard: `OrgMemberRoute` through org shell (`OrgContextProvider` + `OrgWorkspaceShell`)

## Component Composition
- Container: `src/org/pages/MyWorkspace.jsx`
- Key child domains:
  - hero and action cards
  - personal pipeline/task/schedule sections
  - `OrgGenerateComposer`
  - `OrgScheduleModal`
  - persistent member dashboard preferences

## State, Hooks, Services Used
- `useOrgCalendar` for posts, pipeline items, tasks, stats, and refresh.
- `useOrgContext` for org, role, active brand project, and admin context.
- `useAuth` for current user.
- `memberWorkspaceService`:
  - `fetchOrgMemberDashboardState`
  - `saveOrgMemberDashboardState`

## Data Contracts Touched
- Reads:
  - `org_member_dashboard_state`
  - `posts`
  - `pipeline_items`
  - `org_tasks`
  - `org_task_statuses`
  - `organization_members`
  - `profiles`
- Writes:
  - `org_member_dashboard_state` (dismissed action keys, team pulse collapsed)

## Inbound Dependencies
- Org sidebar route entry (`My Workspace`).
- Workspace switcher and post-auth org routing behavior.
- Invitation acceptance redirects for member roles (`/join` -> `/workspace`).

## Outbound Dependencies
- Opens `/office`, `/pipeline`, `/calendar`, and `/overview` (admins).
- Opens scheduling and revision flows through shared modals.
- Task actions deep-link into `/calendar?taskId=...`.

## Current Working Relationships
- Member-specific action inventory is computed from current pipeline/task/post state.
- Revisions can launch composer with preloaded edit target.
- Scheduling-ready pipeline items can open schedule modal directly.
- Task list and due/blocked urgency are connected to calendar task drawer.
- Member-specific dashboard preferences persist via `org_member_dashboard_state`.

## Missing or Partial Relationships
- Pipeline and task actions do not always preserve return context after navigation.
- Scheduling actions depend on downstream calendar contracts without showing detailed failure reasons here.
- Team pulse stats are informational only and do not link to focused bottleneck entities.

## No Relation Exists Yet
- No relation to a unified event timeline that includes common-room and notification activity.
- No relation to explicit client-review link lifecycle despite revisions and approvals being surfaced.

## Recommended Wiring Contract
- Add a shared `focus` route-state contract for pipeline/task/post context when navigating out of this page.
- Surface structured action failure reasons from scheduling/review service calls.
- Add direct links from pulse cards to filtered calendar/pipeline/task views.

## Risks If Wired Incorrectly
- Weak context handoff can cause duplicate work and missed urgent tasks.
- Improper action-state persistence can hide critical items or create stale dashboards.

