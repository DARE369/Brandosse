-- 20260904140000_publish_capability_registry.sql
--
-- Make "can this account actually publish?" TRUE for every provider, not just
-- Zernio — and stop the answer being a hardcoded string that has to be edited
-- each time a platform migrates.
--
-- ── The defect ───────────────────────────────────────────────────────────────
-- 20260821220000 introduced connected_accounts_health_summary.can_publish to
-- stop the UI reporting unpublishable accounts as green "Healthy". It computed
-- capability as:
--
--     (ca.is_mock IS TRUE OR coalesce(ca.provider,'') = 'zernio')
--
-- That was correct on the day it shipped, when Zernio was the only real
-- publishing path. It is wrong now: LinkedIn publishes through its own adapter
-- (supabase/functions/_shared/linkedin.service.ts), so a working LinkedIn
-- account reports can_publish = false. The UI would tell a user their account
-- cannot publish while it publishes perfectly well.
--
-- That is the same honesty failure the original migration was written to fix,
-- pointing the other way — and it is just as damaging, because a user told
-- "this cannot publish" will go and reconnect a working account, or conclude
-- the product is broken.
--
-- ── Why a registry table instead of adding 'linkedin' to the string test ─────
-- Because the next platform would break it again, and the one after that. The
-- provider list belongs in data, not in a view definition: migrating a platform
-- then becomes a one-row UPDATE rather than a view rewrite, and the whole
-- remaining Zernio footprint is one visible, queryable list you can watch
-- shrink to nothing.
--
-- ── Why capability is EVIDENCE-BASED, not an allowlist ───────────────────────
-- Being on the supported list is necessary but not sufficient. A direct-OAuth
-- account also needs a stored credential that has not expired. Checking the
-- provider name alone would reproduce the original bug in a new costume:
-- an account whose token failed to save, or expired last week, would still
-- report itself publishable.
--
-- ── Why a denormalised boolean rather than joining the secrets table ─────────
-- connected_account_secrets grants NOTHING to authenticated (20260904120000,
-- defect D1), and this view is security_invoker so it runs as the caller. A
-- join would fail with "permission denied" for every real user.
--
-- Loosening the grant to make the join work would partly undo D1. So the
-- non-secret FACT (does a credential exist?) is carried on connected_accounts
-- as a boolean, maintained by trigger. The secrets table stays sealed; the view
-- never touches it.
--
-- VERIFY:
--   SELECT platform, provider, can_publish, publish_block_reason
--   FROM public.connected_accounts_health_summary WHERE scope = 'personal';
--
-- SAFE TO RE-RUN: yes.

BEGIN;

-- ── 1. The provider registry ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.publish_providers (
  provider      text PRIMARY KEY,
  -- 'mock'   — simulated, publishes nothing real
  -- 'legacy' — Zernio; it holds the OAuth tokens, we never see them
  -- 'direct' — our own per-platform OAuth; we hold an encrypted credential
  kind          text NOT NULL CHECK (kind IN ('mock', 'legacy', 'direct')),
  is_supported  boolean NOT NULL DEFAULT false,
  -- Direct providers must prove they hold a live credential. Legacy ones
  -- cannot: Zernio owns the token, so there is nothing on our side to check.
  requires_credential boolean NOT NULL DEFAULT false,
  notes         text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.publish_providers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'publish_providers'
      AND policyname = 'publish_providers_read'
  ) THEN
    -- Readable by all: it is a capability lookup with no tenant data in it,
    -- and the view needs it under security_invoker.
    CREATE POLICY "publish_providers_read"
      ON public.publish_providers FOR SELECT USING (true);
  END IF;
END
$$;

GRANT SELECT ON public.publish_providers TO authenticated, anon;

INSERT INTO public.publish_providers (provider, kind, is_supported, requires_credential, notes)
VALUES
  ('mock',     'mock',   true,  false, 'Simulated publishing. Never reaches a platform.'),
  ('zernio',   'legacy', true,  false, 'Zernio unified API. Being removed one platform at a time; Zernio holds the OAuth token, so there is no local credential to verify.'),
  ('linkedin', 'direct', true,  true,  'Direct OAuth. Adapter: _shared/linkedin.service.ts. Migrated 2026-09-04.'),
  ('meta',     'direct', false, true,  'Facebook Pages + Instagram. Credentials exist; adapter not built yet.'),
  ('facebook', 'direct', false, true,  'Served by the meta provider. Adapter not built yet.'),
  ('instagram','direct', false, true,  'Served by the meta provider. Adapter not built yet.'),
  ('tiktok',   'direct', false, true,  'Adapter not built yet. Also blocked on content audit (SELF_ONLY until then).'),
  ('youtube',  'direct', false, true,  'Adapter not built yet. Also blocked on compliance audit (uploads lock private).'),
  ('direct',   'direct', false, true,  'Historical value from the removed per-platform path (see 20260821220000). Never publishable.')
ON CONFLICT (provider) DO UPDATE
SET kind = excluded.kind,
    is_supported = excluded.is_supported,
    requires_credential = excluded.requires_credential,
    notes = excluded.notes,
    updated_at = now();

COMMENT ON TABLE public.publish_providers IS
  'Single source of truth for which publishing providers work. Migrating a platform off Zernio is a one-row UPDATE here; the remaining Zernio footprint is SELECT * WHERE kind = ''legacy''.';

-- ── 2. Carry credential presence WITHOUT exposing the secrets table ──────────

ALTER TABLE public.connected_accounts
  ADD COLUMN IF NOT EXISTS has_credential boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.sync_connected_account_has_credential()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target uuid := coalesce(NEW.connected_account_id, OLD.connected_account_id);
BEGIN
  UPDATE public.connected_accounts ca
  SET has_credential = EXISTS (
        SELECT 1 FROM public.connected_account_secrets s
        WHERE s.connected_account_id = target
          AND s.access_token_ciphertext IS NOT NULL
      )
  WHERE ca.id = target;

  RETURN NULL;  -- AFTER trigger
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_has_credential ON public.connected_account_secrets;
CREATE TRIGGER trg_sync_has_credential
  AFTER INSERT OR UPDATE OR DELETE ON public.connected_account_secrets
  FOR EACH ROW EXECUTE FUNCTION public.sync_connected_account_has_credential();

-- Backfill, so the column is true the moment this migration lands rather than
-- only after the next write.
UPDATE public.connected_accounts ca
SET has_credential = EXISTS (
      SELECT 1 FROM public.connected_account_secrets s
      WHERE s.connected_account_id = ca.id
        AND s.access_token_ciphertext IS NOT NULL
    )
WHERE true;

-- ── 3. Rebuild the capability view ───────────────────────────────────────────

DROP VIEW IF EXISTS public.connected_accounts_health_summary;

CREATE VIEW public.connected_accounts_health_summary
WITH (security_invoker = true) AS
SELECT
  ca.id, ca.user_id, ca.organization_id, ca.brand_project_id, ca.scope,
  ca.platform, ca.account_name, ca.display_name, ca.username, ca.profile_type,
  ca.profile_picture_url, ca.avatar_url, ca.connection_status, ca.health_score,
  ca.consecutive_failure_count, ca.last_failure_at, ca.last_failure_reason,
  ca.last_successful_publish_at, ca.total_posts_published, ca.total_posts_scheduled,
  ca.is_mock, ca.token_expires_at, ca.follower_count, ca.account_category,
  ca.granted_member_ids, ca.provider,
  ca.has_credential,

  -- Resolved provider metadata, so a consumer can explain itself without
  -- knowing the registry exists.
  coalesce(pp.kind, 'direct')       AS provider_kind,
  coalesce(pp.is_supported, false)  AS provider_supported,

  -- Can this account publish RIGHT NOW?
  (
    CASE
      WHEN ca.is_mock IS TRUE THEN true
      WHEN coalesce(pp.is_supported, false) IS NOT TRUE THEN false
      WHEN coalesce(pp.requires_credential, true) IS NOT TRUE THEN true
      WHEN ca.has_credential IS NOT TRUE THEN false
      WHEN ca.token_expires_at IS NOT NULL AND ca.token_expires_at <= now() THEN false
      ELSE true
    END
  ) AS can_publish,

  -- Machine-readable cause, so the UI renders a real reason and a real fix
  -- rather than inventing one.
  CASE
    WHEN ca.is_mock IS TRUE THEN NULL
    WHEN coalesce(ca.provider, '') = '' THEN 'provider_missing'
    WHEN pp.provider IS NULL THEN 'provider_unknown'
    WHEN pp.is_supported IS NOT TRUE THEN 'provider_unsupported'
    WHEN coalesce(pp.requires_credential, true) IS TRUE
         AND ca.has_credential IS NOT TRUE THEN 'credential_missing'
    WHEN ca.token_expires_at IS NOT NULL
         AND ca.token_expires_at <= now() THEN 'credential_expired'
    ELSE NULL
  END AS publish_block_reason,

  -- Expiring-soon warning. LinkedIn issues no refresh token on the standard
  -- tier, so its tokens genuinely die after ~60 days and the user must
  -- reconnect by hand. Without this the first warning a user gets is a
  -- failed post.
  (
    ca.token_expires_at IS NOT NULL
    AND ca.token_expires_at > now()
    AND ca.token_expires_at <= now() + interval '7 days'
  ) AS credential_expiring_soon,

  pr.brand_color, pr.display_name AS platform_display_name, pr.icon_url,
  pr.supported_profile_types, pr.supported_content_types,
  pr.supports_stories, pr.supports_reels, pr.supports_carousels, pr.character_limit
FROM public.connected_accounts ca
JOIN public.platform_registry pr
  ON pr.platform_key = ca.platform
LEFT JOIN public.publish_providers pp
  ON pp.provider = ca.provider
WHERE coalesce(ca.connection_status, 'active') NOT IN ('revoked', 'disconnected');

COMMENT ON VIEW public.connected_accounts_health_summary IS
  'Capability is computed once, here, from the publish_providers registry plus '
  'evidence that a live credential exists. Consumers must read can_publish and '
  'publish_block_reason rather than deriving status from health_score or '
  'connection_status, both of which are blind to whether publishing can work.';

-- ── 4. Match the WRITE grants to the READ grants on the token columns ────────
--
-- 20260904120000 revoked SELECT on access_token/refresh_token/mock_token but
-- left INSERT/UPDATE in place, so a client could still write columns it cannot
-- read. No live exposure — the columns are unused now that secrets live in
-- their own table — but a grant nobody intended is a grant nobody is watching.

DO $$
DECLARE
  secret_cols CONSTANT text[] := ARRAY['access_token', 'refresh_token', 'mock_token'];
  col_list    text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO col_list
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'connected_accounts'
    AND column_name <> ALL (secret_cols);

  IF col_list IS NULL THEN
    RAISE EXCEPTION 'refusing to proceed — no grantable columns on connected_accounts';
  END IF;

  EXECUTE 'REVOKE INSERT, UPDATE ON public.connected_accounts FROM authenticated, anon';
  EXECUTE format('GRANT INSERT (%s), UPDATE (%s) ON public.connected_accounts TO authenticated', col_list, col_list);

  RAISE NOTICE 'write grants narrowed to non-secret columns';
END
$$;

-- ── 5. Post-conditions ───────────────────────────────────────────────────────

DO $$
DECLARE
  bad int;
BEGIN
  -- 5a. No unsupported provider may report itself publishable.
  SELECT count(*) INTO bad
  FROM public.connected_accounts_health_summary
  WHERE can_publish IS TRUE
    AND is_mock IS NOT TRUE
    AND provider_supported IS NOT TRUE;
  IF bad > 0 THEN
    RAISE EXCEPTION 'post-condition failed: % account(s) publishable on an unsupported provider', bad;
  END IF;

  -- 5b. A direct provider with no stored credential may never be publishable.
  SELECT count(*) INTO bad
  FROM public.connected_accounts_health_summary
  WHERE can_publish IS TRUE
    AND is_mock IS NOT TRUE
    AND provider_kind = 'direct'
    AND has_credential IS NOT TRUE;
  IF bad > 0 THEN
    RAISE EXCEPTION 'post-condition failed: % direct account(s) publishable with no credential', bad;
  END IF;

  -- 5c. Zernio must STILL work. This migration must not break the only path
  --     that currently publishes anything real.
  SELECT count(*) INTO bad
  FROM public.connected_accounts_health_summary
  WHERE provider = 'zernio' AND is_mock IS NOT TRUE AND can_publish IS NOT TRUE;
  IF bad > 0 THEN
    RAISE EXCEPTION 'post-condition failed: % Zernio account(s) lost publish capability', bad;
  END IF;

  -- 5d. Secrets remain unreachable, and the view did not smuggle one out.
  IF has_table_privilege('authenticated', 'public.connected_account_secrets', 'SELECT') THEN
    RAISE EXCEPTION 'post-condition failed: authenticated can read connected_account_secrets';
  END IF;
  IF has_column_privilege('authenticated', 'public.connected_accounts', 'access_token', 'SELECT')
     OR has_column_privilege('authenticated', 'public.connected_accounts', 'access_token', 'UPDATE') THEN
    RAISE EXCEPTION 'post-condition failed: authenticated can still read or write access_token';
  END IF;

  -- 5e. And the app can still do its job.
  IF NOT has_column_privilege('authenticated', 'public.connected_accounts', 'display_name', 'UPDATE') THEN
    RAISE EXCEPTION 'post-condition failed: authenticated LOST write access to display_name — renaming an account would break';
  END IF;

  RAISE NOTICE 'capability registry live; Zernio intact; secrets sealed.';
END;
$$;

COMMIT;
