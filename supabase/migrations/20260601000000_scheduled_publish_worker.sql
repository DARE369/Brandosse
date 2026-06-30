-- =============================================================================
-- Scheduled Publish Worker
-- =============================================================================
-- Runs every minute via pg_cron + pg_net.
-- Finds posts due for publishing, calls the publish-post edge function for each.
--
-- The edge function handles both mock and real accounts automatically
-- based on connected_accounts.is_mock.
-- =============================================================================

-- ── Helper: dispatch a single post to the publish-post edge function ──────────

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
  v_supabase_url  text := current_setting('app.supabase_url',  true);
  v_service_key   text := current_setting('app.service_role_key', true);
  v_function_url  text;
BEGIN
  -- Build the edge function URL
  v_function_url := v_supabase_url || '/functions/v1/publish-post';

  -- Call publish-post via pg_net (fire-and-forget HTTP request)
  PERFORM net.http_post(
    url     := v_function_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    := jsonb_build_object(
      'post_id',             p_post_id::text,
      'connected_account_id', p_account_id::text,
      'user_id',             p_user_id::text,
      'organization_id',     p_organization_id::text
    )::text
  );
END;
$$;

-- ── Main worker: find and dispatch all due scheduled posts ────────────────────

CREATE OR REPLACE FUNCTION public.process_scheduled_posts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  -- Find posts that are:
  --   1. status = 'scheduled'
  --   2. scheduled_at <= now()
  --   3. Have a connected account in 'active' state
  --   4. Not currently being published (no concurrent dispatch)
  FOR r IN
    SELECT
      p.id              AS post_id,
      p.user_id,
      p.organization_id,
      p.platform,
      ca.id             AS account_id
    FROM posts p
    INNER JOIN connected_accounts ca
      ON  ca.user_id   = p.user_id
      AND ca.connection_status = 'active'
      AND ca.deleted_at IS NULL
      AND (
        (p.account_id IS NOT NULL AND ca.id = p.account_id)
        OR (
          p.account_id IS NULL
          AND ca.platform = p.platform
          AND (
            (p.organization_id IS NULL AND ca.organization_id IS NULL)
            OR ca.organization_id = p.organization_id
          )
        )
      )
    WHERE
      p.status        = 'scheduled'
      AND p.scheduled_at <= now()
      -- Cap: process at most 50 posts per run to avoid overload
    LIMIT 50
  LOOP
    -- Mark as publishing immediately to prevent duplicate dispatch
    UPDATE posts
    SET
      status     = 'publishing',
      updated_at = now()
    WHERE
      id     = r.post_id
      AND status = 'scheduled';  -- only update if still scheduled (race guard)

    IF FOUND THEN
      PERFORM public.dispatch_scheduled_post(
        r.post_id,
        r.account_id,
        r.user_id,
        r.organization_id
      );
    END IF;
  END LOOP;
END;
$$;

-- ── Register cron job: run every minute ──────────────────────────────────────

DO $$
BEGIN
  -- Only register if pg_cron + pg_net are available
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
  AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN

    -- Remove existing job if it exists
    PERFORM cron.unschedule(job_id)
    FROM cron.job
    WHERE jobname = 'process-scheduled-posts';

    -- Register: every minute
    PERFORM cron.schedule(
      'process-scheduled-posts',
      '* * * * *',
      $$SELECT public.process_scheduled_posts();$$
    );

    RAISE NOTICE 'Scheduled publish worker registered (every minute)';
  ELSE
    RAISE NOTICE 'pg_cron or pg_net not available — scheduled publish worker not registered. Run manually via: SELECT public.process_scheduled_posts();';
  END IF;
END
$$;

-- ── Add missing columns to posts if not already present ──────────────────────

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS platform_post_id   text,
  ADD COLUMN IF NOT EXISTS platform_post_url  text,
  ADD COLUMN IF NOT EXISTS failure_reason     text,
  ADD COLUMN IF NOT EXISTS published_at       timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failure_at    timestamptz;

-- Index: find due scheduled posts efficiently
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_due
  ON public.posts (status, scheduled_at)
  WHERE status = 'scheduled';

-- RLS: dispatch function runs as SECURITY DEFINER, so no additional policy needed.
-- The publish-post edge function validates ownership via user_id checks.
