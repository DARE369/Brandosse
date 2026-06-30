-- =============================================================================
-- Migration 001: Audit Triggers
-- Creates Postgres triggers to automatically write to audit_logs when
-- generation or post status changes.
--
-- RUN IN: Supabase SQL Editor
-- SAFE TO RE-RUN: Yes — uses CREATE OR REPLACE FUNCTION + DROP IF EXISTS before CREATE TRIGGER
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TRIGGER 1: Log generation status changes → audit_logs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_generation_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when status actually changes
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.audit_logs (
      actor_id,
      actor_type,
      event_category,
      event_type,
      entity_type,
      entity_id,
      summary,
      risk_level,
      created_at
    ) VALUES (
      NEW.user_id,
      'user',
      'ai_generation',
      CASE
        WHEN NEW.status = 'completed'   THEN 'generation_completed'
        WHEN NEW.status = 'failed'      THEN 'generation_failed'
        WHEN NEW.status = 'processing'  THEN 'generation_started'
        ELSE 'generation_updated'
      END,
      'generation',
      NEW.id::text,
      'Generation ' || NEW.status,
      CASE WHEN NEW.status = 'failed' THEN 'low' ELSE NULL END,
      now()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Safe re-creation: drop the trigger if it already exists, then create fresh
DROP TRIGGER IF EXISTS generations_audit ON public.generations;

CREATE TRIGGER generations_audit
  AFTER UPDATE ON public.generations
  FOR EACH ROW
  EXECUTE FUNCTION public.log_generation_event();


-- ---------------------------------------------------------------------------
-- TRIGGER 2: Log post inserts + status changes → audit_logs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_post_event()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (
      actor_id,
      actor_type,
      event_category,
      event_type,
      entity_type,
      entity_id,
      summary,
      risk_level,
      created_at
    ) VALUES (
      NEW.user_id,
      'user',
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
      event_category,
      event_type,
      entity_type,
      entity_id,
      summary,
      previous_value,
      new_value,
      risk_level,
      created_at
    ) VALUES (
      NEW.user_id,
      'user',
      'scheduling_publishing',
      CASE
        WHEN NEW.status = 'scheduled'   THEN 'post_scheduled'
        WHEN NEW.status = 'published'   THEN 'post_published'
        WHEN NEW.status = 'failed'      THEN 'post_failed'
        ELSE 'post_updated'
      END,
      'post',
      NEW.id::text,
      'Post status changed to ' || NEW.status,
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status),
      CASE WHEN NEW.status = 'failed' THEN 'low' ELSE NULL END,
      now()
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Safe re-creation
DROP TRIGGER IF EXISTS posts_audit ON public.posts;

CREATE TRIGGER posts_audit
  AFTER INSERT OR UPDATE ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.log_post_event();
