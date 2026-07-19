-- ============================================================================
-- Migration: week3_generation_idempotency
-- Purpose (Week 3 Fix 2 — see audit-brief/FIXLOG.md "WEEK 3"):
--   Client-generated `generation_request_id` (one per user-initiated
--   generation ATTEMPT — a Retry click gets a new id; an internal retry of
--   the same attempt reuses it) is threaded through
--   startGeneration/startCarouselGeneration/startEditGeneration/
--   startVideoGeneration -> generationPipeline.js -> the media edge
--   functions. `request_slot` disambiguates multiple images produced under
--   the same request_id (variant index for batches, slide index for
--   carousels) so each individually-billed unit of work has its own
--   idempotency key. generateImage/editImage/generateVideo check for an
--   existing COMPLETED generation at (user_id, request_id, request_slot)
--   before doing any provider work or billing, and return the cached
--   result instead of re-rendering/re-billing on a duplicate/retried
--   invocation.
--
--   Also formally tracks `batch_id`/`batch_index` as real, intentional
--   columns (they already exist live and are used by
--   generationPipeline.js's carousel orchestration; previously only
--   documented as "drift" in 20260710090000_baseline_core_tables.sql, never
--   given a real ADD COLUMN of their own since the FK-adding migration that
--   was supposed to do so never actually ran). This migration is the first
--   one to actually issue ADD COLUMN IF NOT EXISTS for all four columns, so
--   it is safe to run whether or not batch_id/batch_index already exist on
--   the live table.
--
-- Rollback:
--   ALTER TABLE public.generations DROP COLUMN IF EXISTS request_id;
--   ALTER TABLE public.generations DROP COLUMN IF EXISTS request_slot;
--   DROP INDEX IF EXISTS idx_generations_request_idempotency;
--   (batch_id/batch_index are pre-existing live columns this migration only
--   formalizes — do NOT drop them on rollback, that would destroy real data
--   the carousel feature depends on; only the two new columns and their
--   index are safe/intended to be reverted.)
-- ============================================================================

ALTER TABLE public.generations
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS request_slot integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS batch_index integer;

COMMENT ON COLUMN public.generations.request_id IS
  'Client-generated UUID identifying one user-initiated generation attempt. A Retry click mints a new one; an internal retry of the same attempt (e.g. idempotent double-invoke) reuses it. NULL for rows created before this column existed (2026-07-12) or by paths that do not yet pass one.';
COMMENT ON COLUMN public.generations.request_slot IS
  'Disambiguates multiple billable units under the same request_id (variant index for image batches, slide index for carousels). Defaults to 0 for single-unit requests.';

-- One completed generation per (user, request_id, request_slot) — the
-- uniqueness that makes "return the cached result instead of re-rendering"
-- possible. Partial (only when request_id is present) so rows from before
-- this column existed, or from paths that never adopt it, are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_generations_request_idempotency
  ON public.generations(user_id, request_id, request_slot)
  WHERE request_id IS NOT NULL;
