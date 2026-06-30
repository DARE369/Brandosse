# Week 1 Scheduling Validation Checklist

Date: 2026-03-02  
Owner: Dare  
Scope: P0-2 scheduling persistence and modal integrity

## Preconditions

- Latest Week 1 closeout code is deployed locally.
- Database migration `20260302110000_profile_provisioning_and_status_domain.sql` is applied in target environment.
- Test user has at least one draft post.

## Validation Steps

1. Open Calendar page and schedule one draft with `ScheduleModal`.
2. Confirm the post moves from Drafts to calendar list without manual refresh.
3. Reload page and verify scheduled post persists.
4. Open bulk schedule flow and schedule multiple drafts.
5. Verify each updated post has `status = scheduled` and non-null `scheduled_at`.
6. Open Library and verify matching status badge shows `Scheduled`.
7. Open Dashboard and verify scheduled KPI increments as expected.

## DB Assertions (run in SQL editor)

```sql
-- Assert scheduled rows created by latest actions
select id, status, scheduled_at
from public.posts
where user_id = '<TEST_USER_ID>'
order by updated_at desc
limit 20;
```

Expected:
- New/updated rows have `status = 'scheduled'`
- `scheduled_at` is populated for scheduled rows

## Result Log

| Check | Result (Pass/Fail) | Notes |
| --- | --- | --- |
| Single schedule modal persists |  |  |
| Bulk schedule persists |  |  |
| Calendar UI updates immediately |  |  |
| Library status badge matches |  |  |
| Dashboard KPI matches DB |  |  |

## Signoff

- Tester: ____________________
- Date/Time: ____________________
