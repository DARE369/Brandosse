# Stage 8 — Manual Invite Onboarding + Resend Standardization

## Scope

Stage 8 makes onboarding work without outbound email for both:

1. org member invites from `Members`
2. owner invites created during platform-admin organization provisioning

The Resend framework remains in the repo, but onboarding success no longer depends on email delivery.

Implemented scope:

1. manual-link-first invites for members and owners
2. pending invite management with:
   - copy link
   - revoke
   - regenerate
   - delete terminal invite records
3. token-first `/join` onboarding for:
   - new users creating a password
   - existing users signing in
   - signed-in matching users auto-accepting
   - wrong-email, expired, revoked, and accepted terminal states
4. role-aware redirect after acceptance:
   - `overview` for `org_owner` / `org_admin`
   - `workspace` for everyone else
5. access refresh so the org appears immediately in the context switcher
6. shared Resend helper retained with canonical envs:
   - `RESEND_API_KEY`
   - `RESEND_FROM_EMAIL`
   - `FROM_NAME`
   - `APP_URL`

---

## Files Added

### Edge Functions / Shared
- `supabase/functions/_shared/auth-users.ts`
- `supabase/functions/_shared/mail.ts`
- `supabase/functions/org-complete-invitation-signup/index.ts`
- `supabase/functions/org-revoke-invitation/index.ts`
- `supabase/functions/org-delete-invitation/index.ts`

### Docs
- `docs/org-stage-8-manual-invite-onboarding-implementation.md`

---

## Files Updated

### Invite and onboarding backend
- `supabase/functions/org-invite-member/index.ts`
- `supabase/functions/org-accept-invitation/index.ts`
- `supabase/functions/admin-notify-user/index.ts`

### Org/admin frontend
- `src/org/services/orgService.js`
- `src/org/components/InviteMemberPanel.jsx`
- `src/org/admin/MembersPage.jsx`
- `src/org/styles/OrgAdmin.css`

### Platform-admin owner invite surfaces
- `src/admin/components/CreateOrgPanel.jsx`
- `src/admin/components/OrgInvitePanel.jsx`
- `src/admin/pages/AdminOrgsPage.jsx`
- `src/admin/services/orgAdminService.js`

### Auth / onboarding frontend
- `src/Context/AuthContext.jsx`
- `src/pages/InvitationAccept/InvitationAcceptPage.jsx`
- `src/pages/InvitationAccept/InvitationAcceptPage.css`
- `src/pages/Auth/Login.jsx`

---

## Behavioral Changes

### Member invites

The org member invite flow is now explicitly manual-link-first.

- Primary action is `Create Invite Link`
- Result card always exposes the onboarding URL
- The optional email delivery control is removed from the member UI
- `org_owner` is excluded from the member invite panel
- Leaving brand projects unselected means broad access, not empty access

### Owner invites

Platform-admin organization provisioning now follows the same manual-link pattern.

- creating an organization generates the owner onboarding link
- regenerating owner access generates a fresh unique link
- admin UI copy now frames this as link sharing, not email sending

### Invite lifecycle

The members page now supports:

- active invite links: `Copy`, `Revoke`, `Regenerate`
- invite history: `Regenerate`, `Delete`

Deletion is server-side and only allowed for terminal invite records:

- `revoked`
- `expired`

Accepted invites remain immutable historical records.

### Manual invite onboarding

Manual onboarding now works like this:

1. An admin creates an invite link.
2. The app stores a unique `org_invitations.invitation_token`.
3. The admin copies and shares `/join?token=...` manually.
4. The invitee opens the link:
   - existing account → sign in and accept
   - new account → set password, then accept
5. The app refreshes org access and lands the user on the correct org home.

### Workspace entry

After signup or acceptance, the client refreshes org access before navigation so:

- `availableWorkspaces` includes the new org immediately
- the top-nav context switcher is up to date
- role-aware org landing is preserved

---

## Environment Rules

Production link generation should use:

- `APP_URL=https://social-media-agent-two.vercel.app`

Local development should **not** be added to the deployed `APP_URL` secret.
Localhost links still work because the frontend passes `window.location.origin` with the invite request, so local invites resolve to `http://localhost:5173/join?...` automatically.

---

## Mail Standardization

Transactional mail still uses the shared Resend helper in `supabase/functions/_shared/mail.ts`.

Normalized statuses:

- `sent`
- `skipped_not_configured`
- `failed_provider_error`
- `manual_link_only`

`org-invite-member` and `admin-notify-user` use this shared contract.

Legacy support:

- `FROM_EMAIL` is still read as a fallback
- `RESEND_FROM_EMAIL` is the canonical sender env

Invite UX no longer depends on email delivery for success.

---

## Required Deploy Steps

1. Redeploy these Edge Functions to the active Supabase project:
   - `org-invite-member`
   - `org-accept-invitation`
   - `org-complete-invitation-signup`
   - `org-revoke-invitation`
   - `org-delete-invitation`
   - `admin-notify-user`

2. Set this function secret now for production link generation:
   - `APP_URL=https://social-media-agent-two.vercel.app`

3. Keep these secrets ready for the later email cutover:
   - `RESEND_API_KEY`
   - `RESEND_FROM_EMAIL`
   - `FROM_NAME`

4. No schema migration is required for this stage.

---

## Validation

Validated with:

- `npm run build`

Build passed.
