-- ============================================================================
-- Migration: storage_buckets_and_policies
-- Purpose:
--   1. Create missing storage buckets used by Brand Kit + Freepik integration
--   2. Fix "bucket not found" errors by provisioning brand_assets/generated_assets
--   3. Add per-user RLS policies for bucket object access
-- ============================================================================

-- -- Buckets -----------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'brand_assets',
  'brand_assets',
  false,
  52428800,
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'font/ttf',
    'font/otf',
    'video/mp4',
    'video/webm'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- SECURITY DECISION (recorded 2026-08-19, security audit): public=true here
-- is deliberate, not an oversight — do not "fix" it without reading this.
--
-- Supabase serves a public bucket at /storage/v1/object/public/... which
-- bypasses RLS entirely, so the generated_assets_select_own policy below
-- protects the authenticated API path only; it does nothing for the public
-- URL every image/video actually gets served from. In effect: anyone holding
-- a URL can view that file, indefinitely, with no login — this is a
-- capability-URL model, not per-user access control.
--
-- What makes this an acceptable default for THIS product: paths are
-- {user_id}/{timestamp}_....ext — UUID-prefixed and unguessable, so there is
-- no enumeration risk, only a "this exact URL leaked" risk. That fits a
-- content-generation tool where output is normally meant to be shared or
-- published anyway, and gets CDN caching / no signed-URL-expiry management
-- for free.
--
-- What it costs: a leaked link (browser sync, referrer header, a screenshot
-- shared elsewhere, server logs) is PERMANENT, unrevocable access — there is
-- no way to cut it off short of deleting the file. If some generated content
-- is ever meant to stay genuinely private (not just unlisted), this bucket is
-- the wrong storage for it.
--
-- Switching to signed URLs later is a real migration, not a config flip:
-- every already-shared/stored URL in the wild breaks, and every read path in
-- the app needs to request a fresh signed URL instead of using the stored
-- path directly. See docs/DEAD_CODE_AUDIT.md / security audit notes for the
-- full tradeoff writeup.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'generated_assets',
  'generated_assets',
  true,
  209715200,
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- -- Policies: brand_assets ---------------------------------------------------
DROP POLICY IF EXISTS "brand_assets_select_own" ON storage.objects;
CREATE POLICY "brand_assets_select_own"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'brand_assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "brand_assets_insert_own" ON storage.objects;
CREATE POLICY "brand_assets_insert_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'brand_assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "brand_assets_update_own" ON storage.objects;
CREATE POLICY "brand_assets_update_own"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'brand_assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'brand_assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "brand_assets_delete_own" ON storage.objects;
CREATE POLICY "brand_assets_delete_own"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'brand_assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- -- Policies: generated_assets ----------------------------------------------
DROP POLICY IF EXISTS "generated_assets_select_own" ON storage.objects;
CREATE POLICY "generated_assets_select_own"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'generated_assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "generated_assets_insert_own" ON storage.objects;
CREATE POLICY "generated_assets_insert_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'generated_assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "generated_assets_update_own" ON storage.objects;
CREATE POLICY "generated_assets_update_own"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'generated_assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'generated_assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "generated_assets_delete_own" ON storage.objects;
CREATE POLICY "generated_assets_delete_own"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'generated_assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
