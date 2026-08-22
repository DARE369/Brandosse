-- 20260821220000_account_publish_capability.sql
--
-- WAVE 2 / LOCK L2.1 + L2.2 — make an account's real publishing capability
-- visible to the UI, so it can stop reporting "Healthy" for accounts that
-- cannot publish at all.
--
-- ── The defect ───────────────────────────────────────────────────────────────
-- The dashboard derives an account's badge from `connection_status` alone
-- (src/hooks/useDashboardData.js:126-140), with a fallback of
-- `{ label: "Healthy", tone: "success" }` for any unrecognised value — a
-- fail-open default expressed in UI.
--
-- Two consequences, both live:
--
--   1. Four accounts (instagram x2, linkedin, youtube) carry is_mock = false
--      with provider = 'direct'. The direct per-platform publishing path was
--      REMOVED from the codebase (see publish-post/index.ts:161-171, which now
--      returns "Unsupported publishing provider"). They are structurally
--      incapable of publishing, and every one of them renders as green
--      "Healthy".
--
--   2. The single real, working account (TikTok via Zernio) currently sits at
--      health_score = 20 with a recorded failure reason, and also renders as
--      green "Healthy" — because health_score and last_failure_reason are
--      fetched by the dashboard query and then never read.
--
-- A user told "Healthy" has no reason to investigate. The UI is what prevents
-- them discovering the truth, which is worse than showing nothing.
--
-- ── Why fix this in the VIEW rather than only in the component ───────────────
-- `provider` is not exposed by connected_accounts_health_summary at all, so the
-- dashboard cannot currently detect case (1) even if the component wanted to.
-- Deriving capability once, server-side, means every consumer inherits it and
-- the next component cannot reintroduce the same bug by forgetting to check.
--
-- ── Changes ──────────────────────────────────────────────────────────────────
--   + provider              — passthrough, previously absent
--   + can_publish           — computed: is this account actually able to publish?
--   + publish_block_reason  — machine-readable reason when it cannot
--
-- Column list changes, so the view must be dropped and rebuilt (CREATE OR
-- REPLACE VIEW cannot add columns mid-list). security_invoker = true is
-- preserved, so the caller's RLS still applies.
--
-- VERIFY: SELECT platform, provider, can_publish, publish_block_reason
--         FROM public.connected_accounts_health_summary WHERE scope = 'personal';
--         The four provider='direct' rows must show can_publish = false.
-- SAFE TO RE-RUN: yes

BEGIN;

DROP VIEW IF EXISTS public.connected_accounts_health_summary;

CREATE VIEW public.connected_accounts_health_summary
WITH (security_invoker = true) AS
SELECT
  ca.id,
  ca.user_id,
  ca.organization_id,
  ca.brand_project_id,
  ca.scope,
  ca.platform,
  ca.account_name,
  ca.display_name,
  ca.username,
  ca.profile_type,
  ca.profile_picture_url,
  ca.avatar_url,
  ca.connection_status,
  ca.health_score,
  ca.consecutive_failure_count,
  ca.last_failure_at,
  ca.last_failure_reason,
  ca.last_successful_publish_at,
  ca.total_posts_published,
  ca.total_posts_scheduled,
  ca.is_mock,
  ca.token_expires_at,
  ca.follower_count,
  ca.account_category,
  ca.granted_member_ids,

  -- LOCK L2.2 — the provider decides whether publishing is even possible.
  ca.provider,

  -- Can this account actually publish right now?
  --   mock accounts        -> yes, within the simulation
  --   provider = 'zernio'  -> yes, the only real publishing path
  --   provider = anything else (incl. the removed 'direct' path) -> NO
  (
    ca.is_mock IS TRUE
    OR coalesce(ca.provider, '') = 'zernio'
  ) AS can_publish,

  -- Machine-readable reason, so the UI renders a cause rather than inventing one.
  CASE
    WHEN ca.is_mock IS TRUE THEN NULL
    WHEN coalesce(ca.provider, '') = 'zernio' THEN NULL
    WHEN coalesce(ca.provider, '') = 'direct' THEN 'provider_removed'
    WHEN coalesce(ca.provider, '') = ''       THEN 'provider_missing'
    ELSE 'provider_unsupported'
  END AS publish_block_reason,

  pr.brand_color,
  pr.display_name AS platform_display_name,
  pr.icon_url,
  pr.supported_profile_types,
  pr.supported_content_types,
  pr.supports_stories,
  pr.supports_reels,
  pr.supports_carousels,
  pr.character_limit
FROM public.connected_accounts ca
JOIN public.platform_registry pr
  ON pr.platform_key = ca.platform
WHERE coalesce(ca.connection_status, 'active') NOT IN ('revoked', 'disconnected');

COMMENT ON VIEW public.connected_accounts_health_summary IS
  'LOCK L2.1/L2.2 — exposes provider, can_publish and publish_block_reason so the UI can never again report an unpublishable account as Healthy. Capability is computed here, once, so every consumer inherits it.';

-- ── Post-condition ───────────────────────────────────────────────────────────

DO $$
DECLARE
  direct_publishable int;
  total_rows         int;
BEGIN
  SELECT count(*) INTO total_rows FROM public.connected_accounts_health_summary;

  -- No account on a removed provider may report itself publishable.
  SELECT count(*) INTO direct_publishable
  FROM public.connected_accounts_health_summary
  WHERE can_publish = true
    AND coalesce(provider, '') NOT IN ('zernio')
    AND is_mock IS NOT TRUE;

  IF direct_publishable > 0 THEN
    RAISE EXCEPTION
      'L2.2 post-condition failed: % account(s) report can_publish=true without a working provider',
      direct_publishable;
  END IF;

  RAISE NOTICE 'L2.2: capability exposed on % account row(s); no false positives', total_rows;
END;
$$;

COMMIT;
