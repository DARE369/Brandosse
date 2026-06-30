# Page: `/app/generate` and `/app/generate/:sessionId`

## Page Purpose (Plain Language)
This page is the personal content studio. Users generate images/videos, edit outputs, write captions/hashtags, and save or publish posts.

## Route and Access Rules
- Routes:
  - `/app/generate`
  - `/app/generate/:sessionId`
- Access: authenticated user under protected app shell.
- `/app/generate` auto-creates a session and navigates to `:sessionId`.

## Component Composition
- Page root: `src/pages/GeneratePage/GeneratePageV2.jsx`
- Shared shell: `UserNavbar`, `UserSidebar`
- Main composition:
  - `SessionHistoryRail`
  - `GenerationCanvas`
  - `PostProductionPanel`
  - `VideoProcessingModal` / `VideoStatusBar`
  - `BrandKitOnboardingModal`

## State, Hooks, Services
- Primary store: `SessionStore` (`src/stores/SessionStore.js`)
- Brand context store: `BrandKitStore`
- Runtime org bridge (optional route-state): `orgRuntimeStore`
- Services:
  - `freepik.service.js` for edge-function-backed generation calls
  - `generationPipeline.js` orchestration
  - `ApiService.js` for caption/SEO/prompt fallback helpers
  - `mockPublishWorkflow.js`

## Data Contracts Touched
- Tables/views:
  - `sessions`
  - `generations`
  - `content_plans`
  - `posts`
  - `content_library_items`
  - `content_templates` (template seed route state)
  - `connected_accounts` (publish target details)
  - `org_post_asset_links` (when org runtime scope is present)
- Edge functions:
  - `generateCarouselPlan`
  - `generateImage`
  - `editImage`
  - `generateVideo`
  - `videoStatus`
  - `enhance-prompt`
  - `mock-publish` (via publish workflow)
- Realtime channels/events:
  - Channel `generations_updates` on `generations`
  - Browser events:
    - `socialai:data-sync`
    - `socialai:seed-prompt`
    - `socialai:publish-complete`

## Inbound Dependencies
- Dashboard search links to `/app/generate/:sessionId#generationId`.
- Library routes with state:
  - `templateId`
  - `repurposeFromPostId`
  - `editPostId`
- Calendar routes with state:
  - `prefillDate`
  - `repurposeFromPostId`.
- Optional org route-state context can seed org runtime scope in personal generate.

## Outbound Dependencies
- Writes lifecycle records consumed by:
  - Calendar (`posts`, schedule/status)
  - Library (`posts`, `content_library_items`)
  - Dashboard KPIs and recent items
  - Connected account health/event telemetry through publish flow
- Emits events consumed by global modal and other pages:
  - `socialai:data-sync`
  - `socialai:publish-complete`.

## Current Working Relationships
- Session lifecycle is stable:
  - create/load session
  - generate variants
  - hydrate post production state
  - save/publish
- Route-state handlers support template seed and repurpose/edit handoff.
- Immediate publish path produces per-account attempts and consolidated user feedback.

## Missing or Partial Relationships
- Parallel orchestration exists:
  - Active edge-based generation path
  - Legacy-style provider abstractions still present
- Idempotency boundary for publish intent is not explicit.
- Personal generate can run org-scoped writes only if route-state sets org runtime context.

## No Relation Exists Yet
- No direct relation from generated output quality review models (`content_quality_reviews`) into post production UI decisions.
- No built-in lineage panel showing publish attempt timeline from this page.

## Recommended Wiring Contract
- Define canonical generation orchestration interface:
  - one request contract
  - one fallback hierarchy
  - one result schema.
- Add publish request id for deduplication across multi-account publish.
- Gate personal-org scope bridge with explicit feature flag and strict permission checks.

## Risks if Wired Incorrectly
- Duplicate post writes and duplicate publish attempts.
- Scope leakage if org context can be injected without validated membership.
- Divergent generation behavior if legacy and canonical paths are both active in production.
