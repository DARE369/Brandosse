# Org Member Page: Team Activity

## Page Purpose (Plain Language)
This page is intended to show recent team movement, but it currently acts as a lightweight pipeline status feed.

## Route and Access Rules
- Route: `/app/org/:orgId/team-activity`
- Guard: `OrgMemberRoute`
- Navigation availability currently comes from sidebar role logic (`org_owner`, `org_admin`, `editor`).

## Component Composition
- Container: `src/org/pages/TeamActivity.jsx`
- Key child domains:
  - page header
  - recent pipeline-item cards
  - loading/empty states

## State, Hooks, Services Used
- `usePipelineItems` only.

## Data Contracts Touched
- Reads:
  - `pipeline_items`
- Writes:
  - none
- Realtime:
  - via `usePipelineItems` subscription to `pipeline_items`

## Inbound Dependencies
- Sidebar `Team Activity` link for eligible roles.

## Outbound Dependencies
- None beyond passive display.

## Current Working Relationships
- It reflects pipeline status updates in near-realtime.
- It provides a quick textual summary of recent updates.

## Missing or Partial Relationships
- No integration with tasks, calendar publishes/schedules, notifications, or common-room activity.
- No deep links from entries into focused pipeline/task/calendar context.

## No Relation Exists Yet
- No relation to audit log events.
- No relation to cross-domain operational timeline data.

## Recommended Wiring Contract
- Replace single-source pipeline feed with aggregated activity contract across:
  - `pipeline_items`
  - `org_tasks`
  - publish/schedule events
  - `common_room_messages`
  - `user_notifications` (where relevant)
- Add per-entry deep-link target schema.

## Risks If Wired Incorrectly
- Members may assume this page is complete activity coverage and miss important operational events.

