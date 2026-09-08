-- 20260904120000_connected_account_token_custody.sql
--
-- DEFECT D1 — platform tokens are stored in plaintext, in a table the browser
-- can read.
--
-- ── The defect ───────────────────────────────────────────────────────────────
-- 20260321113000_admin_moderation_schema_alignment.sql:46-48 added
-- `access_token`, `refresh_token` and `token_expires_at` to
-- public.connected_accounts as bare `text` columns.
--
-- 20260712150000_fix_connected_accounts_select_grant.sql then ran:
--
--     GRANT SELECT ON public.connected_accounts TO authenticated, anon;
--
-- That grant was correct and necessary — without it no user could see their own
-- connected accounts at all (42501, evaluated before RLS ever runs). But it is
-- a TABLE-level grant, and RLS filters ROWS, never COLUMNS. So:
--
--   * any logged-in user can `select access_token from connected_accounts`
--     for their own row, straight out of the browser console; and
--   * any XSS on any authenticated page harvests every token it can reach.
--
-- This has been harmless to date only because Zernio owned the OAuth exchange
-- and never handed us a token to store. Direct per-platform OAuth changes that
-- on the first successful connect. A Meta long-lived token or a Google refresh
-- token is a durable credential to somebody's real social presence: the ability
-- to post as them, indefinitely, from anywhere, until they notice.
--
-- ── The fix, in two layers ───────────────────────────────────────────────────
--   1. Secrets move to public.connected_account_secrets, a table with NO grant
--      to authenticated or anon. Nothing the browser can speak to can name the
--      row, let alone read it. Service-role edge functions reach it; the
--      PostgREST client cannot.
--   2. The blanket SELECT on connected_accounts is replaced with a COLUMN-LEVEL
--      grant that covers every column EXCEPT the secret ones.
--
-- Ciphertext is the third layer and lives in app/api/_lib/tokenCrypto.js
-- (AES-256-GCM, fresh IV per write, version-prefixed). Guarded by
-- scripts/security/token-crypto.test.mjs, 15 checks, wired into CI.
--
-- ── Why the column grant is computed, not written out by hand ────────────────
-- The live schema is drifted from this migration history (89 tables live vs 65
-- in migrations, per CLAUDE.md). A hand-written column list would omit whatever
-- columns exist live but not here, and omitting a column from a column-level
-- grant reproduces EXACTLY the 42501 outage that 20260712150000 was written to
-- fix. So the list is derived from information_schema at apply time: grant
-- everything, minus a small explicit denylist.
--
-- ── What this migration deliberately does NOT do ─────────────────────────────
--   * It does not copy existing token values into the new table. There is
--     nothing worth copying: every non-mock row is either a mock token or a
--     dead credential from the removed `provider = 'direct'` era (see
--     20260821220000, which records that path as structurally incapable of
--     publishing). Migrating dead secrets would only spread them.
--   * It does not DROP the old columns. Dropping is irreversible and this
--     migration's job is to close the read path, which it does. The drop is a
--     separate, later change once the adapters are proven — at which point the
--     columns are provably unread.
--   * It does not tighten `anon`. anon is already blocked from every row by
--     RLS, so it reads no tokens either way; revoking its grant outright would
--     change a "no rows" result into a "permission denied" error on any path
--     that queries unauthenticated, and no such path has been traced yet.
--     Tightening it is a follow-up with its own tracing, not a silent rider.
--
-- VERIFY:
--   SELECT has_column_privilege('authenticated','public.connected_accounts','access_token','SELECT');  -- must be false
--   SELECT has_column_privilege('authenticated','public.connected_accounts','platform','SELECT');      -- must be true
--   SELECT has_table_privilege('authenticated','public.connected_account_secrets','SELECT');           -- must be false
--
-- BEHAVIOURAL PROBE (the only proof that counts — service-role reads bypass RLS
-- and prove nothing):  node scripts/security/cross-tenant-probe.mjs
--
-- SAFE TO RE-RUN: yes.

BEGIN;

-- ── 1. The secrets table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.connected_account_secrets (
  connected_account_id uuid PRIMARY KEY
    REFERENCES public.connected_accounts(id) ON DELETE CASCADE,

  -- Ciphertext produced by app/api/_lib/tokenCrypto.js. Format is
  -- v<n>.<iv>.<tag>.<ciphertext>, all base64url. Never plaintext: the
  -- constraint below refuses anything that does not carry a version prefix,
  -- so a code path that forgets to encrypt fails loudly at write time rather
  -- than silently storing a raw token.
  access_token_ciphertext  text,
  refresh_token_ciphertext text,

  -- Kept alongside the ciphertext it describes so a refresh worker can find
  -- expiring rows without touching connected_accounts. connected_accounts
  -- keeps its own token_expires_at for display; this one is operational.
  expires_at        timestamptz,
  refresh_after     timestamptz,

  -- Scopes actually granted, which is not always what was requested — a user
  -- can uncheck a permission on the consent screen. Storing what we got lets
  -- the UI say "reconnect to enable posting" instead of failing at publish.
  granted_scopes    text[] NOT NULL DEFAULT '{}'::text[],

  last_refreshed_at timestamptz,
  refresh_failures  integer NOT NULL DEFAULT 0,
  last_refresh_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cas_access_token_is_ciphertext'
      AND conrelid = 'public.connected_account_secrets'::regclass
  ) THEN
    ALTER TABLE public.connected_account_secrets
      ADD CONSTRAINT cas_access_token_is_ciphertext
      CHECK (access_token_ciphertext IS NULL
             OR access_token_ciphertext ~ '^v[0-9]+\.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cas_refresh_token_is_ciphertext'
      AND conrelid = 'public.connected_account_secrets'::regclass
  ) THEN
    ALTER TABLE public.connected_account_secrets
      ADD CONSTRAINT cas_refresh_token_is_ciphertext
      CHECK (refresh_token_ciphertext IS NULL
             OR refresh_token_ciphertext ~ '^v[0-9]+\.');
  END IF;
END
$$;

-- Lets the refresh reaper find work without a full scan.
CREATE INDEX IF NOT EXISTS idx_cas_refresh_due
  ON public.connected_account_secrets(refresh_after)
  WHERE refresh_after IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cas_expiring
  ON public.connected_account_secrets(expires_at)
  WHERE expires_at IS NOT NULL;

-- ── 2. Lock the secrets table down ───────────────────────────────────────────
--
-- Belt and braces, because these are the highest-value rows in the database:
--   * RLS on with NO policy at all -> every non-superuser row access is denied
--     by default, including any policy someone adds to a sibling table later.
--   * No grants to authenticated/anon -> denied even before RLS is consulted.
-- service_role bypasses RLS by design and keeps its implicit access.

ALTER TABLE public.connected_account_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connected_account_secrets FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.connected_account_secrets FROM PUBLIC;
REVOKE ALL ON public.connected_account_secrets FROM authenticated;
REVOKE ALL ON public.connected_account_secrets FROM anon;

COMMENT ON TABLE public.connected_account_secrets IS
  'DEFECT D1 — encrypted platform OAuth tokens. NO grant to authenticated/anon, '
  'RLS forced with no policies. Reachable only by service-role edge functions. '
  'Values are AES-256-GCM ciphertext from app/api/_lib/tokenCrypto.js; the CHECK '
  'constraints refuse anything without a version prefix so an unencrypted write '
  'fails loudly.';

-- ── 3. Replace the blanket SELECT on connected_accounts ──────────────────────
--
-- Computed rather than hand-listed — see the header. Anything not in the
-- denylist stays readable, so a column this migration has never heard of is
-- granted rather than silently withheld.

DO $$
DECLARE
  secret_cols CONSTANT text[] := ARRAY['access_token', 'refresh_token', 'mock_token'];
  col_list    text;
  n_granted   int;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
         count(*)
    INTO col_list, n_granted
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'connected_accounts'
    AND column_name <> ALL (secret_cols);

  IF col_list IS NULL OR n_granted = 0 THEN
    RAISE EXCEPTION 'D1: refusing to proceed — no grantable columns found on connected_accounts';
  END IF;

  -- Drop the table-wide grant, then re-add it column by column.
  EXECUTE 'REVOKE SELECT ON public.connected_accounts FROM authenticated, anon';
  EXECUTE format('GRANT SELECT (%s) ON public.connected_accounts TO authenticated, anon', col_list);

  RAISE NOTICE 'D1: granted SELECT on % non-secret column(s); % secret column(s) withheld',
    n_granted, array_length(secret_cols, 1);
END
$$;

-- ── 4. Post-conditions ───────────────────────────────────────────────────────
--
-- A migration that cannot prove its own effect is a claim, not a fix.

DO $$
DECLARE
  leaked      text;
  probe_col   text;
BEGIN
  -- 4a. No client role may read any secret column.
  FOR leaked IN
    SELECT c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'connected_accounts'
      AND c.column_name IN ('access_token', 'refresh_token', 'mock_token')
      AND (has_column_privilege('authenticated', 'public.connected_accounts', c.column_name, 'SELECT')
        OR has_column_privilege('anon',          'public.connected_accounts', c.column_name, 'SELECT'))
  LOOP
    RAISE EXCEPTION
      'D1 post-condition failed: a client role can still SELECT connected_accounts.%', leaked;
  END LOOP;

  -- 4b. The secrets table is unreachable by client roles.
  IF has_table_privilege('authenticated', 'public.connected_account_secrets', 'SELECT')
     OR has_table_privilege('anon', 'public.connected_account_secrets', 'SELECT') THEN
    RAISE EXCEPTION
      'D1 post-condition failed: a client role can SELECT connected_account_secrets';
  END IF;

  -- 4c. And the columns the app actually needs are STILL readable. Without
  --     this the migration could "pass" by breaking the feature outright —
  --     which is precisely the 42501 outage 20260712150000 had to repair.
  FOREACH probe_col IN ARRAY ARRAY['id', 'user_id', 'platform', 'connection_status', 'provider']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'connected_accounts'
        AND column_name = probe_col
    ) AND NOT has_column_privilege('authenticated', 'public.connected_accounts', probe_col, 'SELECT') THEN
      RAISE EXCEPTION
        'D1 post-condition failed: authenticated LOST read access to connected_accounts.% — '
        'this would break the connected-accounts UI entirely', probe_col;
    END IF;
  END LOOP;

  RAISE NOTICE 'D1: token custody enforced — secrets unreachable, non-secret columns intact.';
END
$$;

COMMIT;
