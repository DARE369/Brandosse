# Page: `/app/help`

## Page Purpose (Plain Language)
This page gives users self-help content and a support ticket flow for reporting product issues and tracking resolutions.

## Route and Access Rules
- Route: `/app/help`
- Access: authenticated user under protected app shell.
- Supports query state:
  - `?tab=tickets`
  - `?form=open`

## Component Composition
- `src/pages/HelpPage/HelpPage.jsx`
- Shared shell: `UserNavbar`, `UserSidebar`
- Related side entry:
  - `HelpPanel` (sidebar quick panel routes into this page).

## State, Hooks, Services
- Primary store: `HelpStore`
  - complaint fetch
  - complaint submit
  - mark viewed
  - tab/form state
- FAQ content source:
  - static `helpContent`.

## Data Contracts Touched
- Tables:
  - `complaints`
  - `profiles` (resolved admin display names for resolved tickets)
  - `user_notifications`
  - `admin_notifications` (fallback dispatch path)
- Storage:
  - `complaint-screenshots`
- RPC:
  - `mark_user_complaints_viewed`
- Edge function:
  - `notify-admin-event`
- Realtime channels:
  - none in help page itself
  - notifications are surfaced in navbar via `user_notifications` channel.

## Inbound Dependencies
- Sidebar help panel deep-links here.
- Navbar complaint-resolved notifications route to ticket tab.

## Outbound Dependencies
- Complaint submission dispatches admin notification workflow.
- Mark-viewed action updates complaint notification state used by sidebar/navbar unread badges.

## Current Working Relationships
- Form validation and optional screenshot upload are wired.
- Schema-variant fallback logic supports both newer and legacy complaint shapes.
- Ticket list reflects resolved/closed lifecycle states for user-submitted complaints.

## Missing or Partial Relationships
- User-facing complaint timeline/comments are not exposed despite complaint comment/history schema support.
- Fallback admin notification insert duplicates part of backend dispatch responsibility.

## No Relation Exists Yet
- No direct "report this exact failure" relation from generation/publish/account-error UI into prefilled complaint form.

## Recommended Wiring Contract
- Add contextual complaint prefill contract from failing workflows.
- Expose read-only complaint timeline from:
  - `complaint_status_history`
  - non-internal `complaint_comments`.

## Risks if Wired Incorrectly
- Incorrect visibility rules can leak internal admin-only complaint notes.
- Broken notification dispatch can create "ticket submitted but unseen by support" failures.
