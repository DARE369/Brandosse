# Week 1 Regression Report

Date: 2026-03-02  
Owner: Dare  
Scope: Week 1 closeout (P0-1 through P0-5)

## Summary

This report captures Week 1 closeout verification for:
- Canonical status standardization
- Scheduling persistence integrity
- Profile provisioning guarantees
- Schema/domain consistency checks

## Automated Checks

| Check | Command | Result |
| --- | --- | --- |
| Status literal guardrail | `npm run check:status-literals` | PASS |
| Production build | `npm run build` | PENDING |

## DB Migration Verification

Migration: `supabase/migrations/20260302110000_profile_provisioning_and_status_domain.sql`

| Environment | Applied | Notes |
| --- | --- | --- |
| Dev | PENDING |  |
| Staging | PENDING |  |

## Functional Regression Script

Scenario: `generate -> save draft -> schedule -> dashboard`

| Scenario | Expected | Result | Evidence |
| --- | --- | --- | --- |
| Image generation completion | Generation reaches `completed` and appears in recent list | PENDING |  |
| Video generation completion | Generation reaches `completed` and appears in recent list | PENDING |  |
| Save draft | Draft post row created with `status = draft` | PENDING |  |
| Single schedule | Post transitions `draft -> scheduled` | PENDING |  |
| Dashboard KPI sync | Scheduled and published counts match DB | PENDING |  |
| Calendar badge sync | Badge reflects canonical status values | PENDING |  |
| Admin moderation publish/schedule | Writes canonical `published` / `scheduled` | PENDING |  |

## Provisioning Verification

| Scenario | Expected | Result | Notes |
| --- | --- | --- | --- |
| Email/password signup | Profile row exists immediately for new `auth.users.id` | PENDING |  |
| Google OAuth signup | Callback is idempotent and profile row exists | PENDING |  |

## Schema Assertions

```sql
-- Orphan profile check
select count(*) as orphan_profiles
from public.profiles p
left join auth.users u on u.id = p.id
where u.id is null;

-- Archived status check
select count(*) as archived_posts
from public.posts
where lower(status::text) = 'archived';

-- Allowed post status domain check
select status, count(*)
from public.posts
group by status
order by status;
```

Expected:
- `orphan_profiles = 0` (or validation intentionally deferred with recorded reason)
- `archived_posts = 0`
- Status set limited to `draft/scheduled/publishing/published/failed`

## Defects and Follow-up

| ID | Severity | Description | Owner | Target Date | Status |
| --- | --- | --- | --- | --- | --- |
| W1-CARRY-001 | P0 | Apply migration in dev and staging and attach output | Dare | 2026-03-02 | OPEN |
| W1-CARRY-002 | P0 | Complete manual regression script evidence rows | Dare | 2026-03-02 | OPEN |
| W1-CARRY-003 | P0 | Attach SQL assertion outputs to this report | Dare | 2026-03-02 | OPEN |
