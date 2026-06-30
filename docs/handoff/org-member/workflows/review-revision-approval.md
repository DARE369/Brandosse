# Workflow: Review, Revision, Approval

## Current Implemented Flow
1. Submitted content enters pipeline and appears in pipeline/calendar views.
2. Review actions are executed via pipeline action contracts (primarily from calendar modal and services).
3. Revision requests return item to `revision_requested`; member picks it up from workspace action cards and composer.
4. Approved items enter scheduling-ready queue and can be scheduled/published from calendar.

## Expected Target Flow
- Review lifecycle should be fully operable from dedicated pipeline detail surfaces, with complete traceability and clear action ownership.

## Breakpoints and Gaps Between Current and Target
- `/pipeline` is mostly read-only and does not expose full action controls.
- Review context and actor rationale are not consistently visible across pages.
- Client-review link generation is not clearly surfaced in member route pages.

## Required Integration Points to Close the Gap
- Add item detail drawer in pipeline page with stage actions and history.
- Add unified revision rationale contract consumed by workspace, office, and pipeline.
- Add client-review-link generation action where stage allows it.

## Suggested Order of Implementation
1. Add pipeline detail/action surface with strict permission and stage checks.
2. Normalize revision-comment display across workspace/office/pipeline.
3. Add client-review link generation and lifecycle status in review UI.

