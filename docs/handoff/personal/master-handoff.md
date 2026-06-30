# Personal Workspace Master Handoff (Stage 1)

## Plain-Language Overview
The personal workspace is the individual creator area. A user signs in, lands in dashboard/generate/calendar/library/settings/help, and manages end-to-end content creation and mock publishing without needing organization setup.

## Technical Architecture Summary
- Route scope:
  - `/login`, `/register`, `/auth/callback`, `/complete-signup`, `/select-context`
  - `/app/dashboard`, `/app/generate`, `/app/generate/:sessionId`, `/app/calendar`, `/app/library`, `/app/settings`, `/app/settings/brand-kit`, `/app/help`
- Core runtime components:
  - shared shell: `App.jsx`, `UserNavbar`, `UserSidebar`
  - state stores: `SessionStore`, `CalendarStore`, `LibraryStore`, `BrandKitStore`, `HelpStore`
  - auth/context: `AuthContext`, `authService`, `workspaceUtils`, `signupIntentService`
- Main persistence and compute:
  - Supabase tables/views
  - Edge functions for generation/publish/admin notification and signup completion

## Page Relationship Map
- Entry and identity:
  - `/login`, `/register`, `/auth/callback`, `/complete-signup`, `/select-context`
  - These routes decide if user goes to personal, admin, or org workspace.
- Core content loop:
  - `/app/generate` creates sessions/generations/posts.
  - `/app/calendar` schedules and re-times posts; can send user to generate.
  - `/app/library` manages drafts/media/templates and routes to generate for reuse.
  - `/app/dashboard` summarizes KPI/health and deep-links to generate/settings/calendar.
- Support and setup:
  - `/app/settings` handles connected accounts (personal writable, org read-only).
  - `/app/settings/brand-kit` configures brand context used by generation flows.
  - `/app/help` handles support knowledge and complaint submission.

## UI-Service-Edge-Schema Relationship Map
| UI Domain | Services/Stores | Edge Functions | Primary Schema Contracts |
| --- | --- | --- | --- |
| Auth/onboarding | `AuthContext`, `authService`, `signupIntentService` | `org-self-signup` | `profiles`, `admin_roles`, `organization_members`, `context_last_used` |
| Generation | `SessionStore`, `freepik.service`, `generationPipeline`, `ApiService` | `generateImage`, `editImage`, `generateVideo`, `videoStatus`, `generateCarouselPlan`, `enhance-prompt`, `mock-publish` | `sessions`, `generations`, `content_plans`, `posts`, `content_library_items`, `connected_accounts` |
| Calendar | `CalendarStore` | none directly (uses publish workflow through modal path) | `posts`, `ghost_slots`, `calendar_settings`, `optimal_posting_times`, `content_pillars` |
| Library | `LibraryStore` | none directly (uses generation/publish indirectly) | `posts`, `media_assets`, `content_templates`, `content_pillars`, `content_library_items` |
| Connected accounts | `connectionService`, `platformRegistry` | none | `connected_accounts`, `connected_accounts_health_summary`, `platform_registry`, `connection_events` |
| Brand kit | `BrandKitStore`, `brandKitLoader` | `extractBrandKit` | `brand_kit`, `brand_assets` |
| Help/support | `HelpStore` | `notify-admin-event` | `complaints`, `user_notifications`, `admin_notifications` |

## Implemented vs Missing Relationship Summary

### Implemented and working
- Personal auth to protected route gating.
- Session-based generation loop from prompt to draft/scheduled/publish write paths.
- Realtime sync across dashboard/generate/calendar/library via DB channels and `socialai:data-sync`.
- Connected account mock connect/reconnect/disconnect with health/event tracking.
- Complaint creation and admin notification dispatch with fallback insert path.

### Partially wired
- Brand kit extraction pipeline: frontend workflow exists, edge extraction currently placeholder.
- Generation provider architecture: active Freepik edge path plus older adapter paths still present.
- Org context in personal generate: supported only when explicit route state sets runtime org context.

### No relationship yet (observed)
- Library "Use in Post" for media does not pass selected media id into generate context.
- No explicit contextual handoff from publish failures to prefilled help complaint form.
- No unified contract file in code for action -> service -> schema dependencies.

## Missing-Link Inventory (Personal)
See `personal/wiring-gaps.md` for full inventory with recommended wiring contracts and risks.

## How To Complete Unfinished Wiring Safely
1. Canonicalize service boundaries first.
2. Add explicit route-state contracts for page-to-page handoffs.
3. Harden multi-write flows with idempotency and transaction boundaries where possible.
4. Gate all new personal-org bridge behavior with explicit scope checks.
5. Add event-level observability for cross-page workflows.

Detailed implementation sequence is documented in workflow files and wiring gap report.
