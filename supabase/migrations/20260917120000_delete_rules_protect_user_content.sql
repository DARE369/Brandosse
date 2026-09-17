-- 20260917120000_delete_rules_protect_user_content.sql
--
-- Stop the database from deleting content the user never asked to delete.
--
-- ── What actually happened ──────────────────────────────────────────────────
-- On 2026-09-16 a user disconnected their YouTube account and TWO PUBLISHED
-- POSTS disappeared — rows recording videos that are still live on YouTube.
-- Nothing in the application deletes posts on disconnect:
-- app/api/auth/social/[provider]/disconnect/route.js deletes the secret row and
-- the connected_accounts row, and nothing else.
--
-- The database did it. A live catalog read (2026-09-16) returned:
--
--   posts       <- connected_accounts   ON DELETE CASCADE
--   generations <- sessions             ON DELETE CASCADE
--   posts       <- auth.users           ON DELETE NO ACTION
--
-- All three CONTRADICT the migration history:
--
--   * 20260321113000:310-317 adds posts_account_id_fkey as ON DELETE SET NULL —
--     but guarded by `NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname =
--     'posts_account_id_fkey')`. A constraint of that NAME already existed live
--     with CASCADE, so the block skipped itself and the dangerous rule stayed.
--     The migration reported success. It had changed nothing.
--
--   * 20260710090000:72 records, in writing, that generations.session_id has NO
--     foreign key to sessions. Live has one, with CASCADE. It was created
--     outside the migration trail entirely.
--
--   * 20260710090000:169 records posts.user_id as ON DELETE CASCADE. Live is NO
--     ACTION, which does not delete a user's posts — it BLOCKS the user's own
--     account deletion, the one we publish a page promising to honour.
--
-- This is why a constraint's existence is never evidence of its behaviour, and
-- why the post-conditions below assert the live delete RULE and then delete a
-- real row to watch what happens, rather than checking that a name exists.
--
-- ── What this migration decides, and who decided it ─────────────────────────
-- Founder ruling, 2026-09-17, in response to a direct question:
--
--   1. Deleting a CHAT keeps its images and videos. People read a chat as a
--      conversation, not as the owner of their media. So generations survive
--      their session (SET NULL), and because personal_assets cascades from
--      generations BY DESIGN (20260712170000 — a CHECK constraint makes SET NULL
--      impossible there), keeping the generation is what keeps the library item.
--
--   2. Deleting an ACCOUNT deletes that user's posts. The data-deletion page
--      promises it, so posts.user_id becomes CASCADE — which also unblocks
--      account deletion, currently impossible for any user who has ever posted.
--
-- Disconnecting a social account is NOT deleting an account, and never was.
-- Posts survive it with account_id NULL: the publishing history stays, the
-- credential link goes. The videos on YouTube were never ours to delete.
--
-- Admin columns (flagged_by_admin_id, force_published_by) become SET NULL:
-- deleting an ADMIN must neither destroy nor block a USER's post.
--
-- ── Not covered here, deliberately ─────────────────────────────────────────
-- Every other NO ACTION reference to auth.users in the schema. They are real,
-- but this migration changes only rules whose live behaviour has been read.
-- public.fk_delete_rules() below exists so scripts/security/delete-rule-probe.mjs
-- can enumerate the rest against an approved manifest — this class of drift hid
-- for months precisely because nothing ever looked.
--
-- VERIFY (after applying):
--   SELECT * FROM public.fk_delete_rules()
--   WHERE child_table IN ('public.posts','public.generations') ORDER BY child_table;
--
-- SAFE TO RE-RUN: yes. Every step is idempotent and asserts its own outcome.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. A repointer that cannot skip itself
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The defect this migration repairs was a guard on constraint NAME. So this
-- helper keys on the (child, column, parent) RELATIONSHIP, drops however many
-- constraints implement it — including duplicates, which posts has — and
-- recreates exactly one with the intended rule. A pg_temp function disappears
-- with the session; nothing is left behind in the schema.

CREATE OR REPLACE FUNCTION pg_temp.repoint_fk(
  p_child        regclass,
  p_child_column text,
  p_parent       regclass,
  p_action       char,     -- 'n' = SET NULL, 'c' = CASCADE, 'a' = NO ACTION
  p_new_name     text
) RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  r              record;
  dropped        int := 0;
  orphans        bigint := 0;
  action_sql     text;
  is_nullable    boolean;
BEGIN
  action_sql := CASE p_action
                  WHEN 'n' THEN 'SET NULL'
                  WHEN 'c' THEN 'CASCADE'
                  WHEN 'a' THEN 'NO ACTION'
                  ELSE NULL
                END;
  IF action_sql IS NULL THEN
    RAISE EXCEPTION 'repoint_fk: unsupported action %', p_action;
  END IF;

  -- SET NULL on a NOT NULL column is a rule that can only ever fail at runtime.
  SELECT NOT attnotnull INTO is_nullable
  FROM pg_attribute
  WHERE attrelid = p_child AND attname = p_child_column AND attnum > 0;

  IF is_nullable IS NULL THEN
    RAISE EXCEPTION 'repoint_fk: %.% does not exist', p_child, p_child_column;
  END IF;
  IF p_action = 'n' AND NOT is_nullable THEN
    RAISE EXCEPTION 'repoint_fk: %.% is NOT NULL — ON DELETE SET NULL would fail on every parent delete',
      p_child, p_child_column;
  END IF;

  -- Drop every single-column FK implementing this relationship, whatever it is
  -- called. Duplicates are the norm here, not the exception.
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.conrelid = p_child
      AND c.confrelid = p_parent
      AND array_length(c.conkey, 1) = 1
      AND a.attname = p_child_column
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', p_child::text, r.conname);
    dropped := dropped + 1;
  END LOOP;

  -- Clear references to parents that no longer exist. Without this, VALIDATE
  -- fails and the whole migration rolls back over rows that are ALREADY broken.
  -- A dangling id points at nothing; nulling it loses no information.
  EXECUTE format(
    'UPDATE %s c SET %I = NULL
      WHERE c.%I IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM %s p WHERE p.id = c.%I)',
    p_child::text, p_child_column, p_child_column, p_parent::text, p_child_column
  );
  GET DIAGNOSTICS orphans = ROW_COUNT;

  EXECUTE format(
    'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s(id) ON DELETE %s NOT VALID',
    p_child::text, p_new_name, p_child_column, p_parent::text, action_sql
  );

  -- NOT VALID then VALIDATE takes a weaker lock than a plain ADD CONSTRAINT and
  -- lets the table keep serving traffic while the check runs. Leaving it NOT
  -- VALID would be the same half-applied state this migration exists to repair,
  -- so it is validated immediately and asserted below.
  EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', p_child::text, p_new_name);

  RETURN format('%s.%s -> %s: %s (dropped %s, cleared %s orphan(s))',
                p_child::text, p_child_column, p_parent::text, action_sql, dropped, orphans);
END;
$fn$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The rule that deleted two published posts
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE '%', pg_temp.repoint_fk(
    'public.posts'::regclass, 'account_id',
    'public.connected_accounts'::regclass, 'n', 'posts_account_id_fkey');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The rule that deletes a user's media when they delete a chat
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Reaches far further than it looks: generations cascades to personal_assets,
-- generation_assets, generation_metadata, content_versions,
-- content_quality_reviews and scheduled_generations. Posts survive (SET NULL)
-- but lose the media they were going to publish, so a scheduled post silently
-- becomes one that fails at publish time with "no media attached".

DO $$
BEGIN
  RAISE NOTICE '%', pg_temp.repoint_fk(
    'public.generations'::regclass, 'session_id',
    'public.sessions'::regclass, 'n', 'generations_session_id_fkey');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Make account deletion possible, and make it delete the right things
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- The user's own posts go with the user. Founder ruling 2026-09-17.
  RAISE NOTICE '%', pg_temp.repoint_fk(
    'public.posts'::regclass, 'user_id',
    'auth.users'::regclass, 'c', 'posts_user_id_fkey');

  -- An admin leaving must not take a user's post with them, or pin it in place.
  RAISE NOTICE '%', pg_temp.repoint_fk(
    'public.posts'::regclass, 'flagged_by_admin_id',
    'auth.users'::regclass, 'n', 'posts_flagged_by_admin_id_fkey');

  RAISE NOTICE '%', pg_temp.repoint_fk(
    'public.posts'::regclass, 'force_published_by',
    'auth.users'::regclass, 'n', 'posts_force_published_by_fkey');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Make the live rules readable, so drift can be detected from outside
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Reading migrations tells you what was INTENDED. Every defect above was a gap
-- between intent and the live catalog, and nothing in the repo could see the
-- catalog. scripts/security/delete-rule-probe.mjs calls this over PostgREST and
-- diffs it against an approved manifest.
--
-- SECURITY DEFINER because pg_constraint is not readable by the API roles, and
-- must stay that way: this returns schema shape, which is reconnaissance for an
-- attacker. Service role only.

CREATE OR REPLACE FUNCTION public.fk_delete_rules()
RETURNS TABLE (
  child_table     text,
  child_column    text,
  parent_table    text,
  constraint_name text,
  delete_rule     text,
  is_validated    boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    (cn.nspname || '.' || cl.relname)::text,
    a.attname::text,
    (pn.nspname || '.' || pl.relname)::text,
    c.conname::text,
    CASE c.confdeltype
      WHEN 'a' THEN 'NO ACTION'
      WHEN 'r' THEN 'RESTRICT'
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
      ELSE c.confdeltype::text
    END,
    c.convalidated
  FROM pg_constraint c
  JOIN pg_class cl      ON cl.oid = c.conrelid
  JOIN pg_namespace cn  ON cn.oid = cl.relnamespace
  JOIN pg_class pl      ON pl.oid = c.confrelid
  JOIN pg_namespace pn  ON pn.oid = pl.relnamespace
  JOIN pg_attribute a   ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  WHERE c.contype = 'f'
    AND cn.nspname IN ('public', 'auth')
  ORDER BY 1, 2, 3;
$$;

REVOKE ALL ON FUNCTION public.fk_delete_rules() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fk_delete_rules() TO service_role;

COMMENT ON FUNCTION public.fk_delete_rules() IS
  'Live ON DELETE rules for every foreign key in public/auth. Exists because '
  'migrations record intent while only the catalog records behaviour, and the '
  'gap between them silently deleted published posts in September 2026. '
  'Service role only — schema shape is reconnaissance.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Post-conditions, part one: the catalog says what we asked for
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  expected CONSTANT text[][] := ARRAY[
    ['public.posts',       'account_id',          'public.connected_accounts', 'SET NULL'],
    ['public.generations', 'session_id',          'public.sessions',           'SET NULL'],
    ['public.posts',       'user_id',             'auth.users',                'CASCADE'],
    ['public.posts',       'flagged_by_admin_id', 'auth.users',                'SET NULL'],
    ['public.posts',       'force_published_by',  'auth.users',                'SET NULL']
  ];
  i   int;
  got record;
  n   int;
BEGIN
  FOR i IN 1 .. array_length(expected, 1) LOOP
    SELECT count(*) INTO n
    FROM public.fk_delete_rules() f
    WHERE f.child_table  = expected[i][1]
      AND f.child_column = expected[i][2]
      AND f.parent_table = expected[i][3];

    IF n = 0 THEN
      RAISE EXCEPTION 'post-condition failed: no foreign key on %.% -> %',
        expected[i][1], expected[i][2], expected[i][3];
    END IF;
    IF n > 1 THEN
      -- Duplicates are how contradictory rules coexist: one SET NULL, one
      -- CASCADE, and the destructive one wins.
      RAISE EXCEPTION 'post-condition failed: % duplicate foreign keys on %.% -> %',
        n, expected[i][1], expected[i][2], expected[i][3];
    END IF;

    SELECT * INTO got
    FROM public.fk_delete_rules() f
    WHERE f.child_table  = expected[i][1]
      AND f.child_column = expected[i][2]
      AND f.parent_table = expected[i][3];

    IF got.delete_rule <> expected[i][4] THEN
      RAISE EXCEPTION 'post-condition failed: %.% -> % is %, expected %',
        expected[i][1], expected[i][2], expected[i][3], got.delete_rule, expected[i][4];
    END IF;
    IF NOT got.is_validated THEN
      RAISE EXCEPTION 'post-condition failed: %.% -> % is NOT VALID — the rule applies to new rows only',
        expected[i][1], expected[i][2], expected[i][3];
    END IF;
  END LOOP;

  RAISE NOTICE 'catalog post-conditions passed: 5 delete rules verified';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Post-conditions, part two: delete something and watch
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Part one proves the catalog AGREES with us. It is exactly the kind of check
-- that passed for five months while the live rule did the opposite, because a
-- constraint's name, and even its declared rule, is still a claim until a
-- delete is observed.
--
-- So: create a throwaway account and post, delete the account, and look at what
-- is left. The inner BEGIN/EXCEPTION block is a subtransaction, and the final
-- RAISE unwinds it — every synthetic row is gone whether the probe passes or
-- fails, and a genuine failure is re-raised and aborts the migration.

DO $$
DECLARE
  probe_user  uuid;
  acct_id     uuid;
  post_id     uuid;
  sess_id     uuid;
  gen_id      uuid;
  survived    boolean;
  cleared     boolean;
BEGIN
  SELECT id INTO probe_user FROM auth.users ORDER BY created_at LIMIT 1;

  IF probe_user IS NULL THEN
    RAISE EXCEPTION
      'behavioural post-condition cannot run: auth.users is empty. On a database '
      'with no users the catalog check above is the only evidence, which is '
      'precisely the evidence that failed us. Re-apply against a real database.';
  END IF;

  BEGIN
    -- ── Probe 1: disconnecting an account must not delete its posts ────────
    INSERT INTO public.connected_accounts (user_id, platform, account_name)
    VALUES (probe_user, 'youtube', '__delete_rule_probe__')
    RETURNING id INTO acct_id;

    INSERT INTO public.posts (user_id, account_id, platform, caption, status)
    VALUES (probe_user, acct_id, 'youtube', '__delete_rule_probe__', 'draft')
    RETURNING id INTO post_id;

    DELETE FROM public.connected_accounts WHERE id = acct_id;

    SELECT EXISTS (SELECT 1 FROM public.posts WHERE id = post_id) INTO survived;
    IF NOT survived THEN
      RAISE EXCEPTION
        'BEHAVIOURAL post-condition failed: deleting a connected account still '
        'deletes its posts. This is the September 2026 defect, unrepaired — the '
        'catalog says SET NULL and the database did something else.';
    END IF;

    SELECT account_id IS NULL INTO cleared FROM public.posts WHERE id = post_id;
    IF NOT cleared THEN
      RAISE EXCEPTION
        'BEHAVIOURAL post-condition failed: the post survived but account_id was '
        'not cleared — it now points at an account that does not exist';
    END IF;

    -- ── Probe 2: deleting a chat must not delete its media ─────────────────
    INSERT INTO public.sessions (user_id, title)
    VALUES (probe_user, '__delete_rule_probe__')
    RETURNING id INTO sess_id;

    INSERT INTO public.generations (user_id, session_id, prompt, status)
    VALUES (probe_user, sess_id, '__delete_rule_probe__', 'completed')
    RETURNING id INTO gen_id;

    DELETE FROM public.sessions WHERE id = sess_id;

    SELECT EXISTS (SELECT 1 FROM public.generations WHERE id = gen_id) INTO survived;
    IF NOT survived THEN
      RAISE EXCEPTION
        'BEHAVIOURAL post-condition failed: deleting a chat session still deletes '
        'its generations — and with them the user''s images, videos and library '
        'items, which cascade from generations';
    END IF;

    SELECT session_id IS NULL INTO cleared FROM public.generations WHERE id = gen_id;
    IF NOT cleared THEN
      RAISE EXCEPTION
        'BEHAVIOURAL post-condition failed: the generation survived but session_id '
        'still points at a deleted session';
    END IF;

    -- Both probes passed. Unwind everything they created.
    RAISE EXCEPTION 'delete_rule_probe_rollback';

  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'delete_rule_probe_rollback' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'behavioural post-conditions passed: a disconnect keeps its posts, a deleted chat keeps its media';
  END;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. What is still wrong, recorded rather than assumed
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  blocking int;
BEGIN
  SELECT count(*) INTO blocking
  FROM public.fk_delete_rules() f
  WHERE f.parent_table = 'auth.users'
    AND f.delete_rule IN ('NO ACTION', 'RESTRICT');

  IF blocking > 0 THEN
    RAISE NOTICE
      '% remaining foreign key(s) to auth.users still use NO ACTION/RESTRICT. Each '
      'one can block a user account deletion. Enumerate with: SELECT * FROM '
      'public.fk_delete_rules() WHERE parent_table = ''auth.users'' AND delete_rule '
      'IN (''NO ACTION'',''RESTRICT'');', blocking;
  END IF;
END $$;

COMMIT;
