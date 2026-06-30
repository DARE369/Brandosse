# Dead-Code Audit (2026-06-21)

Repo-wide dormant-code scan (grep-verified reference counts). Active entry = Next App Router `app/**/page.jsx` → `src/pages/*` → `src/components/*`. **Report only** — deletions happen in a verified cleanup pass (build green after each batch). A prior pass already removed SEOPanel/ImageEditPanel/PromptSuggestions + the CalendarV2 tree.

## A. High-confidence REMOVE (grep shows ZERO live references)

**Admin (admin-bundle only):**
- `src/admin/components/UserDetailsPanel/` (UserDetailsPanel.jsx, SocialMediaTile.jsx)
- `src/admin/components/UserListPanel/` (UserListPanel.jsx, UserListRow.jsx)
- `src/admin/components/ContentManager/` (whole folder, 9 files)
- `src/admin/components/ContentCharts/ContentCharts.jsx`
- `src/admin/components/ContentModeration/ContentReviewModal.jsx`, `UploadWizard.jsx`, `FilterBar.jsx`
- `src/admin/adminRoutes.jsx` (legacy react-router map — App Router replaced it)
- `src/admin/mocks/` (mockAuditLogs.js, mockStats.js, mockUsers.js, mockPosts.js)
- `src/admin/utils/mockService.js`, `mockModerationData.js`

**Personal/org components:**
- `src/components/BrandKit/BrandKitForm.jsx`
- `src/components/Dashboard/RealtimeKPICards.jsx` (dashboard rebuild dropped its usage)
- `src/components/Shared/NotFoundCard.jsx`
- `src/components/User/AIResultPreviewer.jsx`, `PromptTemplateBuilder.jsx`, `TrendsPanel.jsx`
- `src/components/video-engine/ClipCard.jsx`
- `src/org/components/ContentQueuePanel.jsx`, `src/org/components/calendar/CalendarDetailDrawer.jsx`
- `src/org/hooks/useBrandContext.js`

**Services / legacy / duplicates:**
- `src/services/api.js`, `freepik.service.js`, `llmClient.js`, `MockOAuthService.js`, `OptimalTimesService.js`
- `src/legacy/` (whole folder — dormant xstate generation machine)
- `src/pages/InvitationAcceptPage.jsx` (root dup; live one is `InvitationAccept/InvitationAcceptPage.jsx`)
- `src/pages/Auth/Login.css` (orphaned; Login.jsx uses Auth.css)
- **Repo-root stale dirs:** `pages/404.jsx`, `functions/start-generation/` (stale duplicate of `supabase/functions/start-generation/`)
- `scripts/fix-moderation-empty-state.cjs` + `.mjs`

**Edge functions (zero client invocations):** `adminStats`, `generateCarouselPlan`

**Dependencies (no import anywhere):** `@chakra-ui/react`, `@emotion/react`, `@emotion/styled`, `@radix-ui/react-dialog`, `@dnd-kit/sortable`, `axios`, `framer-motion`, `groq-sdk`, `react-type-animation` (also drop from `next.config.mjs` `optimizePackageImports`). Add `xstate` + `@xstate/react` once `src/legacy/` is gone. → biggest bundle win.

## B. INVESTIGATE (zero live JS imports but referenced by lint scripts/CSS, or invoked outside the repo)

- Admin moderation/analytics: `ContentModeration/ModerationQueue.jsx`, `PublicationModal.jsx`, `AnalyticsPagination/Pagination.jsx`, `ScoreCard/ScoreCard.jsx`, `admin/utils/apiService.js`, `mockAnalytics.js` — confirm the admin moderation/analytics screens don't lazy-load them.
- Edge functions possibly run by cron/dashboard/uptime: `credit-monthly-reset`, `detect-account-failures`, `generate-session-title`, `healthCheck`, `org-setup`, `score-generation` — verify Supabase scheduled triggers before deleting.
- `scripts/ui-audit.cjs`, `render_markdown_pdf.py`, `seed-mock-connected-accounts.mjs` — one-off tooling.
- `CalendarV2.css` still imported in app-entry; its component tree is gone → prune classes (low priority).

## C. NOT dead (verified live, do not touch)
- The 3 "suspect" CSS files (`generate.css`, `GeneratePromptBar.css`, `GenerateV2.css`) — still used by `GenerationCanvas`/`GenerationPromptBar`/`EditImageModal`/`BatchGenerationGrid` via `OrgGenerateComposer`.
- The whole `src/components/GenerateStudio/**` tree (post-split) — live via GeneratePageV2.
- `admin/components/common/{Badge,Button,Modal}.jsx` (heavily used).

## Cleanup procedure
Delete in dependency order (leaf components → parent clusters → services → root dirs → deps), `npm run build:next` after each batch, then `npm install` after dep removals. Confirm with the QA harness that admin/personal/org routes still render.
