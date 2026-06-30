# Real User Flow Validation

Updated: 2026-05-13

Route smoke checks prove pages respond. This checklist validates browser behavior, auth state, redirects, UI actions, Supabase data paths, and role gates.

## Preconditions

- Production server running from a clean build:
  - `npm run build`
  - `npm run start:next -- -p 3001`
- `npm run smoke:routes` passes.
- `npm run check:env-security` passes.
- Browser smoke tests:
  - `npm run test:e2e:chromium`
  - `npm run test:e2e`
- Latest local Chromium result:
  - 6 unauthenticated public/auth/protected-route checks passed.
  - 3 authenticated checks skipped until `E2E_*` account variables are supplied.
- Test accounts exist:
  - personal user
  - platform admin
  - organization owner/admin
  - organization member
  - non-member user
- Active Supabase project has current migrations, functions, storage buckets, and required secrets.

## Optional Test Account Environment

Unauthenticated browser checks run without credentials. Authenticated checks are skipped unless these variables are set:

```bash
E2E_BASE_URL=http://localhost:3001
E2E_USER_EMAIL=
E2E_USER_PASSWORD=
E2E_ADMIN_EMAIL=
E2E_ADMIN_PASSWORD=
E2E_ORG_EMAIL=
E2E_ORG_PASSWORD=
E2E_ORG_ID=
```

## Public And Auth

| Flow | Steps | Expected Result |
| --- | --- | --- |
| Login success | Open `/login`, sign in as personal user. | Redirects to the resolved workspace, usually `/app/dashboard`; no auth overlay loop. |
| Login invalid password | Submit bad credentials. | Clear error; user remains on `/login`; no console crash. |
| Logout | Open profile menu, sign out. | Session clears and protected routes redirect to `/login`. |
| Register individual | Create a new individual account. | Profile is provisioned; user reaches dashboard or confirmation flow as configured. |
| Register organization | Choose org account type, provide org name/slug. | Pending signup intent resolves through `/complete-signup`; workspace opens or shows retryable setup error. |
| Password reset request | Open `/forgot-password`, request reset. | Success message appears; no duplicate submissions while pending. |
| Password reset completion | Open valid recovery link, set new password. | Password updates, user is signed out, `/login` shows success message. |

## Personal Workspace

| Flow | Steps | Expected Result |
| --- | --- | --- |
| Dashboard load | Open `/app/dashboard`. | Navbar/sidebar render, dashboard data loads or shows safe empty state, no content hidden by fixed shell. |
| Generate new session | Open `/app/generate`, submit prompt. | Session is created, generation enters processing/completed/failed state visibly. |
| Open generation deep link | Open `/app/generate/:sessionId#generationId`. | Correct session opens and selected generation is focused when present. |
| Calendar action | Open `/app/calendar`, schedule/reschedule a draft where test data exists. | Status and scheduled time update; UI refreshes without stale cards. |
| Library action | Open `/app/library`, move an eligible post to draft/schedule/retry where available. | Action respects status rules and updates list state. |
| Settings action | Open `/app/settings`, edit safe profile/preference field. | Save succeeds, persisted value reloads. |
| Brand kit action | Open `/app/settings/brand-kit`, review existing kit or start setup. | No missing-env/provider-key errors in browser console. |

## Admin Access

| Flow | Steps | Expected Result |
| --- | --- | --- |
| Admin allowed | Sign in as platform admin and open `/app/admin`. | Admin shell loads; overview widgets fetch or show safe empty states. |
| Admin denied | Sign in as non-admin and open `/app/admin`. | User is redirected to personal/default workspace; admin content is not visible. |
| Admin detail pages | Open users, orgs, complaints, logs, moderation. | Detail params resolve; outlet context provides admin capability flags. |

## Organization Access

| Flow | Steps | Expected Result |
| --- | --- | --- |
| Org member allowed | Sign in as active org member and open `/app/org/:orgId/workspace`. | Org shell opens; member pages render. |
| Org admin allowed | Sign in as org admin and open `/app/org/:orgId/admin/members`. | Admin route opens; member/invite controls match permissions. |
| Org admin denied | Sign in as non-admin member and open org admin route. | Redirects to member home with denied-state toast. |
| Org non-member denied | Sign in as unrelated user and open org route. | Redirects to `/select-context`; org content is not visible. |

## Credits And Video

| Flow | Steps | Expected Result |
| --- | --- | --- |
| Credits page | Open `/app/billing/credits`. | Balance and purchase state render; mock/payment mode handles missing Stripe safely. |
| Video submit | Open `/app/video/new`, submit valid test input. | Job is created or mock flow returns safe status; no secret leaks in client. |
| Video jobs | Open `/app/video/jobs` and a job detail page. | Job list/detail render; failed/missing job states are clear. |

## UI Polish Checkpoints

Run these viewports after any shell/dashboard polish:

- 1440x900
- 1024x768
- 430x932
- 375x812

Acceptance:

- no horizontal scroll
- sidebar opens/closes reliably
- navbar does not cover content
- touch targets are at least 44px
- dark and light themes preserve readable contrast
- no cards/buttons/text overlap
