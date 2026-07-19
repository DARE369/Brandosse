# Stage 3a — Journeys: Core Generation Flow

## 1. Generate — Single Image

**Trigger**: `handleGenerate` (`StudioPage.jsx:224-250`), fired by the "Generate" button (disabled if `!prompt.trim() || !canAfford || isGenerating`).

**Happy path**:
1. `validatePreflight()` runs (`StudioPage.jsx:216-222`): checks prompt non-empty, prompt ≤ `PROMPT_LIMIT` (2000), source image present if `needsSourceImage`, `canAfford`. Any failure → `setLocalError(err)` + `toast.error(err)`, generation does not start.
2. On pass: `setLocalError("")`, `cancelRequestedRef.current = false`, `updateSettings({ referenceImageUrl, negativePrompt, brandKit: applyBrandKit ? brandKit : null })`.
3. Calls `startGeneration(prompt.trim())` (`SessionStore.js:1126-1255`).
4. Store sets `isGenerating: true`, `generationProgress: 0`, `progressLabel: 'Preparing generation...'`.
5. `ensureSession(get, prompt)` — reuses `activeSession` if present; otherwise creates one, seeding the title via `ensureSessionFromPromptInput` → `generateSessionTitle` (calls `/api/session-title`, a Next API route, not an edge function) or a fallback truncated-prompt title.
6. Fetches current user (`supabase.auth.getUser()`) — throws `'Not authenticated'` if none.
7. `loadBrandKit(user.id)` (fresh fetch, not memoized against the `applyBrandKit` toggle's already-loaded `brandKit` prop — this call re-queries `brand_kit`/`brand_assets` regardless).
8. Dynamically imports `generationPipeline.js`; registers an `imageGenerator` closure that calls `generateImages(...)` (`media.service.js`) → invokes the `generateImage` edge function, and pushes progress updates (68% "Requesting image render...", 90% "Uploading...").
9. Loops `requestedVariants` times (`Math.max(1, Math.min(batchSize, 4))`), each calling `runGenerationPipeline` (`generationPipeline.js:91-180`):
   - Loads brand kit again (redundant third load across the whole flow — once in `StudioBody.brandKit` prop, once in `SessionStore.startGeneration`, once inside the pipeline itself), loads recent history (`historyLoader.js`, last 10 completed generations for context), builds a brief, calls `generate-content-plan` edge function (Groq, server-side Claude fallback) for a full `ContentPlan` JSON, validates/repairs it client-side, runs the brand quality gate (`qualityGate.js` — see step 10), inserts a row into `content_plans`, then `runSingleGeneration`: inserts a `generations` row (`status: PROCESSING`), calls the registered image generator, updates the row to `COMPLETED` with `storage_path`/metadata, or `FAILED` on error (re-thrown).
   - **Quality gate**: if `brandKit.configured` and any guardrail check fails (forbidden phrases, caption length, hashtag count, content restrictions), it calls `generate-content-plan` again in `mode: 'revision'`; if that call fails OR the revised plan still violates, `QualityGateBlockedError` is thrown and the whole pipeline call rejects (fails closed — generation does not proceed with violating content).
10. After all variants: `syncOrgScopeToGenerations(generationIds)` (only meaningful in org workspace — copies `organization_id`/`brand_project_id` onto the new rows and their eventual posts).
11. For each generated id: `ensureDraftForGeneration` — auto-creates a `posts` row with `status: DRAFT` if no post exists yet for that generation, and fires-and-forgets `scheduleDraftMetadataGeneration` (calls `generate-post-metadata` edge function to fill title/caption/hashtags in the background).
12. `touchSession` (bumps `sessions.updated_at`), `fetchGenerations(session.id, { silent: true })` (re-pulls all generations for the session without flipping the loading spinner since data already exists), `dispatchContentSync('generation-completed')` (fires a `socialai:data-sync` window event — refreshes `GeneratePageV2`'s search index).
13. `finally`: `isGenerating: false`, progress reset to 0/null regardless of outcome.
14. In `StudioPage.jsx`, an effect watches `isGenerating` to flip `studioStage` to `'generating'`, and a second effect flips it to `'results'` once `!isGenerating && completedGenerations.length > 0 && studioStage === 'generating'`.

**Failure/edge scenarios**:
- **No prompt**: button disabled client-side; `startGeneration` itself also early-returns silently (`if (!prompt) return;`) if somehow called with an empty string.
- **Not authenticated**: throws `'Not authenticated'`; caught by `handleGenerate`'s catch, shown via toast + `localError`. Note: this can only realistically happen if the session expired mid-flow, since the auth gate normally guarantees a user.
- **Network/edge function failure at any step** (content-plan, image render): the specific error message propagates up (image render failures come pre-normalized by `media.service.js`'s `toInvokeError`, which maps quota/billing/429 errors to a friendly "Media generation quota is exhausted..." message, and "not configured"/"missing"/"api key" errors to a "FAL_API_KEY secret" message). `logGenerationFailure` demotes these two "expected" categories to `console.warn` instead of `console.error`. All other errors are logged as `console.error` and re-thrown; `handleGenerate` shows them via `toast.error` + inline error box with a **Retry** button that just re-calls `handleGenerate`.
- **Partial-batch failure** (multi-variant): each variant loop iteration awaits `runGenerationPipeline` sequentially; if one variant throws, the loop itself is not wrapped in a per-iteration try/catch inside `startGeneration` — an error in variant 2 of 4 aborts the whole `startGeneration` call, meaning variants 1's already-completed `generations` row remains in the DB (orphaned success) while the overall action reports failure to the user. The single-generation pipeline's own internal try/catch only guarantees that specific row is marked `FAILED`, not that already-inserted sibling rows are cleaned up.
- **Quality gate block**: `QualityGateBlockedError` bubbles all the way up as a normal thrown error — same toast/error-box treatment as any other failure, with no special UI distinguishing "blocked by your own brand guardrails" from "the AI provider is down."
- **Rapid re-submit / double-click**: the Generate button's `disabled={!prompt.trim() || !canAfford || isGenerating}` prevents a second call once `isGenerating` flips true, but there's a window between click and the store's `set({ isGenerating: true, ... })` executing — since both are synchronous within the same tick in Zustand, this window is effectively zero in practice, but no explicit debounce/lock exists beyond the state flag itself.
- **Navigate away mid-generation**: no cleanup/abort logic exists for the sync image/carousel/edit paths — the async work continues even if `StudioPage` unmounts, since it's driven by the standalone Zustand store, not component state. If the user returns before it resolves, `isGenerating` will still be true and the UI reflects the in-flight state; if they never return, the generation still completes/fails and updates the DB row, but no in-app notification would ever surface it (no push/toast mechanism tied to a specific browser tab that has navigated away, though the Realtime subscription would still update the store's `activeGenerations` if the session is still the active one held in the module-level store — UNCLEAR whether the subscription channel itself survives if `subscribeToGenerations`'s cleanup ran on unmount, since `GeneratePageV2`'s effect for `subscribeToGenerations` has a cleanup `unsubscribe` that runs on component unmount).
- **Concurrent generations**: nothing prevents the user from triggering `startCarouselGeneration` and `startGeneration` "at once" if the UI ever allowed it, since `isGenerating` is a single global boolean shared by all generation types — the guard is purely UI-level (`disabled` prop), not enforced by the store itself re-checking `isGenerating` inside the action.
- **Quota exceeded (credits)**: pure client-side pre-check via `canAfford` (derived from `useCreditBalance` hook's realtime `user_credits.balance` vs. `estimateGenerationCost(settings)`); if `credits.ready` is false (not yet loaded), `canAfford` is forced `true` (fails open) meaning a user could click Generate before their real balance is known, deferring the true quota enforcement to the edge function itself (server-side check not traced in this stage — see Stage 5). This estimate is also explicitly documented as non-authoritative (`mediaGenerationOptions.js` header comment).

## 2. Generate — Carousel

**Trigger**: same `handleGenerate`, routed to `startCarouselGeneration(prompt, settings.slideCount || 6)` when `isCarousel` (`StudioPage.jsx:239`).

**Happy path** (`SessionStore.js:1257-1383`):
1. `updateSettings({ mediaType: 'image', contentType: 'carousel', slideCount: resolvedCount, batchSize: 1 })`.
2. Sets `isGenerating`, progress 0%, label `'Planning carousel...'`.
3. Same session/user/brand-kit resolution as single-image.
4. Registers an image generator closure (no per-call progress callback threading into UI here, unlike single image).
5. Calls `runGenerationPipeline` once (not per-slide) with `contentType: 'carousel'` — the LLM plan itself decides slide count/content; pipeline branches to `runCarouselOrchestration` (`generationPipeline.js:244-322`):
   - Generates a shared `batchId` (`crypto.randomUUID()`).
   - Inserts **all** slide placeholder rows upfront (`status: PROCESSING`) so the UI can show skeleton cards immediately — this is why the UI shows N skeleton placeholders during generation even before any image has rendered.
   - Sequentially (not parallel) renders each slide's image, updating that row to `COMPLETED`/`FAILED` as it finishes; a per-slide failure is caught, logged, and the loop **continues** to the next slide (explicit "partial carousel is better than none" comment) rather than aborting the whole carousel.
6. After the pipeline call: `syncOrgScopeToGenerations`, `touchSession`, `fetchGenerations(silent: true)`, then a second fetch of all session generations to look up each new row's final `status`, and for every row that ended `COMPLETED` (not the failed ones), `ensureDraftForGeneration` creates its own draft post.
7. `dispatchContentSync('carousel-completed')`; progress set to 100%/`'Done!'` right before the `finally` resets it to 0/null.
8. UI: `StudioPage.jsx`'s carousel results view is a horizontal filmstrip (`styles.filmstrip`) instead of a grid; clicking a slide opens the lightbox; "Regenerate whole carousel" re-triggers `handleModeChange('carousel')` (which does NOT start a new generation — it only resets settings, so this button's actual behavior is to reset mode/settings, not literally regenerate — UNCLEAR/likely a functional gap, the label implies an action it doesn't perform); "Use this carousel" calls `handleGoToPublish(completedGenerations[0])` — always publishes from the **first** completed slide's generation record.

**Failure/edge scenarios** (beyond the single-image ones):
- **Partial completion**: since per-slide failures are swallowed and the loop continues, a carousel can complete with, say, 4 of 6 slides `COMPLETED` and 2 `FAILED`. The UI's `completedGenerations` filter only shows the successful ones in the filmstrip — the user has no visible indicator that 2 slides silently failed unless they notice the missing count.
- **No slides in plan**: `runCarouselOrchestration` throws `'[Pipeline] Carousel has no slides in plan.'` if the LLM's plan produced zero slides — surfaces as a generic error toast.
- **"Use this carousel"** always anchors post-production to slide 1's generation row — if slide 1 specifically failed while others succeeded, `completedGenerations[0]` would be a *different* (still-completed) slide, since the array is pre-filtered to only completed ones; but if the *only* completed slide is not conceptually "slide 1" of the plan, captions generated from it may mismatch user intent (e.g., referencing "the hook slide" when slide 1 the hook failed and slide 3 succeeded).

## 3. Generate — Image Edit

**Trigger**: `startEditGeneration(sourceImageUrl.trim(), prompt.trim())`, when `selectedMode === 'edit'`.

**Happy path** (`SessionStore.js:1385-1510`):
1. Validates both `sourceImageUrl` and `prompt` are non-empty (throws otherwise — these are also checked by `validatePreflight` client-side first, so this is defense-in-depth).
2. Session/user/brand-kit resolution.
3. Inserts a `generations` row immediately with `status: PROCESSING`, `metadata.edit_mode: true`, `source_image_url`, `model: 'flux-pro/kontext'`, `provider: 'fal-ai'` — unlike single-image/carousel, this row is inserted directly by the store (not via the LLM-planning pipeline) — **no content-plan / quality-gate step runs for edits**.
4. Optimistically appends the new row into `activeGenerations` state immediately (before the actual edit call resolves) so the UI shows the pending item.
5. Calls `editImage(...)` (`media.service.js` → `editImage` edge function).
6. Updates the row to `COMPLETED` with `storage_path`, dimensions, provider metadata.
7. `touchSession`, `fetchGenerations(silent: true)`, `ensureDraftForGeneration`, `dispatchContentSync('edit-completed')`.
8. Returns the edited image URL directly (only generation action that returns a usable value to the caller, though `StudioPage.jsx`'s `handleGenerate` doesn't use the return value).

**Failure/edge scenarios**:
- On any error after the row insert, the `catch` block explicitly updates that specific row to `status: FAILED` (`SessionStore.js:1491-1499`) — unlike the single/carousel image path where failure marking happens inside the pipeline itself, here it's inline in the store action. If the row was never inserted (error before insert), no DB cleanup is needed since nothing exists yet.
- Missing source image or missing instruction throw synchronously before any state changes — caught by `handleGenerate`'s catch, standard toast/error-box treatment.
- `needsSourceImage` client validation in `validatePreflight` should prevent reaching the store without a source URL, but the source field is a raw text `<input>` with no URL-format validation — a malformed but non-empty string passes preflight and only fails at the edge-function/provider level.

## 4. Generate — Video (text-to-video / image-to-video)

**Trigger**: `startVideoGeneration(prompt.trim())`, when `isVideoMode`.

**Happy path** (`SessionStore.js:1512-1640`):
1. Clears any pre-existing `videoJobState.pollInterval` (defensive — see note below; no polling is actually set up in this implementation, this looks like a leftover guard from a previous async-polling design).
2. Sets `videoJobState` to `{ ...DEFAULT_VIDEO_JOB_STATE, status: 'submitting', prompt, progress: 10 }`, `isGenerating: true`.
3. Session/user/brand-kit resolution; determines `videoMode` (`'image-to-video'` if `settings.mediaType === 'image-to-video'`, else `'text-to-video'`); throws if image-to-video mode has no `referenceImageUrl`.
4. Calls `createVideoJob(...)` (`media.service.js` → `generateVideo` edge function). Per `media.service.js`'s own header comment, **the edge function renders synchronously** (fal.ai queue-polling happens server-side inside the edge function) — so despite the `videoJobState` naming implying an async background job with client-side polling, there is no actual client poll loop; the "job" resolves in a single request/response, just a potentially slow one.
5. If the response indicates `tierUpgraded` (requested `standard` quality without a source image, silently rendered as `premium` instead and billed accordingly), shows an info toast.
6. Inserts a `generations` row directly with `status: COMPLETED` and `progress: 100` immediately (never an intermediate `PROCESSING` row for video — inconsistent with the image/edit paths, which do insert a `PROCESSING` placeholder first).
7. Sets `videoJobState.status = COMPLETED`, `isGenerating: false` in the same success branch — the "Video jobs" drawer will show a completed entry, but by the time the request resolves the generation is already fully done.
8. `touchSession`, `fetchGenerations(silent: true)`, `ensureDraftForGeneration`, `dispatchContentSync('video-completed')`.

**Failure/edge scenarios**:
- On error: `videoJobState.status = FAILED`, `isGenerating: false`, `error: err.message` — the Video Jobs drawer shows a "failed" row with a **Retry** button that calls `dismissVideoJob()` then `handleGenerate()` again from scratch (loses the exact same prompt/settings only insofar as they're still in local component state, which they are, since `prompt`/`settings` weren't cleared).
- **Header video-processing indicator claims background survivability that doesn't exist as implemented**: `StudioPage.jsx`'s header shows "Video processing NN% ... safe to navigate anywhere" while `videoJobActive` (`isGenerating && isVideoMode`), and the Video Jobs drawer explicitly says "Video runs keep processing here even if you leave Studio" — but since the edge function call is a single synchronous `await createVideoJob(...)` inside a Zustand action (not a fire-and-forget server job with a job ID the client polls), navigating away and the component/store surviving is what actually keeps it "running" (the Zustand store is a module singleton, so as long as the browser tab stays open and no page fully reloads, the in-flight `fetch`/edge-function-invoke promise does continue). A full page reload or closing the tab would abandon the in-flight request with no server-side job to resume — UNCLEAR whether the edge function itself, once invoked, completes server-side regardless of client disconnection (likely yes, since Supabase Edge Functions run independently once invoked, but the client would never learn the outcome except via the Realtime subscription picking up the eventual DB write if the tab/store is still alive to receive it).
- **Cancel button behavior differs for video** (`handleCancelGenerate`, `StudioPage.jsx:258-266`): for video mode with an active `videoJobState.status`, cancel calls `dismissVideoJob()` (clears interval, resets `videoJobState`/`isGenerating`/progress) — but since there's no actual server-side job to cancel, this only stops the client from caring about the outcome; the underlying `createVideoJob` promise/edge-function call is **not aborted** and will still complete and write to the DB, silently, with the client no longer displaying it (a "ghost" completed generation the user has to discover later via session history).
- **Realtime double-path for completion**: the direct `await createVideoJob` success path AND the `subscribeToGenerations` realtime handler both contain logic to flip `videoJobState.status` to `COMPLETED`/`FAILED` when `updated.id === videoJobState.generationId` — since the direct-response path already resolves the video synchronously, the realtime path's video-specific branch (`SessionStore.js:2788-2825`, which also does `clearInterval(pollInterval)`) is effectively dead code for this particular flow (no `pollInterval` is ever set to a real interval ID in the current implementation — `DEFAULT_VIDEO_JOB_STATE.pollInterval` stays `null` throughout `startVideoGeneration`). This looks like surviving infrastructure from an earlier async-polling design that was replaced by the synchronous edge function but not fully cleaned up.

## 5. Cancel Generation

**Trigger**: "Cancel" button, visible only during `studioStage === 'generating'`.

- **Sync modes (image/carousel/edit)**: sets `cancelRequestedRef.current = true`, flips `studioStage` back to `'brief'` immediately, toasts "Generation cancelled". The underlying `start*Generation` promise is **not aborted** — it keeps running server-side/in the store; when it eventually resolves, the `isGenerating`-watching effect that would normally flip `studioStage` to `'results'` checks `!cancelRequestedRef.current` as a guard, so the stage transition is suppressed, but the resulting `generations`/`posts` rows are still written to the DB (credits, if consumed server-side, are not refunded by this cancel — explicitly called out in `StudioPage.jsx`'s code comment above `handleCancelGenerate`).
- **Video mode**: calls `dismissVideoJob()` instead (see above) — same "request keeps running, DB write still happens" caveat.

## 6. Retry After Failure

Two distinct retry affordances:
- **Inline error box** (`StudioPage.jsx:640-648`, shown whenever `localError || error` is truthy): "Retry" button just calls `handleGenerate()` again with whatever's currently in `prompt`/`settings` — a full fresh generation attempt, not a resume of the failed one.
- **Video Jobs drawer failed-job row**: "Retry" button calls `dismissVideoJob()` then `handleGenerate()` — same semantics, from-scratch retry.

No exponential backoff, no retry-count limiting, no idempotency key preventing duplicate `generations`/`content_plans` rows if the user mashes Retry repeatedly (each click is an entirely independent `startGeneration` call).
