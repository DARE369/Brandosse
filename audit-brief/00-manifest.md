# Generate Page — Audit Manifest

## What the Generate page does

The Generate page (routed at `/app/generate` and `/app/generate/[sessionId]`) is the AI content-creation workspace of this social-media SaaS ("Studio"). A user writes a prompt, picks a mode (single image, carousel, text-to-video, image-to-video, image edit), configures format options (aspect ratio, batch size, slide count, video duration/quality), optionally applies their Brand Kit, and generates media via fal.ai-backed Supabase Edge Functions. Generated variants are shown in a results grid; the user selects one, moves to a "post production" stage where title/caption/hashtags are AI-drafted and SEO-scored, picks a connected social account, and either saves a draft, schedules, or "publishes" (a simulated/mock publish, not a real social API call). Sessions and multi-session "projects" persist generation history; a Supabase Realtime subscription keeps generation status in sync (important for async video jobs).

## File inventory

### Routing (Next.js app router)
| File | Role |
|---|---|
| `app/app/generate/page.jsx` | Route `/app/generate` — renders `GeneratePageV2` with no sessionId |
| `app/app/generate/[sessionId]/page.jsx` | Route `/app/generate/:sessionId` — renders `GeneratePageV2` with sessionId param |
| `app/generate/page.jsx` | Legacy path — `redirect("/app/generate")` |
| `app/app/layout.jsx` | Wraps `/app/*` in `NextAppProviders` (auth gate) |
| `src/next/NextAppProviders.jsx` | Auth/theme/query providers + `NextAppAccessGate` (redirects to `/login` if unauthenticated) |

### Page / orchestration
| File | Role |
|---|---|
| `src/pages/GeneratePage/GeneratePageV2.jsx` | Top-level page component: session routing, route-state handling (repurpose/edit/template/library-asset), search index, brand-kit onboarding modal trigger, realtime subscription bootstrap. Renders `StudioPage`. |
| `src/pages/Studio/StudioPage.jsx` | The actual Studio UI: brief panel, canvas/results, publish flow, modals, drawers. Holds most local UI state and stage machine (`brief → generating → results → publish → published`). |
| `src/pages/Studio/PostProductionPanel.jsx` | Publish-stage side panel: title/caption/hashtags editor, discovery-score display, account picker, save/schedule/publish actions |
| `src/pages/Studio/SessionHistoryDrawer.jsx` | Session/project history drawer: list, search, rename, delete, project CRUD/reorder |
| `src/pages/Studio/StudioLightbox.jsx` | Full-size generation viewer/carousel modal (portal) |
| `src/components/BrandKit/BrandKitOnboardingModal.jsx` | One-time-per-session modal prompting brand kit setup |

### State / store
| File | Role |
|---|---|
| `src/stores/SessionStore.js` | Central Zustand store: sessions, projects, generations, generation actions (image/carousel/edit/video), post-production (caption/SEO/publish), realtime subscription. ~2875 lines. |
| `src/stores/BrandKitStore.js` | Zustand store for brand kit CRUD/multi-kit selection; Studio reads `brandKit`/`loadBrandKit` (aliases onto `loadKits`) |
| `src/org/stores/orgRuntimeStore.js` | Zustand store holding active org/brand-project context (Generate page can run in "organization" workspace scope) |

### Services (business logic / API clients)
| File | Role |
|---|---|
| `src/services/generationPipeline.js` | Canonical orchestrator for single-image and carousel generation: brand kit → history → brief → Groq content plan → quality gate → DB insert → image render |
| `src/services/briefBuilder.js` | Assembles `GenerationBrief` object passed to the content-plan LLM call |
| `src/services/groqClient.js` | Client for `generate-content-plan` edge function (plan/revision), plus generic JSON/vision LLM helpers (browser-side keys disabled) |
| `src/services/contentPlanValidator.js` | Validates/auto-repairs the raw LLM ContentPlan JSON |
| `src/services/qualityGate.js` | Brand-guardrail checker; requests one revision from the LLM, blocks generation (`QualityGateBlockedError`) if violations persist |
| `src/services/historyLoader.js` | Loads recent completed generations as LLM context |
| `src/services/brandKitLoader.js` | Loads the active brand kit + ready assets, condenses into prompt-ready summary |
| `src/services/media.service.js` | Client wrapper for `generateImage`/`editImage`/`generateVideo` edge functions (fal.ai) |
| `src/services/sessionTitleService.js` | Calls `/api/session-title` (Next API route, not a Supabase edge function) to name a new session from the first prompt |
| `src/services/edgeFunctionClient.js` | Shared edge-function error normalization/availability-caching helpers |
| `src/services/contentLibraryService.js` | Ensures `content_library_items` rows exist for posts |
| `src/services/platforms/mockPublishWorkflow.js` | Orchestrates sequential mock-publish attempts, dedupes in-flight requests, emits `socialai:publish-complete` |
| `src/services/platforms/mockPublishService.js` | Thin client for the `mock-publish` edge function |
| `src/services/ApiService.js` | Legacy fallback API helper (`enhancePrompt`) — used only if the `enhance-prompt` edge function fails |
| `src/org/services/assetLibraryService.js` | Org asset-post link fetch/sync (used by post-production for org-scoped asset references) |
| `src/org/services/orgDraftWorkflowService.js` | Requests org-scoped draft metadata generation |

### Hooks / config / constants
| File | Role |
|---|---|
| `src/hooks/useCreditBalance.js` | Realtime credit balance (and spend-by-category) hook, backed by `user_credits`/`credit_transactions` |
| `src/components/GenerateStudio/hooks/useConnectedAccounts.js` | Fetches user's connected social accounts |
| `src/components/GenerateStudio/shared/constants.js` | `PROMPT_LIMIT`, SEO dimension labels, platform caption hints, prompt suggestions (some unused by current UI) |
| `src/config/mediaGenerationOptions.js` | UI option lists (content types, aspect ratios, video durations/quality tiers) + client-side credit-cost estimator |
| `src/constants/statuses.js` | Canonical `GENERATION_STATUS`, `POST_STATUS` enums (also pipeline/org enums unrelated to this page) |
| `src/utils/postStatusMachine.js` | Post status transition validation (`assertPostStatusTransition`) |

### Edge functions (Supabase, Deno) touched by this page
| Function | Role |
|---|---|
| `generateImage` | Renders image via fal.ai, uploads to storage |
| `editImage` | Image-edit via fal.ai (flux-pro/kontext) |
| `generateVideo` | Text/image-to-video via fal.ai (Hailuo/Kling) |
| `generate-content-plan` | LLM content-plan generation + revision (Groq w/ Claude fallback) |
| `enhance-prompt` | Prompt enhancement suggestions |
| `generate-post-metadata` | AI title/caption/hashtags for a draft post |
| `generate-caption` | Legacy/direct caption generator (still called by `generateCaption` store action) |
| `seo-score` | "Discovery readiness" scoring of title/caption/hashtags |
| `optimize-seo` | Rewrites title/caption/hashtags for SEO, then re-scores |
| `ai-brand-consistency-check` | Org-only brand-voice compliance check |
| `mock-publish` | Simulated publish to a connected account |
| `generate-session-title` | Not directly confirmed as called from this page's client code — session title instead goes through `/api/session-title` Next route (see historyLoader/sessionTitleService) — UNCLEAR whether this edge function is a legacy duplicate |

## Distinct features/actions on this page

1. **Mode selection** — image / carousel / text-to-video / image-to-video / image-edit
2. **Prompt entry** — freeform textarea or "guided fields" (subject/setting/style/mood)
3. **Enhance prompt** — AI rewrite of the prompt
4. **Format configuration** — aspect ratio, batch size (image), slide count (carousel), duration+quality (video)
5. **Apply brand kit toggle**
6. **Target platform selection** (pre-selecting connected accounts before generation)
7. **Generate** — the core action; branches to 4 different store methods depending on mode
8. **Cancel generation** — client-side abort for sync modes; job-dismiss for video
9. **Retry after failure**
10. **View variants / select a variant** — grid or carousel filmstrip
11. **Lightbox view** (maximize a variant, prev/next, "select"/"use for post")
12. **Continue to post production**
13. **Post-production editing** — title, caption, hashtags (add/remove)
14. **Auto-hydrate captions on entering publish stage** (auto-generates metadata + SEO score if empty)
15. **Regenerate post metadata** (title/caption/hashtags)
16. **SEO scoring** (`scoreSeo`) and **SEO optimization** (`optimizeSeo`)
17. **Brand consistency check** (org-only)
18. **Save as draft** (with or without generating first)
19. **Schedule** (date/time picker → draft with `scheduled_at`)
20. **Publish now** (confirm modal → mock publish attempts)
21. **Session management** — create, rename, delete, resume, list (history drawer)
22. **Project management** — create, rename, delete, reorder (folders for sessions)
23. **Search generations** (header/index search across last 120 generations)
24. **Video job tracking** — background job panel, minimized indicator, dismiss/retry
25. **Brand-kit onboarding modal** (first-time nudge)
26. **Route-state driven prefills** — repurpose-from-post, edit-post, template, library-asset handoffs from other pages

## Stack summary

- **Framework**: Next.js App Router (`app/app/generate/...`), React 18, client components (`"use client"`)
- **State**: Zustand (`SessionStore`, `BrandKitStore`, `orgRuntimeStore`) — no Redux/Context-based reducer for domain state
- **Data fetching**: Direct Supabase JS client calls (`supabase.from(...)`) + `supabase.functions.invoke(...)` for edge functions; no React Query used by this page directly (TanStack Query is configured app-wide in `NextAppProviders` but Studio/SessionStore bypasses it)
- **Realtime**: Supabase Realtime (`postgres_changes` on `generations` table)
- **Backend/DB**: Supabase Postgres + Supabase Edge Functions (Deno)
- **AI providers**: Groq (primary LLM for content plan / metadata, with server-side Claude fallback per code comments), fal.ai (image/video/edit generation)
- **Styling**: CSS Modules + `ui-v2` design-system component library

## COMPLETION CHECK

Files produced (all under `audit-brief/`):
- `00-manifest.md` (this file)
- `01-architecture.md` — routes, auth guard, component tree, shared vs. exclusive components, code-splitting
- `02-state.md` — Zustand stores (`SessionStore`, `BrandKitStore`, `orgRuntimeStore`), local component state, URL/hash state, storage keys, lifecycle
- `03a-journeys-core.md` — generate (image/carousel/edit/video), cancel, retry
- `03b-journeys-secondary.md` — post-production, save draft, schedule, publish, sessions/projects, search, video jobs drawer, lightbox, brand-kit onboarding, route-state handoffs
- `04-api-layer.md` — direct Postgres calls, edge function call sites/payloads, caching/retry/polling posture, realtime subscription
- `05a-edge-functions-media.md` — `generateImage`, `editImage`, `generateVideo`
- `05b-edge-functions-content.md` — shared `_shared/llm.ts` dispatcher, `generate-content-plan`, `enhance-prompt`, `generate-post-metadata`, `generate-caption`
- `05c-edge-functions-seo-publish.md` — `seo-score`, `optimize-seo`, `ai-brand-consistency-check`, `mock-publish`
- `06-data-and-crosscutting.md` — tables/RLS/triggers, error handling, logging/analytics, credits/quota, feature flags, flagged TODOs/hacks

## Areas not fully traced (flagged, not silently dropped)

- **`_shared/supabase.ts`, `_shared/http.ts`, `_shared/org.ts`, `_shared/fal.service.ts`, `_shared/composite.ts`, `_shared/mockPublish.ts`, `_shared/connectionHelpers.ts`** — referenced and their call-site behavior inferred throughout Stage 5, but their internal implementations were not read line-by-line (would materially help confirm exact HTTP status mapping for untyped errors, e.g. in `generate-post-metadata`).
- **`deduct_credits` Postgres RPC** and the `ensure_draft_post_for_generation()` / `create_library_item_from_post()` / `lock_terminal_posts()` / `sync_generation_org_scope_to_posts()` trigger function bodies — existence, triggers, and effects are documented from migration comments, but their SQL bodies were not read; the exact locking/atomicity behavior of credit deduction and the precise overlap between client-side and DB-trigger draft/library-row creation (flagged in Stage 6) would need those bodies to fully confirm.
- **`ApiService.js: enhancePrompt`** (the client-side fallback used only if the `enhance-prompt` edge function itself throws) — role confirmed via import/call site, internals not read.
- **`mockPublishService`'s downstream `runMockPublish` (`_shared/mockPublish.ts`)** — not read; exact success/failure simulation logic and `mock_publish_logs` write shape are inferred, not confirmed.
- **Whether any UI component actually renders `GeneratePageV2`'s search feature** (`searchQuery`/`searchResults`) — flagged as UNCLEAR in Stage 3b; no consuming JSX was found in the files scoped to this page, but a header/nav component outside this audit's file set could still own it.
- **Listeners for `socialai:seed-prompt` / `socialai:activate-generation-edit`** — none found in the reviewed Studio files; flagged as likely dead/disconnected wiring in Stage 3b/6, but a listener elsewhere in the broader codebase (outside this page's direct file set) was not exhaustively ruled out.
- **Live RLS policy state** for `generations`/`posts`/`sessions` — the baseline migration file itself flags multiple historical policies that may or may not have been dropped by later migrations; this audit reproduces that documented ambiguity rather than resolving it via live DB introspection (out of scope for a static-code audit).
- **`mock_publish_logs` table DDL** — role and key columns inferred from the `mock-publish` edge function's queries; the table's own migration was not located/read in this pass.
- **Whether `generate-session-title` (edge function) is legacy/duplicate** of the `/api/session-title` Next route actually used by `sessionTitleService.js` — noted as UNCLEAR in the manifest's function table; not resolved.
