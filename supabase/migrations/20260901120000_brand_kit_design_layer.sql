-- 20260901120000_brand_kit_design_layer.sql
--
-- Adds the structural design fields a layout engine needs, plus provenance.
--
-- ── Why ──────────────────────────────────────────────────────────────────────
-- The brand kit can tell a copywriter how to sound. It cannot tell a renderer
-- anything. `color_palette` is a list of hexes, which says which colours exist
-- and never which one is the button. `font_display` holds a family NAME with no
-- weight, tracking or casing. There is nowhere at all to record logo clear
-- space, safe margins, the contact block that has to appear on a flyer, the
-- brand's social handles, or a legally required mark.
--
-- So every generated graphic has been assembled from prose hints handed to a
-- diffusion model, which is why brand colours come out approximately right and
-- typography comes out as whatever the model felt like drawing.
--
-- ── Why jsonb and not forty scalar columns ──────────────────────────────────
-- These are nested objects that a renderer reads as a unit (a colour role is a
-- hex AND a name AND its provenance AND its contrast against the background).
-- Splitting them into scalars makes the read path noisy and the next migration
-- brittle.
--
-- But unconstrained jsonb is exactly how this database drifted to 89 live
-- tables against 65 in migrations, so three things constrain it:
--   1. a jsonb_typeof CHECK per column, asserted below;
--   2. supabase/functions/_shared/brandDesign.ts is the ONLY writer, and
--      normalises every shape before it is stored;
--   3. scripts/check-brand-design-writer.cjs fails the build if anything else
--      writes these columns raw.
--
-- ── Why provenance is a column and not a convention ─────────────────────────
-- `extraction_evidence` records, per field, whether a value was MEASURED from
-- the client's site (a hex parsed out of their CSS), INFERRED by a model, or
-- entered by the USER — and the URL it came from.
--
-- Without it the kit presents a machine's guess and a measured fact with
-- identical authority, which is the fabricated-data failure the third law
-- forbids. It is the same reasoning that gave derived_banned_phrases its own
-- column rather than merging machine guesses into the user's own words.

BEGIN;

-- ── brand_kit: the design layer ──────────────────────────────────────────────

ALTER TABLE public.brand_kit
  -- Which colour does what. The half color_palette cannot express.
  ADD COLUMN IF NOT EXISTS color_roles         jsonb   NOT NULL DEFAULT '{}'::jsonb,
  -- Pre-computed WCAG ratios for every foreground/background pair worth using.
  ADD COLUMN IF NOT EXISTS contrast_pairs      jsonb   NOT NULL DEFAULT '[]'::jsonb,
  -- Family + weight + tracking + casing + a minimum body size, per role.
  ADD COLUMN IF NOT EXISTS type_scale          jsonb   NOT NULL DEFAULT '{}'::jsonb,
  -- Clear space, minimum size, preferred corner, surfaces it may not sit on.
  ADD COLUMN IF NOT EXISTS logo_rules          jsonb   NOT NULL DEFAULT '{}'::jsonb,
  -- Safe margins, alignment, grid, line limits.
  ADD COLUMN IF NOT EXISTS layout_rules        jsonb   NOT NULL DEFAULT '{}'::jsonb,
  -- Website / email / phone / address, and whether they render on artwork.
  ADD COLUMN IF NOT EXISTS contact_block       jsonb   NOT NULL DEFAULT '{}'::jsonb,
  -- Per-platform handle, and whether to stamp it onto designs.
  ADD COLUMN IF NOT EXISTS social_handles      jsonb   NOT NULL DEFAULT '{}'::jsonb,
  -- Legal line / disclaimer / watermark that MUST appear, and where.
  ADD COLUMN IF NOT EXISTS required_marks      jsonb   NOT NULL DEFAULT '{}'::jsonb,
  -- Subject matter and mood to seek, things never to show, how people appear.
  ADD COLUMN IF NOT EXISTS imagery_rules       jsonb   NOT NULL DEFAULT '{}'::jsonb,
  -- Per-field {source: measured|inferred|user, url, confidence}.
  ADD COLUMN IF NOT EXISTS extraction_evidence jsonb   NOT NULL DEFAULT '{}'::jsonb,
  -- Distinct from setup_completed: a kit can be finished for copy and empty
  -- for design, and the UI must be able to tell those apart.
  ADD COLUMN IF NOT EXISTS design_setup_completed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.brand_kit.color_roles IS
  'Semantic colour assignments: background, surface, text_primary, text_secondary, '
  'accent, cta_bg, cta_text, border. Each {hex, name, source, contrast_vs_background}. '
  'Written ONLY via _shared/brandDesign.ts.';
COMMENT ON COLUMN public.brand_kit.contrast_pairs IS
  'Validated [{fg, bg, ratio, wcag}] pairs. Computed, never authored: a pair below '
  '4.5:1 must never be proposed for text.';
COMMENT ON COLUMN public.brand_kit.type_scale IS
  'display/body: {family, weight, tracking, case} plus min_body_px. A family name '
  'alone is not enough to set a line.';
COMMENT ON COLUMN public.brand_kit.logo_rules IS
  'clear_space_ratio (of mark height), min_width_px, preferred_corner, never_on[].';
COMMENT ON COLUMN public.brand_kit.layout_rules IS
  'safe_margin_pct, text_max_lines, alignment, grid.';
COMMENT ON COLUMN public.brand_kit.contact_block IS
  'website/email/phone/address + show_on_designs. Harvested from JSON-LD and '
  'mailto:/tel: links where available.';
COMMENT ON COLUMN public.brand_kit.social_handles IS
  'platform -> {handle, stamp_on_designs}.';
COMMENT ON COLUMN public.brand_kit.required_marks IS
  'legal_line, required_on[], watermark. legal_disclaimers is copy-side and is '
  'deliberately dropped from visual prompts; this is the visual equivalent.';
COMMENT ON COLUMN public.brand_kit.imagery_rules IS
  'subject_matter[], mood[], never_show[], people (real|illustrated|none).';
COMMENT ON COLUMN public.brand_kit.extraction_evidence IS
  'Provenance per field: {source: measured|inferred|user, url, confidence}. A '
  'measured value came from the client site itself; an inferred one is a model''s '
  'guess. Presenting them identically is fabricated data.';

-- ── brand_assets: logo variants and where they came from ─────────────────────

ALTER TABLE public.brand_assets
  -- One brand has several marks. Compositing a dark wordmark onto a dark
  -- background is a brand violation that no amount of prompt text prevents.
  ADD COLUMN IF NOT EXISTS variant    text,
  -- Whether the file has real transparency, decided by inspecting the bytes
  -- rather than trusting the extension.
  ADD COLUMN IF NOT EXISTS has_alpha  boolean,
  -- The page a harvested asset was found on. NULL for a manual upload.
  ADD COLUMN IF NOT EXISTS source_url text;

COMMENT ON COLUMN public.brand_assets.variant IS
  'primary | light_bg | dark_bg | mark | wordmark | favicon. NULL for assets that '
  'are not logos.';
COMMENT ON COLUMN public.brand_assets.source_url IS
  'Page a harvested asset was found on. NULL when manually uploaded. Harvested '
  'assets are stored with status=''proposed'' until the user accepts them.';

-- ── Shape constraints ────────────────────────────────────────────────────────
-- Added through a DO block because ADD CONSTRAINT has no IF NOT EXISTS, and a
-- migration that fails on second run is not idempotent.

DO $$
DECLARE
  object_columns text[] := ARRAY[
    'color_roles', 'type_scale', 'logo_rules', 'layout_rules',
    'contact_block', 'social_handles', 'required_marks', 'imagery_rules',
    'extraction_evidence'
  ];
  col           text;
  constraint_nm text;
BEGIN
  FOREACH col IN ARRAY object_columns LOOP
    constraint_nm := 'brand_kit_' || col || '_is_object';
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = constraint_nm
        AND conrelid = 'public.brand_kit'::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.brand_kit ADD CONSTRAINT %I CHECK (jsonb_typeof(%I) = ''object'')',
        constraint_nm, col
      );
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'brand_kit_contrast_pairs_is_array'
      AND conrelid = 'public.brand_kit'::regclass
  ) THEN
    ALTER TABLE public.brand_kit
      ADD CONSTRAINT brand_kit_contrast_pairs_is_array
      CHECK (jsonb_typeof(contrast_pairs) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'brand_assets_variant_known'
      AND conrelid = 'public.brand_assets'::regclass
  ) THEN
    ALTER TABLE public.brand_assets
      ADD CONSTRAINT brand_assets_variant_known
      CHECK (variant IS NULL OR variant IN (
        'primary', 'light_bg', 'dark_bg', 'mark', 'wordmark', 'favicon'
      ));
  END IF;
END $$;

-- Harvested assets awaiting review are read constantly during an import review;
-- everything else scans the whole table for one user.
CREATE INDEX IF NOT EXISTS brand_assets_kit_status_idx
  ON public.brand_assets(brand_kit_id, status);

-- ── Post-conditions ──────────────────────────────────────────────────────────
-- Assert the migration did what it claims. A migration that reports success
-- without checking is the same class of defect as a fix without a detector.

DO $$
DECLARE
  expected_kit_cols text[] := ARRAY[
    'color_roles', 'contrast_pairs', 'type_scale', 'logo_rules', 'layout_rules',
    'contact_block', 'social_handles', 'required_marks', 'imagery_rules',
    'extraction_evidence', 'design_setup_completed'
  ];
  expected_asset_cols text[] := ARRAY['variant', 'has_alpha', 'source_url'];
  col        text;
  col_type   text;
  col_default text;
  col_nullable text;
  missing_constraints int;
BEGIN
  FOREACH col IN ARRAY expected_kit_cols LOOP
    -- Aliased and renamed: a PL/pgSQL variable named is_nullable shadows the
    -- information_schema column of the same name, and Postgres refuses the
    -- ambiguous reference rather than guessing.
    SELECT c.data_type, c.column_default, c.is_nullable
      INTO col_type, col_default, col_nullable
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'brand_kit' AND c.column_name = col;

    IF col_type IS NULL THEN
      RAISE EXCEPTION 'post-condition failed: brand_kit.% was not created', col;
    END IF;

    -- A NULL default would mean every existing row reads NULL for a field the
    -- renderer expects to be an object, and every read site would need its own
    -- defensive branch. Empty-but-present is the contract.
    IF col_default IS NULL THEN
      RAISE EXCEPTION
        'post-condition failed: brand_kit.% has no default; existing rows would read NULL', col;
    END IF;

    IF col_nullable <> 'NO' THEN
      RAISE EXCEPTION
        'post-condition failed: brand_kit.% is nullable; the renderer contract is empty-not-null', col;
    END IF;
  END LOOP;

  FOREACH col IN ARRAY expected_asset_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'brand_assets' AND column_name = col
    ) THEN
      RAISE EXCEPTION 'post-condition failed: brand_assets.% was not created', col;
    END IF;
  END LOOP;

  -- 9 object checks + 1 array check on brand_kit, 1 variant check on brand_assets.
  SELECT count(*) INTO missing_constraints
  FROM (
    SELECT unnest(ARRAY[
      'brand_kit_color_roles_is_object', 'brand_kit_type_scale_is_object',
      'brand_kit_logo_rules_is_object', 'brand_kit_layout_rules_is_object',
      'brand_kit_contact_block_is_object', 'brand_kit_social_handles_is_object',
      'brand_kit_required_marks_is_object', 'brand_kit_imagery_rules_is_object',
      'brand_kit_extraction_evidence_is_object', 'brand_kit_contrast_pairs_is_array',
      'brand_assets_variant_known'
    ]) AS name
  ) expected
  WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = expected.name);

  IF missing_constraints > 0 THEN
    RAISE EXCEPTION
      'post-condition failed: % shape constraint(s) missing; jsonb columns without a '
      'type check are how this schema drifts', missing_constraints;
  END IF;
END $$;

COMMIT;
