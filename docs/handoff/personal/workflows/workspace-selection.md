# Workflow: Workspace Selection

## Current Implemented Flow
1. `/select-context` loads only for authenticated users.
2. If user is platform admin, immediate redirect to `/app/admin`.
3. If user has no org memberships, redirect to `/app/dashboard`.
4. User chooses personal or org context card.
5. Selection updates `context_last_used`.
6. User navigates to:
   - personal: `/app/dashboard`
   - org: `/app/org/:orgId/(overview|workspace)` by role.

## Expected Target Flow
- Workspace choice plus optional brand project context selection in one step when needed.

## Breakpoints and Gaps
- Brand project selection is not part of context selector UI.
- Update failure on `context_last_used` is not surfaced to user.

## Required Integration Points
- Add brand project picker for org cards where multiple projects exist.
- Add visible fallback if context write fails.

## Suggested Implementation Order
1. Add optional project picker payload.
2. Extend `updateLastUsedContext` call to always include selected project.
3. Update target pages to consume and confirm selected context.
