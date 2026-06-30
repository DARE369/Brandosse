# Connected Accounts Mock Rollout — Stage 5

## Scope
- Org admins can connect and manage org-scoped shared accounts from `Org Settings`.
- Org members now see shared org accounts in personal `Settings` in a read-only tab.
- Org schedule flows now distinguish `Org` vs `Personal` destinations and block unauthorized shared-account selection.

## Implemented
- Added shared-account management UI in `src/org/admin/ConnectedAccountsAdmin.jsx`.
- Added org account cards and posting-access management in:
  - `src/org/components/OrgAccountCard.jsx`
  - `src/org/components/GrantAccessModal.jsx`
- Added personal read-only org account visibility in `src/pages/Settings/OrgAccountsReadOnlyTab.jsx`.
- Updated `src/pages/Settings.jsx` to expose `Connected Accounts` and `Organization Accounts` tabs for org members.
- Updated `src/org/admin/OrgSettingsPage.jsx` to mount the connected-accounts admin section.
- Added org account fetch/update helpers in `src/services/platforms/connectionService.js`.
- Updated org schedule/account routing in:
  - `supabase/functions/org-get-schedule-context/index.ts`
  - `supabase/functions/org-calendar-publish/index.ts`
  - `src/org/components/calendar/OrgScheduleModal.jsx`
  - `src/org/services/orgCalendarService.js`
  - `src/org/pages/OrgCalendar.jsx`
  - `src/org/components/calendar/CalendarContentCard.jsx`

## Behavior
- Org accounts use `scope = 'organization'` and are created through the same mock OAuth flow as personal accounts.
- Empty `granted_member_ids` means all publish-enabled org members can use the account.
- Non-empty `granted_member_ids` means only those specific members can publish through that shared account.
- Schedule modal now surfaces both personal and org destinations:
  - `Org` destinations show shared-account status.
  - Shared accounts without access are disabled in the selector.
- Publish-time validation now rejects unauthorized org account use server-side in `org-calendar-publish`.

## Manual Steps
1. Ensure `supabase/migrations/20260328005000_org_accounts_helpers.sql` is applied.
2. Redeploy updated edge functions:
   - `supabase functions deploy org-get-schedule-context`
   - `supabase functions deploy org-calendar-publish`
3. Verify Stage 5 flows:
   - org admin connects an org-scoped account
   - admin grants access to specific members
   - member sees read-only org accounts in personal settings
   - member can select allowed shared accounts in org schedule modal
   - member cannot select blocked shared accounts

## Validation
- `npm run build` passed.
