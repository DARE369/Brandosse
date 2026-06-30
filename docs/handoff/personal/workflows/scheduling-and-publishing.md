# Workflow: Scheduling and Publishing

## Current Implemented Flow
1. User selects platform accounts and timing in post production or calendar/library modal.
2. Post rows are inserted/updated in `posts`:
   - scheduled path -> status `scheduled`
   - immediate path -> status `publishing`, then mock publish outcome drives final state.
3. Immediate path runs `executeMockPublishAttempts`:
   - each attempt calls edge function `mock-publish`
   - event `socialai:publish-complete` emitted with summary.
4. Global publish modal shows result summary and links user to next view.

## Expected Target Flow
- Same user-facing contract for scheduled and immediate publishing with auditable publish attempt lineage.

## Breakpoints and Gaps
- Missing idempotency contract for repeated immediate publish clicks.
- Cross-account partial success handling relies on client orchestration.
- No first-class user timeline page for `mock_publish_logs`.

## Required Integration Points
- Server-backed publish request tracker.
- Unified post/attempt correlation id across rows/events/notifications.
- Personal diagnostics view for publish attempt history.

## Suggested Implementation Order
1. Add publish request record and correlation id.
2. Update mock publish edge/service to enforce idempotency per request/account.
3. Add UI timeline in settings/help for publish diagnostics.
