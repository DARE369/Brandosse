-- ============================================================
-- Migration: brand_kit_multi_kit
-- Personal Brand Kit rebuild (docs/brand-kit-rebuild/AS_IS_AUDIT.md +
-- DECISIONS_LOG.md). Relaxes the one-kit-per-user constraint so an account
-- can hold multiple brand kits, with exactly one marked active. Studio's
-- generation pipeline (src/services/brandKitLoader.js) resolves the active
-- kit per user — see DECISIONS_LOG.md's "Active-kit model for Studio" entry.
-- Also adds structured font-pair storage and a display name for each kit,
-- and allow-lists zip attachments on the brand_assets storage bucket.
-- ============================================================

-- 1. Drop the single-kit-per-account constraint.
ALTER TABLE public.brand_kit
  DROP CONSTRAINT IF EXISTS brand_kit_user_id_key;

-- 2. New columns: kit display name (distinct from brand_name — a user may
--    name a kit "Summer 2026" while brand_name stays "Marrow Coffee"),
--    active-kit flag, and structured font pairs (display + body), each
--    {family, style}, mirroring color_palette's existing jsonb-array
--    convention rather than adding four separate text columns.
ALTER TABLE public.brand_kit
  ADD COLUMN IF NOT EXISTS kit_name       text,
  ADD COLUMN IF NOT EXISTS is_active      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS font_display   jsonb,
  ADD COLUMN IF NOT EXISTS font_body      jsonb;

-- 3. Backfill kit_name for existing rows so the UI never renders a blank
--    kit-switcher label for pre-existing kits.
UPDATE public.brand_kit
  SET kit_name = COALESCE(NULLIF(brand_name, ''), 'My Brand Kit')
  WHERE kit_name IS NULL;

-- 4. Enforce "at most one active kit per user" — a partial unique index,
--    not a table-wide UNIQUE, so multiple *inactive* kits per user are
--    allowed while still guaranteeing brandKitLoader.js's
--    `.eq('user_id', userId).eq('is_active', true).maybeSingle()` can never
--    see more than one row.
CREATE UNIQUE INDEX IF NOT EXISTS brand_kit_one_active_per_user
  ON public.brand_kit (user_id)
  WHERE is_active;

-- 5. Every existing row today is exactly one kit per user (verified live,
--    zero duplicates, see DECISIONS_LOG.md), so the default `is_active =
--    true` backfill above is safe and requires no reconciliation pass.

CREATE INDEX IF NOT EXISTS brand_kit_user_id_idx ON public.brand_kit(user_id);

-- 6. Allow zip attachments on the brand_assets storage bucket (mockup shows
--    "Logo-Pack.zip · 4 variants" as a real attachment; additive, no
--    existing MIME types removed).
UPDATE storage.buckets
  SET allowed_mime_types = array_append(
    allowed_mime_types,
    'application/zip'
  )
  WHERE id = 'brand_assets'
    AND NOT ('application/zip' = ANY(allowed_mime_types));

UPDATE storage.buckets
  SET allowed_mime_types = array_append(
    allowed_mime_types,
    'application/x-zip-compressed'
  )
  WHERE id = 'brand_assets'
    AND NOT ('application/x-zip-compressed' = ANY(allowed_mime_types));

-- -- End of migration ------------------------------------------
