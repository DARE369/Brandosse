# Org Calendar Correction Pass Handoff Checklist

## Release Summary
This handoff covers the correction pass on `/app/org/:orgId/calendar`.

This pass focuses on:

- upload recovery for `org-asset-upload`
- tighter toolbar and filter layout
- stronger timeline rendering
- more uniform status-board cards
- deeper batch scheduling
- independent scroll behavior in the org workspace
- invite-time role-template setup

## Database / Deploy Notes

### No new database deploy for this pass
This correction pass does **not** introduce a new migration.

Existing baseline context:

- the repo still contains the earlier baseline migration:
  - `supabase/migrations/20260325110000_org_calendar_view_presets_and_asset_links.sql`
- this pass did not modify that schema

### Edge function status
`org-asset-upload` was deployed to project:

- `ujkuwemwlhilzarbrozu`

Verification already completed:

- live `OPTIONS` preflight now returns `200 OK`

If another environment is being updated, redeploy:

- `supabase functions deploy org-asset-upload --project-ref <target-ref>`

## Backend / Function Dependencies

- `org-asset-upload`
  - org library upload
  - calendar explorer upload
- `org-calendar-publish`
  - pipeline-backed scheduling / publish flow
- `pipeline-advance`
  - review and revision actions
- `org-invite-member`
  - invite creation with selected org role template key

## Manual Verification Checklist

### 1. Route and workspace shell
- Open `/app/org/:orgId/calendar`
- Confirm the page renders inside the org workspace shell
- Confirm the page does not route into personal or super-admin workspaces
- Confirm the org sidebar scrolls independently from the main page content

### 2. Toolbar and KPI layout
- Confirm the toolbar sits on one horizontal desktop row
- Confirm controls are arranged as:
  - date range
  - saved views
  - batch schedule
  - view tabs
  - filters trigger
- Confirm the filters live inside a popover and not a tall stacked card
- Confirm the four KPI cards fit on one desktop row

### 3. Filters
- Open the filter popover
- Confirm all three filters are present:
  - member
  - status
  - platform
- Confirm platform options remain stable and do not disappear incorrectly while filtering
- Confirm contributor/reviewer role defaults still behave safely

### 4. Week / month quick add
- In `Master Calendar`, click the `+` button on a future day
- Confirm the quick-add menu offers:
  - `Generate Content`
  - `Add From Library`
- Repeat in `Week`
- Confirm past days do not allow quick-add actions

### 5. Timeline
- Open `Timeline`
- Confirm the timeline shows:
  - sticky lane labels
  - sticky month/day ruler
  - stacked bars inside lanes
  - lane grouping switcher
- Confirm grouping works for:
  - member
  - platform
  - brand project
- Confirm bars show meaningful segments instead of a thin placeholder strip
- Confirm dragging still blocks past-day targets
- If the visible range is empty but filtered records exist, confirm the page shows a useful in-range message or recenters to relevant work

### 6. Status board uniformity
- Open `Status Board`
- Confirm cards feel visually consistent across columns
- Confirm long preview text is clamped instead of stretching cards unevenly
- Confirm action rows stay aligned cleanly

### 7. Batch scheduling
- Select queue items
- Open `Batch Schedule`
- Confirm each selected row includes:
  - media preview or placeholder
  - title
  - platform
  - editable date
  - editable time
  - editable caption
  - editable hashtags
  - optimize action
  - validation / collision feedback
- Confirm scheduling modes still seed the plan
- Confirm each row can be overridden manually before execution
- Confirm invalid past-date rows block execution
- Confirm successful rows remain scheduled even if another row fails

### 8. Ready to Schedule and side rail
- Confirm the side rail scrolls independently from the calendar canvas
- Confirm `Ready to Schedule` uses denser utility cards, not oversized empty blocks
- Confirm selected queue cards visually mark selection
- Confirm `Browse Library` still opens from the side rail

### 9. Bottlenecks
- Confirm bottleneck cards show:
  - lane label
  - pressure score
  - active count
  - rework count
  - average stage age
- Confirm higher-pressure overdue lanes rank above merely busy lanes
- Confirm bottleneck summary chips still appear in approval/timeline contexts

### 10. Asset upload
- Open `Browse Library`
- Click `Upload`
- Confirm the upload form appears inside the explorer-side inspector, not as a detached viewport drawer
- Upload a file
- Confirm the asset appears in the explorer without reloading the page
- Confirm upload failures now show specific messages:
  - missing deployment
  - permission issue
  - reachability/network issue

### 11. Members / roles admin
- Open the Members page
- Confirm the member table area scrolls independently when long
- Open a member drawer
- Confirm the drawer body scrolls independently
- Open Roles & Permissions
- Confirm the role editor surface scrolls independently when long

### 12. Invite flow
- Open `Invite Member`
- Confirm role selection uses the org-styled selector
- Confirm selecting a role template updates:
  - template summary
  - enabled access count
  - project scope summary
  - permission preview
- Send an invite and confirm the selected role template key is used

## How Bottlenecks Work

### Counted statuses
Only active review states count:

- `pending`
- `in_review`
- `revision_requested`

### Lane grouping
Each item is grouped by:

1. `current_assignee_role`
2. `currentStageName`
3. `unassigned`

### Weighted ranking
The displayed order is not raw-count based.

Pressure increases because of:

- overdue items
- revision / rework count
- active count
- average stage age
- oldest-item age
- approaching or missed SLA deadlines

### Expected behavior
A smaller overdue lane should outrank a bigger but healthier lane.

## Regression Checks
- org calendar route still loads
- queue still reflects approved unscheduled content
- org composer still opens in place
- library picker still opens in place
- pipeline navigation still works
- saved views still work
- `npm run build` passes

## Operational Verification Already Completed
- `npm run build`
- `supabase functions deploy org-asset-upload --project-ref ujkuwemwlhilzarbrozu`
- live preflight check for `org-asset-upload` returning `200 OK`

## Remaining Follow-Ups
- authenticated browser QA for live asset upload after redeploy
- any future deeper timeline/capacity refinements
- future campaign planning remains intentionally out of scope
