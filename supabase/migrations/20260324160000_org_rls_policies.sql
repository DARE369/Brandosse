CREATE OR REPLACE FUNCTION public.org_current_user_is_active_member(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = p_organization_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.org_current_user_role(p_organization_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    nullif(om.org_role_key, ''),
    CASE WHEN om.role = 'org_admin' THEN 'org_admin' ELSE 'contributor' END
  )
  FROM public.organization_members om
  WHERE om.organization_id = p_organization_id
    AND om.user_id = auth.uid()
    AND om.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.org_current_user_has_brand_access(
  p_organization_id uuid,
  p_brand_project_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = p_organization_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND (
        p_brand_project_id IS NULL
        OR om.brand_project_ids IS NULL
        OR p_brand_project_id = ANY(om.brand_project_ids)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.org_users_share_active_organization(p_target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members current_member
    JOIN public.organization_members target_member
      ON target_member.organization_id = current_member.organization_id
    WHERE current_member.user_id = auth.uid()
      AND current_member.status = 'active'
      AND target_member.user_id = p_target_user_id
      AND target_member.status = 'active'
  );
$$;

ALTER TABLE public.organization_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_role_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_last_used ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.common_room_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.common_room_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_session_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_asset_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_plans_authenticated_read'
      AND tablename = 'organization_plans'
  ) THEN
    CREATE POLICY org_workspace_plans_authenticated_read
      ON public.organization_plans
      FOR SELECT
      USING (auth.uid() IS NOT NULL);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_member_read_organizations'
      AND tablename = 'organizations'
  ) THEN
    CREATE POLICY org_workspace_member_read_organizations
      ON public.organizations
      FOR SELECT
      USING (public.org_current_user_is_active_member(id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_admin_update_organizations'
      AND tablename = 'organizations'
  ) THEN
    CREATE POLICY org_workspace_admin_update_organizations
      ON public.organizations
      FOR UPDATE
      USING (
        public.org_current_user_role(id) IN ('org_owner', 'org_admin')
      )
      WITH CHECK (
        public.org_current_user_role(id) IN ('org_owner', 'org_admin')
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_member_read_organization_members'
      AND tablename = 'organization_members'
  ) THEN
    CREATE POLICY org_workspace_member_read_organization_members
      ON public.organization_members
      FOR SELECT
      USING (public.org_current_user_is_active_member(organization_id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_admin_manage_organization_members'
      AND tablename = 'organization_members'
  ) THEN
    CREATE POLICY org_workspace_admin_manage_organization_members
      ON public.organization_members
      FOR ALL
      USING (
        public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
      )
      WITH CHECK (
        public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_member_read_profiles'
      AND tablename = 'profiles'
  ) THEN
    CREATE POLICY org_workspace_member_read_profiles
      ON public.profiles
      FOR SELECT
      USING (public.org_users_share_active_organization(id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_member_read_brand_projects'
      AND tablename = 'brand_projects'
  ) THEN
    CREATE POLICY org_workspace_member_read_brand_projects
      ON public.brand_projects
      FOR SELECT
      USING (public.org_current_user_has_brand_access(organization_id, id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_admin_write_brand_projects'
      AND tablename = 'brand_projects'
  ) THEN
    CREATE POLICY org_workspace_admin_write_brand_projects
      ON public.brand_projects
      FOR ALL
      USING (
        public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
      )
      WITH CHECK (
        public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_member_read_role_templates'
      AND tablename = 'org_role_templates'
  ) THEN
    CREATE POLICY org_workspace_member_read_role_templates
      ON public.org_role_templates
      FOR SELECT
      USING (public.org_current_user_is_active_member(organization_id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_admin_write_role_templates'
      AND tablename = 'org_role_templates'
  ) THEN
    CREATE POLICY org_workspace_admin_write_role_templates
      ON public.org_role_templates
      FOR ALL
      USING (
        public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
      )
      WITH CHECK (
        public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_context_last_used_select_own'
      AND tablename = 'context_last_used'
  ) THEN
    CREATE POLICY org_workspace_context_last_used_select_own
      ON public.context_last_used
      FOR SELECT
      USING (user_id = auth.uid());
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_context_last_used_insert_own'
      AND tablename = 'context_last_used'
  ) THEN
    CREATE POLICY org_workspace_context_last_used_insert_own
      ON public.context_last_used
      FOR INSERT
      WITH CHECK (user_id = auth.uid());
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_context_last_used_update_own'
      AND tablename = 'context_last_used'
  ) THEN
    CREATE POLICY org_workspace_context_last_used_update_own
      ON public.context_last_used
      FOR UPDATE
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_admin_read_invitations'
      AND tablename = 'org_invitations'
  ) THEN
    CREATE POLICY org_workspace_admin_read_invitations
      ON public.org_invitations
      FOR SELECT
      USING (
        public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_admin_write_invitations'
      AND tablename = 'org_invitations'
  ) THEN
    CREATE POLICY org_workspace_admin_write_invitations
      ON public.org_invitations
      FOR ALL
      USING (
        public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
      )
      WITH CHECK (
        public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_member_read_pipeline_configs'
      AND tablename = 'pipeline_configs'
  ) THEN
    CREATE POLICY org_workspace_member_read_pipeline_configs
      ON public.pipeline_configs
      FOR SELECT
      USING (public.org_current_user_has_brand_access(organization_id, brand_project_id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_admin_write_pipeline_configs'
      AND tablename = 'pipeline_configs'
  ) THEN
    CREATE POLICY org_workspace_admin_write_pipeline_configs
      ON public.pipeline_configs
      FOR ALL
      USING (
        public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
      )
      WITH CHECK (
        public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_member_read_pipeline_items'
      AND tablename = 'pipeline_items'
  ) THEN
    CREATE POLICY org_workspace_member_read_pipeline_items
      ON public.pipeline_items
      FOR SELECT
      USING (public.org_current_user_has_brand_access(organization_id, brand_project_id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_submitter_insert_pipeline_items'
      AND tablename = 'pipeline_items'
  ) THEN
    CREATE POLICY org_workspace_submitter_insert_pipeline_items
      ON public.pipeline_items
      FOR INSERT
      WITH CHECK (
        submitted_by = auth.uid()
        AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_authorized_update_pipeline_items'
      AND tablename = 'pipeline_items'
  ) THEN
    CREATE POLICY org_workspace_authorized_update_pipeline_items
      ON public.pipeline_items
      FOR UPDATE
      USING (
        (
          submitted_by = auth.uid()
          AND status IN ('pending', 'revision_requested')
        )
        OR public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin', 'editor')
      )
      WITH CHECK (
        (
          submitted_by = auth.uid()
          AND status IN ('pending', 'revision_requested', 'in_review', 'approved', 'rejected', 'withdrawn', 'scheduled', 'published')
        )
        OR public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin', 'editor')
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_member_read_posts'
      AND tablename = 'posts'
  ) THEN
    CREATE POLICY org_workspace_member_read_posts
      ON public.posts
      FOR SELECT
      USING (public.org_current_user_has_brand_access(organization_id, brand_project_id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_member_read_generations'
      AND tablename = 'generations'
  ) THEN
    CREATE POLICY org_workspace_member_read_generations
      ON public.generations
      FOR SELECT
      USING (public.org_current_user_has_brand_access(organization_id, brand_project_id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_member_read_common_room_channels'
      AND tablename = 'common_room_channels'
  ) THEN
    CREATE POLICY org_workspace_member_read_common_room_channels
      ON public.common_room_channels
      FOR SELECT
      USING (
        public.org_current_user_has_brand_access(organization_id, brand_project_id)
        AND (member_ids IS NULL OR auth.uid() = ANY(member_ids))
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_editor_insert_common_room_channels'
      AND tablename = 'common_room_channels'
  ) THEN
    CREATE POLICY org_workspace_editor_insert_common_room_channels
      ON public.common_room_channels
      FOR INSERT
      WITH CHECK (
        created_by = auth.uid()
        AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
        AND public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin', 'editor')
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_editor_update_common_room_channels'
      AND tablename = 'common_room_channels'
  ) THEN
    CREATE POLICY org_workspace_editor_update_common_room_channels
      ON public.common_room_channels
      FOR UPDATE
      USING (
        public.org_current_user_has_brand_access(organization_id, brand_project_id)
        AND public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin', 'editor')
      )
      WITH CHECK (
        public.org_current_user_has_brand_access(organization_id, brand_project_id)
        AND public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin', 'editor')
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_member_read_common_room_messages'
      AND tablename = 'common_room_messages'
  ) THEN
    CREATE POLICY org_workspace_member_read_common_room_messages
      ON public.common_room_messages
      FOR SELECT
      USING (
        public.org_current_user_is_active_member(organization_id)
        AND EXISTS (
          SELECT 1
          FROM public.common_room_channels channel
          WHERE channel.id = channel_id
            AND channel.organization_id = organization_id
            AND (channel.member_ids IS NULL OR auth.uid() = ANY(channel.member_ids))
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_member_insert_common_room_messages'
      AND tablename = 'common_room_messages'
  ) THEN
    CREATE POLICY org_workspace_member_insert_common_room_messages
      ON public.common_room_messages
      FOR INSERT
      WITH CHECK (
        sender_id = auth.uid()
        AND public.org_current_user_is_active_member(organization_id)
        AND EXISTS (
          SELECT 1
          FROM public.common_room_channels channel
          WHERE channel.id = channel_id
            AND channel.organization_id = organization_id
            AND (channel.member_ids IS NULL OR auth.uid() = ANY(channel.member_ids))
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_sender_update_common_room_messages'
      AND tablename = 'common_room_messages'
  ) THEN
    CREATE POLICY org_workspace_sender_update_common_room_messages
      ON public.common_room_messages
      FOR UPDATE
      USING (sender_id = auth.uid())
      WITH CHECK (sender_id = auth.uid());
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_admin_read_ai_session_logs'
      AND tablename = 'ai_session_logs'
  ) THEN
    CREATE POLICY org_workspace_admin_read_ai_session_logs
      ON public.ai_session_logs
      FOR SELECT
      USING (
        public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_own_read_ai_session_logs'
      AND tablename = 'ai_session_logs'
  ) THEN
    CREATE POLICY org_workspace_own_read_ai_session_logs
      ON public.ai_session_logs
      FOR SELECT
      USING (initiated_by = auth.uid());
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_insert_ai_session_logs'
      AND tablename = 'ai_session_logs'
  ) THEN
    CREATE POLICY org_workspace_insert_ai_session_logs
      ON public.ai_session_logs
      FOR INSERT
      WITH CHECK (
        initiated_by = auth.uid()
        AND public.org_current_user_is_active_member(organization_id)
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_member_read_assets'
      AND tablename = 'org_asset_library'
  ) THEN
    CREATE POLICY org_workspace_member_read_assets
      ON public.org_asset_library
      FOR SELECT
      USING (public.org_current_user_has_brand_access(organization_id, brand_project_id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_member_insert_assets'
      AND tablename = 'org_asset_library'
  ) THEN
    CREATE POLICY org_workspace_member_insert_assets
      ON public.org_asset_library
      FOR INSERT
      WITH CHECK (
        uploaded_by = auth.uid()
        AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_manager_update_assets'
      AND tablename = 'org_asset_library'
  ) THEN
    CREATE POLICY org_workspace_manager_update_assets
      ON public.org_asset_library
      FOR UPDATE
      USING (
        uploaded_by = auth.uid()
        OR public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin', 'editor')
      )
      WITH CHECK (
        uploaded_by = auth.uid()
        OR public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin', 'editor')
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_admin_read_credit_events'
      AND tablename = 'credit_events'
  ) THEN
    CREATE POLICY org_workspace_admin_read_credit_events
      ON public.credit_events
      FOR SELECT
      USING (
        public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_member_read_own_credit_events'
      AND tablename = 'credit_events'
  ) THEN
    CREATE POLICY org_workspace_member_read_own_credit_events
      ON public.credit_events
      FOR SELECT
      USING (member_id = auth.uid());
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_member_read_credit_requests'
      AND tablename = 'credit_requests'
  ) THEN
    CREATE POLICY org_workspace_member_read_credit_requests
      ON public.credit_requests
      FOR SELECT
      USING (
        requested_by = auth.uid()
        OR public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_member_insert_credit_requests'
      AND tablename = 'credit_requests'
  ) THEN
    CREATE POLICY org_workspace_member_insert_credit_requests
      ON public.credit_requests
      FOR INSERT
      WITH CHECK (
        requested_by = auth.uid()
        AND public.org_current_user_is_active_member(organization_id)
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'org_workspace_admin_update_credit_requests'
      AND tablename = 'credit_requests'
  ) THEN
    CREATE POLICY org_workspace_admin_update_credit_requests
      ON public.credit_requests
      FOR UPDATE
      USING (
        public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
      )
      WITH CHECK (
        public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
      );
  END IF;
END
$$;
