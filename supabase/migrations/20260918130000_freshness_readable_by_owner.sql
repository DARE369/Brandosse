-- 20260918130000_freshness_readable_by_owner.sql
--
-- The freshness view returns 403 to every signed-in user, which silently blanks
-- the analytics surface.
--
-- ── Found by walking the flow ───────────────────────────────────────────────
-- Signed in as a real user on 2026-09-18, the analytics page requested:
--
--   social_metric_definitions      200
--   social_account_metrics_daily   200
--   social_post_metrics_daily      200
--   social_analytics_freshness     403   <-- permission denied
--
-- and then rendered "No platform figures yet — Connect a social account",
-- for a user who HAS a YouTube channel connected. Wrong, and wrong in the worst
-- direction: it tells someone to fix a thing that is not broken.
--
-- ── Why it is 403 ───────────────────────────────────────────────────────────
-- 20260909140000:680 grants SELECT on the view to authenticated. But the view
-- is declared WITH (security_invoker = true), so it executes with the CALLER's
-- privileges — and it joins social_ingestion_runs, which line 640 REVOKES from
-- authenticated on purpose ("operational, not user-facing").
--
-- Granting the view was necessary and not sufficient. A security_invoker view
-- is a query written in someone else's name, not a privilege of its own.
--
-- ── The fix, and why not the other one ──────────────────────────────────────
-- The obvious alternative is to grant SELECT on social_ingestion_runs. That is
-- the wrong trade: the ledger carries per-run operational detail for every
-- account on the platform, and it sits beside social_ingestion_raw, which holds
-- verbatim platform responses. Neither belongs in a browser.
--
-- So the view becomes SECURITY DEFINER — executing as its owner, which can read
-- the ledger — and carries its OWN tenancy filter, duplicating the predicate
-- the fact tables enforce through RLS. That filter is the security boundary
-- now, so it is asserted behaviourally below rather than assumed.
--
-- VERIFY:
--   Sign in and open Analytics. The platform cards must show
--   "Checked N min ago" instead of vanishing.
--
-- SAFE TO RE-RUN: yes.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The view, executing as its owner, filtering by the caller
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Columns are unchanged from 20260909140000 — consumers already read them.

DROP VIEW IF EXISTS public.social_analytics_freshness;

CREATE VIEW public.social_analytics_freshness
WITH (security_invoker = false) AS
SELECT
  ca.id   AS connected_account_id,
  ca.user_id,
  ca.organization_id,
  ca.scope,
  ca.platform,
  r.source,
  max(r.started_at) FILTER (WHERE r.status = 'succeeded')          AS last_success_at,
  max(r.started_at)                                                AS last_attempt_at,
  (array_agg(r.status ORDER BY r.started_at DESC))[1]              AS last_status,
  (array_agg(r.error_code ORDER BY r.started_at DESC))[1]          AS last_error_code,
  count(*) FILTER (WHERE r.status IN ('failed', 'partial', 'abandoned')
                     AND r.started_at > now() - interval '24 hours') AS failures_24h
FROM public.connected_accounts ca
LEFT JOIN public.social_ingestion_runs r ON r.connected_account_id = ca.id
-- The tenancy boundary. With security_invoker off, RLS on connected_accounts no
-- longer applies, so this predicate IS the isolation — it mirrors the policy on
-- the fact tables (20260909140000:594) exactly.
WHERE
  (ca.scope = 'personal' AND ca.user_id = auth.uid())
  OR (
    ca.scope = 'organization'
    AND ca.organization_id IN (
      SELECT om.organization_id
      FROM public.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.status = 'active'
    )
  )
GROUP BY ca.id, ca.user_id, ca.organization_id, ca.scope, ca.platform, r.source;

COMMENT ON VIEW public.social_analytics_freshness IS
  'When each connected account was last collected, and whether it worked. '
  'SECURITY DEFINER because it reads social_ingestion_runs, which stays hidden '
  'from the browser; its WHERE clause is therefore the tenancy boundary, not a '
  'convenience, and is asserted behaviourally by 20260918130000.';

REVOKE ALL ON public.social_analytics_freshness FROM anon;
GRANT SELECT ON public.social_analytics_freshness TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Post-conditions — read it AS a user, not as the owner
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Reading this view as postgres proves nothing: postgres could always read it.
-- The failure was specific to the `authenticated` role, so the check assumes
-- that role and a real user's JWT claim, exactly as PostgREST does.

DO $$
DECLARE
  user_a       uuid;
  user_b       uuid;
  rows_as_a    bigint;
  foreign_rows bigint;
BEGIN
  SELECT ca.user_id INTO user_a
  FROM public.connected_accounts ca
  WHERE ca.scope = 'personal' AND ca.user_id IS NOT NULL
  GROUP BY ca.user_id
  ORDER BY count(*) DESC
  LIMIT 1;

  IF user_a IS NULL THEN
    RAISE NOTICE 'skipped: no personal connected account exists to read as';
    RETURN;
  END IF;

  -- 2a. An authenticated user can read their own rows. This is the 403.
  SET LOCAL ROLE authenticated;
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', user_a)::text);

  SELECT count(*) INTO rows_as_a FROM public.social_analytics_freshness;

  RESET ROLE;

  IF rows_as_a = 0 THEN
    RAISE EXCEPTION
      'post-condition failed: an authenticated user with connected accounts still '
      'reads zero freshness rows. The analytics surface will keep telling them to '
      'connect an account they already have.';
  END IF;

  -- 2b. And ONLY their own. With security_invoker off, this WHERE clause is the
  --     only thing standing between users; a view that leaks here leaks every
  --     account on the platform.
  SELECT id INTO user_b FROM auth.users WHERE id <> user_a ORDER BY created_at LIMIT 1;

  IF user_b IS NOT NULL THEN
    SET LOCAL ROLE authenticated;
    EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', user_b)::text);

    SELECT count(*) INTO foreign_rows
    FROM public.social_analytics_freshness f
    WHERE f.user_id = user_a;

    RESET ROLE;

    IF foreign_rows > 0 THEN
      RAISE EXCEPTION
        'post-condition failed: user B can see % freshness row(s) belonging to user A. '
        'The SECURITY DEFINER view is leaking across tenants.', foreign_rows;
    END IF;
  END IF;

  RAISE NOTICE 'post-conditions passed: the owner reads % row(s), another user reads none of them',
    rows_as_a;
END $$;

COMMIT;
