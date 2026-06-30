# Platform Admin Page: Complaints

## Page Purpose (Plain Language)
This page is the platform complaint queue. Admins use it to filter tickets by status and priority, quickly move new tickets into review, and open full case detail.

## Route and Access Rules
- Route: `/app/admin/complaints`
- Parent guard: `<ProtectedRoute requireAdmin>`
- Scope behavior:
  - Super admin sees cross-organization complaints.
  - Org admin is constrained to complaints where `organization_id = adminAccess.organizationId`.

## Component Composition
- Container: `src/admin/pages/AdminComplaintsPage.jsx`
- UI regions:
  - status tabs (`All`, `Pending`, `Under Review`, `Resolved`, `Closed`)
  - priority/search filter bar
  - complaint table with quick actions

## State, Hooks, Services Used
- React state:
  - `loading`
  - `complaints`
  - `profiles` map (submitter + assigned admin labels)
  - `filters` (`status`, `priority`, `search`)
- Services/helpers:
  - direct Supabase table reads
  - `updateComplaintRecord` (RPC wrapper) for quick status action
  - `normalizeComplaintStatus` local mapper for legacy status normalization

## Data Contracts Touched
- Tables read:
  - `complaints`
  - `profiles`
- Writes:
  - `complaints` updates through `public.admin_update_complaint_status(...)` RPC via `updateComplaintRecord`
- Realtime:
  - none on this page

## Inbound Dependencies
- Accessed from admin sidebar (`Complaints`).
- Also reachable from notification-center complaint links.

## Outbound Dependencies
- Opens complaint detail route: `/app/admin/complaints/:complaintId`.
- Quick action writes status changes that appear in:
  - complaint detail timeline
  - admin logs/audit feeds
  - user notifications (when resolved through RPC path)

## Current Working Relationships
- Legacy complaint statuses are normalized into the v2 UI status model before filtering/rendering.
- Profile lookups enrich submitter and assigned-admin labels in-table.
- `Mark as Under Review` uses the same RPC contract as detail page, preserving history/audit writes.

## Missing or Partial Relationships
- No row-level deep links to related user profile or related moderation item from list view.
- No live updates from complaint changes made by other admins; manual refresh through reload only.
- No pagination cursor; list is capped to latest 100 rows.

## No Relation Exists Yet
- No relation from this queue to SLA due-time management despite `complaints.sla_due_at` existing in schema.
- No relation from status tabs to organization health/risk dashboards.

## Recommended Wiring Contract
- Add explicit row actions:
  - `View User` -> `/app/admin/users/:userId`
  - `View Content` -> `/app/admin/moderation?post=...` or `?generation=...`
- Add server pagination contract (`page`, `limit`, deterministic sort key).
- Add realtime subscription or polling contract for multi-admin queues.

## Risks If Wired Incorrectly
- Weak scope filtering can leak cross-tenant complaint subjects/descriptions.
- Mixing client-side status normalization with inconsistent server filters can hide active tickets.
- Non-idempotent quick updates can overwrite assignment/status intent during concurrent triage.
