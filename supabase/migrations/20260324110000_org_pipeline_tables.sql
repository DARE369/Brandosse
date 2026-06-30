CREATE TABLE IF NOT EXISTS public.pipeline_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  brand_project_id uuid REFERENCES public.brand_projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_default boolean NOT NULL DEFAULT false,
  template_key text,
  stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_configs_org
  ON public.pipeline_configs(organization_id, is_active);

CREATE INDEX IF NOT EXISTS idx_pipeline_configs_project
  ON public.pipeline_configs(brand_project_id);

CREATE TABLE IF NOT EXISTS public.pipeline_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  brand_project_id uuid NOT NULL REFERENCES public.brand_projects(id) ON DELETE CASCADE,
  pipeline_config_id uuid NOT NULL REFERENCES public.pipeline_configs(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  generation_id uuid REFERENCES public.generations(id) ON DELETE SET NULL,
  submitted_by uuid NOT NULL REFERENCES auth.users(id),
  current_stage_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'in_review',
      'revision_requested',
      'approved',
      'rejected',
      'withdrawn',
      'scheduled',
      'published'
    )),
  title text,
  platform text,
  scheduled_for timestamptz,
  submission_note text,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_assignee_role text,
  current_assignee_user_id uuid REFERENCES auth.users(id),
  sla_deadline timestamptz,
  client_review_token uuid,
  client_review_token_expires_at timestamptz,
  client_review_token_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_items_org
  ON public.pipeline_items(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_pipeline_items_project
  ON public.pipeline_items(brand_project_id, status);

CREATE INDEX IF NOT EXISTS idx_pipeline_items_assignee_role
  ON public.pipeline_items(organization_id, current_assignee_role, status);

CREATE INDEX IF NOT EXISTS idx_pipeline_items_assignee_user
  ON public.pipeline_items(current_assignee_user_id, status);

CREATE INDEX IF NOT EXISTS idx_pipeline_items_submitter
  ON public.pipeline_items(submitted_by, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_items_client_token
  ON public.pipeline_items(client_review_token)
  WHERE client_review_token IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_pipeline_configs_updated_at'
  ) THEN
    CREATE TRIGGER set_pipeline_configs_updated_at
      BEFORE UPDATE ON public.pipeline_configs
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_pipeline_items_updated_at'
  ) THEN
    CREATE TRIGGER set_pipeline_items_updated_at
      BEFORE UPDATE ON public.pipeline_items
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;
