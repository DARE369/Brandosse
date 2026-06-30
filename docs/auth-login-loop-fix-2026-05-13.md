# Auth Login Loop Fix - 2026-05-13

## Issue

Repeated `GET /login` requests were caused by the authenticated app shell redirecting unauthenticated users in a non-idempotent way.

The main trigger was `NextAppAccessGate` in `src/next/NextAppProviders.jsx`:

- It depended on the full `location` object, whose identity could change on rerender.
- It called `navigate("/login")` and also scheduled a delayed `window.location.replace("/login")` fallback.
- During slow dev compiles or stale-session recovery, that could produce repeated login navigations before the route settled.

There was also an ambiguous post-login destination:

- Email login defaulted to `/app`.
- `/app` previously had a layout but no page.
- That made the role-based handoff depend on indirect routing behavior instead of an explicit app-home redirect.

## Fixes Applied

| File | Change |
| --- | --- |
| `src/next/NextNavigationProvider.jsx` | Memoized the navigation `location` object so auth redirect effects do not rerun just because a new object literal was created. |
| `src/next/NextAppProviders.jsx` | Made unauthenticated redirects idempotent per path and removed the delayed duplicate `window.location.replace` fallback. |
| `src/Context/AuthContext.jsx` | Made `login()` return Supabase sign-in data, ensured resolved profile state always includes the auth user id, and validates stored sessions with `auth.getUser()` before exposing a user to app pages. |
| `src/pages/Auth/Login.jsx` | After email sign-in, waits for database-backed access resolution before navigating. Destination now respects `admin_roles`, org membership context, and intended path safety. |
| `src/utils/authRouting.js` | Allows valid post-auth destinations like `/select-context` and `/complete-signup`, while still rejecting unsafe public paths. |
| `src/next/AppHomeRedirect.jsx` | Added a role-aware `/app` redirect client. |
| `app/app/page.jsx` | Added a concrete `/app` page that redirects users to the right workspace after auth resolution. |
| `src/Context/ThemeContext.jsx` | Made the first client theme render match the server (`system` preference) and applies stored theme after hydration to prevent the login-page theme toggle mismatch. |

## Stale Session Recovery

After the Supabase project mismatch was corrected, the browser could still hold a persisted `socialai-auth` session from the old project. Supabase then returned:

- `403` from `/auth/v1/user`
- `401` from REST table queries
- `No suitable key or wrong key type`

That means the JWT was signed for a different Supabase project and could not be trusted.

The auth provider now treats that as an invalid stored session:

1. `getSession()` may still return the local session payload.
2. `AuthContext` validates it with `auth.getUser()` before setting `user`.
3. If validation returns 401/403/JWT key errors, it removes `socialai-auth` from browser storage.
4. It signs out locally and keeps app pages behind the unauthenticated gate.
5. Protected page queries no longer start with a bad token.

Fresh sign-in events are not revalidated with a second blocking `auth.getUser()` call. Supabase just issued those sessions, and the login submit flow already resolves role/profile access before navigating. This avoids the `sign-in validation timed out` error while keeping stale persisted-session validation in place.

## Hydration Fix

The login page also reported a hydration mismatch in `ThemeToggle`:

- Server rendered `themePreference = system` with the monitor icon.
- First client render read `light` from `localStorage` and rendered the sun icon.

`ThemeProvider` now starts with the same server/client initial state, then reads local storage in a layout effect after hydration and applies the stored theme to the document.

## Role-Based Login Behavior

The role decision still comes from the existing database-backed path:

1. Supabase session identifies the auth user.
2. `getUserProfileAndRole()` reads the matching `profiles` row.
3. It reads the user's `admin_roles` row when present.
4. `admin_roles.role` wins over profile role hints.
5. `resolveWorkspaceRedirectPath()` chooses:
   - `/app/admin` for `super_admin` or `org_admin`
   - stored organization workspace when the last context is valid
   - `/select-context` when the user has active org memberships but no stored context
   - `/app/dashboard` for normal personal users

The admin dashboard gate still blocks non-admin users through `AdminAccessGate`, using `adminRole || resolvedRole || profile.role`.

## Database Mapping Verification

Using `.env.local` after the Supabase project fix, the schema probe verified these records/tables are available:

| Table/Record Path | Result |
| --- | --- |
| `profiles` with `id`, `full_name`, `email`, `role`, `organization_id` | OK |
| `admin_roles` with `user_id`, `role`, `organization_id` | OK |
| `organization_members` with `user_id`, `organization_id`, `role`, `status` | OK |
| `context_last_used` with user/context mappings | OK |

Current counts observed during verification:

| Table | Count |
| --- | ---: |
| `profiles` | 11 |
| `admin_roles` | 2 |
| `organization_members` | 2 |
| `context_last_used` | 3 |

## Verification

Commands run successfully:

```bash
npm run check:env-security
npm run check:production-workflow
npm run check:status-literals
npm run build
```

After the stale-session recovery patch, these quick checks were rerun successfully:

```bash
npm run check:env-security
npm run check:production-workflow
npm run check:status-literals
```

After the hydration and fresh-sign-in timeout patch, these quick checks were rerun successfully:

```bash
npm run check:env-security
npm run check:production-workflow
npm run check:status-literals
```

The production build completed successfully and now includes `/app` as a static route.

## Operational Note

After this change, restart the dev server so Next picks up the corrected `.env.local` and route changes. If the browser still has a stale Supabase session from the wrong project, clear:

```js
localStorage.removeItem('socialai-auth');
location.reload();
```
