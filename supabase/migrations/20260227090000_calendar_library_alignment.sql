-- ============================================================================
-- Migration: calendar_library_alignment_v1
-- Purpose:
--   1) Add missing library tables (media_assets, content_templates, content_library_items)
--   2) Align posts lifecycle fields and guard terminal statuses
--   3) Keep calendar/library relationships consistent via triggers + backfill
-- ============================================================================

-- -- Posts alignment ----------------------------------------------------------
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS hashtags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'content_pillars'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'posts'
      AND column_name = 'content_pillar_id'
  ) THEN
    ALTER TABLE public.posts
      ADD COLUMN content_pillar_id uuid REFERENCES public.content_pillars(id) ON DELETE SET NULL;
  END IF;
END
$$;

-- -- Media assets -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'generated_assets',
  public_url text,
  file_name text NOT NULL,
  file_type text NOT NULL,
  mime_type text,
  file_size_bytes bigint,
  duration_seconds numeric,
  width integer,
  height integer,
  aspect_ratio text,
  thumbnail_url text,
  source text NOT NULL DEFAULT 'upload',
  content_pillar_id uuid REFERENCES public.content_pillars(id) ON DELETE SET NULL,
  platform_targets text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- -- Content templates --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  caption_format text,
  default_hashtags text[] DEFAULT '{}',
  content_pillar_id uuid REFERENCES public.content_pillars(id) ON DELETE SET NULL,
  default_platform text,
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- -- Library items ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  media_asset_id uuid REFERENCES public.media_assets(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.content_templates(id) ON DELETE CASCADE,
  item_type text NOT NULL,
  tags text[] DEFAULT '{}',
  is_favorite boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Normalize FK delete behavior for pre-existing schemas where these were created
-- without ON DELETE CASCADE.
ALTER TABLE public.content_library_items
  DROP CONSTRAINT IF EXISTS content_library_items_post_id_fkey;
ALTER TABLE public.content_library_items
  ADD CONSTRAINT content_library_items_post_id_fkey
  FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;

ALTER TABLE public.content_library_items
  DROP CONSTRAINT IF EXISTS content_library_items_media_asset_id_fkey;
ALTER TABLE public.content_library_items
  ADD CONSTRAINT content_library_items_media_asset_id_fkey
  FOREIGN KEY (media_asset_id) REFERENCES public.media_assets(id) ON DELETE CASCADE;

ALTER TABLE public.content_library_items
  DROP CONSTRAINT IF EXISTS content_library_items_template_id_fkey;
ALTER TABLE public.content_library_items
  ADD CONSTRAINT content_library_items_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES public.content_templates(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'content_library_items_one_reference_only'
  ) THEN
    ALTER TABLE public.content_library_items
      ADD CONSTRAINT content_library_items_one_reference_only CHECK (
        (post_id IS NOT NULL)::int +
        (media_asset_id IS NOT NULL)::int +
        (template_id IS NOT NULL)::int = 1
      );
  END IF;
END
$$;

-- -- RLS policies -------------------------------------------------------------
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_library_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own media assets" ON public.media_assets;
CREATE POLICY "Users manage own media assets"
  ON public.media_assets FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own content templates" ON public.content_templates;
CREATE POLICY "Users manage own content templates"
  ON public.content_templates FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own content library items" ON public.content_library_items;
CREATE POLICY "Users manage own content library items"
  ON public.content_library_items FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- -- Indexes -----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_posts_user_status
  ON public.posts(user_id, status);

CREATE INDEX IF NOT EXISTS idx_posts_user_scheduled
  ON public.posts(user_id, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_posts_user_platform
  ON public.posts(user_id, platform);

CREATE INDEX IF NOT EXISTS idx_media_user_type
  ON public.media_assets(user_id, file_type);

CREATE INDEX IF NOT EXISTS idx_media_user_created
  ON public.media_assets(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_library_user_type
  ON public.content_library_items(user_id, item_type);

CREATE UNIQUE INDEX IF NOT EXISTS idx_library_unique_post
  ON public.content_library_items(post_id)
  WHERE post_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_library_unique_media
  ON public.content_library_items(media_asset_id)
  WHERE media_asset_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_library_unique_template
  ON public.content_library_items(template_id)
  WHERE template_id IS NOT NULL;

-- -- Core FK integrity corrections -------------------------------------------
-- profiles.id should be tied to auth.users(id) to avoid orphan profiles.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_id_fkey'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_id_fkey
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
END
$$;

-- platform_analytics should not block post deletion.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'platform_analytics'
  ) THEN
    ALTER TABLE public.platform_analytics
      DROP CONSTRAINT IF EXISTS platform_analytics_post_id_fkey;
    ALTER TABLE public.platform_analytics
      ADD CONSTRAINT platform_analytics_post_id_fkey
      FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE SET NULL;
  END IF;
END
$$;

-- -- Lifecycle guard trigger --------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_terminal_posts()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('published', 'publishing') THEN
    NEW.is_locked := true;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.status IN ('published', 'publishing')
    AND NEW.status NOT IN ('published', 'publishing', 'failed') THEN
    RAISE EXCEPTION 'Cannot change status of a published or publishing post. Create a new post instead.';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_post_lifecycle ON public.posts;
CREATE TRIGGER enforce_post_lifecycle
  BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_terminal_posts();

-- -- Library sync triggers ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_library_item_from_post()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.content_library_items (user_id, post_id, item_type, created_at)
  VALUES (NEW.user_id, NEW.id, 'post', COALESCE(NEW.created_at, now()))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.create_library_item_from_media()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.content_library_items (user_id, media_asset_id, item_type, created_at)
  VALUES (NEW.user_id, NEW.id, 'media', COALESCE(NEW.created_at, now()))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS library_item_after_post_insert ON public.posts;
CREATE TRIGGER library_item_after_post_insert
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.create_library_item_from_post();

DROP TRIGGER IF EXISTS library_item_after_media_insert ON public.media_assets;
CREATE TRIGGER library_item_after_media_insert
  AFTER INSERT ON public.media_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.create_library_item_from_media();

-- Backfill existing data once.
INSERT INTO public.content_library_items (user_id, post_id, item_type, created_at)
SELECT p.user_id, p.id, 'post', COALESCE(p.created_at, now())
FROM public.posts p
LEFT JOIN public.content_library_items li ON li.post_id = p.id
WHERE li.id IS NULL;

INSERT INTO public.content_library_items (user_id, media_asset_id, item_type, created_at)
SELECT m.user_id, m.id, 'media', COALESCE(m.created_at, now())
FROM public.media_assets m
LEFT JOIN public.content_library_items li ON li.media_asset_id = m.id
WHERE li.id IS NULL;

-- -- RPC helper used by CalendarStore ----------------------------------------
CREATE OR REPLACE FUNCTION public.get_best_posting_time(
  p_user_id uuid,
  p_platform text,
  p_target_date date
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  chosen_hour integer;
  target_ts timestamptz;
BEGIN
  chosen_hour := CASE lower(coalesce(p_platform, ''))
    WHEN 'tiktok' THEN 16
    WHEN 'youtube' THEN 15
    WHEN 'facebook' THEN 8
    WHEN 'x' THEN 9
    WHEN 'instagram' THEN 15
    WHEN 'linkedin' THEN 10
    ELSE 14
  END;

  target_ts := make_timestamptz(
    EXTRACT(YEAR FROM p_target_date)::int,
    EXTRACT(MONTH FROM p_target_date)::int,
    EXTRACT(DAY FROM p_target_date)::int,
    chosen_hour,
    0,
    0,
    'UTC'
  );

  RETURN target_ts;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_best_posting_time(uuid, text, date) TO authenticated;
