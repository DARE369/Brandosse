# Page: `/app/library`

## Page Purpose (Plain Language)
This page is the personal content inventory. It combines posts, media assets, templates, and pillar groupings so users can reuse and manage content.

## Route and Access Rules
- Route: `/app/library`
- Access: authenticated user under protected app shell.

## Component Composition
- `src/pages/LibraryPage/LibraryPageV2.jsx`
- Shared shell: `UserNavbar`, `UserSidebar`
- Embedded modals:
  - Upload modal
  - `ScheduleModal` for post scheduling.

## State, Hooks, Services
- Primary store: `LibraryStore` (`src/stores/LibraryStore.js`)
- Local state for section/type/platform/status/search filters and view mode.
- Uses route state for section preselection.

## Data Contracts Touched
- Tables:
  - `posts`
  - `media_assets`
  - `content_templates`
  - `content_pillars`
  - `content_library_items`
- Storage:
  - `generated_assets` bucket (media upload path)
- Realtime/event sync:
  - listens to `socialai:data-sync` browser event.
- RPC/edge functions: none directly from this page.

## Inbound Dependencies
- Generate and calendar pages create/update `posts` and generation links shown in library.
- Generation lifecycle ensures `content_library_items` for post rows.

## Outbound Dependencies
- Library actions navigate to generate:
  - template usage (`templateId`)
  - edit/repurpose (`editPostId`, `repurposeFromPostId`)
- Scheduling actions update post lifecycle for calendar/dashboard.

## Current Working Relationships
- Unified listing model for posts/media/templates.
- Upload flow can create media asset and optional draft post in one action.
- Duplicate/retry/move-to-draft actions are status-aware.

## Missing or Partial Relationships
- Media action `Use in Post` navigates to generate with no media identifier payload.
- Optional tables are handled as missing-safe in store, which can hide migration drift in non-obvious ways.

## No Relation Exists Yet
- No direct relation from media cards to a generation prefill contract that consumes selected media.

## Recommended Wiring Contract
- Add explicit media handoff state:
  - `useMediaAssetId`
  - source route metadata.
- Generate page should resolve media and hydrate edit/reference mode.

## Risks if Wired Incorrectly
- Missing ownership checks could allow cross-user media injection.
- Incomplete handoff implementation can create silent "action appears to work but no effect" UX.
