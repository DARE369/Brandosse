-- 20260821140000_force_profiles_self_update_guard.sql
--
-- WAVE 1 / LOCK L1.5 (second attempt) — supersedes the policy half of
-- 20260821120000, which did not take effect.
--
-- ── Why the previous migration was insufficient ──────────────────────────────
-- 20260821120000 dropped exactly two policies BY NAME ("Users update own
-- profile", "Scoped admins update profiles") and recreated them correctly.
-- RLS policies are OR-ed, so any OTHER permissive UPDATE policy on
-- public.profiles — including one the migration history does not describe —
-- keeps granting the write regardless of how correct those two are.
--
-- This is the same defect class as the cross-tenant leak on public.posts: a
-- live-only policy with no corresponding migration. 20260821090000 handled that
-- correctly with an allowlist sweep. That pattern was not applied to profiles.
-- This migration applies it.
--
-- ── Verified live state (2026-08-21, ordinary non-admin JWT + anon key) ──────
--   PATCH /rest/v1/profiles?id=eq.<self> {"full_name":"..."}  -> 204  (allowed, correct)
--   PATCH /rest/v1/profiles?id=eq.<self> {"role":"admin"}     -> 204  role CHANGED
--   PATCH /rest/v1/profiles?id=eq.<self> {"credits":999999}   -> 204  credits CHANGED
--
-- Two distinct exploits, both live:
--
--   1. PRIVILEGE ESCALATION — role feeds get_admin_role -> is_admin_user ->
--      can_admin_access_user, so self-promoting to 'admin' grants read access
--      to every row in posts and generations, reopening the leak that
--      20260821090000 closed.
--
--   2. CREDIT MINTING — a user can set their own balance arbitrarily. Credits
--      gate video generation, image generation and clipping, each of which
--      costs real money per call. This is a direct, unmetered spend exploit
--      against the business and needs no sophistication whatsoever.
--
-- ── Fix ──────────────────────────────────────────────────────────────────────
-- Drop EVERY policy on public.profiles that is not on a known-good allowlist,
-- then recreate the intended set. Asserts the end state rather than assuming
-- the start state, and logs whatever it removes so the unknown policy is
-- finally identified.
--
-- VERIFY: node scripts/security/cross-tenant-probe.mjs
--         must report: "ok  privilege escalation  blocked"
-- SAFE TO RE-RUN: yes

BEGIN;

-- ── 1. Sweep every non-allowlisted policy off public.profiles ────────────────

DO $$
DECLARE
  pol record;
  dropped_count int := 0;
BEGIN
  FOR pol IN
    SELECT policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'profiles'
      AND policyname NOT IN (
        'Users update own profile',
        'Scoped admins update profiles',
        'Users insert own profile',
        'Users view own profile',
        'Scoped admins view profiles',
        'org_workspace_member_read_profiles'
      )
  LOOP
    RAISE WARNING
      'L1.5: dropping unexpected policy on public.profiles -> % (cmd=%) — likely the live-only policy that kept self-updates open',
      pol.policyname, pol.cmd;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', pol.policyname);
    dropped_count := dropped_count + 1;
  END LOOP;

  RAISE NOTICE 'L1.5: dropped % unexpected policy/policies on public.profiles', dropped_count;
END;
$$;

-- ── 2. Recreate the intended policy set ──────────────────────────────────────

-- Self-update: allowed, but privileged columns must be unchanged.
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND public.profile_self_update_guard(
      id,
      email,
      role,
      is_admin,
      credits,
      status,
      organization_id,
      activity_status,
      suspension_type,
      suspension_expires_at,
      deletion_requested_at,
      deletion_eligible_at
    )
  );

-- Admins may update profiles within their scope.
DROP POLICY IF EXISTS "Scoped admins update profiles" ON public.profiles;
CREATE POLICY "Scoped admins update profiles"
  ON public.profiles FOR UPDATE
  USING (public.can_admin_access_user(auth.uid(), id))
  WITH CHECK (public.can_admin_access_user(auth.uid(), id));

-- Read: own profile, admin-scoped, or a shared active organization.
DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
CREATE POLICY "Users view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Scoped admins view profiles" ON public.profiles;
CREATE POLICY "Scoped admins view profiles"
  ON public.profiles FOR SELECT
  USING (public.can_admin_access_user(auth.uid(), id));

DROP POLICY IF EXISTS org_workspace_member_read_profiles ON public.profiles;
CREATE POLICY org_workspace_member_read_profiles
  ON public.profiles FOR SELECT
  USING (public.org_users_share_active_organization(id));

-- Insert: only your own row.
DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE  ROW LEVEL SECURITY;

-- ── 3. Post-conditions ───────────────────────────────────────────────────────

DO $$
DECLARE
  update_policies int;
  guard_wired     int;
BEGIN
  SELECT count(*) INTO update_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'UPDATE';

  -- Exactly two UPDATE policies may exist: the guarded self-update, and the
  -- admin-scoped one. A third would re-open the hole by OR-ing around them.
  IF update_policies <> 2 THEN
    RAISE EXCEPTION
      'L1.5 post-condition failed: expected exactly 2 UPDATE policies on public.profiles, found %',
      update_policies;
  END IF;

  SELECT count(*) INTO guard_wired
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'profiles'
    AND policyname = 'Users update own profile'
    AND with_check LIKE '%profile_self_update_guard%';

  IF guard_wired <> 1 THEN
    RAISE EXCEPTION
      'L1.5 post-condition failed: self-update policy is not wired to profile_self_update_guard';
  END IF;

  RAISE NOTICE 'L1.5: profiles locked — 2 UPDATE policies, guard wired, RLS forced';
END;
$$;

COMMIT;
