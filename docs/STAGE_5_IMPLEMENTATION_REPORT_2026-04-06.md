# Stage 5 Implementation Report

## Metadata

| Field | Value |
| --- | --- |
| Stage | Stage 5 - Approval Workflow Integration |
| Date | April 6, 2026 |
| Fix Pack ID | `ST5-FIXPACK-20260406` |
| Status | Implemented + Build Verified |
| Build Check | `npm run build` passed |

## Stage 5 Scope Completed

Stage 5 implementation covered:
1. Role-based post-SEO approval gate in post-production flow.
2. Workflow selection and submit-for-approval action from post-production and office draft modal.
3. Pipeline tracker extension with workflow progress visibility and approval history context.
4. Rejection/resubmission path from Pipeline back into Stage 3B edit modal.

## Fix Register

| Fix ID | Fix Name | Status | Primary Area |
| --- | --- | --- | --- |
| `FIX-ST5-001` | Post-Production Role-Based Approval Gate | Done | Generate flow |
| `FIX-ST5-002` | Draft Preparation Action for Approval Submission | Done | Session store |
| `FIX-ST5-003` | Office Edit Modal Approval Panel + Resubmission | Done | My Office workflow |
| `FIX-ST5-004` | Pipeline Board Submitted/Review Lanes + Tracker Detail | Done | Pipeline UI |
| `FIX-ST5-005` | Pipeline Service Submission Hardening | Done | Service/data safety |
| `FIX-ST5-006` | Revise-and-Resubmit Deep Link into Edit Modal | Done | Cross-page workflow |

## Files Added

1. `docs/STAGE_5_README.md`
2. `docs/STAGE_5_IMPLEMENTATION_REPORT_2026-04-06.md`

## Files Modified

1. `src/stores/SessionStore.js`
2. `src/components/Generate/PostProductionPanel.jsx`
3. `src/styles/GenerateV2.css`
4. `src/org/components/OrgDraftWorkflowModal.jsx`
5. `src/org/styles/OrgDraftWorkflowModal.css`
6. `src/org/services/pipelineService.js`
7. `src/org/pages/PipelineBoard.jsx`
8. `src/org/styles/PipelineBoard.css`
9. `src/org/pages/MyOffice.jsx`

## Database Tables Involved

1. `public.posts`
2. `public.pipeline_configs`
3. `public.pipeline_items`
4. `public.organization_members`
5. `public.profiles`

## What changed, what to check, and UI expectations

### `FIX-ST5-001` Post-Production Role-Based Approval Gate

What changed:
- Org users now see approval gating in Step 3 after SEO.
- Restricted roles (`!can_publish` OR `publish_requires_final_approval`) can only submit for approval.
- Privileged roles can choose `Send for Approval` or `Publish Directly`.
- Approval workflow cards now load from org pipeline configs.

UI expectation:
- In org workspace only, Step 3 starts with an `Approval Route` panel.
- Restricted roles do not see direct-publish mode.

Pay attention to:
- Workflow list must load and allow exactly one selection.
- Submit button must stay disabled until workflow is selected.

### `FIX-ST5-002` Draft Preparation Action for Approval Submission

What changed:
- Added `preparePostForApproval()` in `SessionStore`.
- It upserts draft content (title/caption/hashtags/assets/account) without resetting panel state.
- This ensures a stable `post_id` exists before writing `pipeline_items`.

Flow fixed:
- Prevents approval submission from failing due to missing draft post row.

Pay attention to:
- `posts` row should remain `draft` before review submission.
- `postProduction.postId` must remain populated after prepare step.

### `FIX-ST5-003` Office Edit Modal Approval Panel + Resubmission

What changed:
- Added full `Approval Workflow` section inside `OrgDraftWorkflowModal` below SEO.
- Shows route options (role-dependent), workflow cards with assignee labels, status summary, rejection comment, approved stage history.
- Added actions:
  - `Submit for Approval`
  - `Resubmit for Approval` (for `revision_requested`/`rejected`)
  - `Confirm Direct Publish Route` (privileged only)

Flow fixed:
- Users can revise and resubmit from the same modal used for metadata/SEO edits.

Pay attention to:
- Resubmit path should create a new active approval run from stage 1.
- Rejection comments should be visible in modal when present.

### `FIX-ST5-004` Pipeline Board Submitted/Review Lanes + Tracker Detail

What changed:
- Added content lanes:
  - `All`
  - `Submitted`
  - `Needs My Review`
- Added richer card/drawer detail:
  - submitter name
  - workflow name
  - stage progress (`Stage X of Y`)
  - approved-stage history entries
  - latest revision/rejection comment block

Flow fixed:
- Members now have a clear “Submitted” visibility lane directly inside Pipeline.

Pay attention to:
- Lane filtering should not break deep-linked item selection.
- Reviewer actions remain role-guarded.

### `FIX-ST5-005` Pipeline Service Submission Hardening

What changed:
- `submitPostToPipeline` and `createDirectPublishPipelineItem` now resolve `brand_project_id` from payload fallback and fail fast if missing.
- Submission title now prefers `post.title` before fallback to caption/prompt.

Flow fixed:
- Reduces silent misrouting from missing brand-project context.

Pay attention to:
- Drafts must have valid `brand_project_id` in org context before submission.

### `FIX-ST5-006` Revise-and-Resubmit Deep Link into Edit Modal

What changed:
- `PipelineBoard` now exposes `Revise and Resubmit` for submitter-owned revision/rejected items.
- This deep-links to My Office with `draftId` query.
- `MyOffice` reads `draftId` and auto-opens Stage 3B edit modal for that draft.

Flow fixed:
- Removes manual navigation friction for rejected content loops.

Pay attention to:
- Query params should clear when modal closes.
- Wrong/expired `draftId` should not break page load.

## Status transition mapping used in implementation

The existing pipeline enum set was preserved:
- Review pending state: `in_review` (used in place of `pending_review`)
- Needs changes state: `revision_requested` (used in place of `needs_revision`)

No enum migration was introduced in this stage.

## Potential issues introduced by this implementation

1. Organizations with no active pipeline config cannot submit for approval until admin configures one.
2. If legacy org drafts are missing `brand_project_id`, submission now fails with explicit error (intentional hardening).
3. Direct-publish route logging is strongest in Office modal path; Stage 6 will complete unified direct-publish UX across all entry points.
4. Large workflow stage lists may increase modal visual density on small screens.

## QA checklist

1. Restricted role: SEO `Proceed` -> only approval selection visible.
2. Restricted role: select workflow -> submit -> item appears in Pipeline.
3. Privileged role: SEO `Proceed` -> approval/direct options visible.
4. Pipeline Board: `Submitted` lane only shows current user submissions.
5. Pipeline Board item drawer shows workflow/stage progress/approval history.
6. Reviewer can request revision with comment; submitter sees comment.
7. `Revise and Resubmit` opens My Office edit modal directly.
8. Resubmission from modal creates fresh in-review pipeline item.
9. Build remains green.

## Stage 5 execution outcome

Stage 5 is implementation-complete with role-based gating, approval submission, tracker visibility upgrades, and revision/resubmission routing.
