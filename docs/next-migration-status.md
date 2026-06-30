# Next Migration Status

## Runtime

- Production framework: Next.js App Router.
- Primary commands:
  - `npm run dev` -> starts `next dev --turbopack` through `scripts/dev-turbo-prewarm.cjs` and prewarms common route families.
  - `npm run dev:turbo` -> raw Turbopack dev server without route prewarming.
  - `npm run build` -> `next build --turbopack`
  - `npm run start:next` -> `next start`
  - `npm run smoke:routes` -> smoke-test production-critical routes against `SMOKE_BASE_URL` or `http://localhost:3001`.
  - `npm run dev:webpack` -> fallback webpack dev server.
  - `npm run build:webpack` -> fallback webpack production build.
  - `npm run build:turbo` -> explicit Turbopack production build alias.
  - `npm run check:env-security` -> fail if active app code reintroduces legacy `VITE_*` env usage or reads server-only secrets from client/shared modules.
  - `npm run check:production-workflow` -> verify package scripts and `.next/BUILD_ID` workflow assumptions.
  - `npm run check:docs-canonical` -> verify canonical docs do not drift back to legacy runtime guidance.
  - `npm run check:production-ready` -> run the fast non-build guardrails together.
  - `npm run test:e2e:chromium` -> run browser-level validation in Chromium.
  - `npm run test:e2e` -> run browser-level validation across configured desktop/mobile projects.

## Native Route Coverage

The following route groups now have native Next route entries:

- Public and auth: `/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/auth/callback`, `/complete-signup`, `/join`, `/select-context`, `/review/[clientReviewToken]`.
- Personal app: dashboard, generate, calendar, library, analytics, settings, brand kit, help, credits, video jobs.
- Admin app: overview, users, accounts, organizations, moderation, complaints, logs, analytics, settings.
- Organization workspace: org home, overview, workspace, office, pipeline, calendar, library, common-room, team activity, org admin pages.
- APIs: credits, video jobs/clips/submit, Stripe webhook, video schema health.

`app/**/page.jsx` files now import their route components directly instead of routing through the old `src/next/NextRouteClients.jsx` registry or one-off `src/next/Next*PageClient.jsx` wrappers. The remaining `src/next` route helpers are active client shells with real framework responsibilities:

- `src/next/NextPublicProviders.jsx` wraps public/auth pages in the client provider stack.
- `src/next/AppHomeRedirect.jsx` resolves `/app` to the correct post-auth destination.
- `src/next/AdminRouteShell.jsx` applies admin access checks around the admin layout.
- `src/next/OrgRouteShell.jsx` applies org context/member access around the org workspace layout.

## Navigation

React Router compatibility has been removed from active app code. Route params are passed from native `app/**` wrappers into client page components, admin outlet state uses `src/admin/AdminLayoutContext.jsx`, mutable query-string updates use `src/next/useMutableSearchParams.jsx`, and simple navigation uses `useAppNavigation`, `next/link`, or `next/navigation`.

The legacy catch-all bridge now renders the not-found experience instead of booting the old SPA runtime.

Low-risk public/auth links, simple redirects, admin sidebar links, admin navbar navigation, auth login route-state reads, context selection, invitation acceptance search params, and route guards have been moved to `next/link`, `next/navigation`, `useAppNavigation`, or `src/next/AppRedirect.jsx`.

## Environment Security

- Active app code now uses `NEXT_PUBLIC_*` names for browser-safe values.
- Runtime config no longer injects legacy `VITE_*` names through `next.config.mjs`.
- Browser modules no longer read provider API keys directly; private provider calls should run through Supabase Edge Functions or trusted Next API routes.
- Local ignored env files were cleaned of obsolete `VITE_*` public/provider entries. Any key that was previously exposed through browser-prefixed variables should be considered public and rotated outside this code change.

## Production Validation

- Clean Turbopack production build passes with `npm run build`.
- Turbopack production build is startable and passes route smoke checks, so `npm run build` now uses `next build --turbopack`.
- Webpack remains available through `npm run build:webpack` for fallback comparison.
- `next start` serves the production build after `.next/BUILD_ID` is emitted.
- `npm run smoke:routes` currently covers 53 public, auth, personal app, admin, organization, video, and utility routes.
- Last route smoke result: 53/53 routes passed against `http://localhost:3001`.
- Browser-level behavior must be validated with `docs/REAL_USER_FLOW_VALIDATION.md`; route smoke checks do not prove login/logout, role gates, Supabase writes, or UI interactions.
- Browser-level Playwright checks live in `tests/e2e/real-user-flows.spec.js`; credentialed flows are skipped unless explicit `E2E_*` test account variables are provided.
- Latest Chromium browser validation: 6 unauthenticated public/auth/protected-route tests passed; 3 authenticated user/admin/org tests skipped because no `E2E_*` test account variables were provided.
- Auth hardening added during validation: initial session checks and email auth requests are bounded by timeouts, and unauthenticated app routes have a browser-level `/login` redirect fallback if Next router replacement does not complete.

## Performance Defaults

- Turbopack is the default dev and production compiler.
- Turbopack filesystem cache is explicitly enabled for dev and build.
- Local `npm run dev` prewarms common public, personal, admin, and org route families so the first developer click does not pay every cold route compile cost.
- Next package-import optimization is enabled for large shared UI packages such as `lucide-react`, `recharts`, `framer-motion`, Chakra, and Radix Dialog.
- Next client router stale times are tuned so recently visited static/dynamic routes can be reused briefly instead of refetching route payloads on every navigation.
- Static public assets receive long-lived immutable cache headers; API responses are marked `no-store`.
- The app-level mock publish modal is lazy-loaded instead of being bundled into the initial authenticated shell.

## Removed Legacy Runtime

- Removed the Vite app entry: `src/main.jsx`.
- Removed the orphaned public Vite HTML entry: `public/index.html`.
- Removed the unused legacy SPA app wrapper: `src/App.jsx`.
- Removed the unused React Router navigation provider: `src/Context/ReactRouterNavigationProvider.jsx`.
- Removed the React Router compatibility layer: `src/next/RouterCompat.jsx`.
- Removed the old React Router route registry: `src/router/router.jsx`.
- Removed the temporary Next SPA bridge files: `src/next/NextAppBridge.jsx` and `src/next/ReactRouterRuntime.jsx`.
- Removed the route wrapper registries: `src/next/NextRouteClients.jsx` and the thin `src/next/Next*PageClient.jsx` files.
- Removed Vite runtime files/scripts/dependencies: `index.html`, `vite.config.js`, Vite scripts, `vite`, `@vitejs/plugin-react`, `react-router-dom`, and `gh-pages`.
- Removed local generated native-build leftovers: `dist/` and `.vite-dev-*` logs. `.vite-dev-*.log` is now ignored.

## Remaining Cleanup

- Historical audit/handoff documents may still mention `src/main.jsx`, `src/App.jsx`, `src/router/router.jsx`, Vite, or React Router as past architecture. Canonical docs should use this file, `docs/TECHNICAL_CONSTRAINTS.md`, `docs/FEATURE_INVENTORY.md`, and `docs/platform-styling-and-theming-reference.md` as the current runtime source of truth.
- Keep new route work on native Next route props, direct route-component imports from `app/**`, `next/navigation`, `useAppNavigation`, `src/admin/AdminLayoutContext.jsx`, and `src/next/useMutableSearchParams.jsx`.
- Continue UI polish beyond the personal shell into admin and organization workspaces.
