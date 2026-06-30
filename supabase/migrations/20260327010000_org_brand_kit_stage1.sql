CREATE TABLE IF NOT EXISTS public.org_brand_kits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  brand_project_id uuid NOT NULL REFERENCES public.brand_projects(id) ON DELETE CASCADE,
  brand_name text NOT NULL,
  tagline text,
  voice_description text,
  tone_descriptors text[] NOT NULL DEFAULT '{}'::text[],
  content_pillars text[] NOT NULL DEFAULT '{}'::text[],
  target_audience text,
  banned_phrases text[] NOT NULL DEFAULT '{}'::text[],
  approved_hashtag_sets jsonb NOT NULL DEFAULT '[]'::jsonb,
  prompt_prefix text,
  prompt_guidelines text,
  ai_system_prompt text,
  primary_logo_asset_id uuid REFERENCES public.org_asset_library(id) ON DELETE SET NULL,
  secondary_logo_asset_id uuid REFERENCES public.org_asset_library(id) ON DELETE SET NULL,
  color_palette jsonb NOT NULL DEFAULT '[]'::jsonb,
  typography_notes text,
  visual_style_notes text,
  completeness_score integer NOT NULL DEFAULT 0,
  last_edited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_brand_kits_project_unique UNIQUE (brand_project_id)
);

CREATE INDEX IF NOT EXISTS idx_org_brand_kits_org
  ON public.org_brand_kits(organization_id);

CREATE INDEX IF NOT EXISTS idx_org_brand_kits_project
  ON public.org_brand_kits(brand_project_id);

CREATE TABLE IF NOT EXISTS public.org_brand_kit_editors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_kit_id uuid NOT NULL REFERENCES public.org_brand_kits(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_brand_kit_editors_unique UNIQUE (brand_kit_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_brand_kit_editors_kit
  ON public.org_brand_kit_editors(brand_kit_id);

CREATE INDEX IF NOT EXISTS idx_org_brand_kit_editors_user
  ON public.org_brand_kit_editors(user_id);

CREATE OR REPLACE FUNCTION public.build_org_brand_kit_ai_prompt(
  p_brand_name text,
  p_prompt_prefix text,
  p_voice_description text,
  p_tone_descriptors text[],
  p_content_pillars text[],
  p_target_audience text,
  p_prompt_guidelines text,
  p_banned_phrases text[]
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_parts text[] := ARRAY[]::text[];
  v_tones text := NULL;
  v_pillars text := NULL;
  v_banned text := NULL;
BEGIN
  v_tones := array_to_string(COALESCE(p_tone_descriptors, '{}'::text[]), ', ');
  v_pillars := array_to_string(COALESCE(p_content_pillars, '{}'::text[]), ', ');
  v_banned := array_to_string(COALESCE(p_banned_phrases, '{}'::text[]), ', ');

  v_parts := array_append(v_parts, format('You are generating content for %s.', COALESCE(NULLIF(trim(p_brand_name), ''), 'this brand')));

  IF NULLIF(trim(COALESCE(p_prompt_prefix, '')), '') IS NOT NULL THEN
    v_parts := array_append(v_parts, trim(p_prompt_prefix));
  END IF;

  IF NULLIF(trim(COALESCE(p_voice_description, '')), '') IS NOT NULL THEN
    v_parts := array_append(v_parts, format('Brand voice: %s.', trim(p_voice_description)));
  END IF;

  IF NULLIF(trim(COALESCE(v_tones, '')), '') IS NOT NULL THEN
    v_parts := array_append(v_parts, format('Tone descriptors: %s.', trim(v_tones)));
  END IF;

  IF NULLIF(trim(COALESCE(v_pillars, '')), '') IS NOT NULL THEN
    v_parts := array_append(v_parts, format('Content pillars: %s.', trim(v_pillars)));
  END IF;

  IF NULLIF(trim(COALESCE(p_target_audience, '')), '') IS NOT NULL THEN
    v_parts := array_append(v_parts, format('Target audience: %s.', trim(p_target_audience)));
  END IF;

  IF NULLIF(trim(COALESCE(p_prompt_guidelines, '')), '') IS NOT NULL THEN
    v_parts := array_append(v_parts, format('Generation guidelines: %s.', trim(p_prompt_guidelines)));
  END IF;

  IF NULLIF(trim(COALESCE(v_banned, '')), '') IS NOT NULL THEN
    v_parts := array_append(v_parts, format('Avoid these phrases: %s.', trim(v_banned)));
  END IF;

  RETURN array_to_string(v_parts, ' ');
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_org_brand_kit_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_score integer := 0;
BEGIN
  IF NULLIF(trim(COALESCE(NEW.brand_name, '')), '') IS NOT NULL THEN v_score := v_score + 10; END IF;
  IF NULLIF(trim(COALESCE(NEW.voice_description, '')), '') IS NOT NULL THEN v_score := v_score + 15; END IF;
  IF COALESCE(array_length(NEW.tone_descriptors, 1), 0) > 0 THEN v_score := v_score + 10; END IF;
  IF COALESCE(array_length(NEW.content_pillars, 1), 0) > 0 THEN v_score := v_score + 15; END IF;
  IF NULLIF(trim(COALESCE(NEW.target_audience, '')), '') IS NOT NULL THEN v_score := v_score + 10; END IF;
  IF NULLIF(trim(COALESCE(NEW.prompt_prefix, '')), '') IS NOT NULL THEN v_score := v_score + 10; END IF;
  IF NULLIF(trim(COALESCE(NEW.prompt_guidelines, '')), '') IS NOT NULL THEN v_score := v_score + 10; END IF;
  IF NEW.primary_logo_asset_id IS NOT NULL THEN v_score := v_score + 10; END IF;
  IF COALESCE(jsonb_array_length(NEW.color_palette), 0) > 0 THEN v_score := v_score + 10; END IF;

  NEW.completeness_score := LEAST(v_score, 100);
  NEW.ai_system_prompt := public.build_org_brand_kit_ai_prompt(
    NEW.brand_name,
    NEW.prompt_prefix,
    NEW.voice_description,
    NEW.tone_descriptors,
    NEW.content_pillars,
    NEW.target_audience,
    NEW.prompt_guidelines,
    NEW.banned_phrases
  );
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_org_brand_kits_updated_at'
  ) THEN
    CREATE TRIGGER set_org_brand_kits_updated_at
      BEFORE UPDATE ON public.org_brand_kits
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'compute_org_brand_kit_fields'
  ) THEN
    CREATE TRIGGER compute_org_brand_kit_fields
      BEFORE INSERT OR UPDATE ON public.org_brand_kits
      FOR EACH ROW
      EXECUTE FUNCTION public.compute_org_brand_kit_fields();
  END IF;
END
$$;

INSERT INTO public.org_brand_kits (
  organization_id,
  brand_project_id,
  brand_name,
  voice_description,
  tone_descriptors,
  content_pillars,
  target_audience,
  prompt_prefix,
  prompt_guidelines,
  banned_phrases,
  approved_hashtag_sets,
  created_at,
  updated_at
)
SELECT
  bp.organization_id,
  bp.id,
  COALESCE(NULLIF(trim(bp.name), ''), 'Brand Project'),
  NULLIF(trim(COALESCE(bp.brand_settings->>'voice_description', '')), ''),
  COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(bp.brand_settings->'tone_descriptors', '[]'::jsonb))), '{}'::text[]),
  COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(bp.brand_settings->'content_pillars', '[]'::jsonb))), '{}'::text[]),
  NULLIF(trim(COALESCE(bp.brand_settings->>'target_audience', '')), ''),
  NULLIF(trim(COALESCE(bp.brand_settings->>'prompt_prefix', '')), ''),
  NULLIF(trim(COALESCE(bp.brand_settings->>'prompt_guidelines', '')), ''),
  COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(bp.brand_settings->'banned_phrases', '[]'::jsonb))), '{}'::text[]),
  COALESCE(bp.brand_settings->'approved_hashtag_sets', '[]'::jsonb),
  now(),
  now()
FROM public.brand_projects bp
LEFT JOIN public.org_brand_kits existing
  ON existing.brand_project_id = bp.id
WHERE existing.id IS NULL;

ALTER TABLE public.org_brand_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_brand_kit_editors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_brand_kit_member_read ON public.org_brand_kits;
CREATE POLICY org_brand_kit_member_read
  ON public.org_brand_kits
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = org_brand_kits.organization_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS org_brand_kit_admin_manage ON public.org_brand_kit_editors;
CREATE POLICY org_brand_kit_admin_manage
  ON public.org_brand_kit_editors
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.org_brand_kits kit
      JOIN public.organization_members om
        ON om.organization_id = kit.organization_id
      WHERE kit.id = org_brand_kit_editors.brand_kit_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
        AND COALESCE(om.org_role_key, om.role) IN ('org_owner', 'org_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.org_brand_kits kit
      JOIN public.organization_members om
        ON om.organization_id = kit.organization_id
      WHERE kit.id = org_brand_kit_editors.brand_kit_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
        AND COALESCE(om.org_role_key, om.role) IN ('org_owner', 'org_admin')
    )
  );

DROP POLICY IF EXISTS org_brand_kit_editor_read_self ON public.org_brand_kit_editors;
CREATE POLICY org_brand_kit_editor_read_self
  ON public.org_brand_kit_editors
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.org_brand_kits kit
      JOIN public.organization_members om
        ON om.organization_id = kit.organization_id
      WHERE kit.id = org_brand_kit_editors.brand_kit_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
        AND COALESCE(om.org_role_key, om.role) IN ('org_owner', 'org_admin')
    )
  );
