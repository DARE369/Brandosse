# Workflow: Signup Completion

## Current Implemented Flow
1. Register page captures account type (`individual`, `organization`, `agency`).
2. Org/agency path stores pending signup intent in session storage.
3. User authenticates by email/password or OAuth.
4. `/complete-signup` loads intent and calls `provisionSelfSignupOrganization`.
5. Frontend invokes edge function `org-self-signup`.
6. Edge function creates/updates org, bootstraps defaults, updates context, and returns redirect.
7. Frontend refreshes access and navigates to returned org path.

## Expected Target Flow
- Full user-facing recovery path for provisioning failures.
- Clear progress states and explicit remediation actions.

## Breakpoints and Gaps
- Failure UI can retry or skip, but does not expose editable org inputs for correction.
- Provisioning diagnostics are not surfaced to user beyond generic error.

## Required Integration Points
- Add optional correction step for org name/slug and plan mismatch recovery.
- Map backend provisioning failure classes to user-safe messages.

## Suggested Implementation Order
1. Add structured error codes in `org-self-signup` response.
2. Extend `/complete-signup` UI to support corrective input.
3. Add analytics/audit event for retries and abandon actions.
