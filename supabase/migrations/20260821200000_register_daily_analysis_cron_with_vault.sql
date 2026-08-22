-- 20260821200000_register_daily_analysis_cron_with_vault.sql
--
-- WAVE 1 / LOCK L1.7 — bring the `daily-calendar-analysis` cron job under
-- version control and stop it authenticating with the PUBLIC anon key.
--
-- ── How this was found ───────────────────────────────────────────────────────
-- LOCK L0.3 un-blinded get_cron_job_status(), revealing 7 scheduled jobs where
-- monitoring had reported 3. `daily-calendar-analysis` was among the hidden
-- four and, uniquely, had NO migration anywhere in the repository — it was
-- created by hand, presumably via the SQL Editor. That is why the launch audit
-- could not name the process writing fabricated trend data every night: it
-- existed only in the live database.
--
-- ── The defect ───────────────────────────────────────────────────────────────
-- The hand-created job called the edge function with a hardcoded JWT whose
-- payload decodes to {"role":"anon"} — byte-identical to
-- NEXT_PUBLIC_SUPABASE_ANON_KEY, i.e. the key shipped in the client bundle and
-- therefore public by design.
--
-- Verified live 2026-08-21:
--   POST /functions/v1/daily-analysis  with ONLY the public anon key -> HTTP 200
--   Response body disclosed all 12 active user IDs.
--
-- Two consequences:
--   1. INFORMATION DISCLOSURE — any visitor can enumerate every active user id.
--      Those UUIDs are the lookup key for other endpoints, so this is useful
--      material for a follow-on attack, not a curiosity.
--   2. UNAUTHENTICATED RESOURCE ABUSE — each call iterates every active profile
--      with several queries per user. There is no auth guard and no rate limit,
--      so it can be driven at will by anyone.
--
-- An audit sweep of all 52 edge functions found 46 guarded and 5 more using a
-- legitimate token scheme (job-webhook, pipeline-client-action,
-- org-complete-invitation-signup, credit-monthly-reset, and healthCheck which
-- is deliberately public and returns no sensitive data). `daily-analysis` was
-- the ONLY genuinely exposed function.
--
-- ── Fix ──────────────────────────────────────────────────────────────────────
-- Re-register the job using the vault-based service-role pattern already
-- established for process-scheduled-posts / process-risk-alerts / process-jobs
-- (20260710120000_vault_based_cron_secrets.sql). The secret is looked up at
-- execution time, so no key value appears in this file OR in cron.job.command.
--
-- ORDERING — IMPORTANT:
--   Apply this migration BEFORE deploying the matching service-role guard in
--   supabase/functions/daily-analysis/index.ts. In this order the job keeps
--   working throughout: it starts sending a service-role token while the
--   function still accepts anything, then the deploy closes the door behind it.
--   The reverse order would 401 the nightly run until the migration landed.
--
-- VERIFY: SELECT job_name, is_known FROM public.get_cron_job_status()
--           WHERE job_name = 'daily-calendar-analysis';
--         then, after deploying the function guard:
--           curl -X POST .../functions/v1/daily-analysis -H "Authorization: Bearer <ANON>"
--           must return 401.
-- SAFE TO RE-RUN: yes

BEGIN;

DO $$
DECLARE
  job_id bigint;
  has_secret boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron is not installed. Enable it via Database > Extensions, then re-apply.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'pg_net is not installed. Enable it via Database > Extensions, then re-apply.';
  END IF;

  -- The vault secret must already exist — every other cron job depends on it.
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key'
  ) INTO has_secret;

  IF NOT has_secret THEN
    RAISE EXCEPTION
      'service_role_key is not in Vault. Run once via the SQL Editor: '
      'SELECT vault.create_secret(''<service-role-key>'', ''service_role_key'', ''Used by cron jobs to call edge functions.''); '
      'Then re-apply this migration.';
  END IF;

  -- Replace the hand-created registration (which carried the public anon key).
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'daily-calendar-analysis' LIMIT 1;
  IF job_id IS NOT NULL THEN
    RAISE NOTICE 'L1.7: unscheduling the hand-created daily-calendar-analysis job (it authenticated with the PUBLIC anon key)';
    PERFORM cron.unschedule(job_id);
  END IF;

  PERFORM cron.schedule(
    'daily-calendar-analysis',
    '0 2 * * *',
    $job$
    SELECT net.http_post(
      url     := 'https://ujkuwemwlhilzarbrozu.supabase.co/functions/v1/daily-analysis',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body    := '{}'::jsonb
    ) AS request_id;
    $job$
  );

  RAISE NOTICE 'L1.7: daily-calendar-analysis re-registered with vault-based service-role auth';
END;
$$;

-- ── Teach monitoring that this job is expected ───────────────────────────────
-- It is now registered in a migration, so it is no longer a surprise. Any job
-- still flagged is_known = false after this is genuinely unaccounted for.

CREATE OR REPLACE FUNCTION public.get_cron_job_status()
RETURNS TABLE (
  job_name     text,
  schedule     text,
  is_active    boolean,
  last_run_at  timestamptz,
  last_status  text,
  last_message text,
  is_known     boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT
    j.jobname::text,
    j.schedule::text,
    j.active,
    r.last_run_at,
    r.last_status::text,
    r.last_message::text,
    (j.jobname IN (
      'process-scheduled-posts',
      'process-risk-alerts',
      'credit-monthly-reset',
      'reap-stuck-records',
      'cleanup-rate-limit-events',   -- 20260711010000
      'process-jobs',                -- 20260712120000
      'daily-calendar-analysis'      -- this migration
    )) AS is_known
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT
      d.end_time       AS last_run_at,
      d.status         AS last_status,
      d.return_message AS last_message
    FROM cron.job_run_details d
    WHERE d.jobid = j.jobid
    ORDER BY d.end_time DESC NULLS LAST
    LIMIT 1
  ) r ON true
  ORDER BY j.jobname;
$$;

REVOKE ALL ON FUNCTION public.get_cron_job_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cron_job_status() TO service_role;

-- ── Post-conditions ──────────────────────────────────────────────────────────

DO $$
DECLARE
  cmd        text;
  unknown_n  int;
BEGIN
  SELECT command INTO cmd FROM cron.job WHERE jobname = 'daily-calendar-analysis' LIMIT 1;

  IF cmd IS NULL THEN
    RAISE EXCEPTION 'L1.7 post-condition failed: daily-calendar-analysis is not scheduled';
  END IF;

  -- The command must resolve the key from Vault, never embed a literal JWT.
  IF cmd NOT LIKE '%vault.decrypted_secrets%' THEN
    RAISE EXCEPTION 'L1.7 post-condition failed: job command does not use the Vault lookup';
  END IF;
  IF cmd LIKE '%eyJ%' THEN
    RAISE EXCEPTION 'L1.7 post-condition failed: job command still contains a literal JWT';
  END IF;

  SELECT count(*) INTO unknown_n
  FROM public.get_cron_job_status() WHERE is_known = false;

  RAISE NOTICE 'L1.7: registered with Vault auth, no literal JWT. Unaccounted-for jobs remaining: %', unknown_n;
END;
$$;

COMMIT;
