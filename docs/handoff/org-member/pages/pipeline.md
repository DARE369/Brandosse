# Org Member Page: Pipeline Board

## Page Purpose (Plain Language)
This page shows where submitted content currently sits in the review pipeline, grouped by stage status.

## Route and Access Rules
- Route: `/app/org/:orgId/pipeline`
- Guard: `OrgMemberRoute`

## Component Composition
- Container: `src/org/pages/PipelineBoard.jsx`
- Key child domains:
  - fixed status columns (`pending`, `in_review`, `revision_requested`, `approved`, `rejected`, `withdrawn`)
  - card list per status
  - optional focused-card scroll using route state (`pipelineItemId`)

## State, Hooks, Services Used
- `usePipelineItems` for loading and realtime updates.
- `useOrgContext` for org id and route construction.
- Router location state for focus behavior.

## Data Contracts Touched
- Reads:
  - `pipeline_items`
  - `posts`
  - `generations`
  - `pipeline_configs` (for stage-name enrichment in service layer)
  - `org_post_asset_links` (attached assets loaded by service)
- Writes:
  - none in this page

## Inbound Dependencies
- Office, workspace, calendar, and notification flows route here.
- Some callers pass focused state (`pipelineItemId`) while others do not.

## Outbound Dependencies
- Empty-state action routes to `/office`.
- Current "View" action routes to the same pipeline route (no detail route).

## Current Working Relationships
- Realtime updates reflect stage movement without manual refresh.
- Focused scroll works when `location.state.pipelineItemId` is provided.
- Board gives quick queue distribution by status.

## Missing or Partial Relationships
- No stage-action controls in this page for approve/revision/schedule transitions.
- "View" action does not open item detail and does not enrich context.
- Cross-page links frequently arrive without focus state.

## No Relation Exists Yet
- No direct relation from this page to client-review link generation.
- No direct relation from pipeline card to task drawer or schedule modal.

## Recommended Wiring Contract
- Add pipeline detail panel/drawer with action controls and metadata.
- Enforce deep-link payload consumption (`pipelineItemId`) from all upstream callers.
- Add direct handoff actions to calendar scheduling and linked-task management.

## Risks If Wired Incorrectly
- Action controls without strict role/stage checks can bypass review governance.
- Partial deep-link adoption will keep navigation behavior inconsistent.

