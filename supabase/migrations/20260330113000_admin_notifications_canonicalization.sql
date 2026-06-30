ALTER TABLE public.admin_notifications
  ADD COLUMN IF NOT EXISTS recipient_admin_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS notification_type text,
  ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;

UPDATE public.admin_notifications
SET
  recipient_admin_id = COALESCE(recipient_admin_id, admin_id),
  notification_type = COALESCE(notification_type, type, 'system'),
  is_read = COALESCE(is_read, read, false),
  metadata = COALESCE(metadata, '{}'::jsonb)
WHERE
  recipient_admin_id IS DISTINCT FROM COALESCE(recipient_admin_id, admin_id)
  OR notification_type IS DISTINCT FROM COALESCE(notification_type, type, 'system')
  OR is_read IS DISTINCT FROM COALESCE(is_read, read, false)
  OR metadata IS NULL;

ALTER TABLE public.admin_notifications
  ALTER COLUMN notification_type SET DEFAULT 'system',
  ALTER COLUMN notification_type SET NOT NULL,
  ALTER COLUMN is_read SET DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'admin_notifications_notification_type_check_v2'
  ) THEN
    ALTER TABLE public.admin_notifications
      DROP CONSTRAINT admin_notifications_notification_type_check_v2;
  END IF;
END;
$$;

ALTER TABLE public.admin_notifications
  ADD CONSTRAINT admin_notifications_notification_type_check_v3
  CHECK (
    notification_type IN (
      'complaint_assigned',
      'publish_failure',
      'flagged_content',
      'low_quality_generation',
      'password_reset_completed',
      'suspension_expiring',
      'platform_connection_broken',
      'deletion_request_pending',
      'approval_required',
      'risk_alert',
      'complaint_submitted',
      'complaint_stale',
      'moderation_backlog',
      'user_signup_spike',
      'deletion_requested',
      'admin_action_failed',
      'publishing_worker_stalled',
      'scope_drift_detected',
      'content_auto_flagged',
      'org_created',
      'system'
    )
  );

DROP TRIGGER IF EXISTS sync_admin_notification_columns ON public.admin_notifications;
DROP FUNCTION IF EXISTS public.sync_admin_notification_columns();

DROP INDEX IF EXISTS idx_admin_notifications_unread_v2;
DROP INDEX IF EXISTS idx_admin_notifications_broadcast_org_v2;
DROP INDEX IF EXISTS idx_admin_notifications_type_domain_created_v2;

CREATE INDEX IF NOT EXISTS idx_admin_notifications_recipient_unread_v3
  ON public.admin_notifications(recipient_admin_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_broadcast_org_unread_v3
  ON public.admin_notifications(organization_id, is_read, created_at DESC)
  WHERE recipient_admin_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_admin_notifications_type_domain_created_v3
  ON public.admin_notifications(notification_type, domain, created_at DESC);
