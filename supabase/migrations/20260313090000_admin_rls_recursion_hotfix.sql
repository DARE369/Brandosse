-- ============================================================================
-- Migration: admin_rls_recursion_hotfix
-- Date: 2026-03-13
-- Purpose:
--   Fix recursive RLS evaluation for admin helper functions by moving the
--   helper lookups to SECURITY DEFINER functions.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_role(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT ar.role
     FROM public.admin_roles ar
     WHERE ar.user_id = p_user_id
     LIMIT 1),
    (SELECT CASE
      WHEN lower(coalesce(p.role, '')) = 'org_admin' THEN 'org_admin'
      WHEN lower(coalesce(p.role, '')) IN ('admin', 'super_admin') THEN 'super_admin'
      ELSE NULL
    END
     FROM public.profiles p
     WHERE p.id = p_user_id
     LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.get_admin_organization_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT ar.organization_id
     FROM public.admin_roles ar
     WHERE ar.user_id = p_user_id
     LIMIT 1),
    (SELECT p.organization_id
     FROM public.profiles p
     WHERE p.id = p_user_id
     LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_admin_role(p_user_id) = 'super_admin';
$$;

CREATE OR REPLACE FUNCTION public.is_admin_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_admin_role(p_user_id) IN ('super_admin', 'org_admin');
$$;

CREATE OR REPLACE FUNCTION public.can_admin_access_organization(p_admin_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_admin_id IS NULL THEN false
    WHEN public.is_super_admin_user(p_admin_id) THEN true
    WHEN public.get_admin_role(p_admin_id) = 'org_admin'
      THEN p_org_id IS NOT NULL AND public.get_admin_organization_id(p_admin_id) = p_org_id
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_admin_access_user(p_admin_id uuid, p_target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_admin_id IS NULL OR p_target_user_id IS NULL THEN false
    WHEN public.is_super_admin_user(p_admin_id) THEN true
    WHEN public.get_admin_role(p_admin_id) = 'org_admin'
      THEN EXISTS (
        SELECT 1
        FROM public.profiles target_profile
        WHERE target_profile.id = p_target_user_id
          AND target_profile.organization_id = public.get_admin_organization_id(p_admin_id)
      )
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_organization_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_super_admin_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_admin_access_organization(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_admin_access_user(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_admin_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_organization_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_admin_access_organization(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_admin_access_user(uuid, uuid) TO authenticated;
