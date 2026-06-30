# Page: `/register`

## Page Purpose (Plain Language)
This page creates new accounts for individuals, organizations, or agencies and sets up the next steps for workspace provisioning.

## Route and Access Rules
- Route: `/register`
- Access: public
- Post-signup navigation depends on session availability and signup type.

## Component Composition
- `src/pages/Auth/Register.jsx`
- Layout wrapper: `AuthLayout`
- Auth source: `useAuth().register` and `useAuth().loginWithGoogle`.

## State, Hooks, Services
- Local state for:
  - email/password
  - selected plan (`individual|organization|agency`)
  - org name/slug when org-style signup is chosen
- Uses `signupIntentService`:
  - `buildPendingSignupIntent`
  - `savePendingSignupIntent`
  - `clearPendingSignupIntent`
  - `SIGNUP_COMPLETION_PATH`

## Data Contracts Touched
- Direct calls through auth context and signup services:
  - Supabase auth user creation
  - fallback `profiles` upsert via context register path
  - optional org provisioning intent for `org-self-signup`.
- Realtime channels: none.

## Inbound Dependencies
- None required to open page.
- OAuth callback and login pages consume outcomes from this path.

## Outbound Dependencies
- Navigation on success:
  - direct app entry (`/app`)
  - `/complete-signup` for org/agency pending provisioning
  - `/login` when email confirmation is required.

## Current Working Relationships
- Correctly separates individual vs organization-style onboarding.
- Preserves org signup intent across OAuth flow using session storage.

## Missing or Partial Relationships
- Terms/Privacy links are placeholders (`href="#"`), no legal page routes.
- Slug uniqueness resolution is deferred to backend; no proactive availability check UI.

## No Relation Exists Yet
- No direct relationship to pricing/billing onboarding despite plan selection terminology.

## Recommended Wiring Contract
- Add pre-check endpoint for slug availability and reserved words.
- Add real Terms/Privacy routes with explicit version capture at signup.

## Risks if Wired Incorrectly
- Misaligned signup intent state can misroute users after OAuth.
- Weak slug handling can create ambiguous workspace URLs.
