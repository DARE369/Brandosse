CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.organization_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  monthly_credit_allocation integer NOT NULL DEFAULT 1000,
  max_members integer,
  max_brand_projects integer,
  max_connected_accounts integer,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS plan_key text DEFAULT 'organization',
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS brand_color text DEFAULT '#6366F1',
  ADD COLUMN IF NOT EXISTS monthly_credit_pool integer NOT NULL DEFAULT 2000,
  ADD COLUMN IF NOT EXISTS credits_used_this_period integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_reset_date date,
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT;

UPDATE public.organizations
SET owner_id = coalesce(owner_id, owner_user_id)
WHERE owner_id IS NULL
  AND owner_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.brand_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  logo_url text,
  brand_color text DEFAULT '#6366F1',
  brand_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_brand_projects_org
  ON public.brand_projects(organization_id);

CREATE INDEX IF NOT EXISTS idx_brand_projects_org_default
  ON public.brand_projects(organization_id, is_default);

ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS org_role_key text,
  ADD COLUMN IF NOT EXISTS brand_project_ids uuid[],
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS credits_used_this_period integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

UPDATE public.organization_members
SET org_role_key = CASE
  WHEN role = 'org_admin' THEN 'org_admin'
  ELSE 'contributor'
END
WHERE org_role_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_org_members_user
  ON public.organization_members(user_id, status);

CREATE INDEX IF NOT EXISTS idx_org_members_org_role
  ON public.organization_members(organization_id, org_role_key, status);

CREATE TABLE IF NOT EXISTS public.org_role_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role_key text NOT NULL,
  display_name text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, role_key)
);

CREATE INDEX IF NOT EXISTS idx_role_templates_org
  ON public.org_role_templates(organization_id);

CREATE TABLE IF NOT EXISTS public.context_last_used (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_context_type text NOT NULL DEFAULT 'personal',
  last_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  last_brand_project_id uuid REFERENCES public.brand_projects(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.org_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'contributor',
  brand_project_ids uuid[],
  invited_by uuid NOT NULL REFERENCES auth.users(id),
  invitation_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_org
  ON public.org_invitations(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_invitations_email
  ON public.org_invitations(email, status);

CREATE INDEX IF NOT EXISTS idx_invitations_token
  ON public.org_invitations(invitation_token);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'user_notifications'
  ) THEN
    ALTER TABLE public.user_notifications
      ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'admin_notifications'
  ) THEN
    ALTER TABLE public.admin_notifications
      ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_brand_projects_updated_at'
  ) THEN
    CREATE TRIGGER set_brand_projects_updated_at
      BEFORE UPDATE ON public.brand_projects
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_org_role_templates_updated_at'
  ) THEN
    CREATE TRIGGER set_org_role_templates_updated_at
      BEFORE UPDATE ON public.org_role_templates
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_context_last_used_updated_at'
  ) THEN
    CREATE TRIGGER set_context_last_used_updated_at
      BEFORE UPDATE ON public.context_last_used
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;
