# User Pages Audit and Improvement Plan

Updated: 2026-02-17
Scope: User dashboard, generate, calendar, and direct dependencies (excluding admin feature work).

## 1. Audit Summary
The user-side product has solid structure and useful building blocks, but has several high-impact inconsistencies that currently break core flows:
- Status enum mismatch across generation and post flows
- Calendar schedule modal not persisting changes
- Analytics pipeline platform attribution mismatch
- Redundant/legacy code and CSS collisions increasing defect risk

## 2. High-Priority Findings (with references)
### P0 - Must fix first
1. Generation result rendering mismatch due status inconsistency
- Writer: `src/stores/SessionStore.js:249` (`completed`), `src/stores/SessionStore.js:194` (`processing`)
- Reader: `src/components/Generate/BatchGenerationGrid.jsx:108` (`published`), `src/components/Generate/BatchGenerationGrid.jsx:109` (`publishing`)
- Impact: generated media cards do not reliably render as completed in main grid.

2. Dashboard published KPI uses non-canonical status
- `src/pages/Dashboard/UserDashboard.jsx:89`
- Impact: published count is wrong when DB uses `published`.

3. Calendar single-item scheduling does not persist
- Parent passes `post` and ignores modal datetime callback:
  - `src/pages/CalendarPage/CalendarPageV2.jsx:221`
  - `src/pages/CalendarPage/CalendarPageV2.jsx:223`
- Modal signature and behavior mismatch:
  - `src/pages/CalendarPage/components/ScheduleModal.jsx:5`
  - `src/pages/CalendarPage/components/ScheduleModal.jsx:39`
- Impact: user edits appear to save in UI flow but are not written.

4. Optimal-time analytics platform filter cannot resolve platform reliably
- Client path: `src/services/OptimalTimesService.js:47`
- Edge function path: `supabase/functions/daily-analysis/index.ts:137`
- Impact: optimal times may never be computed per platform despite existing data.

### P1 - Important
5. Publish success message logic mismatch (`posted` vs `published`)
- `src/stores/SessionStore.js:425`
- `src/stores/SessionStore.js:455`

6. Calendar realtime subscription function is broken and not used
- Broken call pattern: `src/stores/CalendarStore.js:448`
- Not wired from page
- Impact: stale UI and hidden runtime error if enabled.

7. Draft relation mismatch
- Query omits `connected_accounts` relation: `src/stores/CalendarStore.js:71`
- UI expects relation:
  - `src/pages/CalendarPage/components/DraftsSidebar.jsx:46`
  - `src/pages/CalendarPage/components/BulkScheduleModal.jsx:47`

8. Ghost slot dismissal forces full browser reload
- `src/pages/CalendarPage/components/GhostSlotCard.jsx:23`

9. User sidebar has route and action gaps
- Missing route target: `src/components/User/UserSidebar.jsx:20` (`/app/analytics`)
- Logout button not wired: `src/components/User/UserSidebar.jsx:59`

### P2 - Cleanup and maintainability
10. Duplicate import and noisy comments in app entry
- `src/main.jsx:7`
- `src/main.jsx:8`

11. Hard-coded Supabase URL and anon key in source
- `src/services/supabaseClient.js:3`
- `src/services/supabaseClient.js:4`

12. CSS collisions and legacy artifacts
- Dashboard CSS duplicate blocks and mixed variable systems:
  - `src/styles/UserDashboard.css` (duplicate `.kpi-card`, `.kpi-grid`, `.status-badge` sections)
- Settings CSS includes pasted markdown artifacts and undefined theme tokens:
  - `src/styles/Settings.css:3`
  - `src/styles/Settings.css:487`
- Calendar modal imports legacy generate CSS that also defines shared class names:
  - `src/pages/CalendarPage/components/ScheduleModal.jsx:3`

13. Unused/legacy files increase cognitive load
- `src/pages/GeneratePage/state/useGenerationService.js`
- `src/pages/GeneratePage/state/generationMachine.js`
- `src/pages/CalendarPage/components/CalendarGrid.jsx`
- `src/components/Shared/ScheduleModal.jsx`
- Several user components appear unused by user pages (`KpiCard`, `StatusBadge`, `TrendsPanel`, `PromptTemplateBuilder`, `AIResultPreviewer`).

## 3. Inconsistency Matrix
### Status enums
Current values in active user flows are mixed:
- Generations: `processing`, `completed` (store)
- Generation UI reads: `publishing`, `published` (grid)
- Posts: `draft`, `scheduled`, `published`, `publishing`, `failed` (store/schema)
- Dashboard and some messaging still use `posted`

Required action:
- Introduce one shared constants module for status enums and consume it in all pages/stores/components.

## 4. What Should Be Put In Place (Platform and Ops)
1. Database governance
- Commit real migrations to `supabase/migrations` for all user-page dependencies.
- Add explicit indexes for user-page query shapes (`posts`, `generations`, `ghost_slots`, `optimal_posting_times`).

2. Security and access
- Ensure RLS is enabled on all user-facing tables and policies are user-scoped.

3. Publishing and analytics jobs
- Add a scheduled publishing worker to process `posts.status='scheduled'` and update to `publishing/published/failed`.
- Add analytics sync pipeline that writes `platform_analytics` for published posts.
- Ensure daily analysis computes platform-specific optimal times from real joined platform/account data.

4. Product completeness
- Define and support a full draft lifecycle from Generate -> Draft -> Calendar -> Scheduled.
- Replace placeholder analytics alerts with actual user analytics screen/panel.

## 5. Research-Based Improvement Guidance (Primary Sources)
The following recommendations are aligned with official documentation:

1. Minimize unnecessary `useEffect` state choreography
- Source: React "You Might Not Need an Effect"
- Link: https://react.dev/learn/you-might-not-need-an-effect
- Application here: reduce cross-effect synchronization and move event-triggered logic into event handlers/store actions.

2. Protect browser-exposed data with RLS
- Source: Supabase RLS docs
- Link: https://supabase.com/docs/guides/database/postgres/row-level-security
- Application here: enforce row ownership policies across `posts`, `generations`, `sessions`, `ghost_slots`, `calendar_settings`.

3. Use authenticated user checks appropriately
- Source: Supabase `auth.getUser` reference
- Link: https://supabase.com/docs/reference/javascript/auth-getuser
- Application here: use `getUser()` when authorization trust is required, avoid brittle mixed auth patterns.

4. Scale realtime carefully
- Source: Supabase Postgres Changes limitations/performance notes
- Link: https://supabase.com/docs/guides/realtime/postgres-changes
- Application here: avoid broad subscriptions where possible; reduce fan-out and re-fetch storms.

5. Move secrets/config to env correctly
- Source: Vite env variables and modes
- Link: https://vite.dev/guide/env-and-mode/
- Application here: remove hard-coded project keys from source; use env files and avoid sensitive values in client-exposed vars.

6. Improve route-level code splitting for growth
- Source: React Router `createBrowserRouter` and `route.lazy`
- Link: https://reactrouter.com/api/data-routers/createBrowserRouter/
- Application here: lazy-load heavier route implementations to keep startup fast as user pages grow.

7. Reduce store-driven rerenders
- Source: Zustand `useShallow` guide
- Link: https://zustand.docs.pmnd.rs/guides/prevent-rerenders-with-use-shallow
- Application here: optimize selectors in heavy pages (calendar/generate) to prevent broad rerender cascades.

8. Use schema migrations and generated types in delivery workflow
- Sources:
  - https://supabase.com/docs/guides/deployment/database-migrations
  - https://supabase.com/docs/reference/cli/supabase-migration-fetch
- Application here: version DB evolution and generate TS types from DB for safer client queries.

## 6. Recommended Implementation Roadmap
### Phase 0 (1-2 days)
- Standardize status constants and patch all mismatches
- Fix Calendar schedule modal save path
- Fix dashboard published count
- Remove full reload from ghost slot dismiss

### Phase 1 (2-4 days)
- Refactor `SessionStore` and `CalendarStore` selectors/actions for clearer boundaries
- Wire realtime correctly for calendar and reduce global subscriptions
- Clean up or remove unused legacy generate/calendar files

### Phase 2 (3-6 days)
- Implement publishing worker and analytics sync
- Repair platform attribution for optimal time analysis
- Build user analytics page and connect calendar analytics action

### Phase 3 (ongoing)
- Adopt migration-first DB workflow and generated types
- Add integration tests for Generate -> Posts -> Calendar pipeline
- Add monitoring around edge functions and scheduled jobs

## 7. Definition of Done for User-Side Stability
- Generate outputs render reliably
- Publish/schedule semantics are correct across DB and UI
- Calendar scheduling always persists
- Dashboard KPIs match canonical data
- Realtime updates are accurate without unnecessary refresh storms
- No dead/duplicate code paths in active user workflows
