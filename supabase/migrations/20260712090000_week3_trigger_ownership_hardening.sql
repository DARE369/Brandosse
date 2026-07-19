-- ============================================================================
-- Migration: week3_trigger_ownership_hardening
-- Purpose (Week 3 Fix 1 — see audit-brief/FIXLOG.md "WEEK 3"):
--   DB triggers become the sole owner of draft-post creation. The client
--   (SessionStore.js: ensureDraftForGeneration) previously raced the same
--   INSERT against this trigger using a plain "check-then-insert" (not
--   atomic), backstopped only by the unique partial index. A genuine race
--   (two near-simultaneous completions of the same generation, e.g. a
--   retried edge-function call before Fix 2's idempotency lands, or two
--   tabs) could raise a raw 23505 up through whatever transaction fired the
--   trigger, aborting it. This migration makes the trigger itself
--   unconditionally safe under concurrency via ON CONFLICT DO NOTHING,
--   matching the pattern create_library_item_from_post already used.
--
-- Rollback: re-apply the previous CREATE OR REPLACE body from
--   20260227103000_generation_post_unification_and_rls.sql (the
--   check-then-insert version) to revert. No column/table/index changes in
--   this migration — function-body-only, so rollback is a pure
--   CREATE OR REPLACE with no data migration required either direction.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ensure_draft_post_for_generation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.posts (
    user_id,
    generation_id,
    account_id,
    caption,
    scheduled_at,
    status,
    created_at
  )
  VALUES (
    NEW.user_id,
    NEW.id,
    NULL,
    coalesce(NEW.prompt, ''),
    NULL,
    'draft',
    coalesce(NEW.created_at, now())
  )
  ON CONFLICT (
    user_id,
    generation_id,
    coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'draft' AND generation_id IS NOT NULL
  DO NOTHING;

  RETURN NEW;
END;
$$;
