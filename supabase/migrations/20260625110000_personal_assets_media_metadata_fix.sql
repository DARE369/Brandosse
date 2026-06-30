-- ============================================================================
-- Migration: personal_assets_media_metadata_fix
-- Packet 2 (Personal Content Library) — Phase 3 bugfix round, feature-data-layer-builder
--
-- Bug being fixed (reported by the human against the live, shipped build,
-- with screenshots): every Library card shows "Untitled asset" and a
-- generic file icon instead of a real thumbnail, plus a literal "FILE
-- used ×1" label.
--
-- Root cause (confirmed by reading 20260625100000_personal_assets_table.sql
-- in full and cross-checking the live database directly with the service
-- role key): sync_personal_asset_from_post() and that migration's two
-- one-time backfill INSERT/UPDATE statements only ever populate
-- user_id, source, generation_id, post_id, title, status, used_in_post_ids,
-- ai_tagging_status, created_at from public.posts. They never join
-- public.generations, so every source='generation' row (101 of 158 live
-- rows at the time of this fix) has NULL in thumbnail_url, file_url,
-- media_type, format, mime_type, file_size_bytes, duration_seconds, and
-- dimensions — which is exactly why
-- src/pages/LibraryPage/libraryItemUtils.js's getFormatLabel() falls all
-- the way through to its literal 'FILE' fallback (asset.format,
-- asset.mime_type, and asset.media_type are all NULL), and why
-- LibraryCard.jsx's AssetMedia component's
-- hasPreview = Boolean(asset.thumbnail_url && !failed) is false for every
-- one of those rows. Separately, 106 of 158 rows have NULL title because
-- the original migration only ever read posts.title (frequently NULL/empty
-- for historical rows), never posts.caption or generations.prompt as a
-- fallback.
--
-- What was introspected on the live schema before writing this fix
-- (service-role read-only queries — see DECISIONS_LOG.md for the full
-- record):
--   * public.generations has NO thumbnail_url column, NO format/mime_type
--     column, NO file_size_bytes column, NO duration_seconds column, and NO
--     dimensions column. Its real column set is: id, user_id, message_id,
--     storage_path, media_type, prompt, metadata (jsonb), parent_generation_id,
--     root_generation_id, iteration_index, status, progress, cost,
--     created_at, updated_at, session_id, batch_id, batch_index,
--     content_plan_id, carousel_slide_index, carousel_slide_total,
--     slide_prompt, organization_id, brand_project_id.
--   * generations.storage_path IS the canonical media URL for both images
--     and videos (confirmed directly in live data — values range from full
--     Supabase Storage public URLs to external pollinations.ai/placehold.co
--     URLs) — and is used as the media URL everywhere in the app already
--     (src/stores/SessionStore.js:2683 `mediaUrl: selectedGeneration.storage_path`).
--     There is no separate generation-level thumbnail anywhere in the
--     product today; for images, storage_path doubles as both the file URL
--     and the thumbnail URL. For videos there is no separate thumbnail
--     either — LibraryCard.jsx's AssetMedia already falls back to
--     `asset.thumbnail_url || asset.file_url` for its <video src>, so
--     leaving thumbnail_url NULL and populating file_url for video rows is
--     sufficient and matches existing frontend behavior exactly.
--   * generations.metadata (jsonb) inconsistently carries width/height
--     (present on ~37% of sampled rows, consistently named "width"/"height"
--     when present) and occasionally "duration" (rare — ~3% of sampled
--     rows). metadata.format, when present, is the literal string "image"
--     (the broad media kind, not a file extension or MIME type) and is NOT
--     usable as this table's `format` column — using it would just move the
--     'FILE' bug to a different wrong fallback. Best-effort dimensions/
--     duration extraction from metadata is included below since the data
--     costs nothing to pull when present; format is instead derived from
--     storage_path's URL path extension, the same convention
--     getFormatLabel() already uses as its mime-subtype tier, and the same
--     spirit as personal-asset-upload/index.ts's own format-less convention
--     (that function doesn't set `format` either — it relies on mime_type's
--     subtype, which getFormatLabel() already handles as its second tier).
--   * public.posts has NO column other than generation_id that links to any
--     media. Confirmed directly: posts' full column set has no media_asset_id,
--     no attachment reference, nothing. source='post' rows (no
--     generation_id — pure Quick-Posts with no attached asset) genuinely
--     have no media to backfill; this migration does not invent any for
--     them. Their title-fallback chain still benefits from posts.caption,
--     since that's real, frequently-populated, user-facing text
--     (src/stores/SessionStore.js uses posts.caption throughout) that the
--     original migration never considered.
--   * public.media_assets (20260227090000_calendar_library_alignment.sql
--     lines 39-59) has exactly 1 live row, is never referenced by posts (no
--     FK from posts to media_assets exists), and is not in this fix's join
--     path for that reason — there is nothing in posts or generations that
--     ever points at a media_assets row, so joining it here would add
--     complexity with zero matching rows today. Flagged as a non-finding,
--     not skipped by oversight.
--
-- This migration is additive and idempotent:
--   1) Replaces sync_personal_asset_from_post() (CREATE OR REPLACE — same
--      function, same trigger bindings, no DROP) so every future
--      source='generation' row gets real media descriptors via a join to
--      generations, and every future row (both 'generation' and 'post'
--      sources) gets a real title via the fallback chain
--      posts.title -> truncated posts.caption -> truncated
--      generations.prompt -> NULL (libraryItemUtils.js's existing
--      media-type-aware "Untitled video"/"Untitled asset" fallback already
--      handles a NULL title correctly client-side — not touched here).
--   2) Backfills the rows the original migration already inserted (live in
--      the database right now), scoped only to rows where these fields are
--      currently NULL, so this UPDATE is safe to re-run any number of times
--      and will never overwrite a real, already-set value (e.g. a value a
--      user has since edited via the asset detail drawer, or a value an
--      upload-sourced row already has from personal-asset-upload/index.ts).
--
-- No DROP, no destructive ALTER, nothing removed. content_library_items and
-- ensureLibraryRowsForPosts() (src/services/contentLibraryService.js) are
-- not referenced, read, or modified anywhere in this file — same protection
-- as the original migration.
-- ============================================================================

-- -- Updated sync trigger function ------------------------------------------
-- Same signature, same trigger bindings (personal_asset_after_post_insert /
-- personal_asset_after_post_update, both already created by
-- 20260625100000_personal_assets_table.sql and unaffected by this
-- CREATE OR REPLACE). Only the function body changes: the INSERT for
-- source='generation' rows now joins public.generations for media
-- descriptors and a prompt-based title fallback; the INSERT for
-- source='post' rows now uses posts.caption as a title fallback.
CREATE OR REPLACE FUNCTION public.sync_personal_asset_from_post()
RETURNS trigger AS $$
DECLARE
  v_existing_id uuid;
  v_gen RECORD;
  v_title text;
  v_format text;
  v_dimensions jsonb;
  v_duration numeric;
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
      -- Pull the generation's own media descriptors. storage_path is the
      -- canonical media URL for both images and videos (see header comment)
      -- — used as both file_url and (for images only) thumbnail_url.
      -- metadata.width/height feed dimensions when present; metadata.duration
      -- feeds duration_seconds when present. format is derived from the URL
      -- path's file extension, the same tier getFormatLabel() already falls
      -- back to via mime_type subtype — never from metadata.format, which is
      -- just the literal string "image"/"video" and not a real format.
      SELECT
        g.media_type,
        g.storage_path,
        g.prompt,
        g.metadata,
        lower((regexp_match(split_part(g.storage_path, '?', 1), '\.([a-zA-Z0-9]+)$'))[1]) AS ext,
        CASE
          WHEN (g.metadata->>'width') IS NOT NULL AND (g.metadata->>'height') IS NOT NULL THEN
            jsonb_build_object('width', (g.metadata->>'width')::numeric, 'height', (g.metadata->>'height')::numeric)
          ELSE NULL
        END AS dims,
        CASE
          WHEN (g.metadata->>'duration') IS NOT NULL THEN (g.metadata->>'duration')::numeric
          ELSE NULL
        END AS dur
      INTO v_gen
      FROM public.generations g
      WHERE g.id = NEW.generation_id;

      -- Title fallback chain: posts.title -> truncated posts.caption ->
      -- truncated generations.prompt -> NULL (client-side fallback handles
      -- the rest via getItemTitle()'s media-type-aware "Untitled video"/
      -- "Untitled asset" strings — not duplicated here).
      v_title := NULLIF(trim(coalesce(NEW.title, '')), '');
      IF v_title IS NULL THEN
        v_title := NULLIF(trim(coalesce(NEW.caption, '')), '');
        IF v_title IS NOT NULL AND length(v_title) > 80 THEN
          v_title := left(v_title, 80) || '…';
        END IF;
      END IF;
      IF v_title IS NULL AND v_gen.prompt IS NOT NULL THEN
        v_title := NULLIF(trim(v_gen.prompt), '');
        IF v_title IS NOT NULL AND length(v_title) > 80 THEN
          v_title := left(v_title, 80) || '…';
        END IF;
      END IF;

      v_format := v_gen.ext; -- NULL when storage_path has no file extension (e.g. query-string-only provider URLs) — getFormatLabel() already handles a NULL format by falling through to media_type.
      v_dimensions := v_gen.dims;
      v_duration := v_gen.dur;

      INSERT INTO public.personal_assets (
        user_id, source, generation_id, post_id, title, status,
        used_in_post_ids, ai_tagging_status, created_at,
        media_type, format, file_url, thumbnail_url, dimensions, duration_seconds
      )
      VALUES (
        NEW.user_id, 'generation', NEW.generation_id, NULL,
        v_title, 'active',
        CASE WHEN NEW.id IS NOT NULL THEN ARRAY[NEW.id]::uuid[] ELSE '{}'::uuid[] END,
        'not_applicable', COALESCE(NEW.created_at, now()),
        v_gen.media_type,
        v_format,
        v_gen.storage_path,
        CASE WHEN v_gen.media_type = 'image' THEN v_gen.storage_path ELSE NULL END,
        v_dimensions,
        v_duration
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
    -- No media descriptors exist to backfill here (posts has no media
    -- reference column other than generation_id) — only the title fallback
    -- gains posts.caption as a second tier.
    v_title := NULLIF(trim(coalesce(NEW.title, '')), '');
    IF v_title IS NULL THEN
      v_title := NULLIF(trim(coalesce(NEW.caption, '')), '');
      IF v_title IS NOT NULL AND length(v_title) > 80 THEN
        v_title := left(v_title, 80) || '…';
      END IF;
    END IF;

    INSERT INTO public.personal_assets (
      user_id, source, generation_id, post_id, title, status,
      used_in_post_ids, ai_tagging_status, created_at
    )
    VALUES (
      NEW.user_id, 'post', NULL, NEW.id,
      v_title, 'active',
      ARRAY[NEW.id]::uuid[],
      'not_applicable', COALESCE(NEW.created_at, now())
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.sync_personal_asset_from_post() IS
  'Additive personal_assets sync, parallel to (never replacing) ensureLibraryRowsForPosts()/create_library_item_from_post. Personal-scope only (organization_id IS NULL). Fixed 2026-06-25T11:00 to join public.generations for real media descriptors (thumbnail_url/file_url/media_type/format/dimensions/duration_seconds) and to fall back to posts.caption / generations.prompt for title when posts.title is empty — see 20260625110000_personal_assets_media_metadata_fix.sql header for the full root-cause writeup.';

-- ============================================================================
-- Backfill — fixes the rows the original migration already inserted, which
-- are live in the database today. Idempotent: every UPDATE below is scoped
-- with `AND <column> IS NULL`, so re-running this migration any number of
-- times only ever fills genuinely-empty fields and never overwrites a value
-- a user (or the upload edge function) has already set.
-- ============================================================================

-- 1) Media descriptors for existing source='generation' rows whose
--    thumbnail_url/file_url/media_type/format/dimensions/duration_seconds
--    are still NULL — the exact symptom reported (icon fallback + "FILE").
UPDATE public.personal_assets pa
SET
  media_type = COALESCE(pa.media_type, g.media_type),
  format = COALESCE(
    pa.format,
    lower((regexp_match(split_part(g.storage_path, '?', 1), '\.([a-zA-Z0-9]+)$'))[1])
  ),
  file_url = COALESCE(pa.file_url, g.storage_path),
  thumbnail_url = COALESCE(
    pa.thumbnail_url,
    CASE WHEN g.media_type = 'image' THEN g.storage_path ELSE NULL END
  ),
  dimensions = COALESCE(
    pa.dimensions,
    CASE
      WHEN (g.metadata->>'width') IS NOT NULL AND (g.metadata->>'height') IS NOT NULL THEN
        jsonb_build_object('width', (g.metadata->>'width')::numeric, 'height', (g.metadata->>'height')::numeric)
      ELSE NULL
    END
  ),
  duration_seconds = COALESCE(
    pa.duration_seconds,
    CASE WHEN (g.metadata->>'duration') IS NOT NULL THEN (g.metadata->>'duration')::numeric ELSE NULL END
  )
FROM public.generations g
WHERE pa.source = 'generation'
  AND pa.generation_id = g.id
  AND (
    pa.media_type IS NULL
    OR pa.format IS NULL
    OR pa.file_url IS NULL
    OR pa.thumbnail_url IS NULL
    OR pa.dimensions IS NULL
    OR pa.duration_seconds IS NULL
  );

-- 2) Title fallback for existing source='generation' rows whose title is
--    still NULL/empty: try the originating post's caption first (joining
--    back through generation_id, since personal_assets has no FK to a
--    specific post for generation-sourced rows — it can reference several),
--    then the generation's own prompt.
UPDATE public.personal_assets pa
SET title = sub.fallback_title
FROM (
  SELECT
    pa2.id,
    COALESCE(
      (
        SELECT CASE WHEN length(trim(p.caption)) > 80 THEN left(trim(p.caption), 80) || '…' ELSE trim(p.caption) END
        FROM public.posts p
        WHERE p.generation_id = pa2.generation_id
          AND p.organization_id IS NULL
          AND p.caption IS NOT NULL
          AND trim(p.caption) <> ''
        ORDER BY p.created_at ASC
        LIMIT 1
      ),
      (
        SELECT CASE WHEN length(trim(g.prompt)) > 80 THEN left(trim(g.prompt), 80) || '…' ELSE trim(g.prompt) END
        FROM public.generations g
        WHERE g.id = pa2.generation_id
          AND g.prompt IS NOT NULL
          AND trim(g.prompt) <> ''
      )
    ) AS fallback_title
  FROM public.personal_assets pa2
  WHERE pa2.source = 'generation'
    AND (pa2.title IS NULL OR trim(pa2.title) = '')
) sub
WHERE pa.id = sub.id
  AND sub.fallback_title IS NOT NULL
  AND (pa.title IS NULL OR trim(pa.title) = '');

-- 3) Title fallback for existing source='post' rows whose title is still
--    NULL/empty: use the linked post's own caption directly (one-to-one
--    relationship via post_id, no ambiguity).
UPDATE public.personal_assets pa
SET title = CASE WHEN length(trim(p.caption)) > 80 THEN left(trim(p.caption), 80) || '…' ELSE trim(p.caption) END
FROM public.posts p
WHERE pa.source = 'post'
  AND pa.post_id = p.id
  AND (pa.title IS NULL OR trim(pa.title) = '')
  AND p.caption IS NOT NULL
  AND trim(p.caption) <> '';
