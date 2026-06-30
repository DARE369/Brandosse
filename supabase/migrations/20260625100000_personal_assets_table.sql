-- ============================================================================
-- Migration: personal_assets_table
-- Packet 2 (Personal Content Library) — Phase 3, feature-data-layer-builder
--
-- Introduces public.personal_assets: the personal-workspace asset table
-- LIBRARY_SPEC.md §2.1 describes (called "assets" in the spec; named
-- personal_assets here for symmetry with the existing org_asset_library
-- table — see DECISIONS_LOG.md 2026-06-25T10:15:00).
--
-- Architectural decision (see DECISIONS_LOG.md 2026-06-25T10:05:00 for full
-- reasoning): this table holds a REAL ROW for every source (upload /
-- generation / post), not just uploads. Rows for source='generation' and
-- source='post' are populated and kept current by the additive triggers
-- below, which run ALONGSIDE the existing, untouched
-- ensureLibraryRowsForPosts() (src/services/contentLibraryService.js) and
-- its own create_library_item_from_post/create_library_item_from_media
-- triggers (20260227090000_calendar_library_alignment.sql) — never calling,
-- modifying, or replacing them. content_library_items is left completely
-- untouched by this migration: no ALTER, no new FK into it, no read from it.
--
-- Per LIBRARY_SPEC.md §2.2/§3: no folder columns, no approval-substate
-- columns — personal has neither.
-- ============================================================================

-- -- Table ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.personal_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope — identical convention to every other personal-scoped table
  -- (PERSONAL_WORKSPACE_SPEC.md §1): user_id ownership, organization_id
  -- always NULL. This is an explicit, enforced CHECK (not just a default)
  -- specifically to close the cross-contamination gap AS_IS_AUDIT.md §0/§7.1
  -- flagged for content_library_items (an org-scope draft silently leaving
  -- a stray personal-scoped junction row) — that gap is NOT replicated here.
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid,

  -- Source taxonomy (LIBRARY_SPEC.md §1) — one unified collection, not
  -- separate tables/tabs per source.
  source text NOT NULL CHECK (source IN ('upload', 'generation', 'post')),
  generation_id uuid REFERENCES public.generations(id) ON DELETE SET NULL,
  post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,

  -- Descriptive metadata (§2.1)
  title text,
  description text,
  alt_text text,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  ai_tags text[] NOT NULL DEFAULT '{}'::text[],
  ai_tagging_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (ai_tagging_status IN ('not_applicable', 'pending', 'done', 'failed')),

  -- Technical metadata
  media_type text CHECK (media_type IS NULL OR media_type IN ('image', 'video', 'document')),
  mime_type text,
  file_size_bytes bigint,
  dimensions jsonb,
  duration_seconds numeric,
  format text,

  -- Storage plumbing + misc — same low-risk jsonb catch-all pattern
  -- org_asset_library already uses (RESEARCH.md §3.1).
  storage_bucket text,
  storage_path text,
  file_url text,
  thumbnail_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Duplicate detection (RESEARCH.md §2/§3 — two-tier, client-computed,
  -- stored here for server-side comparison at upload time)
  checksum text,
  perceptual_hash text,

  -- Administrative (§2.1) — no approval-substate fields; personal has none.
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'trashed')),
  deleted_at timestamptz,
  used_in_post_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  superseded_by_asset_id uuid REFERENCES public.personal_assets(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- generation/post-sourced rows must carry their provenance FK; upload rows
  -- must not claim one. Mirrors content_library_items' own
  -- one-reference-only discipline (calendar_library_alignment.sql:117-121),
  -- adapted to this table's source enum instead of a 3-way FK check.
  CONSTRAINT personal_assets_source_fk_matches CHECK (
    (source = 'upload' AND generation_id IS NULL AND post_id IS NULL)
    OR (source = 'generation' AND generation_id IS NOT NULL)
    OR (source = 'post' AND post_id IS NOT NULL)
  )
);

COMMENT ON TABLE public.personal_assets IS
  'Personal-workspace unified asset library (LIBRARY_SPEC.md §2.1). Holds a real row per source (upload/generation/post) — see docs/calendar-library-rebuild/packet-2-personal-library/DECISIONS_LOG.md for why. Populated for uploads via the personal-asset-upload edge function; for generation/post sources via the triggers below, additively, alongside (never replacing) ensureLibraryRowsForPosts()/content_library_items.';

-- -- Indexes ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_personal_assets_user
  ON public.personal_assets(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_personal_assets_source
  ON public.personal_assets(user_id, source);

CREATE INDEX IF NOT EXISTS idx_personal_assets_checksum
  ON public.personal_assets(user_id, checksum)
  WHERE checksum IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_personal_assets_perceptual_hash
  ON public.personal_assets(user_id, perceptual_hash)
  WHERE perceptual_hash IS NOT NULL;

-- GIN index on used_in_post_ids — supports both the "unused" filter
-- (cardinality = 0) and "is post X referenced by any asset" lookups.
CREATE INDEX IF NOT EXISTS idx_personal_assets_used_in_post_ids
  ON public.personal_assets USING GIN (used_in_post_ids);

CREATE INDEX IF NOT EXISTS idx_personal_assets_generation
  ON public.personal_assets(generation_id)
  WHERE generation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_personal_assets_post
  ON public.personal_assets(post_id)
  WHERE post_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_personal_assets_superseded_by
  ON public.personal_assets(superseded_by_asset_id)
  WHERE superseded_by_asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_personal_assets_tags
  ON public.personal_assets USING GIN (tags);

-- Partial unique indexes — these are what every "ON CONFLICT DO NOTHING"
-- insert below (in the sync trigger and in the one-time backfill) actually
-- conflicts against. One row per (user, generation) for generation-sourced
-- rows; one row per post for post-sourced rows. Upload-sourced rows have no
-- such natural key and are never subject to this constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uq_personal_assets_user_generation
  ON public.personal_assets(user_id, generation_id)
  WHERE source = 'generation' AND generation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_personal_assets_post
  ON public.personal_assets(post_id)
  WHERE source = 'post' AND post_id IS NOT NULL;

-- -- updated_at trigger — reuses the existing shared function verbatim ---------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_personal_assets_updated_at'
  ) THEN
    CREATE TRIGGER set_personal_assets_updated_at
      BEFORE UPDATE ON public.personal_assets
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

-- -- RLS --------------------------------------------------------------------------
-- Simple user_id = auth.uid() ownership, identical convention to
-- media_assets/content_library_items (RESEARCH.md §3.3 — personal has no
-- permission-tiering system to gate against, unlike org_asset_library's
-- get_member_permission()-gated policies).
ALTER TABLE public.personal_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own personal assets" ON public.personal_assets;
CREATE POLICY "Users manage own personal assets"
  ON public.personal_assets FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- Sync triggers — additive, personal-scope-only population for
-- source='generation' / source='post' rows. Never touches
-- content_library_items, ensureLibraryRowsForPosts(), or its triggers.
-- Fires only when posts.organization_id IS NULL (personal-scope posts),
-- closing the cross-contamination gap content_library_items has today
-- (AS_IS_AUDIT.md §0/§7.1) rather than replicating it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_personal_asset_from_post()
RETURNS trigger AS $$
DECLARE
  v_existing_id uuid;
BEGIN
  -- Only personal-scope posts populate personal_assets. Org-scope posts are
  -- Packet 4's (org asset library's) territory — not this table's.
  IF NEW.organization_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.generation_id IS NOT NULL THEN
    -- One personal_assets row per (user, generation) — a reused generation
    -- across multiple posts/drafts gets exactly one Library card, with
    -- used_in_post_ids accumulating every post that referenced it (mockup
    -- Card 2, "Launch announcement render", used x3).
    SELECT id INTO v_existing_id
    FROM public.personal_assets
    WHERE user_id = NEW.user_id AND generation_id = NEW.generation_id
    LIMIT 1;

    IF v_existing_id IS NULL THEN
      INSERT INTO public.personal_assets (
        user_id, source, generation_id, post_id, title, status,
        used_in_post_ids, ai_tagging_status, created_at
      )
      VALUES (
        NEW.user_id, 'generation', NEW.generation_id, NULL,
        NEW.title, 'active',
        CASE WHEN NEW.id IS NOT NULL THEN ARRAY[NEW.id]::uuid[] ELSE '{}'::uuid[] END,
        'not_applicable', COALESCE(NEW.created_at, now())
      )
      ON CONFLICT DO NOTHING;
    ELSIF NEW.id IS NOT NULL THEN
      UPDATE public.personal_assets
      SET used_in_post_ids = (
        SELECT ARRAY(SELECT DISTINCT unnest(used_in_post_ids || ARRAY[NEW.id]::uuid[]))
      )
      WHERE id = v_existing_id
        AND NOT (used_in_post_ids @> ARRAY[NEW.id]::uuid[]);
    END IF;

  ELSE
    -- No generation_id: a pure Quick-Post-with-no-asset. One personal_assets
    -- row per post, one-to-one (post-linked source, LIBRARY_SPEC.md §1.3).
    INSERT INTO public.personal_assets (
      user_id, source, generation_id, post_id, title, status,
      used_in_post_ids, ai_tagging_status, created_at
    )
    VALUES (
      NEW.user_id, 'post', NULL, NEW.id,
      NEW.title, 'active',
      ARRAY[NEW.id]::uuid[],
      'not_applicable', COALESCE(NEW.created_at, now())
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.sync_personal_asset_from_post() IS
  'Additive personal_assets sync, parallel to (never replacing) ensureLibraryRowsForPosts()/create_library_item_from_post. Personal-scope only (organization_id IS NULL).';

DROP TRIGGER IF EXISTS personal_asset_after_post_insert ON public.posts;
CREATE TRIGGER personal_asset_after_post_insert
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_personal_asset_from_post();

DROP TRIGGER IF EXISTS personal_asset_after_post_update ON public.posts;
CREATE TRIGGER personal_asset_after_post_update
  AFTER UPDATE OF generation_id ON public.posts
  FOR EACH ROW
  WHEN (NEW.generation_id IS DISTINCT FROM OLD.generation_id)
  EXECUTE FUNCTION public.sync_personal_asset_from_post();

-- One-time backfill for existing personal-scope posts, mirroring the
-- existing backfill pattern used for content_library_items
-- (20260227090000_calendar_library_alignment.sql:278-289).
INSERT INTO public.personal_assets (user_id, source, generation_id, post_id, title, status, used_in_post_ids, ai_tagging_status, created_at)
SELECT DISTINCT ON (p.user_id, p.generation_id)
  p.user_id, 'generation', p.generation_id, NULL, p.title, 'active', '{}'::uuid[], 'not_applicable', COALESCE(p.created_at, now())
FROM public.posts p
WHERE p.organization_id IS NULL
  AND p.user_id IS NOT NULL
  AND p.generation_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Backfill used_in_post_ids for the generation-sourced rows just created/
-- already existing, from every personal-scope post that references them.
UPDATE public.personal_assets pa
SET used_in_post_ids = (
  SELECT COALESCE(ARRAY_AGG(DISTINCT p.id), '{}'::uuid[])
  FROM public.posts p
  WHERE p.organization_id IS NULL
    AND p.generation_id = pa.generation_id
    AND p.user_id = pa.user_id
)
WHERE pa.source = 'generation';

INSERT INTO public.personal_assets (user_id, source, generation_id, post_id, title, status, used_in_post_ids, ai_tagging_status, created_at)
SELECT p.user_id, 'post', NULL, p.id, p.title, 'active', ARRAY[p.id]::uuid[], 'not_applicable', COALESCE(p.created_at, now())
FROM public.posts p
LEFT JOIN public.personal_assets pa ON pa.post_id = p.id
WHERE p.organization_id IS NULL
  AND p.user_id IS NOT NULL
  AND p.generation_id IS NULL
  AND pa.id IS NULL
ON CONFLICT DO NOTHING;
