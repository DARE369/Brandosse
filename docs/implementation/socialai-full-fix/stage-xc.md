# Cross-Cutting Log

## Objective

Track XC tasks (`XC-1`, `XC-2`) for deep-link payload standardization and dead-code quarantine.

## Change Log

### 2026-03-30

- `XC-1` completed:
  - Introduced `src/utils/buildDeepLink.js` with payload standard (`source`, `target`, `params`, `version`).
  - Added deep-link usage across org navigation entry points:
    - office/workspace/calendar/common-room/content-queue/library overview flows.
  - Added destination deep-link consumption with `extractDeepLinkParams()` in pipeline route to focus selected item.
- `XC-2` completed:
  - Quarantined legacy generation adapters under `src/legacy/generation`.
  - Quarantined legacy supabase helper under `src/legacy/supabase.js`.
  - Added canonical-path comments and references to prevent accidental reactivation.

## Verification Notes

- `rg` audit confirms legacy files are isolated under `src/legacy`.
- `rg` audit confirms `buildDeepLink` usage on active pipeline navigation paths.
- Build gate passed.
