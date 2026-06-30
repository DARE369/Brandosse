# Connected Accounts Review Log

## Objective

Run regression on connected-accounts Stages 0-6 after roadmap fixes, then document findings, fixes, and evidence.

## Review Matrix

- Personal settings connections
- Mock publish flows
- Org shared account access rules
- Health cards and alert surfaces
- Admin accounts console maintenance actions

## Findings

### 2026-03-30

- Verified connected-account publish idempotency path after Stage 1 updates:
  - `mock_publish_logs.publish_request_id` migration in place.
  - `mock-publish` edge function dedupe by request id in place.
- Verified org scheduling/publishing paths still flow through connected account context checks (`org-calendar-publish`, schedule context loaders).
- Verified org/shared account access posture remains enforced in schedule context and destination selection (`can_user_post_to_account` path).
- Verified admin-side account maintenance surfaces remain present after Stage 4 changes (no regression to notification/query paths).
- Verified health-card and settings/account surfaces remain wired in repo after roadmap changes.

## Fixes Applied During Review

- No additional connection-specific blocking defects were discovered in this pass.
- Regression-adjacent fixes were absorbed in roadmap work:
  - publish idempotency migration + edge dedupe.
  - notification canonicalization without connected-account read-path breakage.

## Evidence

- Source-level path audit via `rg` across:
  - `supabase/functions/mock-publish`
  - `supabase/functions/_shared/mockPublish.ts`
  - org schedule/publish functions and services
  - connected-account settings/admin surfaces.
- Build gate (`npm run build`) passed after connection-adjacent changes.
