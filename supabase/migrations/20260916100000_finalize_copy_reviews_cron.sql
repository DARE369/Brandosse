-- ============================================================================
-- Migration: finalize_copy_reviews_cron
--
-- Schedules the worker that freezes the copy review report onto a post once it
-- has actually published — "upon the point of publishing, these were the
-- scores", kept permanently on the post and shown in its details panel.
--
-- The worker is supabase/functions/finalize-copy-reviews. DEPLOY IT FIRST:
--   supabase functions deploy finalize-copy-reviews --use-api
-- Until it is deployed every run 404s, and pg_cron records a 404 as a
-- successful HTTP call.
--
-- ── Why every two minutes ───────────────────────────────────────────────────
-- The publish receipt waits for the report after a post goes out and gives up
-- after five minutes. Dispatch happens within a minute; a two-minute cadence
-- lands the report comfortably inside that window. When there is nothing to
-- freeze, a run is one indexed query.
--
-- ── Same two-header pattern as 20260911140000 ───────────────────────────────
-- Authorization satisfies the gateway's JWT check; X-Invoke-Secret is the
-- authorisation the function itself enforces (requireInvokeSecret). Both come
-- from Vault, so no secret enters this file or cron.job.command.
-- ============================================================================

-- ── 1. Keep the candidate query cheap as posts grows ────────────────────────
--
-- The worker asks for published posts with no frozen report. Without this that
-- is a scan of every published post ever, every two minutes. Partial on exactly
-- the worker's predicate, so the index holds only posts still owed a report and
-- shrinks back as they are frozen.
CREATE INDEX IF NOT EXISTS posts_copy_review_unfrozen_idx
  ON public.posts (published_at)
  WHERE status = 'published'
    AND (workflow_state -> 'copy_review' -> 'final') IS NULL;

-- ── 2. Schedule the worker ──────────────────────────────────────────────────

DO $$
DECLARE
  job_id   bigint;
  base_url text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron is not installed. Enable it via Database > Extensions, then re-apply.';
  END IF;

  -- Refuse without the secret. A job that cannot authenticate would 401 every
  -- two minutes while pg_cron recorded each run as succeeded.
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'function_invoke_secret'
  ) THEN
    RAISE EXCEPTION
      'Vault has no secret named function_invoke_secret. The job would be refused by '
      'the function on every run, and pg_cron would still record success.';
  END IF;

  -- Derived from an existing job rather than hardcoded, so this cannot point at
  -- the wrong project.
  SELECT substring(command from 'https://[a-z0-9]+\.supabase\.co')
    INTO base_url
  FROM cron.job
  WHERE command LIKE '%functions/v1/%'
  LIMIT 1;

  IF base_url IS NULL THEN
    RAISE EXCEPTION
      'Could not determine the project URL from any existing cron job. Refusing to '
      'guess: a job pointed at the wrong host fails silently forever.';
  END IF;

  -- Idempotent: unschedule-then-schedule, so a re-run cannot leave two jobs.
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'finalize-copy-reviews' LIMIT 1;
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;

  PERFORM cron.schedule(
    'finalize-copy-reviews',
    '*/2 * * * *',
    format($job$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
          'X-Invoke-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'function_invoke_secret' LIMIT 1)
        ),
        body := '{}'::jsonb
      )
    $job$, base_url || '/functions/v1/finalize-copy-reviews')
  );
END
$$;

-- ── 3. Post-conditions ──────────────────────────────────────────────────────
--
-- The job is registered, active and able to authenticate, and the index exists.
-- A worker installed but never scheduled — or scheduled without the header that
-- authorises it — is the stale-guard failure this repository has been bitten by.
DO $$
DECLARE
  cmd text;
BEGIN
  SELECT command INTO cmd FROM cron.job
  WHERE jobname = 'finalize-copy-reviews' AND active LIMIT 1;

  IF cmd IS NULL THEN
    RAISE EXCEPTION 'post-condition failed: the finalize-copy-reviews cron job is missing or inactive';
  END IF;

  IF cmd NOT LIKE '%X-Invoke-Secret%' THEN
    RAISE EXCEPTION
      'post-condition failed: the job does not send X-Invoke-Secret. Every run would be '
      'refused while pg_cron recorded it as succeeded.';
  END IF;

  IF cmd NOT LIKE '%/functions/v1/finalize-copy-reviews%' THEN
    RAISE EXCEPTION 'post-condition failed: the job does not call finalize-copy-reviews';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'posts_copy_review_unfrozen_idx'
  ) THEN
    RAISE EXCEPTION 'post-condition failed: posts_copy_review_unfrozen_idx was not created';
  END IF;

  RAISE NOTICE 'finalize-copy-reviews scheduled every 2 minutes; unfrozen-report index present';
END
$$;
