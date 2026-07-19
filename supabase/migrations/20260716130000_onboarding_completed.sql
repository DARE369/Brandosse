-- =============================================================================
-- Migration: onboarding_completed_at on user_settings
-- Persists whether the 4-step first-login onboarding wizard has been shown
-- to completion/skip, so it appears exactly once per user regardless of
-- their generation/connection activity (unlike Dashboard's isFirstTime,
-- which is re-derived from data and would otherwise keep re-triggering it).
--
-- RUN IN: Supabase SQL Editor
-- SAFE TO RE-RUN: Yes — uses IF NOT EXISTS
-- =============================================================================

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
