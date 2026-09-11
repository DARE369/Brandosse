-- 20260911140000_register_analytics_ingestion_cron.sql
--
-- Seed the Analytics API's own quota meter, and put the ingestion worker on a
-- schedule.
--
-- ── The meter that was missing ──────────────────────────────────────────────
-- 20260911120000 seeded youtube/general (the Data API's 10,000 weighted units)
-- and youtube/videos_insert (uploads, counted separately). It did NOT seed a
-- meter for the ANALYTICS API, which is a different host, a different scope,
-- and a separate quota pool.
--
-- Without this row the worker refuses to start — deliberately. It reads
-- social_api_quota_today for youtube/analytics and throws quota_not_configured
-- rather than calling an API with no budget to check against. Failing closed
-- is the point: the alternative is spending an allowance nobody is counting,
-- which is precisely the condition the ledger exists to prevent.
--
-- Had the worker instead fallen back to the `general` meter, analytics reads
-- would have been charged against the upload allowance — costing the ability
-- to publish by reading analytics, which is the exact conflation the two-meter
-- design was built to avoid.
--
-- ── Why the limit is flagged as unverified ──────────────────────────────────
-- Google documents the Data API's unit costs precisely and the Analytics API's
-- far less so. 10,000 is stated here as a WORKING budget rather than a verified
-- ceiling: the ledger counts requests accurately either way, and if the real
-- allowance differs this is one row to correct rather than a redeploy. The note
-- column says so, rather than letting the number read as fact.
--
-- ── Cadence ─────────────────────────────────────────────────────────────────
-- Every six hours, not hourly. YouTube's `day` dimension only changes once per
-- day, so hourly polling would spend four times the quota to re-read numbers
-- that had not moved. Four passes a day is enough to pick up YouTube's own
-- revisions of recent days while leaving budget for backfills.
--
-- VERIFY:
--   SELECT * FROM public.social_api_quota_today WHERE platform = 'youtube';
--   SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
--
-- SAFE TO RE-RUN: yes.

BEGIN;

-- ── 1. The analytics meter ──────────────────────────────────────────────────

INSERT INTO public.social_api_quota_limits
  (platform, quota_key, daily_limit, unit, reset_timezone, reserve_percent, notes)
VALUES
  ('youtube', 'analytics', 10000, 'requests', 'America/Los_Angeles', 20,
   'YouTube ANALYTICS API (youtubeanalytics.googleapis.com/v2/reports) — a separate '
   'pool from the Data API units, counted per request. UNVERIFIED CEILING: this is a '
   'conservative working budget, not a figure confirmed against Google documentation. '
   'Correct this row if the real allowance differs; the ledger counts requests '
   'accurately regardless.')
ON CONFLICT (platform, quota_key) DO UPDATE
SET daily_limit     = excluded.daily_limit,
    unit            = excluded.unit,
    reset_timezone  = excluded.reset_timezone,
    reserve_percent = excluded.reserve_percent,
    notes           = excluded.notes,
    updated_at      = now();

-- ── 2. Schedule the worker ──────────────────────────────────────────────────
--
-- Same two-header pattern as 20260910120000: Authorization satisfies the API
-- gateway's JWT validation, X-Invoke-Secret is the actual authorisation the
-- function checks. Both read from Vault, so no secret enters this file or
-- cron.job.command.

DO $$
DECLARE
  job_id   bigint;
  base_url text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron is not installed. Enable it via Database > Extensions, then re-apply.';
  END IF;

  -- Refuse without the secret. Registering a job that cannot authenticate
  -- would replace "no ingestion" with "ingestion that 401s four times a day",
  -- and pg_cron reports both as a successful run.
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'function_invoke_secret'
  ) THEN
    RAISE EXCEPTION
      'Vault has no secret named function_invoke_secret. The job would be refused by '
      'the function on every run, and pg_cron would still record success.';
  END IF;

  -- Derived from an existing job rather than hardcoded, so this cannot point
  -- at the wrong project.
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

  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'ingest-social-analytics' LIMIT 1;
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;

  PERFORM cron.schedule(
    'ingest-social-analytics',
    '43 */6 * * *',   -- four times daily, off the hour so it misses the other jobs
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
    $job$, base_url || '/functions/v1/ingest-social-analytics')
  );
END
$$;

-- ── 3. Post-conditions ──────────────────────────────────────────────────────

DO $$
DECLARE
  q   record;
  cmd text;
  n   integer;
BEGIN
  -- 3a. The meter exists and the view can compute against it. Without this the
  --     worker refuses to run at all.
  SELECT * INTO q FROM public.social_api_quota_today
  WHERE platform = 'youtube' AND quota_key = 'analytics';

  IF q IS NULL THEN
    RAISE EXCEPTION
      'post-condition failed: social_api_quota_today has no youtube/analytics row — the '
      'ingestion worker will refuse to start with quota_not_configured';
  END IF;

  IF q.remaining <= 0 THEN
    RAISE EXCEPTION
      'post-condition failed: youtube/analytics has no remaining budget on its first day '
      '(limit %, spent %) — the worker would skip every account immediately',
      q.daily_limit, q.spent;
  END IF;

  -- 3b. Analytics must NOT share the upload meter. If these were ever merged,
  --     reading analytics would consume the ability to publish.
  SELECT count(DISTINCT quota_key) INTO n
  FROM public.social_api_quota_limits WHERE platform = 'youtube';
  IF n < 3 THEN
    RAISE EXCEPTION
      'post-condition failed: YouTube must meter general, videos_insert and analytics '
      'separately; found only % meter(s)', n;
  END IF;

  -- 3c. The job is registered, active, and carries the header that authorises
  --     it. A job sending only Authorization is the defect 20260910120000 and
  --     20260910130000 were both written to close.
  SELECT command INTO cmd FROM cron.job
  WHERE jobname = 'ingest-social-analytics' AND active LIMIT 1;

  IF cmd IS NULL THEN
    RAISE EXCEPTION 'post-condition failed: the ingest-social-analytics cron job is missing or inactive';
  END IF;
  IF cmd NOT LIKE '%X-Invoke-Secret%' THEN
    RAISE EXCEPTION
      'post-condition failed: the job does not send X-Invoke-Secret. Every run would be '
      'refused while pg_cron recorded it as succeeded.';
  END IF;
  IF cmd NOT LIKE '%function_invoke_secret%' THEN
    RAISE EXCEPTION
      'post-condition failed: the job does not read the secret from Vault — a literal '
      'secret in cron.job.command is readable by anyone who can query it';
  END IF;

  RAISE NOTICE 'analytics ingestion scheduled: % requests usable today, resets midnight %',
    q.remaining, q.reset_timezone;
END
$$;

COMMIT;
