-- 20260821180000_unblind_cron_monitoring.sql
--
-- LOCK L0.3 — make job monitoring report ALL scheduled jobs, not a hardcoded
-- subset. Pulled forward from Wave 0 because it now blocks verification.
--
-- ── The defect ───────────────────────────────────────────────────────────────
-- public.get_cron_job_status() (20260710110000_cron_reliability_and_credit_reset.sql:55)
-- ends with:
--
--     WHERE j.jobname IN ('process-scheduled-posts',
--                         'process-risk-alerts',
--                         'credit-monthly-reset');
--
-- A hardcoded allowlist. Any job not named there is invisible to monitoring by
-- construction — and the healthCheck edge function calls this function, so
-- production health reports "all clear" while an unknown number of jobs run
-- unobserved.
--
-- ── What it already cost ─────────────────────────────────────────────────────
-- `daily-analysis` ran every day at 02:00 UTC for roughly five months, writing
-- fabricated trend data into trending_topics (~1,200 rows, two distinct topics
-- in total), and never appeared in monitoring. During the launch audit this
-- allowlist produced a false conclusion — that the job did not run at all —
-- which had to be corrected from row timestamps.
--
-- ── Why it is being pulled forward ───────────────────────────────────────────
-- LOCK L2.3 has just added `reap-stuck-records`. Its correctness depends on the
-- cron job actually firing every 5 minutes, and that CANNOT BE VERIFIED while
-- this allowlist exists — the new job is invisible for exactly the same reason
-- the fabricated-data job was. A guard that cannot be observed is not a guard.
--
-- ── Fix ──────────────────────────────────────────────────────────────────────
-- Report every row in cron.job. Add an `is_known` flag so unexpected jobs are
-- visible rather than filtered — the failure mode here was omission, so the new
-- version must surface surprises instead of hiding them.
--
-- VERIFY: SELECT * FROM public.get_cron_job_status();
--         must list reap-stuck-records and any daily-analysis schedule.
-- SAFE TO RE-RUN: yes

BEGIN;

DROP FUNCTION IF EXISTS public.get_cron_job_status();

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
    -- Expected jobs are flagged, but NOT filtered. An unrecognised job is the
    -- single most important thing this function can tell you — that is exactly
    -- what the previous allowlist suppressed.
    (j.jobname IN (
      'process-scheduled-posts',
      'process-risk-alerts',
      'credit-monthly-reset',
      'reap-stuck-records'
    )) AS is_known
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT
      d.end_time   AS last_run_at,
      d.status     AS last_status,
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

COMMENT ON FUNCTION public.get_cron_job_status() IS
  'LOCK L0.3 — reports EVERY row in cron.job. Never reintroduce a jobname allowlist: the previous version hid a job that wrote fabricated data daily for five months. is_known flags unexpected jobs rather than filtering them.';

-- ── Post-condition ───────────────────────────────────────────────────────────

DO $$
DECLARE
  visible_jobs int;
  actual_jobs  int;
BEGIN
  SELECT count(*) INTO visible_jobs FROM public.get_cron_job_status();
  SELECT count(*) INTO actual_jobs  FROM cron.job;

  IF visible_jobs <> actual_jobs THEN
    RAISE EXCEPTION
      'L0.3 post-condition failed: monitoring reports % job(s) but cron.job holds % — the function is still filtering',
      visible_jobs, actual_jobs;
  END IF;

  RAISE NOTICE 'L0.3: cron monitoring un-blinded — % job(s) visible, 0 filtered', visible_jobs;
END;
$$;

COMMIT;
