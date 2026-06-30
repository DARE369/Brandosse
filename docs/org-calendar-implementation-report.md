# Org Calendar Correction Pass Implementation Report

## Objective
This pass corrected weak or unfinished parts of the org calendar after the earlier extended roadmap work.

The target was not to add another new feature layer. The target was to make the current org calendar feel professional and dependable by fixing:

- asset upload reliability
- the oversized toolbar and filter area
- the weak timeline UI
- uneven status board cards
- shallow batch scheduling
- scroll/layout problems in the org shell and admin member/role tools
- invite-time role selection and permission preview

## Shipped Scope
This correction pass shipped all of the following without adding any new database schema:

- asset-upload error recovery and clearer deployment/runtime messaging
- a compressed horizontal calendar toolbar with overflowed filters
- stable member, status, and platform filters sourced from the full record pool
- a rebuilt Bluefion-style lane timeline with stacked bars inside lanes
- uniform status-board cards with clamped preview text
- per-item batch scheduling rows with editable date, time, caption, hashtags, media preview, and optimize actions
- independent scroll behavior for:
  - org sidebar
  - org content area
  - calendar side rail
  - calendar canvas
  - member table
  - role editor
- invite-time role-template selection with permission preview
- updated implementation and QA docs, including the bottleneck model

## What Changed

### 1. Asset Upload Recovery
Files:

- `src/org/services/assetLibraryService.js`
- `src/org/components/OrgAssetUploadModal.jsx`
- `src/org/components/calendar/CalendarLibraryPicker.jsx`
- `supabase/functions/org-asset-upload/index.ts`

Changes:

- stopped treating the upload failure as a generic frontend edge-function error
- switched upload handling to direct function fetch so HTTP status and server errors can be classified explicitly
- added specific frontend error messages for:
  - missing function deployment (`404`)
  - permission failures (`401` / `403`)
  - network/CORS reachability failures
- moved the upload form into an embedded inspector inside the calendar library explorer instead of a detached viewport-fixed drawer

### 2. Verified Upload Root Cause
Root cause found:

- the live `org-asset-upload` function was not deployed on project `ujkuwemwlhilzarbrozu`
- browser CORS noise was a symptom of the missing function, not the primary cause

Resolution completed:

- deployed `org-asset-upload` to project `ujkuwemwlhilzarbrozu`
- verified `OPTIONS https://ujkuwemwlhilzarbrozu.supabase.co/functions/v1/org-asset-upload` now returns `200 OK`

Important note:

- I verified deployment and preflight reachability
- I did not run a full authenticated browser upload from this terminal session, so final in-app upload confirmation still belongs in manual QA

### 3. Toolbar and Filter Recovery
Files:

- `src/org/pages/OrgCalendar.jsx`
- `src/org/styles/OrgCalendar.css`

Changes:

- rebuilt the calendar toolbar into a tighter single desktop rail
- kept these on the main line:
  - date range control
  - saved views
  - batch schedule
  - view tabs
  - filters trigger
- moved the filter controls into a compact popover instead of leaving them as a tall vertical block
- reduced header padding and white space so week and timeline views have more usable canvas height
- compressed the KPI cards so four can sit on one row on normal desktop widths

### 4. Stable Filters
File:

- `src/org/pages/OrgCalendar.jsx`

Changes:

- member, status, and platform filters are now fully wired
- platform options now derive from the full unfiltered calendar record pool, not the already-filtered subset
- this prevents filter options from disappearing or mutating incorrectly during filtering

### 5. Timeline Redesign
Files:

- `src/org/components/calendar/CalendarTimelineView.jsx`
- `src/org/pages/OrgCalendar.jsx`
- `src/org/styles/OrgCalendar.css`

Changes:

- replaced the weak thin timeline strip with a lane-based planning surface
- expanded the timeline window to 28 days
- added:
  - sticky lane labels
  - sticky month/day rulers
  - horizontally scrollable date grid
  - stacked bars inside each lane
  - drafting / review / schedule segments
  - published milestone marker
- timeline lanes now group by:
  - member
  - platform
  - brand project
- if records exist but not in the visible range, the component now shows a useful “no items in this range” state instead of an empty-feeling dead block
- when the current timeline window is empty but filtered records exist, the page auto-reanchors toward the first relevant record window

### 6. Status Board Uniformity
Files:

- `src/org/components/calendar/CalendarContentCard.jsx`
- `src/org/styles/OrgCalendar.css`

Changes:

- standardized the internal ops-card structure into:
  - top row
  - clamped preview body
  - bottom metadata row
- added preview clamping and minimum card height
- kept status board columns unchanged, but made the cards visually more consistent regardless of description length

### 7. Batch Scheduling Rebuild
Files:

- `src/org/components/calendar/CalendarBatchScheduleModal.jsx`
- `src/org/services/orgCalendarService.js`
- `src/org/pages/OrgCalendar.jsx`

Changes:

- replaced the previous preview-only batch flow with editable per-item scheduling rows
- each row now includes:
  - media preview or placeholder
  - title
  - platform
  - editable date
  - editable time
  - editable caption
  - editable hashtags
  - optimize action
  - validation / collision feedback
- scheduling modes still seed the plan, but the user can override each row before execution
- caption and hashtag optimization now reuses existing repo helpers:
  - `optimizeForSEO`
  - `generateCaption`
  - `generateImageCaptionSuggestions`
- caption and hashtag edits persist back onto the linked `posts` row before/during final scheduling
- pipeline-backed scheduling still routes through the existing safe org scheduling path

### 8. Calendar Side Rail and Scroll Recovery
Files:

- `src/org/pages/OrgCalendar.jsx`
- `src/org/styles/OrgCalendar.css`
- `src/styles/OrgWorkspace.css`

Changes:

- made the org sidebar independently scrollable from main page content
- made the org content area independently scrollable inside the workspace shell
- made the calendar side rail and main canvas independently scrollable
- redesigned `Ready to Schedule` into denser utility cards instead of large airy boxes
- redesigned `Bottlenecks` into clearer pressure cards with score, active count, rework, and average age

### 9. Members / Roles / Invite Flow
Files:

- `src/org/components/InviteMemberPanel.jsx`
- `src/org/admin/MembersPage.jsx`
- `src/org/styles/OrgAdmin.css`

Changes:

- the invite panel now uses org role templates instead of a basic native select
- admins can assign the intended role template during invite creation
- the panel now shows:
  - selected role template
  - enabled access count
  - project scope summary
  - permission preview
- member and role admin surfaces now have better internal scroll behavior for long tables and long editing surfaces

## Schema Compatibility
This correction pass introduced no new migration and no new table or column change.

Important context:

- the repo already contains the earlier additive migration:
  - `supabase/migrations/20260325110000_org_calendar_view_presets_and_asset_links.sql`
- this pass treated that migration as existing baseline and did not change it

Existing schema-backed behavior remains intact:

- `posts`
- `pipeline_items`
- `organization_members`
- `org_asset_library`
- `org_calendar_view_presets`
- `org_post_asset_links`

## Existing Safe Backend Paths Preserved
These existing backend-safe paths remain authoritative:

- `org-calendar-publish`
  - pipeline-backed scheduling / publish flow
- `pipeline-advance`
  - review / revision actions
- `org-invite-member`
  - invite creation using the selected role template key

## How Bottlenecks Work

### Counted statuses
Only active review pressure is counted:

- `pending`
- `in_review`
- `revision_requested`

### Lane grouping
Each item is assigned to a bottleneck lane by:

1. `current_assignee_role`
2. `currentStageName`
3. `unassigned`

### Metrics
Each lane computes:

- `activeCount`
- `overdueCount`
- `revisionCount`
- `oldestItemAgeDays`
- `nearestSlaDeadline`
- `averageStageAgeHours`
- `reworkRatio`

### Pressure score
The displayed ranking is weighted, not raw count-based.

Pressure rises because of:

- overdue items
- revision loops / rework
- active count
- long average stage age
- long oldest-item age
- deadlines that are near or already missed

This means a smaller overdue lane can outrank a larger but healthier lane.

### Where it appears
The score is surfaced in:

- calendar side rail bottleneck cards
- approval tracker summary chips
- timeline summary chips
- org overview bottleneck sections

## Problems Encountered and Resolutions

### 1. Asset upload looked like CORS but was actually undeployed
Problem:

- the browser showed CORS/preflight failures
- the real issue was that the function endpoint returned `404 NOT_FOUND`

Resolution:

- confirmed the function was missing from the live project
- deployed `org-asset-upload`
- verified preflight now returns `200 OK`
- updated frontend errors so missing deployment is described accurately

### 2. Toolbar layout wasted too much space
Problem:

- the view and filter controls occupied too much vertical space
- week and timeline surfaces lost usable planning area

Resolution:

- collapsed the controls into a denser desktop rail
- moved filters behind a popover trigger
- compressed KPI card sizing

### 3. Timeline bars felt empty or broken
Problem:

- the earlier timeline renderer looked thin and visually weak
- overlapping content in the same lane did not have enough real lane structure

Resolution:

- rebuilt the timeline into stacked lane bars with a proper scroll frame and sticky rulers
- widened the range window and improved empty-range handling

### 4. Batch scheduling lacked useful editing depth
Problem:

- users could not control schedule date/time, caption, and hashtags item-by-item

Resolution:

- rebuilt the modal into a row editor with per-item schedule and copy control
- kept execution schema-safe by saving onto existing `posts` rows and existing safe schedule flows

## Verification
Completed:

- `npm run build`
- `supabase functions deploy org-asset-upload --project-ref ujkuwemwlhilzarbrozu`
- live preflight verification for `org-asset-upload` returning `200 OK`

Build result:

- passed
- remaining output was the existing Vite dynamic-import / chunk-size warnings

## Known Remaining Constraints

- this pass corrected the current timeline and made it materially stronger, but it is still content-native planning, not campaign/dependency PM software
- authenticated end-to-end upload should still be verified in-browser by QA after the function redeploy
- batch caption/hashtag optimization still depends on the existing text/image helper quality already present in the repo

## Files Touched In This Correction Pass

- `src/org/pages/OrgCalendar.jsx`
- `src/org/components/calendar/CalendarTimelineView.jsx`
- `src/org/components/calendar/CalendarBatchScheduleModal.jsx`
- `src/org/components/calendar/CalendarContentCard.jsx`
- `src/org/components/calendar/CalendarLibraryPicker.jsx`
- `src/org/components/OrgAssetUploadModal.jsx`
- `src/org/components/InviteMemberPanel.jsx`
- `src/org/admin/MembersPage.jsx`
- `src/org/services/orgCalendarService.js`
- `src/org/services/assetLibraryService.js`
- `src/styles/OrgWorkspace.css`
- `src/org/styles/OrgCalendar.css`
- `src/org/styles/OrgAdmin.css`
- `docs/org-calendar-implementation-report.md`
