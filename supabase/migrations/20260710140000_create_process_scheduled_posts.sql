-- ============================================================================
-- Migration: create_process_scheduled_posts
-- Purpose: the process-scheduled-posts cron job (registered in
--   20260710120000_vault_based_cron_secrets.sql) failed on its first run
--   with "function public.process_scheduled_posts() does not exist" —
--   confirmed via healthCheck's return_message. The original definition in
--   20260601000000_scheduled_publish_worker.sql apparently never actually
--   ran against the live database (the same "migration file exists in the
--   repo but was never applied" pattern already found for that file's
--   posts.* ADD COLUMN statements during Phase 6). This migration creates
--   it for real. dispatch_scheduled_post() (which this calls) was already
--   created/fixed by 20260710120000_vault_based_cron_secrets.sql.
-- ============================================================================

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
