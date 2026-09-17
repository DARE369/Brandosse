-- 20260917140000_scheduled_failure_names_its_cause.sql
--
-- Tell the user WHY a scheduled post failed, instead of one sentence that is
-- wrong for most of the reasons it gets used.
--
-- ── The message that covers four different failures ─────────────────────────
-- 20260716140000 fixed a real defect: scheduled posts that could never match an
-- active account sat as 'scheduled' forever, invisible. It failed them, which
-- was right, and gave every one of them the same text:
--
--   "No active connected account could be matched for this scheduled post.
--    Reselect a target platform and reschedule."
--
-- That sentence is only true for one of the four ways this happens, and it
-- sends everyone to the same wrong place:
--
--   1. No platform was ever chosen  → "reselect a target platform" is correct.
--   2. The connection EXPIRED       → nothing to reselect. Reconnect.
--   3. The user REVOKED access      → nothing to reselect. Reconnect.
--   4. The account was disconnected → the post kept its history and lost only
--      its account link. "Reselect a platform" describes neither.
--
-- Cases 2 and 3 are the common ones, and the advice given for them is advice
-- that cannot work: a user who follows it reselects the same platform, which
-- still has no usable credential, and the post fails again. Telling somebody to
-- do the wrong thing costs more than saying nothing.
--
-- Case 4 became reachable-and-survivable on 2026-09-17: before then,
-- disconnecting an account DELETED its posts outright (see 20260917120000). Now
-- the post survives with account_id NULL, so this message is what that user
-- reads.
--
-- ── Why the classifier is its own function ──────────────────────────────────
-- process_scheduled_posts() also DISPATCHES, which fires real HTTP requests
-- through pg_net. A post-condition that called it to check its wording would
-- publish live posts as a side effect. Splitting the classifier out means the
-- check below can exercise exactly the behaviour it claims to verify and
-- nothing else.
--
-- VERIFY:
--   SELECT status, error_message FROM public.posts WHERE status = 'failed'
--   ORDER BY failed_at DESC LIMIT 5;
--
-- SAFE TO RE-RUN: yes.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The classifier
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fail_undispatchable_scheduled_posts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  failed_count integer;
BEGIN
  UPDATE posts p
  SET
    status     = 'failed',
    failed_at  = now(),
    updated_at = now(),
    error_message = CASE

      -- 1. Nothing was ever chosen. This is the case the original message was
      --    written for, and the only one where "pick a platform" is the fix.
      WHEN p.account_id IS NULL AND coalesce(p.platform, '') = '' THEN
        'This post was never given a platform to publish to, so there was nothing '
        || 'to publish it with. Open it, choose a platform, and schedule it again.'

      -- 2. It targets a specific account that is no longer usable. The account
      --    row still exists — a foreign key guarantees that — so its own status
      --    can name the cause precisely.
      WHEN p.account_id IS NOT NULL THEN
        (
          SELECT CASE coalesce(ca.connection_status, 'inactive')
            WHEN 'expired' THEN
              'Your ' || label.name || ' connection expired and could not be renewed, so '
              || 'this post was not published. Reconnect ' || label.name
              || ' in Settings, then schedule it again.'
            WHEN 'revoked' THEN
              'Access to your ' || label.name || ' account was withdrawn, so this post '
              || 'was not published. Reconnect ' || label.name
              || ' in Settings, then schedule it again.'
            ELSE
              'The ' || label.name || ' account this post was going to publish to is no '
              || 'longer connected, so it was not published. Reconnect it in Settings, '
              || 'then schedule it again.'
          END
          FROM connected_accounts ca
          CROSS JOIN LATERAL (
            SELECT coalesce(
              (SELECT pr.display_name FROM platform_registry pr WHERE pr.platform_key = ca.platform),
              initcap(ca.platform),
              'social'
            ) AS name
          ) label
          WHERE ca.id = p.account_id
        )

      -- 3. A platform was chosen but no account of that platform is connected.
      --    Since 2026-09-17 this is also what a user sees after disconnecting:
      --    the post survives, the account link does not. Saying so prevents the
      --    reasonable fear that disconnecting destroyed the post.
      ELSE
        'No ' || coalesce(
                   (SELECT pr.display_name FROM platform_registry pr WHERE pr.platform_key = p.platform),
                   initcap(p.platform))
        || ' account is connected, so this post had nowhere to publish. Connect '
        || coalesce(
             (SELECT pr.display_name FROM platform_registry pr WHERE pr.platform_key = p.platform),
             initcap(p.platform))
        || ' in Settings, then schedule it again. The post itself is intact.'
    END
  WHERE
    p.status = 'scheduled'
    -- Unchanged from 20260716140000: the exact inverse of the dispatch join, so
    -- a post is failed only when it can never match an active account, whether
    -- or not its scheduled time has arrived.
    AND NOT EXISTS (
      SELECT 1
      FROM connected_accounts ca
      WHERE ca.user_id = p.user_id
        AND ca.connection_status = 'active'
        AND ca.deleted_at IS NULL
        AND (
          (p.account_id IS NOT NULL AND ca.id = p.account_id)
          OR (
            p.account_id IS NULL
            AND p.platform IS NOT NULL
            AND ca.platform = p.platform
            AND (
              (p.organization_id IS NULL AND ca.organization_id IS NULL)
              OR ca.organization_id = p.organization_id
            )
          )
        )
    );

  GET DIAGNOSTICS failed_count = ROW_COUNT;
  RETURN failed_count;
END;
$$;

COMMENT ON FUNCTION public.fail_undispatchable_scheduled_posts() IS
  'Fails scheduled posts that can never reach an active account, with a message '
  'naming which of the four causes applies. Separate from process_scheduled_posts '
  'so it can be tested without dispatching real publishes.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The worker, unchanged except that it delegates the wording
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Dispatch loop reproduced verbatim from 20260716140000:36-81. Only the trailing
-- UPDATE is replaced by the call above.

CREATE OR REPLACE FUNCTION public.process_scheduled_posts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
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
    LIMIT 50
  LOOP
    UPDATE posts
    SET
      status     = 'publishing',
      updated_at = now()
    WHERE
      id     = r.post_id
      AND status = 'scheduled';  -- race guard

    IF FOUND THEN
      PERFORM public.dispatch_scheduled_post(
        r.post_id,
        r.account_id,
        r.user_id,
        r.organization_id
      );
    END IF;
  END LOOP;

  PERFORM public.fail_undispatchable_scheduled_posts();
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Re-message the posts already failed by the old blanket text
-- ═══════════════════════════════════════════════════════════════════════════
--
-- They were failed for reasons the message never distinguished, and the advice
-- they carry is wrong for most of them. Re-running the classifier is not
-- possible — they are no longer 'scheduled' — so the only honest correction is
-- to stop claiming a cause that was never established.

UPDATE public.posts
SET error_message =
      'This post could not be published: no usable connected account was found '
      || 'when it was due. Check the account for this platform in Settings — it may '
      || 'need reconnecting — then schedule it again.',
    updated_at = now()
WHERE status = 'failed'
  AND error_message =
      'No active connected account could be matched for this scheduled post. '
      || 'Reselect a target platform and reschedule.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Post-conditions — three posts, three different failures, three messages
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  probe_user  uuid;
  expired_acc uuid;
  post_none   uuid;   -- no platform at all
  post_dead   uuid;   -- targets an expired account
  post_gone   uuid;   -- platform set, nothing connected
  msg_none    text;
  msg_dead    text;
  msg_gone    text;
  free_plat   text;   -- a platform this user has NOT connected
  free_label  text;
  n           integer;
BEGIN
  SELECT id INTO probe_user FROM auth.users ORDER BY created_at LIMIT 1;
  IF probe_user IS NULL THEN
    RAISE EXCEPTION 'post-condition cannot run: auth.users is empty';
  END IF;

  -- Case 3 needs a platform with no active account, and which one that is
  -- depends on who is connected today. Hardcoding "linkedin" would make this
  -- migration fail on a database where LinkedIn happens to be connected —
  -- a post-condition that depends on unrelated state is not a post-condition.
  SELECT pr.platform_key,
         coalesce(pr.display_name, initcap(pr.platform_key))
    INTO free_plat, free_label
  FROM public.platform_registry pr
  WHERE NOT EXISTS (
    SELECT 1 FROM public.connected_accounts ca
    WHERE ca.user_id = probe_user
      AND ca.platform = pr.platform_key
      AND ca.connection_status = 'active'
      AND ca.deleted_at IS NULL
  )
  ORDER BY pr.platform_key
  LIMIT 1;

  IF free_plat IS NULL THEN
    RAISE EXCEPTION
      'post-condition cannot run: this user has an active account on every registered '
      'platform, so the "nothing connected" case cannot be constructed';
  END IF;

  BEGIN
    INSERT INTO public.connected_accounts
      (user_id, platform, provider, account_name, connection_status)
    VALUES (probe_user, 'youtube', 'youtube', '__dispatch_probe__', 'expired')
    RETURNING id INTO expired_acc;

    INSERT INTO public.posts (user_id, caption, status, scheduled_at)
    VALUES (probe_user, '__dispatch_probe__', 'scheduled', now() - interval '1 hour')
    RETURNING id INTO post_none;

    INSERT INTO public.posts (user_id, account_id, platform, caption, status, scheduled_at)
    VALUES (probe_user, expired_acc, 'youtube', '__dispatch_probe__', 'scheduled',
            now() - interval '1 hour')
    RETURNING id INTO post_dead;

    INSERT INTO public.posts (user_id, platform, caption, status, scheduled_at)
    VALUES (probe_user, free_plat, '__dispatch_probe__', 'scheduled',
            now() - interval '1 hour')
    RETURNING id INTO post_gone;

    n := public.fail_undispatchable_scheduled_posts();
    IF n < 3 THEN
      RAISE EXCEPTION
        'post-condition failed: only % of 3 undispatchable posts were failed — the rest '
        'would sit as "scheduled" forever, which is the defect 20260716140000 fixed', n;
    END IF;

    SELECT error_message INTO msg_none FROM public.posts WHERE id = post_none;
    SELECT error_message INTO msg_dead FROM public.posts WHERE id = post_dead;
    SELECT error_message INTO msg_gone FROM public.posts WHERE id = post_gone;

    -- Each message must name ITS OWN cause. Checking that they merely differ
    -- would pass on three equally wrong sentences.
    IF msg_none IS NULL OR msg_none NOT LIKE '%never given a platform%' THEN
      RAISE EXCEPTION
        'post-condition failed: a post with no platform reports "%" — the only case where '
        '"choose a platform" is the right advice must say so', coalesce(msg_none, '(null)');
    END IF;

    IF msg_dead IS NULL OR msg_dead NOT LIKE '%expired%' OR msg_dead NOT LIKE '%Reconnect%' THEN
      RAISE EXCEPTION
        'post-condition failed: a post targeting an EXPIRED connection reports "%" — it must '
        'say the connection expired and send the user to reconnect, not to reselect a '
        'platform that will fail again', coalesce(msg_dead, '(null)');
    END IF;

    IF msg_gone IS NULL
       OR msg_gone NOT LIKE '%' || free_label || '%'
       OR msg_gone NOT LIKE '%post itself is intact%' THEN
      RAISE EXCEPTION
        'post-condition failed: a post whose platform (%) has no connected account reports '
        '"%" — it must name that platform, and say the post survived',
        free_label, coalesce(msg_gone, '(null)');
    END IF;

    IF msg_dead = msg_gone OR msg_none = msg_dead THEN
      RAISE EXCEPTION 'post-condition failed: two different causes produced the same message';
    END IF;

    RAISE EXCEPTION 'dispatch_probe_rollback';

  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'dispatch_probe_rollback' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'post-conditions passed: each cause of an undispatchable post names itself';
  END;
END $$;

COMMIT;
