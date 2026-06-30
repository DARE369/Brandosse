# Workflow: User Investigation

## Current Implemented Flow
1. Admin opens `/app/admin/users` and filters directory rows.
2. Directory row opens `/app/admin/users/:userId`.
3. User detail loads profile, connected accounts, posts, generations, complaints, notes, and activity logs.
4. Admin can execute actions:
  - suspend/unsuspend user
  - send password reset
  - request user deletion approval
  - send direct user notification
  - add/update/delete admin notes
5. Embedded tabs extend investigation:
  - posts tab reuses moderation workspace
  - calendar tab allows schedule edits
  - complaints tab allows quick updates/comments

## Expected Target Flow
- A case-driven investigation flow where every action links to explicit entity context and produces complete lineage across support, moderation, and security domains.

## Breakpoints and Gaps Between Current and Target
- Complaint quick-comment action in user detail can target implicit/latest complaint instead of explicit selected case.
- No direct handoff from connected-account cards to `/app/admin/accounts` with account context.
- No explicit investigation case ID tying notes/actions/logs into one timeline.
- Cross-tab data can become stale during long investigations.

## Required Integration Points to Close the Gap
- Explicit complaint selection contract in user detail actions.
- Account drill-down contract (`accountId` deep link) into admin accounts console.
- Correlation ID propagation for investigation actions into `audit_logs`.
- Shared cache invalidation strategy across user detail tabs and moderation/calendar edits.

## Suggested Order of Implementation
1. Add explicit entity-target selection for complaint and account actions.
2. Introduce investigation correlation ID and attach to note/security/moderation writes.
3. Add cross-tab cache invalidation hooks for posts/calendar/complaints.
4. Add optional “investigation summary export” view from correlated events.
