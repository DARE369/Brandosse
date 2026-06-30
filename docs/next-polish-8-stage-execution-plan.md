# Next + Shell Polish 8-Stage Execution Plan

Updated: 2026-05-14

## Stage 1: Runtime Documentation Cleanup

Goal: make canonical docs match the current Next-only runtime.

Scope:
- Update runtime, route, styling, and status docs away from removed Vite/React Router files.
- Preserve historical audit docs as historical records.
- Confirm legacy redirects that are still useful have native Next equivalents.

Acceptance:
- Canonical docs identify Next.js App Router as production runtime.
- Canonical docs point to `app/**`, `src/next/**`, and `src/styles/app-entry.css`.
- `npm run build` passes.

## Stage 2: Navigation Compatibility Cleanup

Goal: remove React Router-style compatibility usage in favor of native Next/shared navigation.

Scope:
- Prefer `useAppNavigation`, `next/link`, and route params passed by Next wrappers for new code.
- Do not churn working components without improving clarity.
- Completed cleanup pass: simple redirects now use `src/next/AppRedirect.jsx`; auth layout/admin sidebar links use `next/link`; auth login, context selection, invitation acceptance, admin navbar/profile/account actions, and route guards use direct app/Next navigation primitives instead of `RouterCompat`.
- Completed final cleanup pass: admin outlet state moved to `src/admin/AdminLayoutContext.jsx`; dynamic params are passed as explicit props from `app/**` route wrappers; org/admin mutable search-param flows use `src/next/useMutableSearchParams.jsx`; `src/next/RouterCompat.jsx` was removed.
- Completed route-wrapper cleanup pass: native `app/**/page.jsx` files import page components directly; `src/next/NextRouteClients.jsx` and thin `src/next/Next*PageClient.jsx` wrappers were removed. Remaining `src/next` route helpers are provider/access shells with active client behavior.

Acceptance:
- No package dependency on `react-router-dom`.
- No active app imports from `src/next/RouterCompat.jsx`.
- No active app imports from `src/next/NextRouteClients.jsx` or thin `src/next/Next*PageClient.jsx` wrappers.
- Build and smoke routes pass.

## Stage 3: Dashboard Token Consolidation

Goal: remove ad-hoc dashboard colors and align the personal shell with semantic tokens.

Scope:
- Consolidate `UserDashboard.css` raw color usage into semantic `--dash-*` tokens.
- Preserve dark command-center visual energy.
- Keep light theme values paired and intentional.

Acceptance:
- UI consistency raw color findings for `UserDashboard.css` are substantially reduced.
- Dark and light shells remain readable.
- `npm run check:ui-consistency` remains clean in non-strict mode.

## Stage 4: Personal Shell Responsive QA

Goal: make sidebar/navbar/content behavior reliable across desktop and mobile.

Scope:
- Verify sidebar expanded/collapsed/mobile states.
- Fix navbar/sidebar/content offsets.
- Confirm no content hides behind fixed shell elements.

Acceptance:
- 1440px, 1024px, 430px, and 375px layouts have no horizontal scroll.
- Sidebar opens/closes reliably.
- Touch targets are at least 44px.

## Stage 5: Light Theme Polish

Goal: make light mode feel designed, not mechanically inverted.

Scope:
- Tune background, surface, border, text, and accent tokens.
- Check dashboard, navbar, sidebar, cards, charts, and action controls.
- Preserve contrast and hierarchy.

Acceptance:
- Light mode has clear surface separation and readable text.
- Dark mode remains primary and unaffected.
- Theme switching does not cause layout shifts.

## Stage 6: Admin and Org UI Baseline Polish

Goal: align admin/org shells with the personal command-center direction without full redesign.

Scope:
- Normalize shell spacing, panel surfaces, and headers.
- Avoid broad rewrites of admin/org workflows.
- Fix obvious mobile and overflow issues found during review.

Acceptance:
- Admin/org pages feel visually compatible with the personal shell.
- No major content clipping at supported breakpoints.

## Stage 7: Critical Flow Validation

Goal: validate the routes and flows that define production readiness.

Scope:
- Login/logout.
- Register/reset password.
- Dashboard load.
- Generate/open session.
- Calendar/library/settings.
- Admin access allowed/denied.
- Org access allowed/denied.
- Video jobs and credits.

Acceptance:
- Route smoke checks pass.
- Known environment-dependent failures are documented separately from app regressions.

## Stage 8: Env and Security Cleanup

Goal: align environment naming and prevent accidental client exposure of secrets.

Scope:
- Prefer `NEXT_PUBLIC_*` for browser-safe variables.
- Remove or document transitional `VITE_*` fallbacks.
- Verify service-role and provider secrets stay server-only.
- Update `.env.example` and migration docs.

Acceptance:
- Browser env variables are explicit and public-safe.
- Server secrets are not referenced by client modules.
- Setup docs match the Next runtime.
