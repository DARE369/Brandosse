DROP POLICY IF EXISTS org_workspace_member_insert_assets ON public.org_asset_library;
DROP POLICY IF EXISTS org_workspace_manager_update_assets ON public.org_asset_library;
DROP POLICY IF EXISTS org_workspace_permission_insert_assets ON public.org_asset_library;
DROP POLICY IF EXISTS org_workspace_permission_update_assets ON public.org_asset_library;

CREATE POLICY org_workspace_permission_insert_assets
  ON public.org_asset_library
  FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid()
    AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_manage_library')
  );

CREATE POLICY org_workspace_permission_update_assets
  ON public.org_asset_library
  FOR UPDATE
  USING (
    public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_manage_library')
  )
  WITH CHECK (
    public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_manage_library')
  );
