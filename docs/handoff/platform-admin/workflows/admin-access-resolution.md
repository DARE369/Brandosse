# Workflow: Admin Access Resolution

## Current Implemented Flow
1. User enters `/app/admin/*`.
2. `ProtectedRoute requireAdmin` evaluates `useAuth().resolvedRole`.
3. Guard uses `authRouting.isAdminRole`, which currently treats only `super_admin` as admin.
4. If guard passes, `AdminLayout` loads `useAdminAccess`.
5. `useAdminAccess` + `rbac.normalizeAdminRole` recognize both `super_admin` and `org_admin`.
6. Admin pages then enforce additional page-level restrictions (for example, super-admin-only pages).

## Expected Target Flow
- One canonical admin-capability contract should drive:
  - route entry
  - sidebar/nav visibility
  - page-level feature access
  - backend scope checks

## Breakpoints and Gaps Between Current and Target
- Split authority logic:
  - route guard treats `org_admin` as non-admin
  - in-shell RBAC treats `org_admin` as admin.
- Duplicate normalization logic across `authRouting`, `rbac`, `AuthContext`, and `useAdminAccess`.
- No explicit reason-code telemetry for why an admin was redirected/blocked.

## Required Integration Points to Close the Gap
- Shared role/capability resolver module used by:
  - `ProtectedRoute`
  - `AuthContext`
  - `useAdminAccess`
  - sidebar/nav builders
- Contract-level tests for `super_admin` and `org_admin` route outcomes.
- Backend authorization parity checks for pages visible to each role.

## Suggested Order of Implementation
1. Define canonical `AdminCapability` model (`role`, `scope`, `allowedRoutes`, `allowedActions`).
2. Refactor route guard and admin-shell hooks to consume only this model.
3. Remove duplicate role-token parsing branches.
4. Add redirect-decision logging and regression tests for both admin roles.
