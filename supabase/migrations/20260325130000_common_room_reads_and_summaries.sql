CREATE TABLE IF NOT EXISTS public.common_room_channel_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.common_room_channels(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_message_id uuid REFERENCES public.common_room_messages(id) ON DELETE SET NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT common_room_channel_reads_channel_user_unique UNIQUE (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_common_room_channel_reads_user_org_last_read
  ON public.common_room_channel_reads(user_id, organization_id, last_read_at DESC);

ALTER TABLE public.common_room_channel_reads ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_common_room_channel_summaries(
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

DROP POLICY IF EXISTS org_workspace_editor_insert_common_room_channels ON public.common_room_channels;
DROP POLICY IF EXISTS org_workspace_editor_update_common_room_channels ON public.common_room_channels;
DROP POLICY IF EXISTS org_workspace_permission_insert_common_room_channels ON public.common_room_channels;
DROP POLICY IF EXISTS org_workspace_permission_update_common_room_channels ON public.common_room_channels;

CREATE POLICY org_workspace_permission_insert_common_room_channels
  ON public.common_room_channels
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_create_channels')
  );

CREATE POLICY org_workspace_permission_update_common_room_channels
  ON public.common_room_channels
  FOR UPDATE
  USING (
    public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_create_channels')
  )
  WITH CHECK (
    public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_create_channels')
  );

DROP POLICY IF EXISTS org_workspace_user_read_common_room_channel_reads ON public.common_room_channel_reads;
DROP POLICY IF EXISTS org_workspace_user_insert_common_room_channel_reads ON public.common_room_channel_reads;
DROP POLICY IF EXISTS org_workspace_user_update_common_room_channel_reads ON public.common_room_channel_reads;

CREATE POLICY org_workspace_user_read_common_room_channel_reads
  ON public.common_room_channel_reads
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND public.org_current_user_is_active_member(organization_id)
    AND EXISTS (
      SELECT 1
      FROM public.common_room_channels channel
      WHERE channel.id = channel_id
        AND channel.organization_id = organization_id
        AND public.org_current_user_has_brand_access(channel.organization_id, channel.brand_project_id)
        AND (
          channel.member_ids IS NULL
          OR auth.uid() = ANY(channel.member_ids)
        )
    )
  );

CREATE POLICY org_workspace_user_insert_common_room_channel_reads
  ON public.common_room_channel_reads
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND public.org_current_user_is_active_member(organization_id)
    AND EXISTS (
      SELECT 1
      FROM public.common_room_channels channel
      WHERE channel.id = channel_id
        AND channel.organization_id = organization_id
        AND public.org_current_user_has_brand_access(channel.organization_id, channel.brand_project_id)
        AND (
          channel.member_ids IS NULL
          OR auth.uid() = ANY(channel.member_ids)
        )
    )
  );

CREATE POLICY org_workspace_user_update_common_room_channel_reads
  ON public.common_room_channel_reads
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND public.org_current_user_is_active_member(organization_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND public.org_current_user_is_active_member(organization_id)
    AND EXISTS (
      SELECT 1
      FROM public.common_room_channels channel
      WHERE channel.id = channel_id
        AND channel.organization_id = organization_id
        AND public.org_current_user_has_brand_access(channel.organization_id, channel.brand_project_id)
        AND (
          channel.member_ids IS NULL
          OR auth.uid() = ANY(channel.member_ids)
        )
    )
  );
