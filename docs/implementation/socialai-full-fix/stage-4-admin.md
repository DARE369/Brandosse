# Stage 4: Platform Admin Log

## Objective

Complete Stage 4 tasks (`4A`, `4B`, `4C`) for drilldowns, moderation reviewer assignment, and notification schema cleanup.

## Change Log

### 2026-03-30

- `4A` completed:
  - At-risk users on admin overview are now navigable buttons to `/app/admin/users/:userId`.
- `4B` completed:
  - Added migration `20260330112000_posts_assigned_moderator.sql` for canonical `posts.assigned_moderator_id`.
  - Added assignment flow in admin moderation workspace:
    - bulk assign reviewer action
    - reviewer selector
    - audit logging on assignment.
  - Added "My Queue" filter (`assignmentScope=mine`) wired through list API filter `assigned_moderator_id`.
  - Updated `admin-list-posts` edge function and moderation fallback model to include assignment field.
- `4C` completed:
  - Added migration `20260330113000_admin_notifications_canonicalization.sql`:
    - backfill canonical fields
    - drop dual-sync trigger/function
    - canonical indexes.
  - Updated writers/readers to canonical notification fields:
    - `notification_type`
    - `is_read`
    - `recipient_admin_id`
  - Removed dual-field compatibility logic in admin notification client paths and edge writers.

## Verification Notes

- Source verification confirms no active app-layer dual-write on admin notifications.
- Admin moderation UI now issues assignment updates and supports My Queue filtering.
- Build gate passed.
