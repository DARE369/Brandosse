# Org Member Page: Client Review

## Page Purpose (Plain Language)
This public page lets external reviewers approve content or request revisions using a tokenized review link.

## Route and Access Rules
- Route: `/review/:clientReviewToken`
- Guard: Public route (token-based access)
- Access behavior:
  - token validated by backend on load
  - completed/used tokens return completed state
  - preview, approve, and request-revision actions are supported

## Component Composition
- Container: `src/pages/ClientReview/ClientReviewPage.jsx`
- Key child domains:
  - preview media/caption card
  - action panel (`Approve`, `Request Changes`)
  - optional feedback textarea
  - completed/error/loading states

## State, Hooks, Services Used
- Route param token from `useParams`.
- `pipelineService`:
  - `fetchClientReviewPreview`
  - `submitClientReviewAction`
- Page-local completion and feedback state.

## Data Contracts Touched
- Reads:
  - pipeline review context via token (`pipeline_items`, `posts`, `generations`)
- Writes:
  - pipeline action and token usage (`pipeline_items`)
- Edge:
  - `pipeline-client-action`

## Inbound Dependencies
- Client link generation flow from internal review process (`pipeline-generate-client-link` backend).

## Outbound Dependencies
- Approve/revision result feeds back into org pipeline status and member review workload.

## Current Working Relationships
- Token preview and action calls are wired and functional.
- Completed-token behavior is handled in both preview and post-action states.
- Optional comment is passed during revision/approval action.

## Missing or Partial Relationships
- No visible entry point in Stage 4 route pages to generate this link despite backend support.
- Limited reviewer context (no explicit stage metadata, due date, or brand instructions).
- Minimal anti-misclick UX (no second confirmation or undo).

## No Relation Exists Yet
- No relation to a branded client portal context by organization or brand project.
- No relation to post-review threaded discussion or structured reviewer identity capture.

## Recommended Wiring Contract
- Add internal UI action to generate/revoke client review links at valid pipeline stages.
- Expand review payload with optional context fields (brand/project/title/stage deadline).
- Add explicit post-action webhook/event hook to notify internal members.

## Risks If Wired Incorrectly
- Exposing link generation without strict stage/role checks can bypass governance.
- Token lifecycle mistakes can allow duplicate or stale external approvals.

