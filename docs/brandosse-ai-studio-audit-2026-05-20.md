# Brandosse AI Studio Audit

Date: 2026-05-20
Scope: Compare the current AI Studio and surrounding personal workspace against the pasted Brandosse Complete System Documentation.

## Executive Verdict

The current app is not a blank slate. It already has a mature personal workspace shell, AI Studio, content library, calendar, settings, connected accounts, brand kit, org approval paths, Supabase persistence, realtime updates, and mock publishing. The largest gap is exact product-model alignment with the Brandosse document.

Current implementation fit:

- Platform shell and core workspace: high alignment.
- AI Studio generation workflow: medium-high alignment, but implemented as an iterative canvas rather than the document's strict 3-phase form/gallery/publishing layout.
- Post-production and publishing: high alignment for workflow mechanics, medium alignment for native platform previews and hashtag intelligence.
- SEO intelligence: low-medium alignment. Current SEO is social-caption scoring and optimization, not the full technical/content/authority/backlink SEO engine in the document.
- Data orchestration: medium alignment. There are Supabase functions, realtime subscriptions, and a separate video worker, but image generation is not yet modeled as the full async job queue contract described in the document.
- UI system: medium alignment. The app has tokens, dark/light mode, responsive layouts, and Lucide icons, but the current palette and radius/density choices diverge from the pasted Brandosse design system.

Primary recommendation: keep the current AI Studio canvas because it is stronger for iterative AI content creation than a static 70/30 creation form. Refine it into the documented 3-phase mental model by making Create, Review, and Post-Production explicit in the UI, adding the missing cost/credits and SEO detail, and tightening the visual system to Brandosse tokens.

## Evidence From Current Code

- App shell and navigation use a persistent user sidebar with Lucide icons, collapsed state, workspace status, and routes for dashboard, AI Studio, library, video lab, calendar, insights, credits, settings, and brand kit: `src/components/User/UserSidebar.jsx:24`.
- The AI Studio canvas exposes Image, Carousel, Video, Frames, and Edit tabs, plus Prompt, Results, Select, Publish progress labels: `src/components/Generate/GenerationCanvas.jsx:27` and `src/components/Generate/GenerationCanvas.jsx:35`.
- The prompt dock includes aspect ratio, output count, slide count, model selection, attachment, enhance prompt, and generate controls: `src/components/Generate/GenerationPromptBar.jsx:258`.
- Batch review supports generated result selection, multi-select, download, edit, retry, processing, failed states, and use-for-post: `src/components/Generate/BatchGenerationGrid.jsx:31`.
- Post-production is already a 3-step panel with Content, SEO, and Publish stages: `src/components/Generate/PostProductionPanel.jsx:41`.
- Post-production enforces platform character limits and selected account logic: `src/components/Generate/PostProductionPanel.jsx:48` and `src/components/Generate/PostProductionPanel.jsx:268`.
- SEO scoring currently evaluates title, caption, and hashtags and returns suggestions: `supabase/functions/seo-score/index.ts:80`.
- SEO optimization currently returns optimized title, caption, hashtags, score, score breakdown, improvements, and improvement report: `supabase/functions/optimize-seo/index.ts:130`.
- The dashboard already includes setup flow, realtime KPI section, momentum, recent work, quick actions, publishing focus, brand flow health, and account health: `src/pages/Dashboard/UserDashboard.jsx:568`.
- Library supports post/media/template inventory, type/status/platform filters, grid/list view, upload, schedule, edit, duplicate, delete, repurpose, and use media in post: `src/pages/LibraryPage/LibraryPageV2.jsx:36` and `src/pages/LibraryPage/LibraryPageV2.jsx:752`.
- Calendar supports month/week/day/list modes, filters, drag/drop on desktop, ghost slots, best times, bulk scheduling, details, and library selection: `src/pages/CalendarPage/CalendarPageV2.jsx:139`.
- Settings support profile, preferences, notifications, connected accounts, and organization accounts: `src/pages/Settings.jsx:34`.
- Tokens exist for spacing, radius, light/dark themes, app shell dimensions, and brand aliases: `src/styles/tokens.css:39`, `src/styles/tokens.css:55`, `src/styles/tokens.css:581`, and `src/styles/tokens.css:712`.

Verification run:

- `npm run check:ui-consistency` completed successfully in non-strict mode.
- It reported 163 raw color candidates, mostly in CSS, so token cleanup is a real design-system task.

## Spec Comparison

### 1. Platform Architecture

Spec expectation:

- React 18, TypeScript, Tailwind, Zustand, React Query, custom hooks, API layer, intelligence layer, backend services.

Current state:

- Next/React is present.
- Zustand stores are central: Session, Library, Calendar, BrandKit, Help.
- React Query is configured, but a lot of feature data still comes from direct Supabase calls and local store actions.
- The frontend is mostly JSX and CSS files, not TypeScript-first.
- Tailwind is installed, but the app relies heavily on custom CSS and token files.

Decision:

- Do not force a rewrite to TypeScript/Tailwind as part of the UI refinement. Stabilize the current CSS token system first, then migrate high-risk logic gradually.

### 2. Application Shell

Spec expectation:

- Header, sidebar, dashboard/generate/library/calendar/settings navigation, dark/light mode, user menu.

Current state:

- Shell exists and exceeds the spec in navigation breadth.
- Current nav labels are more productized: Command Center, AI Studio, Content Library, Video Lab, Content Calendar, Insights, Credits, Settings, Brand Kit.
- Lucide icons are used instead of emoji, which is a better production decision than the examples in the document.

Gaps:

- Need decide naming consistency: "Generate" in docs vs "AI Studio" in product.
- Some nav breadth may reduce focus for first-time users.

Decision:

- Keep "AI Studio" as the product label. Use "Create" inside the Studio workflow instead of renaming the route to Generate.

### 3. Dashboard

Spec expectation:

- Welcome header, stats cards, recent posts table, quick actions.

Current state:

- Current dashboard is stronger than the spec. It has onboarding, realtime KPIs, content flow, recent generations, quick actions, publishing focus, brand flow health, and account health.

Gaps:

- The current dashboard leans slightly toward expressive/hero composition. For an operational SaaS tool, it should prioritize dense scanability and decisions.

Decision:

- Keep the richer dashboard modules, but reduce hero visual weight and move operational KPIs higher for returning users.

### 4. Content Library

Spec expectation:

- Search, status filters, content grid, empty state, generation cards, view/edit actions.

Current state:

- Library exceeds the spec. It supports posts, media, templates, pillars, platform/status/type filters, grid/list view, upload, schedule/reschedule, edit, duplicate, delete, repurpose, and use media in post.

Gaps:

- Bulk operations are not clearly implemented in the personal library.
- Filter UI is more advanced than the spec but could become dense on smaller screens.

Decision:

- Keep current library model. Add bulk-select actions only after AI Studio review flow is tightened.

### 5. Calendar

Spec expectation:

- Month grid, scheduled platform events, upcoming posts.

Current state:

- Calendar exceeds the spec: month/week/day/list, drag/drop, touch fallback, ghost slots, best times, bulk schedule, library selection, detail panel.

Gaps:

- The spec's "upcoming posts" panel is not the main pattern here. Current detail panel/list view is likely better.

Decision:

- Keep current calendar. Do not regress it to a simple month-only view.

### 6. Settings

Spec expectation:

- Account, integrations, preferences tabs.

Current state:

- Settings are more complete: profile, preferences, notifications, connected accounts, organization accounts, and brand kit as its own route.

Gaps:

- The spec's "danger zone/logout" is not central here because logout lives in the shell.
- Integration naming differs from "Connected Accounts".

Decision:

- Keep current IA. It is more product-accurate than the spec.

### 7. Generation Create Phase

Spec expectation:

- Prompt textarea, character count, optimize with AI, optimization suggestions, mode/type controls, variants/slides, cost calculator, credits, generate button.

Current state:

- Current Create phase has the main functional pieces: prompt dock, AI enhance, content tabs, aspect ratio, output count, carousel slide count, model selection, reference attachment, suggestions, brand kit awareness.

Gaps:

- No obvious character counter or 2000 character hard limit.
- No visible cost breakdown before generation.
- No visible credit affordability warning in the AI Studio flow.
- Optimization UX is a popover of enhanced suggestions, not the document's richer before/after suggestion panel with scoring.
- Settings are in a bottom dock, not a 70/30 main/sidebar layout.

Decision:

- Keep the bottom prompt dock, but add a compact "Generation Summary" sidecar or top-right meter that shows mode, count, estimated credits, available credits, and affordability.
- Add character count and hard prompt limit.
- Change "enhance prompt" from a transient popover into an inspectable optimization drawer when the user requests it.

### 8. Review Phase

Spec expectation:

- Variant gallery, selected state, detailed large preview, metadata panel, download, regenerate, continue.

Current state:

- Current review grid handles batch results, status states, selection, download, edit, retry, multi-select, and use-for-post.

Gaps:

- No dedicated large selected-variant preview/inspector.
- Metadata display is minimal and does not expose model, time, cost, dimensions, file size, and format as a first-class panel.
- Keyboard arrow navigation and swipe navigation are not evident.
- The spec's selection indicator pattern differs from current badges. Current badges are cleaner than the spec's chevrons.

Decision:

- Add a right-side or modal "Asset Inspector" for selected variants instead of replacing the grid.
- Keep current selected badge rather than the chevron visual from the document.

### 9. Post-Production Phase

Spec expectation:

- Caption editor, hashtag manager, platform selector, platform previews, SEO analysis, publish settings, publish/schedule.

Current state:

- This area is close. Current panel has content, SEO, publish steps, metadata regeneration, caption, title, hashtags, platform account selection, schedule, previews, draft save, publish, and org approval workflows.

Gaps:

- Platform previews are generic cards, not realistic Instagram/Facebook/TikTok/YouTube native previews.
- TikTok does not appear in the local platform icon map in the post-production panel.
- Hashtag manager lacks visible AI suggestion chips with relevance/trending metadata.
- SEO must be run before "Proceed to Publish" unless skipped, but the UX could better explain why and what changed.

Decision:

- Keep the 3-step drawer. Upgrade previews and hashtag suggestions before changing layout.

### 10. SEO Intelligence Engine

Spec expectation:

- Technical SEO, content quality, authority/backlink analysis, semantic optimization, real-time score ring, entity extraction, crawlability, indexability, Core Web Vitals, backlink profile.

Current state:

- Current SEO is a social content optimizer. It scores title, caption, hashtags, and social platform fit. Optimization adds platform alignment, keyword density, caption structure, hashtag relevance, CTA presence, and brand consistency.

Gap:

- The pasted spec describes a web SEO intelligence product, not only social post optimization. Crawlability, canonical tags, backlink authority, Core Web Vitals, schema markup, semantic clusters, and knowledge graph readiness are not implemented.

Decision:

- Do not pretend the current panel is the full SEO engine. Rename the current UI copy to "Social SEO" or "Discovery Score".
- Build the full SEO engine as a separate "SEO Intelligence" module only if Brandosse is meant to optimize web pages as well as social posts.

### 11. Data Orchestration

Spec expectation:

- Job queue model, immediate job creation, polling every 2 seconds, queued/processing/completed states, retry policy, hot/warm/cold storage.

Current state:

- Supabase is the main data layer.
- Realtime subscriptions sync generations/posts/connected accounts.
- Video has a worker and polling model.
- Image generation paths create rows and call provider functions, but the full queue contract is not consistently exposed as API-first job creation.

Gaps:

- Credit model is split across profile credits, user_credits, video credits, and org credits.
- The documented API contracts are REST-like, while current app often uses Supabase functions and direct Supabase table queries.
- Retry policy and queue states are not standardized across all generation types.

Decision:

- Consolidate generation jobs into one status/progress/credits contract before building more UI around costs and progress.

## UI Direction Decisions

### Keep

- AI Studio canvas pattern for iterative creation.
- Post-production drawer as the final workflow stage.
- Lucide icon system.
- Dashboard, library, calendar, settings breadth.
- Brand Kit and org approval workflows.
- Dark/light theme architecture.

### Change

- Make Create, Review, Post-Production explicit in the AI Studio layout and copy.
- Add cost/credit visibility before generation.
- Add asset inspector for review metadata.
- Replace generic social previews with platform-specific previews.
- Rename current SEO to "Social SEO" or "Discovery Score" unless the full web SEO engine is implemented.
- Migrate raw CSS colors to tokens.
- Tighten radius/density for operational SaaS surfaces. Current 16-24px radius should be reserved for larger panels and modals; repeated cards and controls should trend closer to 8-12px.

### Avoid

- Rebuilding the AI Studio into the static 70/30 CREATE form from the document.
- Adding the full technical/backlink SEO UI into the post-production drawer. It will overwhelm social-post publishing.
- Treating the pasted color palette as a blind drop-in without checking current contrast, dark mode, and chart colors.

## Prioritized Implementation Plan

### Phase 1: UI System Alignment

Goal: Make the current UI feel intentionally Brandosse while preserving existing structure.

Tasks:

- Decide final Brandosse palette: either adopt the document's blue `#185FA5` as primary or keep current indigo and document it as the AI Studio brand direction.
- If adopting the document palette, update semantic tokens in `src/styles/tokens.css`, not per-component CSS.
- Replace raw color candidates reported by `npm run check:ui-consistency`, starting with GeneratePromptBar and CalendarV2.
- Normalize card/control radius and control heights.
- Add missing TikTok icon support in post-production platform previews.
- Run `npm run check:ui-consistency` after changes.

### Phase 2: AI Studio Create Refinement

Goal: Bring the current Create phase to the Brandosse spec without destroying the canvas workflow.

Tasks:

- Add prompt character counter and hard limit.
- Add visible mode/count/model/credits summary.
- Unify credit source and show available credits in the Studio.
- Add preflight validation: empty prompt, over limit, missing source image for edit mode, insufficient credits.
- Expand prompt enhancement into an optimization drawer with original prompt, improved prompt, and suggestions.
- Add clearer carousel/video constraints in the prompt dock.

### Phase 3: Review Inspector

Goal: Make generated variants easier to compare and trust.

Tasks:

- Add selected asset inspector with large preview.
- Show model, provider, generation time, cost, dimensions, file size, format, prompt, and status.
- Add keyboard navigation across completed results.
- Add "regenerate with same settings" action using current prompt/settings.
- Keep existing grid selection and batch actions.

### Phase 4: Post-Production Upgrade

Goal: Make publishing decisions clearer and platform-specific.

Tasks:

- Add native-ish preview tabs for Instagram, Facebook, TikTok, YouTube, LinkedIn/X where applicable.
- Add TikTok and YouTube-specific constraints and copy handling.
- Add AI hashtag suggestions with relevance scores.
- Add platform-specific caption variants for multi-platform publishing.
- Make SEO step explain whether score is required or optional.

### Phase 5: SEO Scope Decision

Goal: Prevent product confusion.

Option A: Social SEO only, recommended for near-term.

- Rename SEO to "Discovery Score".
- Add dimensions from the pasted post-production spec: readability, keyword density, hashtag quality, CTA strength, platform fit, brand consistency.
- Keep it in the post-production drawer.

Option B: Full SEO Intelligence Engine.

- Build a separate module/page.
- Add crawler/indexability checks, CWV ingestion, schema analysis, entity extraction, backlink integrations, authority scoring, and semantic cluster reports.
- This requires new backend services and data providers. It should not be squeezed into the social publish panel.

### Phase 6: Data and API Contract Consolidation

Goal: Make costs, progress, retries, and generated assets reliable.

Tasks:

- Standardize generation job states across image, carousel, edit, and video.
- Add a unified generation job payload with `queued`, `processing`, `completed`, `failed`, progress, estimated time, cost, and transaction id.
- Standardize credit ledger: personal image/video/org credits should not feel like separate currencies in the UI unless product explicitly intends that.
- Move direct Supabase table access behind service contracts for user-facing workflows where possible.
- Add retry/backoff policy to shared edge/service helpers.

### Phase 7: Verification

Goal: Keep UI quality high while implementing.

Tasks:

- Run `npm run check:ui-consistency`.
- Run route smoke tests.
- Run Playwright happy paths for AI Studio, library schedule, calendar reschedule, settings connected accounts.
- Capture desktop and mobile screenshots for AI Studio create/review/post-production.
- Check keyboard focus, touch target size, dark mode contrast, and reduced-motion behavior.

## Recommended First Build Slice

Build these first because they produce the biggest product alignment improvement with low architecture risk:

1. AI Studio cost/credits summary and prompt character counter.
2. Review asset inspector with metadata.
3. Rename/clarify current SEO as Social SEO or Discovery Score.
4. Token cleanup for GeneratePromptBar and PostProductionPanel.
5. Platform preview upgrade with TikTok support.

This slice makes the current product visibly closer to the Brandosse spec while preserving what already works.
