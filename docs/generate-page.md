# Generate Page Developer Reference

Updated: 2026-05-14

This document describes the current Generate page implementation end to end. It is written for a developer who has not seen the page before and needs to understand the UI, data flow, state ownership, capabilities, integration points, and known limitations.

## Scope

The Generate page is the AI Studio workspace for creating social media assets, selecting the best output, preparing post metadata, scoring SEO, scheduling, publishing, and routing content through organization approval flows.

Primary routes:

| Route | Purpose |
| --- | --- |
| `/app/generate` | Open the Generate workspace without a selected session. The page can create a draft session when the user starts typing or arrives with route state. |
| `/app/generate/[sessionId]` | Open a specific generation session and load its generation history. |
| `/generate` | Next route alias that redirects to `/app/generate`. |

Primary implementation files:

| Area | File |
| --- | --- |
| Page shell and routing orchestration | `src/pages/GeneratePage/GeneratePageV2.jsx` |
| Next route entries | `app/app/generate/page.jsx`, `app/app/generate/[sessionId]/page.jsx`, `app/generate/page.jsx` |
| Main workspace and generation flow | `src/components/Generate/GenerationCanvas.jsx` |
| Prompt bar and preferences popover | `src/components/Generate/GenerationPromptBar.jsx` |
| Result grid and batch actions | `src/components/Generate/BatchGenerationGrid.jsx` |
| Post production drawer | `src/components/Generate/PostProductionPanel.jsx` |
| Session history rail | `src/components/Generate/SessionHistoryRail.jsx` |
| Shared generation and post state | `src/stores/SessionStore.js` |
| Brand kit state | `src/stores/BrandKitStore.js` |
| Route/auth shell | `src/components/User/UserNavbar.jsx`, `src/components/User/UserSidebar.jsx` |
| Styling | `src/styles/GenerateV2.css` |
| Canonical statuses | `src/constants/statuses.js` |

## Product Purpose

Generate is a production workflow, not a standalone image generator.

The page lets the user:

- Start from a prompt, template, library asset, calendar action, or existing post.
- Generate one or more images.
- Generate carousel image batches.
- Start video jobs.
- Edit existing generated images.
- Review processing, completed, and failed results in the same session.
- Select a result for post production.
- Regenerate title, caption, and hashtags.
- Score and optimize SEO.
- Choose connected social accounts.
- Save as draft.
- Schedule or publish.
- Submit to an organization approval workflow when required.
- Reopen previous sessions and results from history, dashboard search, navbar search, library, calendar, and post routes.

## Mental Model

The page has four user-facing phases:

1. Prompt
   The user describes the content and optionally changes generation preferences.

2. Results
   The system creates media rows in `generations`, shows progress, and renders completed or failed outputs.

3. Select
   The user chooses one completed result or a batch item for post production.

4. Post production
   The user edits publishing metadata, scores SEO, chooses platforms, and saves, schedules, publishes, or submits for approval.

The UI exposes those phases in the canvas header, but the underlying state is owned mainly by `useSessionStore`.

## Data Model

The Generate page reads and writes these main tables and records:

| Data | Purpose |
| --- | --- |
| `sessions` | One workspace thread of prompts and generations. The URL session id points here. |
| `generations` | Generated media records. Includes prompt, status, media type, storage path, metadata, batch id, batch index, session id, and content plan id when available. |
| `posts` | Draft, scheduled, publishing, published, or failed posts created from selected generations. |
| `connected_accounts` | Social accounts available for publishing. |
| `content_plans` | Optional content strategy data used to seed caption and hashtags. |
| `media_assets` | Library assets that can seed a prompt or become asset references. |
| `content_templates` | Templates that can seed prompt text. |
| organization asset links | Org-scoped post asset references synchronized when publishing or saving in an organization context. |

Canonical statuses are defined in `src/constants/statuses.js`.

Generation statuses:

- `processing`
- `completed`
- `failed`

Post statuses:

- `draft`
- `scheduled`
- `publishing`
- `published`
- `failed`

Pipeline statuses include:

- `pending`
- `in_review`
- `revision_requested`
- `approved`
- `rejected`
- `withdrawn`
- `scheduled`
- `published`

## Page Shell

`GeneratePageV2.jsx` owns the full page composition.

It renders:

- `UserNavbar`
- `UserSidebar`
- `SessionHistoryRail`
- `GenerationCanvas`
- `PostProductionPanel`
- `VideoProcessingModal`
- `VideoStatusBar`
- `BrandKitOnboardingModal`

It also handles:

- Auth-derived user context through `useAuth`.
- App navigation through `useAppNavigation`.
- Brand kit loading.
- Session loading and route redirects.
- Organization runtime context.
- Search index hydration for navbar search.
- Deep links to a generation through `#generationId`.
- Route state from library, templates, calendar, edit, and repurpose flows.
- Realtime generation subscriptions.
- Post production open and close behavior.

## Search Integration

The page builds a search index for the navbar from recent generations and sessions.

Important behavior:

- `GENERATION_SEARCH_LIMIT` is `120`.
- Search records map each generation to `/app/generate/:sessionId#generationId`.
- Results include generated media labels, prompt text, session information, and generation metadata where available.
- `socialai:data-sync` causes the page to reload search data.
- Selecting a search result navigates to the session route and then uses the hash to select and scroll to the generation card.

Related consumers:

- `UserNavbar` global search.
- `UserDashboard` recent generation links.
- Library and calendar navigation into Generate.

## Session Lifecycle

There are three ways a session becomes active.

1. URL session id
   `/app/generate/[sessionId]` calls `loadSession(sessionId)`.

2. First prompt input
   `GenerationCanvas` listens for prompt changes. If the user starts typing and there is no active session, it calls `ensureSessionFromPromptInput(prompt)`. The store creates a draft session title from the prompt.

3. Route state
   If Generate is opened from a template, media library asset, calendar action, edit action, or repurpose action, `GeneratePageV2` creates or loads a session before seeding prompt or post production state.

Session history behavior:

- The rail lists user sessions.
- "New session" navigates to `/app/generate`.
- Selecting a session navigates to `/app/generate/:sessionId`.
- Deleting a session calls the store delete method and shows a toast.
- The rail can collapse and reopen from a side tab.

## Brand Kit Integration

Generate loads the active brand kit for the current user through `useBrandKitStore`.

Brand kit affects:

- Prompt suggestions.
- Prompt enhancement context.
- Image generation prompt context.
- Carousel generation context.
- Edit generation context.
- Video generation context.
- Post metadata generation.
- SEO optimization.
- UI banners and onboarding prompts.

UI states:

- If no brand kit is configured, the page shows a warning banner: outputs will be generic.
- If a brand kit exists, the page shows it as active and links to edit it.
- If a kit exists but setup is incomplete and not skipped, `BrandKitOnboardingModal` can appear once per session storage key.

## Organization Context

Generate supports personal and organization-scoped work.

`GeneratePageV2` reads `location.state.orgContext` and writes it to the org runtime store. `SessionStore.js` then uses helpers such as:

- `getActiveOrgScope`
- `withOrgScope`
- `getSessionScope`
- `withSessionScope`
- `applySessionScope`
- `applyGenerationScope`

Org scope affects:

- Session queries.
- Generation queries.
- Post creation.
- Asset reference syncing.
- Approval workflow routing.
- Direct publish permissions.
- Settings and account management paths.

The post production panel reads organization permissions from `useOrgContext`.

Important permission behavior:

- If the user lacks direct publish permission, approval is required.
- If the org role has `publish_requires_final_approval`, approval is required.
- If the user can direct publish, the panel can offer a route toggle between approval and direct publish.
- Direct publish can still mirror the action into Pipeline when an active workflow exists.

## UI Anatomy

### Header

The canvas header summarizes the workspace:

- Generate workspace label.
- Page title and short workflow description.
- Workflow steps: Prompt, Results, Select, Post production.
- Counters for completed generations and active session generations.
- Active mode display.

### Brand Banner

The banner immediately below the header tells the user whether the brand kit is active or missing.

### Empty State

When there are no generations in the active session, the canvas shows:

- "Create with AI" title.
- Short instruction copy.
- Prompt suggestion chips from `getSuggestedPrompts`.

Selecting a suggestion places it in the prompt bar.

### Result History

Once a session has generations, the canvas shows each batch in chronological order.

Each batch includes:

- Prompt bubble.
- Generation cards grouped by `batch_id` or individual generation id.
- Slide order for carousel results.
- Processing, completed, and failed states.

### Prompt Dock

The prompt dock stays at the bottom of the canvas. It contains:

- Fixed-height prompt textarea.
- Magic Enhance button.
- Attachment button.
- Preferences button.
- Generate submit button.
- Keyboard hint for Ctrl+Enter or Cmd+Enter.

Current UX invariant:

- Generation preferences only appear when the preferences button is toggled.
- The settings popover must not be duplicated as an always-visible strip.
- Prompt growth must not resize action buttons.
- Long prompt text must scroll inside the textarea.
- The prompt bar, action column, and send button must retain stable dimensions in both light and dark themes.

## Prompt Bar Capabilities

Implemented in `GenerationPromptBar.jsx`.

Prompt input:

- Controlled and uncontrolled prompt support.
- Imperative methods exposed through ref:
  - `focus()`
  - `setPrompt(value)`
  - `getPrompt()`
- Ctrl+Enter and Cmd+Enter submit.
- The textarea does not auto-grow beyond the designed container.

Modes:

| Mode id | Label | Current behavior |
| --- | --- | --- |
| `create-image` | Image | Primary image generation mode. Supports single output and carousel output structure. |
| `text-to-video` | Video | Starts a video generation job from the prompt. |
| `frames-to-video` | Frame | UI mode exists and maps to the video pipeline. Current prompt submission does not pass frame attachment files end to end. |
| `edit-image` | Edit | Used to edit an existing generated image or reference image URL. |

Preferences popover:

- Opens only from the preferences/settings button.
- Closes on outside click.
- Contains mode selection.
- Contains aspect ratio selection.
- Contains output structure controls for image mode.
- Contains output count controls for single image generation.
- Contains carousel slide count controls for carousel mode.
- Contains model selection.
- Shows a note that video and edit modes produce one output per prompt.

Output structure:

- `single`
- `carousel`

Aspect ratios:

- The prompt bar imports aspect ratio definitions from `AspectRatioIcons`.
- Current UI includes common ratios such as `1:1`, `4:5`, `9:16`, and `16:9`.

Model options:

- `freepik-standard`
- `freepik-quality`

Important model note:

- The selected model is captured in UI and session settings. Verify provider-specific behavior before assuming every downstream API uses the model value differently.

Attachments:

- Image and video files are accepted by the prompt bar UI.
- Maximum media size is 50 MB.
- Unsupported file types show a toast error.
- Attached image files are previewed and included in `referenceImages` and `referenceImageFiles`.
- Video attachments can be selected in UI, but current generation submission only forwards image references to the canvas. Frames-to-video needs additional end-to-end payload work if it must consume attached video or frame files.

Magic Enhance:

- Calls `onEnhancePrompt(prompt)`, which maps to `useSessionStore.enhancePrompt`.
- Accepts a plain string response, `enhancedPrompt`, `enhanced`, or a suggestions array.
- Shows returned suggestions in an enhance menu.
- Selecting a suggestion replaces the prompt text.
- Empty prompts show a toast instead of calling the enhancer.

Submission payload:

The prompt bar sends:

```js
{
  prompt,
  mode,
  aspectRatio,
  outputCount,
  model,
  outputStructure,
  slideCount,
  referenceImages,
  referenceImageFiles,
  attachedMedia
}
```

## Generation Canvas Capabilities

Implemented in `GenerationCanvas.jsx`.

The canvas owns:

- Current mode selection.
- Prompt value.
- Edit target state.
- Suggestions.
- Clarification modal state.
- Generation grouping.
- Generation request routing.
- Retry routing.
- Post-production selection handoff.

Generation modes are normalized before the store is called:

| Mode | Store settings applied | Store method |
| --- | --- | --- |
| Image single | `mediaType: image`, `contentType: single`, `batchSize: 1..4` | `startGeneration(prompt)` |
| Image carousel | `mediaType: image`, `contentType: carousel`, `batchSize: 1`, `slideCount: auto or manual` | `startCarouselGeneration(prompt, slideCount)` |
| Text to video | `mediaType: video`, `contentType: single`, `batchSize: 1` | `startVideoGeneration(prompt)` |
| Frames to video | `mediaType: video`, `contentType: single`, `batchSize: 1` | `startVideoGeneration(prompt)` |
| Edit image | `mediaType: edit`, `contentType: single`, `batchSize: 1` | `startEditGeneration(sourceImageUrl, prompt)` |

Pending placeholder count:

- Video modes: 1.
- Carousel: 4 when auto, otherwise the selected manual slide count with minimum 2.
- Single image: store batch size capped to the supported output count.

Clarification flow:

- Before a normal image generation, `checkIntentAmbiguity(prompt, brandKit)` can detect missing or ambiguous intent.
- If ambiguous, `IntentClarificationPanel` asks questions.
- Submitted clarification answers are stored through `setClarifications`.
- Skipping clears clarifications and proceeds.
- This flow currently applies to normal image generation requests from `handleGenerateRequest`.

Prompt seed event:

- `GenerationCanvas` listens for `socialai:seed-prompt`.
- When received, it sets prompt text and focuses the prompt bar.
- Library and template route-state flows dispatch this event.

Edit image flow:

- The user can click edit on a completed image card.
- `EditImageModal` opens with the selected image.
- The modal can apply an edit instruction.
- The canvas calls `startEditGeneration`.
- After completion, the edited URL is returned or the latest completed edit generation is selected.

Edit mode limitation:

- `startEditGeneration` requires a stable source URL.
- Blob URLs from local attachments are rejected in the canvas because the backend cannot access them directly.
- To support uploaded local edit sources, add upload-to-storage before calling `startEditGeneration`.

Retry flow:

- Failed video generations retry through `startVideoGeneration`.
- Failed edit generations retry through `startEditGeneration` if metadata includes edit mode and source image URL.
- Other failures retry through `startGeneration`.

## Result Grid

Implemented in `BatchGenerationGrid.jsx`.

Card statuses:

- `processing`: loading card with spinner or video progress.
- `completed`: media preview with actions.
- `failed`: explicit failed state with error message and Retry button.

Completed image card actions:

- Select card.
- Download.
- Edit.
- Use for Post.

Completed video card actions:

- Select card.
- Download.
- Use for Post.

Batch-level behavior:

- Completed items can be multi-selected.
- Selecting multiple items reveals a batch action bar.
- Batch actions include download selected and use first selected item for post.
- "Select all" and "clear selection" operate only on completed items.

Download behavior:

- The grid fetches the generation `storage_path`.
- It creates a blob URL.
- It infers file extension from the response MIME type:
  - `png`
  - `jpg`
  - `mp4`
  - fallback `bin`
- It downloads as `generation_<short-id>.<ext>`.

Video behavior:

- Generated video cards render a `<video>` element.
- Pollinations video URLs are mapped to a fallback sample URL for preview safety.
- Processing videos display a progress bar and an estimated 2 to 4 minute message.

Selection handoff:

- Clicking "Use for Post" calls `selectGeneration`.
- `GeneratePageV2` observes `selectedGeneration` and opens `PostProductionPanel`.

## Post Production Panel

Implemented in `PostProductionPanel.jsx`.

The panel opens when `selectedGeneration` is set. Closing it clears the selection.

Steps:

| Step | Label | Purpose |
| --- | --- | --- |
| 1 | Content | Title, caption, hashtags, metadata regeneration. |
| 2 | SEO | SEO score, breakdown, suggestions, AI optimization. |
| 3 | Publish | Account selection, approval route, scheduling, preview, save/publish actions. |

### Content Step

The panel shows:

- Selected media preview.
- Title input.
- Caption input.
- Hashtag list.
- Add hashtag input.
- Regenerate title action.
- Regenerate caption action.
- Regenerate hashtags action.
- Character count and limit validation.
- Metadata loading state when generation is in progress.

Hydration behavior:

- When a generation is selected, `hydratePostProductionFromGeneration(generationId)` loads the preferred draft post for that generation.
- It splits existing caption text and hashtags.
- It loads SEO state from the post.
- It loads asset references.
- It restores selected account ids from related post rows.
- If a content plan is attached to the generation, the panel can seed caption and hashtags from it when local post production fields are empty.

Metadata regeneration:

- `regeneratePostMetadata(fields)` invokes the `generate-post-metadata` edge function.
- Supported fields are title, caption, and hashtags.
- Metadata status is stored in post workflow state.
- While metadata is in progress, the panel polls hydration periodically.

### SEO Step

SEO actions:

- `scoreSeo()`
- `optimizeSeo()`

SEO fields:

- Overall SEO score.
- Score category.
- Breakdown:
  - title
  - caption
  - hashtags
- Suggestions.
- Provider/status metadata.

Behavior:

- `scoreSeo` invokes the `seo-score` edge function.
- `optimizeSeo` invokes the `optimize-seo` edge function.
- SEO score values are normalized to 0..100.
- Optimization updates title, caption, hashtags, and then rescoring can be triggered.

### Publish Step

The publish step covers:

- Approval route selection.
- Direct publish route selection where allowed.
- Approval workflow selection.
- Connected account selection.
- Schedule date and time.
- Platform previews.
- Save draft.
- Schedule post.
- Publish now.
- Submit for approval.

Supported platform handling:

| Platform | Notes |
| --- | --- |
| Instagram | Character limit is 2200. |
| X/Twitter | Character limit is 280. |
| LinkedIn | Character limit is 3000. |
| Facebook | Character limit is 63206. |
| YouTube | Character limit is 5000 and title is required. |
| TikTok | Display helpers exist in preview logic, but icon coverage should be verified when adding TikTok-specific publishing UX. |

Connected accounts:

- Loaded from `connected_accounts`.
- Only `active`, `mock`, and `expired` accounts are returned.
- Expired accounts are visible but cannot be selected for publish; the panel asks the user to reconnect.
- If no accounts are connected, the panel links to settings.

Character limits:

- The effective character limit is the smallest limit among selected platforms.
- If caption text exceeds the limit, publish actions are blocked.
- YouTube selection requires a title before publish.

Preview:

- Preview cards are generated per selected account.
- Preview uses selected media, title, caption, hashtags, account identity, and schedule state.
- Image and video media are supported.

### Save Draft

`saveDraft()` behavior:

- Requires a selected generation.
- Builds final caption from caption plus hashtags.
- Reuses an existing draft post for the generation if possible.
- Otherwise inserts a new `posts` draft row.
- Persists selected primary account id where available.
- Stores title, caption, hashtags, generation id, media path, and schedule context.
- Syncs organization asset references when in org context.
- Dispatches `socialai:data-sync`.

### Publish or Schedule

`publishContent()` behavior:

- Requires at least one selected account.
- Builds final caption from caption plus hashtags.
- Uses `scheduleDate` if present.
- If no `scheduleDate`, status starts as `publishing`.
- If `scheduleDate` exists, status starts as `scheduled`.
- Reuses a draft post for the primary account where possible.
- Creates or updates additional post rows for secondary accounts.
- Ensures library rows exist for created posts.
- Removes stale draft rows for the same generation after publish/schedule.
- Syncs org asset references when needed.
- Clears selected generation and post production state after success.
- For immediate publish, calls mock publish attempts through the publishing service and updates status based on the result.

### Approval Flow

`preparePostForApproval()` behavior:

- Requires a selected generation.
- Builds final caption.
- Reuses an existing draft or inserts a new draft.
- Ensures organization scope is applied.
- Returns the prepared post.

Submit for approval behavior:

- Requires an active approval workflow.
- Calls `preparePostForApproval`.
- Calls `submitPostToPipeline`.
- Updates post `workflow_state` with:
  - `approval_status: in_review`
  - submitted timestamp
  - route
  - workflow id
  - pipeline item id
  - submitted by
- Dispatches `socialai:data-sync`.
- Shows a success screen and links the user to Pipeline.

Direct publish with org pipeline mirror:

- If direct publish is allowed, the panel can create a direct publish pipeline item.
- It marks the approval route as direct and approval status as approved.
- If no active workflow exists, direct publish can still complete with a warning that no Pipeline mirror was created.

## Store Responsibilities

`src/stores/SessionStore.js` is the main state and side-effect owner.

Top-level state includes:

- `sessions`
- `activeSession`
- `activeGenerations`
- `selectedGeneration`
- `selectedGenerationId`
- `isGenerating`
- `generationProgress`
- `progressLabel`
- `settings`
- `postProduction`
- `videoJobState`
- `pendingClarifications`
- `generationLineage`
- `error`

Default post production fields:

- `postId`
- `title`
- `caption`
- `hashtags`
- `seoScore`
- `seoCategory`
- `seoBreakdown`
- `seoSuggestions`
- `seoStatus`
- `seoProvider`
- `selectedPlatforms`
- `scheduleDate`
- `assetReferences`
- `metadataStatus`
- `metadataUpdatedAt`

Default video job fields:

- `jobId`
- `generationId`
- `prompt`
- `status`
- `progress`
- `videoUrl`
- `isMinimized`
- `pollInterval`

Core session methods:

- `loadSessions`
- `loadSession`
- `createNewSession`
- `deleteSession`
- `renameSession`
- `ensureSessionFromPromptInput`
- `updateSession`
- `clearActiveSession`

Core generation methods:

- `startGeneration`
- `startCarouselGeneration`
- `startEditGeneration`
- `startVideoGeneration`
- `pollVideoJob`
- `clearVideoJob`
- `enhancePrompt`
- `selectGeneration`
- `setSelectedGenerationId`
- `subscribeToGenerations`

Core post production methods:

- `setPostProduction`
- `resetPostProduction`
- `hydratePostProductionFromGeneration`
- `regeneratePostMetadata`
- `scoreSeo`
- `optimizeSeo`
- `saveDraft`
- `preparePostForApproval`
- `publishContent`

## Generation Pipeline Details

### Image Generation

`startGeneration(prompt)`:

- Validates non-empty prompt.
- If `settings.mediaType` is video, redirects to video generation.
- If `settings.mediaType` is edit, throws because edits require a source image.
- Ensures a session exists.
- Loads the user and brand kit.
- Imports `generationPipeline`.
- Registers the Freepik image generator.
- Runs the generation pipeline.
- Maps pipeline stages to progress.
- Writes generation rows.
- Syncs organization scope to generated rows.
- Updates active generations.
- Emits errors to store state for toast display.

### Carousel Generation

`startCarouselGeneration(prompt, slideCount)`:

- Validates prompt.
- Resolves auto or manual slide count.
- Ensures a session exists.
- Loads brand kit.
- Builds carousel pipeline settings.
- Runs the same pipeline with carousel-specific settings.
- Stores slide metadata and batch order.
- Updates active generations with ordered slide rows.

### Edit Generation

`startEditGeneration(sourceImageUrl, instruction)`:

- Requires a source image URL.
- Requires a prompt/instruction.
- Ensures a session exists.
- Inserts a processing generation row.
- Calls Freepik edit image service.
- Updates the generation row with completed media path or failed state.
- Stores edit metadata, including source image URL and edit mode.

### Video Generation

`startVideoGeneration(prompt)`:

- Validates prompt.
- Clears any existing video polling interval.
- Ensures a session exists.
- Loads settings and brand kit.
- Calls `createVideoJob`.
- Inserts a processing generation row linked to the video job.
- Opens video modal/status state.
- Starts polling.

Video polling:

- Poll interval is `8000` ms.
- `checkVideoJobStatus` provides progress and final URL.
- Completed jobs update the generation row to `completed`.
- Failed jobs update the generation row to `failed`.
- The minimized status bar remains available while a job continues.

## Realtime Behavior

`subscribeToGenerations()` listens to Supabase realtime changes for generation rows.

When a generation changes:

- If it belongs to the active session, it updates `activeGenerations`.
- If it matches `selectedGeneration`, it updates selection.
- If it corresponds to a video job, it can close polling or update video state.
- The callback can trigger page-level reload or sync behavior.

`socialai:data-sync` is a browser event used across the app to refresh related views after generation, draft, publish, or approval changes.

## Route-State Entry Points

Generate can be opened with state from other pages.

Supported route state keys:

| Key | Source | Behavior |
| --- | --- | --- |
| `prefillDate` | Calendar | Sets post production schedule date. |
| `templateId` | Templates/library | Loads `content_templates`, seeds prompt. |
| `libraryAssetId` | Media Library | Loads `media_assets`, creates asset reference, seeds prompt. |
| `useLibraryAssetId` | Media Library | Same as `libraryAssetId`. |
| `repurposeFromPostId` | Posts/calendar/library | Loads existing post and related generation, preloads post production. |
| `editPostId` | Posts/calendar/library | Loads existing post and generation for edit workflow. |
| `orgContext` | Organization pages | Sets organization runtime scope for sessions, generations, posts, and approvals. |

Library asset behavior:

- Fetches the asset.
- Builds an asset reference.
- Updates post production asset references.
- Sets generation lineage.
- Dispatches `socialai:seed-prompt`.

Template behavior:

- Fetches the template.
- Seeds prompt text.
- Can set lineage metadata for later traceability.

Repurpose/edit post behavior:

- Fetches the post.
- Fetches the related generation.
- Loads the target session if required.
- Selects the generation.
- Preloads post production fields such as title, caption, hashtags, selected account, and schedule date.

## Relationship With The Rest Of The System

Dashboard:

- Links "Generate" calls to `/app/generate`.
- Recent generation cards can navigate to a session and generation hash.
- Dashboard search can route into Generate results.

Navbar:

- Global search includes generation/session records from the Generate page search index.
- The Create/Generate action navigates to `/app/generate`.

Sidebar:

- Generate is the Create section entry point.
- Active sidebar state is based on `/app/generate`.

Brand Kit:

- Supplies brand context to prompt suggestions, generation, metadata, and SEO.
- Missing brand kit produces a banner and setup link.

Media Library:

- Can send an asset into Generate through route state.
- Publishing/scheduling ensures posts become available to library/calendar surfaces.

Calendar:

- Can open Generate with a schedule date.
- Scheduled posts created from Generate appear in scheduling views.

Posts:

- Existing posts can be edited or repurposed through Generate route state.
- Generate can update or replace draft posts attached to a generation.

Analytics:

- Analytics pages can route users to Generate to create new content from insights.

Settings:

- Connected accounts settings are used when no accounts exist or an account is expired.
- Personal start page can include `/app/generate`.

Pipeline:

- Organization approval workflows are loaded during post production.
- Approval submissions create pipeline items.
- Direct publish can mirror to Pipeline when configured.

Notifications:

- Generation and publishing status labels/headlines come from canonical status constants.
- Toasts are used heavily for generation errors, metadata actions, SEO, save, publish, and approval.

## Error And Loading States

Generation errors:

- Empty prompt prevents generation.
- Quota/rate-limit/429 errors show specific toast copy.
- Failed generation rows render failed cards with Retry.
- Store errors are cleared after toast.

Prompt errors:

- Empty Magic Enhance prompt shows toast.
- Unsupported attachment type shows toast.
- Oversized attachment shows toast.

Edit errors:

- Missing source image blocks edit.
- Blob source URL blocks edit because the backend cannot consume it.

Video errors:

- Failed job updates the video state and generation row.
- Video modal/status bar reflects processing and failure states.

Post production errors:

- Missing platform blocks publish.
- YouTube without title blocks publish.
- Over-limit caption blocks publish.
- Expired account blocks selection.
- Missing approval workflow blocks approval submission.
- Save, SEO, metadata, and publish operations use toast loading/success/error states.

## Styling And UX Rules

Generate uses `GenerateV2.css` and dashboard theme tokens.

Theme requirements:

- Must work in dark and light themes.
- Must inherit dashboard variables under `.dashboard-shell`.
- Do not hard-code one-off color systems when a dashboard token exists.
- Use stable borders, backgrounds, shadows, and focus states in both themes.

Prompt bar rules:

- Settings must only appear when the preferences button is toggled.
- Do not reintroduce visible settings strips below or above the prompt bar.
- The prompt textarea has a fixed visual height and scrolls internally.
- Action buttons must not grow with prompt content.
- The send button must keep a stable square/rectangular dimension.
- The action column must stay aligned even with very long prompt text.
- Attached media previews must not push the prompt bar beyond its intended height.

Professional SaaS layout rules:

- Keep controls dense but readable.
- Prefer segmented controls, icon buttons, selects, and compact chips over decorative cards.
- Cards are for generated results, previews, workflow choices, and contained tools.
- Avoid nested cards unless the nested element is a true repeated item or modal content.
- Maintain clear left-to-right flow: prompt -> results -> selected media -> post production.
- The post production panel must never hide primary publish controls behind unclear states.
- Any disabled button must have a visible reason in adjacent copy or validation state.

Accessibility behavior:

- Result cards support keyboard selection with Enter/Space.
- Icon buttons need accessible labels.
- Popovers use `aria-expanded` where applicable.
- Live failed/processing states use status semantics where implemented.
- Focus-visible styles are required for prompt controls and result actions.

## Known Current Limitations

These are important for developers so the UI does not promise more than the implementation delivers.

- Frames-to-video is visible as a mode and routes to the video pipeline, but frame/video attachment payloads are not yet consumed end to end.
- Video attachments can be selected in the prompt bar, but the current submit payload only forwards image references to canvas generation behavior.
- Edit image from a local upload is not complete because blob URLs are rejected before backend edit. Upload the file to storage first if this capability is required.
- `settings.model` is captured and displayed, but provider-specific model switching should be verified inside the generation services before adding new model promises to the UI.
- TikTok preview styling exists in places, and TikTok may appear through connected account helpers, but the explicit icon/action coverage should be verified before treating TikTok as fully first-class.
- Post production opens for one selected generation at a time. Batch post production is not implemented beyond selecting the first selected batch item.

## Adding Or Changing Features

### Add a new generation mode

Update all of these:

- `MODE_OPTIONS` in `GenerationPromptBar.jsx`.
- `supportsStructuredOutputs` if the mode supports output count or carousel.
- `getMediaTypeFromMode` in `GenerationCanvas.jsx`.
- `getModeFromMediaType` in `GenerationCanvas.jsx`.
- `applyModeSettings` in `GenerationCanvas.jsx`.
- `handleGenerate` routing in `GenerationCanvas.jsx`.
- Store method in `SessionStore.js`.
- Backend service or edge function.
- Result card rendering in `BatchGenerationGrid.jsx` if media type changes.
- Post production preview handling if the output can be published.
- CSS for any new controls.
- This document.

### Add a new prompt setting

Update all of these:

- Prompt bar local state.
- Preferences popover control.
- Submit payload.
- Canvas `applyModeSettings`.
- Store `settings` default.
- Generation service payload.
- Generation row metadata if the setting must be inspectable later.
- Search metadata if the setting matters in search.

### Add a new publishing platform

Update all of these:

- `PLATFORM_ICONS`.
- `CHAR_LIMITS`.
- `normalizePlatform`.
- `getPlatformDisplayName`.
- Preview card styling.
- Connected account settings.
- Publish service routing.
- Validation requirements.
- Mock publish handling.
- Any provider-specific media requirements.

### Change post metadata

Update all of these:

- `DEFAULT_POST_PRODUCTION`.
- `hydratePostProductionFromGeneration`.
- `saveDraft`.
- `preparePostForApproval`.
- `publishContent`.
- `generate-post-metadata` edge function contract.
- Post production UI fields.
- SEO scoring and optimization payloads if relevant.

### Change session behavior

Update all of these:

- Route loading in `GeneratePageV2`.
- `SessionHistoryRail`.
- `ensureSessionFromPromptInput`.
- `loadSession`.
- `fetchSessionGenerations`.
- Navbar search result URL building.
- Hash selection behavior.

## Manual QA Checklist

Run this after changing Generate UI or flows:

- Open `/app/generate` in dark theme.
- Open `/app/generate` in light theme.
- Type a very long prompt. Confirm the prompt bar does not resize buttons and there is no horizontal overflow.
- Confirm settings are hidden until the preferences button is clicked.
- Toggle preferences and verify popover placement, outside click close, and keyboard focus.
- Generate one image.
- Generate four image variations.
- Generate a carousel.
- Start a text-to-video job and verify modal/status bar behavior.
- Retry a failed generation if a failed state can be produced.
- Select a completed image and confirm the post production panel opens.
- Edit title, caption, and hashtags.
- Regenerate title, caption, and hashtags.
- Run SEO score.
- Optimize with AI.
- Select each supported connected account type.
- Confirm expired accounts cannot be selected.
- Confirm YouTube requires a title.
- Confirm caption limit validation uses the strictest selected platform limit.
- Save draft.
- Schedule post.
- Publish now in a personal workspace.
- Submit for approval in an org workspace that requires approval.
- Direct publish in an org workspace where the role permits it.
- Open a generation from navbar search.
- Open a generation from dashboard recent items.
- Open Generate from calendar with `prefillDate`.
- Open Generate from media library with `libraryAssetId`.
- Open Generate from templates with `templateId`.
- Open Generate from an existing post with `repurposeFromPostId` or `editPostId`.

## Automated Checks

Useful commands:

```bash
npm run build
npm run check:ui-consistency
```

Recommended browser smoke checks:

- Long prompt containment.
- No visible config strip before preferences toggle.
- Exactly one settings popover after preferences toggle.
- No horizontal overflow at desktop and mobile widths.
- Light theme and dark theme render with readable contrast.
- Result card actions are visible on hover and keyboard reachable.
- Post production footer actions remain visible.

## Quick Developer Map

If a bug appears in the prompt bar, start with:

- `GenerationPromptBar.jsx`
- `.gpb-*` selectors in `GenerateV2.css`

If a bug appears in result display, start with:

- `BatchGenerationGrid.jsx`
- generation rows in Supabase
- `GENERATION_STATUS` in `statuses.js`

If a generation request fails, start with:

- `GenerationCanvas.jsx`
- `SessionStore.js`
- `generationPipeline`
- Freepik service
- relevant Supabase edge function logs

If post production opens incorrectly, start with:

- `GeneratePageV2.jsx` selected generation effect
- `PostProductionPanel.jsx`
- `hydratePostProductionFromGeneration`
- related `posts` rows

If publish or approval fails, start with:

- `PostProductionPanel.jsx`
- `publishContent`
- `preparePostForApproval`
- connected account records
- org permissions and pipeline configs

If search or deep links fail, start with:

- `GeneratePageV2.jsx` search index hydration
- `UserNavbar.jsx`
- generation `session_id`
- URL hash handling

## Developer Principle

Generate should feel like a focused SaaS production workspace. The prompt is the starting point, but the actual product value is the complete path from idea to publishable content. Any change to the page should preserve that flow:

Prompt -> generate -> inspect results -> select -> refine metadata -> validate SEO -> choose destination -> publish, schedule, save, or submit for approval.
