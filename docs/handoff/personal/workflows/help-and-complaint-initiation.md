# Workflow: Help and Complaint Initiation

## Current Implemented Flow
1. User opens help center (`/app/help`) or sidebar help panel.
2. FAQ content is static in frontend.
3. User submits complaint form:
   - validates title/description/category
   - optional screenshot upload to `complaint-screenshots`
   - inserts complaint row (`complaints`) with schema fallback compatibility
4. Store invokes `notify-admin-event` edge function.
5. If edge call fails, fallback insert attempts `admin_notifications`.
6. User can view own ticket list with resolved/closed status and notes.

## Expected Target Flow
- Full ticket lifecycle visible to user with transparent status updates and threaded communication.

## Breakpoints and Gaps
- No user-visible complaint comment timeline despite schema support.
- No direct "report from failing workflow" contextual complaint bootstrap.
- Fallback notification insert path duplicates dispatch logic between edge and client.

## Required Integration Points
- Add complaint conversation/timeline UI.
- Add complaint prefill hooks from generation/publish/account failure surfaces.
- Move fallback notification strategy to backend where possible.

## Suggested Implementation Order
1. Add complaint timeline query and UI.
2. Add prefill adapters from error surfaces to help form.
3. Centralize admin notification dispatch policy server-side.
