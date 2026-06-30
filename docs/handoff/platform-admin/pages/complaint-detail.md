# Platform Admin Page: Complaint Detail

## Page Purpose (Plain Language)
This page is the full casework surface for a single complaint. Admins can inspect complaint context, assign ownership, update status/resolution, review history, and add internal notes.

## Route and Access Rules
- Route: `/app/admin/complaints/:complaintId`
- Parent guard: `<ProtectedRoute requireAdmin>`
- Scope behavior:
  - Requires admin workspace access.
  - Final data access still depends on backend access checks enforced by RPC/policies.

## Component Composition
- Container: `src/admin/pages/AdminComplaintDetailPage.jsx`
- Main sections:
  - complaint summary and cross-links
  - status/assignment/resolution editor
  - status history timeline
  - internal discussion thread

## State, Hooks, Services Used
- React state:
  - loading/saving/error states
  - complaint detail aggregate object
  - admin assignment options
  - status/resolution/comment form state
- Services/helpers:
  - `updateComplaintRecord` (RPC wrapper)
  - `addComplaintComment`
  - `resolveScreenshotUrl` helper for signed URL generation
  - route navigation to user and moderation pages

## Data Contracts Touched
- Tables read:
  - `complaints`
  - `complaint_comments`
  - `complaint_status_history`
  - `admin_roles`
  - `profiles`
- Storage:
  - bucket `complaint-screenshots` via signed URL lookup
- Writes:
  - `public.admin_update_complaint_status(...)` RPC (status/assignment/resolution)
  - `complaint_comments` insert (internal comments)
- Realtime:
  - none on this page

## Inbound Dependencies
- Opened from:
  - complaint queue (`/app/admin/complaints`)
  - admin notifications (`entity_type=complaint` or complaint metadata)
  - quick links from other admin surfaces

## Outbound Dependencies
- `View User` -> `/app/admin/users/:userId`
- `View Post` -> `/app/admin/moderation?post=:postId`
- `View Generation` -> `/app/admin/moderation?generation=:generationId`

## Current Working Relationships
- Status transitions and assignment updates use one atomic RPC contract.
- RPC writes status history, admin notification, audit log, and resolved-user notification when applicable.
- Comment timeline combines admin/user authors with profile-enriched identity labels.

## Missing or Partial Relationships
- No concurrency lock/version check for simultaneous edits by multiple admins.
- No realtime updates for new comments/status changes while page is open.
- `assigned_admin_id` options come from `admin_roles` list but without workload balancing/availability context.

## No Relation Exists Yet
- No relation to formal escalation workflow (priority/SLA ownership routing).
- No relation to attachment lifecycle beyond displaying existing screenshot URL.

## Recommended Wiring Contract
- Add optimistic concurrency guard:
  - include `updated_at` version in status update path
  - reject stale writes with explicit conflict response
- Add complaint realtime subscription channel keyed by `complaint_id`.
- Add assignment policy contract (eligible admins, max active queue, handoff reason).

## Risks If Wired Incorrectly
- Concurrent status edits can produce confusing/incorrect history without conflict controls.
- Incorrect signed URL handling can expose private complaint attachments.
- Loose assignment rules can route tickets to out-of-scope admins.
