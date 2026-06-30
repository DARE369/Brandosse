# Connected Accounts Mock Rollout — Stage 3

## Scope
- This pass wires immediate publish flows into the mock publish engine.
- It adds a shared publish result modal and routes personal and org publish actions through the same simulated publish path.
- Scheduling behavior remains unchanged.

## Implemented

### Shared publish workflow
- Added `src/services/platforms/mockPublishWorkflow.js`
- Added a shared browser event:
  - `socialai:publish-complete`
- Added aggregated publish execution for one or many mock publish attempts
- Added normalized success/failure summaries for UI and caller error handling

### Global publish result modal
- Added `src/components/Publishing/MockPublishModal.jsx`
- Added `src/components/Publishing/PostPreviewCard.jsx`
- Added `src/styles/MockPublish.css`
- Mounted the modal globally in `src/App.jsx`
- The modal now:
  - listens for publish completion events
  - renders success or failure states
  - supports multi-account publish attempts
  - supports retry for retriable failures
  - exposes mock post ID and permalink

### Personal publish flow
- Updated `src/stores/SessionStore.js`
  - immediate publish now creates/updates posts with `status='publishing'`
  - the store calls the mock publish engine instead of writing `published` directly
  - completion events are emitted for the global modal
- Updated `src/components/Generate/PostProductionPanel.jsx`
  - includes `mock` accounts in the selector
  - relies on the shared publish modal for immediate publish outcomes

### Calendar library publish flow
- Updated `src/pages/CalendarPage/components/SelectFromLibraryModal.jsx`
  - immediate posting now creates posts with `status='publishing'`
  - then calls the mock publish engine
  - emits the shared publish completion event for the modal

### Org publish flow
- Added shared server-side publish logic in `supabase/functions/_shared/mockPublish.ts`
- Updated `supabase/functions/mock-publish/index.ts` to use the shared helper
- Updated `supabase/functions/org-calendar-publish/index.ts`
  - `schedule` still writes scheduled state
  - `publish_now` now runs the mock publish engine instead of directly forcing published state
  - returns `success`, `mockPostId`, `mockPostUrl`, `failureReason`, and `failureIsRetriable`
- Updated `src/org/services/orgCalendarService.js`
  - emits the shared publish modal event for org calendar publish-now actions
- Updated `src/org/hooks/useOrgCalendar.js`
  - refreshes org calendar state after both success and failure paths

## Manual Steps

### 1. Deploy updated edge functions
Run:

```bash
supabase functions deploy mock-publish
supabase functions deploy org-calendar-publish
```

### 2. No new migration is required
- Stage 3 uses the Stage 0 tables and the Stage 1 functions already added earlier.

## Smoke Test

### Generate page
1. Open `/app/generate`
2. Choose a mock connected account
3. Publish immediately
4. Confirm:
   - post transitions through `publishing`
   - the global publish modal appears
   - `mock_publish_logs` row exists
   - `connection_events` contains `publish_success` or `publish_failure`

### Calendar library modal
1. Open the calendar
2. Launch `Select From Library`
3. Post immediately to one or more connected accounts
4. Confirm the modal appears and multi-account results are navigable

### Org calendar
1. Open an org calendar record that supports `Publish now`
2. Trigger publish
3. Confirm:
   - the org publish path returns a mock publish result
   - pipeline/post state updates according to success or failure
   - the same global publish modal appears

## Validation
- `npm run build` passes

## Remaining Work
- Stage 4: dashboard/admin health cards and connection-event log surfacing
- Stage 5: org connected-account management and member read-only org account views
- Stage 6: super-admin connected-accounts console and maintenance actions
