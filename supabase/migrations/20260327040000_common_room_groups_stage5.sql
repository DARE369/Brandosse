ALTER TABLE public.common_room_channels
  ADD COLUMN IF NOT EXISTS group_admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS max_members integer,
  ADD COLUMN IF NOT EXISTS is_ai_enabled boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'common_room_channels'
      AND constraint_name = 'common_room_channels_channel_type_check'
  ) THEN
    ALTER TABLE public.common_room_channels
      DROP CONSTRAINT common_room_channels_channel_type_check;
  END IF;
END
$$;

ALTER TABLE public.common_room_channels
  ADD CONSTRAINT common_room_channels_channel_type_check
  CHECK (channel_type IN ('group', 'project', 'private', 'ai_session', 'private_group'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'common_room_channels_max_members_check'
      AND conrelid = 'public.common_room_channels'::regclass
  ) THEN
    ALTER TABLE public.common_room_channels
      ADD CONSTRAINT common_room_channels_max_members_check
      CHECK (max_members IS NULL OR max_members >= 2);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_common_room_channels_group_admin
  ON public.common_room_channels(group_admin_user_id)
  WHERE group_admin_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_common_room_channels_type
  ON public.common_room_channels(organization_id, channel_type, is_archived);

CREATE OR REPLACE FUNCTION public.prepare_common_room_channel_stage5()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_member_id uuid;
  v_member_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  NEW.name := trim(coalesce(NEW.name, ''));
  IF NEW.name = '' THEN
    RAISE EXCEPTION 'common_room_channel_name_required';
  END IF;

  NEW.description := nullif(trim(coalesce(NEW.description, '')), '');
  NEW.channel_type := coalesce(nullif(trim(coalesce(NEW.channel_type, '')), ''), 'group');

  IF NEW.channel_type = 'private_group' THEN
    NEW.group_admin_user_id := coalesce(NEW.group_admin_user_id, NEW.created_by);

    IF NEW.group_admin_user_id IS NULL THEN
      RAISE EXCEPTION 'private_group_admin_required';
    END IF;

    FOR v_member_id IN
      SELECT DISTINCT member_id
      FROM unnest(coalesce(NEW.member_ids, ARRAY[]::uuid[]) || ARRAY[NEW.group_admin_user_id]) AS member_id
      WHERE member_id IS NOT NULL
    LOOP
      v_member_ids := array_append(v_member_ids, v_member_id);
    END LOOP;

    NEW.member_ids := CASE
      WHEN coalesce(array_length(v_member_ids, 1), 0) = 0 THEN ARRAY[NEW.group_admin_user_id]
      ELSE v_member_ids
    END;

    IF NEW.max_members IS NOT NULL AND coalesce(array_length(NEW.member_ids, 1), 0) > NEW.max_members THEN
      RAISE EXCEPTION 'private_group_member_limit_exceeded';
    END IF;
  ELSIF NEW.channel_type IN ('group', 'project', 'ai_session') THEN
    NEW.member_ids := NULL;
    NEW.group_admin_user_id := NULL;
    NEW.max_members := NULL;
  ELSE
    NEW.member_ids := ARRAY(
      SELECT DISTINCT member_id
      FROM unnest(coalesce(NEW.member_ids, ARRAY[]::uuid[])) AS member_id
      WHERE member_id IS NOT NULL
    );
  END IF;

  IF NEW.is_ai_enabled IS NULL THEN
    NEW.is_ai_enabled := true;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'prepare_common_room_channel_stage5'
  ) THEN
    CREATE TRIGGER prepare_common_room_channel_stage5
      BEFORE INSERT OR UPDATE ON public.common_room_channels
      FOR EACH ROW
      EXECUTE FUNCTION public.prepare_common_room_channel_stage5();
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.common_room_leave_channel(p_channel_id uuid)
RETURNS public.common_room_channels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel public.common_room_channels;
  v_next_member_ids uuid[];
  v_next_group_admin_user_id uuid := NULL;
BEGIN
  SELECT *
  INTO v_channel
  FROM public.common_room_channels
  WHERE id = p_channel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'common_room_channel_not_found';
  END IF;

  IF NOT public.org_current_user_is_active_member(v_channel.organization_id) THEN
    RAISE EXCEPTION 'common_room_not_active_member';
  END IF;

  IF v_channel.channel_type <> 'private_group' THEN
    RAISE EXCEPTION 'common_room_leave_only_private_group';
  END IF;

  IF v_channel.member_ids IS NULL OR NOT auth.uid() = ANY(v_channel.member_ids) THEN
    RAISE EXCEPTION 'common_room_leave_forbidden';
  END IF;

  SELECT ARRAY(
    SELECT member_id
    FROM unnest(coalesce(v_channel.member_ids, ARRAY[]::uuid[])) AS member_id
    WHERE member_id IS NOT NULL
      AND member_id <> auth.uid()
  )
  INTO v_next_member_ids;

  IF coalesce(v_channel.group_admin_user_id, v_channel.created_by) = auth.uid()
    AND coalesce(array_length(v_next_member_ids, 1), 0) > 0
    AND NOT public.get_member_permission(v_channel.organization_id, 'can_create_channels')
  THEN
    RAISE EXCEPTION 'transfer_group_admin_before_leaving';
  END IF;

  IF coalesce(array_length(v_next_member_ids, 1), 0) > 0 THEN
    v_next_group_admin_user_id := CASE
      WHEN coalesce(v_channel.group_admin_user_id, v_channel.created_by) = auth.uid()
        THEN v_next_member_ids[1]
      ELSE coalesce(v_channel.group_admin_user_id, v_channel.created_by)
    END;
  END IF;

  UPDATE public.common_room_channels
  SET
    member_ids = CASE
      WHEN coalesce(array_length(v_next_member_ids, 1), 0) = 0 THEN ARRAY[]::uuid[]
      ELSE v_next_member_ids
    END,
    group_admin_user_id = v_next_group_admin_user_id,
    is_archived = CASE
      WHEN coalesce(array_length(v_next_member_ids, 1), 0) = 0 THEN true
      ELSE v_channel.is_archived
    END,
    updated_at = now()
  WHERE id = v_channel.id
  RETURNING *
  INTO v_channel;

  RETURN v_channel;
END;
$$;

GRANT EXECUTE ON FUNCTION public.common_room_leave_channel(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.get_common_room_channel_summaries(uuid, uuid);

CREATE FUNCTION public.get_common_room_channel_summaries(
  p_organization_id uuid,
  p_brand_project_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  brand_project_id uuid,
  name text,
  description text,
  channel_type text,
  is_default boolean,
  member_ids uuid[],
  created_by uuid,
  group_admin_user_id uuid,
  max_members integer,
  is_ai_enabled boolean,
  is_archived boolean,
  created_at timestamptz,
  updated_at timestamptz,
  unread_count bigint,
  last_message_at timestamptz,
  last_message_preview text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH accessible_channels AS (
    SELECT channel.*
    FROM public.common_room_channels channel
    WHERE channel.organization_id = p_organization_id
      AND channel.is_archived = false
      AND public.org_current_user_is_active_member(channel.organization_id)
      AND public.org_current_user_has_brand_access(channel.organization_id, channel.brand_project_id)
      AND (
        p_brand_project_id IS NULL
        OR channel.brand_project_id IS NULL
        OR channel.brand_project_id = p_brand_project_id
      )
      AND (
        channel.member_ids IS NULL
        OR auth.uid() = ANY(channel.member_ids)
      )
  ),
  read_state AS (
    SELECT read_row.channel_id, read_row.last_read_at
    FROM public.common_room_channel_reads read_row
    WHERE read_row.organization_id = p_organization_id
      AND read_row.user_id = auth.uid()
  ),
  latest_messages AS (
    SELECT DISTINCT ON (message.channel_id)
      message.channel_id,
      message.created_at,
      CASE
        WHEN message.content_type = 'asset_reference' THEN '[Asset] ' || coalesce(nullif(message.content, ''), 'Shared asset')
        WHEN message.content_type = 'pipeline_reference' THEN '[Pipeline] ' || coalesce(nullif(message.content, ''), 'Pipeline item')
        WHEN message.content_type = 'ai_response' THEN '[AI] ' || left(coalesce(message.content, ''), 140)
        ELSE left(coalesce(message.content, ''), 140)
      END AS preview
    FROM public.common_room_messages message
    JOIN accessible_channels channel
      ON channel.id = message.channel_id
    WHERE message.is_deleted = false
    ORDER BY message.channel_id, message.created_at DESC
  )
  SELECT
    channel.id,
    channel.organization_id,
    channel.brand_project_id,
    channel.name,
    channel.description,
    channel.channel_type,
    channel.is_default,
    channel.member_ids,
    channel.created_by,
    channel.group_admin_user_id,
    channel.max_members,
    channel.is_ai_enabled,
    channel.is_archived,
    channel.created_at,
    channel.updated_at,
    coalesce((
      SELECT count(*)
      FROM public.common_room_messages message
      WHERE message.channel_id = channel.id
        AND message.is_deleted = false
        AND message.sender_id IS DISTINCT FROM auth.uid()
        AND message.created_at > coalesce(read_state.last_read_at, to_timestamp(0))
    ), 0)::bigint AS unread_count,
    latest_messages.created_at AS last_message_at,
    latest_messages.preview AS last_message_preview
  FROM accessible_channels channel
  LEFT JOIN read_state
    ON read_state.channel_id = channel.id
  LEFT JOIN latest_messages
    ON latest_messages.channel_id = channel.id
  ORDER BY
    channel.is_default DESC,
    coalesce(latest_messages.created_at, channel.created_at) DESC,
    channel.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_common_room_channel_summaries(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS org_workspace_permission_update_common_room_channels ON public.common_room_channels;
CREATE POLICY org_workspace_permission_update_common_room_channels
  ON public.common_room_channels
  FOR UPDATE
  USING (
    public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND (
      public.get_member_permission(organization_id, 'can_create_channels')
      OR group_admin_user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND (
      public.get_member_permission(organization_id, 'can_create_channels')
      OR (
        channel_type = 'private_group'
        AND auth.uid() = ANY(coalesce(member_ids, ARRAY[]::uuid[]))
      )
    )
  );
