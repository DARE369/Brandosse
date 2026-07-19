# Stage 3b — Journeys: Secondary Flows

## 1. Post-Production Entry ("Continue to post production")

**Trigger**: Button shown when `studioStage !== 'generating'` and `completedGenerations.length > 0` and not already in publish/published — calls `handleGoToPublish(selectedGeneration || completedGenerations[0])` (`StudioPage.jsx:734-738`).

**Happy path**:
1. `handleGoToPublish` (`StudioPage.jsx:268-274`) calls `selectGeneration(gen)` then `setStudioStage('publish')`.
2. `selectGeneration` (`SessionStore.js:1749-1771`) sets `selectedGenerationId`/`selectedGeneration` and mirrors the id into the URL hash via direct `window.history.replaceState`.
3. A `useEffect` in `GeneratePageV2.jsx` watching `selectedGeneration?.id` (`:219-232`) fires: sets `postPanelOpen` (unused downstream — see Stage 2 note), and unless `skipNextPostResetRef.current` is set (only true for the route-state repurpose/edit path), calls `resetPostProduction()` — wiping any previous title/caption/hashtags/SEO state back to defaults — then applies `prefillScheduleDate` if one was carried in from Calendar.
4. A separate effect in `StudioPage.jsx` (`:159-176`) watching `studioStage === 'publish' && selectedGeneration?.id`, gated by `automationRunRef` (once per generation id), auto-runs:
   - `hydratePostProductionFromGeneration(selectedGeneration.id)` — looks up existing `posts` rows for this generation, prefers a `DRAFT`/non-terminal one, splits its `caption` into caption+hashtags, populates `postProduction` from it (title, caption, hashtags, selectedPlatforms from `account_id`s, existing SEO score if any).
   - If after hydration the caption is still empty, calls `regeneratePostMetadata(['title','caption','hashtags'])` (invokes `generate-post-metadata` edge function).
   - Then calls `optimizeSeo()` (invokes `optimize-seo` edge function, rewrites+rescales, then internally calls `scoreSeo()` too) — wrapped in `.catch(() => {})`, so SEO failures are silently swallowed here (no toast, no error state) — "captions/scoring are optional" per the inline comment.
5. `PostProductionPanel` renders with the resulting `postProduction` state: title/caption inputs, hashtag chips, discovery-score bars (9 dimensions from `postProduction.seoBreakdown`), account dropdown (from `accounts` prop, sourced by `useConnectedAccounts`), and footer actions (Save as draft / Schedule / Publish now).

**Failure/edge scenarios**:
- If `hydratePostProductionFromGeneration` finds no `posts` rows at all (edge case: user reached publish stage on a generation that somehow has no auto-created draft — shouldn't normally happen since `ensureDraftForGeneration` runs after every successful generation, but could occur for a generation created before that logic existed, or if `ensureDraftForGeneration`'s own insert failed silently upstream), it returns `null`; `regeneratePostMetadata` is then called with no existing post, which falls back to invoking `generate-post-metadata` directly with just `generation_id` (no `post_id`) — the edge function's own behavior on this path is covered in Stage 5.
- Auto-hydrate runs only **once per generation id** via `automationRunRef` — if the user leaves publish stage and returns to the *same* generation, metadata/SEO auto-generation will not re-run even if the caption is still empty (e.g., a prior auto-generate attempt failed silently) — the user must manually trigger "Regenerate" via the UI (UNCLEAR: no explicit "Regenerate metadata" or "Re-score" button is visible in `PostProductionPanel.jsx`'s reviewed JSX — the store actions `regeneratePostMetadata`/`optimizeSeo`/`checkBrandConsistency` exist but no button in this panel calls them directly; they're only invoked by the automatic effect. This looks like an incomplete wiring — the panel shows a live discovery score but offers no manual re-score control).

## 2. Save as Draft

Two entry points: the brief panel's "Save as draft without generating" button (`StudioPage.jsx:608-622`, calls `saveDraft()` directly — but `saveDraft()` requires a `selectedGeneration`, so this button is only meaningfully usable if a generation is already selected; if none is selected, `saveDraft()` throws `'No generation selected'` and the resulting toast would read that raw message — UNCLEAR/likely UX gap, since the button is visually presented as available regardless of generation state) and `PostProductionPanel`'s "Save as draft" footer button (via `handleSaveDraft`, `StudioPage.jsx:286-297`).

**Happy path** (`saveDraft`, `SessionStore.js:2414-2500`):
1. Builds `finalCaption` (caption + normalized hashtags appended) and a `title` (explicit or derived from caption/prompt).
2. Looks up existing `posts` rows for the generation; reuses a `DRAFT` or other non-terminal (`SCHEDULED`/`FAILED`) row if one exists (validating the status transition via `assertPostStatusTransition`), otherwise inserts a new `DRAFT` row.
3. `ensureLibraryRowsForPosts` — inserts a `content_library_items` row if missing (idempotent, tolerates `42P01`/duplicate-table-missing errors by no-op).
4. If org-scoped, syncs asset-reference links (`syncOrgPostAssetLinks`).
5. Resets `selectedGeneration`/`postProduction` to defaults, clears the URL hash, dispatches `socialai:data-sync('draft-saved')`.
6. Returns `{ success: true, message: 'Saved to drafts!', status: DRAFT }`; caller toasts success and returns `studioStage` to `'brief'`.

**Failure/edge scenarios**:
- Any Supabase error (insert/update/library-row) throws and is caught by `handleSaveDraft`'s `catch`, toasted with the raw error message; `publishing` flag is reset in `finally` regardless.
- Because `saveDraft` resets `selectedGeneration` to `null` on success, if the save partially succeeds then a later step throws (e.g., library-row insert fails after the post upsert succeeded), the thrown error prevents the reset from ever running — leaving `postProduction`/`selectedGeneration` in their prior (now-stale) state, which the user could then resubmit, creating a duplicate reuse-lookup race (the second `saveDraft` call would find the just-created row via `existing.find(...)` and update it instead of double-inserting, so this is self-healing on retry, not a duplication risk).

## 3. Schedule

**Trigger**: "Schedule…" footer button → opens `scheduleOpen` modal (date/time inputs) → "Confirm schedule" → `handleConfirmSchedule` (`StudioPage.jsx:313-330`).

**Happy path**:
1. Validates both `scheduleDate` and `scheduleTime` are set (`toast.error('Pick a date and time.')` otherwise, modal stays open).
2. `updatePostProduction({ scheduleDate: new Date(`${date}T${time}`).toISOString() })`.
3. Calls `saveDraft()` (schedule is implemented as a draft save with a `scheduleDate` set — it does **not** call `publishContent`, so scheduled posts never pass through `publishContent`'s multi-account/status logic; they remain `status: DRAFT` in the DB with a `scheduled_at` **only if** a separate scheduler process elsewhere in the app promotes them — UNCLEAR/out of scope, not traced beyond this page. Note: `saveDraft`'s own insert/update payload sets `scheduled_at: null` explicitly (`SessionStore.js:2445`, `:2463`) — meaning the `postProduction.scheduleDate` set in step 2 is **never actually written to the `scheduled_at` column** by `saveDraft`. This is a functional bug/gap: the Schedule dialog visibly collects a date+time, shows a success toast referencing that date/time, but the underlying draft row is saved with `scheduled_at: null`).
4. On success: toast `'Scheduled for {date} {time}'` (or the store's own message, which would be the generic "Saved to drafts!" since `saveDraft` doesn't know about scheduling — the toast message construction actually prefers `result?.message` first, so the user sees "Saved to drafts!" instead of the schedule-specific text unless `result.message` were falsy), closes the modal, returns to `'brief'` stage.

**Failure/edge scenarios**: same as Save as Draft above (this reuses the same store action). Missing date/time is the only schedule-specific validation, purely client-side.

## 4. Publish Now

**Trigger**: "Publish now" footer button (disabled if `publishing` or no `selectedAccountId`) → opens `publishConfirmOpen` modal → "Publish now" confirm → `handleConfirmPublish` (`StudioPage.jsx:299-311`).

**Happy path** (`publishContent`, `SessionStore.js:2502-2725`):
1. Requires `postProduction.selectedPlatforms.length > 0` (throws `'Select at least one platform'` otherwise — though the confirm button is already disabled without a selection, so this is a defense-in-depth check, reachable only via a race or programmatic call).
2. Resolves all selected `connected_accounts` rows; throws if any selected account id no longer resolves to a platform (stale/deleted account).
3. `scheduleDate = postProduction.scheduleDate || now`; `isImmediatePublish = !postProduction.scheduleDate`; `status = SCHEDULED` if a schedule date is set, else `PUBLISHING`. (Note: this is the **actual** scheduling path that correctly writes `scheduled_at` — contrast with the dedicated Schedule dialog's `saveDraft` call above, which does not. There appear to be two divergent "scheduling" code paths in this store: one via `saveDraft` that silently drops the date, and this one inside `publishContent`, gated behind having no other schedule date set that would make `isImmediatePublish` false — reachable if `postProduction.scheduleDate` were set by some other means, e.g. the Calendar-handoff `prefillScheduleDate`, and the user then clicked "Publish now" instead of the Schedule dialog.)
4. Creates/updates one `posts` row per selected account (primary account reuses an existing draft/non-terminal row if present; secondary accounts get their own rows, matched by `account_id` if a matching non-terminal row already exists).
5. Ensures library rows for all new/updated post ids; deletes any now-stale leftover `DRAFT` rows for the same generation that weren't part of this publish batch (cleanup of duplicate drafts).
6. Syncs org asset links if org-scoped.
7. Resets `selectedGeneration`/`postProduction`, clears URL hash.
8. **If immediate publish**: calls `executeMockPublishAttempts` (`mockPublishWorkflow.js`) — sequentially invokes the `mock-publish` edge function once per target account, building a `publishRequestId` and de-duplicating concurrent calls with the same id via an in-memory `Set`. Emits a global `socialai:publish-complete` window event with per-attempt results (consumed by `MockPublishModal`, a page-agnostic global component mounted in `NextAppProviders`, not owned by Generate). Dispatches `socialai:data-sync` (`'post-published'` or `'post-publish-complete'` if any attempt failed). If any attempt failed, throws an `Error` carrying `publishEventDispatched: true` and `publishResults` — the calling `handleConfirmPublish` catches it and shows the summary message via `toast.error`, but **does not** distinguish "some accounts succeeded, others failed" from "everything failed" in the UI beyond whatever text `summary.message` contains (from `buildPublishSummary` in `mockPublishWorkflow.js`, which does phrase partial success distinctly, e.g. "Published 1 of 2 posts.").
9. **If scheduled** (schedule date was already set before hitting Publish now — an unusual but reachable path per note in step 3): dispatches `'post-scheduled'`, returns `{ success, message: 'Scheduled successfully!', status: SCHEDULED }` without ever calling the mock-publish edge function at all.
10. On success: `setPublishConfirmOpen(false)`, `setStudioStage('published')` — `PostProductionPanel` then renders its `published` view (a simple confirmation card with a "Generate another" button that resets to `'brief'` stage).

**Failure/edge scenarios**:
- **Stale connected account**: throws before any DB writes if a selected account id no longer has a resolvable `platform` — user sees a generic error toast, publish confirm modal likely stays open with `publishing` reset (UNCLEAR whether the modal auto-closes on error — `handleConfirmPublish`'s catch does not close `publishConfirmOpen`, so it remains open, allowing immediate retry).
- **Partial multi-account failure**: since `mockPublishWorkflow` runs attempts sequentially and always returns/dispatches a summary rather than throwing per-attempt, the DB-level `posts` rows for *all* selected accounts were already created/updated to `PUBLISHING`/`SCHEDULED` status **before** any mock-publish attempt runs (step 4 happens before step 8) — so even attempts that will go on to fail already have a `posts` row reflecting an in-progress publish; the actual pass/fail per account is only reflected via whatever the `mock-publish` edge function itself writes back (not traced here — see Stage 5), not by `publishContent`'s own DB writes.
- **Double-submit**: the Publish button is disabled while `publishing` is true and while no account is selected, but nothing server-side prevents two rapid `publishContent` calls with different account selections from racing on the same generation's draft-reuse lookup.
- **Session expiry mid-publish**: `supabase.auth.getUser()` would return no user; throws `'Not authenticated'`, caught generically.

## 5. Session Management

### Create session
- Implicitly created by `ensureSession`/`GeneratePageV2`'s init effect (see below) whenever the user starts generating with no `activeSession`, or navigates route-state that `requiresPersistedSession` with no existing session id in the URL.
- Explicitly via the history drawer's "New session" button (`onNewSession` prop → `createNewSession('New session', { projectId })`) — inserts a `sessions` row scoped to the current workspace (personal or org, via `withSessionScope`), optionally tagged to a project, sets it as `activeSession`, clears `activeGenerations`/`selectedGeneration`.

### Load / resume session
- URL-driven: `GeneratePageV2`'s init effect (`:234-286`) — if `sessionId` is present in the URL, calls `loadSession(sessionId)`; if that session doesn't exist/isn't the user's (`.maybeSingle()` returns null), and the current navigation `requiresPersistedSession` (came from a repurpose/edit/template/library-asset handoff), it falls back to creating a fresh `'Draft Session'` and redirecting to its URL; otherwise it clears the active session and redirects to bare `/app/generate`.
- Drawer-driven: `onResume` prop → `loadSession(s.id)` then closes the drawer (does **not** navigate the URL to `/app/generate/:id` — UNCLEAR/likely gap: resuming from the drawer updates the Zustand `activeSession` but leaves the browser URL unchanged, meaning a refresh after resuming would re-derive `sessionId` from the stale URL, not the resumed session).

### Delete session
- Drawer's per-row delete icon → confirmation modal → `deleteSession(id)` — deletes the `sessions` row (RLS/ownership scoped via `.eq('user_id', user.id)` plus workspace scope); if it was the active session, resets `activeSession`/`activeGenerations`/`selectedGeneration` to empty. Note: this only deletes the `sessions` row — no explicit cascade delete of the session's `generations`/`posts`/`content_plans` rows is issued from this client code; the confirmation modal's copy ("and its generations will be removed") implies a DB-level cascade (`ON DELETE CASCADE`) is relied upon — UNCLEAR/not verified in this stage (would need a migrations check, out of scope for this file).

### Rename session
- Inline edit in the drawer's "Current session" row, or per-row rename elsewhere — `updateSessionTitle(id, title)` updates `sessions.title`+`updated_at`; failures are only `console.error`'d, no user-facing toast (silent failure).

## 6. Project Management

- **Create**: drawer's "New project" form (name + color swatch) → `createProject(name, color)` — inserts into `studio_projects` with `sort_order = projects.length` (append-only ordering at creation time).
- **Rename**: inline per-project rename → `renameProject(id, name)`.
- **Delete**: confirmation modal → `deleteProject(id)` — deletes the `studio_projects` row; the DB's `ON DELETE SET NULL` on `sessions.project_id` (per code comment) re-homes affected sessions to "General" without any explicit client-side session update needed, though the store optimistically also does this in local state (`sessions: state.sessions.map(...)`).
- **Reorder**: up/down arrows per project row → `reorderProjects(orderedIds)` — optimistic local reorder, persisted via parallel `Promise.all` of individual `sort_order` updates; reverts local state if any update fails.

## 7. Search Generations (header/index search)

- `GeneratePageV2` loads a search index (`loadSearchIndex`, up to `GENERATION_SEARCH_LIMIT = 120` most-recent personal generations, joined with session titles) on mount, on `user.id` change, and on every `socialai:data-sync` window event (so it stays fresh after any generation/publish/draft action fires that event).
- `searchResults` (`useMemo`) filters `generationIndex` client-side (substring match on `title + prompt`, case-insensitive), capped to 8 results — **UNCLEAR**: no rendering of `searchResults`, `searchQuery` input, or a search box was found in `StudioPage.jsx`'s JSX — this search feature's state/logic exists entirely in `GeneratePageV2.jsx` but has no visible UI consumer in the reviewed component tree, suggesting either a dead/unfinished feature or a search UI that lives in a header component not covered by this page's own files (not found elsewhere in this audit's scope).
- This search is also explicitly scoped to personal generations only (`.is('organization_id', null)`) — would not surface org-workspace generations even if the user is currently in an org context.

## 8. Video Jobs Drawer

- Opened via header's video icon button. Shows the single current `videoJobState` (not a list/history of past video jobs — only one slot exists in state, so a second video generation overwrites the drawer's content for the previous one, and there is no persisted list of "jobs" beyond whatever `activeGenerations` happens to also contain).
- `processing` status renders a progress bar; `failed` shows a Retry button (`dismissVideoJob()` + `handleGenerate()`); `completed` shows "View result" (just closes the drawer — does not itself select/scroll to the video, relying on it already being visible in the results grid since `startVideoGeneration` already appended it to `activeGenerations`).
- Minimized state (`isMinimized`, toggled via `setVideoJobMinimized`) exists in store state but no call site in the reviewed `StudioPage.jsx`/other Studio files was found invoking `setVideoJobMinimized` — UNCLEAR, likely another unused/partially-wired piece of state (possibly meant for a floating minimized-job pill elsewhere in the design that was't implemented in this rebuild).

## 9. Lightbox

- `openLightbox(generation)` (grid card's maximize icon, or carousel filmstrip's slide click) → `selectGeneration(generation)` + computes index into `completedGenerations` + opens `StudioLightbox` (portal to `document.body`).
- Keyboard nav: `Escape` closes, `ArrowLeft`/`ArrowRight` step `lightboxIndex` (clamped to bounds, no wraparound).
- "Select this" → `selectGeneration(lightboxGeneration)` + close (keeps user on current stage). "Use for post" → close + `handleGoToPublish(lightboxGeneration)` (jumps straight to publish stage).

## 10. Brand Kit Onboarding Modal

- Shown once per browser session (`sessionStorage["brandKitPromptShown"]`) if `brandKit` is loaded and neither `setup_completed` nor `setup_skipped`.
- "Set up Brand Kit" → closes modal, navigates to `/app/settings/brand-kit` (leaves Generate entirely — journey boundary, that page's internals are out of scope).
- "Skip for now" → calls `skipSetup(userId)` (persists `brand_kit.setup_skipped = true` via `BrandKitStore.saveBrandKit`), closes modal. Once skipped, the modal will not reappear even in a new browser session (persisted server-side, not just the sessionStorage gate) unless `setup_skipped` is later reset elsewhere.

## 11. Route-State Handoffs (cross-page arrival journeys)

All handled by the single large effect in `GeneratePageV2.jsx:296-526`, keyed by a JSON digest (`routeStateHandledRef`) so each distinct route-state payload is only processed once even if the component re-renders.

- **Library asset handoff** (`libraryAssetId`/`useLibraryAssetId`): fetches the `media_assets` row, verifies ownership (`user_id` match — silently no-ops and clears route state if not owned, no error shown to the user), dispatches a `socialai:seed-prompt` window event with either a caller-provided `prefillPrompt` or an auto-generated default prompt referencing the asset's filename, attaches the asset as a `postProduction.assetReferences` entry, and records `generationLineage` (source `library_media`). **UNCLEAR**: no listener for `socialai:seed-prompt` was found in `StudioPage.jsx` — the prompt textarea's `value={prompt}` is local state with no window-event listener wiring it up, so this seeding mechanism appears disconnected from the current prompt input (possibly another casualty of the design-system-v2 rebuild not fully re-wiring an event contract the old implementation relied on).
- **Template handoff** (`templateId`): fetches `content_templates.caption_format`, dispatches the same `socialai:seed-prompt` event (same UNCLEAR/disconnected caveat above) with the template text as the prompt seed.
- **Repurpose/Edit handoff** (`repurposeFromPostId`/`editPostId`): fetches the source `posts` row (joined with its `generations` row); if the target generation lives in a *different* session than the current one, loads that session and redirects the URL to it with the generation id in the hash (re-triggers this same effect once more, now within the correct session, where it proceeds to the same-session branch below). Otherwise (same session or no session context yet): selects the generation (`selectGeneration`, preferring the live `activeGenerations` copy if present, else falling back to the joined DB row), strips hashtags out of the raw caption into `postProduction.hashtags`/`caption` separately, and pre-fills `postProduction` (`postId`, `title`, `caption`, `hashtags`, `selectedPlatforms` from `account_id`, `scheduleDate` if the post was `scheduled`). Sets `skipNextPostResetRef.current = true` so the subsequent `selectedGeneration` effect does not immediately wipe this pre-filled state via `resetPostProduction()`. If `activateEditMode` was requested, dispatches a `socialai:activate-generation-edit` window event after a `setTimeout(0)` — no listener for this event was found in the reviewed Studio files either (same category of disconnected wiring as the seed-prompt event).
- In all branches, `clearRouteState()` is called at the end to wipe `location.state` via a `replace` navigation, preventing re-processing on remount/refresh.

**Failure/edge scenarios for handoffs**:
- Any Supabase error during these lookups is only `console.error`'d (`'Failed to apply generate route state:'`) — no user-facing toast or error state, so a failed handoff (e.g., the source post was deleted between the originating page's render and this page's load) fails silently, leaving the user on a blank/default Generate page with no explanation of what didn't come through.
- The `activateEditMode`/`socialai:seed-prompt` disconnected-event issue above means several of these "seed the prompt" and "activate edit mode" handoffs may not visibly do anything in the current UI despite the data-fetching and event-dispatching logic executing successfully — a discrepancy between backend-appearing-successful and frontend-visibly-inert behavior worth flagging explicitly to the architecture reviewer.
