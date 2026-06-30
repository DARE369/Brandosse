-- ============================================================================
-- Migration: complaint_workflow_and_audit_functions
-- Date: 2026-03-23
-- Purpose:
--   1) Add an atomic admin complaint workflow RPC with history, notifications, and audit logging
--   2) Enrich generation/post audit triggers with organization scope for downstream risk alerts
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_update_complaint_status(
  p_complaint_id uuid,
  p_status text DEFAULT NULL,
  p_resolution_note text DEFAULT NULL,
  p_assigned_admin_id uuid DEFAULT NULL,
  p_status_note text DEFAULT NULL
)
RETURNS public.complaints
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_previous public.complaints%ROWTYPE;
  v_updated public.complaints%ROWTYPE;
  v_next_status text;
  v_note text;
  v_status_changed boolean := false;
  v_assignment_changed boolean := false;
  v_notification_body text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT public.is_admin_user(v_actor_id) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT *
  INTO v_previous
  FROM public.complaints
  WHERE id = p_complaint_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Complaint not found';
  END IF;

  IF NOT (
    public.can_admin_access_organization(v_actor_id, v_previous.organization_id)
    OR public.can_admin_access_user(v_actor_id, v_previous.submitted_by_user_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  v_next_status := public.normalize_complaint_status(COALESCE(p_status, v_previous.status));
  v_note := NULLIF(trim(COALESCE(p_resolution_note, '')), '');
  v_status_changed := v_next_status IS DISTINCT FROM v_previous.status;
  v_assignment_changed := p_assigned_admin_id IS NOT NULL AND p_assigned_admin_id IS DISTINCT FROM v_previous.assigned_admin_id;

  IF v_next_status = 'resolved' AND v_note IS NULL AND NULLIF(trim(COALESCE(v_previous.resolution_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Resolution note is required when resolving a complaint';
  END IF;

  UPDATE public.complaints
  SET
    status = v_next_status,
    assigned_admin_id = CASE
      WHEN p_assigned_admin_id IS NULL THEN assigned_admin_id
      ELSE p_assigned_admin_id
    END,
    resolution_note = CASE
      WHEN v_next_status = 'resolved' THEN COALESCE(v_note, resolution_note)
      WHEN v_note IS NOT NULL THEN v_note
      ELSE resolution_note
    END,
    resolved_by_admin_id = CASE
      WHEN v_next_status = 'resolved' THEN v_actor_id
      ELSE resolved_by_admin_id
    END,
    resolved_at = CASE
      WHEN v_next_status = 'resolved' THEN COALESCE(resolved_at, now())
      ELSE resolved_at
    END
  WHERE id = p_complaint_id
  RETURNING *
  INTO v_updated;

  IF v_status_changed THEN
    INSERT INTO public.complaint_status_history (
      complaint_id,
      from_status,
      to_status,
      changed_by_admin_id,
      note
    )
    VALUES (
      v_updated.id,
      v_previous.status,
      v_updated.status,
      v_actor_id,
      COALESCE(
        NULLIF(trim(COALESCE(p_status_note, '')), ''),
        CASE WHEN v_updated.status = 'resolved' THEN v_updated.resolution_note ELSE NULL END
      )
    );
  END IF;

  IF v_updated.status = 'resolved' THEN
    v_notification_body := COALESCE(
      LEFT(NULLIF(trim(COALESCE(v_updated.resolution_note, '')), ''), 200),
      'Your support ticket has been resolved.'
    );

    INSERT INTO public.user_notifications (
      user_id,
      sent_by_admin_id,
      channel,
      type,
      title,
      subject,
      body,
      metadata,
      is_read
    )
    VALUES (
      v_updated.submitted_by_user_id,
      v_actor_id,
      'in_app',
      'complaint_resolved',
      'Your support ticket has been resolved',
      'Your support ticket has been resolved',
      v_notification_body,
      jsonb_build_object(
        'complaint_id', v_updated.id,
        'status', v_updated.status
      ),
      false
    );
  END IF;

  INSERT INTO public.admin_notifications (
    admin_id,
    type,
    severity,
    title,
    body,
    metadata,
    organization_id,
    read
  )
  VALUES (
    NULL,
    'system',
    'low',
    CASE
      WHEN v_status_changed THEN 'Complaint status updated'
      WHEN v_assignment_changed THEN 'Complaint assignment updated'
      ELSE 'Complaint updated'
    END,
    COALESCE(v_updated.title, v_updated.subject),
    jsonb_build_object(
      'complaint_id', v_updated.id,
      'status', v_updated.status,
      'assigned_admin_id', v_updated.assigned_admin_id
    ),
    v_updated.organization_id,
    false
  );

  PERFORM public.write_audit_log(
    p_actor_id := v_actor_id,
    p_actor_type := 'admin',
    p_actor_role := public.get_admin_role(v_actor_id),
    p_organization_id := v_updated.organization_id,
    p_event_category := 'admin_action',
    p_event_type := CASE
      WHEN v_status_changed THEN 'complaint_status_updated'
      WHEN v_assignment_changed THEN 'complaint_assignment_updated'
      ELSE 'complaint_updated'
    END,
    p_entity_type := 'complaint',
    p_entity_id := v_updated.id::text,
    p_summary := CASE
      WHEN v_status_changed THEN 'Updated complaint status to ' || v_updated.status
      WHEN v_assignment_changed THEN 'Updated complaint assignment'
      ELSE 'Updated complaint'
    END,
    p_previous_value := jsonb_build_object(
      'status', v_previous.status,
      'assigned_admin_id', v_previous.assigned_admin_id,
      'resolution_note', v_previous.resolution_note
    ),
    p_new_value := jsonb_build_object(
      'status', v_updated.status,
      'assigned_admin_id', v_updated.assigned_admin_id,
      'resolution_note', v_updated.resolution_note
    ),
    p_metadata := jsonb_build_object(
      'complaint_id', v_updated.id,
      'submitted_by_user_id', v_updated.submitted_by_user_id,
      'linked_post_id', v_updated.linked_post_id,
      'linked_generation_id', v_updated.linked_generation_id
    ),
    p_risk_level := 'low'
  );

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_complaint_status(uuid, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_complaint_status(uuid, text, text, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.log_generation_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_organization_id uuid;
BEGIN
  SELECT p.organization_id
  INTO v_organization_id
  FROM public.profiles p
  WHERE p.id = NEW.user_id
  LIMIT 1;

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
      v_organization_id,
      'ai_generation',
      CASE
        WHEN NEW.status = 'completed' THEN 'generation_completed'
        WHEN NEW.status = 'failed' THEN 'generation_failed'
        WHEN NEW.status = 'processing' THEN 'generation_started'
        ELSE 'generation_updated'
      END,
      'generation',
      NEW.id::text,
      'Generation ' || COALESCE(NEW.status, 'updated'),
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
DECLARE
  v_organization_id uuid;
BEGIN
  SELECT p.organization_id
  INTO v_organization_id
  FROM public.profiles p
  WHERE p.id = NEW.user_id
  LIMIT 1;

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
      v_organization_id,
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
      v_organization_id,
      'scheduling_publishing',
      CASE
        WHEN NEW.status = 'scheduled' THEN 'post_scheduled'
        WHEN NEW.status = 'published' THEN 'post_published'
        WHEN NEW.status = 'failed' THEN 'post_failed'
        ELSE 'post_updated'
      END,
      'post',
      NEW.id::text,
      'Post status changed to ' || COALESCE(NEW.status, 'updated'),
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status),
      CASE WHEN NEW.status = 'failed' THEN 'low' ELSE NULL END,
      now()
    );
  END IF;

  RETURN NEW;
END;
$$;
