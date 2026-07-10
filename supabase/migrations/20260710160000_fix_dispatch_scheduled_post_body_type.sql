-- ============================================================================
-- Migration: fix_dispatch_scheduled_post_body_type
-- Purpose: process-scheduled-posts' first real run (2026-07-10) failed with
--   "function net.http_post(url => text, headers => jsonb, body => text)
--   does not exist" — net.http_post's body parameter is jsonb, but
--   dispatch_scheduled_post() (as inherited verbatim from the original,
--   never-applied 20260601000000_scheduled_publish_worker.sql, and carried
--   over into 20260710120000_vault_based_cron_secrets.sql) cast the body to
--   ::text. This bug existed in the source from the start and was only
--   caught now because the function had never actually executed before
--   today. Fix: drop the ::text cast, pass jsonb directly.
-- ============================================================================

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
    RAISE WARNING 'dispatch_scheduled_post: service_role_key not found in Vault — skipping dispatch for post %.', p_post_id;
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
    )
  );
END;
$$;
