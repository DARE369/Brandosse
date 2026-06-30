# Stage 9 - Org Global Search Activation

## Summary
Stage 9 implements a real global search experience in the org workspace so users can quickly find pipeline items, tasks, drafts, calendar posts, and assets from the top navbar.

This stage includes:

1. Live org search UI in the top navbar (debounced edge-function search).
2. Grouped search result rendering with fast one-click navigation.
3. Keyboard-first flow (`Ctrl/Cmd+K`, Enter to open first result, Escape to close).
4. Deep-link landing support for calendar post and asset result types.
5. Search payload expansion in `org-global-search` to carry deeper navigation fields.

## Files Added
- `docs/STAGE_9_README.md`
- `docs/STAGE_9_IMPLEMENTATION_REPORT_2026-04-08.md`

## Files Modified
- `src/org/components/OrgTopNavbar.jsx`
- `src/styles/OrgWorkspace.css`
- `src/org/pages/OrgCalendar.jsx`
- `src/org/pages/OrgAssetLibrary.jsx`
- `supabase/functions/org-global-search/index.ts`

## Database Changes
- Migration: none in Stage 9.
- RLS changes: none in Stage 9.

## Tables Used
- `public.pipeline_items`
- `public.org_tasks`
- `public.posts`
- `public.org_asset_library`
- `public.organization_members` (membership checks via org helper guards)

## How to verify this stage is working

### Step 1 - Open global search quickly
1. Open any org workspace route.
2. Press `Ctrl+K` (or `Cmd+K` on Mac).

Expected:
- Search input receives focus.
- Search menu opens.

### Step 2 - Run grouped search
1. Type at least 2 characters.
2. Use terms that match tasks, pipeline item titles, draft captions, or asset names.

Expected:
- Results appear grouped as `Pipeline`, `Tasks`, `Drafts`, `Calendar`, `Assets`.
- Loading/empty/error states render clearly.

### Step 3 - Navigate directly from results
1. Click one result from each group.

Expected:
- Pipeline result opens pipeline board with target item context.
- Task result opens `Pipeline > Tasks` with `taskId`.
- Draft result opens office with `draftId`.
- Calendar result opens calendar with `postId` focus support.
- Asset result opens library with search + selected asset.

### Step 4 - Keyboard submit behavior
1. Type a query with results.
2. Press Enter.

Expected:
- First result opens immediately.

## Known limitations / follow-up
- Search currently returns up to 8 results per group.
- Query threshold is 2+ characters to reduce noisy requests.
- Ranking is recency-first within each group, not semantic relevance scoring.
