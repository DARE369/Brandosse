# Page: `/complete-signup`

## Page Purpose (Plain Language)
This page finishes organization or agency self-signup by calling backend provisioning and then routing the user into the new workspace.

## Route and Access Rules
- Route: `/complete-signup`
- Access: protected (`ProtectedRoute` required).
- Requires pending signup intent in session storage to perform provisioning.

## Component Composition
- `src/pages/Auth/CompleteSignupPage.jsx`
- Uses `AuthLoadingOverlay` while auth/access state or provisioning is in progress.

## State, Hooks, Services
- Uses `useAuth()`:
  - `loading`
  - `accessLoading`
  - `refreshAccess`
- Uses `signupIntentService`:
  - `getPendingSignupIntent`
  - `provisionSelfSignupOrganization`
  - `clearPendingSignupIntent`

## Data Contracts Touched
- Edge function:
  - `org-self-signup`
- Indirect writes by edge function:
  - `organizations`
  - `organization_members`
  - related bootstrap tables
  - `context_last_used`
- Realtime channels: none.

## Inbound Dependencies
- Register/OAuth flow sets pending signup intent for org/agency onboarding.
- AuthContext can redirect here when pending signup intent is detected.

## Outbound Dependencies
- On success, navigates to edge-returned redirect (typically `/app/org/:orgId/overview`).
- On skip, clears intent and routes to `/app`.

## Current Working Relationships
- Retries provisioning using stored intent.
- Refreshes access context after successful provisioning.

## Missing or Partial Relationships
- Retry UX does not allow editing organization input values when backend rejects details.
- Error handling is message-based, not code-based.

## No Relation Exists Yet
- No direct relation to support ticket initiation for repeated provisioning failure.

## Recommended Wiring Contract
- Return structured error codes from `org-self-signup`.
- Add "edit signup details" mode in this page before retry.

## Risks if Wired Incorrectly
- Clearing intent too early can orphan partially provisioned org flow.
- Weak retry handling can create duplicate org records if backend idempotency is not preserved.
