-- ============================================================================
-- Migration: remove_duplicate_signup_credit_trigger
-- Purpose (Phase 7 finding #3): two independent auth.users AFTER INSERT
--   triggers both seeded a 30-credit user_credits row on every signup —
--   on_auth_user_created_credits (supabase/video-engine-stage-1-schema.sql)
--   and handle_new_user_profile() (20260513160000_database_integrity_
--   security_cleanup.sql). Both were idempotent (ON CONFLICT / WHERE NOT
--   EXISTS) so they never double-credited anyone, but it was the same
--   business rule duplicated in two unrelated files.
--
--   handle_new_user_profile() is the canonical, actively-maintained signup
--   provisioner — it also creates profiles/user_settings rows and is
--   wrapped in exception handling so a failure never blocks signup. It
--   already seeds user_credits with balance=30, guarded by an existence
--   check. This migration removes the older, now-fully-redundant
--   on_auth_user_created_credits trigger and its dedicated function,
--   leaving handle_new_user_profile() as the single source of truth.
-- ============================================================================

DROP TRIGGER IF EXISTS on_auth_user_created_credits ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user_credits();
