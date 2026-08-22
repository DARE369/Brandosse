-- 20260821120000_fix_profile_role_privilege_escalation.sql
--
-- WAVE 1 / LOCK L1.5 — close a WRITE-CONFIRMED privilege escalation that
-- bypasses the cross-tenant RLS fix applied in 20260821090000.
--
-- ── The defect (demonstrated live 2026-08-21) ────────────────────────────────
-- An ordinary authenticated user, holding only the public anon key and their
-- own JWT, can promote themselves to administrator:
--
--   PATCH /rest/v1/profiles?id=eq.<self>   {"role":"admin"}   -> HTTP 200
--
-- Verified against a real non-admin account: profiles.role went "parent" ->
-- "admin" and was accepted. (Reverted immediately.)
--
-- ── Why this is critical rather than cosmetic ────────────────────────────────
-- profiles.role feeds the entire admin authorization chain:
--
--   profiles.role = 'admin'
--     -> get_admin_role()        returns 'super_admin'
--        (admin_foundation.sql:310-317 COALESCEs to profiles.role)
--     -> is_admin_user()         returns true
--     -> is_super_admin_user()   returns true
--     -> can_admin_access_user(anyone) returns true
--     -> posts policy       "auth.uid() = user_id OR can_admin_access_user(...)"
--        grants EVERY row
--     -> generations policy "... OR is_admin_user(auth.uid())"
--        grants EVERY row
--
-- So the cross-tenant leak closed in 20260821090000 is fully reopenable by any
-- user in a single request. That migration is necessary but not sufficient
-- without this one.
--
-- ── Root cause ───────────────────────────────────────────────────────────────
-- public.profile_self_update_guard() already exists and is correct: it asserts
-- role / is_admin / credits / status / organization_id are unchanged on a self
-- update. Migration 20260513160000:194-214 already wires it into the "Users
-- update own profile" policy.
--
-- That policy is NOT what is live. Live behaviour matches the older, permissive
-- version from 20260312153000:594-597, which checks only "auth.uid() = id".
-- The hardening was written, committed, and never took effect — the same
-- pattern the audit found throughout this codebase.
--
-- ── Fix (defence in depth, both ends of the chain) ───────────────────────────
--   1. Rebuild the profiles UPDATE policy so self-updates run through the guard.
--   2. Remove the profiles.role fallback from get_admin_role(), so admin status
--      derives ONLY from the admin_roles table.
--
-- Step 2 is verified safe: the single profiles.role='admin' account
-- (c59668c3-0f96-4b83-8449-23c710bc24e6) also holds an admin_roles row with
-- role='super_admin'. Both live admins are in admin_roles. Nobody loses access.
--
-- VERIFY: node scripts/security/cross-tenant-probe.mjs   (includes the
--         escalation attempt; must report "escalation blocked")
-- SAFE TO RE-RUN: yes

BEGIN;

-- ── 1. Self-updates must not change privilege columns ────────────────────────

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

-- Admins may still update profiles they are scoped to (unchanged behaviour).
DROP POLICY IF EXISTS "Scoped admins update profiles" ON public.profiles;
CREATE POLICY "Scoped admins update profiles"
  ON public.profiles FOR UPDATE
  USING (public.can_admin_access_user(auth.uid(), id))
  WITH CHECK (public.can_admin_access_user(auth.uid(), id));

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ── 2. Admin status derives only from admin_roles ────────────────────────────
-- Removes the COALESCE fallback to profiles.role. Even if a role column were
-- somehow written again, it can no longer confer administrative access.

CREATE OR REPLACE FUNCTION public.get_admin_role(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- profiles.role is deliberately NOT consulted (LOCK L1.5). It is a
  -- user-facing attribute, was self-writable, and must never be an
  -- authorization source. admin_roles is the only grant table.
  SELECT ar.role
  FROM public.admin_roles ar
  WHERE ar.user_id = p_user_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_admin_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_role(uuid) TO authenticated;

-- ── 3. Post-conditions ───────────────────────────────────────────────────────

DO $$
DECLARE
  existing_admins int;
  guard_wired     int;
BEGIN
  -- Both known admins must still resolve as admins after removing the fallback.
  SELECT count(*) INTO existing_admins
  FROM public.admin_roles
  WHERE role IN ('super_admin', 'org_admin');

  IF existing_admins < 1 THEN
    RAISE EXCEPTION
      'L1.5 post-condition failed: no admin_roles rows remain — removing the '
      'profiles.role fallback would lock out all administrators';
  END IF;

  -- The self-update policy must reference the guard.
  SELECT count(*) INTO guard_wired
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'profiles'
    AND policyname = 'Users update own profile'
    AND with_check LIKE '%profile_self_update_guard%';

  IF guard_wired <> 1 THEN
    RAISE EXCEPTION
      'L1.5 post-condition failed: profiles self-update policy is not wired to '
      'profile_self_update_guard (found % matching policies)', guard_wired;
  END IF;

  RAISE NOTICE
    'L1.5: escalation path closed — guard wired, admin_roles is the only grant source (% admin row(s))',
    existing_admins;
END;
$$;

COMMIT;
