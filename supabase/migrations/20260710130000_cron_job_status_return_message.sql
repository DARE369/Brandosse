-- ============================================================================
-- Migration: cron_job_status_return_message
-- Purpose: process-scheduled-posts reported "failed" via healthCheck
-- immediately after being registered. Extend get_cron_job_status() to also
-- surface cron.job_run_details.return_message (the actual error/return text
-- from the run) so the failure is diagnosable without direct DB access.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_cron_job_status();

CREATE OR REPLACE FUNCTION public.get_cron_job_status()
RETURNS TABLE (
  job_name        text,
  schedule        text,
  is_active       boolean,
  last_run_at     timestamptz,
  last_status     text,
  last_message    text
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
    r.last_status,
    r.last_message
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
  WHERE j.jobname IN ('process-scheduled-posts', 'process-risk-alerts', 'credit-monthly-reset');
$$;

GRANT EXECUTE ON FUNCTION public.get_cron_job_status() TO service_role;
