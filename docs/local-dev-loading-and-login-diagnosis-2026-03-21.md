# Local Dev Loading And Login Diagnosis

Updated: 2026-03-21

## Short Answer

The main problem is most likely not Vite or localhost itself. The stronger match is a database-side admin-role lookup issue combined with too many client-side Supabase queries.

The biggest blocker is this:

- every protected route waits for `getUserProfileAndRole()` in `src/services/authService.js`
- that function always queries `admin_roles`, even for normal users
- this repo already documents a known `admin_roles` RLS recursion failure that was fixed by `supabase/migrations/20260313090000_admin_rls_recursion_hotfix.sql`

If that migration is missing on your live Supabase project, login can succeed but the app can stay stuck on the loading overlay while role resolution hangs. That also explains why admin pages would feel much worse than normal pages.

## Evidence From This Codebase

1. `src/utils/protectedRoute.jsx` blocks rendering until role lookup finishes.
2. `src/services/authService.js` always does a follow-up query to `admin_roles`.
3. `docs/admin-dashboard-corrections-v2-2026-03-13.md` explicitly says admin access had an RLS recursion failure and lists the required migrations.
4. `npm run build` succeeds, so the app is not failing to compile.
5. Raw requests to the configured Supabase project responded in about 1.5 to 1.6 seconds from this machine, so the 5 to 7 minute wait is not explained by basic network reachability alone.

## Secondary Problems Making It Feel Worse

- `src/pages/Auth/Login.jsx` converts every login failure into "Invalid email or password", so timeouts or backend errors can look like a bad password.
- `src/Context/AuthContext.jsx` hides the entire app until the initial session check finishes.
- `src/components/User/UserNavbar.jsx` and `src/components/User/UserSidebar.jsx` each fetch the current user and profile again.
- `src/pages/Dashboard/UserDashboard.jsx`, `src/hooks/useRealtimeKPIs.js`, `src/stores/CalendarStore.js`, and `src/stores/LibraryStore.js` all make additional overlapping Supabase requests.
- `src/admin/pages/AdminOverview.jsx` loads broad datasets client-side and computes KPIs in the browser instead of using a smaller aggregated query.

## What To Fix First

1. Confirm these migrations are applied to the Supabase project in your `.env`:
   - `supabase/migrations/20260312153000_admin_foundation.sql`
   - `supabase/migrations/20260313090000_admin_rls_recursion_hotfix.sql`
   - `supabase/migrations/20260313103000_profiles_contact_and_activity_backfill.sql`
2. Re-test login after the migration check. If the app stops hanging after password acceptance, this was the primary blocker.
3. Change `src/pages/Auth/Login.jsx` to show the real auth error message instead of always showing incorrect password.
4. Centralize current-user/profile loading so navbar, sidebar, dashboard, and route guards are not all re-fetching t
he same data.
5. Replace broad admin page reads with paginated or aggregated server-side queries.
6. Add timing logs around `getSession()`, `getUserProfileAndRole()`, and admin overview fetches so future slowdowns are visible immediately.

## Most Likely Diagnosis

Primary cause:
missing or not-applied admin RLS hotfix migration on the connected Supabase database.

Secondary cause:
the frontend is over-fetching auth, profile, dashboard, calendar, library, and admin data, which makes every successful page load slower than it should be.
