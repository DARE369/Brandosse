# Phase 1: My Office UI Refresh

## Goal
Refresh `My Office` into the new editorial layout, fix the broken draft submission path, add a real draft delete flow, and make brand scoping accurate at the page level without changing the shared org shell.

## What Changed
- Rebuilt `My Office` into a page-scoped layout with:
  - a hero bar with `Generate Content` and `Submit Draft`
  - a stacked draft rail with selected-draft state
  - a richer pipeline rail with stage label, assignee/reviewer copy, and status pill
- Added a page-scoped stylesheet in `src/org/styles/MyOffice.css` using:
  - charcoal surfaces
  - amber accent treatment
  - `Syne` for headings
  - `DM Sans` for body copy
- Added selected-draft behavior:
  - first draft auto-selects after load
  - selection updates on click
  - hero submit uses the selected draft
- Added real inline draft actions:
  - `Edit` opens `OrgGenerateComposer` in edit mode
  - `Submit` submits that draft
  - `Delete` deletes that draft after confirmation
- Added a page-local brand filter shared by both rails:
  - defaults to the active brand when one exists
  - supports `All brands`
  - does not mutate org context
- Replaced the misleading pipeline preview logic with a real "my submitted pipeline items" list.

## Data / Service Changes
- Updated `fetchOrgDrafts({ organizationId, userId, brandProjectId = null })` to:
  - accept an optional brand filter
  - return `brand_project_id`
  - return `platform`
  - return `updated_at`
- Added `deleteOrgDraft(postId)` in `src/org/services/orgService.js`.
- Fixed draft submission in `src/org/pages/MyOffice.jsx` to use:
  - `draft.brand_project_id`
  - fallback `draft.generations?.brand_project_id`
  - fallback `null`
- Updated `usePipelineItems(options)` to accept `brandProjectIdOverride`.
- Enriched `fetchPipelineItems()` rows with:
  - `currentStage`
  - `currentStageName`
- Loaded organization members into `My Office` so assignee names can resolve from `current_assignee_user_id` before falling back to role or status.
- Loaded `Syne` and `DM Sans` in `index.html`.

## UI States Covered
- Hero with no selected draft
- Hero with selected draft
- Draft rail loading
- Draft rail empty
- Draft rail with selected draft
- Draft inline submit in progress
- Draft inline delete in progress
- Pipeline rail empty
- Pipeline rail with user-submitted items
- Shared brand filter for:
  - active brand
  - another brand
  - all brands

## Verification
- `npm run build` passed on `2026-03-25`.
- Verified in code that `MyOffice.jsx` no longer references an undefined `brandProjectId` variable in the submit handler.
- Verified in code that the pipeline preview no longer uses the old org-wide `slice(0, 8)` behavior as its source of truth; it now filters by `submitted_by === user.id`.

## Left Out
- No direct asset-library browse CTA was added to `My Office` in this phase.
- No per-draft rename or metadata editing flow was added outside the composer.
- No pipeline-item deep link was added; pipeline cards still navigate to the main pipeline board.
- No calendar, Common Room, or asset-library behavior was changed in this phase.

## Known Risks
- Draft deletion depends on the existing post ownership policies remaining available for deletes in org-scoped drafts.
- The page-local brand filter intentionally does not change global org context, so other pages keep using the workspace-level active brand.
- Assignee names only resolve when `current_assignee_user_id` is populated and the member exists in the current organization member list.

## Theme Alignment Note
- On `2026-03-26`, the final page styling was realigned to the default org dashboard dark theme.
- The stronger Phase 1 layout and interactions stayed in place, but the final visual system now uses org workspace tokens and typography:
  - `var(--org-*)` color tokens
  - `var(--font-display)` / `Sora` for headings
  - `var(--font-body)` / `Manrope` for body copy
- `Syne` and `DM Sans` remain loaded in `index.html` for non-org surfaces, but they are no longer the final typography for `My Office`.
