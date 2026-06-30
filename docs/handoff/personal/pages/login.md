# Page: `/login`

## Page Purpose (Plain Language)
This page lets existing users sign in with email/password or Google and then sends them to the right workspace.

## Route and Access Rules
- Route: `/login`
- Access: public
- If user is already authenticated, post-auth redirect logic typically moves user into `/app/*`.

## Component Composition
- `src/pages/Auth/Login.jsx`
- Layout wrapper: `AuthLayout`
- Auth source: `useAuth()` from `AuthContext`

## State, Hooks, Services
- Local state: email, password, loading mode, error.
- Uses:
  - `login(email, password)`
  - `loginWithGoogle()`
  - `getPendingSignupIntent()` from `signupIntentService`.

## Data Contracts Touched
- Direct DB tables/views: none from this page component.
- Auth provider side effects after login (via context):
  - Supabase auth session
  - profile/role/access resolution.
- Realtime channels: none.

## Inbound Dependencies
- Protected-route redirects set `socialai-redirect-after-login`.
- Registration and OAuth callback can return user to this page with message context.

## Outbound Dependencies
- Navigates to resolved path:
  - intended protected route
  - `/complete-signup` when pending signup intent exists
  - fallback `/app`.

## Current Working Relationships
- Correctly preserves intended target path and clears redirect token on success.
- Integrates with shared auth/session resolution in `AuthContext`.

## Missing or Partial Relationships
- "Forgot password?" anchor is placeholder (`href="#"`), no reset flow wiring.
- No explicit account lockout/throttle UI behavior.

## No Relation Exists Yet
- No direct relationship from login errors to support ticket creation flow.

## Recommended Wiring Contract
- Add password reset route and service contract:
  - UI action -> auth service -> Supabase reset API -> success redirect.
- Add structured auth error codes for consistent user messaging.

## Risks if Wired Incorrectly
- Incorrect redirect handling can route users to unauthorized workspaces.
- Reset flow without abuse protections can expose account enumeration vectors.
