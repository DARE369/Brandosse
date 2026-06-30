# Workflow: Moderation Actions

## Current Implemented Flow
1. Admin opens `/app/admin/moderation`.
2. Queue loads via edge function `admin-list-posts` with fallback direct Supabase query if function is unavailable.
3. Admin filters/selects items and opens detail drawer.
4. Admin actions include:
  - save edits
  - force publish/schedule
  - archive
  - submit deletion request
  - bulk approve
  - rescore quality
  - regenerate/promote version (optional edge-function paths)
5. Writes propagate to posts/reviews/library and audit/request tables.
6. Realtime subscriptions on `posts` and `generations` invalidate queue data.

## Expected Target Flow
- A fully governed moderation lifecycle with explicit assignment, approval, execution, and traceability from intake to publish/delete outcome.

## Breakpoints and Gaps Between Current and Target
- Reviewer assignment control is disabled; ownership is not persisted.
- Optional moderation edge functions may be undeployed, creating environment-dependent capability gaps.
- No native linkage from moderated item to related complaint case timeline.
- Approval path for `admin_action_requests` is not surfaced directly from moderation workspace.

## Required Integration Points to Close the Gap
- Add reviewer ownership fields/contract in moderation domain.
- Add capability discovery handshake for optional edge functions.
- Add complaint linkage metadata contract (`complaint_id` references on affected content where relevant).
- Add approval execution surface for moderation-generated action requests.

## Suggested Order of Implementation
1. Implement capability detection and UI gating for optional moderation functions.
2. Add reviewer assignment model and enable assign control.
3. Wire approval lifecycle for deletion/force-sensitive actions.
4. Add complaint and audit correlation links in moderation item detail.
