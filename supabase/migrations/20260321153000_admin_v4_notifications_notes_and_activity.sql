-- ============================================================================
-- Migration: admin_v4_notifications_notes_and_activity
-- Date: 2026-03-21
-- Purpose:
--   1) Add user notifications and admin notes tables for v4 admin actions
--   2) Add automatic audit logging triggers for generations and posts
--   3) Add indexes used by activity logs, user notifications, and note panels
-- Notes:
--   - Idempotent and non-destructive
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sent_by_admin_id uuid NOT NULL REFERENCES auth.users(id),
  channel text NOT NULL CHECK (channel IN ('in_app', 'email', 'both')),
  subject text NOT NULL,
  body text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_admin_id uuid NOT NULL REFERENCES auth.users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own notifications" ON public.user_notifications;
CREATE POLICY "Users read own notifications"
  ON public.user_notifications FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own notifications" ON public.user_notifications;
CREATE POLICY "Users update own notifications"
  ON public.user_notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Scoped admins create notifications" ON public.user_notifications;
CREATE POLICY "Scoped admins create notifications"
  ON public.user_notifications FOR INSERT
  WITH CHECK (
    public.is_admin_user(auth.uid())
    AND public.can_admin_access_user(auth.uid(), user_id)
    AND sent_by_admin_id = auth.uid()
  );

DROP POLICY IF EXISTS "Scoped admins read notes" ON public.admin_notes;
CREATE POLICY "Scoped admins read notes"
  ON public.admin_notes FOR SELECT
  USING (
    public.is_admin_user(auth.uid())
    AND public.can_admin_access_user(auth.uid(), target_user_id)
  );

DROP POLICY IF EXISTS "Scoped admins manage notes" ON public.admin_notes;
CREATE POLICY "Scoped admins manage notes"
  ON public.admin_notes FOR ALL
  USING (
    public.is_admin_user(auth.uid())
    AND public.can_admin_access_user(auth.uid(), target_user_id)
  )
  WITH CHECK (
    public.is_admin_user(auth.uid())
    AND public.can_admin_access_user(auth.uid(), target_user_id)
    AND author_admin_id = auth.uid()
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'set_updated_at'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS set_admin_notes_updated_at ON public.admin_notes';
    EXECUTE '
      CREATE TRIGGER set_admin_notes_updated_at
      BEFORE UPDATE ON public.admin_notes
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at()
    ';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_read_created
  ON public.user_notifications(user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_notifications_sender_created
  ON public.user_notifications(sent_by_admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_notes_target_created
  ON public.admin_notes(target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_notes_author_created
  ON public.admin_notes(author_admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created
  ON public.audit_logs(actor_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.log_generation_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.audit_logs (
      actor_id,
      actor_type,
      actor_role,
      organization_id,
      event_category,
      event_type,
      entity_type,
      entity_id,
      summary,
      previous_value,
      new_value,
      metadata,
      risk_level,
      created_at
    )
    VALUES (
      NEW.user_id,
      'user',
      NULL,
      NULL,
      'ai_generation',
      CASE
        WHEN NEW.status = 'completed' THEN 'generation_completed'
        WHEN NEW.status = 'failed' THEN 'generation_failed'
        WHEN NEW.status = 'processing' THEN 'generation_started'
        ELSE 'generation_updated'
      END,
      'generation',
      NEW.id::text,
      'Generation ' || coalesce(NEW.status, 'updated'),
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status),
      NULL,
      CASE WHEN NEW.status = 'failed' THEN 'low' ELSE NULL END,
      now()
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_post_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (
      actor_id,
      actor_type,
      actor_role,
      organization_id,
      event_category,
      event_type,
      entity_type,
      entity_id,
      summary,
      risk_level,
      created_at
    )
    VALUES (
      NEW.user_id,
      'user',
      NULL,
      NULL,
      'content_pipeline',
      'post_draft_created',
      'post',
      NEW.id::text,
      'Draft post created',
      NULL,
      now()
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.audit_logs (
      actor_id,
      actor_type,
      actor_role,
      organization_id,
      event_category,
      event_type,
      entity_type,
      entity_id,
      summary,
      previous_value,
      new_value,
      risk_level,
      created_at
    )
    VALUES (
      NEW.user_id,
      'user',
      NULL,
      NULL,
      'scheduling_publishing',
      CASE
        WHEN NEW.status = 'scheduled' THEN 'post_scheduled'
        WHEN NEW.status = 'published' THEN 'post_published'
        WHEN NEW.status = 'failed' THEN 'post_failed'
        ELSE 'post_updated'
      END,
      'post',
      NEW.id::text,
      'Post status changed to ' || coalesce(NEW.status, 'updated'),
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status),
      CASE WHEN NEW.status = 'failed' THEN 'low' ELSE NULL END,
      now()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS generations_audit ON public.generations;
CREATE TRIGGER generations_audit
  AFTER UPDATE ON public.generations
  FOR EACH ROW
  EXECUTE FUNCTION public.log_generation_event();

DROP TRIGGER IF EXISTS posts_audit ON public.posts;
CREATE TRIGGER posts_audit
  AFTER INSERT OR UPDATE ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.log_post_event();
