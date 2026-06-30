CREATE TABLE IF NOT EXISTS public.org_asset_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  brand_project_id uuid REFERENCES public.brand_projects(id) ON DELETE CASCADE,
  asset_level text NOT NULL DEFAULT 'project'
    CHECK (asset_level IN ('agency', 'brand', 'project')),
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  name text NOT NULL,
  description text,
  file_url text NOT NULL,
  thumbnail_url text,
  file_type text NOT NULL
    CHECK (file_type IN ('image', 'video', 'document', 'template', 'prompt_template')),
  mime_type text,
  file_size_bytes integer,
  dimensions jsonb,
  tags text[] DEFAULT '{}'::text[],
  folder_path text DEFAULT '/',
  approval_status text NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  is_brand_asset boolean NOT NULL DEFAULT false,
  usage_count integer NOT NULL DEFAULT 0,
  versions jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_version integer NOT NULL DEFAULT 1,
  is_archived boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_assets_org
  ON public.org_asset_library(organization_id, is_archived);

CREATE INDEX IF NOT EXISTS idx_org_assets_project
  ON public.org_asset_library(brand_project_id, approval_status);

CREATE INDEX IF NOT EXISTS idx_org_assets_type
  ON public.org_asset_library(organization_id, file_type);

CREATE INDEX IF NOT EXISTS idx_org_assets_brand
  ON public.org_asset_library(organization_id, is_brand_asset)
  WHERE is_brand_asset = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_org_asset_library_updated_at'
  ) THEN
    CREATE TRIGGER set_org_asset_library_updated_at
      BEFORE UPDATE ON public.org_asset_library
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;
