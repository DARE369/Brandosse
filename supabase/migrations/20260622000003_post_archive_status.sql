-- ============================================================================
-- Migration: post_archive_status
-- Date: 2026-06-22
-- Purpose:
--   1) Reintroduce 'archived' as a canonical post status (soft-hide, not a
--      delete), this time gated by the application-level status machine
--      (src/utils/postStatusMachine.js) and a dedicated Library UI surface.
--   2) Add archived_at for "Archived Xd ago" display, mirroring published_at.
-- Note: an earlier migration (20260302110000_profile_provisioning_and_status_domain)
--   intentionally removed 'archived' while canonicalizing the status domain,
--   collapsing any existing archived rows into 'failed'. This migration
--   deliberately reintroduces it as a first-class, properly-gated status.
-- ============================================================================

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'posts'
      AND column_name = 'status'
  ) THEN
    ALTER TABLE public.posts
      DROP CONSTRAINT IF EXISTS posts_status_allowed;

    ALTER TABLE public.posts
      ADD CONSTRAINT posts_status_allowed
      CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'archived'));
  END IF;
END
$$;
