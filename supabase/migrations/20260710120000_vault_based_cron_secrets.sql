-- ============================================================================
-- Migration: vault_based_cron_secrets
-- Purpose:
--   ALTER DATABASE ... SET app.* is not permitted for any user-facing role
--   on this Supabase-hosted project (confirmed live, both CLI and Dashboard
--   SQL Editor return 42501 permission denied). Every cron/http-callout
--   function in this project that read app.service_role_key /
--   app.supabase_url / app.edge_function_base_url via current_setting()
--   could therefore never have worked — this is the root cause of Phase 7
--   findings #1 and #2 (process-scheduled-posts, process-risk-alerts,
--   credit-monthly-reset all confirmed "missing" via the new healthCheck
--   endpoint after deploy).
--
--   Fix: use Supabase Vault (vault.create_secret / vault.decrypted_secrets)
--   instead of database-level GUCs. Storing a secret in Vault is a normal
--   function call (effectively an encrypted table insert), not a
--   database-level ALTER — it works within the same privileges this
--   migration role already has. This migration updates
--   dispatch_scheduled_post() to read the service-role key from Vault
--   instead of current_setting(), and registers all three missing cron
--   jobs with cron bodies that look the key up from Vault at execution
--   time — so none of this file contains an actual secret value and it is
--   safe to commit.
--
--   ONE MANUAL STEP STILL REQUIRED (cannot be done via a committed
--   migration — see chat): run, once, in the Supabase Dashboard SQL Editor,
--   with your real service role key:
--     select vault.create_secret('<your-real-service-role-key>', 'service_role_key', 'Used by dispatch_scheduled_post() and the process-risk-alerts / credit-monthly-reset cron jobs to call edge functions.');
--   Until that secret exists, dispatch_scheduled_post() logs a warning and
--   skips (does not crash the cron run), and the two net.http_post-based
--   cron jobs will get a NULL Authorization bearer token and fail with 401
--   at the target function — visible via healthCheck as "failing" rather
--   than "missing" once registered.
-- ============================================================================

-- ── Fix dispatch_scheduled_post() to use Vault instead of current_setting() ──
CREATE OR REPLACE FUNCTION public.dispatch_scheduled_post(
  p_post_id         uuid,
  p_account_id      uuid,
  p_user_id         uuid,
  p_organization_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service_key  text;
  v_function_url text := 'https://ujkuwemwlhilzarbrozu.supabase.co/functions/v1/publish-post';
BEGIN
  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  IF v_service_key IS NULL THEN
    RAISE WARNING 'dispatch_scheduled_post: service_role_key not found in Vault — skipping dispatch for post %. Run vault.create_secret(...) once via the SQL Editor (see migration header).', p_post_id;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_function_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    := jsonb_build_object(
      'post_id',              p_post_id::text,
      'connected_account_id', p_account_id::text,
      'user_id',              p_user_id::text,
      'organization_id',      p_organization_id::text
    )::text
  );
END;
$$;

-- ── Register: process-scheduled-posts (every minute) ────────────────────────
-- No secret needed in the job body itself — process_scheduled_posts() calls
-- dispatch_scheduled_post(), which now looks up Vault internally (above).
DO $$
DECLARE
  job_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron extension is not installed. Enable it via Database > Extensions in the Supabase dashboard, then re-apply this migration.';
  END IF;

  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'process-scheduled-posts' LIMIT 1;
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;

  PERFORM cron.schedule(
    'process-scheduled-posts',
    '* * * * *',
    $job$SELECT public.process_scheduled_posts();$job$
  );
END;
$$;

-- ── Register: process-risk-alerts (every 15 minutes) ─────────────────────────
-- Vault lookup happens at execution time inside the scheduled command
-- itself, so no secret value appears in this file.
DO $$
DECLARE
  job_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'pg_net extension is not installed. Enable it via Database > Extensions in the Supabase dashboard, then re-apply this migration.';
  END IF;

  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'process-risk-alerts' LIMIT 1;
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;

  PERFORM cron.schedule(
    'process-risk-alerts',
    '*/15 * * * *',
    $job$
    SELECT net.http_post(
      url     := 'https://ujkuwemwlhilzarbrozu.supabase.co/functions/v1/process-risk-alerts',
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

-- ── Register: credit-monthly-reset (00:00 UTC on the 1st of each month) ─────
DO $$
DECLARE
  job_id bigint;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'credit-monthly-reset' LIMIT 1;
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;

  PERFORM cron.schedule(
    'credit-monthly-reset',
    '0 0 1 * *',
    $job$
    SELECT net.http_post(
      url     := 'https://ujkuwemwlhilzarbrozu.supabase.co/functions/v1/credit-monthly-reset',
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
