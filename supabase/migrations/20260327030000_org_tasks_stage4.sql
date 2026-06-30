CREATE OR REPLACE FUNCTION public.get_default_org_role_permissions(p_role_key text)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT CASE lower(coalesce(p_role_key, 'contributor'))
    WHEN 'org_owner' THEN jsonb_build_object(
      'can_publish', true,
      'publish_requires_final_approval', false,
      'can_manage_library', true,
      'can_approve_library_uploads', true,
      'can_schedule', true,
      'can_manage_tasks', true,
      'can_invite_members', true,
      'can_create_channels', true,
      'monthly_credit_limit', null
    )
    WHEN 'org_admin' THEN jsonb_build_object(
      'can_publish', true,
      'publish_requires_final_approval', false,
      'can_manage_library', true,
      'can_approve_library_uploads', true,
      'can_schedule', true,
      'can_manage_tasks', true,
      'can_invite_members', true,
      'can_create_channels', true,
      'monthly_credit_limit', null
    )
    WHEN 'editor' THEN jsonb_build_object(
      'can_publish', true,
      'publish_requires_final_approval', true,
      'can_manage_library', true,
      'can_approve_library_uploads', false,
      'can_schedule', true,
      'can_manage_tasks', true,
      'can_invite_members', false,
      'can_create_channels', true,
      'monthly_credit_limit', null
    )
    WHEN 'reviewer' THEN jsonb_build_object(
      'can_publish', false,
      'publish_requires_final_approval', false,
      'can_manage_library', false,
      'can_approve_library_uploads', false,
      'can_schedule', false,
      'can_manage_tasks', false,
      'can_invite_members', false,
      'can_create_channels', false,
      'monthly_credit_limit', 0
    )
    ELSE jsonb_build_object(
      'can_publish', false,
      'publish_requires_final_approval', false,
      'can_manage_library', false,
      'can_approve_library_uploads', false,
      'can_schedule', false,
      'can_manage_tasks', false,
      'can_invite_members', false,
      'can_create_channels', false,
      'monthly_credit_limit', 200
    )
  END;
$$;

INSERT INTO public.org_role_templates (
  organization_id,
  role_key,
  display_name,
  permissions,
  is_system
)
SELECT
  organizations.id,
  defaults.role_key,
  defaults.display_name,
  public.get_default_org_role_permissions(defaults.role_key),
  true
FROM public.organizations
CROSS JOIN (
  VALUES
    ('org_owner', 'Organization Owner'),
    ('org_admin', 'Organization Admin'),
    ('editor', 'Editor'),
    ('contributor', 'Contributor'),
    ('reviewer', 'Reviewer')
) AS defaults(role_key, display_name)
ON CONFLICT (organization_id, role_key)
DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  permissions = EXCLUDED.permissions || COALESCE(public.org_role_templates.permissions, '{}'::jsonb),
  is_system = true,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.get_member_permission(
  p_organization_id uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.organization_members;
  v_role_key text;
  v_role_permissions jsonb;
  v_override boolean;
  v_default boolean;
BEGIN
  SELECT * INTO v_member
  FROM public.organization_members
  WHERE organization_id = p_organization_id
    AND user_id = auth.uid()
    AND status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_role_key := coalesce(
    nullif(v_member.org_role_key, ''),
    CASE WHEN v_member.role = 'org_admin' THEN 'org_admin' ELSE 'contributor' END
  );

  v_override := (v_member.permissions ->> p_permission_key)::boolean;
  IF v_override IS NOT NULL THEN
    RETURN v_override;
  END IF;

  SELECT permissions
  INTO v_role_permissions
  FROM public.org_role_templates
  WHERE organization_id = p_organization_id
    AND role_key = v_role_key
  LIMIT 1;

  v_role_permissions := coalesce(v_role_permissions, public.get_default_org_role_permissions(v_role_key));
  v_default := (v_role_permissions ->> p_permission_key)::boolean;
  RETURN coalesce(v_default, false);
END;
$$;

CREATE TABLE IF NOT EXISTS public.org_task_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#64748B',
  position integer NOT NULL DEFAULT 0,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_task_statuses_org_key_unique UNIQUE (organization_id, key)
);

CREATE INDEX IF NOT EXISTS idx_org_task_statuses_org
  ON public.org_task_statuses(organization_id, position, name);

CREATE TABLE IF NOT EXISTS public.org_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  brand_project_id uuid REFERENCES public.brand_projects(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  status_id uuid NOT NULL REFERENCES public.org_task_statuses(id) ON DELETE RESTRICT,
  priority text NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assignee_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  due_at timestamptz,
  completed_at timestamptz,
  is_blocked boolean NOT NULL DEFAULT false,
  blocked_reason text,
  linked_post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  linked_pipeline_item_id uuid REFERENCES public.pipeline_items(id) ON DELETE SET NULL,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.org_tasks(id) ON DELETE SET NULL;

ALTER TABLE public.pipeline_items
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.org_tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_org_tasks_org
  ON public.org_tasks(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_org_tasks_brand
  ON public.org_tasks(brand_project_id)
  WHERE brand_project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_tasks_status
  ON public.org_tasks(status_id);

CREATE INDEX IF NOT EXISTS idx_org_tasks_assignee
  ON public.org_tasks(assignee_user_id)
  WHERE assignee_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_tasks_due
  ON public.org_tasks(organization_id, due_at)
  WHERE due_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_tasks_linked_post_unique
  ON public.org_tasks(linked_post_id)
  WHERE linked_post_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_tasks_linked_pipeline_unique
  ON public.org_tasks(linked_pipeline_item_id)
  WHERE linked_pipeline_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_task_unique
  ON public.posts(task_id)
  WHERE task_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_items_task_unique
  ON public.pipeline_items(task_id)
  WHERE task_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.normalize_org_task_status_key(p_value text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT regexp_replace(
    trim(both '_' FROM regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', '_', 'g')),
    '_{2,}',
    '_',
    'g'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_org_task_status_id(
  p_organization_id uuid,
  p_key text
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ots.id
  FROM public.org_task_statuses ots
  WHERE ots.organization_id = p_organization_id
    AND ots.key = public.normalize_org_task_status_key(p_key)
  ORDER BY ots.position ASC, ots.created_at ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.prepare_org_task_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_max_position integer;
BEGIN
  NEW.name := trim(coalesce(NEW.name, ''));
  IF NEW.name = '' THEN
    RAISE EXCEPTION 'task_status_name_required';
  END IF;

  NEW.key := public.normalize_org_task_status_key(coalesce(NULLIF(trim(coalesce(NEW.key, '')), ''), NEW.name));
  IF NEW.key = '' THEN
    RAISE EXCEPTION 'task_status_key_required';
  END IF;

  IF NEW.position IS NULL OR NEW.position < 0 THEN
    SELECT coalesce(max(position), -1)
    INTO v_max_position
    FROM public.org_task_statuses
    WHERE organization_id = NEW.organization_id
      AND id IS DISTINCT FROM NEW.id;

    NEW.position := v_max_position + 1;
  END IF;

  NEW.color := coalesce(NULLIF(trim(coalesce(NEW.color, '')), ''), '#64748B');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_org_task()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_post record;
  v_pipeline record;
  v_status_key text;
BEGIN
  NEW.title := trim(coalesce(NEW.title, ''));
  IF NEW.title = '' THEN
    RAISE EXCEPTION 'task_title_required';
  END IF;

  NEW.description := nullif(trim(coalesce(NEW.description, '')), '');

  IF NEW.linked_post_id IS NOT NULL THEN
    SELECT id, organization_id, brand_project_id, pipeline_item_id
    INTO v_post
    FROM public.posts
    WHERE id = NEW.linked_post_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'task_linked_post_not_found';
    END IF;

    IF NEW.organization_id IS DISTINCT FROM v_post.organization_id THEN
      IF NEW.organization_id IS NULL THEN
        NEW.organization_id := v_post.organization_id;
      ELSE
        RAISE EXCEPTION 'task_linked_post_org_mismatch';
      END IF;
    END IF;

    IF NEW.brand_project_id IS NULL THEN
      NEW.brand_project_id := v_post.brand_project_id;
    ELSIF v_post.brand_project_id IS NOT NULL AND NEW.brand_project_id IS DISTINCT FROM v_post.brand_project_id THEN
      RAISE EXCEPTION 'task_linked_post_brand_mismatch';
    END IF;

    IF NEW.linked_pipeline_item_id IS NULL AND v_post.pipeline_item_id IS NOT NULL THEN
      NEW.linked_pipeline_item_id := v_post.pipeline_item_id;
    END IF;
  END IF;

  IF NEW.linked_pipeline_item_id IS NOT NULL THEN
    SELECT id, organization_id, brand_project_id, post_id
    INTO v_pipeline
    FROM public.pipeline_items
    WHERE id = NEW.linked_pipeline_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'task_linked_pipeline_not_found';
    END IF;

    IF NEW.organization_id IS DISTINCT FROM v_pipeline.organization_id THEN
      IF NEW.organization_id IS NULL THEN
        NEW.organization_id := v_pipeline.organization_id;
      ELSE
        RAISE EXCEPTION 'task_linked_pipeline_org_mismatch';
      END IF;
    END IF;

    IF NEW.brand_project_id IS NULL THEN
      NEW.brand_project_id := v_pipeline.brand_project_id;
    ELSIF v_pipeline.brand_project_id IS NOT NULL AND NEW.brand_project_id IS DISTINCT FROM v_pipeline.brand_project_id THEN
      RAISE EXCEPTION 'task_linked_pipeline_brand_mismatch';
    END IF;

    IF NEW.linked_post_id IS NULL AND v_pipeline.post_id IS NOT NULL THEN
      NEW.linked_post_id := v_pipeline.post_id;
    END IF;
  END IF;

  SELECT key
  INTO v_status_key
  FROM public.org_task_statuses
  WHERE id = NEW.status_id
  LIMIT 1;

  IF v_status_key = 'completed' THEN
    NEW.completed_at := coalesce(NEW.completed_at, now());
    NEW.is_blocked := false;
    NEW.blocked_reason := null;
  ELSE
    NEW.completed_at := null;
    IF NOT NEW.is_blocked THEN
      NEW.blocked_reason := null;
    END IF;
  END IF;

  IF NEW.priority IS NULL THEN
    NEW.priority := 'medium';
  END IF;

  IF NEW.notes IS NULL OR jsonb_typeof(NEW.notes) <> 'array' THEN
    NEW.notes := '[]'::jsonb;
  END IF;

  IF NEW.metadata IS NULL OR jsonb_typeof(NEW.metadata) <> 'object' THEN
    NEW.metadata := '{}'::jsonb;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_org_task_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.posts
  SET task_id = NULL
  WHERE task_id = NEW.id
    AND (NEW.linked_post_id IS NULL OR id <> NEW.linked_post_id);

  IF NEW.linked_post_id IS NOT NULL THEN
    UPDATE public.posts
    SET task_id = NEW.id
    WHERE id = NEW.linked_post_id;
  END IF;

  UPDATE public.pipeline_items
  SET task_id = NULL
  WHERE task_id = NEW.id
    AND (NEW.linked_pipeline_item_id IS NULL OR id <> NEW.linked_pipeline_item_id);

  IF NEW.linked_pipeline_item_id IS NOT NULL THEN
    UPDATE public.pipeline_items
    SET task_id = NEW.id
    WHERE id = NEW.linked_pipeline_item_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_org_task_status_from_pipeline_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status_id uuid;
BEGIN
  IF NEW.task_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.task_id IS NOT DISTINCT FROM OLD.task_id
  THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('pending', 'in_review') THEN
    v_status_id := public.get_org_task_status_id(NEW.organization_id, 'in_review');
  ELSIF NEW.status = 'revision_requested' THEN
    v_status_id := public.get_org_task_status_id(NEW.organization_id, 'in_progress');
  ELSIF NEW.status IN ('approved', 'scheduled', 'published') THEN
    v_status_id := public.get_org_task_status_id(NEW.organization_id, 'completed');
  ELSE
    RETURN NEW;
  END IF;

  IF v_status_id IS NOT NULL THEN
    UPDATE public.org_tasks
    SET
      status_id = v_status_id,
      is_blocked = false,
      blocked_reason = NULL,
      updated_at = now()
    WHERE id = NEW.task_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_org_task_status_from_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status_id uuid;
BEGIN
  IF NEW.task_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.task_id IS NOT DISTINCT FROM OLD.task_id
  THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'draft' THEN
    v_status_id := public.get_org_task_status_id(NEW.organization_id, 'in_progress');
  ELSIF NEW.status IN ('scheduled', 'published') THEN
    v_status_id := public.get_org_task_status_id(NEW.organization_id, 'completed');
  ELSE
    RETURN NEW;
  END IF;

  IF v_status_id IS NOT NULL THEN
    UPDATE public.org_tasks
    SET
      status_id = v_status_id,
      is_blocked = false,
      blocked_reason = NULL,
      updated_at = now()
    WHERE id = NEW.task_id;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_org_task_statuses_updated_at'
  ) THEN
    CREATE TRIGGER set_org_task_statuses_updated_at
      BEFORE UPDATE ON public.org_task_statuses
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'prepare_org_task_status'
  ) THEN
    CREATE TRIGGER prepare_org_task_status
      BEFORE INSERT OR UPDATE ON public.org_task_statuses
      FOR EACH ROW
      EXECUTE FUNCTION public.prepare_org_task_status();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_org_tasks_updated_at'
  ) THEN
    CREATE TRIGGER set_org_tasks_updated_at
      BEFORE UPDATE ON public.org_tasks
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'prepare_org_task'
  ) THEN
    CREATE TRIGGER prepare_org_task
      BEFORE INSERT OR UPDATE ON public.org_tasks
      FOR EACH ROW
      EXECUTE FUNCTION public.prepare_org_task();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'sync_org_task_links'
  ) THEN
    CREATE TRIGGER sync_org_task_links
      AFTER INSERT OR UPDATE OF linked_post_id, linked_pipeline_item_id ON public.org_tasks
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_org_task_links();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'sync_org_task_status_from_pipeline_item'
  ) THEN
    CREATE TRIGGER sync_org_task_status_from_pipeline_item
      AFTER INSERT OR UPDATE OF status, task_id ON public.pipeline_items
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_org_task_status_from_pipeline_item();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'sync_org_task_status_from_post'
  ) THEN
    CREATE TRIGGER sync_org_task_status_from_post
      AFTER INSERT OR UPDATE OF status, task_id ON public.posts
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_org_task_status_from_post();
  END IF;
END
$$;

DO $$
DECLARE
  v_org record;
  v_created_by uuid;
BEGIN
  FOR v_org IN
    SELECT
      organizations.id,
      organizations.owner_user_id,
      organizations.owner_id,
      (
        SELECT om.user_id
        FROM public.organization_members om
        WHERE om.organization_id = organizations.id
          AND om.status = 'active'
        ORDER BY om.joined_at NULLS LAST, om.user_id
        LIMIT 1
      ) AS fallback_user_id
    FROM public.organizations
  LOOP
    v_created_by := COALESCE(v_org.owner_user_id, v_org.owner_id, v_org.fallback_user_id);
    IF v_created_by IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.org_task_statuses (
      organization_id,
      key,
      name,
      color,
      position,
      is_system,
      created_by
    )
    VALUES
      (v_org.id, 'todo', 'To Do', '#64748B', 0, true, v_created_by),
      (v_org.id, 'in_progress', 'In Progress', '#2563EB', 1, true, v_created_by),
      (v_org.id, 'in_review', 'In Review', '#D97706', 2, true, v_created_by),
      (v_org.id, 'completed', 'Completed', '#10B981', 3, true, v_created_by)
    ON CONFLICT (organization_id, key)
    DO UPDATE
    SET
      name = EXCLUDED.name,
      color = EXCLUDED.color,
      is_system = true;
  END LOOP;
END
$$;

ALTER TABLE public.org_task_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_workspace_member_read_task_statuses ON public.org_task_statuses;
CREATE POLICY org_workspace_member_read_task_statuses
  ON public.org_task_statuses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = org_task_statuses.organization_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS org_workspace_admin_manage_task_statuses ON public.org_task_statuses;
CREATE POLICY org_workspace_admin_manage_task_statuses
  ON public.org_task_statuses
  FOR ALL
  USING (
    public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
  )
  WITH CHECK (
    public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
  );

DROP POLICY IF EXISTS org_workspace_member_read_tasks ON public.org_tasks;
CREATE POLICY org_workspace_member_read_tasks
  ON public.org_tasks
  FOR SELECT
  USING (
    public.org_current_user_has_brand_access(organization_id, brand_project_id)
  );

DROP POLICY IF EXISTS org_workspace_member_insert_tasks ON public.org_tasks;
CREATE POLICY org_workspace_member_insert_tasks
  ON public.org_tasks
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_manage_tasks')
  );

DROP POLICY IF EXISTS org_workspace_member_update_tasks ON public.org_tasks;
CREATE POLICY org_workspace_member_update_tasks
  ON public.org_tasks
  FOR UPDATE
  USING (
    public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_manage_tasks')
  )
  WITH CHECK (
    public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_manage_tasks')
  );

DROP POLICY IF EXISTS org_workspace_member_delete_tasks ON public.org_tasks;
CREATE POLICY org_workspace_member_delete_tasks
  ON public.org_tasks
  FOR DELETE
  USING (
    public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_manage_tasks')
  );
