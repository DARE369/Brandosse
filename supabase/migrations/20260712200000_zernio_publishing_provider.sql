-- ============================================================================
-- Migration: zernio_publishing_provider
-- Date: 2026-07-12
-- Purpose:
--   1) connected_accounts.provider — distinguishes the two real-publish paths
--      ('direct' = per-platform OAuth in publisher.service.ts, 'zernio' = via
--      the Zernio unified API). Only meaningful when is_mock = false; existing
--      rows default to 'direct' since that's the only real path that existed
--      before this migration.
--   2) profiles.zernio_profile_id — Zernio's own multi-tenant "profile" id,
--      one per Brandosse user, created lazily on first Zernio connect and
--      reused for every platform account that user connects through Zernio.
-- ============================================================================

ALTER TABLE public.connected_accounts
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'direct';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'connected_accounts_provider_check'
      AND conrelid = 'public.connected_accounts'::regclass
  ) THEN
    ALTER TABLE public.connected_accounts
      ADD CONSTRAINT connected_accounts_provider_check
      CHECK (provider IN ('direct', 'zernio'));
  END IF;
END
$$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS zernio_profile_id text;
