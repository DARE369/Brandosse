CREATE OR REPLACE FUNCTION public.can_user_post_to_account(p_account_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account public.connected_accounts;
  v_member public.organization_members;
  v_role_key text;
  v_role_permissions jsonb;
  v_override boolean;
  v_default boolean;
BEGIN
  SELECT *
  INTO v_account
  FROM public.connected_accounts
  WHERE id = p_account_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF coalesce(v_account.connection_status, 'active') IN ('revoked', 'disconnected') THEN
    RETURN false;
  END IF;

  IF v_account.scope = 'personal' THEN
    RETURN v_account.user_id = p_user_id;
  END IF;

  IF v_account.organization_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT *
  INTO v_member
  FROM public.organization_members
  WHERE organization_id = v_account.organization_id
    AND user_id = p_user_id
    AND status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_role_key := coalesce(
    nullif(v_member.org_role_key, ''),
    CASE WHEN v_member.role = 'org_admin' THEN 'org_admin' ELSE 'contributor' END
  );

  IF v_role_key IN ('org_owner', 'org_admin') THEN
    RETURN true;
  END IF;

  IF coalesce(array_length(v_account.granted_member_ids, 1), 0) > 0
    AND NOT p_user_id = ANY(coalesce(v_account.granted_member_ids, '{}'::uuid[]))
  THEN
    RETURN false;
  END IF;

  v_override := (v_member.permissions ->> 'can_publish')::boolean;
  IF v_override IS NOT NULL THEN
    RETURN v_override;
  END IF;

  SELECT permissions
  INTO v_role_permissions
  FROM public.org_role_templates
  WHERE organization_id = v_account.organization_id
    AND role_key = v_role_key
  LIMIT 1;

  v_role_permissions := coalesce(v_role_permissions, public.get_default_org_role_permissions(v_role_key));
  v_default := (v_role_permissions ->> 'can_publish')::boolean;

  RETURN coalesce(v_default, false);
END;
$$;
