# Org Workspace Stage 2: Asset Folder System Implementation

Updated: 2026-03-27  
Stage status: implemented  
Validation status: `npm run build` passed

## What was implemented

### 1. Stage 2 schema slice and compatibility migration

Added:

- `supabase/migrations/20260327020000_org_asset_folders_stage2.sql`
- `supabase/migrations/20260327021000_org_permission_template_backfill.sql`
- `supabase/migrations/20260327022000_org_asset_folder_rls_recursion_fix.sql`

This migration adds:

- `org_asset_folders`
- `org_asset_library.folder_id`
- folder path normalization helpers
- asset-to-folder compatibility syncing (`folder_id` -> `folder_path`)
- backfill from legacy `org_asset_library.folder_path`
- system folder backfill for existing orgs
- RLS for folder visibility and private-folder enforcement
- updated asset-library RLS so assets inside private folders are not exposed to other members

The permission backfill migration adds:

- default `org_role_templates` rows for all organizations
- a database-side default permission resolver used by `get_member_permission(...)`
- a compatibility fix for older orgs where the UI could show library access but RLS still denied folder creation because the role template rows had never been seeded

The RLS recursion fix migration adds:

- a replacement folder read policy that evaluates against the row directly instead of re-querying `org_asset_folders` from inside the same table policy path
- `SECURITY DEFINER` folder-access helper functions so asset-library policies can validate folder access without depending on recursive folder reads

### 2. Org bootstrap support

Updated:

- `supabase/functions/_shared/org-bootstrap.ts`

Current bootstrap behavior:

- new orgs now get four root system folders automatically:
  - Brand Assets
  - Campaign Work
  - Published Content
  - Archived

This keeps Stage 2 working for both existing orgs and newly bootstrapped orgs.

### 3. Upload path and folder-aware service layer

Updated:

- `supabase/functions/org-asset-upload/index.ts`
- `src/org/services/assetLibraryService.js`
- `src/org/hooks/useOrgAssets.js`
- `src/org/utils/assetFolders.js`

Current behavior:

- uploads can target a concrete folder via `folder_id`
- the edge function validates private-folder access before inserting
- asset fetches now load folders, uploader profile context, and provenance hints
- the hook now returns both `assets` and `folders`
- legacy reads that still depend on `folder_path` remain compatible

### 4. Asset library UI integration

Added:

- `src/org/components/FolderTree.jsx`
- `src/org/components/FolderCreateModal.jsx`
- `src/org/components/MoveAssetModal.jsx`

Updated:

- `src/org/pages/OrgAssetLibrary.jsx`
- `src/org/components/OrgAssetUploadModal.jsx`
- `src/org/styles/AssetLibrary.css`

Current UI behavior:

- the static folder list is replaced by a real folder tree
- members can select a folder and scope the grid to that folder
- managers can create folders and subfolders
- subfolders inherit the parent folder scope instead of forcing the active brand project id
- managers can change folder color, toggle team/private visibility, and delete non-system empty folders
- managers can move assets to another folder from the grid and the detail panel
- the upload modal now lets the user choose the destination folder
- the right-side detail panel now shows:
  - uploader identity
  - clickable folder breadcrumb
  - pipeline reference badge when linked data exists
  - task reference badge when linked data exists

## What was intentionally left out

These items were not completed in this Stage 2 pass:

1. **Folder rename**
   - the current folder tree supports create, color, visibility, and delete
   - rename was not added yet

2. **Folder move / re-parent**
   - subfolder creation is implemented
   - moving an existing folder to a different parent was not added yet

3. **Exact spec menu shape**
   - the stage spec described a three-dot overflow menu
   - this implementation uses direct hover actions instead of a dedicated overflow menu component

4. **Pipeline item deep-link**
   - the provenance badge routes to the pipeline workspace
   - it does not yet open a specific pipeline item detail state

5. **Task provenance writer**
   - the detail panel can render task provenance when the data exists
   - Stage 4 still owns the task system and the primary task-link write path

## How the system works now

### Folder model

- `folder_id` is now the canonical asset-folder relation
- `folder_path` is still populated for compatibility with older readers
- root system folders are org-level and created automatically

### Visibility model

- team folders are visible to org members with normal library access
- private folders are visible to their creator and org admins/owners
- the updated asset read policy prevents assets inside private folders from leaking to other members
- folder creation now depends on DB-backed role-template permissions, not only frontend defaults, so older orgs must apply the permission backfill migration before Stage 2 folder creation works reliably
- folder fetches no longer recurse through `org_asset_folders` RLS, which was previously causing `stack depth limit exceeded` errors in PostgREST

### Asset organization flow

- uploads can be placed directly into a folder
- existing assets can be reassigned to a different folder
- the library detail panel always shows the resolved folder breadcrumb

### Provenance flow

- uploader profile information is hydrated from `profiles`
- pipeline provenance is derived from linked post/pipeline relationships when present
- task provenance is rendered from linked data when available and will become more complete in Stage 4

## Stage 2 deviations from the original staged spec

These were deliberate and align with the repo’s current structure:

1. **Compatibility-first delivery**
   - the original spec expected Stage 0 to exist first
   - this repo is being delivered stage-by-stage, so Stage 2 ships its own schema slice and backfill logic

2. **Shared hook/service expansion**
   - the staged spec only called out the page and service files
   - the current repo structure works better with a hook + utility layer, so those were added

3. **Folder action surface**
   - the spec described an overflow menu
   - the current implementation keeps the actions visible on hover to reduce UI complexity in this pass

## Validation completed

Executed:

```bash
npm run build
```

Result:

- success
- Stage 2 assets, folder components, migration references, and upload flow integrate without build errors

## Next-stage dependency note

Stage 3 can now consume real folder-aware asset context. Stage 4 can attach tasks to assets without introducing a second folder model.
