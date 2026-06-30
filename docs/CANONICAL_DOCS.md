# Canonical Documentation Map

Updated: 2026-05-14

## Current Sources Of Truth

Use these documents for current architecture, runtime, environment, and validation decisions:

- `docs/next-migration-status.md`
- `docs/TECHNICAL_CONSTRAINTS.md`
- `docs/FEATURE_INVENTORY.md`
- `docs/platform-styling-and-theming-reference.md`
- `docs/mobile-tablet-layout-contract.md`
- `docs/POST_AND_GENERATION_LIFECYCLE_REFERENCE.md`
- `docs/handoff/README.md`

## Historical Material

Older audit, handoff, stage, and implementation documents may mention Vite, React Router, `src/main.jsx`, `src/App.jsx`, `src/router/router.jsx`, `src/next/RouterCompat.jsx`, `localhost:5173`, or Vite environment variables. Those references describe previous architecture or migration history.

Do not use historical runtime references as implementation guidance unless the claim is re-verified against:

- `package.json`
- `next.config.mjs`
- `app/**`
- `src/next/**`
- `src/styles/app-entry.css`

## Runtime Rule

The production app is Next.js App Router. The canonical production build is:

```bash
npm run build
```

That script must remain `next build --webpack` until Turbopack reliably emits a startable `.next/BUILD_ID` build for this project.
