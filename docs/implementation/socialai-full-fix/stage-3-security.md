# Stage 3: Security Log

## Objective

Complete security tasks `3A` and `3B` before broader rollout.

## Change Log

### 2026-03-30

- `3A` completed:
  - `supabase/functions/credit-monthly-reset/index.ts` enforces service-role authorization.
  - Unauthorized calls return `401`.
  - Successful reset writes audit row (`audit_logs`) with event `credit_monthly_reset`.
- `3B` completed:
  - Shared admin-role capability helper consolidated in `src/utils/adminCapability.js`.
  - Route/admin role normalization paths consume shared capability logic via `authRouting` and admin `rbac`.

## Verification Notes

- Source verification via function and utility audits.
- Build gate passed with security-path changes included.
