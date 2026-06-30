# Org Member Page: My Office

## Page Purpose (Plain Language)
This page is the draft workbench for members. It is where generated drafts are reviewed, edited, deleted, and submitted into the organization pipeline for review.

## Route and Access Rules
- Route: `/app/org/:orgId/office`
- Guard: `OrgMemberRoute`

## Component Composition
- Container: `src/org/pages/MyOffice.jsx`
- Key child domains:
  - draft list with brand filtering
  - selected-draft detail and actions
  - recent personal pipeline items summary
  - `OrgGenerateComposer`

## State, Hooks, Services Used
- `useOrgContext` for org and active brand project.
- `useAuth` for user id.
- `usePipelineItems` for recent pipeline state and realtime refresh.
- `orgService`:
  - `fetchOrgDrafts`
  - `deleteOrgDraft`
  - `fetchOrganizationMembers`
- `pipelineService`:
  - `submitPostToPipeline`

## Data Contracts Touched
- Reads:
  - `posts` (draft rows scoped to member/org)
  - `generations`
  - `pipeline_items`
  - `pipeline_configs`
  - `organization_members`
  - `profiles`
- Writes:
  - `posts` (draft delete)
  - `pipeline_items` (submission insert)
  - `posts.pipeline_item_id` linkage update

## Inbound Dependencies
- Entry from sidebar and workspace actions (`Open My Office`, `My Drafts` cards).
- Draft generation flow from `OrgGenerateComposer`.

## Outbound Dependencies
- Submission to pipeline affects `/pipeline` and `/calendar` workloads.
- Navigation to `/pipeline` for status follow-up.
- Edit action routes back into generation composer revision/edit modes.

## Current Working Relationships
- Drafts load by member and org scope and are brand-filterable for agency contexts.
- Submission creates pipeline item and removes draft from office list.
- Recent pipeline list shows assignee/status context for submitted items.
- Deletion is protected by confirmation and draft-only query constraints.

## Missing or Partial Relationships
- Pipeline item links route to `/pipeline` root without focused item state.
- No pre-submit checklist for missing brand/asset/task metadata before pipeline submission.
- No direct conversion from draft to task assignment before submission.

## No Relation Exists Yet
- No relation from this page into client-review link generation lifecycle.
- No relation from draft cards into linked-asset selection workflow before submission.

## Recommended Wiring Contract
- Pass `pipelineItemId` route state on "View All" and pipeline item clicks.
- Add pre-submit contract checks (destination account readiness, required metadata, optional task linkage).
- Add optional "Submit with task" flow that creates or links `org_tasks`.

## Risks If Wired Incorrectly
- Submitting incomplete drafts can create revision churn and SLA pressure downstream.
- Weak pipeline deep-linking slows review handoffs and increases context loss.

