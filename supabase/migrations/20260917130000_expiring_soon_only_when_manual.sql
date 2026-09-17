-- 20260917130000_expiring_soon_only_when_manual.sql
--
-- Stop warning people about a token the worker refreshes for them.
--
-- ── The false alarm ─────────────────────────────────────────────────────────
-- A freshly connected, fully working YouTube account displays "Expiring soon —
-- Reconnect soon to keep publishing without interruption"
-- (ConnectedAccountCard.jsx:75). It is wrong, and it is wrong PERMANENTLY.
--
-- The view's test (20260904140000:205-209) is provider-agnostic:
--
--   token_expires_at > now() AND token_expires_at <= now() + interval '7 days'
--
-- Google access tokens live ONE HOUR. Every YouTube account therefore satisfies
-- "expires within 7 days" from the moment it connects until the moment it is
-- removed, and refresh-social-tokens renews it at 80% of its lifetime without
-- anybody doing anything. The warning asks the user to fix something that is
-- not broken, every time they look at the page.
--
-- The test was written for LinkedIn, which issues no refresh token on the
-- standard tier: its 60-day token really does die and really does need a manual
-- reconnect. The condition that matters is not "expires soon" — it is
-- "expires soon AND NOTHING WILL RENEW IT".
--
-- ── Why a column and a trigger, not a join ──────────────────────────────────
-- Whether a refresh token exists is only knowable from
-- connected_account_secrets, which the browser cannot read — deliberately, that
-- is the whole point of 20260904120000. The view is security_invoker, so a join
-- to that table would return nothing for exactly the users who need the answer.
--
-- 20260904120000 already solved this once, for has_credential: a boolean on
-- connected_accounts, maintained by an AFTER trigger on the secrets table. This
-- extends that same trigger rather than inventing a second mechanism.
--
-- ── Why this matters beyond tidiness ────────────────────────────────────────
-- A warning that is always on is a warning nobody reads. When LinkedIn's token
-- genuinely approaches its deadline, the badge saying so will have been crying
-- wolf on every other account for months.
--
-- VERIFY:
--   SELECT platform, token_expires_at, has_refresh_token, credential_expiring_soon
--   FROM public.connected_accounts_health_summary ORDER BY platform;
--
-- SAFE TO RE-RUN: yes.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Evidence that something will renew this credential
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.connected_accounts
  ADD COLUMN IF NOT EXISTS has_refresh_token boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.connected_accounts.has_refresh_token IS
  'True when connected_account_secrets holds a refresh token for this account, '
  'so refresh-social-tokens can renew it without the user. Trigger-maintained, '
  'never written by application code. Exists because the browser cannot read '
  'the secrets table and must still know whether an expiry is the user''s '
  'problem.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. One trigger maintains both flags
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Same function as 20260904120000 installed, widened. Replacing it keeps a
-- single writer for both columns: two triggers reading the same row is how
-- they end up disagreeing.

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
      ),
      has_refresh_token = EXISTS (
        SELECT 1 FROM public.connected_account_secrets s
        WHERE s.connected_account_id = target
          AND s.refresh_token_ciphertext IS NOT NULL
      )
  WHERE ca.id = target;

  RETURN NULL;  -- AFTER trigger
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_has_credential ON public.connected_account_secrets;
CREATE TRIGGER trg_sync_has_credential
  AFTER INSERT OR UPDATE OR DELETE ON public.connected_account_secrets
  FOR EACH ROW EXECUTE FUNCTION public.sync_connected_account_has_credential();

-- Backfill, so the flag is right for accounts connected before today rather
-- than only after their next token write.
UPDATE public.connected_accounts ca
SET has_refresh_token = EXISTS (
      SELECT 1 FROM public.connected_account_secrets s
      WHERE s.connected_account_id = ca.id
        AND s.refresh_token_ciphertext IS NOT NULL
    )
WHERE true;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Rebuild the view
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Reproduced from 20260904140000:157-219 with two changes, and nothing else:
-- has_refresh_token is exposed, and credential_expiring_soon now requires that
-- no refresh token exists.

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
  ca.has_refresh_token,

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

  -- Expiring-soon warning — a DEADLINE FOR THE USER, not a fact about clocks.
  -- An account with a refresh token is renewed by refresh-social-tokens at 80%
  -- of its lifetime and needs nothing from anybody; saying otherwise on every
  -- Google account (one-hour tokens) trains people to ignore the badge before
  -- LinkedIn, which has no refresh token, ever needs it.
  --
  -- If renewal fails terminally the worker marks the account expired, and
  -- can_publish/publish_block_reason report credential_expired. That path is
  -- the one that tells the user to act, and it is based on an observed
  -- failure rather than a countdown.
  (
    ca.token_expires_at IS NOT NULL
    AND ca.token_expires_at > now()
    AND ca.token_expires_at <= now() + interval '7 days'
    AND ca.has_refresh_token IS NOT TRUE
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
  'connection_status, both of which are blind to whether publishing can work. '
  'credential_expiring_soon means the USER must act: an account that renews '
  'itself is never expiring.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Post-conditions — observed, not asserted
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The claim is about what a user sees, so the check builds two accounts that
-- differ in exactly one way and reads the view. Everything is created inside a
-- subtransaction and unwound by the final RAISE.

DO $$
DECLARE
  probe_user   uuid;
  renewable    uuid;
  manual       uuid;
  flag_renew   boolean;
  flag_manual  boolean;
  synced       boolean;
BEGIN
  SELECT id INTO probe_user FROM auth.users ORDER BY created_at LIMIT 1;
  IF probe_user IS NULL THEN
    RAISE EXCEPTION 'post-condition cannot run: auth.users is empty';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.platform_registry WHERE platform_key = 'youtube') THEN
    RAISE EXCEPTION
      'post-condition cannot run: platform_registry has no youtube row, so the view '
      'JOIN excludes every YouTube account — which would itself be a defect';
  END IF;

  BEGIN
    -- An account that renews itself (YouTube: one-hour tokens, refresh token).
    INSERT INTO public.connected_accounts
      (user_id, platform, provider, account_name, token_expires_at, connection_status)
    VALUES
      (probe_user, 'youtube', 'youtube', '__expiry_probe_renewable__',
       now() + interval '55 minutes', 'active')
    RETURNING id INTO renewable;

    INSERT INTO public.connected_account_secrets
      (connected_account_id, access_token_ciphertext, refresh_token_ciphertext, expires_at)
    VALUES (renewable, 'v1.aaa.bbb.ccc', 'v1.ddd.eee.fff', now() + interval '55 minutes');

    -- The trigger must have set both flags. If it did not, the view below is
    -- computing on a stale column and every later check is meaningless.
    SELECT has_refresh_token INTO synced
    FROM public.connected_accounts WHERE id = renewable;
    IF synced IS NOT TRUE THEN
      RAISE EXCEPTION
        'post-condition failed: storing a refresh token did not set '
        'has_refresh_token — the trigger is not maintaining the column';
    END IF;

    -- An account nobody can renew (LinkedIn's standard tier).
    INSERT INTO public.connected_accounts
      (user_id, platform, provider, account_name, token_expires_at, connection_status)
    VALUES
      (probe_user, 'linkedin', 'linkedin', '__expiry_probe_manual__',
       now() + interval '3 days', 'active')
    RETURNING id INTO manual;

    INSERT INTO public.connected_account_secrets
      (connected_account_id, access_token_ciphertext, refresh_token_ciphertext, expires_at)
    VALUES (manual, 'v1.aaa.bbb.ccc', NULL, now() + interval '3 days');

    SELECT credential_expiring_soon INTO flag_renew
    FROM public.connected_accounts_health_summary WHERE id = renewable;
    SELECT credential_expiring_soon INTO flag_manual
    FROM public.connected_accounts_health_summary WHERE id = manual;

    IF flag_renew IS NOT FALSE THEN
      RAISE EXCEPTION
        'post-condition failed: an account with a refresh token still reports '
        'credential_expiring_soon. Every Google account would keep showing '
        '"Expiring soon" forever, which is the defect this migration exists to fix.';
    END IF;

    IF flag_manual IS NOT TRUE THEN
      RAISE EXCEPTION
        'post-condition failed: an account with NO refresh token expiring in 3 days '
        'does not report credential_expiring_soon. The warning has been silenced for '
        'the one case that genuinely needs it — worse than the false alarm.';
    END IF;

    -- Removing the refresh token must flip the flag back on: the check has to
    -- react to state, not merely have been right once at insert time.
    UPDATE public.connected_account_secrets
    SET refresh_token_ciphertext = NULL
    WHERE connected_account_id = renewable;

    SELECT credential_expiring_soon INTO flag_renew
    FROM public.connected_accounts_health_summary WHERE id = renewable;

    IF flag_renew IS NOT TRUE THEN
      RAISE EXCEPTION
        'post-condition failed: after losing its refresh token the account still '
        'reports no expiry warning — a user who must reconnect would never be told';
    END IF;

    RAISE EXCEPTION 'expiry_probe_rollback';

  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'expiry_probe_rollback' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'post-conditions passed: self-renewing accounts are silent, manual ones warn';
  END;
END $$;

COMMIT;
