# SocialAI Technical Constraints

Generated on: 2026-05-08  
Repository root: `c:\Users\Dare\Desktop\social-media-agent - Copy`  
Primary audience: engineers, technical leads, implementation agents, reviewers, and deployment owners.

## 1. Purpose

This document defines the technical boundaries that future SocialAI work must respect. It is not a feature list. It is the operating contract for how the product should be built, extended, tested, configured, and deployed without breaking existing routes, Supabase contracts, role access, or UI consistency.

Use this document before:

- adding or changing routes
- changing Supabase tables, policies, functions, or storage buckets
- wiring new AI, media, email, OAuth, or publishing providers
- touching authentication, workspace routing, organization access, admin access, or lifecycle statuses
- introducing new UI shells, tokens, status labels, responsive layouts, or global styles
- preparing a deployment or environment handoff

## 2. Documentation Plan

The technical constraints are organized around the areas most likely to create regressions:

| Area | What It Controls | Primary Source Files |
| --- | --- | --- |
| Stack and runtime | Frameworks, packages, scripts, lockfiles, local dev assumptions | `package.json`, `next.config.mjs`, `app/layout.jsx`, `README.md` |
| Architecture | Route ownership, shell boundaries, state ownership, navigation | `app/**`, `src/next/**`, `src/layouts/**`, `src/admin/AdminLayoutContext.jsx` |
| Auth and access | Session handling, post-auth routing, admin access, org membership guards | `src/Context/AuthContext.jsx`, `src/utils/protectedRoute.jsx`, `src/utils/authRouting.js`, `src/utils/adminCapability.js`, `src/org/context/OrgContextProvider.jsx` |
| Data and lifecycle | Supabase tables, migrations, RLS, status domains, storage buckets | `supabase/migrations/**`, `src/constants/statuses.js`, `docs/POST_AND_GENERATION_LIFECYCLE_REFERENCE.md` |
| Edge Functions | Server-side provider calls, privileged writes, deployed-function dependency | `supabase/functions/**`, `src/services/edgeFunctionClient.js` |
| Environment | Required browser env vars, server secrets, provider keys, deployment URLs | `src/services/supabaseConfig.js`, `supabase/functions/_shared/env.ts`, provider-specific shared modules |
| UI and responsive behavior | Theme model, token ownership, shell consistency, mobile/tablet contracts | `src/styles/tokens.css`, `src/Context/ThemeContext.jsx`, `docs/platform-styling-and-theming-reference.md`, `docs/mobile-tablet-layout-contract.md` |
| Quality gates | Build, status guardrails, UI consistency scan, current automated-test limitations | `package.json`, `scripts/check-status-literals.cjs`, `scripts/check-ui-consistency.cjs` |

## 3. Current Technical Snapshot

SocialAI is a React 18 application running on Next.js App Router and backed by Supabase Auth, Postgres, Realtime, Storage, and Edge Functions. It supports three main workspace families:

- personal user workspace under `/app/*`
- organization workspace under `/app/org/:orgId/*`
- platform/admin workspace under `/app/admin/*`

The frontend uses browser-side Supabase clients for authenticated user-scoped work and Supabase Edge Functions for provider integrations, privileged operations, email, org bootstrap flows, mock publishing, AI/media workflows, and scheduled or operational jobs.

The current feature inventory is documented in `docs/FEATURE_INVENTORY.md`. Any broad technical change should be reconciled with that file after implementation.

## 4. Stack Constraints

### 4.1 Frontend Runtime

- The app is a Next.js App Router application.
- React version is `^18.3.1`.
- Route ownership lives under `app/**`.
- Active app code must not use React Router compatibility APIs. Route params should come from native `app/**` route wrappers, mutable query-string behavior should use `src/next/useMutableSearchParams.jsx`, and shared navigation should use `useAppNavigation`, `next/link`, or `next/navigation`.
- The production build is created by `npm run build`, which maps to `next build --turbopack`.
- Webpack remains available as a fallback with `npm run build:webpack`.
- Local development uses Turbopack by default through `npm run dev`, which starts `next dev --turbopack` and prewarms common route families. Raw Turbopack dev is available with `npm run dev:turbo`; webpack dev is available with `npm run dev:webpack` for comparison or isolation.
- The local dev server default target is `http://127.0.0.1:3000`.

### 4.2 Core Client Libraries

Current core dependencies include:

- `@supabase/supabase-js` for Auth, database, Realtime, Storage, and Edge Function invocation.
- `@tanstack/react-query` and `@tanstack/react-query-persist-client` for cache/query behavior.
- `zustand` for feature stores.
- Next App Router for route hierarchy, layouts, redirects, and API routes.
- `lucide-react` for icons.
- `recharts` for charts.
- `@dnd-kit/*` for drag-and-drop interactions.
- `framer-motion` for motion.
- `xstate` / `@xstate/react` for state-machine capable flows.

New libraries should be added only when they provide clear value over existing stack capabilities.

### 4.3 Package Manager

- `npm` is the documented package manager in `README.md`.
- `package-lock.json` is present and should be treated as the canonical install lockfile unless the team explicitly switches package managers.
- `yarn.lock` is also present. Do not update both lockfiles casually; mixed lockfile changes can create install drift.

### 4.4 Scripts

Canonical scripts:

```bash
npm install
npm run dev
npm run build
npm run start:next
npm run smoke:routes
npm run check:production-workflow
npm run check:docs-canonical
npm run check:env-security
npm run check:status-literals
npm run check:ui-consistency
```

`npm run dev` and `npm run build` are Next commands. The old Vite runtime, Vite scripts, and GitHub Pages deployment path have been removed.

## 5. Build and Deployment Constraints

### 5.1 Next Build

- Production builds must be created with `npm run build`.
- `npm run build` must remain `next build --webpack` until `npm run build:turbo` reliably emits a startable `.next/BUILD_ID` build in this project.
- Build output is owned by Next in `.next`.
- Production startup requires `.next/BUILD_ID`; if `.next` exists without `BUILD_ID`, stop all project dev/start servers, remove generated `.next`, and rebuild.
- Native route entries under `app/**` must exist for production pages.
- `app/[...path]/page.jsx` is only a fallback/not-found route, not a SPA bridge.

### 5.2 Static Hosting

Because this is a Next App Router application:

- hosts must run Next or deploy through a Next-compatible platform
- direct links such as `/app/admin/users/:userId`, `/app/org/:orgId/calendar`, and `/review/:clientReviewToken` are handled by native Next routes
- API routes under `app/api/**` require the Next server runtime

### 5.3 Supabase Deployment Drift

The frontend can build while runtime features still fail if Supabase is not aligned. Deployment readiness requires:

- migrations applied to the active Supabase project
- Edge Functions deployed to the same project referenced by `NEXT_PUBLIC_SUPABASE_URL`
- secrets configured for the deployed functions
- storage buckets and policies present
- cron or scheduled jobs configured outside the source tree where applicable

`src/services/edgeFunctionClient.js` treats 404, CORS, network errors, and 5xx responses as likely deployed-function or environment mismatch problems.

## 6. Environment Variables and Secrets

### 6.1 Browser-Exposed Variables

These variables are compiled into the frontend and must not contain service-role secrets:

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Active Supabase project URL. Must be a valid HTTPS Supabase URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key for browser client. |
| `NEXT_PUBLIC_APP_URL` | Conditional | Public app URL used by invitation/client-link and checkout flows. |
| `NEXT_PUBLIC_ENABLE_PROMPT_SUGGESTIONS_EDGE_IN_DEV` | Optional | Allows prompt-suggestions Edge Function usage during local dev when set to `true`. |

Constraint: any `NEXT_PUBLIC_*` value is visible to browser users. Do not place `SUPABASE_SERVICE_ROLE_KEY`, provider production secrets, email secrets, private API keys, webhook secrets, or worker tokens in `NEXT_PUBLIC_*` variables. Active app code must not use legacy Vite-prefixed environment variables.

### 6.2 Supabase Edge Function Secrets

These are read server-side through `Deno.env` or compatible process env access:

| Secret | Required For | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | All Supabase-backed functions | Must point to the same project as the frontend unless intentionally cross-project. |
| `SUPABASE_ANON_KEY` | Auth-client functions | Used when functions preserve caller auth/RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin/privileged functions | Must never be exposed to frontend code. |
| `APP_URL` / `PUBLIC_APP_URL` / `NEXT_PUBLIC_APP_URL` | Invitation and client-review links | Prefer server-side `APP_URL` or `PUBLIC_APP_URL`; public app URL is a fallback in current functions. |
| `GROQ_API_KEY` | Server-side Groq LLM calls | Server secret is preferred over any client-exposed key. |
| `GROK_API_KEY` / `XAI_API_KEY` | Server-side xAI/Grok calls | Used by shared LLM helpers and prompt/carousel functions. |
| `GROQ_MODEL` | Optional model override | Defaults exist in code. |
| `GROK_MODEL` | Optional model override | Defaults exist in code. |
| `ANTHROPIC_API_KEY` | Optional Anthropic provider | Supported by `supabase/functions/_shared/llm.ts`. |
| `ANTHROPIC_MODEL` | Optional model override | Defaults exist in code. |
| `DEFAULT_AI_MODEL` | Optional provider preference | Used by shared LLM provider resolution. |
| `FREEPIK_API_KEY` | Freepik image/edit/video functions | Required by Freepik shared service. |
| `MYGROK_KEY` | Optional future prompt enhancement | Reserved in Freepik shared service. |
| `REPLICATE_API_TOKEN` | Legacy/start-generation video path | Required by `start-generation` when using Replicate. |
| `RESEND_API_KEY` | Transactional email | Required to send email through Resend. |
| `RESEND_FROM_EMAIL` / `FROM_EMAIL` | Transactional email | Sender address. |
| `FROM_NAME` | Transactional email | Defaults to `SocialAI`. |

### 6.3 Supabase Configuration Constraint

`src/services/supabaseConfig.js` validates that `NEXT_PUBLIC_SUPABASE_URL` is HTTPS and not a placeholder. If invalid, the app creates a fallback Supabase client pointing at `https://example.supabase.co`, but runtime data features will not work.

Do not treat a successful frontend render as proof that Supabase is configured correctly.

### 6.4 Environment Guardrail

Run `npm run check:env-security` before production handoff. It fails if active app code reintroduces legacy Vite environment names or reads server-only secrets from client/shared modules.

## 7. Architecture Constraints

### 7.1 Route Ownership

All primary production routes are declared as native Next routes under `app/**`.

Constraints:

- Public/auth routes stay outside the `/app` shell unless they require authenticated app chrome.
- Personal app routes live under `/app`.
- Platform admin routes live under `/app/admin`.
- Organization routes live under `/app/org/:orgId`.
- Client review routes live under `/review/:clientReviewToken` and must remain accessible outside the protected app shell.
- Invitation acceptance lives at `/join`.
- Legacy redirects, such as `/generate` to `/app/generate`, should be preserved as native Next redirects/pages unless intentionally removed.

### 7.2 Shell Boundaries

Current shell model:

- `app/layout.jsx` owns root document metadata and global stylesheet loading.
- `app/app/layout.jsx` mounts `src/next/NextAppProviders.jsx` for protected app routes.
- `src/next/NextAppProviders.jsx` owns protected app providers, auth gating, logout provider, and global mock publish modal.
- `src/layouts/OrgWorkspaceShell.jsx` owns organization workspace layout.
- `src/admin/AdminLayout.jsx` owns platform admin layout.
- Auth pages use `src/layouts/AuthLayout.jsx`.

New features should mount inside the correct shell instead of creating another top-level shell unless the route is intentionally public or external.

### 7.3 Provider Order

Provider order is split between `app/layout.jsx`, `app/app/layout.jsx`, `src/next/NextAppProviders.jsx`, and `src/next/NextPublicProviders.jsx`:

1. React Query provider, with session-storage persistence when available
2. `ThemeProvider`
3. `AuthProvider`
4. `NextNavigationProvider`
5. Access-specific providers such as `LogoutProvider` and app/public route gates

Do not move route logic above auth/theme providers without checking every consumer of `useAuth`, `useTheme`, React Query, and `useAppNavigation`.

### 7.4 Client Cache Constraints

React Query defaults:

- `staleTime`: 5 minutes
- `gcTime`: 1 hour
- `refetchOnWindowFocus`: false
- `refetchOnMount`: false
- `retry`: 1
- persisted cache key: `socialai-query-cache`
- persistence storage: `sessionStorage`

If a workflow requires immediate freshness, it must explicitly invalidate/refetch rather than assuming focus or mount refetching.

### 7.5 Feature State Ownership

Use existing feature stores/services before adding new global state:

- personal generation/session state: `src/stores/SessionStore.js`
- calendar state: `src/stores/CalendarStore.js`
- library state: `src/stores/LibraryStore.js`
- help state: `src/stores/HelpStore.js`
- brand kit state: `src/stores/BrandKitStore.js`
- org runtime/context: `src/org/context/OrgContextProvider.jsx`, `src/org/stores/orgRuntimeStore.js`

New persistent state should be backed by Supabase when it affects cross-device, cross-user, org, admin, or audit-sensitive behavior.

## 8. Authentication and Access Constraints

### 8.1 Authentication Source

Supabase Auth is the authentication source. The active client is created in `src/services/supabaseClient.js` with:

- token auto-refresh enabled
- persisted session enabled
- URL session detection enabled
- auth storage key `socialai-auth`

### 8.2 Post-Auth Routing

`AuthContext` resolves:

- current Supabase session
- user profile
- normalized role
- admin role
- organization memberships
- last used context
- user default workspace route
- workspace redirect path

Post-auth routing must continue to respect:

- intended path stored in `sessionStorage["socialai-redirect-after-login"]`
- pending organization signup intent
- pending organization invite token
- last-used personal/org/admin context
- default route from user settings

### 8.3 Role Normalization

Role normalization maps multiple raw values into canonical roles:

- `super_admin`
- `org_admin`
- `user`

Platform admin access currently treats both `super_admin` and `org_admin` as admin-capable at the route-guard layer, while individual admin navigation visibility still distinguishes platform scope.

Changing role names requires updates across:

- `src/utils/authRouting.js`
- `src/utils/adminCapability.js`
- `src/admin/utils/rbac.js`
- database policies/functions
- admin/org navigation and docs

### 8.4 Protected Routes

`ProtectedRoute` guards authenticated app routes and admin access. `OrgMemberRoute` and `OrgAdminRoute` guard organization membership and org admin capabilities.

Constraints:

- unauthenticated users must redirect to `/login`
- non-admin users must not remain on `/app/admin/*`
- non-members must not remain on `/app/org/:orgId/*`
- non-org-admin members must not remain on org admin pages
- redirects should preserve a sensible fallback workspace instead of trapping users in denied paths

### 8.5 Organization Context

Organization work depends on `OrgContextProvider`:

- `organizationId`
- active membership
- role
- permissions
- brand projects
- active brand project
- member/admin/owner/agency booleans

Org services should consume the active org and brand project context rather than accepting loosely inferred IDs from unrelated UI state.

## 9. Data and Supabase Constraints

### 9.1 Migrations Are the Source of Schema Change

Schema changes must be represented as versioned files in `supabase/migrations`.

Do not rely on undocumented dashboard-only table changes. Any dashboard hotfix must be backfilled into a migration before it becomes part of the project contract.

### 9.2 Row-Level Security

RLS is central to the data model. User, org, admin, storage, and workflow access must be enforced in Supabase, not only in React components.

Frontend route guards improve UX but are not a security boundary by themselves.

### 9.3 Service Role Usage

`SUPABASE_SERVICE_ROLE_KEY` belongs only in Edge Functions, scripts, and trusted server-side contexts.

Browser code must use the anon key and caller session. If a user action needs elevated privileges, expose it through an Edge Function with:

- user authorization check
- org/admin permission check where relevant
- minimal privileged database operation
- auditable outcome where appropriate

### 9.4 Storage Buckets

Known storage buckets:

| Bucket | Public | Limit | Purpose |
| --- | --- | --- | --- |
| `brand_assets` | false | 50 MB | Brand kit assets, documents, fonts, images, and videos. |
| `generated_assets` | true | 200 MB | Generated images/videos and related media. |
| `complaint-screenshots` | false | 5 MB | Support/complaint screenshots. |

`brand_assets` and `generated_assets` are provisioned in `20260222013000_storage_buckets_and_policies.sql`. Access is folder-scoped by authenticated user ID for the initial personal buckets.

`complaint-screenshots` is provisioned in `20260323100000_risk_notifications_and_help_system_core.sql` with authenticated owner/admin scoped access.

Org asset storage has additional service/function constraints through org asset upload flows.

### 9.5 Canonical Status Domains

Status values must be imported from `src/constants/statuses.js` in active flows.

Generation statuses:

- `processing`
- `completed`
- `failed`

Post statuses:

- `draft`
- `scheduled`
- `publishing`
- `published`
- `failed`

Pipeline statuses:

- `pending`
- `in_review`
- `revision_requested`
- `approved`
- `rejected`
- `withdrawn`
- `scheduled`
- `published`

Credit request statuses:

- `pending`
- `approved`
- `denied`
- `partial`

Complaint statuses:

- `submitted`
- `under_review`
- `resolved`
- `closed`

Constraint: do not introduce raw lifecycle literals in queries or writes. Run `npm run check:status-literals` after touching lifecycle code.

### 9.6 Lifecycle Transition Constraints

Generation transitions:

- `processing -> completed`
- `processing -> failed`
- `failed -> processing`

Post transitions:

- `draft -> scheduled`
- `draft -> published`
- `scheduled -> publishing`
- `publishing -> published`
- `publishing -> failed`
- `scheduled -> draft`
- `failed -> scheduled`

Any new status or transition requires:

- constants update
- database domain or constraint update
- RLS/policy review
- UI badge/label update
- admin/user workflow review
- regression checklist update

### 9.7 Legacy Data Model Caution

Existing audits identify overlapping or legacy concepts, including older generation/session/scheduling tables and mock data paths. Do not build new functionality on legacy tables without confirming active consumers.

Known caution areas:

- `generated_content`
- `generation_sessions`
- `scheduled_generations`
- older mock analytics utilities
- `src/services/MockOAuthService.js`
- legacy generation modules under `src/legacy`

## 10. Edge Function Constraints

### 10.1 Function Responsibilities

Edge Functions own server-side work such as:

- AI and media provider calls
- prompt suggestions
- image/video generation and polling
- brand extraction and brand consistency checks
- SEO/caption/metadata generation
- organization setup and invitations
- org calendar publishing
- pipeline advancement and client-review links
- admin notifications and account actions
- risk processing and scheduled maintenance
- mock publishing workflows
- webhook handling

### 10.2 Authenticated Function Pattern

Functions that act on behalf of a user should:

- require an Authorization header
- create an auth client with caller authorization
- call `requireUser`
- rely on RLS where possible
- perform additional org/admin permission checks for sensitive actions

### 10.3 Privileged Function Pattern

Functions that use the service role must:

- keep service role usage as narrow as possible
- validate caller identity or service authorization
- avoid returning sensitive rows or tokens
- record audit/activity events for admin, publishing, risk, or account operations where the schema supports it

### 10.4 Function Availability

The frontend assumes deployed functions exist in the Supabase project referenced by `NEXT_PUBLIC_SUPABASE_URL`.

A common failure mode is a local app pointed at a Supabase project where functions were not deployed. The UI may cache unavailable function status for a short time to avoid repeated failing calls.

## 11. Provider and Integration Constraints

### 11.1 AI Text Providers

The server-side LLM helper supports:

- Groq
- xAI/Grok
- Anthropic

Provider fallback order depends on configured keys and optional provider preference. Production features should prefer server-side Edge Function usage over exposing provider keys in frontend env variables.

### 11.2 Media Generation Providers

Freepik is the active shared provider service for:

- text-to-image
- image editing
- text-to-video
- task polling and status normalization

Replicate remains present in a legacy/start-generation path. Do not expand Replicate usage without clarifying whether it is still part of the intended provider strategy.

### 11.3 Social Platform Connections

Current social platform connection and publishing flows are mock-oriented.

Constraints:

- do not claim live OAuth or live publishing until real provider OAuth, token storage, refresh, permissions, webhook handling, and publishing workers are implemented
- keep mock-provider behavior clearly labeled in implementation and docs
- any live OAuth integration must protect tokens server-side and support reconnect/failure handling

### 11.4 Email

Transactional email uses Resend when configured.

If `RESEND_API_KEY` or sender email is missing, current email helpers can return non-delivery statuses instead of throwing. Workflows that depend on email must provide manual-link or retry paths where appropriate.

## 12. UI, Styling, and Responsive Constraints

### 12.1 Theme Source of Truth

`ThemeContext` supports:

- `system`
- `light`
- `dark`

The root document receives:

- `data-theme`
- `data-theme-preference`
- `colorScheme`
- compatibility `dark` / `light` classes

Theme is applied by `ThemeContext` in the Next runtime. A future no-flash script should live in `app/layout.jsx` or a Next-supported script strategy, not in the removed Vite `index.html`.

Constraint: new CSS should prefer `[data-theme="light"]` and `[data-theme="dark"]` over new `.dark`, `html.dark`, or media-query-only theme systems.

### 12.2 Token Ownership

The active token foundation is `src/styles/tokens.css`, imported before other global styles.

New UI should consume existing semantic tokens before defining local values:

- `--color-*`
- `--brand-*`
- `--admin-*`
- `--org-*`
- `--dash-*`
- `--ui-*`
- semantic success/warning/danger/info tokens

Avoid creating a new route-level design system unless the feature is intentionally isolated and documented.

### 12.3 Global CSS Constraints

The codebase has legacy/global style overlap. Avoid adding unscoped generic classes such as:

- `.card`
- `.badge`
- `.btn-primary`
- `.btn-secondary`
- `.modal-overlay`
- `.status-badge`
- `.empty-state`

Prefer shared UI primitives under `src/components/Shared/ui` or feature-scoped class names.

### 12.4 Icon and Accessibility Constraints

- Use `lucide-react` icons where available.
- Icon-only buttons need an `aria-label`, `aria-labelledby`, or title-equivalent accessible name.
- Images need `alt`; use `alt=""` only for decorative images.
- Critical actions must be available without hover-only interactions.
- Focus-visible states must remain clear after responsive changes.

### 12.5 Responsive Contract

Supported width ranges:

- `0-599px` phone
- `600-899px` large phone / small tablet
- `900-1199px` tablet
- `1200px+` desktop

Key rules:

- side panels become drawers below tablet/desktop thresholds
- scheduling must remain possible without drag-and-drop
- modal flows must remain usable at 320px width
- use `min-width: 0`, `minmax(0, 1fr)`, and scrollable inner regions instead of rigid fixed-width layouts

Refer to `docs/mobile-tablet-layout-contract.md` before altering generate, calendar, or admin layouts.

## 13. Performance and Client Behavior Constraints

### 13.1 Bundle and Runtime

The project contains multiple feature-heavy routes and provider SDKs. Avoid adding large client-side dependencies when the work can live in an Edge Function or existing library.

### 13.2 Data Fetching

Because React Query disables mount/focus refetch by default, mutation flows must explicitly refresh affected data.

Realtime subscriptions and local stores should be reviewed together. Do not add duplicate realtime listeners for the same high-volume tables without confirming cleanup and scope.

### 13.3 Media Handling

Generated media, uploads, and previews can be large. Constraints:

- respect storage bucket file-size limits
- prefer async provider tasks and polling over blocking UI flows
- avoid base64-persisting large media in local/session storage
- keep generated media URLs and storage paths auditable

## 14. Testing and Quality Constraints

### 14.1 Current Automated Coverage

Automated test coverage is currently thin. The discovered test file is:

- `src/admin/components/AdminNavbar/AdminNavbar.test.jsx`

Do not assume broad regression coverage exists.

### 14.2 Required Local Checks

Run at minimum after relevant changes:

```bash
npm run build
npm run check:status-literals
npm run check:ui-consistency
```

Use `UI_CONSISTENCY_STRICT=1 npm run check:ui-consistency` when a strict UI gate is desired.

### 14.3 Manual QA Requirements

Because automated coverage is limited, changes should be manually checked across affected roles and shells:

- logged-out public/auth pages
- personal app user
- org member
- org admin
- platform/super admin
- mobile and desktop breakpoints
- missing or unavailable Edge Function behavior
- missing provider secret behavior

## 15. Security Constraints

### 15.1 Secrets

- Never commit `.env` files or secrets.
- Never expose service-role keys to browser code.
- Prefer server-side provider secrets for AI, media, OAuth, email, and publishing.
- Treat `NEXT_PUBLIC_*` provider keys as public from a security perspective. Legacy `VITE_*` provider keys should be migrated or removed.

### 15.2 Authorization

Frontend checks are UX helpers only. Data protection must be enforced by:

- Supabase Auth
- RLS policies
- Edge Function authorization checks
- org permission checks
- admin capability checks

### 15.3 Auditability

Admin, auth, org, risk, account, and publishing workflows should write audit/activity events where supported. Existing auth flows already attempt login/logout audit writes through `write_audit_log`.

### 15.4 External Review Links

Client review links and invitation flows must:

- use non-guessable tokens
- resolve against the correct public app URL
- avoid leaking privileged org/admin data
- support revocation/expiry where the workflow provides it

## 16. Operational Constraints

### 16.1 Known Mock or Placeholder Areas

Current known limitations:

- real social OAuth is not complete
- live social auto-publishing is not complete
- native platform analytics are mock-ready/placeholders in some areas
- some admin analytics/timeline utilities still use mock data
- some legacy generation and data-model code remains in the tree
- Edge Function runtime behavior depends on deployed functions, secrets, storage policies, and cron configuration outside the React build

### 16.2 Live Environment Validation

Before calling an environment production-ready, verify:

- frontend env points to the correct Supabase project
- Supabase migrations are applied
- RLS policies are active
- storage buckets exist with expected limits and MIME types
- Edge Functions are deployed
- Edge Function secrets are configured
- email provider is configured or manual-link fallbacks are acceptable
- scheduled jobs/cron tasks are configured where needed
- mock-only social flows are acceptable for the release scope

## 17. Change Control Checklist

Use this checklist for any substantial change:

1. Does the change belong to personal, org, admin, public/auth, or external/client-review surface?
2. Is the route mounted inside the correct shell?
3. Does it require a migration, RLS policy, Edge Function, or storage bucket update?
4. Does it introduce or change a lifecycle status?
5. Does it require a new environment variable or secret?
6. Does it expose any secret to the browser?
7. Does it affect post-auth routing, workspace context, org membership, or admin access?
8. Does it use existing tokens, primitives, icons, and responsive rules?
9. Does it work when related Edge Functions are unavailable?
10. Were `npm run build`, `npm run check:status-literals`, and relevant UI/manual checks completed?
11. Should `docs/FEATURE_INVENTORY.md` or a handoff document be updated?

## 18. Source Documents to Keep in Sync

Keep this document aligned with:

- `docs/FEATURE_INVENTORY.md`
- `docs/CURRENT_MVP_DOCUMENTATION.md`
- `docs/POST_AND_GENERATION_LIFECYCLE_REFERENCE.md`
- `docs/platform-styling-and-theming-reference.md`
- `docs/mobile-tablet-layout-contract.md`
- `docs/database-consistency-audit.md`
- `docs/handoff/**`
- `src/admin/docs/**`
- `supabase/migrations/**`
- `supabase/functions/**`

## 19. Bottom Line

The main technical constraint is consistency across a growing multi-workspace product. SocialAI can tolerate feature expansion, but only if future work respects:

- Supabase as the backend contract
- versioned migrations and RLS as the data boundary
- Edge Functions as the privileged/provider boundary
- canonical lifecycle statuses
- established route shells and access guards
- existing theme, token, responsive, and UI guardrails
- explicit deployment validation beyond a successful frontend build
