# Org Member Page: Invitation Acceptance

## Page Purpose (Plain Language)
This public page lets invited users join an organization workspace. It verifies invitation tokens, handles sign-in/account matching, supports password setup for new accounts, and finalizes membership.

## Route and Access Rules
- Route: `/join?token=...`
- Guard: Public route (not wrapped by `ProtectedRoute`)
- Access behavior:
  - token required
  - invitation state validated (`pending`, `accepted`, `revoked`, `expired`)
  - signed-in user email must match invite email to accept

## Component Composition
- Container: `src/pages/InvitationAccept/InvitationAcceptPage.jsx`
- Key child domains:
  - invitation preview states
  - error and terminal states
  - account mismatch/sign-out handling
  - password setup form when required
  - auto-accept path for matching authenticated sessions

## State, Hooks, Services Used
- `useAuth` for session/loading/access refresh/signOut.
- `orgService` invitation helpers:
  - `previewOrganizationInvitation`
  - `completeOrganizationInvitationSignup`
  - `acceptOrganizationInvitation`
- `supabase.auth.signInWithPassword` for new-account sign-in after password setup.
- Uses `sessionStorage` keys for redirect continuity:
  - `socialai-pending-org-invite-token`
  - `socialai-redirect-after-login`

## Data Contracts Touched
- Reads:
  - `org_invitations`
  - `organizations`
  - `brand_projects`
  - `profiles`
- Writes:
  - `organization_members`
  - `org_invitations` (accepted state, invited user id, flags)
  - `profiles` (new invited user path)
  - `context_last_used`
  - owner-related `organizations` fields for owner invitation acceptance
- Edge:
  - `org-accept-invitation`
  - `org-complete-invitation-signup`

## Inbound Dependencies
- Invitation links generated from org-admin member invitation workflow.
- Login flow redirect handoff through stored redirect path.

## Outbound Dependencies
- Redirects to org routes returned by backend:
  - member: `/app/org/:orgId/workspace`
  - admin/owner: `/app/org/:orgId/overview`
- Triggers org context initialization via normal protected app flow.

## Current Working Relationships
- Preview and acceptance logic are split cleanly and handle most token/session states.
- Password setup path can provision user, sign in, refresh access, and continue acceptance.
- Email mismatch handling is explicit and user-correctable.

## Missing or Partial Relationships
- Recovery UX is minimal for failure states (mostly static message plus sign-in hint).
- No contextual resend/escalation action embedded on terminal states.

## No Relation Exists Yet
- No direct relation to an onboarding checklist page after successful join.
- No dedicated invite-diagnostic support flow for users stuck in edge-case failures.

## Recommended Wiring Contract
- Add terminal-state remediation actions:
  - request new invite
  - contact admin
  - account recovery
- Add post-join onboarding handoff path with role-specific guidance.

## Risks If Wired Incorrectly
- Weak invite recovery paths can create onboarding drop-off and repeated support tickets.
- Relaxed email-match logic would be a serious account-security risk.

