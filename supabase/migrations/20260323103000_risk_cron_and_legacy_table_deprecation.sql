-- ============================================================================
-- Migration: risk_cron_and_legacy_table_deprecation
-- Date: 2026-03-23
-- Purpose:
--   1) Register the risk alert processor cron job when pg_cron + pg_net are available
--   2) Mark dormant legacy tables as deprecated without dropping them
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_net;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Skipping pg_net extension creation due to insufficient privilege.';
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Skipping pg_cron extension creation due to insufficient privilege.';
    END;
  END IF;
END;
$$;

DO $$
DECLARE
  existing_job_id bigint;
  edge_base_url text := current_setting('app.edge_function_base_url', true);
  service_role_key text := current_setting('app.service_role_key', true);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'Skipping process-risk-alerts cron registration because pg_cron or pg_net is unavailable.';
    RETURN;
  END IF;

  IF edge_base_url IS NULL OR service_role_key IS NULL THEN
    RAISE NOTICE 'Skipping process-risk-alerts cron registration because app.edge_function_base_url or app.service_role_key is not configured.';
    RETURN;
  END IF;

  SELECT jobid
  INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'process-risk-alerts'
  LIMIT 1;

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'process-risk-alerts',
    '*/15 * * * *',
    format(
      $job$
      SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := '{}'::jsonb
      )
      $job$,
      edge_base_url || '/process-risk-alerts',
      jsonb_build_object(
        'Authorization',
        'Bearer ' || service_role_key
      )::text
    )
  );
END;
$$;

COMMENT ON TABLE public.admin_keys IS
  'LEGACY / dormant as of 2026-03-23. Do not use for new development.';

COMMENT ON TABLE public.admin_logs IS
  'LEGACY / dormant as of 2026-03-23. Use public.audit_logs instead.';

COMMENT ON TABLE public.analytics_summary IS
  'LEGACY / dormant as of 2026-03-23. No active runtime readers in the routed app.';

COMMENT ON TABLE public.generated_content IS
  'LEGACY / dormant as of 2026-03-23. Active generation flow uses public.generations.';

COMMENT ON TABLE public.generation_assets IS
  'LEGACY / dormant as of 2026-03-23. Active generation flow stores media on public.generations/public.posts.';

COMMENT ON TABLE public.generation_metadata IS
  'LEGACY / dormant as of 2026-03-23. Active generation flow stores metadata on public.generations.';

COMMENT ON TABLE public.generation_sessions IS
  'LEGACY / dormant as of 2026-03-23. Active routed app uses public.sessions.';

COMMENT ON TABLE public.moderation_queue IS
  'LEGACY / dormant as of 2026-03-23. Active moderation flow uses public.posts + public.content_quality_reviews.';

COMMENT ON TABLE public.platforms IS
  'LEGACY / dormant as of 2026-03-23. Active runtime uses text platform keys instead.';

COMMENT ON TABLE public.scheduled_generations IS
  'LEGACY / dormant as of 2026-03-23. Active scheduling flow uses public.posts.';
