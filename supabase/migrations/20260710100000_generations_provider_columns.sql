-- ============================================================================
-- Migration: generations_provider_columns
-- Purpose:
--   URGENT FIX, not documentation. A live schema introspection (2026-07-10)
--   confirmed public.generations does NOT have enhanced_prompt, output_url,
--   provider, provider_model, or aspect_ratio columns — yet generateImage,
--   generateVideo, and editImage all insert those fields on every call.
--   Because none of those inserts check the returned `error` (only `data`),
--   every one of those inserts has been failing outright (Postgres rejects
--   an INSERT naming an unknown column) and failing silently: the media
--   still renders/uploads fine, the client gets a "successful" response with
--   generation_id: null, but no row is ever written to `generations` — which
--   means the ensure_draft_post_for_generation trigger never fires and no
--   draft post is ever created from Studio generations.
--
--   This migration adds the missing columns so the existing inserts start
--   succeeding. The application-code half of this fix (checking .error on
--   these inserts so this class of bug can never hide silently again) is
--   applied separately in the same changeset — see generateImage/
--   generateVideo/editImage edge functions.
-- ============================================================================

ALTER TABLE public.generations
  ADD COLUMN IF NOT EXISTS enhanced_prompt text,
  ADD COLUMN IF NOT EXISTS output_url      text,
  ADD COLUMN IF NOT EXISTS provider        text,
  ADD COLUMN IF NOT EXISTS provider_model  text,
  ADD COLUMN IF NOT EXISTS aspect_ratio    text;

COMMENT ON COLUMN public.generations.enhanced_prompt IS
  'Brand-DNA-enhanced prompt actually sent to the media provider, when different from the raw user prompt. Added 2026-07-10 — see migration header for why this was previously silently failing to write.';
COMMENT ON COLUMN public.generations.provider IS
  'Actual media provider that rendered this generation (e.g. fal-ai). Added 2026-07-10.';
COMMENT ON COLUMN public.generations.provider_model IS
  'Actual model id used (e.g. fal-ai/ideogram/v3, hailuo-2.3). Added 2026-07-10.';
COMMENT ON COLUMN public.generations.output_url IS
  'Provider/Storage URL for the rendered asset. NOTE: current code sets this to the same value as storage_path in every call site — the two columns are not currently used to hold distinct URLs. Added 2026-07-10.';
COMMENT ON COLUMN public.generations.aspect_ratio IS
  'Aspect ratio requested for this generation (e.g. 1:1, 16:9). Added 2026-07-10.';
