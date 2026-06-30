CREATE OR REPLACE FUNCTION public.get_org_member(p_organization_id uuid)
RETURNS public.organization_members
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT om.*
  FROM public.organization_members om
  WHERE om.organization_id = p_organization_id
    AND om.user_id = auth.uid()
    AND om.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.org_current_user_role(p_organization_id) IN ('org_owner', 'org_admin');
$$;

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

  IF v_role_permissions IS NULL THEN
    RETURN false;
  END IF;

  v_default := (v_role_permissions ->> p_permission_key)::boolean;
  RETURN coalesce(v_default, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_ai_session_key(
  p_org_id uuid,
  p_user_id uuid
)
RETURNS text
LANGUAGE sql
AS $$
  SELECT 'org_' ||
    left(replace(p_org_id::text, '-', ''), 4) || '_' ||
    left(replace(p_user_id::text, '-', ''), 4) || '_' ||
    extract(epoch FROM now())::bigint::text;
$$;

CREATE OR REPLACE FUNCTION public.apply_generation_org_scope_to_post()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_generation public.generations;
BEGIN
  IF NEW.generation_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.organization_id IS NOT NULL AND NEW.brand_project_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_generation
  FROM public.generations
  WHERE id = NEW.generation_id
  LIMIT 1;

  IF FOUND THEN
    NEW.organization_id := coalesce(NEW.organization_id, v_generation.organization_id);
    NEW.brand_project_id := coalesce(NEW.brand_project_id, v_generation.brand_project_id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_generation_org_scope_to_posts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.posts
  SET
    organization_id = coalesce(organization_id, NEW.organization_id),
    brand_project_id = coalesce(brand_project_id, NEW.brand_project_id)
  WHERE generation_id = NEW.id
    AND (
      organization_id IS DISTINCT FROM NEW.organization_id
      OR brand_project_id IS DISTINCT FROM NEW.brand_project_id
    );

  RETURN NEW;
END;
$$;

UPDATE public.posts p
SET
  organization_id = coalesce(p.organization_id, g.organization_id),
  brand_project_id = coalesce(p.brand_project_id, g.brand_project_id)
FROM public.generations g
WHERE p.generation_id = g.id
  AND g.organization_id IS NOT NULL
  AND (
    p.organization_id IS DISTINCT FROM g.organization_id
    OR p.brand_project_id IS DISTINCT FROM g.brand_project_id
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_posts_org_scope_from_generation'
  ) THEN
    CREATE TRIGGER set_posts_org_scope_from_generation
      BEFORE INSERT OR UPDATE ON public.posts
      FOR EACH ROW
      EXECUTE FUNCTION public.apply_generation_org_scope_to_post();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'zz_sync_generation_org_scope_to_posts'
  ) THEN
    CREATE TRIGGER zz_sync_generation_org_scope_to_posts
      AFTER INSERT OR UPDATE OF organization_id, brand_project_id ON public.generations
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_generation_org_scope_to_posts();
  END IF;
END
$$;
