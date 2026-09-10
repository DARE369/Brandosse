-- 20260909160000_mark_tiktok_youtube_publishable.sql
--
-- Mark TikTok and YouTube as supported publishing providers, now that both
-- have adapters.
--
-- ── The TikTok half is a live defect, not bookkeeping ────────────────────────
-- 20260904140000 seeded publish_providers with tiktok is_supported = false and
-- the note "Adapter not built yet". That was true when written. The adapter
-- shipped in PR #4 (_shared/tiktok.service.ts, dispatched from
-- publish-post/index.ts), and NO migration ever flipped the row — so today:
--
--   * connected_accounts_health_summary computes can_publish = false with
--     publish_block_reason = 'provider_unsupported';
--   * useDashboardData.js:179 renders that as a red "Not yet supported" with
--     "This account cannot publish. Reconnect it to restore posting."; and
--   * publish-post/index.ts dispatches on account.provider and never consults
--     can_publish, so the post would actually publish fine.
--
-- That is exactly the inverted lie 20260904140000 was written to fix, pointed
-- the other way — its own header says a user told "this cannot publish" will
-- "go and reconnect a working account, or conclude the product is broken".
-- Reintroduced for TikTok by omission.
--
-- Worse, it is self-healing in the wrong direction: 20260904140000 ends with
-- ON CONFLICT DO UPDATE SET is_supported = excluded.is_supported, so anyone
-- who fixed the row by hand in the SQL editor would have it silently reset to
-- false the next time that migration was re-applied. The fix has to be a
-- migration that lands AFTER it, which is what this is.
--
-- ── Supported does not mean unrestricted ────────────────────────────────────
-- Both platforms remain gated by their own review processes, and neither gate
-- is ours to open:
--
--   * TikTok: until the content audit passes, privacy_level must be SELF_ONLY
--     and the target account must be private, or init returns
--     403 unaudited_client_can_only_post_to_private_accounts.
--   * YouTube: until the compliance audit passes, every upload via
--     videos.insert is forced to private, permanently and unappealably.
--
-- is_supported answers "does a working adapter exist?", which is the question
-- can_publish needs. It is deliberately NOT a claim that the platform will
-- accept a public post. Conflating the two would put a platform-side policy in
-- a column that the UI reads as our own capability.
--
-- ── What is NOT claimed here ────────────────────────────────────────────────
-- Neither adapter has ever run against the real platform. No TikTok account has
-- ever been connected and no YouTube account has ever been connected. This
-- migration makes the capability view agree with the code; it does not make
-- either integration proven. The notes below say so, in the database, so the
-- claim and its caveat cannot drift apart.
--
-- VERIFY:
--   SELECT provider, is_supported, notes FROM public.publish_providers
--   WHERE provider IN ('tiktok','youtube','linkedin');
--
-- SAFE TO RE-RUN: yes.

BEGIN;

UPDATE public.publish_providers
SET is_supported = true,
    notes = 'Direct OAuth. Adapter: _shared/tiktok.service.ts, dispatched from '
            'publish-post/index.ts. Marked supported 2026-09-09. Still gated by '
            'TikTok''s content audit: until it passes, privacy_level must be '
            'SELF_ONLY and the account private. NOT yet proven live — no TikTok '
            'account has ever been connected.',
    updated_at = now()
WHERE provider = 'tiktok';

UPDATE public.publish_providers
SET is_supported = true,
    notes = 'Direct OAuth. Adapter: _shared/youtube.service.ts, dispatched from '
            'publish-post/index.ts. Resumable upload plus a processing poll, '
            'because an accepted upload is not a published video. Marked '
            'supported 2026-09-09. Still gated by Google''s compliance audit: '
            'until it passes, every upload is forced private and cannot be '
            'appealed. NOT yet proven live — no YouTube account has ever been '
            'connected.',
    updated_at = now()
WHERE provider = 'youtube';

-- ── Post-conditions ─────────────────────────────────────────────────────────

DO $$
DECLARE
  missing text;
BEGIN
  -- 1. Both rows exist and are now supported. A silent no-op here would leave
  --    the UI telling users their working accounts cannot publish, which is the
  --    entire defect being fixed — so an absent row is an error, not a skip.
  SELECT string_agg(p, ', ') INTO missing
  FROM unnest(ARRAY['tiktok', 'youtube']) AS p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.publish_providers pp
    WHERE pp.provider = p AND pp.is_supported IS TRUE
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'post-condition failed: % is not registered as a supported provider. '
      'The UI will keep reporting "Not yet supported" for accounts that can publish.',
      missing;
  END IF;

  -- 2. Every provider with an adapter must require a credential. A direct
  --    provider that does not would report can_publish = true for an account
  --    whose token failed to save — the original defect in a new costume.
  IF EXISTS (
    SELECT 1 FROM public.publish_providers
    WHERE provider IN ('tiktok', 'youtube', 'linkedin')
      AND (kind <> 'direct' OR requires_credential IS NOT TRUE)
  ) THEN
    RAISE EXCEPTION
      'post-condition failed: a direct-OAuth provider is not marked kind=direct '
      'with requires_credential=true; capability would stop being evidence-based';
  END IF;

  -- 3. Nothing else was widened by accident. Meta has credentials but no
  --    adapter, so it must still report unsupported.
  IF EXISTS (
    SELECT 1 FROM public.publish_providers
    WHERE provider IN ('meta', 'facebook', 'instagram', 'direct')
      AND is_supported IS TRUE
  ) THEN
    RAISE EXCEPTION
      'post-condition failed: a provider with no adapter is marked supported';
  END IF;

  RAISE NOTICE 'tiktok and youtube are now publishable; meta still correctly unsupported.';
END;
$$;

COMMIT;
