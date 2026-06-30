# Stage 8 - Manual Invite Onboarding + Invite Lifecycle Standardization

## Summary
Stage 8 completes invite onboarding so organizations can reliably onboard members without depending on outbound email delivery.

This stage standardizes:

1. Manual invite link generation and sharing for org members and owner provisioning.
2. Invitation lifecycle controls (copy, revoke, regenerate, delete terminal records).
3. Token-first `/join` acceptance for new users, existing users, and already signed-in users.
4. Role-aware post-acceptance landing (admin roles to `overview`, contributors to `workspace`).
5. Access refresh after acceptance so the new org context appears immediately.

## Files Added
- `docs/STAGE_8_README.md`
- `docs/STAGE_8_IMPLEMENTATION_REPORT_2026-04-08.md`

## Primary Files In Scope
- `supabase/functions/org-invite-member/index.ts`
- `supabase/functions/org-accept-invitation/index.ts`
- `supabase/functions/org-complete-invitation-signup/index.ts`
- `supabase/functions/org-revoke-invitation/index.ts`
- `supabase/functions/org-delete-invitation/index.ts`
- `src/org/services/orgService.js`
- `src/org/components/InviteMemberPanel.jsx`
- `src/org/admin/MembersPage.jsx`
- `src/pages/InvitationAccept/InvitationAcceptPage.jsx`

## Database Changes
- Migration: none in Stage 8.
- RLS changes: none in Stage 8.

## Tables Used
- `public.organizations`
- `public.organization_members`
- `public.org_invitations`
- `public.org_role_templates`
- `public.brand_projects`
- `public.profiles`

## How to verify this stage is working

### Step 1 - Create and share invite link
1. Open org admin `Members`.
2. Create an invite for contributor/editor/reviewer.

Expected:
- Invite returns onboarding URL.
- Copy action works from result card.
- Flow is successful even without email provider setup.

### Step 2 - Invite lifecycle actions
1. Revoke an active invite.
2. Regenerate a revoked/expired invite.
3. Delete a terminal invite record (revoked or expired).

Expected:
- Revoke sets state to revoked and removes active usability.
- Regenerate returns a fresh token/link.
- Delete only works for revoked/expired records.

### Step 3 - Token-first join flow
1. Open `/join?token=<token>` for invite.
2. Test with:
   - signed-out existing account
   - new account requiring password setup
   - signed-in matching user

Expected:
- Existing account can sign in and accept.
- New account can complete password setup and accept.
- Signed-in matching user can accept directly.

### Step 4 - Post-acceptance routing + context refresh
1. Accept invite with admin role.
2. Accept invite with member role.

Expected:
- Admin roles route to org `overview`.
- Member roles route to org `workspace`.
- Org appears immediately in context switcher after acceptance.

## Known limitations / follow-up
- Email delivery remains optional infrastructure; manual links are canonical onboarding path.
- Accepted invite records are immutable history and are intentionally not deletable.
