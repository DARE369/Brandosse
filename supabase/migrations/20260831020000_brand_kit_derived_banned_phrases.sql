-- 20260831020000_brand_kit_derived_banned_phrases.sql
--
-- Adds brand_kit.derived_banned_phrases.
--
-- ── Why ──────────────────────────────────────────────────────────────────────
-- `content_restrictions` holds prose the user wrote: "no alcohol references",
-- "never name a competitor", "no health claims". None of that can be matched
-- literally, so until now it was collected and never enforced — the user
-- reasonably believed it was.
--
-- Enforcing it per render would mean an LLM call on every generated title, on
-- every clip, forever. Instead the prose is reduced ONCE, when the kit is
-- saved, to the literal phrases that would violate it ("beer", "wine",
-- "vodka"), and stored here. Screening then costs a string match.
--
-- ── Why a separate column, rather than appending to forbidden_phrases ────────
-- `forbidden_phrases` is what the user typed. It is theirs. Writing machine
-- guesses into it would mean they open their brand kit and find words they
-- never entered, with no way to tell which were theirs — and no way for us to
-- re-derive without destroying their edits. Separate columns keep authorship
-- unambiguous and make the derivation re-runnable.
--
-- The semantic backstop still runs for rules that cannot be reduced to phrases
-- at all ("avoid anything that implies a guarantee"); this column is the cheap
-- majority, not the whole answer.

BEGIN;

ALTER TABLE public.brand_kit
  ADD COLUMN IF NOT EXISTS derived_banned_phrases text[] DEFAULT '{}';

COMMENT ON COLUMN public.brand_kit.derived_banned_phrases IS
  'Literal phrases derived from content_restrictions at kit-save time. '
  'Machine-generated: never surfaced as user input, never merged into '
  'forbidden_phrases, safe to recompute. Read together with forbidden_phrases '
  'by the render screen (video-worker/brand_kit.py banned_phrases()).';

-- Post-condition: the column exists, is the expected type, and defaults to an
-- empty array rather than NULL — the worker treats a non-list as "no phrases",
-- so a NULL default would silently disable screening for every existing row.
DO $$
DECLARE
  col_type text;
  col_default text;
BEGIN
  SELECT data_type, column_default
    INTO col_type, col_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'brand_kit'
    AND column_name  = 'derived_banned_phrases';

  IF col_type IS NULL THEN
    RAISE EXCEPTION
      'post-condition failed: brand_kit.derived_banned_phrases was not created';
  END IF;

  IF col_type <> 'ARRAY' THEN
    RAISE EXCEPTION
      'post-condition failed: brand_kit.derived_banned_phrases is %, expected ARRAY',
      col_type;
  END IF;

  IF col_default IS NULL THEN
    RAISE EXCEPTION
      'post-condition failed: brand_kit.derived_banned_phrases has no default; '
      'a NULL default disables phrase screening for every existing row';
  END IF;
END $$;

COMMIT;
