-- 20260901040000_video_clips_file_size.sql
--
-- Adds video_clips.file_size_bytes, and a per-user storage view.
--
-- ── Why ──────────────────────────────────────────────────────────────────────
-- The 7-day clip expiry was removed on 2026-09-01: clips are kept until the
-- user deletes them. That was the right call — a deliverable that expires is not
-- a deliverable — but the sweep was also the only thing bounding storage, so
-- storage is now unbounded and nothing reclaims it.
--
-- The replacement control is a per-user CEILING rather than a deadline. A limit
-- tells someone they need to clear space; a deadline destroys work they paid to
-- produce without asking. Only one of those is defensible on a paid plan.
--
-- ── Why this needs a column at all ──────────────────────────────────────────
-- The upload path already computes the file size and then only LOGS it
-- (video-worker/utils/storage_uploader.py:25). So there was no way to answer
-- "how much storage does this user hold" without listing every object in the
-- bucket — far too expensive to do on the submit path, which is exactly where
-- the ceiling has to be checked.

BEGIN;

ALTER TABLE public.video_clips
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint;

COMMENT ON COLUMN public.video_clips.file_size_bytes IS
  'Size of the rendered clip in bytes, written by the worker at upload. Null on '
  'rows created before 2026-09-01 and on clips that never finished rendering. '
  'Summed per user to enforce the storage ceiling that replaced the removed '
  '7-day expiry.';

-- Per-user totals. A view rather than a counter column: a counter has to be
-- kept correct across render, delete, retry and reap, and every one of those is
-- a chance to drift. Summing is cheap at this scale and cannot disagree with
-- the rows it sums.
CREATE OR REPLACE VIEW public.user_storage_usage AS
SELECT
  user_id,
  count(*)                                    AS clip_count,
  coalesce(sum(file_size_bytes), 0)::bigint   AS bytes_used,
  -- Rows predating the column, so a caller can tell "this user holds nothing"
  -- from "we do not know what this user holds". Reporting an unknown as zero
  -- is how a ceiling silently fails open.
  count(*) FILTER (WHERE file_size_bytes IS NULL) AS clips_unmeasured
FROM public.video_clips
WHERE render_status = 'complete'
GROUP BY user_id;

COMMENT ON VIEW public.user_storage_usage IS
  'Per-user rendered-clip storage. clips_unmeasured counts rows from before '
  'file_size_bytes existed — treat a non-zero value as "total is a lower bound", '
  'never as zero.';

CREATE INDEX IF NOT EXISTS video_clips_user_render_status_idx
  ON public.video_clips (user_id, render_status);

-- ── Post-condition ─────────────────────────────────────────────────────────
DO $$
DECLARE
  has_col  boolean;
  has_view boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'video_clips'
      AND column_name = 'file_size_bytes'
  ) INTO has_col;
  IF NOT has_col THEN
    RAISE EXCEPTION 'post-condition failed: video_clips.file_size_bytes was not created';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'user_storage_usage'
  ) INTO has_view;
  IF NOT has_view THEN
    RAISE EXCEPTION 'post-condition failed: user_storage_usage view was not created';
  END IF;
END $$;

COMMIT;
