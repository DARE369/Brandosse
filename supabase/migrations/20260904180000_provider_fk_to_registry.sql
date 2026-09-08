-- 20260904180000_provider_fk_to_registry.sql
--
-- BUG — connecting a real LinkedIn account fails at the final insert.
--
-- ── What happened ────────────────────────────────────────────────────────────
-- 20260712200000 added this, when Zernio was the only real publishing path:
--
--     ALTER TABLE public.connected_accounts
--       ADD CONSTRAINT connected_accounts_provider_check
--       CHECK (provider IN ('direct', 'zernio'));
--
-- Direct per-platform OAuth writes provider = 'linkedin'. The constraint
-- rejects it with 23514, so the OAuth callback completed the token exchange,
-- completed profile discovery, and then threw on the very last write.
--
-- Observed end to end: the user signed in on LinkedIn, was returned to the
-- app, and nothing happened. No account, no error, no trace — because the
-- callback can only communicate by redirect, and nothing in the UI read the
-- error parameter it set. Two independent silences stacked on top of each
-- other.
--
-- ── Why this becomes a foreign key rather than a wider CHECK ─────────────────
-- Adding 'linkedin' to the list would fix today and break again at Meta, then
-- again at TikTok, then again at YouTube — each time as a runtime failure at
-- the end of a successful OAuth flow, which is the most expensive place to
-- discover it.
--
-- publish_providers (20260904140000) already exists as the single source of
-- truth for which providers are real. Pointing the column at it means:
--   * a provider that is not registered cannot be written at all;
--   * registering one is an INSERT, not a schema change; and
--   * the capability view and the writability rule can never disagree,
--     because they read the same table.
--
-- Being registered is deliberately NOT the same as being supported. Meta,
-- TikTok and YouTube are registered with is_supported = false: their accounts
-- may be stored, and the view correctly reports that they cannot publish yet.
-- A FK to is_supported would have prevented storing them at all, which is a
-- different and wrong rule.
--
-- VERIFY:
--   INSERT ... provider = 'linkedin'  -> succeeds
--   INSERT ... provider = 'myspace'   -> 23503 foreign key violation
--
-- SAFE TO RE-RUN: yes.

BEGIN;

-- ── 1. Make sure every provider already in use is registered ─────────────────
--
-- The FK cannot be added while a single row holds an unregistered value, and
-- the live schema is drifted from this migration history — so the values
-- actually present are discovered rather than assumed.

INSERT INTO public.publish_providers (provider, kind, is_supported, requires_credential, notes)
SELECT DISTINCT
  ca.provider,
  'direct',
  false,
  true,
  'Auto-registered by 20260904180000 from existing rows. Unrecognised: verify whether this provider is real before marking it supported.'
FROM public.connected_accounts ca
WHERE ca.provider IS NOT NULL
  AND ca.provider <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.publish_providers pp WHERE pp.provider = ca.provider
  )
ON CONFLICT (provider) DO NOTHING;

-- Empty-string providers would fail the FK. There is no sensible provider for
-- them, and 'direct' is the historical default the column already carries.
UPDATE public.connected_accounts
SET provider = 'direct'
WHERE provider IS NULL OR provider = '';

-- ── 2. Replace the frozen CHECK with the registry reference ──────────────────

ALTER TABLE public.connected_accounts
  DROP CONSTRAINT IF EXISTS connected_accounts_provider_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'connected_accounts_provider_fkey'
      AND conrelid = 'public.connected_accounts'::regclass
  ) THEN
    ALTER TABLE public.connected_accounts
      ADD CONSTRAINT connected_accounts_provider_fkey
      FOREIGN KEY (provider)
      REFERENCES public.publish_providers(provider)
      -- RESTRICT: removing a provider that accounts still point at should fail
      -- loudly rather than orphan or silently rewrite live connections.
      ON DELETE RESTRICT
      ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_connected_accounts_provider
  ON public.connected_accounts(provider);

-- ── 3. Post-conditions — exercise the actual failure, not a proxy ────────────

DO $$
DECLARE
  probe_user uuid;
  probe_id   uuid;
BEGIN
  -- The frozen CHECK must be gone.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'connected_accounts_provider_check'
      AND conrelid = 'public.connected_accounts'::regclass
  ) THEN
    RAISE EXCEPTION 'post-condition failed: the old provider CHECK still exists — LinkedIn connect will keep failing with 23514';
  END IF;

  -- Every existing row satisfies the new reference.
  IF EXISTS (
    SELECT 1 FROM public.connected_accounts ca
    LEFT JOIN public.publish_providers pp ON pp.provider = ca.provider
    WHERE pp.provider IS NULL
  ) THEN
    RAISE EXCEPTION 'post-condition failed: some connected_accounts rows reference an unregistered provider';
  END IF;

  -- The real test: can a LinkedIn row actually be written now? Asserting the
  -- constraint's absence is not the same as proving the insert succeeds, and
  -- it was an insert that failed in production.
  SELECT id INTO probe_user FROM auth.users LIMIT 1;
  IF probe_user IS NOT NULL THEN
    BEGIN
      INSERT INTO public.connected_accounts
        (user_id, platform, scope, account_id, account_name, display_name, username,
         provider, connection_status, is_mock)
      VALUES
        (probe_user, 'linkedin', 'personal', '__postcondition_probe__', 'probe', 'probe', 'probe',
         'linkedin', 'active', false)
      RETURNING id INTO probe_id;

      DELETE FROM public.connected_accounts WHERE id = probe_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION
        'post-condition failed: a provider=linkedin row still cannot be inserted (%)', SQLERRM;
    END;
  END IF;

  RAISE NOTICE 'provider is now registry-backed; a linkedin account can be written.';
END;
$$;

COMMIT;
