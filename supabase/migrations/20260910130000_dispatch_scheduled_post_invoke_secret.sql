-- 20260910130000_dispatch_scheduled_post_invoke_secret.sql
--
-- Fix the ONE remaining caller still using the old auth: the path that actually
-- publishes scheduled posts.
--
-- ── Why the previous migration missed it ────────────────────────────────────
-- 20260910120000 re-registered the cron JOBS, rewriting their commands. But
-- `process-scheduled-posts` does not call an edge function in its command — it
-- runs `SELECT public.process_scheduled_posts();`, which loops over due posts
-- and calls public.dispatch_scheduled_post(), and THAT is where the HTTP call
-- lives.
--
-- So rewriting cron commands fixed three jobs and left the single most important
-- caller untouched: the one that publishes users' scheduled content. It was
-- still sending only `Authorization: Bearer <service_role_key>`, which the edge
-- runtime no longer accepts (this project has Supabase's new API key system, so
-- the runtime holds an `sb_secret_…` value while Vault holds the legacy JWT).
--
-- The lesson is the one this repo keeps relearning: the caller was not where it
-- looked. The JOB that reaches this call site is named nothing like the function
-- it eventually invokes.
--
-- ── What changes ────────────────────────────────────────────────────────────
-- Exactly one thing: the request now also carries X-Invoke-Secret, read from
-- Vault. Everything else — the URL, the body, the SECURITY DEFINER context, the
-- skip-with-a-warning behaviour — is preserved.
--
-- ── Fail closed, and say WHICH secret is missing ────────────────────────────
-- The original skipped with a warning when service_role_key was absent, which
-- was right: a missing secret must not crash the whole cron run and strand every
-- other due post. That is kept, and extended to the new secret — but the two
-- warnings are DISTINCT, because "no gateway token" and "no invoke secret" are
-- different problems with different fixes, and one message for both is how the
-- original defect stayed invisible for so long.
--
-- PREREQUISITE: Vault must hold `function_invoke_secret`, matching the value set
-- via `npx supabase secrets set FUNCTION_INVOKE_SECRET=…`. Verify with:
--
--   SELECT length(decrypted_secret),
--          encode(digest(decrypted_secret, 'sha256'), 'hex')
--   FROM vault.decrypted_secrets WHERE name = 'function_invoke_secret';
--
-- VERIFY (after a scheduled post comes due):
--   SELECT status_code, left(content::text, 120), created
--   FROM net._http_response ORDER BY created DESC LIMIT 5;
--   -- want 200. A 401 means the Vault value and the function secret differ.
--
-- SAFE TO RE-RUN: yes.

BEGIN;

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
  v_service_key   text;
  v_invoke_secret text;
  v_function_url  text := 'https://ujkuwemwlhilzarbrozu.supabase.co/functions/v1/publish-post';
BEGIN
  -- Still needed, but ONLY to satisfy Supabase's API gateway, which validates
  -- the Authorization header as a JWT before the function runs. It authorises
  -- nothing on our side any more.
  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  IF v_service_key IS NULL THEN
    RAISE WARNING 'dispatch_scheduled_post: service_role_key not found in Vault — skipping dispatch for post %. The API gateway rejects a request with no bearer token before it ever reaches the function.', p_post_id;
    RETURN;
  END IF;

  -- The actual authorisation, checked by requireInvokeSecret() in
  -- supabase/functions/_shared/connectionHelpers.ts.
  SELECT decrypted_secret INTO v_invoke_secret
  FROM vault.decrypted_secrets
  WHERE name = 'function_invoke_secret'
  LIMIT 1;

  IF v_invoke_secret IS NULL THEN
    RAISE WARNING 'dispatch_scheduled_post: function_invoke_secret not found in Vault — skipping dispatch for post %. publish-post would refuse this call, and the post would sit in `publishing` with no explanation. Create it with vault.create_secret(...) using the same value as the FUNCTION_INVOKE_SECRET edge function secret.', p_post_id;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_function_url,
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'Authorization',   'Bearer ' || v_service_key,
      'X-Invoke-Secret', v_invoke_secret
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

-- ── Post-conditions ─────────────────────────────────────────────────────────

DO $$
DECLARE
  src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'dispatch_scheduled_post'
  LIMIT 1;

  IF src IS NULL THEN
    RAISE EXCEPTION 'post-condition failed: dispatch_scheduled_post does not exist after replacing it';
  END IF;

  IF src NOT LIKE '%X-Invoke-Secret%' THEN
    RAISE EXCEPTION
      'post-condition failed: dispatch_scheduled_post still does not send X-Invoke-Secret. '
      'Every scheduled publish would keep being refused while pg_cron reported the run as succeeded.';
  END IF;

  IF src NOT LIKE '%function_invoke_secret%' THEN
    RAISE EXCEPTION
      'post-condition failed: dispatch_scheduled_post does not read function_invoke_secret from Vault — '
      'a literal secret in a function body is readable by anyone who can inspect it.';
  END IF;

  -- The caller must still exist and still reach this function, or fixing it
  -- changes nothing. This repo's dominant defect is disconnection.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'process_scheduled_posts'
  ) THEN
    RAISE EXCEPTION 'post-condition failed: process_scheduled_posts() is gone — nothing calls dispatch_scheduled_post';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-scheduled-posts' AND active) THEN
    RAISE EXCEPTION 'post-condition failed: the process-scheduled-posts cron job is missing or inactive';
  END IF;

  RAISE NOTICE 'dispatch_scheduled_post now sends X-Invoke-Secret; its cron caller is active.';
END
$$;

COMMIT;
