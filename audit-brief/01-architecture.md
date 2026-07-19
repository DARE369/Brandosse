# Stage 1 — Architecture

## Routes

- `app/app/generate/page.jsx` → `/app/generate` — no session id, renders `<GeneratePageV2 />`.
- `app/app/generate/[sessionId]/page.jsx` → `/app/generate/:sessionId` — server component (`async function`, awaits `params`), renders `<GeneratePageV2 sessionId={sessionId} />`.
- `app/generate/page.jsx` → `/generate` legacy path, does `redirect("/app/generate")` (Next.js `redirect`), no rendering of Studio itself.

Both real routes render the exact same client component tree; the only difference is whether a `sessionId` prop is passed in vs. derived from the pathname client-side (`getSessionIdFromPathname` in `GeneratePageV2.jsx:56-59`, regex `^/app/generate/([^/?#]+)`).

## Route guard / auth requirement

- `app/app/layout.jsx` wraps every `/app/*` route in `NextAppProviders` (`src/next/NextAppProviders.jsx`).
- Inside it, `NextAppAccessGate` (`src/next/NextAppProviders.jsx:19-81`) reads `useAuth()` (`user`, `loading`). While `loading` or `user === undefined`, it renders a full-screen `AuthLoadingOverlay` (blocks the whole route). If resolved and `!user`, it stores the intended path in `sessionStorage["socialai-redirect-after-login"]` and navigates to `/login`, rendering another `AuthLoadingOverlay` meanwhile. Only once `user` is truthy does `children` (eventually `GeneratePageV2`) render.
- No additional per-page guard exists inside `GeneratePageV2` or `StudioPage` — auth is fully handled at the layout level. Role/org access resolution happens in the background and is not blocking for this route (comment at `NextAppProviders.jsx:76-79` says admin/org routes gate themselves separately; Generate does not need elevated access).

## Arrival from other pages (journey boundaries only)

`GeneratePageV2` reacts to React Router/Next `location.state` passed by the caller — it does not know the internals of the source page, only these fields:
- `repurposeFromPostId` / `editPostId` — from Library or Calendar "repurpose/edit" actions; page loads the source post + its generation and seeds post-production.
- `templateId` — from a templates picker; seeds the prompt from `content_templates.caption_format`.
- `libraryAssetId` / `useLibraryAssetId` (+ optional `libraryLineage`) — from the Library page "use this asset" action; seeds an asset reference + a generated prompt.
- `orgContext` — from Org pages, carries `organizationId`/`brandProjectId`/etc. to scope the whole session to an organization workspace via `setOrgRuntimeContext`.
- `prefillDate` — from Calendar "new post on this date"; becomes `prefillScheduleDate`, applied to `postProduction.scheduleDate` once a generation is selected.
- `activateEditMode` — dispatches a `socialai:activate-generation-edit` window event once the target generation is selected (consumed elsewhere, not in this page's own code — UNCLEAR which component listens, not found in `Studio*` files).

None of these source pages' internals are covered here — only the contract at the boundary.

## Component tree (parent → children)

```
app/app/generate/page.jsx | app/app/generate/[sessionId]/page.jsx
  └─ GeneratePageV2                          src/pages/GeneratePage/GeneratePageV2.jsx
       ├─ <Toaster>                          react-hot-toast (global toast host)
       ├─ StudioPage                         src/pages/Studio/StudioPage.jsx
       │    └─ UiV2ThemeProvider             src/ui-v2/ThemeProvider.jsx
       │         └─ StudioBody (internal)     — the actual UI, all local state lives here
       │              ├─ AppHeader            src/ui-v2 (shared)
       │              │    ├─ ThemeToggleButton (local, in StudioPage.jsx)
       │              │    ├─ CreditPill / Skeleton   src/ui-v2 (shared)
       │              │    ├─ IconButton (Video jobs) src/ui-v2 (shared)
       │              │    └─ Avatar                  src/ui-v2 (shared)
       │              ├─ MobileNavDrawer      src/ui-v2 (shared)
       │              ├─ Brief panel (Cards): mode chips, prompt textarea/guided fields,
       │              │    format controls, brand-kit toggle, target platforms, cost/generate button
       │              │    — all built from src/ui-v2 primitives (Card, Button, Skeleton, EmptyState)
       │              ├─ Canvas panel: loading skeletons, variant grid / carousel filmstrip,
       │              │    selected-generation preview
       │              ├─ PostProductionPanel  src/pages/Studio/PostProductionPanel.jsx
       │              │    └─ Card, Badge, Button, Dropdown  src/ui-v2 (shared)
       │              ├─ Modal (Schedule dialog)      src/ui-v2 (shared)
       │              ├─ Modal (Publish confirm)      src/ui-v2 (shared)
       │              ├─ Drawer (Video jobs panel)    src/ui-v2 (shared)
       │              ├─ SessionHistoryDrawer  src/pages/Studio/SessionHistoryDrawer.jsx
       │              │    └─ ProjectSection (internal) — Drawer/EmptyState/Button/Skeleton (src/ui-v2)
       │              ├─ Modal (Delete session confirm)   src/ui-v2 (shared)
       │              ├─ Modal (Delete project confirm)   src/ui-v2 (shared)
       │              └─ StudioLightbox       src/pages/Studio/StudioLightbox.jsx  (React portal to document.body)
       └─ BrandKitOnboardingModal (conditional)  src/components/BrandKit/BrandKitOnboardingModal.jsx
```

Notes on the tree:
- `StudioPage.jsx` default-exports a thin wrapper (`export default function StudioPage()`) that only reads `brandKit` from `useBrandKitStore` and wraps `StudioBody` in `UiV2ThemeProvider`. All actual page logic lives in the non-exported `StudioBody` function in the same file.
- `PostProductionPanel`, `SessionHistoryDrawer`, and `StudioLightbox` are pure presentational children — they receive all data and callbacks as props from `StudioBody`; none of them read the Zustand stores directly.
- `GeneratePageV2` never renders any Studio-internal markup itself; it is purely a session-routing/orchestration shell around `<StudioPage />`.

## Shared vs. Generate-exclusive components

**Generate-exclusive** (live under `src/pages/GeneratePage/` or `src/pages/Studio/`, only referenced by this page):
- `GeneratePageV2.jsx`, `StudioPage.jsx`, `PostProductionPanel.jsx`, `SessionHistoryDrawer.jsx`, `StudioLightbox.jsx`
- `src/components/GenerateStudio/hooks/useConnectedAccounts.js`, `src/components/GenerateStudio/shared/constants.js` (both under a `GenerateStudio` directory that is otherwise a remnant of a prior implementation — `StudioPage.jsx`'s header comment states it "ported the state machine that used to live in `src/components/GenerateStudio/BrandosseGenerateStudio.jsx`", implying that file itself has been deleted/replaced)

**Shared with other pages:**
- `src/components/BrandKit/BrandKitOnboardingModal.jsx` — reusable brand-kit nudge (also referenced by kit-completeness logic elsewhere)
- `src/ui-v2/*` — the whole design-system component library (AppHeader, Card, Button, Modal, Drawer, Dropdown, Badge, Skeleton, EmptyState, MobileNavDrawer, CreditPill, Avatar, IconButton, ThemeProvider) — used across Dashboard/Library/Calendar/Studio per `StudioPage.jsx` comments
- `src/stores/SessionStore.js`, `src/stores/BrandKitStore.js` — global stores, but `SessionStore` in particular is generation/session-domain-specific and effectively only meaningfully consumed by Generate/Studio (UNCLEAR if any other page also imports `useSessionStore` — not checked beyond this page's dependency graph)
- `src/hooks/useCreditBalance.js` — explicitly documented as shared with `UserNavbar` and the personal dashboard
- Edge functions (`generate-post-metadata`, `seo-score`, `optimize-seo`, `mock-publish`, etc.) are also called from Library/Calendar/Org flows per various service files (`org/services/orgDraftWorkflowService.js`, etc.) — not exclusive to Generate

## Lazy loading / code splitting / Suspense

- `src/next/NextAppProviders.jsx` wraps the whole `/app` tree in a `<Suspense>` boundary (fallback: `AuthLoadingOverlay`) around `NextNavigationProvider`/`NextAppAccessGate` — this is an app-wide boundary, not Generate-specific.
- `MockPublishModal` is loaded via `next/dynamic` with `ssr: false` (`NextAppProviders.jsx:15-17`) — a global modal for publish-result UI, not owned by Generate but activated by this page's `executeMockPublishAttempts` flow (see Stage 3/4).
- Within `StudioPage.jsx`, `startGeneration`/`startCarouselGeneration` in `SessionStore.js` dynamically `import('../services/generationPipeline')` at call time (`await import(...)`, `SessionStore.js:1156` and `:1287`) — this is a runtime code-split of the generation pipeline module, deferred until the user actually clicks Generate, not a route-level split.
- No other `React.lazy`/`dynamic()` usage found within the Generate/Studio component files themselves — `StudioLightbox` is conditionally rendered (`{lightboxOpen && lightboxGeneration && <StudioLightbox .../>}`) but statically imported, so it is bundled eagerly, not lazily.
