# Completed and Remaining Work (Prioritized Delivery Backlog)

Updated: 2026-02-20  
Audience: Investor + Internal Team  
Purpose: Show what is complete now and what must be delivered next, in priority order.

## 1. Completed Work (Verified)

| Capability Area | What Is Complete | Evidence Paths | Business Outcome Enabled |
| --- | --- | --- | --- |
| Auth and access | User login/register and protected route behavior are active under native Next routes. | `app/**`, `src/Context/AuthContext.jsx`, `src/utils/protectedRoute.jsx`, `src/next/NextAppProviders.jsx` | Users and admins can access role-appropriate product areas. |
| User generation workspace | Session-based generation flow, prompt enhancement, and post-production panel are in place. | `src/pages/GeneratePage/GeneratePageV2.jsx`, `src/stores/SessionStore.js`, `src/components/Generate/*` | Users can create and prepare content in one workspace. |
| Calendar foundation | Calendar views, draft rail, and scheduling interfaces are implemented. | `src/pages/CalendarPage/CalendarPageV2.jsx`, `src/stores/CalendarStore.js`, `src/pages/CalendarPage/components/*` | Teams can plan content timing and manage upcoming posts. |
| Mock social connection | Mock connect/disconnect flow for core platforms is working. | `src/pages/Settings.jsx`, `src/services/MockOAuthService.js` | Product demos can include multi-platform workflow simulation. |
| Admin oversight | Admin overview, user management, and moderation workflow are active. | `src/admin/pages/AdminOverview.jsx`, `src/admin/pages/AdminUsersPage.jsx`, `src/admin/pages/AdminModeration/AdminModerationPage.jsx` | Central team can monitor and manage content operations. |
| Runtime stability fixes | Key DB/runtime issues were resolved (brand_kit race, navbar post query mismatch, status write normalization in core admin paths). | `docs/database-consistency-audit.md`, `src/stores/BrandKitStore.js`, `src/components/User/UserNavbar.jsx`, admin moderation files listed in audit | Reduced demo risk and fewer hard runtime breaks during normal use. |
| Realtime foundations | Realtime subscriptions exist across dashboard/admin/generate/calendar areas. | `src/pages/Dashboard/UserDashboard.jsx`, `src/stores/SessionStore.js`, `src/admin/pages/AdminOverview.jsx` | Stakeholders can observe dynamic product behavior in demos. |

## 2. Remaining Work (Prioritized, Dependency-Aware)

## 2.1 P0 (Critical for Reliable End-to-End MVP Demo)

| Priority | Task | Why It Matters | Dependencies | Acceptance Outcome | Owner |
| --- | --- | --- | --- | --- | --- |
| P0 | Standardize canonical status values across user and admin flows | Prevents broken counts, wrong badges, and inconsistent lifecycle behavior | Shared constants module and pass through affected stores/components | All generation/post states render consistently and KPI counts match DB truth | Frontend + Backend |
| P0 | Fix calendar single-item schedule persistence path | Current flow can appear saved but not persist reliably | `CalendarPageV2`, `ScheduleModal`, `CalendarStore.updatePost` alignment | Scheduling from modal writes to DB and updates UI immediately | Frontend |
| P0 | Finalize generate result-state rendering reliability | Prevents completed outputs from appearing incorrectly in critical user flow | Status standardization and component checks in generation grid/panel | Completed outputs always display correctly after generation | Frontend |
| P0 | Ensure profile provisioning is guaranteed on signup | Role checks and admin/user views depend on profile data existing | Signup flow or DB trigger decision and implementation | New users always have required profile row after registration | Backend + DB |
| P0 | Remove remaining blocking schema mismatches in active user flow | Prevents data read/write failures in demo-critical paths | DB audit review and targeted query updates | No active user flow fails due to column or relation mismatch | Frontend + DB |

## 2.2 P1 (High-Value Completion Work)

| Priority | Task | Why It Matters | Dependencies | Acceptance Outcome | Owner |
| --- | --- | --- | --- | --- | --- |
| P1 | Implement scheduled publishing worker | Converts planning value into actual execution value | Edge function job, scheduler trigger, status transitions | Scheduled posts move through publishing to published/failed reliably | Backend |
| P1 | Implement real social OAuth connections | Replaces mock integration and unlocks real platform operation | Platform app credentials, OAuth redirect handling, token storage policy | Users can connect at least one real platform end to end | Backend + Product |
| P1 | Align optimal-time platform attribution pipeline | Needed for trustworthy scheduling recommendations | Query and relation fixes in service + daily analysis function | Recommendations reflect real platform performance data | Backend + Data |
| P1 | Replace mock data segments in admin analytics/timeline paths | Improves stakeholder trust in reported operational numbers | Real query integration and fallback policy | Admin analytics views are powered by real records in defined areas | Frontend + Backend |
| P1 | Wire calendar realtime updates cleanly without reload patterns | Keeps UI responsive and consistent during operations | Realtime subscription cleanup and event filtering | Calendar updates live without full page reload | Frontend |

## 2.3 P2 (Polish and Scale Readiness)

| Priority | Task | Why It Matters | Dependencies | Acceptance Outcome | Owner |
| --- | --- | --- | --- | --- | --- |
| P2 | Remove deprecated or parallel legacy files in active domains | Reduces maintenance burden and defect surface | Import verification and cleanup pass | No unused legacy generate/calendar paths in active tree | Frontend |
| P2 | Formalize migration-first DB workflow in repo | Prevents environment drift across team members | SQL migration organization and policy docs | Team can reproduce DB setup from repo alone | DB + Backend |
| P2 | Improve UX quality and consistency pass | Raises confidence for investor/client demos | Stable core flows (P0/P1 done) | Navigation, copy, and feedback states feel consistent across pages | Product + Frontend |
| P2 | Add lightweight integration test coverage for critical flows | Lowers regression risk in fast iterations | Stable canonical statuses and finalized flows | Core user journey validated by repeatable checks | QA + Frontend + Backend |

## 3. Delivery Dependencies (Gate View)

1. `P0 status standardization` must be completed before trustworthy KPI and lifecycle verification.
2. `P0 schedule persistence` must be completed before publishing worker validation.
3. `Profile provisioning` must be stable before role-based QA signoff.
4. `Publishing worker` and `real OAuth` must both be completed before production-like automation claims.
5. `Migration workflow` should be finalized before final readiness signoff.

## 4. Definition of Ready for Final MVP Signoff

The MVP is ready for completion signoff when:

1. User flow from generate to schedule to published state is reliable.
2. Admin sees matching lifecycle truth without status drift.
3. At least one real platform connection and publish path is validated.
4. DB setup and policies are reproducible from repository artifacts.
5. Critical demo journey completes without manual data patching.

## 5. Evidence Discipline Rule

All future "completed" updates in this document should include:
- Changed capability statement
- Repo evidence path(s)
- Acceptance outcome achieved

This keeps status reports investor-safe and implementation-auditable.
