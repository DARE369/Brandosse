# Weekly Objective Audit and Execution Plan

As of: Saturday, February 28, 2026  
Repo: `social-media-agent` (current working tree, including uncommitted changes)

## 1. Executive Summary

This audit compares the planned objectives for:
- Week 1 (2026-02-23 to 2026-02-27)
- Week 2 (2026-03-02 to 2026-03-06)

Current state:
- Week 1: Core progress is strong but not fully closed.
  - Completed: canonical status constants, major generate/calendar/library lifecycle wiring, schema consistency migrations, role-routing hardening.
  - Partially complete: full status standardization across all active consumers, signup profile provisioning, formal regression reporting artifacts.
  - Not complete: team approval artifacts for P0 checklist and week closeout.
- Week 2: Most objectives are not started yet (dates are still upcoming).
  - No scheduled publishing worker is present yet.
  - Real OAuth is not wired yet.
  - Analytics attribution and mock replacement are still incomplete.

Headline risk:
- The biggest remaining blocker for a reliable "production-like MVP flow" is still backend operational completion:
  - profile provisioning guarantee for all signup paths,
  - scheduled publishing worker,
  - real OAuth integration,
  - analytics attribution/writer pipeline.

## 2. Objective Status by Day

### Week 1

| Date | Objective | Status | What Is Done | What Is Missing |
| --- | --- | --- | --- | --- |
| 2026-02-23 (Mon) | Lock canonical status model and completion scope | Partial | Shared status constants added and used in core generation/library/calendar paths (`src/constants/statuses.js`, `src/stores/SessionStore.js`, `src/stores/LibraryStore.js`, `src/pages/LibraryPage/LibraryPageV2.jsx`). | No repo evidence of team-approved P0 acceptance signoff; unresolved naming drift still exists in some active and legacy consumers. |
| 2026-02-24 (Tue) | Implement status standardization in critical flows | Partial | Generate + calendar + library lifecycle uses canonical values (`draft/scheduled/publishing/published/failed`, `processing/completed/failed`), shared status badge introduced (`src/components/Shared/StatusBadge.jsx`). | Dashboard/navbar/admin still use direct literals in several places; not all active consumers are routed through constants; some copy still says "Posted". |
| 2026-02-25 (Wed) | Fix scheduling persistence and modal flow integrity | Mostly complete | Calendar modal contract and parent handling are aligned (`src/pages/CalendarPage/components/ScheduleModal.jsx`, `src/pages/CalendarPage/CalendarPageV2.jsx`), store updates + refresh paths are present (`src/stores/CalendarStore.js`). | No explicit scheduling validation checklist file found; some scheduling writes still use raw string literals (`status: "scheduled"`). |
| 2026-02-26 (Thu) | Resolve profile provisioning and schema blockers | Partial | OAuth callback creates profile when missing (`src/pages/Auth/AuthCallback.jsx`); schema mismatch fixes and consistency migrations are present (`supabase/migrations/20260227090000_*.sql`, `20260227103000_*.sql`); role-aware routing logic is hardened (`src/utils/authRouting.js`, `src/utils/PostAuthRedirect.jsx`, `src/utils/protectedRoute.jsx`). | Email/password signup path does not guarantee profile creation (`src/Context/AuthContext.jsx`, `src/pages/Auth/Register.jsx`); no DB signup trigger found in migrations. |
| 2026-02-27 (Fri) | Week 1 stabilization and checkpoint | Partial | Build passes (`npm run build` on 2026-02-28); residual P1/P2 backlog is documented (`docs/COMPLETED_AND_REMAINING_WORK.md`); week handoff timeline exists (`docs/THREE_WEEK_COMPLETION_TIMELINE.md`). | No dedicated Week 1 regression report artifact found; no explicit owner/date carryover matrix found for all open P0 items. |

### Week 2 (Upcoming as of 2026-02-28)

| Date | Objective | Status | Current Evidence |
| --- | --- | --- | --- |
| 2026-03-02 (Mon) | Scheduled publishing worker foundation | Not started | No `publish-scheduled-posts` worker function found; no scheduler binding for post publishing flow. |
| 2026-03-03 (Tue) | Publish outcomes + retry-safe error handling | Not started | No backend publish executor exists yet, so no deterministic published/failed outcome pipeline for scheduled posts. |
| 2026-03-04 (Wed) | Real OAuth (at least one platform) | Not started | Settings connect action explicitly reports OAuth not configured (`src/pages/Settings.jsx`); mock service still present (`src/services/MockOAuthService.js`). |
| 2026-03-05 (Thu) | Analytics and recommendation data integrity | Partial prework only | `daily-analysis` and `OptimalTimesService` exist, but platform attribution filtering still depends on unselected relation fields; mock analytics still powers admin analytics view (`src/admin/pages/AdminAnalyticsPage.jsx`). |
| 2026-03-06 (Fri) | Integration checkpoint and rehearsal | Not started | No Week 2 integration report artifact found yet (date is upcoming). |

## 3. Status Mapping Matrix (Generations/Posts)

Legend:
- Compliance: `Green` = canonical + centralized, `Yellow` = canonical values but direct literals, `Red` = conflicting/legacy naming.
- Scope: active user/admin paths only, plus high-risk legacy leftovers.

| Consumer | Surface | Statuses Read/Written | Source Type | Compliance | Notes |
| --- | --- | --- | --- | --- | --- |
| `src/constants/statuses.js` | Shared | Generation: `processing/completed/failed`; Post: `draft/scheduled/publishing/published/failed` | Canonical constants | Green | Current single source for generation/post status values. |
| `src/stores/SessionStore.js` | Generate lifecycle + post write paths | Full generation/post lifecycle | Constants | Green | Strong adoption; includes draft auto-create and publish/schedule transitions. |
| `src/components/Generate/BatchGenerationGrid.jsx` | Generate UI | `processing/completed/failed` | Constants | Green | Correct state rendering for processing/completed/failed. |
| `src/components/Generate/GenerationCanvas.jsx` | Generate UI | `completed` checks + retry flows | Constants | Green | Uses canonical generation statuses. |
| `src/components/Generate/PostProductionPanel.jsx` | Generate post-production | `draft/scheduled/published` outcomes | Constants | Green | Success messaging keyed by canonical post statuses. |
| `src/pages/GeneratePage/GeneratePageV2.jsx` | Generate page container | `completed` video completion check | Constants | Green | Canonical check in completion routing. |
| `src/stores/LibraryStore.js` | Library write/read | `draft/scheduled/publishing/published/failed` | Constants | Green | Enforces terminal rules for publish/publishing rows. |
| `src/pages/LibraryPage/LibraryPageV2.jsx` | Library UI | `draft/scheduled/published/failed` | Constants | Green | Counts, filters, and actions use canonical statuses. |
| `src/components/Shared/StatusBadge.jsx` | Shared badge UI | `draft/scheduled/publishing/published/failed` | Shared map | Green | Standardized label/icon rendering for active post lifecycle. |
| `src/stores/CalendarStore.js` | Calendar data store | `draft/scheduled/publishing/published/failed` + ghost slot `suggested/accepted` | Mixed (constants + literals) | Yellow | Canonical lifecycle values, but `fetchPosts` and some writes still use raw strings. |
| `src/pages/CalendarPage/CalendarPageV2.jsx` | Calendar main UI | `draft/scheduled/publishing/published/failed` | Mixed | Yellow | Mostly constants; includes a few literal checks and pass-through branches. |
| `src/pages/CalendarPage/components/ScheduleModal.jsx` | Calendar modal | writes `scheduled` | Literal | Yellow | Works functionally, but should use `POST_STATUS.SCHEDULED`. |
| `src/pages/CalendarPage/components/BulkScheduleModal.jsx` | Calendar bulk scheduling | writes `scheduled` | Literal | Yellow | Needs constant import for strict standardization. |
| `src/pages/Dashboard/UserDashboard.jsx` | User dashboard | counts `draft/scheduled/published`; displays generation status text | Literal | Yellow | Values match canonical strings but are not centralized via constants. |
| `src/hooks/useRealtimeKPIs.js` | Dashboard KPI hook | `scheduled/published`, generations `!= failed` | Literal | Yellow | Canonical values but direct literals. |
| `src/components/User/UserNavbar.jsx` | Notifications | generation `completed/processing/failed`; posts `published/scheduled/failed` | Literal | Yellow | Consistent values, but not using shared constants. |
| `src/admin/pages/AdminModeration/AdminModerationPage.jsx` | Admin moderation data model | maps generation rows to `draft`; uses `posts.status` pass-through | Literal | Yellow | Behavior matches canonical post statuses; still literal-based and includes synthetic draft mapping. |
| `src/admin/components/ContentModeration/PublicationModal.jsx` | Admin moderation write path | writes `published` or `scheduled` | Literal | Yellow | Canonical values, no constants module used. |
| `src/admin/components/ContentModeration/ModerationQueue.jsx` | Admin moderation UI | reads `draft/scheduled/published` | Literal | Yellow | Canonical display logic but string-based. |
| `src/admin/utils/apiService.js` | Admin overview KPIs | queries `scheduled/published` | Literal | Yellow | Numeric logic aligned; card label still says "Scheduled & Posted". |
| `src/components/User/StatusBadge.jsx` | Legacy user badge component | `Draft/Review/Approved` | Legacy literals | Red | Not imported in active user pages, but should be removed or aligned to avoid future regressions. |
| DB status domain (per schema audit note) | Data model | includes possible `archived` in DB domain | DB enum/check domain | Red | Needs explicit decision: support `archived` end-to-end or remove from DB domain. |

## 4. Approved P0 Implementation Checklist

Current approval evidence in repo:
- There is no explicit team approval artifact in repository text for final P0 signoff.
- This checklist is implementation-ready and can be used as the signoff artifact once reviewed by the team.

### P0-1 Canonical Status Completion (Generations + Posts)

- [x] `src/constants/statuses.js` defines canonical generation/post statuses.
- [x] Core generate/session/library flows use canonical constants.
- [ ] Replace remaining literal status reads/writes in active dashboard, navbar, calendar modal/bulk modal, and admin moderation.
- [ ] Decide and document `archived` status policy (support vs remove).
- [ ] Remove or refactor legacy status components (`Review/Approved` vocabulary).
- [ ] Add one guardrail test/lint rule to block new raw lifecycle literals in active paths.

### P0-2 Scheduling Persistence and Modal Integrity

- [x] Modal save payload contract aligns with parent handlers.
- [x] Single-item schedule path writes to DB and refreshes list state.
- [x] Draft-to-scheduled transitions are implemented in calendar + library paths.
- [ ] Add repeatable scheduling validation checklist artifact (manual QA sheet + expected DB/UI assertions).

### P0-3 Generate Result-State Reliability

- [x] Processing/completed/failed rendering is explicit in generation grid/canvas.
- [x] Draft creation from completed generations is implemented in store and migration trigger.
- [ ] Add regression checks that completed outputs always appear without manual reselect across refresh/realtime cases.

### P0-4 Profile Provisioning Guarantee

- [x] OAuth callback inserts missing profile rows.
- [ ] Guarantee profile provisioning for email/password signup path.
- [ ] Add DB-level `auth.users -> profiles` trigger (idempotent) as primary guarantee.
- [ ] Keep app-side upsert fallback and add telemetry/logging for provisioning failures.

### P0-5 Schema and Query Mismatch Closure

- [x] Consistency migrations added for calendar/library alignment and generation/post unification.
- [x] Multiple known query/schema mismatches documented and patched.
- [ ] Confirm migrations are applied in target environments.
- [ ] Validate `profiles_id_fkey` after orphan cleanup.
- [ ] Re-run focused runtime smoke checks after migration application.

## 5. What Is Left and How To Execute It

## 5.1 Remaining Week 1 Closures (Critical)

### A) Final status standardization closure

What to put in place:
1. Replace literal status strings in active consumers with `POST_STATUS`/`GENERATION_STATUS`.
2. Centralize status labels in shared helpers (`StatusBadge` + notification label map).
3. Decide `archived` policy and enforce with migration + UI handling.

Execution steps:
1. Refactor files:
   - `src/pages/Dashboard/UserDashboard.jsx`
   - `src/hooks/useRealtimeKPIs.js`
   - `src/components/User/UserNavbar.jsx`
   - `src/pages/CalendarPage/components/ScheduleModal.jsx`
   - `src/pages/CalendarPage/components/BulkScheduleModal.jsx`
   - `src/admin/pages/AdminModeration/AdminModerationPage.jsx`
   - `src/admin/components/ContentModeration/PublicationModal.jsx`
2. Delete or align `src/components/User/StatusBadge.jsx`.
3. Add a short lifecycle reference note in docs with canonical values and allowed transitions.

Definition of done:
- All active consumers import canonical constants.
- No unresolved naming collisions remain in active code paths.
- Dashboard counts, calendar badges, library badges, and admin moderation labels all match.

### B) Profile provisioning hard guarantee

What to put in place:
1. DB trigger function on `auth.users` to auto-insert `public.profiles`.
2. Idempotent insert/upsert behavior.
3. App fallback for edge-case failures.

Execution steps:
1. Add migration:
   - `create function public.handle_new_user_profile()`
   - `create trigger on auth.users after insert`
2. Include defaults for required profile fields (`role`, `status`, initial credits).
3. Keep OAuth callback insert as fallback but convert to upsert.
4. Test both signup types:
   - Email/password signup
   - Google OAuth signup

Definition of done:
- New user always has profile row regardless of auth method.
- Role-based redirect and dashboard/profile reads work immediately after signup.

### C) Formal Week 1 regression closure artifact

What to put in place:
1. A concrete regression report file with pass/fail evidence.
2. Explicit carryover table with owner and target date.

Execution steps:
1. Run generate -> schedule -> dashboard script for at least:
   - image generation,
   - video generation,
   - save draft,
   - schedule single post,
   - verify dashboard KPI and calendar badge update.
2. Capture outcomes and attach issue IDs.
3. Add owner/date for every open P0 carryover item.

Definition of done:
- Week 1 report exists in docs and all open P0 work has owner/date.

## 5.2 Week 2 Execution Plan (Starting Monday, 2026-03-02)

### Monday 2026-03-02: Scheduled publishing worker v1

Put in place:
1. Edge Function `publish-scheduled-posts`:
   - select due posts (`status='scheduled'`, `scheduled_at <= now()`),
   - move to `publishing`,
   - call platform publisher abstraction.
2. Cron/scheduler binding (Supabase pg_cron or scheduled trigger).
3. Basic publish attempt logging table.

### Tuesday 2026-03-03: Outcome handling + retry safety

Put in place:
1. Deterministic `publishing -> published/failed` transitions.
2. Retry guard fields (`retry_count`, `last_error`, `last_attempt_at`).
3. UI visibility for failed states in user library/calendar and admin moderation.

### Wednesday 2026-03-04: Real OAuth integration (first platform)

Put in place:
1. Real OAuth connect endpoint + callback handling.
2. Secure token storage and refresh flow.
3. Settings page connect action bound to real handshake for one platform.
4. Keep mock path explicitly behind feature flag for non-integrated platforms.

### Thursday 2026-03-05: Analytics attribution integrity

Put in place:
1. Fix `connected_accounts` relation selection in optimal-time queries.
2. Implement writer path to `platform_analytics`.
3. Replace admin analytics mock data path with real query-backed sources for target views.

### Friday 2026-03-06: Integration rehearsal and report

Put in place:
1. Run full rehearsal: connect -> generate -> schedule -> publish -> review.
2. Produce Week 2 integration report with bounded defects.
3. Publish Week 3 hardening queue with priorities and owners.

## 6. Exit Criteria Check

Planned Week 1 exit criterion:
- "No unresolved status naming decisions remain."

Current audit result:
- Not yet met.

Unresolved naming/control decisions still open:
1. Whether `archived` should be in canonical post lifecycle.
2. Whether all active flows must import constants (recommended yes).
3. Removal/alignment of legacy status vocabulary (`Review/Approved` component).
4. Final user/admin wording consistency ("Published" vs "Posted" copy).

## 7. Recommended Immediate Next Actions (Next 48 Hours)

1. Finalize status literal cleanup in active dashboard/navbar/calendar/admin files.
2. Add and apply signup provisioning DB trigger migration.
3. Produce Week 1 regression artifact with pass/fail evidence and carryover owner/date.
4. Start Week 2 Monday worker skeleton with explicit status transition map.

## 8. Week 1 Closeout Update (2026-03-02)

This section records Week 1 closeout implementation progress completed on Monday, 2026-03-02.

### 8.1 Implemented code/doc updates

- Canonical status constant adoption updates applied in active Week 1 scope files:
  - `src/pages/Dashboard/UserDashboard.jsx`
  - `src/hooks/useRealtimeKPIs.js`
  - `src/components/User/UserNavbar.jsx`
  - `src/pages/CalendarPage/components/ScheduleModal.jsx`
  - `src/pages/CalendarPage/components/BulkScheduleModal.jsx`
  - `src/admin/pages/AdminModeration/AdminModerationPage.jsx`
  - `src/admin/components/ContentModeration/PublicationModal.jsx`
  - `src/admin/components/ContentModeration/ModerationQueue.jsx`
  - `src/admin/components/ContentModeration/FilterBar.jsx`
  - `src/admin/utils/apiService.js`
  - `src/stores/CalendarStore.js`
- Legacy `Review/Approved` badge component removed:
  - `src/components/User/StatusBadge.jsx`
- Profile provisioning hardening updates applied:
  - `src/Context/AuthContext.jsx` (email/password fallback upsert telemetry)
  - `src/pages/Auth/AuthCallback.jsx` (idempotent profile upsert)
  - `src/pages/Auth/Register.jsx` (signup telemetry and clean encoding)
- New migration added:
  - `supabase/migrations/20260302110000_profile_provisioning_and_status_domain.sql`
- Canonical lifecycle reference and Week 1 artifacts added:
  - `docs/POST_AND_GENERATION_LIFECYCLE_REFERENCE.md`
  - `docs/WEEK1_SCHEDULING_VALIDATION_CHECKLIST_2026-03-02.md`
  - `docs/WEEK1_REGRESSION_REPORT_2026-03-02.md`
  - `docs/WEEK1_P0_SIGNOFF_2026-03-02.md`
- Guardrail added:
  - `scripts/check-status-literals.cjs`
  - `npm run check:status-literals`

### 8.2 Current closeout checkpoint

- `npm run check:status-literals` is passing.
- Week 1 closeout is **code-complete but evidence-pending** until DB apply + manual QA outputs are attached.

### 8.3 Carryover owner/date matrix (explicit)

| Carryover ID | Remaining action | Owner | Target Date | Status |
| --- | --- | --- | --- | --- |
| W1-CARRY-001 | Apply migration in dev and staging (`supabase db push`) and record output | Dare | 2026-03-02 | Open |
| W1-CARRY-002 | Run manual regression script and attach pass/fail evidence in `WEEK1_REGRESSION_REPORT_2026-03-02.md` | Dare | 2026-03-02 | Open |
| W1-CARRY-003 | Run SQL assertions (`orphans`, `archived`, status domain) and paste outputs in regression report | Dare | 2026-03-02 | Open |
