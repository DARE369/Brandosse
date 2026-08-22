-- 20260822090000_content_versions_owner_insert.sql
--
-- WAVE 4 / LOCK L4.4 — let a content owner record a revision of their own work.
--
-- ── The gap ──────────────────────────────────────────────────────────────────
-- public.content_versions already exists with exactly the right shape
-- (generation_id, post_id, version_number, is_active, is_original, prompt,
-- caption, hashtags, platform_target, brand_context_snapshot) and users can
-- already READ their own rows via "Users and scoped admins read content
-- versions" (20260312153000_admin_foundation.sql:819-829).
--
-- But the only write policy is "Scoped admins manage content versions"
-- (:831-845), which requires can_admin_access_user(). So an ordinary user
-- cannot record a revision of their OWN content. The table has 0 rows and zero
-- application references — it was built for admin moderation and never opened
-- to the people whose work it stores.
--
-- Consequence, from the launch audit (finding P3-003): "Regenerate" is a blind
-- overwrite. The previous caption is destroyed with no diff, no history and no
-- way back. A user who regenerates and preferred the earlier version has simply
-- lost it. That is a data-loss path, not a missing nicety, and it is the
-- table-stakes gap a Power Migrant notices first.
--
-- ── Fix ──────────────────────────────────────────────────────────────────────
-- Add an owner INSERT policy scoped through generations ownership, mirroring
-- the existing read policy exactly.
--
-- APPEND-ONLY BY DESIGN: owners get INSERT, deliberately NOT update or delete.
-- Revision history a user can silently rewrite is not history — the whole value
-- is that it records what actually happened. Admin moderation retains full
-- management rights through the existing policy.
--
-- VERIFY: as an ordinary user, insert a row referencing your own generation ->
--         succeeds; referencing someone else's -> rejected.
-- SAFE TO RE-RUN: yes

BEGIN;

DROP POLICY IF EXISTS "Owners insert own content versions" ON public.content_versions;
CREATE POLICY "Owners insert own content versions"
  ON public.content_versions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.generations g
      WHERE g.id = generation_id
        AND g.user_id = auth.uid()
    )
  );

COMMENT ON POLICY "Owners insert own content versions" ON public.content_versions IS
  'LOCK L4.4 — owners may append revisions of their own generations. INSERT only: history a user can rewrite is not history. Admin management remains via "Scoped admins manage content versions".';

-- Version lookups are always "history for this generation, newest first".
CREATE INDEX IF NOT EXISTS content_versions_generation_created_idx
  ON public.content_versions (generation_id, created_at DESC);

-- ── Post-condition ───────────────────────────────────────────────────────────

DO $$
DECLARE
  insert_policies int;
BEGIN
  SELECT count(*) INTO insert_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'content_versions'
    AND (cmd = 'INSERT' OR cmd = 'ALL');

  IF insert_policies < 2 THEN
    RAISE EXCEPTION
      'L4.4 post-condition failed: expected the owner INSERT policy alongside the admin ALL policy, found % write policy/policies',
      insert_policies;
  END IF;

  RAISE NOTICE 'L4.4: owners can now append content versions (% write policies on the table)', insert_policies;
END;
$$;

COMMIT;
