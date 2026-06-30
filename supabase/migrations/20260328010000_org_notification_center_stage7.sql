ALTER TABLE public.user_notifications
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS action_url text,
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz,
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_notifications_dedupe_key_stage7
  ON public.user_notifications(dedupe_key);

CREATE INDEX IF NOT EXISTS idx_user_notifications_org_center_stage7
  ON public.user_notifications(user_id, organization_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_notifications_org_active_stage7
  ON public.user_notifications(user_id, organization_id, created_at DESC)
  WHERE dismissed_at IS NULL;

CREATE OR REPLACE FUNCTION public.sync_user_notification_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.type := COALESCE(NEW.type, 'admin_message');
  NEW.title := COALESCE(NULLIF(trim(NEW.title), ''), NULLIF(trim(NEW.subject), ''), 'Notification');
  NEW.subject := COALESCE(NULLIF(trim(NEW.subject), ''), NEW.title);
  NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb);
  NEW.action_url := NULLIF(trim(COALESCE(NEW.action_url, '')), '');
  NEW.dedupe_key := NULLIF(trim(COALESCE(NEW.dedupe_key, '')), '');

  IF NEW.dismissed_at IS NOT NULL THEN
    NEW.is_read := true;
  END IF;

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

CREATE OR REPLACE FUNCTION public.enqueue_org_notification_reminders(
  p_organization_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_inserted integer := 0;
  v_rows integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'notification_user_required';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'notification_org_required';
  END IF;

  IF NOT public.org_current_user_is_active_member(p_organization_id) THEN
    RAISE EXCEPTION 'notification_org_membership_required';
  END IF;

  INSERT INTO public.user_notifications (
    user_id,
    sent_by_admin_id,
    organization_id,
    channel,
    subject,
    body,
    title,
    type,
    metadata,
    is_read,
    action_url,
    dedupe_key
  )
  SELECT
    v_user_id,
    v_user_id,
    p_organization_id,
    'in_app',
    'Task due soon',
    format(
      '%s is due %s.',
      coalesce(nullif(trim(task.title), ''), 'Task'),
      to_char(task.due_at AT TIME ZONE 'UTC', 'Mon DD "at" HH24:MI "UTC"')
    ),
    'Task due soon',
    'system',
    jsonb_build_object(
      'requested_type', 'org_task_due_soon',
      'task_id', task.id,
      'due_at', task.due_at,
      'organization_id', p_organization_id
    ),
    false,
    format('/app/org/%s/calendar?taskId=%s', p_organization_id, task.id),
    format(
      'org_task_due_soon:%s:%s:%s:%s',
      p_organization_id,
      v_user_id,
      task.id,
      to_char(date_trunc('hour', task.due_at), 'YYYYMMDDHH24')
    )
  FROM public.org_tasks task
  JOIN public.org_task_statuses status
    ON status.id = task.status_id
  WHERE task.organization_id = p_organization_id
    AND task.assignee_user_id = v_user_id
    AND status.key <> 'completed'
    AND task.due_at IS NOT NULL
    AND task.due_at > now()
    AND task.due_at <= now() + interval '72 hours'
  ON CONFLICT (dedupe_key) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_inserted := v_inserted + v_rows;

  INSERT INTO public.user_notifications (
    user_id,
    sent_by_admin_id,
    organization_id,
    channel,
    subject,
    body,
    title,
    type,
    metadata,
    is_read,
    action_url,
    dedupe_key
  )
  SELECT
    v_user_id,
    v_user_id,
    p_organization_id,
    'in_app',
    'Revision requested',
    format(
      'A reviewer requested changes on %s.',
      coalesce(nullif(trim(coalesce(item.title, post.caption, generation.prompt, '')), ''), 'your submission')
    ),
    'Revision requested',
    'system',
    jsonb_build_object(
      'requested_type', 'org_pipeline_revision_requested',
      'pipeline_item_id', item.id,
      'post_id', item.post_id,
      'organization_id', p_organization_id
    ),
    false,
    format('/app/org/%s/pipeline', p_organization_id),
    format(
      'org_pipeline_revision_requested:%s:%s:%s:%s',
      p_organization_id,
      v_user_id,
      item.id,
      to_char(date_trunc('hour', coalesce(item.updated_at, item.created_at, now())), 'YYYYMMDDHH24')
    )
  FROM public.pipeline_items item
  LEFT JOIN public.posts post
    ON post.id = item.post_id
  LEFT JOIN public.generations generation
    ON generation.id = item.generation_id
  WHERE item.organization_id = p_organization_id
    AND item.submitted_by = v_user_id
    AND item.status = 'revision_requested'
  ON CONFLICT (dedupe_key) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_inserted := v_inserted + v_rows;

  INSERT INTO public.user_notifications (
    user_id,
    sent_by_admin_id,
    organization_id,
    channel,
    subject,
    body,
    title,
    type,
    metadata,
    is_read,
    action_url,
    dedupe_key
  )
  SELECT
    v_user_id,
    v_user_id,
    p_organization_id,
    'in_app',
    'Scheduled post is coming up',
    format(
      'Your scheduled post is set for %s.',
      to_char(post.scheduled_at AT TIME ZONE 'UTC', 'Mon DD "at" HH24:MI "UTC"')
    ),
    'Scheduled post is coming up',
    'system',
    jsonb_build_object(
      'requested_type', 'org_post_scheduled_soon',
      'post_id', post.id,
      'pipeline_item_id', post.pipeline_item_id,
      'scheduled_at', post.scheduled_at,
      'organization_id', p_organization_id
    ),
    false,
    format('/app/org/%s/calendar', p_organization_id),
    format(
      'org_post_scheduled_soon:%s:%s:%s:%s',
      p_organization_id,
      v_user_id,
      post.id,
      to_char(date_trunc('hour', post.scheduled_at), 'YYYYMMDDHH24')
    )
  FROM public.posts post
  WHERE post.organization_id = p_organization_id
    AND post.user_id = v_user_id
    AND post.status = 'scheduled'
    AND post.scheduled_at IS NOT NULL
    AND post.scheduled_at > now()
    AND post.scheduled_at <= now() + interval '24 hours'
  ON CONFLICT (dedupe_key) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_inserted := v_inserted + v_rows;

  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_org_notification_reminders(uuid) TO authenticated;
