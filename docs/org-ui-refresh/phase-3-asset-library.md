# Phase 3: Asset Library Refresh and Org Theme Harmonization

## Goal
Refresh `Shared Asset Library` into a stronger operational workspace, align asset-library permissions with the org permission model, and bring `My Office`, `Common Room`, and `Asset Library` onto the default org dashboard dark theme.

## What Changed
- Reworked `Shared Asset Library` into a stronger three-zone workflow:
  - left rail for search, collections, folders, and workspace scope
  - center browse grid with denser asset-card states
  - right detail panel for preview, metadata editing, status, and actions
- Made the upload entry point permission-aware:
  - users with `can_manage_library` still get the primary `Upload` CTA
  - users without that permission now get a visible note instead of a dead-end upload modal path
- Added inline metadata editing for:
  - `name`
  - `description`
  - `tags`
  - `folder_path`
- Added first-class detail-panel actions for:
  - `Approve`
  - `Reject`
  - `Download`
  - `Mark Brand Asset` / `Remove Brand Flag`
  - `Archive Asset` / `Restore Asset`
- Improved asset preview states:
  - image assets render image previews
  - video assets render a safe preview in the detail panel and a typed fallback in cards
  - document/template/non-image assets render typed placeholder panels with metadata instead of broken image assumptions
- Added stable selection behavior across refreshes and filter changes:
  - the current asset stays selected if it is still visible
  - otherwise the first visible asset becomes selected
- Cleaned up visible copy issues in the asset page, including replacing mojibake separators with plain ASCII formatting.
- Rethemed `My Office` and `Common Room` to the default org dashboard dark system while keeping their Phase 1 and Phase 2 layouts and workflows intact.

## Data / Service / Migration Changes
- Added `supabase/migrations/20260326110000_org_asset_library_permission_alignment.sql`.
  It:
  - drops the older loose insert/update policies for `org_asset_library`
  - replaces them with permission-aligned policies using `public.get_member_permission(organization_id, 'can_manage_library')`
- Kept the existing asset-library client surface intact:
  - `fetchOrgAssets({ organizationId, brandProjectId, includeArchived })`
  - `updateOrgAsset(assetId, updates)`
  - `uploadOrgAsset(...)`
- Kept moderation and metadata updates on the existing `updateOrgAsset(...)` path.
  No new edge function was added in this phase.

## UI States Covered
- library loading state
- no-results empty state
- permission-aware upload entry state
- selected asset with image preview
- selected asset with video preview
- selected asset with document/template fallback preview
- metadata edit dirty state
- metadata save/cancel state
- pending asset approval state
- rejected asset state
- archived asset state
- brand-asset toggle state
- stable selection after filter changes and refreshes
- org-themed final styling for:
  - `My Office`
  - `Common Room`
  - `Shared Asset Library`

## Verification
- `npm run build` passed on `2026-03-26`.
- Verified in code that:
  - `Shared Asset Library` no longer exposes the upload modal entry point to users without `can_manage_library`
  - metadata editing now persists through `updateOrgAsset(...)`
  - `My Office` and `Common Room` no longer use `Syne` / `DM Sans` in their org page styles
- I did not run browser-based manual QA in this pass.
  Asset action flows, preview rendering, and the cross-page visual alignment still need click-through verification in a migrated environment.

## Left Out
- No new asset moderation edge function was added.
- No version-management UI was added for `versions` / `current_version`.
- No permanent delete flow was added.
- No pagination or virtualization was added for large asset libraries.
- No additional feature expansion was added to `My Office` or `Common Room` beyond theme harmonization.
- The large org-workspace reference doc was not rewritten in this phase.

## Known Risks
- The final approval and metadata-update flows now depend on the new RLS alignment migration being applied before production behavior matches the page permissions.
- The UI still allows approval controls for `can_approve_library_uploads || can_manage_library`, while RLS is now aligned to `can_manage_library`.
  This assumes production role templates do not grant approval without management rights.
- `Download` relies on the stored asset URL being directly accessible from the browser session.
- Video preview behavior depends on the browser being able to stream the underlying storage URL.
