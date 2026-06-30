# Workflow: Auth and Post-Auth Routing

## Current Implemented Flow
1. User accesses protected route.
2. `ProtectedRoute` checks auth session from `AuthContext`.
3. If unauthenticated:
   - Save intended URL to `sessionStorage` (`socialai-redirect-after-login`)
   - Redirect to `/login`.
4. After sign-in:
   - `AuthContext` resolves role/profile/admin/org memberships and `workspaceRedirectPath`.
   - `PostAuthRedirect` chooses final path from:
     - explicit intended path
     - managed redirect path
     - role default.
5. Special overrides:
   - Pending org invitation token -> `/join?token=...`
   - Pending org signup intent -> `/complete-signup`

## Expected Target Flow
- Deterministic route decision with one shared policy matrix for all workspace types.
- Full traceability for why user was routed to a specific workspace.

## Breakpoints and Gaps
- No single centralized capability matrix for path access and overrides.
- Role resolution depends on multiple fallback sources (`metadata`, `profiles`, `admin_roles`) and can drift.

## Required Integration Points
- Consolidate route decision logging and reason codes.
- Add single source of truth for workspace path policy by role/context.

## Suggested Implementation Order
1. Introduce route-decision contract object returned by auth layer.
2. Update guards/redirects to consume contract object only.
3. Add telemetry for route decisions and override triggers.
