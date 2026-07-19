-- ============================================================================
-- Migration: edge_function_rate_limiting
-- Purpose: WEEK 2 FIX 5 (+ ADDENDUM UPGRADE 3) — the audit's original Fix 2
--   deliberately parked rate limiting ("do NOT implement... in this pass");
--   Week 1's FIXLOG recorded no checkpoint was actually triggered (the only
--   candidate, enhance-prompt's auth fix, didn't need one). This migration
--   is the dedicated rate-limiting pass now authorized.
--
--   Design: a TRUE sliding-window limiter (a log of individual request
--   timestamps), not a fixed-window counter — fixed windows allow up to 2x
--   the intended burst right at a window boundary (e.g. 10 requests at
--   0:59 and another 10 at 1:01 would both pass a naive "requests this
--   calendar minute <= 10" check). check_rate_limit() below counts real
--   events within a rolling `now() - window_seconds` lookback and computes
--   an exact retry-after from the oldest event still inside that window.
--
--   Concurrency safety: a transaction-scoped Postgres advisory lock keyed
--   on (user_id, function_name) serializes the count-then-insert sequence
--   for that specific pair only (every other user/function pair proceeds
--   unblocked) — this closes the classic read-then-write race where two
--   concurrent requests both observe "count is one under the limit" and
--   both insert, exceeding it by one. The lock is released automatically
--   when the RPC call's implicit transaction ends; no explicit BEGIN/COMMIT
--   needed since Postgres functions execute as a single statement in the
--   caller's transaction (or their own implicit one, if the edge function's
--   `adminClient.rpc(...)` call isn't itself wrapped in a larger explicit
--   transaction — it isn't, in this codebase).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  function_name text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_lookup
  ON public.rate_limit_events(user_id, function_name, created_at DESC);

ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;
-- Deliberately zero CREATE POLICY statements: RLS enabled + no policy at
-- all denies every row to every role except the table owner — so neither
-- `authenticated` nor `anon` (nor even service_role's default PostgREST
-- session, which still goes through RLS unless it's the literal table
-- owner) can read or write this table directly. The only sanctioned access
-- path is check_rate_limit() below, which runs SECURITY DEFINER as the
-- function's owner and therefore bypasses RLS on this table by design —
-- exactly the "only through the gate" shape rate-limit bookkeeping needs.

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id uuid,
  p_function text,
  p_max int,
  p_window_seconds int
)
RETURNS TABLE(allowed boolean, retry_after_seconds int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key bigint;
  v_window_start timestamptz;
  v_count int;
  v_oldest timestamptz;
  v_retry_after int;
BEGIN
  IF p_user_id IS NULL OR p_function IS NULL OR p_max IS NULL OR p_window_seconds IS NULL THEN
    RAISE EXCEPTION 'check_rate_limit: all parameters are required';
  END IF;

  v_window_start := now() - (p_window_seconds || ' seconds')::interval;

  -- Serializes concurrent calls for this exact (user, function) pair only.
  -- hashtextextended's second arg (seed) is fixed at 0 so the same
  -- (user_id, function_name) string always hashes to the same lock key
  -- across calls/connections, which is what makes the lock actually
  -- mutually-exclusive for that pair.
  v_lock_key := hashtextextended(p_user_id::text || ':' || p_function, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Opportunistic cleanup of this pair's own stale rows while we already
  -- hold the lock — keeps the table bounded without a dedicated per-key
  -- cron sweep. A separate, infrequent global cleanup job (below) catches
  -- rows belonging to (user, function) pairs that simply stop being called
  -- and would otherwise never get swept by this per-call path.
  DELETE FROM public.rate_limit_events
  WHERE user_id = p_user_id
    AND function_name = p_function
    AND created_at < v_window_start;

  SELECT count(*), min(created_at)
  INTO v_count, v_oldest
  FROM public.rate_limit_events
  WHERE user_id = p_user_id
    AND function_name = p_function
    AND created_at >= v_window_start;

  IF v_count >= p_max THEN
    v_retry_after := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (v_oldest + (p_window_seconds || ' seconds')::interval - now())))::int
    );
    RETURN QUERY SELECT false, v_retry_after;
    RETURN;
  END IF;

  INSERT INTO public.rate_limit_events (user_id, function_name)
  VALUES (p_user_id, p_function);

  RETURN QUERY SELECT true, 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_rate_limit(uuid, text, int, int) TO authenticated, service_role;

-- ── Global cleanup — project already uses pg_cron (see
--    20260710120000_vault_based_cron_secrets.sql), so this reuses that
--    existing infrastructure rather than introducing it. Runs hourly;
--    24h retention is a generous multiple of every window configured in
--    _shared/rateLimit.ts (the longest is 60s), so this only ever removes
--    rows the per-call opportunistic cleanup already would have but never
--    got the chance to (abandoned user/function pairs that stopped being
--    called before their own rows aged out).
DO $$
DECLARE
  job_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron extension not installed — skipping rate_limit_events cleanup job registration. Existing per-call opportunistic cleanup in check_rate_limit() still bounds growth for active keys.';
  ELSE
    SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'cleanup-rate-limit-events' LIMIT 1;
    IF job_id IS NOT NULL THEN
      PERFORM cron.unschedule(job_id);
    END IF;

    PERFORM cron.schedule(
      'cleanup-rate-limit-events',
      '0 * * * *',
      $job$DELETE FROM public.rate_limit_events WHERE created_at < now() - interval '24 hours';$job$
    );
  END IF;
END;
$$;
