-- 20260821090000_fix_cross_tenant_rls_posts_generations.sql
--
-- WAVE 1 / LOCK L1.1 — close the confirmed cross-tenant read exposure on
-- public.posts and public.generations.
--
-- ── The defect (verified live 2026-08-21) ────────────────────────────────────
-- An ordinary authenticated user, using only the public anon key and their own
-- JWT, can SELECT every row of public.posts and public.generations.
--
--   Probe result (QA account 29944d39-4a29-4f6c-a1cf-9685b2b422bd):
--     posts       -> 188 of 188 rows visible; 78 foreign; 73 of those foreign
--                    rows have organization_id IS NULL (i.e. other users'
--                    PERSONAL posts, not org-shared ones)
--     generations -> 100-row page returned 25 foreign rows
--
-- Both innocent explanations were ruled out:
--   * NOT org visibility  — 73 leaked posts have no organization_id, and
--                           org_current_user_has_brand_access(NULL, NULL) is
--                           FALSE by construction (om.organization_id = NULL
--                           yields NULL, so EXISTS is false).
--   * NOT admin access    — the probe account has no admin_roles row and
--                           is_super_admin_user() returns null for it.
--
-- Therefore at least one additional PERMISSIVE policy exists on these tables
-- that the migration history does not describe. RLS policies are OR-ed, so a
-- single over-broad policy defeats every correct one beside it.
--
-- Note: 20260710090000_baseline_core_tables.sql:118-119 already carried the
-- comment "confirm live whether #2 still exists and should be explicitly
-- dropped" for generations. That confirmation was never performed. This
-- migration performs it, for both tables, and makes the result enforceable.
--
-- ── Strategy ─────────────────────────────────────────────────────────────────
-- Because the offending policy cannot be enumerated from the repository (it is
-- live-only, and PostgREST does not expose pg_policies), this migration does
-- NOT attempt to drop it by name. Instead it asserts the intended end state:
--
--   1. Drop EVERY policy on posts/generations whose name is not on a
--      known-good allowlist. Self-healing regardless of what is actually there.
--   2. Recreate the known-good policies exactly as documented in
--      20260710090000_baseline_core_tables.sql.
--   3. Ensure RLS is enabled and FORCEd on both tables.
--   4. Log what was dropped, so the unknown policy is finally identified.
--
-- This migration is idempotent and safe to re-run.
--
-- ⚠️  Verify with scripts/security/cross-tenant-probe.mjs BEFORE and AFTER.

BEGIN;

-- ── 1. Drop any policy not on the allowlist ──────────────────────────────────

DO $$
DECLARE
  pol record;
  dropped_count int := 0;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('posts', 'generations')
      AND policyname NOT IN (
        -- posts (per baseline_core_tables.sql:253-278)
        'Users or scoped admins manage own posts',
        'org_workspace_member_read_posts',
        'org_workspace_member_schedule_posts',
        -- generations (per baseline_core_tables.sql:122-137)
        'workspace_scoped_generations_access'
      )
  LOOP
    RAISE WARNING
      'L1.1: dropping unexpected policy %.% -> % (this is the suspected cross-tenant leak)',
      pol.schemaname, pol.tablename, pol.policyname;
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      pol.policyname, pol.schemaname, pol.tablename
    );
    dropped_count := dropped_count + 1;
  END LOOP;

  RAISE NOTICE 'L1.1: dropped % unexpected policy/policies on posts+generations', dropped_count;
END;
$$;

-- ── 2. Recreate the known-good policies (idempotent) ─────────────────────────

-- posts: base ownership. Owner, or an admin scoped to that user.
DROP POLICY IF EXISTS "Users or scoped admins manage own posts" ON public.posts;
CREATE POLICY "Users or scoped admins manage own posts"
  ON public.posts FOR ALL
  USING (auth.uid() = user_id OR public.can_admin_access_user(auth.uid(), user_id))
  WITH CHECK (auth.uid() = user_id OR public.can_admin_access_user(auth.uid(), user_id));

-- posts: org members may READ org-scoped posts.
-- Hardened vs. baseline: an explicit organization_id IS NOT NULL guard is added
-- so this policy can never apply to a personal post. The UPDATE policy below
-- already had that guard; the SELECT policy did not. The guard is redundant
-- given org_current_user_has_brand_access(NULL, ...) is false, but defence in
-- depth is warranted on the exact table where a leak was proven.
DROP POLICY IF EXISTS org_workspace_member_read_posts ON public.posts;
CREATE POLICY org_workspace_member_read_posts
  ON public.posts FOR SELECT
  USING (
    organization_id IS NOT NULL
    AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
  );

-- posts: org members with can_schedule may UPDATE org-scoped posts.
DROP POLICY IF EXISTS org_workspace_member_schedule_posts ON public.posts;
CREATE POLICY org_workspace_member_schedule_posts
  ON public.posts FOR UPDATE
  USING (
    organization_id IS NOT NULL
    AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_schedule')
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_schedule')
  );

-- generations: owner-scoped, with org brand access where org-scoped.
DROP POLICY IF EXISTS workspace_scoped_generations_access ON public.generations;
CREATE POLICY workspace_scoped_generations_access
  ON public.generations FOR ALL
  USING (
    (
      auth.uid() = user_id
      AND (organization_id IS NULL OR public.org_current_user_has_brand_access(organization_id, brand_project_id))
    )
    OR public.is_admin_user(auth.uid())
  )
  WITH CHECK (
    (
      auth.uid() = user_id
      AND (organization_id IS NULL OR public.org_current_user_has_brand_access(organization_id, brand_project_id))
    )
    OR public.is_admin_user(auth.uid())
  );

-- ── 3. Enable + FORCE row level security ─────────────────────────────────────
-- FORCE also applies RLS to the table owner, so a mistakenly owner-connected
-- service path cannot silently bypass it. (The service_role key still bypasses
-- RLS by design — that is expected and is why the probe uses an anon-key JWT.)

ALTER TABLE public.posts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts        FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.generations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations  FORCE  ROW LEVEL SECURITY;

-- ── 4. Post-condition: fail loudly if the policy set is not exactly as intended

DO $$
DECLARE
  posts_count int;
  gens_count  int;
BEGIN
  SELECT count(*) INTO posts_count FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'posts';
  SELECT count(*) INTO gens_count  FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'generations';

  IF posts_count <> 3 THEN
    RAISE EXCEPTION 'L1.1 post-condition failed: expected 3 policies on public.posts, found %', posts_count;
  END IF;
  IF gens_count <> 1 THEN
    RAISE EXCEPTION 'L1.1 post-condition failed: expected 1 policy on public.generations, found %', gens_count;
  END IF;

  RAISE NOTICE 'L1.1: policy sets verified — posts=%, generations=%', posts_count, gens_count;
END;
$$;

COMMIT;
