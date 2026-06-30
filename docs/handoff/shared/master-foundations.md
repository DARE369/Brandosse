# Shared Foundations (Stage 1)

## Document Purpose
This document is the shared foundation handoff for all workspaces. It explains core app behavior once so workspace docs can reference it without repeating base mechanics.

## Evidence Base
- Frontend shell and routing:
  - `src/main.jsx`
  - `src/App.jsx`
  - `src/router/router.jsx`
- Access and redirect logic:
  - `src/Context/AuthContext.jsx`
  - `src/utils/protectedRoute.jsx`
  - `src/utils/PostAuthRedirect.jsx`
  - `src/utils/authRouting.js`
  - `src/services/signupIntentService.js`
- Workspace and org context:
  - `src/utils/workspaceUtils.js`
  - `src/org/context/OrgContextProvider.jsx`
  - `src/org/stores/orgRuntimeStore.js`
  - `src/org/services/orgService.js`
- Shared navigation and shell UI:
  - `src/components/User/UserNavbar.jsx`
  - `src/components/User/UserSidebar.jsx`
  - `src/components/User/ProfileMenu.jsx`
  - `src/components/Shared/WorkspaceSwitcherMenu.jsx`
  - `src/layouts/AuthLayout.jsx`
  - `src/components/Shared/AuthLoadingOverlay.jsx`
  - `src/components/Publishing/MockPublishModal` (mounted globally in `src/App.jsx`)

## Plain-Language System Model
Users sign in, the app checks what workspaces they are allowed to use, and then sends them to the right place. The same app shell wraps personal, admin, and organization routes. Workspace and role resolution happens before protected pages render.

## Technical Architecture
- Root provider stack:
  - React Query (`PersistQueryClientProvider` if storage persister exists, else `QueryClientProvider`)
  - `ThemeProvider`
  - `AuthProvider`
  - `RouterProvider`
- App shell under `/app`:
  - `App.jsx` mounts:
    - `LogoutProvider`
    - `WorkspaceRouteSync` (tracks current pathname in auth context)
    - `<Outlet />` for nested routes
    - global `MockPublishModal`
- Core guards:
  - `ProtectedRoute` for authenticated shell and admin enforcement
  - `OrgMemberRoute` and `OrgAdminRoute` for org-scoped nested routes

## Route System
- Public routes:
  - `/`, `/login`, `/register`, `/auth/callback`, `/join`, `/review/:clientReviewToken`
- Protected user bootstrapping routes:
  - `/complete-signup`, `/select-context`
- Protected app shell:
  - `/app/*` with nested personal, platform-admin, and org routes
- Intent route:
  - `/generate` redirects through `PostAuthRedirect` to `/app/generate`

See full ownership matrix in `shared/route-ownership-matrix.md`.

## Auth Resolution and Access Model
- Session source:
  - Supabase auth session from `supabase.auth.getSession()` and `onAuthStateChange`.
- Resolved identity state:
  - Profile and role via `getUserProfileAndRole()`:
    - metadata role hints
    - `profiles` role fields
    - `admin_roles` override when present
  - Org memberships via `getUserOrgMemberships()`.
  - Last context via `context_last_used` (`fetchContextLastUsed`).
- Result:
  - `resolvedRole`
  - `adminRole`
  - `orgMemberships`
  - `workspaceRedirectPath`
- Auth side effects:
  - Writes last active timestamp to `profiles.last_active_at` when possible
  - Attempts `write_audit_log` RPC for login/logout

## Workspace Switching
- Workspace catalog built with `buildWorkspaceCatalog()`:
  - personal workspace
  - optional admin workspace
  - org workspaces from active memberships
- Active workspace derived from:
  - current pathname
  - fallback `workspaceRedirectPath`
  - fallback `lastUsedContext`
- Switching (`switchWorkspace`) updates:
  - `context_last_used.last_context_type`
  - `context_last_used.last_organization_id`
  - `workspaceRedirectPath`

## Org Context Boundary
- Org routes (`/app/org/:orgId/*`) mount `OrgContextProvider`.
- Provider loads org runtime context via `fetchOrganizationContext()`:
  - organization
  - membership and role
  - resolved permissions
  - brand projects and active project
- Provider syncs runtime context into `orgRuntimeStore` and writes `context_last_used`.
- Personal pages can receive org runtime context only when explicitly passed through route state and consumed by page code (for example generate page supports this).

## Shared Navigation and Layout Contracts
- `UserSidebar` primary personal nav:
  - Dashboard, Generate, Library, Calendar, Analytics(alias), Settings, Brand Kit
  - Help panel shortcut
- `UserNavbar` global top bar:
  - generation search
  - notification aggregation
  - profile menu
- `ProfileMenu` includes `WorkspaceSwitcherMenu`.
- Auth pages use `AuthLayout`.

## Redirect Behavior
- No session:
  - protected routes redirect to `/login`
  - intended path stored in `sessionStorage` key `socialai-redirect-after-login`
- Signed in:
  - `PostAuthRedirect` chooses path by intended route + resolved role
  - if pending org signup intent exists, forced redirect to `/complete-signup`
  - if pending org invitation token exists, forced redirect to `/join?token=...`
- Unauthorized admin path:
  - redirected to personal workspace fallback
- Unauthorized org path:
  - redirected to `/select-context` or org home fallback

## Shared Data/Contract Touchpoints
- Tables:
  - `profiles`
  - `admin_roles`
  - `organization_members`
  - `organizations`
  - `context_last_used`
  - `user_notifications` (shared nav notifications)
- RPC:
  - `write_audit_log`
- Edge functions used by shared bootstrap paths:
  - `org-self-signup` (invoked from signup completion flow)

## Global Events and Cross-Page Sync
- `socialai:data-sync`: used by generate/calendar/library to refresh data after major writes.
- `socialai:publish-complete`: published by mock publish workflow, consumed by global modal.
- `socialai:seed-prompt`: used to prefill prompt input in generate page.

## Missing or Partial Relationships (Shared)
### 1) Parallel Supabase service layers
- Current state:
  - Most app code uses `supabaseClient.js`.
  - Legacy helper `src/services/supabase.js` still exists.
- Intended relationship:
  - Single canonical service client and auth/profile abstraction.
- Missing connection point:
  - Legacy helper is not integrated into current auth context patterns.
- Recommended wiring contract:
  - Deprecate `supabase.js` and route all auth/profile helpers through `authService` + `supabaseClient`.
- Risk if done incorrectly:
  - Role mismatch and duplicate auth assumptions.

### 2) Mixed generation provider strategy
- Current state:
  - Active flows use Freepik edge functions via `freepik.service.js`.
  - `ApiService.js` and parts of `generationPipeline.js` still represent older parallel provider paths.
- Intended relationship:
  - One generation orchestration contract for image/video/text enhancement.
- Missing connection point:
  - No explicit deprecation boundary between old and current paths.
- Recommended wiring contract:
  - Keep `SessionStore` + edge function path canonical; isolate legacy adapters behind feature flags or retire them.
- Risk if done incorrectly:
  - Inconsistent output quality, debugging complexity, and cost/usage drift.

## No Relation Exists Yet (Shared)
- There is no single global "capability matrix" that maps user role + workspace + feature flags to all route/action permissions in one place.
- There is no shared contract registry document in code that maps UI action -> service -> table/RPC/function as machine-readable metadata.

## Practical Handoff Notes
- Treat this file as the base layer.
- Stage docs for platform-admin, org-admin, and org-member should reference these rules, then add only workspace-specific behavior.
