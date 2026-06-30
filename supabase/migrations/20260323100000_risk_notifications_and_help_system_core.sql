-- ============================================================================
-- Migration: risk_notifications_and_help_system_core
-- Date: 2026-03-23
-- Purpose:
--   1) Add compatibility-first v2 columns for admin_notifications and user_notifications
--   2) Align complaints with the help-center ticket model without breaking legacy columns
--   3) Add complaint status history, risk event counts, screenshot storage, and helper RPCs
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -- Complaint helpers --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.map_complaint_type_to_category(p_type text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE lower(coalesce(p_type, 'other'))
    WHEN 'content_quality' THEN RETURN 'generation';
    WHEN 'brand_mismatch' THEN RETURN 'generation';
    WHEN 'publishing_issue' THEN RETURN 'publishing';
    WHEN 'account_issue' THEN RETURN 'account';
    WHEN 'credits_issue' THEN RETURN 'billing';
    WHEN 'connection_issue' THEN RETURN 'platform_connection';
    ELSE RETURN 'other';
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.map_complaint_category_to_type(p_category text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE lower(coalesce(p_category, 'other'))
    WHEN 'generation' THEN RETURN 'content_quality';
    WHEN 'publishing' THEN RETURN 'publishing_issue';
    WHEN 'scheduling' THEN RETURN 'publishing_issue';
    WHEN 'account' THEN RETURN 'account_issue';
    WHEN 'billing' THEN RETURN 'credits_issue';
    WHEN 'platform_connection' THEN RETURN 'connection_issue';
    ELSE RETURN 'other';
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_complaint_status(p_status text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE lower(coalesce(p_status, 'submitted'))
    WHEN 'submitted' THEN RETURN 'submitted';
    WHEN 'new' THEN RETURN 'submitted';
    WHEN 'under_review' THEN RETURN 'under_review';
    WHEN 'triaged' THEN RETURN 'under_review';
    WHEN 'in_progress' THEN RETURN 'under_review';
    WHEN 'waiting_on_user' THEN RETURN 'under_review';
    WHEN 'escalated' THEN RETURN 'under_review';
    WHEN 'resolved' THEN RETURN 'resolved';
    WHEN 'closed' THEN RETURN 'closed';
    ELSE RETURN 'submitted';
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_risk_level(failure_count integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF failure_count >= 12 THEN
    RETURN 'very_high';
  ELSIF failure_count >= 10 THEN
    RETURN 'high';
  ELSIF failure_count >= 6 THEN
    RETURN 'medium';
  ELSIF failure_count >= 3 THEN
    RETURN 'low';
  ELSE
    RETURN 'none';
  END IF;
END;
$$;

-- -- admin_notifications ------------------------------------------------------
ALTER TABLE public.admin_notifications
  ALTER COLUMN recipient_admin_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS admin_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'low'
    CHECK (severity IN ('low', 'medium', 'high', 'very_high')),
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS read boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.admin_notifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%notification_type%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.admin_notifications DROP CONSTRAINT IF EXISTS %I',
      constraint_name
    );
  END LOOP;
END;
$$;

ALTER TABLE public.admin_notifications
  ADD CONSTRAINT admin_notifications_notification_type_check_v2
  CHECK (
    coalesce(notification_type, type, 'system') IN (
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

UPDATE public.admin_notifications
SET
  admin_id = COALESCE(admin_id, recipient_admin_id),
  type = COALESCE(type, notification_type, 'system'),
  severity = COALESCE(
    NULLIF(severity, ''),
    CASE
      WHEN COALESCE(notification_type, type) IN ('publish_failure', 'platform_connection_broken', 'approval_required') THEN 'high'
      WHEN COALESCE(notification_type, type) IN ('complaint_assigned', 'flagged_content', 'deletion_request_pending', 'suspension_expiring') THEN 'medium'
      ELSE 'low'
    END
  ),
  metadata = COALESCE(metadata, '{}'::jsonb),
  read = COALESCE(read, is_read, false)
WHERE
  admin_id IS NULL
  OR type IS NULL
  OR metadata IS NULL
  OR read IS DISTINCT FROM COALESCE(is_read, false);

CREATE OR REPLACE FUNCTION public.sync_admin_notification_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.admin_id := COALESCE(NEW.admin_id, NEW.recipient_admin_id);
  NEW.recipient_admin_id := COALESCE(NEW.recipient_admin_id, NEW.admin_id);

  NEW.type := COALESCE(NEW.type, NEW.notification_type, 'system');
  NEW.notification_type := COALESCE(NEW.notification_type, NEW.type, 'system');

  NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb);

  NEW.read := COALESCE(NEW.read, NEW.is_read, false);
  NEW.is_read := COALESCE(NEW.is_read, NEW.read, false);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_admin_notification_columns ON public.admin_notifications;
CREATE TRIGGER sync_admin_notification_columns
  BEFORE INSERT OR UPDATE ON public.admin_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_admin_notification_columns();

CREATE INDEX IF NOT EXISTS idx_admin_notifications_unread_v2
  ON public.admin_notifications(admin_id, read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_broadcast_org_v2
  ON public.admin_notifications(organization_id, read, created_at DESC)
  WHERE admin_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_admin_notifications_type_domain_created_v2
  ON public.admin_notifications(type, domain, created_at DESC);

-- -- user_notifications -------------------------------------------------------
ALTER TABLE public.user_notifications
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'admin_message'
    CHECK (type IN ('admin_message', 'complaint_resolved', 'system')),
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

UPDATE public.user_notifications
SET
  title = COALESCE(title, subject),
  metadata = COALESCE(metadata, '{}'::jsonb),
  read_at = CASE
    WHEN is_read AND read_at IS NULL THEN created_at
    ELSE read_at
  END
WHERE
  title IS NULL
  OR metadata IS NULL
  OR (is_read AND read_at IS NULL);

CREATE OR REPLACE FUNCTION public.sync_user_notification_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.type := COALESCE(NEW.type, 'admin_message');
  NEW.title := COALESCE(NULLIF(trim(NEW.title), ''), NULLIF(trim(NEW.subject), ''), 'Notification');
  NEW.subject := COALESCE(NULLIF(trim(NEW.subject), ''), NEW.title);
  NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb);

  IF COALESCE(NEW.is_read, false) AND NEW.read_at IS NULL THEN
    NEW.read_at := now();
  ELSIF COALESCE(NEW.is_read, false) = false THEN
    NEW.read_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_user_notification_columns ON public.user_notifications;
CREATE TRIGGER sync_user_notification_columns
  BEFORE INSERT OR UPDATE ON public.user_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_notification_columns();

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_type_created_v2
  ON public.user_notifications(user_id, type, created_at DESC);

-- -- complaints ----------------------------------------------------------------
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS resolved_by_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS screenshot_url text,
  ADD COLUMN IF NOT EXISTS user_notified_at timestamptz;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.complaints'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
      AND pg_get_constraintdef(oid) ILIKE '%new%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.complaints DROP CONSTRAINT IF EXISTS %I',
      constraint_name
    );
  END LOOP;
END;
$$;

UPDATE public.complaints
SET
  status = public.normalize_complaint_status(status),
  category = COALESCE(category, public.map_complaint_type_to_category(complaint_type), 'other'),
  title = COALESCE(NULLIF(title, ''), subject),
  resolved_by_admin_id = COALESCE(resolved_by_admin_id, assigned_admin_id)
WHERE
  status <> public.normalize_complaint_status(status)
  OR category IS NULL
  OR title IS NULL
  OR resolved_by_admin_id IS NULL;

ALTER TABLE public.complaints
  ALTER COLUMN status SET DEFAULT 'submitted';

ALTER TABLE public.complaints
  ADD CONSTRAINT complaints_status_check_v2
  CHECK (status IN ('submitted', 'under_review', 'resolved', 'closed'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.complaints'::regclass
      AND conname = 'complaints_category_check_v2'
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_category_check_v2
      CHECK (
        category IN (
          'generation',
          'publishing',
          'scheduling',
          'account',
          'billing',
          'platform_connection',
          'other'
        )
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_complaint_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.status := public.normalize_complaint_status(NEW.status);
  NEW.category := COALESCE(NEW.category, public.map_complaint_type_to_category(NEW.complaint_type), 'other');
  NEW.complaint_type := COALESCE(NEW.complaint_type, public.map_complaint_category_to_type(NEW.category), 'other');
  NEW.title := COALESCE(NULLIF(trim(NEW.title), ''), NULLIF(trim(NEW.subject), ''), 'Untitled support ticket');
  NEW.subject := COALESCE(NULLIF(trim(NEW.subject), ''), NEW.title);

  IF NEW.status = 'resolved' AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at := now();
  END IF;

  IF NEW.status <> 'resolved' AND TG_OP = 'UPDATE' AND OLD.status = 'resolved' THEN
    NEW.resolved_at := COALESCE(NEW.resolved_at, OLD.resolved_at);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_complaint_columns ON public.complaints;
CREATE TRIGGER sync_complaint_columns
  BEFORE INSERT OR UPDATE ON public.complaints
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_complaint_columns();

CREATE INDEX IF NOT EXISTS idx_complaints_submitted_by_status
  ON public.complaints(submitted_by_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_complaints_org_status_created_v2
  ON public.complaints(organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_complaints_status_assigned_created_v2
  ON public.complaints(status, assigned_admin_id, created_at DESC);

-- -- complaint_status_history -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.complaint_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_by_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_complaint_status_history_complaint
  ON public.complaint_status_history(complaint_id, created_at DESC);

-- -- risk_event_counts --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.risk_event_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  domain text NOT NULL,
  window_start timestamptz NOT NULL,
  failure_count integer NOT NULL DEFAULT 0,
  risk_level text NOT NULL DEFAULT 'none'
    CHECK (risk_level IN ('none', 'low', 'medium', 'high', 'very_high')),
  notification_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_event_counts_domain_window
  ON public.risk_event_counts(domain, window_start DESC);

CREATE INDEX IF NOT EXISTS idx_risk_event_counts_org_domain_window
  ON public.risk_event_counts(organization_id, domain, window_start DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'set_updated_at'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS set_risk_event_counts_updated_at ON public.risk_event_counts';
    EXECUTE '
      CREATE TRIGGER set_risk_event_counts_updated_at
      BEFORE UPDATE ON public.risk_event_counts
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at()
    ';
  END IF;
END;
$$;

-- -- User helper RPC ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_user_complaints_viewed(p_complaint_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer := 0;
BEGIN
  UPDATE public.complaints
  SET user_notified_at = now()
  WHERE submitted_by_user_id = auth.uid()
    AND status IN ('resolved', 'closed')
    AND user_notified_at IS NULL
    AND (
      p_complaint_ids IS NULL
      OR array_length(p_complaint_ids, 1) IS NULL
      OR id = ANY(p_complaint_ids)
    );

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_user_complaints_viewed(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_user_complaints_viewed(uuid[]) TO authenticated;

-- -- Storage: complaint screenshots ------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'complaint-screenshots',
  'complaint-screenshots',
  false,
  5242880,
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "complaint_screenshots_select_scoped" ON storage.objects;
CREATE POLICY "complaint_screenshots_select_scoped"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'complaint-screenshots'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_admin_user(auth.uid())
  )
);

DROP POLICY IF EXISTS "complaint_screenshots_insert_own" ON storage.objects;
CREATE POLICY "complaint_screenshots_insert_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'complaint-screenshots'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "complaint_screenshots_update_scoped" ON storage.objects;
CREATE POLICY "complaint_screenshots_update_scoped"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'complaint-screenshots'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_admin_user(auth.uid())
  )
)
WITH CHECK (
  bucket_id = 'complaint-screenshots'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_admin_user(auth.uid())
  )
);

DROP POLICY IF EXISTS "complaint_screenshots_delete_scoped" ON storage.objects;
CREATE POLICY "complaint_screenshots_delete_scoped"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'complaint-screenshots'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_admin_user(auth.uid())
  )
);
