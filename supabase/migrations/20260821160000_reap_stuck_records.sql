-- 20260821160000_reap_stuck_records.sql
--
-- WAVE 2 / LOCK L2.3 — bound every non-terminal state with a timeout, and
-- recover the records already stranded.
--
-- ── The defect ───────────────────────────────────────────────────────────────
-- publish-post/index.ts:126-129 sets posts.status = 'publishing' BEFORE calling
-- the provider. If the function dies, times out, or the terminal update fails,
-- the row stays 'publishing' forever. Nothing anywhere transitions a post out
-- of that state except publish-post itself completing — verified by grepping
-- every occurrence of 'publishing' across supabase/migrations and
-- supabase/functions.
--
-- The scheduled worker only picks up status = 'scheduled', so these rows are
-- invisible to retry: never retried, never failed, never published. From the
-- user's perspective the content simply vanished, with no error and no
-- notification. For a scheduling product this is the worst available failure.
--
-- Compounding it, zernio.service.ts has four outbound calls and ZERO timeouts
-- (finding P10q-005), so a hung provider request is a direct route into this
-- state.
--
-- ── Live state at time of writing (2026-08-21) ───────────────────────────────
--   posts.status = 'publishing'           20 rows, oldest 2026-04-04 (4+ months)
--   video_clips.render_status = 'pending'  4 rows, oldest 2026-06-17
--   video_jobs                             0 non-terminal
--   background_jobs                        0 queued (2 failed)
--
-- Note: video_clips uses `render_status`, not `status` — an earlier audit note
-- named the wrong column. Verified against the live schema before writing this.
--
-- ── Fix ──────────────────────────────────────────────────────────────────────
--   1. reap_stuck_records() — moves timed-out non-terminal rows to a terminal
--      failed state with an explanatory reason.
--   2. Scheduled every 5 minutes via pg_cron.
--   3. Backfills the rows already stranded.
--
-- Thresholds are deliberately generous — a reaper that fires early would kill
-- legitimate in-flight work, which is worse than the bug it fixes.
--
-- VERIFY: SELECT * FROM public.reap_stuck_records();  -- returns what it reaped
--         then: SELECT count(*) FROM posts WHERE status = 'publishing'
--               AND updated_at < now() - interval '15 minutes';   -- must be 0
-- SAFE TO RE-RUN: yes

BEGIN;

-- ── 1. The reaper ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reap_stuck_records()
RETURNS TABLE (
  table_name   text,
  reaped_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- A publish round trip is seconds. 15 minutes is far beyond any legitimate
  -- case and still bounds the damage.
  publish_timeout    interval := interval '15 minutes';
  -- Clip rendering is genuinely long (ffmpeg on a 60-minute source). The worker
  -- uses a 45-minute internal threshold; 90 gives it room to finish and report
  -- rather than being reaped out from under itself.
  render_timeout     interval := interval '90 minutes';
  job_timeout        interval := interval '90 minutes';
  background_timeout interval := interval '30 minutes';
  n int;
BEGIN
  -- posts stuck mid-publish ---------------------------------------------------
  UPDATE public.posts
  SET status        = 'failed',
      error_message = COALESCE(error_message,
        'Publishing timed out — the post was left mid-publish and has been failed automatically so it can be retried.'),
      failed_at     = now(),
      updated_at    = now()
  WHERE status = 'publishing'
    AND updated_at < now() - publish_timeout;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    table_name := 'posts'; reaped_count := n; RETURN NEXT;
  END IF;

  -- video_clips stuck mid-render ----------------------------------------------
  UPDATE public.video_clips
  SET render_status = 'failed',
      error_message = COALESCE(error_message,
        'Rendering timed out — the clip was left mid-render and has been failed automatically.'),
      updated_at    = now()
  WHERE render_status = 'pending'
    AND updated_at < now() - render_timeout;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    table_name := 'video_clips'; reaped_count := n; RETURN NEXT;
  END IF;

  -- video_jobs stuck mid-processing -------------------------------------------
  -- Backstop for the worker's own reset_stuck_jobs(), which only runs at worker
  -- STARTUP. A worker that is down (as it is today, for want of a Groq key)
  -- never runs it, so jobs would strand indefinitely without a DB-side reaper.
  UPDATE public.video_jobs
  SET status        = 'failed',
      error_message = COALESCE(error_message,
        'Processing timed out — the worker did not report completion.'),
      error_stage   = COALESCE(error_stage, 'timeout'),
      processing_ended_at = now(),
      updated_at    = now()
  WHERE status NOT IN ('complete', 'failed', 'cancelled')
    AND COALESCE(processing_started_at, created_at) < now() - job_timeout;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    table_name := 'video_jobs'; reaped_count := n; RETURN NEXT;
  END IF;

  -- background_jobs stranded in queued/running --------------------------------
  -- process-jobs/index.ts:53-54 only reclaims rows in 'running' with a NULL
  -- started_at, so a row stuck in 'queued' is unreapable by construction.
  UPDATE public.background_jobs
  SET status      = 'failed',
      error       = COALESCE(error,
        'Job timed out — never picked up or never reported completion.'),
      finished_at = now(),
      updated_at  = now()
  WHERE status IN ('queued', 'running')
    AND COALESCE(started_at, created_at) < now() - background_timeout;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    table_name := 'background_jobs'; reaped_count := n; RETURN NEXT;
  END IF;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.reap_stuck_records() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reap_stuck_records() TO service_role;

COMMENT ON FUNCTION public.reap_stuck_records() IS
  'LOCK L2.3 — bounds every non-terminal record state with a timeout. Runs every 5 minutes via pg_cron (job: reap-stuck-records). Without it, records stranded mid-operation are never retried, never failed, and invisible to the user.';

-- ── 2. Schedule it ───────────────────────────────────────────────────────────

DO $$
BEGIN
  PERFORM cron.unschedule('reap-stuck-records');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- not previously scheduled
END;
$$;

SELECT cron.schedule(
  'reap-stuck-records',
  '*/5 * * * *',
  $$SELECT public.reap_stuck_records();$$
);

-- ── 3. Backfill the already-stranded records ─────────────────────────────────

DO $$
DECLARE
  r record;
  total int := 0;
BEGIN
  FOR r IN SELECT * FROM public.reap_stuck_records() LOOP
    RAISE NOTICE 'L2.3 backfill: reaped % row(s) from %', r.reaped_count, r.table_name;
    total := total + r.reaped_count;
  END LOOP;
  RAISE NOTICE 'L2.3: backfill complete — % stranded row(s) moved to a terminal state', total;
END;
$$;

-- ── 4. Post-condition ────────────────────────────────────────────────────────

DO $$
DECLARE
  still_stuck int;
BEGIN
  SELECT count(*) INTO still_stuck
  FROM public.posts
  WHERE status = 'publishing'
    AND updated_at < now() - interval '15 minutes';

  IF still_stuck > 0 THEN
    RAISE EXCEPTION
      'L2.3 post-condition failed: % post(s) remain stuck in publishing after the reaper ran',
      still_stuck;
  END IF;

  RAISE NOTICE 'L2.3: no posts remain stranded in publishing';
END;
$$;

COMMIT;
