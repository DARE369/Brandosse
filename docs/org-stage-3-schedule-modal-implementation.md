# Org Workspace Stage 3: Schedule Modal Implementation

Updated: 2026-03-27  
Stage status: implemented  
Validation status: `npm run build` passed

## What was implemented

### 1. Dedicated org schedule context function

Added:

- `supabase/functions/org-get-schedule-context/index.ts`

This edge function now:

- resolves schedule context lazily from either `pipeline_item_id` or `post_id`
- validates org membership and brand-project access before returning context
- returns the current post, linked pipeline item, generation, owner profile, reviewer profile, connected destination accounts, attached assets, and brand-kit summary
- returns resolved permission flags for:
  - schedule access
  - publish access
  - review access
  - whether the record is past-locked

This keeps the modal data load server-shaped and avoids moving more cross-table orchestration into the page.

### 2. Shared client-side schedule service

Added:

- `src/org/services/orgScheduleService.js`

This service now:

- calls `org-get-schedule-context`
- normalizes the response into a record shape the UI can render consistently
- merges server context with the existing calendar record shape so calendar and library entry points can reuse one modal component

### 3. New schedule modal UI

Added:

- `src/org/components/calendar/OrgScheduleModal.jsx`

Current modal behavior:

- opens as the new focused schedule/details surface for org content
- provides a `Details` tab for all members
- provides a `Schedule` tab only when the current user can actually schedule the record
- reuses the existing `SchedulePicker` and `PostPreview`
- falls back to the calendar/library record snapshot when the edge-function context request is unavailable, so the modal still renders instead of failing closed
- shows:
  - owner
  - platform
  - current stage
  - current schedule
  - connected destination account summary
  - linked assets
  - brand-kit strip
  - pipeline submission note when present

Action behavior inside the modal:

- reviewers/admin-like actors can approve or request revision
- schedulers can set or update schedule timing
- schedulers can optionally choose a connected account for the post owner before saving
- publishers can trigger publish-now from the same modal

### 4. Existing schedule path reused, not replaced

Updated:

- `src/org/services/orgCalendarService.js`
- `supabase/functions/org-calendar-publish/index.ts`

Current write behavior:

- scheduling still goes through `scheduleOrgCalendarRecord(...)`
- pipeline-linked content still goes through `org-calendar-publish`
- standalone org posts still update via the existing post update path
- Stage 3 extends that path to optionally write `account_id` and `platform` when a destination account is chosen

This preserves the current scheduling architecture while expanding the UI surface.

### 5. Calendar entry points now use the new modal

Updated:

- `src/org/pages/OrgCalendar.jsx`

Current behavior:

- clicking a calendar record now opens `OrgScheduleModal`
- approved queue items open the same modal
- review / publish / scheduling actions are now executed from the modal instead of the old drawer flow
- drag-and-drop scheduling and batch scheduling remain intact and still use the existing calendar service path

### 6. Library entry point added

Updated:

- `src/org/pages/OrgAssetLibrary.jsx`

Current behavior:

- when an asset is linked to a post or pipeline item, the detail panel now exposes `Open Schedule`
- that opens the same `OrgScheduleModal`
- this gives the library a real scheduling/details entry point without creating a second scheduling UI

### 7. Stage 3 styling

Updated:

- `src/org/styles/OrgCalendar.css`

Added styles for:

- schedule modal layout
- details/schedule tab switcher
- brand strip
- destination summary
- operational fact cards
- ghost action button variant

## What was intentionally left out

These items were not completed in this Stage 3 pass:

1. **Specific pipeline item deep-link state**
   - the modal can open the pipeline workspace
   - it still does not route to a dedicated pipeline-item detail URL/state

2. **Task context**
   - schedule context currently focuses on post + pipeline + generation + assets + brand kit
   - task-linked schedule context stays deferred to Stage 4

3. **Calendar drawer migration cleanup**
   - the new modal is now the active schedule/details surface
   - the old `CalendarDetailDrawer.jsx` file was not deleted in this pass

4. **Advanced conflict intelligence**
   - the modal validates time normally through the existing scheduling path
   - it does not yet add a richer collision detector beyond what the current calendar already enforces

5. **Dedicated account health guidance**
   - the modal can choose a connected account
   - it does not yet show an expanded remediation flow for expired/revoked connections

## How the system works now

### Calendar records

- opening a record uses the schedule modal
- the modal lazy-loads server-shaped schedule context
- if `org-get-schedule-context` is missing from the current Supabase deployment, the modal still renders from the record snapshot and shows an inline warning
- scheduling, review, and publish actions happen from that modal

### Queue records

- approved queue items use the same modal
- batch scheduling remains available from the queue surface

### Library-linked records

- asset detail can now open schedule context when linked content exists
- this works for both pipeline-linked and post-linked asset provenance

### Destination account behavior

- the modal loads connected accounts for the post owner
- choosing one writes `account_id` and aligns `platform` on save
- leaving the selector unchanged preserves the current destination

### Permission behavior

- contributors without schedule permission still get the details surface
- only authorized users get the `Schedule` tab
- review actions remain permission-aware and pipeline-state-aware

## Stage 3 deviations from the original staged spec

These were deliberate and align with the repo’s current structure:

1. **Service-first client integration**
   - the staged spec only required the modal and schedule context concept
   - this implementation adds `orgScheduleService` so both calendar and library can reuse the same normalization layer

2. **Modal replacement focused on operations**
   - the old inline scheduling drawer behavior was replaced at the interaction level
   - drag-and-drop and batch scheduling were left untouched because they already fit the current architecture

3. **Library scheduling through provenance**
   - the spec implied broader library scheduling entry points
   - this implementation uses asset provenance links to open schedule context instead of inventing a second scheduling flow for unattached assets

## Validation completed

Executed:

```bash
npm run build
```

Result:

- success
- Stage 3 client integration builds cleanly with the new modal, schedule service, and calendar/library wiring

## Post-implementation deployment note

During local verification, the app surfaced browser-side CORS errors for:

- `org-get-schedule-context`
- `org-brand-kit-upsert`
- `prompt-suggestions`

The actual root cause was not missing CORS handling inside those functions. The current `VITE_SUPABASE_URL` project returned `404 Not Found` to `OPTIONS` requests for those function routes, which means the functions are not deployed to that Supabase project (or the app is pointed at a different project than the one that has the functions).

What changed in the client after that finding:

- the schedule modal now degrades to record-snapshot rendering when the live context call fails
- edge-function client errors were normalized into explicit deployment/environment messages
- prompt suggestions now back off temporarily after a failed edge-function attempt so the UI does not spam repeated failing requests

Permanent resolution still requires deploying the referenced edge functions to the same Supabase project the frontend is using.

## Next-stage dependency note

Stage 4 can now attach task context to the schedule modal without replacing the scheduling surface again. The modal already has a lazy context path, destination-account support, and shared entry points from calendar and library.
