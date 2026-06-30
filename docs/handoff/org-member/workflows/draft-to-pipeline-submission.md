# Workflow: Draft to Pipeline Submission

## Current Implemented Flow
1. Member generates or edits content (office/workspace composer).
2. Draft is stored as `posts` row with `status = 'draft'`.
3. Member submits draft from `/office`.
4. `submitPostToPipeline` resolves pipeline config, initial stage, and inserts `pipeline_items`.
5. Service updates `posts.pipeline_item_id` to connect draft to pipeline item.
6. Pipeline appears in `/pipeline` and `/calendar` queue/review views.

## Expected Target Flow
- Submission should include preflight validation and explicit downstream handoff context (task links, assets, destination readiness, client-review eligibility).

## Breakpoints and Gaps Between Current and Target
- No standardized pre-submit validation checklist in UI.
- Limited deep-link continuity from office submission into focused pipeline item state.
- Asset/task linkage is possible but not consistently part of submission flow.

## Required Integration Points to Close the Gap
- Add submission preflight contract:
  - required metadata checks
  - optional task linkage
  - account/publish policy awareness
- Add focused navigation payload to open submitted item directly in pipeline/calendar.
- Add optional attach-assets-at-submit step.

## Suggested Order of Implementation
1. Add pre-submit validation with clear fail reasons.
2. Add focused post-submit navigation contract.
3. Add optional task and asset linkage at submission time.

