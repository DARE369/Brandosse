-- 20260904160000_fix_health_summary_column_grant.sql
--
-- HOTFIX — connected_accounts_health_summary throws 42501 for every real user,
-- which empties the Connected Accounts page entirely.
--
-- ── What broke ───────────────────────────────────────────────────────────────
-- 20260904120000 replaced the table-wide `GRANT SELECT ON connected_accounts`
-- with a COLUMN-LEVEL grant, computed from information_schema at the moment it
-- ran, covering every column except the three secret ones.
--
-- 20260904140000 then ADDED a column — `has_credential` — and taught the view
-- to select it. Column-level grants do not extend to columns created later, so
-- `authenticated` has no SELECT privilege on it. The view is security_invoker,
-- so it runs with the caller's rights and needs SELECT on every column it
-- touches. Result:
--
--     42501: permission denied for table connected_accounts
--
-- ── The visible damage ───────────────────────────────────────────────────────
-- ConnectedAccountsTab.loadData() fetches platforms and accounts with
-- Promise.all. The accounts query rejected, so the whole settlement rejected,
-- so `platforms` never populated either. The page rendered "No accounts
-- connected yet" AND an empty platform grid — with no way to connect anything.
-- The platform data was fine the whole time.
--
-- ── Why the post-conditions missed it ────────────────────────────────────────
-- 20260904140000 asserted privileges on individually NAMED columns
-- (display_name, access_token). It never asserted the thing that actually
-- matters: that a normal user can read the view at all. Testing the parts
-- while never testing the whole is how a migration passes and the product
-- breaks.
--
-- This migration fixes that too — its post-condition SETs ROLE to authenticated
-- and actually queries the view. That is the only assertion here that would
-- have caught the original defect.
--
-- ── Preventing the next one ──────────────────────────────────────────────────
-- Recomputing the grant is not enough on its own: the same trap reopens the
-- next time anyone adds a column. An event trigger re-applies the grant
-- whenever a column is added to connected_accounts, so the denylist stays
-- authoritative and additions are covered by default.
--
-- VERIFY (as an ordinary user, not service-role):
--   SELECT can_publish, publish_block_reason
--   FROM public.connected_accounts_health_summary LIMIT 1;
--
-- SAFE TO RE-RUN: yes.

BEGIN;

-- ── 1. Recompute the column grants, now including has_credential ─────────────

CREATE OR REPLACE FUNCTION public.apply_connected_accounts_column_grants()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- The denylist is the contract: everything NOT named here stays readable,
  -- so a column this function has never heard of is granted rather than
  -- silently withheld. Withholding is what caused the outage.
  secret_cols CONSTANT text[] := ARRAY['access_token', 'refresh_token', 'mock_token'];
  read_cols  text;
  write_cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO read_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'connected_accounts'
    AND column_name <> ALL (secret_cols);

  IF read_cols IS NULL THEN
    RAISE EXCEPTION 'refusing to proceed — no grantable columns on connected_accounts';
  END IF;

  -- has_credential is maintained solely by the trigger on
  -- connected_account_secrets (SECURITY DEFINER), so clients read it but must
  -- never write it — a client that could set it to true would hand itself a
  -- "publishable" badge with no credential behind it.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO write_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'connected_accounts'
    AND column_name <> ALL (secret_cols)
    AND column_name <> 'has_credential';

  EXECUTE 'REVOKE SELECT, INSERT, UPDATE ON public.connected_accounts FROM authenticated, anon';
  EXECUTE format('GRANT SELECT (%s) ON public.connected_accounts TO authenticated, anon', read_cols);
  EXECUTE format('GRANT INSERT (%s), UPDATE (%s) ON public.connected_accounts TO authenticated',
                 write_cols, write_cols);
END;
$$;

SELECT public.apply_connected_accounts_column_grants();

-- ── 2. Keep it correct when the next column is added ─────────────────────────
--
-- Without this, the identical outage returns the next time anyone runs
-- `ALTER TABLE connected_accounts ADD COLUMN ...` — and it would again present
-- as an empty page rather than as an error anyone could trace to a grant.

CREATE OR REPLACE FUNCTION public.reapply_connected_accounts_grants_on_ddl()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF obj.object_identity = 'public.connected_accounts'
       AND obj.command_tag = 'ALTER TABLE' THEN
      PERFORM public.apply_connected_accounts_column_grants();
      RAISE NOTICE 'connected_accounts changed — column grants re-applied';
    END IF;
  END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS trg_connected_accounts_grants;
CREATE EVENT TRIGGER trg_connected_accounts_grants
  ON ddl_command_end
  WHEN TAG IN ('ALTER TABLE')
  EXECUTE FUNCTION public.reapply_connected_accounts_grants_on_ddl();

-- ── 3. Post-conditions — test the WHOLE, not the parts ───────────────────────

DO $$
DECLARE
  leaked text;
BEGIN
  -- 3a. The assertion that would have caught this: can an ordinary user
  --     actually READ THE VIEW? Everything else is a proxy for this.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM 1 FROM public.connected_accounts_health_summary LIMIT 1;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE EXCEPTION
      'post-condition failed: authenticated still cannot read '
      'connected_accounts_health_summary (%). The Connected Accounts page '
      'would render empty.', SQLERRM;
  END;

  -- 3b. Secrets are still withheld — the fix must not have over-granted.
  FOR leaked IN
    SELECT c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'connected_accounts'
      AND c.column_name IN ('access_token', 'refresh_token', 'mock_token')
      AND (has_column_privilege('authenticated', 'public.connected_accounts', c.column_name, 'SELECT')
        OR has_column_privilege('authenticated', 'public.connected_accounts', c.column_name, 'UPDATE'))
  LOOP
    RAISE EXCEPTION 'post-condition failed: client can reach connected_accounts.%', leaked;
  END LOOP;

  -- 3c. has_credential is readable but NOT writable by clients.
  IF NOT has_column_privilege('authenticated', 'public.connected_accounts', 'has_credential', 'SELECT') THEN
    RAISE EXCEPTION 'post-condition failed: has_credential is not readable — the view will 42501 again';
  END IF;
  IF has_column_privilege('authenticated', 'public.connected_accounts', 'has_credential', 'UPDATE') THEN
    RAISE EXCEPTION 'post-condition failed: a client could set has_credential and fake a publishable account';
  END IF;

  -- 3d. Ordinary edits still work.
  IF NOT has_column_privilege('authenticated', 'public.connected_accounts', 'display_name', 'UPDATE') THEN
    RAISE EXCEPTION 'post-condition failed: renaming an account would break';
  END IF;

  RAISE NOTICE 'health summary readable; secrets sealed; has_credential read-only.';
END;
$$;

COMMIT;
