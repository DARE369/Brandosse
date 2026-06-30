# Workflow: Invite Acceptance

## Current Implemented Flow
1. User opens `/join?token=...`.
2. Frontend calls `previewOrganizationInvitation` (`org-accept-invitation` with `preview: true`).
3. UI branches by invitation state and session match:
   - pending + signed-in matching account -> auto-accept
   - pending + signed-out existing account -> redirect to login with prefilled email
   - pending + requires password setup -> password form
   - non-pending states -> terminal informational state
4. If password setup is required, frontend calls `completeOrganizationInvitationSignup`, signs in, refreshes access, then accepts invitation.
5. `acceptOrganizationInvitation` finalizes membership and redirects to workspace/overview.

## Expected Target Flow
- Invitation acceptance should include clear recovery guidance, auditable onboarding milestones, and explicit post-join orientation based on role.

## Breakpoints and Gaps Between Current and Target
- Recovery actions for expired/revoked/failure states are limited.
- No explicit onboarding checklist handoff after successful acceptance.
- Limited transparency for why acceptance failed in edge cases.

## Required Integration Points to Close the Gap
- Add remediation actions in terminal states (resend path, support path, sign-in correction).
- Add post-join role-based onboarding route contract.
- Add structured error-code mapping from invite edge functions to UI states.

## Suggested Order of Implementation
1. Add explicit error-code UI mapping and remediation buttons.
2. Add post-join onboarding route and redirect wiring.
3. Add telemetry for drop-off points in invite acceptance funnel.

