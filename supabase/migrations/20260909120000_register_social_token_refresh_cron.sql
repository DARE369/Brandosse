-- 20260909120000_register_social_token_refresh_cron.sql
--
-- Registers the refresh-social-tokens edge function on pg_cron.
--
-- ── Why ──────────────────────────────────────────────────────────────────────
-- Migration 20260904120000 created connected_account_secrets with refresh_after,
-- last_refreshed_at, refresh_failures and last_refresh_error, and said in its
-- own comment that they exist "so a refresh worker can find expiring rows".
-- The columns have been written at connect time and read by nothing since: the
-- worker did not exist, so no stored token has ever been refreshed.
--
-- TikTok access tokens last 24 hours. Until this job runs, any post scheduled
-- more than a day ahead fails at publish with access_token_invalid, which
-- reaches the user as "TikTok signed you out" — a message about a sign-out
-- that never happened.
--
-- ── Cadence ──────────────────────────────────────────────────────────────────
-- Every 30 minutes. The worker refreshes at 80% of a token's life, so for a
-- 24-hour TikTok token the refresh window opens with ~4.8 hours to spare. A
-- half-hourly sweep uses that window many times over, which means a provider
-- outage or a failed run has room to recover long before anything expires.
--
-- Following 20260710120000, the service-role key is read from Vault inside the
-- scheduled command, so no secret value appears in this file or in cron.job.

BEGIN;

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

  -- Idempotent: unschedule any existing registration before re-adding, so
  -- re-applying this migration cannot leave two jobs racing each other. That
  -- matters more than usual here — TikTok rotates refresh tokens, so two
  -- concurrent refreshes of one account each invalidate the other's token.
  -- (The worker also claims rows with a compare-and-swap, so this is the
  -- second of two independent defences, not the only one.)
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'refresh-social-tokens' LIMIT 1;
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;

  PERFORM cron.schedule(
    'refresh-social-tokens',
    '*/30 * * * *',
    $job$
    SELECT net.http_post(
      url     := 'https://ujkuwemwlhilzarbrozu.supabase.co/functions/v1/refresh-social-tokens',
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

-- ── Post-condition ───────────────────────────────────────────────────────────
-- Assert the job actually exists. A migration that silently fails to register
-- its job is indistinguishable from one that worked, right up until tokens
-- start expiring weeks later.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'refresh-social-tokens'
      AND active
  ) THEN
    RAISE EXCEPTION 'Post-condition failed: cron job refresh-social-tokens is not registered and active.';
  END IF;
END;
$$;

COMMIT;
