-- 20260822100000_backfill_profile_status.sql
--
-- WAVE 4 / LOCK L4.6 — give every profile a status, so status-filtered
-- processes stop silently skipping users.
--
-- ── The defect ───────────────────────────────────────────────────────────────
-- public.profiles.status is NULL for 2 of 14 rows. Both predate the signup
-- trigger that coalesces it to 'active'
-- (20260302110000_profile_provisioning_and_status_domain.sql:41), so they were
-- never backfilled:
--
--   29944d39…  ojomodare369@gmail.com     created 2025-11-21  (QA account)
--   c59668c3…  peculiarmedia01@gmail.com  created 2025-11-24  (ADMIN account)
--
-- They are the two OLDEST accounts in the system — including the administrator's
-- own — and every query filtering `status = 'active'` skips them silently. NULL
-- is not equal to 'active', and it is not not-equal either; it simply never
-- matches, and nothing reports the omission.
--
-- Concrete consequence found during the cron audit: daily-analysis selects
-- `.eq('status','active')` (daily-analysis/index.ts:41-43), so these two users
-- are excluded from every nightly run. That is one of three gates blocking
-- ghost slots, and the reason the intersection of eligible users is EMPTY:
--
--   29944d39 — flag enabled ✅, has content pillars ✅, status NULL ❌
--   8baf52b4 — status active ✅, flag enabled ✅, no content pillars ❌
--
-- So a fully implemented feature has produced 0 rows in 5 months, and one of
-- the two reasons is a null column on the two oldest accounts.
--
-- ── Fix ──────────────────────────────────────────────────────────────────────
--   1. Backfill NULL -> 'active'. 'active' is the only value present in live
--      data (12 of 14 rows), and the signup path already defaults to it.
--   2. Set a column DEFAULT so a row can never again be created without one,
--      independent of whichever trigger happens to run.
--
-- NOT set NOT NULL: that would be the stricter guarantee, but it risks failing
-- against any code path that inserts a profile without a status. The default
-- plus the existing trigger closes the practical gap; tightening to NOT NULL
-- belongs with a full insert-path audit rather than being bundled here.
--
-- VERIFY: SELECT count(*) FROM public.profiles WHERE status IS NULL;  -- 0
-- SAFE TO RE-RUN: yes

BEGIN;

-- 1. Backfill.
UPDATE public.profiles
SET status = 'active'
WHERE status IS NULL;

-- 2. Prevent recurrence.
ALTER TABLE public.profiles
  ALTER COLUMN status SET DEFAULT 'active';

-- ── Post-condition ───────────────────────────────────────────────────────────

DO $$
DECLARE
  null_status int;
  has_default boolean;
BEGIN
  SELECT count(*) INTO null_status FROM public.profiles WHERE status IS NULL;

  IF null_status > 0 THEN
    RAISE EXCEPTION
      'L4.6 post-condition failed: % profile(s) still have a NULL status', null_status;
  END IF;

  SELECT column_default IS NOT NULL INTO has_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'status';

  IF NOT has_default THEN
    RAISE EXCEPTION 'L4.6 post-condition failed: profiles.status has no DEFAULT';
  END IF;

  RAISE NOTICE 'L4.6: every profile has a status, and new rows default to active';
END;
$$;

COMMIT;
