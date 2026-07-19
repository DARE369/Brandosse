-- ============================================================================
-- Migration: week3_process_jobs_cron
-- Purpose (Week 3 Fix 3): register the process-jobs fallback sweep on
-- pg_cron, reusing the exact Vault-based service-role-key lookup pattern
-- already proven working by process-scheduled-posts/process-risk-alerts
-- (20260710120000_vault_based_cron_secrets.sql) — no new infrastructure,
-- per the fix's own "exhaust in-repo options before documenting a manual
-- step" instruction. Runs every minute; process-jobs itself only touches
-- 'running' video jobs whose started_at is more than 45s old, so a 1-minute
-- cadence does not create redundant reconciliation churn for jobs the
-- webhook is about to (or just did) finalize.
--
-- Rollback: SELECT cron.unschedule('process-jobs'); (idempotent — this
-- migration itself unschedules any prior registration by the same name
-- before re-registering, so re-running it is also safe.)
-- ============================================================================

DO $$
DECLARE
  job_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron extension is not installed. Enable it via Database > Extensions in the Supabase dashboard, then re-apply this migration.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'pg_net extension is not installed. Enable it via Database > Extensions in the Supabase dashboard, then re-apply this migration.';
  END IF;

  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'process-jobs' LIMIT 1;
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;

  PERFORM cron.schedule(
    'process-jobs',
    '* * * * *',
    $job$
    SELECT net.http_post(
      url     := 'https://ujkuwemwlhilzarbrozu.supabase.co/functions/v1/process-jobs',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := '{}'::jsonb
    )
    $job$
  );
END;
$$;
