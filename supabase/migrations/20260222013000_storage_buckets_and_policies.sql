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
