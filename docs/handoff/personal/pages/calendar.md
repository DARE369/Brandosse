# Page: `/app/calendar`

## Page Purpose (Plain Language)
This page is the scheduling board for personal posts. It shows scheduled/published/failed items, drafts, ghost slot suggestions, and posting time recommendations.

## Route and Access Rules
- Route: `/app/calendar`
- Access: authenticated user under protected app shell.
- Alias route `/app/analytics` redirects here.

## Component Composition
- `src/pages/CalendarPage/CalendarPageV2.jsx`
- Shared shell: `UserNavbar`, `UserSidebar`
- Main feature components:
  - `CalendarView`
  - `ScheduleModal`
  - `CalendarDetailPanel`
  - `OptimalTimesPanel`
  - `GhostSlotsToggle`
  - `BulkScheduleModal`
  - `SelectFromLibraryModal`

## State, Hooks, Services
- Primary store: `CalendarStore` (`src/stores/CalendarStore.js`)
- Local UI state for filters, layout mode, modals, selected post.
- Uses navigation handoffs to generate/library.

## Data Contracts Touched
- Tables:
  - `posts`
  - `ghost_slots`
  - `calendar_settings`
  - `content_pillars`
  - `optimal_posting_times`
  - `media_assets` (select-from-library modal)
  - `connected_accounts` (select-from-library modal account targets)
  - `sessions` and `generations` (select-from-library modal creation path)
- RPC:
  - `get_best_posting_time`
- Edge functions:
  - mock publish path via `executeMockPublishAttempts` in library posting modal
- Realtime:
  - `calendar_updates` channel on `posts` and `ghost_slots`
  - browser event `socialai:data-sync`.

## Inbound Dependencies
- Dashboard, library, and generate write paths populate calendar-visible post records.
- Generate and library pages can navigate here after publish/schedule outcomes.

## Outbound Dependencies
- Calendar actions navigate to:
  - `/app/generate` (new, repurpose, edit, date prefill)
  - `/app/library?section=drafts` style route state usage
- Calendar writes update data consumed by dashboard/library/help notifications.

## Current Working Relationships
- Status-aware guardrails prevent editing published/publishing posts.
- Drag-drop rescheduling and modal scheduling update post records correctly.
- Select-from-library flow can generate complete post rows and immediate publish attempts.

## Missing or Partial Relationships
- Ghost slot generation source is not wired from this page; only toggle/fetch/accept behavior is visible.
- Best-times panel reads stored data but does not explain data freshness/source in UI.

## No Relation Exists Yet
- No direct relationship between calendar ghost slot settings and a visible suggestion generation job status/history.

## Recommended Wiring Contract
- Introduce ghost-slot generation job contract:
  - trigger source
  - last run timestamp
  - generated slot count and conflict handling.
- Add explainability metadata for optimal times.

## Risks if Wired Incorrectly
- Bad ghost-slot generation can overload user calendars with conflicting suggestions.
- Weak scheduling validation can backdate or publish at unintended times.
