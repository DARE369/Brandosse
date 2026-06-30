CREATE OR REPLACE FUNCTION public.org_current_user_can_access_asset_folder(p_folder_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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
SECURITY DEFINER
SET search_path = public
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

DROP POLICY IF EXISTS org_workspace_member_read_asset_folders ON public.org_asset_folders;
CREATE POLICY org_workspace_member_read_asset_folders
  ON public.org_asset_folders
  FOR SELECT
  USING (
    public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND (
      visibility = 'team'
      OR created_by = auth.uid()
      OR public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
    )
  );
