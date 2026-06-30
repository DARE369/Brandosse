# Generate Page: Input to Output Concept

Updated: 2026-05-20

## Current Implementation Map: Prompt To Result

This is how the current AI Studio flow works in the Next.js app after the Generate page rebuild work.

### 1. User Entry And Page Shell

- Routes:
  - `/app/generate`
  - `/app/generate/[sessionId]`
  - `/generate` redirects into the app route.
- Page/component path:
  - `src/pages/GeneratePage/GeneratePageV2.jsx`
  - `src/components/GenerateStudio/BrandosseGenerateStudio.jsx`
  - `src/components/Generate/SessionHistoryRail.jsx`
- The page uses the existing authenticated Supabase session through `useAuth()` and the shared Supabase client in `src/services/supabaseClient`.
- The left rail loads existing `sessions` and lets the user open prior work without creating a separate project.
- The rebuilt page is model-first in the UI. Users should see model names and content-type controls, not upstream provider branding.

### 2. Create Phase: Frontend State And Validation

The Create phase lives mostly in `BrandosseGenerateStudio.jsx`.

What the user controls:

- Prompt textarea with 2,000 character hard limit.
- Content type:
  - image
  - carousel
  - text to video
  - image edit
  - frames to video
- Model selection:
  - Seedream 4.5
  - Flux 2 Pro
  - Mystic variants for still images
  - LTX 2.0 Pro for text-to-video
  - Kling 2.6 Pro or LTX I2V for first-frame video
  - Seedream 4.5 Edit for image edits
- Aspect ratio, resolution, output count, slide count, duration, FPS, audio toggle, and reference/first-frame image URL where needed.

Preflight checks happen before any generation call:

- Prompt is required.
- Prompt must stay within 2,000 characters.
- Image edit and frames-to-video require a source image URL.
- The selected options must be valid for the selected mode.
- User must have enough credits.

Credits are loaded from:

- `GET /api/credits/balance`
- Files:
  - `app/api/credits/balance/route.ts`
  - `src/app/api/credits/balance/route.ts`

Temporary credit behavior:

- Every authenticated user currently receives a mock floor of 1,000 visible Studio credits.
- This is returned by the API layer and does not mutate the permanent ledger.
- The response includes `mock_credit_floor` and `mock_credit_grant` so we can remove it cleanly when the real credit system is finished.

### 3. Session Store: Main Frontend Orchestrator

The main frontend business logic is in:

- `src/stores/SessionStore.js`

Important actions:

- `startGeneration(prompt)` for still images and image variants.
- `startCarouselGeneration(prompt, slideCount)` for carousel planning and slide generation.
- `startEditGeneration(sourceImageUrl, instruction)` for text-guided image edits.
- `startVideoGeneration(prompt)` for text-to-video and frames-to-video.
- `selectGeneration(generation)` for review selection.
- `hydratePostProductionFromGeneration(generationId)` for title/caption/hashtag state.
- `regeneratePostMetadata(fields)` for Claude metadata.
- `optimizeSeo()` and `scoreSeo()` for Social SEO and Discovery Score.
- `saveDraft()` and `publishContent()` for draft/mock publishing.

The store also keeps:

- active session
- active generations
- selected generation
- generation settings
- generation progress
- video job state
- post-production state

### 4. Session Creation And Database Rows

When the user generates from a prompt:

1. `SessionStore.ensureSession()` checks whether there is an active session.
2. If there is no active session, it creates one in `sessions`.
3. The prompt and model settings are used to create one or more `generations` rows.
4. A draft `posts` row is created or reused for each completed generation through `ensureDraftForGeneration()`.

Main tables:

- `sessions`: one creative thread or workspace.
- `content_plans`: LLM strategy output for single image and carousel flows.
- `generations`: generated asset records, status, media URL, metadata.
- `posts`: post-production state, captions, hashtags, schedule/publish state.
- `connected_accounts`: account/platform targets for previews and mock publishing.
- `user_credits` and `credit_transactions`: credit balance and ledger.

Important JSON columns:

- `generations.metadata`
  - provider name, task id, model, endpoint, generation cost, dimensions, source image, generation mode.
- `posts.workflow_state`
  - metadata generation status, SEO lifecycle status, approval route/state, automation timestamps.
- `posts.seo_state`
  - Discovery Score, breakdown, recommendations, benchmark report, provider/model, timestamps.

### 5. Content Planning LLM Path

Still image and carousel generation use the canonical planner:

- `src/services/generationPipeline.js`
- `src/services/groqClient.js`
- Supabase Edge Function: `supabase/functions/generate-content-plan/index.ts`

Flow:

1. Load Brand Kit through `src/services/brandKitLoader`.
2. Load recent user history through `src/services/historyLoader`.
3. Build a generation brief in `src/services/briefBuilder`.
4. Call the `generate-content-plan` edge function.
5. Store the validated content plan in `content_plans`.
6. Use the plan's visual prompt(s) to create media.

LLM keys used:

- Preferred for content planning: `GROQ_API_KEY`.
- Fallbacks supported by shared LLM helper: `GROK_API_KEY`, `XAI_API_KEY`, `ANTHROPIC_API_KEY`.
- Optional model overrides: `GROQ_MODEL`, `GROK_MODEL`, `ANTHROPIC_MODEL`.

Expected result:

- A structured content plan with visual prompt, caption direction, title direction, hashtag direction, and guardrail checks.

### 6. Media Generation Edge Functions

Frontend service:

- `src/services/magnific.service.js`

Edge functions:

- `supabase/functions/generateImage/index.ts`
- `supabase/functions/editImage/index.ts`
- `supabase/functions/generateVideo/index.ts`
- `supabase/functions/videoStatus/index.ts`

Shared provider adapter:

- `supabase/functions/_shared/magnific.service.ts`

Server secret:

- `MAGNIFIC_API_KEY`

Important point:

- The provider is internal. The app UI should expose model choices and output controls, not provider branding.
- New generation metadata can still store internal provider fields for debugging and auditing.

Image flow:

1. Frontend calls `generateImages()`.
2. `generateImages()` invokes `generateImage`.
3. `generateImage` merges Brand Kit into the prompt.
4. The shared adapter creates an async image task with the selected model.
5. The edge function polls until completion.
6. The returned remote asset is copied into Supabase Storage.
7. The edge function returns public URL, storage path, task id, model, endpoint, and timing.
8. `generationPipeline` updates `generations.status`, `storage_path`, `progress`, and `metadata`.

Image edit flow:

1. `startEditGeneration()` inserts a processing `generations` row.
2. `editImage()` invokes `editImage` edge function.
3. The edge function creates and polls an edit task.
4. The final asset is copied into `generated_assets`.
5. The existing generation row is updated to completed or failed.

Video flow:

1. `startVideoGeneration()` calls `createVideoJob()`.
2. `generateVideo` edge function creates an async video task and returns a job id.
3. The store inserts a processing `generations` row with task metadata.
4. `startVideoPolling()` calls `videoStatus` every 8 seconds.
5. When complete, `videoStatus` copies the video into Supabase Storage and updates the generation row.
6. A draft post is ensured for the completed video.

Storage:

- Supabase Storage bucket: `generated_assets`
- Remote media is copied to this bucket so Brandosse owns the final public asset reference.

### 7. Review Phase

The Review phase is in `BrandosseGenerateStudio.jsx`.

It reads:

- `activeGenerations`
- `selectedGeneration`
- `generationsLoading`

It shows:

- A responsive gallery of generated assets.
- A selected asset preview.
- Model, task id, status, dimensions, format, file size, generation time.
- Download, regenerate, and use-for-post actions.

Keyboard behavior:

- Left and right arrow keys move between completed results after a generation is selected.

Expected result:

- The user can compare outputs and select one asset to move into Post-Production.

### 8. Automatic Post Metadata And Discovery Score

When the user selects an asset and moves to Post-Production:

1. `hydratePostProductionFromGeneration(selectedGeneration.id)` loads the draft post.
2. If title, caption, or hashtags are missing, `regeneratePostMetadata(['title', 'caption', 'hashtags'])` runs.
3. `optimizeSeo()` runs automatically.
4. `optimizeSeo()` applies optimized title/caption/hashtags.
5. `scoreSeo()` immediately scores the optimized metadata.
6. Inputs are locked while metadata/SEO is running.

Edge functions:

- `supabase/functions/generate-post-metadata/index.ts`
- `supabase/functions/optimize-seo/index.ts`
- `supabase/functions/seo-score/index.ts`

LLM key:

- `ANTHROPIC_API_KEY` is required for Claude metadata, Social SEO optimization, and Discovery Score.
- Optional: `ANTHROPIC_MODEL`.

Score dimensions:

- readability
- keyword relevance
- hashtag quality
- hook strength
- CTA strength
- platform fit
- brand consistency
- visual-caption alignment
- recommendation potential

Expected result:

- The user sees a Discovery Score, benchmark report, recommendations, hashtag suggestions, and optimized post metadata.
- Manual "Improve with Claude" applies optimized metadata and immediately re-scores.
- The score is rubric/model-generated, not hard-coded upward.

### 9. Platform Preview And Publishing

Connected accounts are loaded from `connected_accounts`.

The current Post-Production UI supports platform preview context for:

- Instagram
- TikTok
- Facebook
- YouTube
- LinkedIn
- X/Twitter

Publishing is still mock:

- `publishContent()` in `SessionStore.js`
- mock workflow service: `src/services/platforms/mockPublishWorkflow`
- edge function: `supabase/functions/mock-publish`

Expected result:

- Posts can be saved as drafts, scheduled, or run through mock publish behavior while keeping table and workflow state intact.

### 10. Active API Keys And What They Do

Browser/public:

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: browser-safe Supabase anon key.

Server/edge only:

- `SUPABASE_SERVICE_ROLE_KEY`: privileged Supabase service access in trusted contexts.
- `MAGNIFIC_API_KEY`: internal media-generation gateway key.
- `ANTHROPIC_API_KEY`: Claude metadata, Social SEO optimization, Discovery Score, optional content-plan fallback.
- `ANTHROPIC_MODEL`: optional Claude model override.
- `GROQ_API_KEY`: preferred content planning LLM.
- `GROQ_MODEL`: optional Groq model override.
- `GROK_API_KEY` or `XAI_API_KEY`: xAI/Grok fallback.
- `GROK_MODEL`: optional Grok model override.

### 11. Current Services And Their Purpose

- Next.js app server: serves `/app/generate` and `/api/credits/balance`.
- Supabase Auth: authenticates the logged-in user.
- Supabase Database: stores sessions, plans, generations, posts, accounts, credits, and workflow state.
- Supabase Storage: stores generated media in `generated_assets`.
- Supabase Edge Functions: run server-only provider calls, LLM calls, metadata, SEO, and mock publishing.
- Shared LLM helper: chooses Groq/Grok/Anthropic based on preferred provider and available secrets.
- Media provider adapter: creates async image/edit/video tasks, polls status, normalizes provider responses.
- Zustand `SessionStore`: coordinates page state, generation lifecycle, draft creation, review selection, SEO, and publishing.

### 12. Current Gaps To Finish AI Studio

- Provider internals are now hidden from the main UI, but older docs and legacy files still contain historical provider names.
- First-frame video works as a single source image URL; true first-frame plus last-frame control still needs exact endpoint contract validation before adding UI.
- The credit system currently has a 1,000 mock floor; real debits/rate limits still need implementation.
- Full platform publishing is still mock.
- Some legacy Generate components remain in the codebase for older flows, but the new `/app/generate` page uses the rebuilt Studio component.

## Purpose

I am thinking about the Generate page as a creative workspace where a user can take a rough idea and turn it into social media content that is ready to use.

The idea is not just to help someone create an image or video. I want the page to support the full journey from idea, to generated output, to post preparation, and finally to saving, scheduling, or publishing.

I am also thinking about this as two related but separate experiences:

- Personal Generate for individual users.
- Organization Generate for teams working inside an organization.

These should not feel like the same thing with different labels. A personal user should not need approval from anyone. Approval only makes sense in the organization version, where a team may need review rules before content goes out.

## Personal Generate Concept

For personal users, I am thinking of Generate as a direct creation flow.

A personal user should be able to:

- Start from an idea, template, media item, calendar date, or existing post.
- Create images, videos, carousels, or edited images.
- Review the results.
- Prepare a title, caption, and hashtags.
- Check whether the post is clear and discoverable.
- Save the post as a draft.
- Schedule it for later.
- Publish directly to their connected accounts.

The important point is that a personal user owns the decision. Once the post is ready, they decide whether to save, schedule, or publish.

## Organization Generate Concept

For organizations, I am thinking of Generate as a shared content creation flow.

It can include the same creative steps as the personal version, but with team context added around it. That means shared brand direction, shared templates, organization-owned accounts, and possible approval rules.

An organization user may need to:

- Create content for a shared brand or project.
- Use organization-approved templates or brand guidance.
- Prepare posts for organization-owned accounts.
- Submit content for team review when their role requires it.
- Publish directly only if their role allows it.

Approval should not be treated as part of every Generate experience. It should only appear when the user is working in an organization context and the organization expects review before publishing.

## Starting Points

I want the user to be able to begin from different starting points, depending on what they already have.

A user might start with:

- A written idea or prompt.
- A suggested prompt.
- An existing image or video.
- A saved media item from the library.
- A template.
- A calendar date.
- An existing post they want to edit or reuse.

If the user has a Brand Kit, I want the Generate page to use it as guidance so the output feels closer to the user's brand. If there is no Brand Kit, the page should still work, but the result may feel more generic.

## Prompt Optimization Idea

I am thinking about prompt optimization as a way to help users who know what they want but do not know how to describe it well.

A user might type something simple like "make a launch post for my product." Prompt optimization would help shape that into a stronger creative direction.

It should improve things like:

- The goal of the post.
- The audience.
- The tone.
- The visual style.
- The platform fit.
- The brand direction, if a Brand Kit exists.

The user should stay in control. They should be able to accept the improved prompt, edit it, or ignore it and keep their original wording.

If the idea is too vague, I am also thinking the page could ask a few simple follow-up questions before generating. That would help avoid weak results caused by unclear input.

## Parameter Configuration Idea

I am thinking of parameter configuration as the set of creative choices the user makes before generating.

These choices should feel simple and practical. The user should feel like they are choosing what type of content they want, what shape it should be, how many versions they want, and what quality level they prefer.

## Image Mode

Image mode would be for creating one image or several image options from a written idea.

The user would choose:

- The prompt.
- The shape of the image.
- The number of image options.
- The generation quality.
- Any reference image they want the output to follow.

The expected output would be one or more image options. The user could then preview them, download them, edit them, or choose one for post preparation.

## Video Mode

Video mode would be for turning an idea into a short video.

The user would choose:

- The prompt.
- The shape of the video.
- The visual direction.
- Any reference media, if useful.

Because video can take longer than image generation, I would want the experience to show progress clearly while the video is being created.

The expected output would be a video the user can preview, download, or prepare as a post.

## Frames-to-Video Idea

Frames-to-video is a related idea for users who want more visual control over a video.

Instead of starting only from words, the user could provide visual starting points and then describe how those visuals should move, change, or connect.

The expected output would still be a video, but the input would feel more guided than a plain text-to-video request.

## Carousel Mode

Carousel mode would be for turning one idea into a multi-slide post.

The user would choose:

- The main prompt.
- The number of slides, or allow the page to decide.
- The shape of the slides.
- The generation quality.

The goal would be to create a set of related slides that feel like they belong together. Each slide should be clearly ordered so the user understands the flow of the carousel.

The expected output would be a carousel set that can be reviewed slide by slide and then used for post preparation.

## Editing Mode

Editing mode would be for changing an existing image instead of starting from nothing.

The user would choose:

- The image they want to edit.
- The change they want to make.
- The style or direction of the edit.

Examples could include changing the background, improving the design, adjusting the image for a campaign, or creating a new version of an existing visual.

The expected output would be an edited image. The edited version could then be downloaded, edited again, or used for post preparation.

## Template Idea

I am thinking about templates as a way to help users start faster and keep content consistent.

Instead of starting from a blank prompt, the user could choose a reusable format for a common content need.

Examples could include:

- Product announcement.
- Sale or promotion.
- Educational post.
- Event reminder.
- Testimonial.
- Brand awareness post.
- Carousel outline.

A template should give the user a useful starting point. It could guide the prompt with a structure, tone, or content direction. The user would still be able to adjust the wording, choose the content type, and generate the final result.

The purpose of templates would be to:

- Reduce the blank-page problem.
- Help users repeat successful formats.
- Keep brand content more consistent.
- Save time for common campaigns.
- Help personal users move faster.
- Help organization teams follow approved content patterns.

## Session Management Idea

I am thinking about sessions as a way to keep related creative work together.

A session would be like one creative thread. It could include the user's prompts, generated results, edits, and selected outputs for a specific idea or campaign.

The user should be able to:

- Start a new session.
- Return to a previous session.
- Continue working on older results.
- Compare different attempts for the same idea.
- Delete sessions they no longer need.

This matters because generation is rarely a single-step process. A user may try several versions before choosing the best one. Sessions would make that exploration easier to follow.

## Generation Flow Idea

After the user enters an idea and chooses the content type, the page would begin creating the output.

Before generating, I am thinking the page should check whether the request is clear enough. If it is too vague, the page could ask simple questions or offer an improved prompt.

Once the request is ready, the user should see that the content is being created. The experience should make it clear that the page is working, especially for longer tasks like video.

The generated output could be:

- One image.
- Multiple image options.
- A carousel set.
- A video.
- An edited image.

If something fails, the user should see a clear message and have a way to try again.

## Result Review Idea

Once results are ready, I want the user to be able to review them easily.

Each result should be easy to:

- Preview.
- Select.
- Download.
- Edit, if it is an image.
- Use as the starting point for a post.

For carousel content, the user should be able to see the slide order clearly.

For video content, the user should be able to preview the video before deciding what to do next.

## Post-Production Idea

I am thinking about post-production as the step where a generated result becomes a complete social post.

This should happen after the user chooses a result they want to use.

The post-production flow would have three stages:

1. Content.
2. Search visibility.
3. Publish.

## Content Stage

The Content stage would prepare the words that go with the selected image, carousel, or video.

The user would prepare:

- Title.
- Caption.
- Hashtags.

The user could write these manually or ask AI to regenerate them.

The purpose of this stage is to move from a raw generated result to a post with clear messaging.

## Search Visibility Stage

The Search Visibility stage would help the user understand how discoverable the post might be.

It could give the user:

- A score.
- Feedback on the title.
- Feedback on the caption.
- Feedback on the hashtags.
- Suggestions for improvement.

The user could then improve the post manually or ask AI to optimize it.

The goal is to make the post easier to find, easier to understand, and more likely to perform well.

## Publish Stage

The Publish stage would decide where the post goes and when it goes out.

For personal users, the final choices should be:

- Save as draft.
- Schedule.
- Publish now.

Before the final action, the page should help the user confirm:

- The selected social accounts.
- The post preview.
- The caption length.
- The required title, if the platform needs one.
- The schedule date and time, if the post is not going out immediately.

For personal users, the result would be a draft, a scheduled post, or a published post.

For organization users, one extra outcome may exist:

- Submit for approval.

That approval outcome should only appear in organization workspaces where approval is required or available.

## Platform and Scheduling Idea

I am thinking the page should let the user choose which connected social accounts should receive the post.

If an account needs to be reconnected, the page should make that clear before the user tries to publish.

The user should be able to choose:

- Post now.
- Schedule for a specific date and time.

Before publishing or scheduling, the user should see a preview of how the post may appear on the selected accounts.

If the user selects YouTube, the page should require a title.

If the caption is too long for a selected platform, the page should block publishing until the user shortens it.

## Organization Approval Idea

I am thinking of approval as an organization-only concept.

When a user is working inside an organization, the Generate page could follow that organization's review rules.

Depending on the user's role, the organization version may:

- Require the post to be submitted for approval.
- Let the user choose between approval and direct publishing.
- Allow direct publishing without approval.

If approval is required, the user would submit the post into the organization's review flow. The post would then be reviewed before it can be published.

This should not apply to personal users.

## Possible Final Outputs

The Generate page concept could end with several different outcomes:

- A finished image.
- A finished carousel.
- A finished video.
- An edited image.
- A downloaded file.
- A saved draft.
- A scheduled post.
- A published post.
- A post submitted for approval, only in the organization concept.

The personal flow I am thinking about is:

Idea -> Create -> Review -> Select -> Prepare Post -> Save, Schedule, or Publish.

The organization flow I am thinking about is:

Idea -> Create -> Review -> Select -> Prepare Post -> Save, Schedule, Publish, or Submit for Approval.
