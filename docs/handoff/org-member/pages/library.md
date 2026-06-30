# Org Member Page: Asset Library

## Page Purpose (Plain Language)
This page is the shared media and document library for the organization. Members browse, organize, annotate, and reuse assets linked to pipeline, tasks, and scheduled content.

## Route and Access Rules
- Route: `/app/org/:orgId/library`
- Guard: `OrgMemberRoute`
- Permission-sensitive behavior:
  - `can_manage_library` required for create/update/archive/move/upload operations
  - `can_approve_library_uploads` or manager role required for approval actions

## Component Composition
- Container: `src/org/pages/OrgAssetLibrary.jsx`
- Key child domains:
  - smart collections and search
  - folder tree and folder management
  - asset grid with density modes
  - metadata/detail panel with provenance
  - upload/create-folder/move-asset modals
  - `OrgScheduleModal` for linked post/pipeline scheduling

## State, Hooks, Services Used
- `useOrgAssets` for assets/folders loading and refresh.
- `useOrgContext` for org/brand scope and permissions.
- `useAuth` for user identity.
- `assetLibraryService`:
  - folder CRUD (`create/update/delete`)
  - asset fetch/update
  - upload via edge function wrapper
  - post-asset linkage sync/read

## Data Contracts Touched
- Reads:
  - `org_asset_library`
  - `org_asset_folders`
  - `org_post_asset_links`
  - `posts`
  - `pipeline_items`
  - `org_tasks`
  - `profiles`
- Writes:
  - `org_asset_library`
  - `org_asset_folders`
- Edge:
  - `org-asset-upload`

## Inbound Dependencies
- Sidebar route entry.
- Calendar and common-room flows rely on this page as the canonical asset management surface.

## Outbound Dependencies
- Origin badges route to `/pipeline` and `/calendar?taskId=...`.
- Schedule action opens `OrgScheduleModal` when post/pipeline origin exists.
- Asset data is reused by calendar library picker and common-room asset references.

## Current Working Relationships
- Asset provenance enrichment links records back to pipeline/task context where available.
- Foldering and visibility controls are implemented with guardrails.
- Metadata editing, archive/restore, and brand-flagging are implemented.
- Upload flow uses dedicated edge endpoint with permission and folder checks.

## Missing or Partial Relationships
- Pipeline origin navigation often opens page-level pipeline route without focused item.
- No direct "attach to current draft/pipeline item" action from this page.
- Provenance can be empty even when user expects linkage, depending on sync behavior.

## No Relation Exists Yet
- No dedicated cross-entity lineage explorer combining asset history, revisions, and publish outcomes.
- No explicit relation from library detail into common-room thread where asset was discussed.

## Recommended Wiring Contract
- Add focused navigation payloads (`pipelineItemId`, `postId`, `taskId`) for all origin links.
- Add optional attach workflow:
  - select asset
  - target draft/post/pipeline item
  - write `org_post_asset_links` with explicit role
- Add provenance completeness checks and repair tools.

## Risks If Wired Incorrectly
- Incorrect linkage writes can associate assets with wrong posts or tasks.
- Weak permission boundaries can expose private-folder content to unauthorized members.

