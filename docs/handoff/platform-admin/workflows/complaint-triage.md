# Workflow: Complaint Triage

## Current Implemented Flow
1. Admin enters `/app/admin/complaints` queue.
2. Complaints are normalized from legacy/new status values into canonical UI states.
3. Admin optionally quick-moves a case to `under_review` from list view.
4. Admin opens `/app/admin/complaints/:complaintId` for full handling.
5. Detail page supports:
  - assignment update
  - status transition
  - resolution notes
  - internal comments
6. Status updates execute through `admin_update_complaint_status` RPC, which writes:
  - complaint row update
  - status history
  - admin notification
  - audit log
  - user notification when resolved

## Expected Target Flow
- Deterministic queue-to-resolution flow with explicit ownership, SLA tracking, and conflict-safe updates across multiple admins.

## Breakpoints and Gaps Between Current and Target
- No realtime case updates; concurrent admins can act on stale page data.
- No concurrency/version guard on case updates.
- SLA model fields exist but are not actively used in triage views.
- User-detail quick complaint operations are weakly linked to explicit complaint selection.

## Required Integration Points to Close the Gap
- Add realtime subscription keyed by complaint ID and queue filters.
- Add optimistic concurrency guard (`updated_at` or revision token).
- Add SLA and age metrics to queue and detail surfaces.
- Unify complaint-target selection contract across queue, detail, and user investigation pages.

## Suggested Order of Implementation
1. Implement conflict-safe status update contract.
2. Add realtime updates for queue and detail views.
3. Add SLA-driven prioritization fields and sorting.
4. Align all complaint actions to explicit complaint IDs across admin pages.
