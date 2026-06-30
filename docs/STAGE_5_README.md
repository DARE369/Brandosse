# Stage 5 - Approval Workflow Integration

## Summary
Stage 5 connects SEO completion to an approval gate before publishing in org workspace flows.  
Users now see role-based routing after SEO:
- restricted roles: approval workflow selection only
- privileged roles: send for approval or direct publish route

This stage also extends Pipeline UI visibility for submitted items, stage progress, and revision loops.

## Files Created
- `docs/STAGE_5_README.md` - Stage 5 execution summary and verification guide.
- `docs/STAGE_5_IMPLEMENTATION_REPORT_2026-04-06.md` - Detailed fix register and risk notes.

## Files Modified
- `src/stores/SessionStore.js` - added `preparePostForApproval()` to persist/update draft post without closing post-production panel.
- `src/components/Generate/PostProductionPanel.jsx` - added role-based approval gate, workflow fetch/selection, submit-for-approval action, and org-only direct-vs-approval routing.
- `src/styles/GenerateV2.css` - added approval-gate styles (route toggle, workflow cards, workflow stage pills).
- `src/org/components/OrgDraftWorkflowModal.jsx` - added full Stage 5 approval panel after SEO, workflow cards with stage assignees, pipeline status summary, rejection note visibility, submit/resubmit/direct route actions.
- `src/org/styles/OrgDraftWorkflowModal.css` - added styles for approval stack, workflow options, summary grid, rejection note, and approval history.
- `src/org/services/pipelineService.js` - strengthened submission payload resolution (`brand_project_id` fallback/validation), improved title source priority.
- `src/org/pages/PipelineBoard.jsx` - added `Submitted` and `Needs My Review` lanes, richer tracker cards, stage-progress details, approved-stage history, rejection note surface, and revise/resubmit deep-link action.
- `src/org/styles/PipelineBoard.css` - styles for new pipeline subtabs, media thumb rows, approval history block, revision note block, and resubmit area.
- `src/org/pages/MyOffice.jsx` - supports `draftId` query deep-link to auto-open Stage 3B edit modal for revise/resubmit workflow.

## Database Changes
- Migration: none in Stage 5.
- Tables used:
  - `public.pipeline_configs`
  - `public.pipeline_items`
  - `public.posts`
  - `public.organization_members`
  - `public.profiles`
- RLS policies changed: none in Stage 5.

## Status Transition Notes
- Existing pipeline status domain is preserved:
  - queued review uses `in_review` (equivalent of requested `pending_review`)
  - revision state uses `revision_requested` (equivalent of requested `needs_revision`)
- Approval metadata is written under `posts.workflow_state` (e.g., `approval_status`, `approval_route`, `approval_workflow_id`, `approval_pipeline_item_id`).

## How to verify this stage is working

### Step 1 - Restricted role gate after SEO
1. Log in as a contributor/reviewer in org workspace.
2. Open Generate -> Post Production -> SEO.
3. Run SEO score and click `Proceed`.
4. On Step 3, confirm only approval route is available (no direct publish option).
5. Select a workflow and click `Submit for Approval`.

### Expected result
- Success state shows `Submitted for approval`.
- New pipeline item appears in Pipeline Board.
- Item status is `In Review`.

### Step 2 - Privileged role gate after SEO
1. Log in as org admin/owner.
2. Repeat generate -> SEO -> Proceed.
3. Confirm route toggle appears:
   - `Send for Approval`
   - `Publish Directly`

### Expected result
- Both route options are visible for privileged roles.
- Approval route can be submitted with selected workflow.

### Step 3 - Workflow details and stage visibility
1. Go to Pipeline Board (content tab).
2. Open an item.
3. Confirm detail area shows:
   - submitter
   - workflow name
   - stage progress (`Stage X of Y`)
   - approved-stage history entries (when present)

### Expected result
- Tracker detail is complete and readable for review operations.

### Step 4 - Rejection and resubmission loop
1. As reviewer/admin, request revision or reject with comment.
2. As submitter, open Pipeline Board item.
3. Click `Revise and Resubmit`.

### Expected result
- User is routed to My Office with draft edit modal opened directly.
- After editing, user can resubmit from the modal approval panel.
- Resubmission creates a fresh review entry from stage 1.

## Known limitations or follow-up tasks
- Stage 6 publishing UI remains the next step for full direct-publish social preview workflow.
- Existing status values are reused (`in_review`, `revision_requested`) instead of introducing new enum values.
- For immediate direct publish from post-production, pipeline mirror records are currently stronger in My Office modal path than in the legacy publish button path.
