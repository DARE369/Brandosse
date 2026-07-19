# Stage 2 — State

## Zustand store: `useSessionStore` (`src/stores/SessionStore.js`)

Single global store, no persistence middleware (in-memory only — a hard refresh loses `settings`/`postProduction` unless re-derived from DB). Shape (initial state, `SessionStore.js:722-761`):

| Field | Type | Written by | Read by |
|---|---|---|---|
| `sessions` | `Session[]` | `fetchSessions`, `createNewSession`, `loadSession`, `deleteSession`, `updateSessionTitle` | `SessionHistoryDrawer` (via `StudioBody`) |
| `activeSession` | `Session\|null` | `createNewSession`, `loadSession`, `clearActiveSession` | `StudioBody` (session title/meta header), `ensureSession()` helper |
| `projects` | `Project[]` (`studio_projects` rows) | `fetchProjects`, `createProject`, `renameProject`, `deleteProject`, `reorderProjects` | `SessionHistoryDrawer` |
| `activeProject` | `Project\|null` | `setActiveProject`, `createProject`, `deleteProject` | `createNewSession` (default `project_id` when caller omits `options.projectId`) |
| `projectsLoading` | `boolean` | `fetchProjects` | `SessionHistoryDrawer` loading skeleton |
| `activeGenerations` | `Generation[]` | `fetchGenerations`, `createNewSession`/`loadSession` (reset), generation actions (append), realtime subscription (upsert) | `StudioBody` (results grid, lightbox), `GeneratePageV2` (hash-scroll target, search index refresh trigger) |
| `selectedGeneration` | `Generation\|null` | `selectGeneration`, `setSelectedGenerationId`, realtime subscription (if it's the selected one) | `StudioBody` (publish preview), `PostProductionPanel` (via prop), auto-hydrate effect |
| `selectedGenerationId` | `string\|null` | `selectGeneration`, `setSelectedGenerationId` | Variant grid selection highlighting; also mirrored into the URL hash (`window.history.replaceState`) |
| `generationsLoading` / `generationsError` | `boolean` / `string\|null` | `fetchGenerations` | Not directly rendered in `StudioPage.jsx` (UNCLEAR — no visible loading UI keyed off these two fields in the reviewed JSX; the page instead infers "empty" from `completedGenerations.length === 0`) |
| `isGenerating` | `boolean` | every `start*Generation` action (`true` at start, `false` in `finally`) | `StudioBody` stage-machine effect (`brief→generating`), Generate button disabled state, credit-pill logic n/a |
| `generationProgress` | `number` (0-100) | `onProgress` callbacks inside generation actions and the pipeline | Progress bar fill (`styles.loadingBarFill`), header video-processing indicator |
| `progressLabel` | `string\|null` | same as above | Loading-state subtitle text |
| `generationStage` | `string\|null` | same as above | Not directly rendered (superset info used internally for `mapStageProgress`) |
| `pendingClarifications` | `object` | `setClarifications`/`setPendingClarifications`/`clearClarifications` | `startGeneration` (passed into `runGenerationPipeline`) — UNCLEAR what UI ever calls `setClarifications`; not found in `StudioPage.jsx`, so this may be dead/unused from this page's current UI |
| `error` | `string\|null` | any action's `catch` block, `clearError` | Error box in canvas panel (`(localError \|\| error)`) |
| `videoJobState` | object (`jobId, generationId, providerEndpoint, prompt, status, progress, videoUrl, isMinimized, pollInterval`) | `startVideoGeneration`, `dismissVideoJob`, `setVideoJobMinimized`, realtime subscription | Header video-processing pill, Video Jobs drawer |
| `settings` | object (`mediaType, aspectRatio, batchSize, contentType, slideCount, model, imageModel, resolution, duration, fps, generateAudio, referenceImageUrl, negativePrompt*, brandKit*`) | `updateSettings` (shallow merge); `*` fields (`negativePrompt`, `brandKit`) injected ad hoc by `handleGenerate` right before calling a `start*Generation` action | Cost estimator (`estimateGenerationCost`), all format UI controls, generation actions |
| `postProduction` | object — see below | `updatePostProduction`, `resetPostProduction`, `hydratePostProductionFromGeneration`, `regeneratePostMetadata`, `scoreSeo`, `optimizeSeo`, `checkBrandConsistency`, `saveDraft`/`publishContent` (reset on success) | `PostProductionPanel`, `StudioBody`'s auto-hydrate effect |
| `generationLineage` | object\|null (`source, source_id, at, metadata`) | `setGenerationLineage` (called from `GeneratePageV2`'s route-state effect) | Attached as `metadata.lineage` on newly-created `generations` rows |
| `sessionsLoading` | `boolean` | `fetchSessions` | `SessionHistoryDrawer` loading skeleton (combined with `projectsLoading`) |

### `postProduction` shape (`DEFAULT_POST_PRODUCTION`, `SessionStore.js:47-70`)
```js
{
  postId: null, title: '', caption: '', hashtags: [],
  seoScore: 0, seoCategory: 'Not scored', seoBreakdown: {...9 zeroed dims},
  seoSuggestions: [], seoBenchmarkReport: [], seoHashtagSuggestions: [],
  seoStatus: 'idle', seoProvider: null,
  selectedPlatforms: [], scheduleDate: null, assetReferences: [],
  metadataStatus: 'idle', metadataUpdatedAt: null,
  brandConsistencyStatus: 'idle', brandConsistencyScore: null,
  brandConsistencyPass: null, brandConsistencyIssues: [], brandConsistencyNotes: [],
}
```
`updatePostProduction` has a side effect: if the patch touches `title`/`caption`/`hashtags`, it force-resets `seoStatus` to `'idle'` (stale-score invalidation) — `SessionStore.js:2214-2228`.

## Zustand store: `useBrandKitStore` (`src/stores/BrandKitStore.js`)

Consumed here only for: `brandKit` (derived "kit being viewed" — actually the *active* kit is what `loadBrandKit`/`activeKit` resolves to, aliased for Studio's purposes), `loadBrandKit(userId)`. Full multi-kit CRUD state (`kits`, `currentKitId`, `assets`, diff-modal state, etc.) is Brand-Kit-page-only and out of scope for Generate beyond read access to the active kit.

## Zustand store: `useOrgRuntimeStore` (`src/org/stores/orgRuntimeStore.js`)

Holds `{ organizationId, brandProjectId, organization, brandProject, role, permissions, source }`. `GeneratePageV2` writes it (`setOrgRuntimeContext`) when `location.state.orgContext` is present, and clears it (`clearOrgRuntimeContext('route-state')`) on unmount/dependency change. `SessionStore.js` reads it via `getOrgRuntimeContext()` in several helpers (`getActiveOrgScope`, `getSessionScope`, `withOrgScope`, `applySessionScope`, `applyGenerationScope`) to silently scope every session/generation/post read-write to `organization_id`/`brand_project_id` instead of the personal (`organization_id IS NULL`) workspace. This is a cross-cutting, page-invisible scope switch — the same Generate UI serves both personal and org workspaces depending on this store's contents.

## Local component state — `GeneratePageV2.jsx`

| State | Purpose | Lifecycle |
|---|---|---|
| `postPanelOpen` | Unused by rendering in reviewed code beyond being set — UNCLEAR: set true when `selectedGeneration` exists, set false in `handleClosePostPanel`, but no JSX in `GeneratePageV2.jsx` reads it (the actual publish-panel visibility is driven by `StudioBody`'s own `studioStage`, a separate variable) | Session-scoped |
| `showOnboarding` | Controls `BrandKitOnboardingModal` visibility | Set once per browser session via `sessionStorage["brandKitPromptShown"]` gate |
| `prefillScheduleDate` | Holds a date carried in from Calendar's `prefillDate` route state until a generation is selected | Cleared after being applied to `postProduction.scheduleDate` |
| `searchQuery` / `searchLoading` / `generationIndex` | Header search-across-generations feature | `generationIndex` refetched on mount, on `user.id` change, and on a global `socialai:data-sync` window event |
| `creatingSessionRef`, `routeStateHandledRef`, `skipNextPostResetRef` (refs, not state) | Guard flags to prevent duplicate session creation, duplicate route-state processing (keyed by a JSON digest), and an unwanted `resetPostProduction()` right after a route-state-driven `selectGeneration` | Ref lifetime = component instance |

`sessionId` itself is **not** local state — it's `sessionIdProp ?? getSessionIdFromPathname(location.pathname)`, recomputed every render from the prop/URL (URL is the source of truth for which session is active at the route level; the Zustand `activeSession` is the source of truth for the loaded session object).

## Local component state — `StudioPage.jsx` (`StudioBody`)

| State | Purpose |
|---|---|
| `prompt` | Freeform prompt text (mirrors `guidedFields` when `guided` mode is on, capped at `PROMPT_LIMIT`=2000) |
| `sourceImageUrl` | Manually-pasted source image URL for edit / image-to-video modes |
| `enhancing` | Loading flag for "Enhance prompt" button |
| `localError` | Client-side validation error (separate from store's `error`, which is server/generation error) |
| `publishing` | Loading flag for save-draft/schedule/publish actions |
| `studioStage` | `'brief' \| 'generating' \| 'results' \| 'publish' \| 'published'` — the core UI state machine |
| `guided` / `guidedFields` | Toggle + values for the guided-prompt-builder alternative to freeform prompt |
| `negativePrompt` | Free text, folded into `settings` right before generation |
| `applyBrandKit` | Toggle; when true, `brandKit` object is attached to `settings.brandKit` before generating |
| `lightboxOpen` / `lightboxIndex` | Lightbox visibility + current index into `completedGenerations` |
| `historyOpen` | Session-history drawer visibility |
| `mobileNavOpen` | Mobile nav drawer visibility |
| `videoJobsOpen` | Video-jobs drawer visibility |
| `scheduleOpen` / `scheduleDate` / `scheduleTime` | Schedule modal visibility + draft date/time inputs |
| `publishConfirmOpen` | Publish confirmation modal visibility |
| `deleteSessionTarget` / `deleteProjectTarget` | Holds the session/project object pending delete confirmation |
| `slideSelection` | Declared but not observed being read/written anywhere else in the reviewed file — UNCLEAR / likely dead state |
| `cancelRequestedRef` (ref) | Signals in-flight generation should be treated as cancelled when it resolves |
| `promptRef` (ref) | DOM ref for textarea auto-resize |
| `automationRunRef` (ref, `Set`) | Dedup guard so the publish-stage auto-hydrate effect only runs once per `selectedGeneration.id` |

### Derived / memoized state
- `selectedMode` (`useMemo` on `settings.mediaType`/`settings.contentType`) — one of `image-to-video|edit|video|carousel|image`
- `cost` (`useMemo(() => estimateGenerationCost(settings), [settings])`) — client-side credit estimate, not authoritative (edge functions compute real cost)
- `completedGenerations` (`useMemo` filter of `activeGenerations` where `status === 'completed'`)
- `lightboxGeneration` — derived from `completedGenerations[lightboxIndex]`
- `canAfford` — `!credits.ready || availableCredits >= cost` (fails open while credits haven't loaded yet)
- `isCarousel`, `isVideoMode`, `needsSourceImage` — booleans derived from `selectedMode`

### Optimistic updates
- `reorderProjects` in `SessionStore.js` (`:972-988`) applies the new order to `projects` state immediately, then persists each row's `sort_order`; on any failure it reverts to the previous in-memory `projects` array.
- No other optimistic-update pattern found in this store; all other mutations wait for the Supabase response before updating state.

## URL state

- The session id is encoded in the pathname (`/app/generate/:sessionId`), read via Next's route param or regex-parsed from `location.pathname`.
- The selected generation id is encoded in the URL **hash** (`#<generationId>`), both directions:
  - Read: `GeneratePageV2`'s effect on `location.hash` calls `setSelectedGenerationId` and scrolls the matching `#gen-card-<id>` element into view after a 240ms timeout.
  - Written: `selectGeneration`/`saveDraft`/`publishContent`/`clearActiveSession` all call `window.history.replaceState` directly (bypassing the app's `navigate()` abstraction) to set or clear the hash.
- `clearRouteState` (`GeneratePageV2.jsx:97-102`) calls `navigate(...)` with `{ replace: true, state: {} }` on the *same* pathname/search/hash to wipe `location.state` once route-state (repurpose/template/library-asset) has been consumed — prevents re-processing on remount.

## sessionStorage / localStorage

- `sessionStorage["brandKitPromptShown"]` — gates the onboarding modal to once per browser session (`GeneratePageV2.jsx:206-211`).
- `localStorage["studio-session-drawer-expanded"]` — remembers which project/General section is expanded in the history drawer, read via `readExpanded()` (`SessionHistoryDrawer.jsx:16-23`), defaults to General, wrapped in try/catch for private-browsing mode.
- `sessionStorage` key used by `edgeFunctionClient.js` (`socialai_edge_function_unavailable_until:<fn>`) — a 5-minute cooldown cache so repeated edge-function-unreachable errors don't hammer the function; not written by this page's code directly but consulted by `isEdgeFunctionUnavailable`/`markEdgeFunctionUnavailable` helpers used in error paths (UNCLEAR whether any call site in this flow actually invokes `markEdgeFunctionUnavailable` — not observed being called in `SessionStore.js`; the helpers exist but this page's code paths mostly throw normalized errors without marking the cooldown).

## Lifecycle summary

- **Initializes on mount**: brand kit load, generation search index, realtime subscription, session init effect (load-or-create session from `sessionId`/route-state), `fetchSessions`/`fetchProjects` (in `StudioBody`, not `GeneratePageV2` — comment notes this replaces a deleted breadcrumb component that used to own it).
- **Persists across navigation within `/app/generate/*`**: all Zustand store state survives React unmount/remount as long as the store module itself isn't reset, since routing between `/app/generate` and `/app/generate/:id` re-renders the same subtree rather than a hard navigation in an SPA sense — but this is a Next.js App Router app, so actual navigation could remount the page tree; the store persists because it's a module-level singleton independent of component lifecycle.
- **Resets**: `clearActiveSession()` (session/generations/postProduction wiped) when navigating to `/app/generate` with no persisted-session requirement; `reset()` is a full-store reset (not observed being called from this page — likely used at logout, see `LogoutContext` — UNCLEAR, not traced).
- **Survives refresh**: No — Zustand state is in-memory only; a hard refresh re-runs the mount effects, which re-fetch `sessions`/`generations` from Supabase using the URL's `sessionId`, effectively "rehydrating" from the DB rather than from any client persistence layer.
