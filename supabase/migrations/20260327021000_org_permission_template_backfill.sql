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
