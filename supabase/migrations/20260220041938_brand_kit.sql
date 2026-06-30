-- ============================================================
-- Migration: brand_kit_pipeline_v1
-- Run in Supabase SQL Editor
-- ============================================================

-- -- 1. brand_kit ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.brand_kit (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL UNIQUE,           -- ONE per user (enforced by UNIQUE)

  -- Basics
  brand_name            text,
  industry              text,
  tagline               text,
  website_url           text,
  primary_language      text DEFAULT 'en',
  target_audience       text,
  audience_age_range    text,
  audience_locations    text[]  DEFAULT '{}',

  -- Voice
  brand_voice           text,
  tone_descriptors      text[]  DEFAULT '{}',
  writing_style_notes   text,
  signature_phrases     text[]  DEFAULT '{}',
  forbidden_phrases     text[]  DEFAULT '{}',
  emoji_usage           text    DEFAULT 'moderate',
  call_to_action_style  text,

  -- Guardrails
  content_restrictions  text[]  DEFAULT '{}',
  competitor_names      text[]  DEFAULT '{}',
  legal_disclaimers     text,
  brand_safe_only       boolean DEFAULT true,
  min_caption_words     int     DEFAULT 20,
  max_caption_words     int     DEFAULT 300,
  max_hashtags          int     DEFAULT 30,

  -- Visual Style
  visual_style_keywords text[]  DEFAULT '{}',
  color_palette         jsonb   DEFAULT '[]',
  typography_notes      text,
  photo_style_notes     text,
  avoid_visual_elements text[]  DEFAULT '{}',

  -- Platform preferences
  platform_preferences  jsonb   DEFAULT '{}',

  -- Metadata
  setup_completed       boolean DEFAULT false,
  setup_skipped         boolean DEFAULT false,
  last_updated_at       timestamp with time zone DEFAULT now(),
  created_at            timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT brand_kit_pkey PRIMARY KEY (id),
  CONSTRAINT brand_kit_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.brand_kit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own brand kit" ON public.brand_kit;
CREATE POLICY "Users manage own brand kit"
  ON public.brand_kit FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- -- 2. brand_assets ------------------------------------------
CREATE TABLE IF NOT EXISTS public.brand_assets (
  id               uuid    NOT NULL DEFAULT gen_random_uuid(),
  user_id          uuid    NOT NULL,
  brand_kit_id     uuid    NOT NULL,

  name             text    NOT NULL,
  asset_type       text    NOT NULL,   -- 'logo'|'font'|'document'|'video'|'image'|'other'
  file_name        text    NOT NULL,
  mime_type        text    NOT NULL,
  file_size_bytes  bigint,

  storage_path     text    NOT NULL,
  public_url       text,

  description      text,
  tags             text[]  DEFAULT '{}',
  usage_hints      text,
  alt_text         text,
  extracted_text   text,
  visual_summary   text,
  color_palette    jsonb   DEFAULT '[]',
  font_family      text,

  status           text    DEFAULT 'ready',
  processing_notes text,

  created_at       timestamp with time zone NOT NULL DEFAULT now(),
  updated_at       timestamp with time zone DEFAULT now(),

  CONSTRAINT brand_assets_pkey PRIMARY KEY (id),
  CONSTRAINT brand_assets_user_id_fkey
    FOREIGN KEY (user_id)      REFERENCES auth.users(id)       ON DELETE CASCADE,
  CONSTRAINT brand_assets_kit_fkey
    FOREIGN KEY (brand_kit_id) REFERENCES public.brand_kit(id) ON DELETE CASCADE
);

ALTER TABLE public.brand_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own brand assets" ON public.brand_assets;
CREATE POLICY "Users manage own brand assets"
  ON public.brand_assets FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS brand_assets_user_id_idx ON public.brand_assets(user_id);
CREATE INDEX IF NOT EXISTS brand_assets_kit_id_idx  ON public.brand_assets(brand_kit_id);
CREATE INDEX IF NOT EXISTS brand_assets_type_idx    ON public.brand_assets(asset_type);

-- -- 3. content_plans -----------------------------------------
CREATE TABLE IF NOT EXISTS public.content_plans (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  session_id         uuid,
  batch_id           uuid,

  raw_user_input     text NOT NULL,
  intent_summary     text,
  content_plan       jsonb NOT NULL,
  groq_model         text,
  groq_tokens_used   int,
  quality_gate_pass  boolean DEFAULT true,
  quality_gate_notes text,

  created_at         timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT content_plans_pkey PRIMARY KEY (id),
  CONSTRAINT content_plans_user_id_fkey
    FOREIGN KEY (user_id)    REFERENCES auth.users(id)      ON DELETE CASCADE,
  CONSTRAINT content_plans_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.sessions(id) DEFERRABLE
  -- NOTE: batch_id FK to generations added AFTER generations columns are altered (step 4)
);

ALTER TABLE public.content_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own content plans" ON public.content_plans;
CREATE POLICY "Users read own content plans"
  ON public.content_plans FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS content_plans_batch_id_idx ON public.content_plans(batch_id);

-- -- 4. Alter generations --------------------------------------
ALTER TABLE public.generations
  ADD COLUMN IF NOT EXISTS content_plan_id      uuid    REFERENCES public.content_plans(id),
  ADD COLUMN IF NOT EXISTS carousel_slide_index int     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS carousel_slide_total int     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS slide_prompt         text    DEFAULT NULL;

CREATE INDEX IF NOT EXISTS generations_content_plan_id_idx
  ON public.generations(content_plan_id);

-- -- 5. Storage bucket (manual - see Manual Steps section) -----
-- CREATE the 'brand_assets' bucket via Supabase Dashboard:
--   Storage - New Bucket
--   Name: brand_assets
--   Public: NO (private)
--   File size limit: 52428800 (50 MB)
--   Allowed MIME types: image/png, image/jpeg, image/webp, image/svg+xml, image/gif,
--     application/pdf, application/msword,
--     application/vnd.openxmlformats-officedocument.wordprocessingml.document,
--     text/plain, text/markdown, font/ttf, font/otf, video/mp4, video/webm
--
-- Then add storage RLS policy:
-- INSERT policy: auth.uid()::text = (storage.foldername(name))[1]
-- SELECT policy: auth.uid()::text = (storage.foldername(name))[1]
-- DELETE policy: auth.uid()::text = (storage.foldername(name))[1]
--
-- Path convention: {user_id}/{asset_type}/{timestamp}_{filename}

-- -- End of migration ------------------------------------------
