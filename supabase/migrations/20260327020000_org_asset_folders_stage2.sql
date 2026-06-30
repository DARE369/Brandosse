CREATE TABLE IF NOT EXISTS public.org_asset_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  brand_project_id uuid REFERENCES public.brand_projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  parent_folder_id uuid REFERENCES public.org_asset_folders(id) ON DELETE CASCADE,
  folder_path text NOT NULL,
  visibility text NOT NULL DEFAULT 'team'
    CHECK (visibility IN ('team', 'private')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  color text,
  icon text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_folders_org
  ON public.org_asset_folders(organization_id);

CREATE INDEX IF NOT EXISTS idx_asset_folders_project
  ON public.org_asset_folders(brand_project_id);

CREATE INDEX IF NOT EXISTS idx_asset_folders_parent
  ON public.org_asset_folders(parent_folder_id);

CREATE INDEX IF NOT EXISTS idx_asset_folders_path
  ON public.org_asset_folders(organization_id, folder_path);

CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_folders_unique_root_path
  ON public.org_asset_folders(organization_id, folder_path)
  WHERE brand_project_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_folders_unique_brand_path
  ON public.org_asset_folders(organization_id, brand_project_id, folder_path)
  WHERE brand_project_id IS NOT NULL;

ALTER TABLE public.org_asset_library
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES public.org_asset_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_org_assets_folder
  ON public.org_asset_library(folder_id)
  WHERE folder_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.normalize_org_folder_name(p_value text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_value text := trim(COALESCE(p_value, ''));
BEGIN
  v_value := regexp_replace(v_value, '/+', ' ', 'g');
  v_value := regexp_replace(v_value, '\s+', ' ', 'g');
  RETURN trim(v_value);
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_org_folder_path(p_value text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_value text := trim(COALESCE(p_value, '/'));
BEGIN
  IF v_value = '' THEN
    RETURN '/';
  END IF;

  IF left(v_value, 1) <> '/' THEN
    v_value := '/' || v_value;
  END IF;

  v_value := regexp_replace(v_value, '/{2,}', '/', 'g');

  IF length(v_value) > 1 AND right(v_value, 1) = '/' THEN
    v_value := left(v_value, length(v_value) - 1);
  END IF;

  RETURN COALESCE(NULLIF(v_value, ''), '/');
END;
$$;

CREATE OR REPLACE FUNCTION public.build_org_asset_folder_path(
  p_parent_path text,
  p_name text
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_name text := public.normalize_org_folder_name(p_name);
  v_parent_path text := public.normalize_org_folder_path(p_parent_path);
BEGIN
  IF NULLIF(v_name, '') IS NULL THEN
    RAISE EXCEPTION 'folder_name_required';
  END IF;

  IF v_parent_path = '/' THEN
    RETURN public.normalize_org_folder_path('/' || v_name);
  END IF;

  RETURN public.normalize_org_folder_path(v_parent_path || '/' || v_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_org_asset_folder()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent record;
BEGIN
  NEW.name := public.normalize_org_folder_name(NEW.name);

  IF NULLIF(NEW.name, '') IS NULL THEN
    RAISE EXCEPTION 'folder_name_required';
  END IF;

  IF NEW.parent_folder_id IS NOT NULL THEN
    SELECT id, organization_id, brand_project_id, folder_path
    INTO v_parent
    FROM public.org_asset_folders
    WHERE id = NEW.parent_folder_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'parent_folder_not_found';
    END IF;

    IF v_parent.organization_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'parent_folder_org_mismatch';
    END IF;

    IF v_parent.brand_project_id IS DISTINCT FROM NEW.brand_project_id THEN
      RAISE EXCEPTION 'parent_folder_brand_mismatch';
    END IF;

    NEW.folder_path := public.build_org_asset_folder_path(v_parent.folder_path, NEW.name);
  ELSE
    NEW.folder_path := public.build_org_asset_folder_path('/', NEW.name);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_org_asset_folder_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_folder record;
BEGIN
  IF NEW.folder_id IS NOT NULL THEN
    SELECT id, organization_id, brand_project_id, folder_path
    INTO v_folder
    FROM public.org_asset_folders
    WHERE id = NEW.folder_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'asset_folder_not_found';
    END IF;

    IF v_folder.organization_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'asset_folder_org_mismatch';
    END IF;

    IF v_folder.brand_project_id IS NOT NULL
      AND v_folder.brand_project_id IS DISTINCT FROM NEW.brand_project_id THEN
      RAISE EXCEPTION 'asset_folder_brand_mismatch';
    END IF;

    NEW.folder_path := v_folder.folder_path;
  ELSE
    NEW.folder_path := public.normalize_org_folder_path(NEW.folder_path);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.org_current_user_can_access_asset_folder(p_folder_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_asset_folders folder
    WHERE folder.id = p_folder_id
      AND public.org_current_user_has_brand_access(folder.organization_id, folder.brand_project_id)
      AND (
        folder.visibility = 'team'
        OR folder.created_by = auth.uid()
        OR public.org_current_user_role(folder.organization_id) IN ('org_owner', 'org_admin')
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.org_current_user_can_write_to_asset_folder(p_folder_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_asset_folders folder
    WHERE folder.id = p_folder_id
      AND public.org_current_user_has_brand_access(folder.organization_id, folder.brand_project_id)
      AND public.get_member_permission(folder.organization_id, 'can_manage_library')
      AND (
        folder.visibility = 'team'
        OR folder.created_by = auth.uid()
        OR public.org_current_user_role(folder.organization_id) IN ('org_owner', 'org_admin')
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.ensure_org_asset_folder(
  p_organization_id uuid,
  p_brand_project_id uuid,
  p_folder_path text,
  p_created_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_normalized_path text := public.normalize_org_folder_path(p_folder_path);
  v_parent_id uuid := NULL;
  v_parent_path text := '/';
  v_segment text;
  v_current_path text;
  v_folder_id uuid;
BEGIN
  IF v_normalized_path = '/' THEN
    RETURN NULL;
  END IF;

  FOREACH v_segment IN ARRAY string_to_array(trim(both '/' from v_normalized_path), '/')
  LOOP
    v_segment := public.normalize_org_folder_name(v_segment);
    IF NULLIF(v_segment, '') IS NULL THEN
      CONTINUE;
    END IF;

    v_current_path := public.build_org_asset_folder_path(v_parent_path, v_segment);

    SELECT id
    INTO v_folder_id
    FROM public.org_asset_folders
    WHERE organization_id = p_organization_id
      AND brand_project_id IS NOT DISTINCT FROM p_brand_project_id
      AND folder_path = v_current_path
    LIMIT 1;

    IF v_folder_id IS NULL THEN
      INSERT INTO public.org_asset_folders (
        organization_id,
        brand_project_id,
        name,
        parent_folder_id,
        folder_path,
        visibility,
        created_by
      )
      VALUES (
        p_organization_id,
        p_brand_project_id,
        v_segment,
        v_parent_id,
        v_current_path,
        'team',
        p_created_by
      )
      RETURNING id INTO v_folder_id;
    END IF;

    v_parent_id := v_folder_id;
    v_parent_path := v_current_path;
  END LOOP;

  RETURN v_parent_id;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_org_asset_folders_updated_at'
  ) THEN
    CREATE TRIGGER set_org_asset_folders_updated_at
      BEFORE UPDATE ON public.org_asset_folders
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'prepare_org_asset_folder'
  ) THEN
    CREATE TRIGGER prepare_org_asset_folder
      BEFORE INSERT OR UPDATE OF name, parent_folder_id
      ON public.org_asset_folders
      FOR EACH ROW
      EXECUTE FUNCTION public.prepare_org_asset_folder();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'sync_org_asset_folder_assignment'
  ) THEN
    CREATE TRIGGER sync_org_asset_folder_assignment
      BEFORE INSERT OR UPDATE OF folder_id, folder_path, brand_project_id
      ON public.org_asset_library
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_org_asset_folder_assignment();
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

    INSERT INTO public.org_asset_folders (
      organization_id,
      brand_project_id,
      name,
      folder_path,
      visibility,
      created_by,
      color,
      icon,
      is_system
    )
    VALUES
      (v_org.id, NULL, 'Brand Assets', '/Brand Assets', 'team', v_created_by, '#6366F1', 'Bookmark', true),
      (v_org.id, NULL, 'Campaign Work', '/Campaign Work', 'team', v_created_by, '#10B981', 'Briefcase', true),
      (v_org.id, NULL, 'Published Content', '/Published Content', 'team', v_created_by, '#3B82F6', 'Send', true),
      (v_org.id, NULL, 'Archived', '/Archived', 'team', v_created_by, '#6B7280', 'Archive', true)
    ON CONFLICT DO NOTHING;
  END LOOP;
END
$$;

DO $$
DECLARE
  v_asset record;
  v_folder_id uuid;
BEGIN
  FOR v_asset IN
    SELECT id, organization_id, brand_project_id, uploaded_by, folder_path
    FROM public.org_asset_library
    WHERE folder_id IS NULL
      AND public.normalize_org_folder_path(folder_path) <> '/'
  LOOP
    v_folder_id := public.ensure_org_asset_folder(
      v_asset.organization_id,
      v_asset.brand_project_id,
      v_asset.folder_path,
      v_asset.uploaded_by
    );

    UPDATE public.org_asset_library
    SET folder_id = v_folder_id
    WHERE id = v_asset.id;
  END LOOP;
END
$$;

ALTER TABLE public.org_asset_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_workspace_member_read_asset_folders ON public.org_asset_folders;
CREATE POLICY org_workspace_member_read_asset_folders
  ON public.org_asset_folders
  FOR SELECT
  USING (public.org_current_user_can_access_asset_folder(id));

DROP POLICY IF EXISTS org_workspace_member_insert_asset_folders ON public.org_asset_folders;
CREATE POLICY org_workspace_member_insert_asset_folders
  ON public.org_asset_folders
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_manage_library')
  );

DROP POLICY IF EXISTS org_workspace_member_update_asset_folders ON public.org_asset_folders;
CREATE POLICY org_workspace_member_update_asset_folders
  ON public.org_asset_folders
  FOR UPDATE
  USING (
    public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_manage_library')
    AND (
      created_by = auth.uid()
      OR public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
    )
  )
  WITH CHECK (
    public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_manage_library')
    AND (
      created_by = auth.uid()
      OR public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
    )
  );

DROP POLICY IF EXISTS org_workspace_member_delete_asset_folders ON public.org_asset_folders;
CREATE POLICY org_workspace_member_delete_asset_folders
  ON public.org_asset_folders
  FOR DELETE
  USING (
    NOT is_system
    AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_manage_library')
    AND (
      created_by = auth.uid()
      OR public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
    )
  );

DROP POLICY IF EXISTS org_workspace_member_read_assets ON public.org_asset_library;
CREATE POLICY org_workspace_member_read_assets
  ON public.org_asset_library
  FOR SELECT
  USING (
    public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND (
      folder_id IS NULL
      OR public.org_current_user_can_access_asset_folder(folder_id)
    )
  );

DROP POLICY IF EXISTS org_workspace_permission_insert_assets ON public.org_asset_library;
CREATE POLICY org_workspace_permission_insert_assets
  ON public.org_asset_library
  FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid()
    AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_manage_library')
    AND (
      folder_id IS NULL
      OR public.org_current_user_can_write_to_asset_folder(folder_id)
    )
  );

DROP POLICY IF EXISTS org_workspace_permission_update_assets ON public.org_asset_library;
CREATE POLICY org_workspace_permission_update_assets
  ON public.org_asset_library
  FOR UPDATE
  USING (
    public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_manage_library')
    AND (
      folder_id IS NULL
      OR public.org_current_user_can_write_to_asset_folder(folder_id)
    )
  )
  WITH CHECK (
    public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_manage_library')
    AND (
      folder_id IS NULL
      OR public.org_current_user_can_write_to_asset_folder(folder_id)
    )
  );
