-- ============================================================================
-- Backfill: every uploaded asset gets a publishable media identity
-- ============================================================================
-- The publisher resolves media through posts -> generations ONLY
-- (publish-post/index.ts:81-88). It cannot see personal_assets.
--
-- personal-asset-upload has, until now, hardcoded generation_id = NULL on every
-- row it wrote. So a file the user uploaded to their Library could be selected
-- in the composer, showed a name and a thumbnail, and then published as a post
-- with no media at all. On 2026-09-11 that produced a YouTube post which failed
-- fourteen seconds after creation: "YouTube requires a video. This post has no
-- media attached."
--
-- The edge function now creates that generations row at upload time. This
-- migration does the same for the uploads that already exist, which would
-- otherwise stay permanently unpublishable.
--
-- status = 'uploaded', deliberately NOT 'completed', because:
--   * ensure_draft_post_for_generation() fires only on 'completed'
--     (20260227103000_generation_post_unification_and_rls.sql:85-125) and would
--     turn every previously-uploaded file into a draft post. A backfill must
--     not manufacture content the user never asked for.
--   * historyLoader.js filters Studio's generation history to 'completed'.
--     An uploaded file was not generated and does not belong in that list.
-- publish-post applies no status filter, so publishing is unaffected.
--
-- IDEMPOTENT: only rows with generation_id IS NULL are touched, so re-running
-- is a no-op. TRANSACTIONAL: the whole backfill commits or none of it does.
-- ============================================================================

BEGIN;

-- ── Separate provenance from media identity ────────────────────────────────
--
-- personal_assets_source_fk_matches (20260625100000_personal_assets_table.sql:88)
-- asserted:
--     (source = 'upload' AND generation_id IS NULL AND post_id IS NULL)
--
-- i.e. an uploaded file may NEVER have a generation. That made `source` carry
-- two different meanings at once:
--   * PROVENANCE  — where this file came from. The Library cares about this.
--   * IDENTITY    — what the publisher can resolve. publish-post can only
--                   reach media through posts -> generations.
--
-- Those are not the same fact, and fusing them is what made every uploaded
-- file unpublishable by construction. An upload is still an upload; it simply
-- also needs an identity the publisher can follow.
--
-- This WIDENS the constraint only: generation_id becomes optional for uploads
-- rather than forbidden. Every existing row (upload with NULL generation_id)
-- still satisfies it, so the change cannot invalidate stored data. post_id
-- stays forbidden for uploads — an upload genuinely did not come from a post,
-- and nothing about publishing needs that to change.
ALTER TABLE public.personal_assets
  DROP CONSTRAINT IF EXISTS personal_assets_source_fk_matches;

ALTER TABLE public.personal_assets
  ADD CONSTRAINT personal_assets_source_fk_matches CHECK (
    (source = 'upload' AND post_id IS NULL)
    OR (source = 'generation' AND generation_id IS NOT NULL)
    OR (source = 'post' AND post_id IS NOT NULL)
  );

COMMENT ON CONSTRAINT personal_assets_source_fk_matches ON public.personal_assets IS
  'source records PROVENANCE, not media identity. An upload may carry a generation_id: that row is the only media reference publish-post can resolve (publish-post/index.ts:81-88), so without one an uploaded file cannot be published at all. Widened 2026-09-12.';

-- Only assets with a real file behind them. A row with neither a storage_path
-- nor a file_url has nothing to point a generation at, and inventing one would
-- be fabricating media.
WITH candidates AS (
  SELECT
    a.id            AS asset_id,
    a.user_id,
    a.media_type,
    a.storage_path,
    a.file_url,
    coalesce(a.storage_bucket, 'personal-assets') AS storage_bucket
  FROM public.personal_assets a
  WHERE a.source = 'upload'
    AND a.generation_id IS NULL
    AND a.deleted_at IS NULL
    AND (a.storage_path IS NOT NULL OR a.file_url IS NOT NULL)
),
created AS (
  INSERT INTO public.generations (
    user_id,
    organization_id,
    status,
    media_type,
    storage_path,
    output_url,
    metadata,
    created_at,
    updated_at
  )
  SELECT
    c.user_id,
    NULL,
    'uploaded',
    c.media_type,
    c.storage_path,
    c.file_url,
    jsonb_build_object(
      'storage_bucket', c.storage_bucket,
      'source', 'personal_asset_upload',
      'backfilled_by', '20260912090000_backfill_upload_generations'
    ),
    now(),
    now()
  FROM candidates c
  RETURNING id AS generation_id, user_id, storage_path, output_url
)
-- Re-pair each new generation with the asset it was built from. Matching on
-- (user_id, storage_path) is exact: storage_path is the object key inside the
-- bucket and is unique per uploaded file. Assets with no storage_path fall back
-- to output_url, which came from that asset's own file_url.
UPDATE public.personal_assets a
SET generation_id = g.generation_id,
    updated_at = now()
FROM created g
WHERE a.user_id = g.user_id
  AND a.generation_id IS NULL
  AND a.source = 'upload'
  AND a.deleted_at IS NULL
  AND (
    (a.storage_path IS NOT NULL AND a.storage_path = g.storage_path)
    OR (a.storage_path IS NULL AND a.file_url = g.output_url)
  );

-- ── Post-condition ─────────────────────────────────────────────────────────
-- A backfill that silently half-applied is worse than one that never ran: the
-- Library would look fixed while some assets stayed unpublishable. Fail loudly
-- and roll back instead.
DO $$
DECLARE
  remaining int;
  orphans   int;
BEGIN
  SELECT count(*) INTO remaining
  FROM public.personal_assets
  WHERE source = 'upload'
    AND generation_id IS NULL
    AND deleted_at IS NULL
    AND (storage_path IS NOT NULL OR file_url IS NOT NULL);

  IF remaining > 0 THEN
    RAISE EXCEPTION
      'Backfill incomplete: % uploaded asset(s) still have no generation_id and remain unpublishable',
      remaining;
  END IF;

  -- Every generation this migration created must be referenced by exactly the
  -- asset it was built from. An unreferenced one is an orphan the user can
  -- never reach — this repository's signature defect.
  SELECT count(*) INTO orphans
  FROM public.generations g
  WHERE g.metadata->>'backfilled_by' = '20260912090000_backfill_upload_generations'
    AND NOT EXISTS (
      SELECT 1 FROM public.personal_assets a WHERE a.generation_id = g.id
    );

  IF orphans > 0 THEN
    RAISE EXCEPTION
      'Backfill created % orphaned generation row(s) that no asset points at',
      orphans;
  END IF;

  -- The widened constraint must still forbid what it forbade before. A
  -- constraint that was relaxed too far would let a 'generation' asset exist
  -- with no generation, which is the defect in mirror image.
  IF EXISTS (
    SELECT 1 FROM public.personal_assets
    WHERE (source = 'generation' AND generation_id IS NULL)
       OR (source = 'post' AND post_id IS NULL)
       OR (source = 'upload' AND post_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION
      'personal_assets_source_fk_matches was relaxed too far: a row now violates the invariants it must still hold';
  END IF;

  RAISE NOTICE 'Upload backfill complete: every uploaded asset now has a publishable media identity.';
END
$$;

COMMIT;
