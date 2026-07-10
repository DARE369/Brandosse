-- ============================================================================
-- Migration: cron_reliability_and_credit_reset
-- Purpose (Phase 7 self-audit findings #1 and #2):
--
--   Confirmed live (2026-07-10): ALTER DATABASE ... SET app.* is not
--   permitted for any user-facing role on this Supabase-hosted project
--   (both the CLI migration role and the Dashboard SQL Editor role hit
--   42501 permission denied). This means the original cron design — reading
--   the edge-function URL and service-role key via current_setting('app.*')
--   at cron-registration time — could never have worked here, which is
--   *why* process-scheduled-posts and process-risk-alerts silently never
--   registered in the first place (RAISE NOTICE only, no exception, so this
--   went unnoticed).
--
--   This migration only contains the secret-free half of the fix:
--   public.get_cron_job_status(), which the healthCheck edge function calls
--   to report live cron.job / cron.job_run_details state on an ongoing
--   basis. The actual cron.schedule() registration calls for
--   process-scheduled-posts, process-risk-alerts, and credit-monthly-reset
--   are NOT in this file — they need the real service-role key embedded in
--   the scheduled command text, which must never be committed to a
--   git-tracked migration. Those three cron.schedule() statements are
--   provided separately (see chat) for you to run directly in the Supabase
--   Dashboard SQL Editor with your real key filled in.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_cron_job_status()
RETURNS TABLE (
  job_name      text,
  schedule      text,
  is_active     boolean,
  last_run_at   timestamptz,
  last_status   text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT
    j.jobname,
    j.schedule,
    j.active,
    r.last_run_at,
    r.last_status
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT
      d.end_time AS last_run_at,
      d.status   AS last_status
    FROM cron.job_run_details d
    WHERE d.jobid = j.jobid
    ORDER BY d.end_time DESC NULLS LAST
    LIMIT 1
  ) r ON true
  WHERE j.jobname IN ('process-scheduled-posts', 'process-risk-alerts', 'credit-monthly-reset');
$$;

GRANT EXECUTE ON FUNCTION public.get_cron_job_status() TO service_role;
