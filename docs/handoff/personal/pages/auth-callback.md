# Page: `/auth/callback`

## Page Purpose (Plain Language)
This page completes OAuth sign-in, ensures user profile presence, and forwards users into app routing.

## Route and Access Rules
- Route: `/auth/callback`
- Access: public entry from OAuth provider redirect.

## Component Composition
- `src/pages/Auth/AuthCallback.jsx`
- Uses in-page status/error UI and `useNavigate`.

## State, Hooks, Services
- Reads current session with `supabase.auth.getSession()`.
- Checks and upserts `profiles` row when missing.
- Uses `resolveRole` helper for inferred profile role.
- Uses `getPendingSignupIntent()` to route org/agency signup completion.

## Data Contracts Touched
- Tables:
  - `profiles` (existence check + upsert fallback)
- Auth session:
  - Supabase auth token exchange in callback flow.
- Realtime channels: none.

## Inbound Dependencies
- Google OAuth flow started from login/register.

## Outbound Dependencies
- Redirects to:
  - `/complete-signup` if pending org signup intent exists
  - `/app` otherwise.

## Current Working Relationships
- Callback is idempotent for profile creation via upsert on `profiles.id`.
- Graceful retry for delayed session materialization.

## Missing or Partial Relationships
- Error UI allows retry to `/login` but does not expose structured failure reason categories.
- No dedicated telemetry event from callback component itself (auth context handles broader events).

## No Relation Exists Yet
- No explicit relation to invite acceptance flow (`/join`) inside callback page logic.

## Recommended Wiring Contract
- Add standardized callback result envelope:
  - `status`, `reason`, `next_route`.
- Optionally route invitation token state through callback if token is present at login start.

## Risks if Wired Incorrectly
- Profile provisioning race conditions can cause missing profile data in first-page render.
- Misrouted callback logic can trap users between login and callback loops.
