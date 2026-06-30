# Stage 6 Implementation Report

## Metadata

| Field | Value |
| --- | --- |
| Stage | Stage 6 - Direct Publish UX + Social Preview |
| Date | April 8, 2026 |
| Fix Pack ID | `ST6-FIXPACK-20260408` |
| Status | Implemented + Build Verified |
| Build Check | `npm run build` passed |

## Stage 6 Scope Completed

Stage 6 implementation covered:

1. Platform preview surface added to Post Production publish step.
2. Direct publish route from Generate flow now mirrors into Pipeline like My Office path.
3. Workflow-state writeback for direct publish route in Generate flow.

## Fix Register

| Fix ID | Fix Name | Status | Primary Area |
| --- | --- | --- | --- |
| `FIX-ST6-001` | Platform-Specific Social Preview in Publish Step | Done | Generate UI |
| `FIX-ST6-002` | Direct Publish Pipeline Mirror (Generate Flow) | Done | Approval/Pipeline integration |
| `FIX-ST6-003` | Direct Publish Workflow-State Writeback | Done | Data lifecycle consistency |

## Files Added

1. `docs/STAGE_6_README.md`
2. `docs/STAGE_6_IMPLEMENTATION_REPORT_2026-04-08.md`

## Files Modified

1. `src/components/Generate/PostProductionPanel.jsx`
2. `src/styles/GenerateV2.css`

## Database Tables Involved

1. `public.posts`
2. `public.pipeline_items`
3. `public.pipeline_configs`
4. `public.connected_accounts`

## What changed, what to check, and UI expectations

### `FIX-ST6-001` Platform-Specific Social Preview in Publish Step

What changed:
- Added a new `Platform Preview` section in Publish step (Step 3).
- Renders one preview card per selected connected account.
- Preview cards now adapt by platform:
  - TikTok: portrait-style media ratio
  - YouTube: title-forward preview with widescreen media
  - Instagram/Facebook: square media framing
- Preview body uses live post-production state (title, caption, hashtags, schedule mode).

Flow fixed:
- Users can validate platform presentation before publishing/scheduling instead of guessing final appearance.

What to pay attention to in UI:
- No preview should render until at least one platform is selected.
- Preview text should update as caption/title/hashtags change.
- Schedule label in preview should switch between immediate and scheduled timestamp.

### `FIX-ST6-002` Direct Publish Pipeline Mirror (Generate Flow)

What changed:
- In Post Production direct route, Generate flow now prepares draft context and attempts `createDirectPublishPipelineItem(...)` before publish call.
- This aligns Generate direct-route behavior with previously stronger My Office modal path.
- Pipeline sync event dispatch added for direct-route submissions from Generate path.

Flow fixed:
- Direct publish from Generate is now visible in Pipeline tracking when workflow config exists.

What to pay attention to:
- Direct publish should produce an `approved` pipeline item when configs are available.
- Missing workflow config should not hard-block publish; it now surfaces a warning.

### `FIX-ST6-003` Direct Publish Workflow-State Writeback

What changed:
- Generate direct route now writes `posts.workflow_state` keys:
  - `approval_status: approved`
  - `approval_submitted_at`
  - `approval_route: direct`
  - `approval_workflow_id`
  - `approval_pipeline_item_id`

Flow fixed:
- Approval metadata remains coherent across direct and approval routes from both entry points.

What to pay attention to:
- Post row linked to prepared draft should contain direct-route metadata after publish.

## Potential issues introduced by implementation

1. If an org has no active workflow config, direct publish still proceeds but pipeline mirror cannot be created (intentional non-blocking fallback).
2. Multi-platform publish still mirrors the prepared primary draft row for workflow metadata; fan-out rows keep standard status transitions.
3. Preview cards are intentionally approximation UIs and may differ from exact native-app rendering edge cases.

## QA Checklist

1. Open Publish step and confirm `Platform Preview` section appears.
2. Select Instagram/TikTok/YouTube/Facebook accounts and confirm per-platform card differences.
3. Update caption/hashtags/title and confirm previews update immediately.
4. Toggle `Post Now` / `Schedule` and confirm preview schedule meta updates.
5. In org direct-publish route, publish and confirm pipeline item gets created when config exists.
6. Verify post workflow state contains direct-route approval fields.
7. Remove/disable pipeline configs and confirm publish still works with warning.
8. Confirm build remains green.

## Stage 6 execution outcome

Stage 6 is implementation-complete for direct publish UX closure in Generate flow and pre-publish platform preview coverage.
