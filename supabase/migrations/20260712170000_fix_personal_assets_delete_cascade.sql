-- ============================================================================
-- Migration: fix_personal_assets_delete_cascade
-- Purpose: personal_assets.generation_id/post_id are ON DELETE SET NULL, but
--   personal_assets_source_fk_matches CHECKs require generation_id NOT NULL
--   whenever source='generation' (and post_id NOT NULL whenever
--   source='post'). Deleting ANY generations/posts row that has a linked
--   personal_assets row therefore ALWAYS fails with a check-constraint
--   violation (confirmed live during QA testing 2026-07-12) — the SET NULL
--   cascade action produces a row state the CHECK constraint forbids.
--
--   Fix: switch both FKs to ON DELETE CASCADE — a generation/post-sourced
--   library asset has no meaning once its source is gone, so it should be
--   removed along with it, not orphaned with a nulled FK. This exactly
--   matches the pre-existing convention content_library_items already uses
--   for its own post_id/media_asset_id FKs (ON DELETE CASCADE, see
--   20260227090000_calendar_library_alignment.sql) — this migration brings
--   personal_assets in line with that same convention, not a new pattern.
--
-- Rollback:
--   ALTER TABLE public.personal_assets DROP CONSTRAINT personal_assets_generation_id_fkey;
--   ALTER TABLE public.personal_assets ADD CONSTRAINT personal_assets_generation_id_fkey
--     FOREIGN KEY (generation_id) REFERENCES public.generations(id) ON DELETE SET NULL;
--   ALTER TABLE public.personal_assets DROP CONSTRAINT personal_assets_post_id_fkey;
--   ALTER TABLE public.personal_assets ADD CONSTRAINT personal_assets_post_id_fkey
--     FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE SET NULL;
--   (reverting reintroduces the original bug — only do this if the CHECK
--   constraint itself is also being redesigned at the same time)
-- ============================================================================

ALTER TABLE public.personal_assets
  DROP CONSTRAINT IF EXISTS personal_assets_generation_id_fkey;
ALTER TABLE public.personal_assets
  ADD CONSTRAINT personal_assets_generation_id_fkey
  FOREIGN KEY (generation_id) REFERENCES public.generations(id) ON DELETE CASCADE;

ALTER TABLE public.personal_assets
  DROP CONSTRAINT IF EXISTS personal_assets_post_id_fkey;
ALTER TABLE public.personal_assets
  ADD CONSTRAINT personal_assets_post_id_fkey
  FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;
