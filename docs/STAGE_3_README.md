# Stage 3 - Post-Production System Overhaul

## Summary
Stage 3 implemented two connected workflow upgrades:

1. Post-production metadata lifecycle in the Generate panel now treats title/caption/hashtags as first-class fields with inline loading and per-field regeneration.
2. Office draft editing now happens in-place via a slide-over modal (no page redirect), with prompt editing, media preview, metadata editing, regeneration actions, and safe close behavior.

## Stage 3 Components and Architecture

### New/Updated UI Components
- `src/components/Generate/PostProductionPanel.jsx`
  - Added title field (`Title (required for YouTube)`).
  - Added metadata loading indicator and skeleton states.
  - Added per-field metadata regenerate actions:
    - title
    - caption
    - hashtags
  - Added YouTube title validation guard before publish.

- `src/org/components/OrgDraftWorkflowModal.jsx` (new Stage 3 version)
  - Slide-over editor with two-panel layout:
    - Left: prompt, regenerate media trigger, media preview.
    - Right: title/caption/hashtags + per-field regenerate + schedule/platform summary + save.
  - Save-in-place behavior (no navigation away).
  - Unsaved-close guard (`Discard unsaved changes?`).

- `src/org/pages/MyOffice.jsx`
  - Edit button now opens `OrgDraftWorkflowModal` in-place.
  - Existing generator composer remains for explicit regenerate flows.

### Styles
- `src/styles/GenerateV2.css`
  - Added metadata inline loading chip and skeleton animation styles.
  - Added title input and metadata hint styles.

- `src/org/styles/OrgDraftWorkflowModal.css` (new)
  - Added slide-over modal, two-column layout, responsive behavior, metadata/status card styling.

## State Management Approach

### Session Store Integration
- File: `src/stores/SessionStore.js`
- `postProduction` state now includes:
  - `postId`
  - `title`
  - `metadataStatus`
  - `metadataUpdatedAt`

- New action:
  - `regeneratePostMetadata(fields)` for targeted metadata refresh.

- Existing hydration flow (`hydratePostProductionFromGeneration`) now also hydrates:
  - title
  - metadata status fields
  - post id for downstream updates

- Draft persistence (`saveDraft`, `publishContent`) now writes:
  - `posts.title`
  - `posts.hashtags`
  - plus existing caption/status/account/schedule fields

## Metadata Generation Integration File
- Edge function: `supabase/functions/generate-post-metadata/index.ts`
- Invocation points:
  - Auto metadata generation from `SessionStore` draft creation path.
  - Field-level regenerate actions from Post-production panel and Office edit modal.

## Content Metadata Schema Mapping

Stage 3 uses the existing `posts` row + JSON state fields instead of creating a separate `content_metadata` table:

- `title` -> `posts.title`
- `caption` -> `posts.caption`
- `hashtags` -> `posts.hashtags`
- `generated_at` -> `posts.workflow_state.metadata_generated_at`
- `metadata status` -> `posts.workflow_state.metadata_status`
- `metadata provider/model` -> `posts.workflow_state.metadata_provider` / `metadata_model`

## Database Tables Used in Stage 3
- `public.posts`
- `public.generations`
- `public.connected_accounts` (platform selection + YouTube title requirement check context)

## Verification Steps (Browser)

1. Generate a new post and open Post Production.
- Expected:
  - Title field appears above caption.
  - Metadata loading indicator/skeleton appears while background metadata is generating.
  - Title/caption/hashtags auto-populate when generation finishes.

2. Click each regenerate action (Title, Caption, Hashtags).
- Expected:
  - Regenerate call completes per field.
  - Field updates without reopening panel.

3. Select a YouTube account and try to publish with empty title.
- Expected:
  - Publish is blocked with a title-required error.

4. Open My Office, click Edit on a draft.
- Expected:
  - Slide-over edit modal opens in-place.
  - No page redirect occurs.

5. In modal, edit prompt + caption + hashtags, click Save Changes.
- Expected:
  - Draft updates persist.
  - Closing/reopening shows updated values.

6. Modify values and click close without saving.
- Expected:
  - Discard confirmation appears.

## Known Risks / Follow-up
- Metadata generation now relies more heavily on `generate-post-metadata`; outages there can delay post-production autofill.
- Prompt updates from edit modal write directly to `generations.prompt`; teams should confirm this is desired for generation-history audit semantics.
- Current YouTube title validation runs at publish-time; if stricter earlier gating is desired, add platform preselection earlier in flow.
