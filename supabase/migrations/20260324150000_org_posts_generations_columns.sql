ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS brand_project_id uuid REFERENCES public.brand_projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pipeline_item_id uuid REFERENCES public.pipeline_items(id) ON DELETE SET NULL;

ALTER TABLE public.generations
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS brand_project_id uuid REFERENCES public.brand_projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posts_org
  ON public.posts(organization_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_project
  ON public.posts(brand_project_id)
  WHERE brand_project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_pipeline_item
  ON public.posts(pipeline_item_id)
  WHERE pipeline_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generations_org
  ON public.generations(organization_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generations_project
  ON public.generations(brand_project_id)
  WHERE brand_project_id IS NOT NULL;
