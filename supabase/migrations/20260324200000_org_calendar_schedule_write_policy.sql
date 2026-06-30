DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE policyname = 'org_workspace_member_schedule_posts'
      AND tablename = 'posts'
  ) THEN
    CREATE POLICY org_workspace_member_schedule_posts
      ON public.posts
      FOR UPDATE
      USING (
        organization_id IS NOT NULL
        AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
        AND public.get_member_permission(organization_id, 'can_schedule')
      )
      WITH CHECK (
        organization_id IS NOT NULL
        AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
        AND public.get_member_permission(organization_id, 'can_schedule')
      );
  END IF;
END
$$;
