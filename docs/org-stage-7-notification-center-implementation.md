# Stage 7 — Org Notification Center

## Scope

Stage 7 replaces the org workspace bell shortcut with a real notification center and closes the invite-email blind spot that previously made member invites look successful even when delivery failed.

Implemented scope:

1. Real org notification center in the top nav
2. Unified org feed from:
   - `user_notifications`
   - Common Room unread channel activity
3. Per-notification actions:
   - mark read
   - mark all read
   - snooze for 24 hours
   - dismiss
4. Client-invoked reminder sweep for:
   - tasks due soon
   - revision-requested pipeline items
   - scheduled posts due soon
5. Deep links into:
   - Calendar task drawer
   - Pipeline board
   - Common Room
   - My Workspace fallback
6. Invite panel fallback when email delivery is not confirmed

---

## Files Added

### Database
- `supabase/migrations/20260328010000_org_notification_center_stage7.sql`

### Frontend
- `src/org/services/orgNotificationService.js`
- `src/org/hooks/useOrgNotifications.js`
- `src/org/components/OrgNotificationCenter.jsx`

### Docs
- `docs/org-stage-7-notification-center-implementation.md`

---

## Files Updated

### Invite flow
- `src/org/components/InviteMemberPanel.jsx`
- `src/org/services/orgService.js`
- `src/org/styles/OrgAdmin.css`
- `supabase/functions/org-invite-member/index.ts`

### Notification producers / consumers
- `src/org/components/OrgTopNavbar.jsx`
- `src/styles/OrgWorkspace.css`
- `src/org/hooks/useOrgCalendar.js`
- `src/org/pages/PipelineBoard.jsx`
- `src/org/styles/Pipeline.css`
- `supabase/functions/_shared/org.ts`
- `supabase/functions/org-task-notify/index.ts`
- `supabase/functions/pipeline-advance/index.ts`
- `supabase/functions/org-calendar-publish/index.ts`

---

## Database Changes

`20260328010000_org_notification_center_stage7.sql` adds the notification-center support columns to `public.user_notifications`:

- `action_url`
- `snoozed_until`
- `dismissed_at`
- `dedupe_key`

It also adds:

- unique dedupe index for reminder/system notifications
- org-scoped lookup indexes for the bell center
- an updated `sync_user_notification_columns()` trigger function
- `public.enqueue_org_notification_reminders(uuid)`

### Reminder sweep behavior

`enqueue_org_notification_reminders(uuid)` inserts deduped in-app reminders for the current authenticated org member when the member is active in the org:

- `org_task_due_soon`
- `org_pipeline_revision_requested`
- `org_post_scheduled_soon`

The frontend invokes this sweep on org workspace load and every 10 minutes while the workspace is open.

---

## Frontend Behavior

### Org bell

The bell in `OrgTopNavbar` now:

- shows unread count
- opens a notification center popover
- reads from org notifications and Common Room unread summaries
- deep-links to the right surface instead of routing blindly to Common Room

### Common Room activity

Common Room unread channels are surfaced as synthetic notification items using unread counts returned by `get_common_room_channel_summaries(...)`.

These are:

- included in unread totals
- open the correct channel on click
- not persisted through `user_notifications`
- not snoozable/dismissible because the source of truth is channel read state

### Invite panel fallback

If `org-invite-member` returns `email_dispatched = false`, the panel now:

- keeps the drawer open
- shows a delivery warning
- exposes copy actions for the invite/setup link

The org-side client invite helper also now injects `app_url` automatically from `window.location.origin`.

---

## Producer Updates

To make the notification center useful, notification producers now attach richer metadata:

- task notifications include calendar deep links
- pipeline revision/approval notifications include pipeline/calendar links
- schedule/publish actions notify affected owners/submitted members
- existing-user org invites include their accept link as `action_url`

---

## Validation

Validated with:

- `npm run build`

Build passed.

---

## Required Apply / Deploy Steps

1. Apply migrations:
   - `supabase db push`

2. Redeploy updated Edge Functions to the active Supabase project:
   - `org-invite-member`
   - `org-task-notify`
   - `pipeline-advance`
   - `org-calendar-publish`

---

## Limitations

1. Reminder generation is currently client-invoked, not server-scheduled.
   - This works for active members in the workspace.
   - It does not replace a real cron-based reminder job for inactive users.

2. Common Room activity uses unread channel summaries, not per-message notification rows.

3. Dismiss/snooze only apply to persisted `user_notifications`, not synthetic Common Room items.

---

## Recommended Next Hardening

If reminders must continue firing even when members are offline, add a scheduled runner that invokes the same reminder logic on an interval. The current Stage 7 SQL function is designed so that a cron or scheduled Edge Function can call it without changing the frontend contract.
