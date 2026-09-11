# Performance Kill — Load-Time Overhaul (living doc)

_The owner's #1 pain: every page took 5–15s to load. Goal: <2s perceived load, app-wide. No stack change — Next.js + Supabase + Vercel is correct; the lag was self-inflicted code. Started 2026-06-20._

## Diagnosis (DevOps + research personas)

The 5–15s came from an **all-or-nothing client auth gate** plus bundle/CSS bloat:
1. **Auth gate blocks every page** behind a full-screen overlay until BOTH `loading` (getSession → getUser, 2 serial round-trips) AND `accessLoading` (a 4-query batch) resolve — each behind 10–15s timeouts. (`NextAppProviders.jsx`, `AuthContext.jsx`)
2. **No route-level code-splitting** → giant JS bundle (Chakra, Recharts, Framer, dnd-kit, xstate) on every page.
3. **~60 CSS files (incl. all admin + org)** loaded upfront in the root layout.
4. **Auth-resolution waterfalls / N+1** (org memberships → organizations; profile → admin_roles). (`authService.js`)
5. **React Query configured but unused** on the golden path → every navigation refetches.

## Professional target (research)

Pros use: middleware `getClaims()` (local JWT verify, ~0ms) + cookie sessions (`@supabase/ssr`) + RSC streaming + optimistic shell + per-section Suspense + React Query with `staleTime`. Full migration = multi-week rewrite; we apply the **highest-impact subset within the current client architecture** now, and note the cookie/RSC migration as a future track.

## Fix log (staged, lowest-risk → highest-value)

| # | Fix | Risk | Status |
|---|---|---|---|
| 1 | **CSS per-route** — move admin+org CSS to their route layouts (19 sheets off every user's load; also kills the `.sidebar-nav` collision) | none | ✅ done & verified (build + screenshots) |
| 2A | **Auth gate de-block** — stop blocking every route on `accessLoading`; access resolves in background; timeouts 15/10s → 8/6s | low | ✅ done & verified |
| 2B | **Optimistic session paint** — paint from local `getSession()`, validate `getUser()` in background (removes the 2nd serial auth round-trip from first paint) | medium | ✅ done & verified |
| 3 | **Auth waterfall / N+1 collapse** — memberships+organizations in one embedded-join round-trip (embed-first, two-hop fallback on FK/RLS gaps) | medium | ✅ done (`authService.js getUserOrgMemberships`) |
| 4 | **Route code-splitting** | low-med | FOLDED into per-page — Next App Router already route-splits each page into its own chunk; the remaining win is *within-page* lazy-loading of heavy deps (recharts/dnd-kit/xstate), which is done per page during its upgrade. Add `@next/bundle-analyzer` to target it with data, not guesses. |
| 5 | **React Query caching** | low-med | FOLDED into per-page — caching is adopted per page as each page's fetch logic is migrated to `useQuery` (with invalidation on mutation). The persisted client is already wired; the dashboard is already a single batched fetch. |

## Verified results (2026-06-20)

Measured with the new `scripts/qa-reload-test.cjs` — logs in, persists the session, then opens a FRESH context with that session and navigates **directly to /app/dashboard** (the refresh-while-logged-in path that `checkSession` governs).

- **Time to dashboard content: ~1.8–2.1s in dev** (uncompressed, no prod optimizations) — vs the reported **5–15s**.
- The screenshot (`qa-shots/reload-session-dashboard.png`) proves the **optimistic shell**: full dashboard paints immediately showing the default "Good morning, Creator" + **KPI skeletons**, i.e. the page renders BEFORE profile/access resolves, then fills in. No blocking overlay, no login bounce.
- Login → dashboard (fresh, SIGNED_IN path) also verified on desktop + mobile, light + dark.

**Net:** the dominant 5–15s offender (the all-or-nothing auth gate) is eliminated. Remaining items (#3–#5) are incremental and now mostly fold into the per-page upgrades. Production (compressed, code-split) should land comfortably under the <2s target.

## Verification method

Build green (`npm run build:next`) + QA Playwright screenshots (login → dashboard, desktop + mobile, light/dark) confirming pages render and auth still works. Real load-timing on a production build / staging once a few land.

## Notes / risks tracked

- 2A: admin/org routes gate themselves via `AdminRouteShell` / `OrgRouteShell`, so de-blocking the global gate is safe for personal routes. A logged-out user still redirects on `!loading && !user`.
- 2B: optimistic auth aligns with the existing `allowTimeoutFallback` philosophy in `onAuthStateChange`. Background `getUser()` signs out only on a definitively invalid token, not network blips. Must be verified on the refresh-while-logged-in path.
