# Target Repository and Architecture Structure

## Purpose
Provide a practical target structure that reduces coupling, clarifies ownership, and makes unfinished wiring easier to complete safely.

## Current Structural Pain Points
- Cross-domain edits are concentrated in one branch and one directory layer.
- Domain logic is split between page files, shared services, and org/admin-specific folders without strict boundaries.
- Edge functions mix public, user-auth, and service-role modes without a single registry.
- Legacy and active SQL model surfaces coexist without a canonical map.

## Target Frontend Structure

```text
src/
  app/
    router/
    providers/
    guards/
  domains/
    personal/
      pages/
      components/
      services/
      stores/
      contracts/
    platform_admin/
      pages/
      components/
      services/
      contracts/
    org_admin/
      pages/
      components/
      services/
      contracts/
    org_member/
      pages/
      components/
      services/
      contracts/
  shared/
    ui/
    services/
    utils/
    contracts/
  legacy/
    deprecated_generation/
```

Key rules:
- Domain pages call domain services, not mixed cross-domain service files.
- Shared services are infrastructure-only, not workflow owners.
- Contracts directory contains typed payload schemas for deep links and API responses.

## Target Edge Function Structure

```text
supabase/functions/
  _shared/
    auth/
    org/
    pipeline/
    http/
    telemetry/
  personal/
    generation/
    publishing/
  platform_admin/
    moderation/
    notifications/
    accounts/
  org/
    invitations/
    pipeline/
    calendar/
    assets/
    credits/
  system/
    cron/
    risk/
    health/
```

Key rules:
- Every function declares auth mode in a short header:
  - `public_token`
  - `user_auth`
  - `service_role_only`
- Keep one folder-level `README.md` per domain with invocation sources and owners.

## Target SQL Structure

```text
supabase/migrations/
  01_foundation/
  02_personal_workspace/
  03_platform_admin/
  04_org_workspace/
  05_security_and_policies/
  06_views_and_materialization/
  07_legacy_deprecation/
```

Key rules:
- Canonical model map must exist in docs and include legacy status.
- New view/function migrations must include tenant-scope notes.
- Deprecation migrations must include explicit replacement pointer.

## Contract Governance
- Add a contract registry under `docs/handoff/contracts/`:
  - route-state payloads
  - edge request/response envelopes
  - canonical table ownership by domain
- Add CI checks:
  - unresolved symbol checks for service modules
  - forbidden imports from `legacy/`
  - policy/auth mode declaration for every edge function entrypoint

## Rollout Plan
1. Introduce contract registry and shared role-authority module.
2. Split functions by auth mode and domain ownership.
3. Move deprecated generation modules into `legacy/`.
4. Enforce deep-link payload schema across org member routes.
5. Finish SQL legacy quarantine and active-model map.

## Expected Outcome
- Faster onboarding for new developers.
- Lower merge conflict rate.
- Clear, auditable boundaries between UI flows, service contracts, edge functions, and schema.

