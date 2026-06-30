# Org Workspace Stage 6: Member Workspace Implementation

Updated: 2026-03-27  
Stage status: implemented  
Validation status: `npm run build` passed

## What was implemented

### 1. Stage 6 schema slice for member dashboard state

Added:

- `supabase/migrations/20260327050000_org_member_workspace_state_stage6.sql`

This migration adds:

- `org_member_dashboard_state`
- per-member persistence for:
  - `dismissed_action_keys`
  - `team_pulse_collapsed`
- RLS scoped to the current authenticated org member
- normalization and `updated_at` triggers

Current database behavior:

- each member gets at most one dashboard-state row per organization
- dismissed action cards persist per member instead of globally
- team-pulse collapse state persists per member instead of resetting every visit

### 2. Role-aware org home routing

Added:

- `src/org/utils/orgHomePath.js`
- `src/org/components/OrgHomeRedirect.jsx`

Updated:

- `src/router/router.jsx`
- `src/utils/workspaceUtils.js`
- `src/Context/AuthContext.jsx`
- `src/utils/protectedRoute.jsx`

Current behavior:

- org admins land on `/app/org/:orgId/overview`
- non-admin members land on `/app/org/:orgId/workspace`
- the org route index now resolves through `OrgHomeRedirect`
- workspace switching, auth redirect, and denied-admin fallback all use the same org-home helper
- `overview` is now treated as an admin route instead of a shared member landing page

### 3. Member workspace state service

Added:

- `src/org/services/memberWorkspaceService.js`

Current behavior:

- loads persisted member dashboard state
- saves dismissed action keys and Team Pulse collapse state
- falls back safely to in-memory defaults if the Stage 6 table is not available yet

Compatibility behavior:

- if `org_member_dashboard_state` has not been migrated yet, the page still renders
- dismiss/collapse interactions keep working in the current session, but persistence is skipped until the migration is applied

### 4. Member-facing workspace home

Added:

- `src/org/pages/MyWorkspace.jsx`
- `src/org/styles/MyWorkspace.css`

Current UI behavior:

- the new member landing page shows:
  - personal workload cards
  - action-required cards
  - submitted pipeline activity
  - assigned tasks
  - Team Pulse
  - upcoming scheduled content
- action cards support:
  - revision re-entry
  - ready-to-schedule openers
  - due-soon task CTAs
  - blocked-task CTAs
- dismissed action cards persist per member
- Team Pulse collapse state persists per member
- admins also get this page as their personal execution workspace, but org-wide monitoring remains on `Overview`

### 5. Navigation and shell updates

Updated:

- `src/org/components/OrgSidebar.jsx`
- `src/org/components/OrgTopNavbar.jsx`

Current behavior:

- sidebar now exposes:
  - `Overview` for org admins
  - `My Workspace` for all members
  - `My Office`
- profile dropdown now links to `View My Workspace`
- workspace catalog paths now stay aligned with member/admin home routing

### 6. Revision-mode composer re-entry

Updated:

- `src/org/components/OrgGenerateComposer.jsx`
- `src/org/styles/OrgGenerateComposer.css`

Current behavior:

- composer heading now reflects intent mode:
  - `Create a Draft`
  - `Edit Draft`
  - `Repurpose Draft`
  - `Revise Draft`
- revision launches create a `Revision Session`
- revision context notes from pipeline feedback now render inline in the composer header

### 7. Shared org shell polish

Updated:

- `src/styles/OrgWorkspace.css`

Current behavior:

- stat-card tone variants now render distinct warning/success/danger borders
- the member workspace cards visually align with the rest of the org shell

## What was intentionally left out

These items were not completed in this Stage 6 pass:

1. **Customizable member dashboard layout**
   - card dismissal and Team Pulse collapse are persisted
   - drag-reorder or widget-level layout customization was not added

2. **Per-action snooze windows**
   - action cards can be dismissed
   - no timed snooze or automatic resurfacing schedule was added

3. **Server-driven reminders for member dashboard actions**
   - Stage 6 surfaces revision/scheduling/task urgency from existing org data
   - no cron-based reminder generation was added

4. **Dedicated review-load page**
   - review pressure is surfaced in counts and action cards
   - no separate reviewer dashboard route was added

5. **Cross-device optimistic merge rules**
   - dashboard state persists per member
   - the persistence model is last-write-wins rather than field-level merge logic

## How the system works now

### Landing behavior

- admins enter the org workspace on `Overview`
- non-admin members enter on `My Workspace`
- direct access to `Overview` by non-admin members redirects back to their org home

### Member execution flow

- members can open `My Office` to generate or edit drafts
- revisions can be reopened directly from `My Workspace`
- approved items can open the org schedule modal directly from `My Workspace`
- tasks open inside the calendar task context without needing a separate task page

### Persistence model

- dismissed action cards are tracked by stable keys such as:
  - `revision:<pipelineItemId>`
  - `schedule:<pipelineItemId>`
  - `task:<taskId>`
  - `blocked:<taskId>`
- Team Pulse collapse state is stored per member per org

### Admin separation

- `Overview` remains the org-wide monitoring page
- `My Workspace` is the personal execution page
- admins can move between them without changing org context

## Stage 6 deviations from the original staged spec

These were deliberate and match the current repo structure:

1. **Dashboard lives inside the existing org shell**
   - Stage 6 did not add a second shell
   - the member home is a new org page under the current routed workspace

2. **State persistence is table-backed, not localStorage-only**
   - local-only state would not survive device changes
   - Stage 6 stores member preferences in Supabase with graceful fallback if the migration is missing

3. **Task and schedule CTAs reuse Stage 3 and Stage 4 surfaces**
   - no duplicate schedule or task modal was introduced
   - the dashboard opens the existing org schedule modal and calendar task context

## Validation completed

Executed:

```bash
npm run build
```

Result:

- success
- Stage 6 routing, dashboard state, member workspace UI, and revision-mode composer changes build cleanly
