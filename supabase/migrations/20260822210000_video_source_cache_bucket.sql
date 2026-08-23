-- 20260822210000_video_source_cache_bucket.sql
--
-- LOCK L7.4 — create the bucket the worker has always read from.
--
-- video-worker/database.py:397 hardcodes:
--
--     bucket = "video-source-cache"
--     response = supabase.storage.from_(bucket).download(storage_path)
--
-- That bucket does not exist. It never has. So `source_platform = 'upload'` —
-- the one ingestion path that does not depend on YouTube tolerating us — could
-- never have worked, and nothing said so, because no UI could create an upload
-- job either. Backend capability, no bucket, no caller: the disconnection
-- pattern this lockdown exists to close, in all three layers at once.
--
-- ── Why private, and why the path convention matters ───────────────────────
-- A user's raw source video is the most sensitive thing this product handles:
-- unpublished podcasts, unreleased talks, client work under embargo. The
-- generated_assets bucket is public because published output is meant to be
-- seen. This is the opposite, so it is private, and the policies below scope
-- every operation to the caller's own folder.
--
-- Path convention, enforced by the policies: {user_id}/{uuid}.{ext}
-- The worker reads with the service role and so bypasses RLS, which is correct
-- — it acts on behalf of a job whose ownership was already checked.
--
-- ── Size limit: 50MB, and that is a PRODUCT CONSTRAINT, not a preference ───
-- Measured 2026-08-22: this project rejects any bucket limit above 50MB with
-- HTTP 413. 1024MB, 500MB and 200MB were all refused; 50MB was accepted. That
-- is the Supabase free-plan global upload ceiling, and a bucket cannot exceed
-- it.
--
-- A 60-minute 1080p source video is 1-3GB. So at 50MB the upload path accepts
-- only short or heavily compressed video — which is NOT the product's stated
-- use case (repurposing long podcasts and talks).
--
-- Raising it is a paid-plan decision, not a code change. Until then the UI must
-- state the limit before the user picks a file, because a 2GB upload that fails
-- at the end is worse than one refused at the start.

BEGIN;

-- ── The bucket ─────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'video-source-cache',
  'video-source-cache',
  false,
  52428800,  -- 50MB — the project ceiling; see the note above
  ARRAY[
    'video/mp4',
    'video/quicktime',
    'video/x-matroska',
    'video/webm',
    'video/x-msvideo',
    'video/mpeg'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Owner-scoped access, same pattern as brand_assets ──────────────────────
DROP POLICY IF EXISTS "video_source_cache_select_own" ON storage.objects;
CREATE POLICY "video_source_cache_select_own"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'video-source-cache'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "video_source_cache_insert_own" ON storage.objects;
CREATE POLICY "video_source_cache_insert_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'video-source-cache'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- No UPDATE policy, deliberately. A source file is written once and read by the
-- worker; letting a client overwrite it mid-job would swap the input underneath
-- a running render.

DROP POLICY IF EXISTS "video_source_cache_delete_own" ON storage.objects;
CREATE POLICY "video_source_cache_delete_own"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'video-source-cache'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- ── Assert the post-condition ──────────────────────────────────────────────
-- A migration that cannot prove it did its job is a wish.
DO $$
DECLARE
  v_policies int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'video-source-cache') THEN
    RAISE EXCEPTION 'video-source-cache bucket was not created';
  END IF;

  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'video-source-cache' AND public) THEN
    RAISE EXCEPTION 'video-source-cache must NOT be public — it holds unpublished user source video';
  END IF;

  SELECT count(*) INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname LIKE 'video_source_cache_%';

  IF v_policies <> 3 THEN
    RAISE EXCEPTION 'expected 3 video_source_cache policies (select/insert/delete), found %', v_policies;
  END IF;

  -- If someone raises the plan later, this is the line to revisit.
  RAISE NOTICE 'video-source-cache ready. File limit is 50MB (project ceiling) — long-form sources will not fit.';
END $$;

COMMIT;
