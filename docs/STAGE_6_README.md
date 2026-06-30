# Stage 6 - Direct Publish UX + Social Preview

## Summary
Stage 6 completes the missing publishing UX from Stage 5:

1. Added platform-specific social previews in Generate -> Post Production -> Publish step.
2. Completed direct-publish pipeline mirroring in Generate flow so direct route logging is no longer limited to My Office modal path.

This stage closes the Stage 5 follow-up around direct-publish consistency and adds pre-publish visual confidence for Instagram, TikTok, YouTube, and Facebook workflows.

## Files Added
- `docs/STAGE_6_README.md`
- `docs/STAGE_6_IMPLEMENTATION_REPORT_2026-04-08.md`

## Files Modified
- `src/components/Generate/PostProductionPanel.jsx`
- `src/styles/GenerateV2.css`

## Database Changes
- Migration: none in Stage 6.
- RLS changes: none in Stage 6.

## Database Tables Used
- `public.posts`
- `public.pipeline_items`
- `public.pipeline_configs`
- `public.connected_accounts`

## How to verify this stage is working

### Step 1 - Social preview cards render per selected platform
1. Open Generate -> Post Production -> Publish.
2. Select at least one connected account.
3. Select Instagram/TikTok/YouTube/Facebook accounts.

Expected:
- A new `Platform Preview` section appears.
- One preview card renders per selected account.
- YouTube preview shows title emphasis.
- TikTok preview uses tall media framing.
- Instagram/Facebook previews use square media framing.

### Step 2 - Preview content follows metadata/schedule choices
1. Edit title/caption/hashtags in prior steps.
2. Toggle `Post Now` vs `Schedule`.
3. Set a schedule datetime.

Expected:
- Preview copy updates from current title/caption/hashtags.
- Schedule chip text updates to scheduled timestamp or immediate publish.

### Step 3 - Direct publish route now mirrors into Pipeline from Generate flow
1. Use org role with direct publish permission.
2. In Publish step, choose `Publish Directly`.
3. Publish post.

Expected:
- Publish succeeds.
- Pipeline receives a direct-route item (`approved` path) when workflow config is available.
- `posts.workflow_state` is updated with direct-route metadata (`approval_route=direct` and linked pipeline item id).

### Step 4 - Missing workflow config fallback
1. Use org context with no active pipeline workflow config.
2. Choose direct publish and publish.

Expected:
- Publish still proceeds (non-blocking).
- User sees warning that pipeline mirror could not be logged due to missing workflow config.

## Known limitations / follow-up
- Direct-route mirroring currently targets the prepared primary draft row in Generate flow; multi-account fan-out rows still rely on existing post status lifecycle updates.
- Preview cards are platform-styled approximations, not exact replicas of live native app layouts.
