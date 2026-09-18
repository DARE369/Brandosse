-- 20260918120000_dispatch_body_is_jsonb.sql
--
-- Scheduled publishing has been dead since 2026-09-10. This is the same bug,
-- for the second time.
--
-- ── What is happening right now ─────────────────────────────────────────────
-- Every minute, process-scheduled-posts runs and fails:
--
--   ERROR: function net.http_post(url => text, headers => jsonb, body => text)
--          does not exist
--   CONTEXT: PL/pgSQL function dispatch_scheduled_post(uuid,uuid,uuid,uuid)
--            line 32 at PERFORM
--
-- pg_net's `body` parameter is JSONB. 20260910130000:100-105 passes
-- jsonb_build_object(...)::text. No function matches, the call raises, and the
-- exception unwinds the WHOLE cron transaction — including the UPDATE that had
-- just marked the post `publishing`.
--
-- So the post lands back in `scheduled`, unchanged, and is retried a minute
-- later, forever. It is never marked failed, because
-- fail_undispatchable_scheduled_posts() only fails posts with no matching
-- ACTIVE account, and this post has one. From inside the product, a scheduled
-- post simply never goes out and nothing anywhere says why.
--
-- ── This is a regression, not a new defect ──────────────────────────────────
-- 20260710160000 fixed exactly this, with exactly this error message, on
-- 2026-07-10. Its header says the bug "existed in the source from the start and
-- was only caught now because the function had never actually executed before
-- today."
--
-- Then 20260910130000 rewrote the function to add the X-Invoke-Secret header —
-- and reintroduced the ::text cast in the process. Nothing caught it, because
-- nothing had scheduled a post since. The repaired version and the broken
-- version differ by six characters.
--
-- Found 2026-09-18 by scripts/security/scheduled-publish-probe.mjs, which seeds
-- a due post with no media and watches what the cron job does with it. The
-- static guard that stops it coming back a third time is
-- scripts/check-pgnet-body-type.cjs.
--
-- VERIFY (after applying):
--   node scripts/security/scheduled-publish-probe.mjs
--   -- expect: PASS, failing at media validation, nothing uploaded
--
-- SAFE TO RE-RUN: yes.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The function, with the cast removed
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Reproduced verbatim from 20260910130000 apart from the body argument. The
-- Vault lookups, the two-header scheme and both WARNING paths are unchanged —
-- they are correct, and this migration exists to change one thing.

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
    -- JSONB. Not text. This one cast has now broken scheduled publishing twice
    -- (20260710160000, and again here); pg_net's signature has never accepted a
    -- text body.
    body    := jsonb_build_object(
      'post_id',              p_post_id::text,
      'connected_account_id', p_account_id::text,
      'user_id',              p_user_id::text,
      'organization_id',      p_organization_id::text
    )
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Post-condition: call it, and watch it not raise
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Checking that pg_net HAS a jsonb-bodied http_post would prove the wrong
-- thing: it always did. What failed is THIS FUNCTION resolving THAT signature
-- at runtime, and the only way to know is to run it.
--
-- So the probe builds a throwaway account and post, calls the real
-- dispatch_scheduled_post, and unwinds the subtransaction. pg_net queues by
-- INSERT, so the rollback discards the queued request too: nothing is sent, and
-- publish-post is never called.

DO $$
DECLARE
  probe_user uuid;
  acct_id    uuid;
  post_id    uuid;
BEGIN
  SELECT id INTO probe_user FROM auth.users ORDER BY created_at LIMIT 1;
  IF probe_user IS NULL THEN
    RAISE EXCEPTION 'post-condition cannot run: auth.users is empty';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'function_invoke_secret'
  ) THEN
    RAISE EXCEPTION
      'post-condition cannot run: Vault has no function_invoke_secret, so dispatch '
      'would take its WARNING path and prove nothing about the http_post call.';
  END IF;

  BEGIN
    INSERT INTO public.connected_accounts (user_id, platform, account_name, connection_status)
    VALUES (probe_user, 'youtube', '__dispatch_probe__', 'active')
    RETURNING id INTO acct_id;

    INSERT INTO public.posts (user_id, account_id, platform, caption, status, scheduled_at)
    VALUES (probe_user, acct_id, 'youtube', '__dispatch_probe__', 'publishing', now())
    RETURNING id INTO post_id;

    -- The call that has been raising every minute since 2026-09-10.
    PERFORM public.dispatch_scheduled_post(post_id, acct_id, probe_user, NULL);

    RAISE EXCEPTION 'dispatch_probe_rollback';

  EXCEPTION
    WHEN undefined_function THEN
      RAISE EXCEPTION
        'post-condition FAILED: dispatch_scheduled_post still cannot resolve net.http_post — %',
        SQLERRM;
    WHEN raise_exception THEN
      IF SQLERRM <> 'dispatch_probe_rollback' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'post-condition passed: dispatch_scheduled_post executed without raising; the queued request was rolled back, so nothing was sent';
  END;
END $$;

COMMIT;
