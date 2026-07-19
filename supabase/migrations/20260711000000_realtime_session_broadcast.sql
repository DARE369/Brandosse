-- ============================================================================
-- Migration: realtime_session_broadcast
-- Purpose: WEEK 2 FIX 1 (+ ADDENDUM UPGRADE 1) — Generate page's realtime
--   subscription previously used raw `postgres_changes` on the entire
--   `generations` table with NO server-side filter (SessionStore.js
--   subscribeToGenerations, pre-fix). Every connected client received every
--   row change for every user/org; the only filtering was client-side
--   (`session_id === activeSession?.id`), discarding irrelevant rows AFTER
--   they'd already been delivered over the wire.
--
--   This migration switches to Supabase's authorized private-channel /
--   broadcast-from-database pattern: a trigger on `generations` broadcasts
--   each INSERT/UPDATE to a topic scoped to that row's session
--   (`session-<session_id>`), and an RLS policy on `realtime.messages`
--   ensures only the session's owner (personal workspace) or an org member
--   with brand access to that session's org/brand project (organization
--   workspace) can ever subscribe to that topic. This is authorization
--   enforced server-side at subscribe time, not a client-side filter — it
--   holds even if a future developer removes/changes the client's topic
--   logic.
--
--   Mirrors the exact ownership rule already encoded in
--   workspace_scoped_sessions_access (20260404120000_org_workflow_stabilization.sql)
--   so a client can subscribe to a session's broadcast topic if and only if
--   it could also read that session's row via the existing RLS policy.
-- ============================================================================

-- ── Trigger function: broadcast every generations INSERT/UPDATE to its
--    session's private topic. SECURITY DEFINER so it can call
--    realtime.broadcast_changes() regardless of which role performed the
--    write (the app writes as `authenticated`, edge functions write as
--    `service_role` — both must broadcast identically).
CREATE OR REPLACE FUNCTION public.broadcast_generation_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.session_id IS NOT NULL THEN
    PERFORM realtime.broadcast_changes(
      'session-' || NEW.session_id::text,  -- topic: one per session
      TG_OP,                                -- event name (INSERT/UPDATE)
      TG_OP,                                -- operation
      TG_TABLE_NAME,
      TG_TABLE_SCHEMA,
      NEW,
      OLD
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS broadcast_generation_change ON public.generations;
CREATE TRIGGER broadcast_generation_change
  AFTER INSERT OR UPDATE ON public.generations
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_generation_change();

-- ── Authorize subscription to a session's broadcast topic ───────────────────
-- realtime.messages already has RLS enabled by default in every Supabase
-- project (the extension that creates the schema enables it) — this
-- statement is included defensively in case a given project instance has it
-- disabled, and is a no-op otherwise.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS session_broadcast_subscribe_access ON realtime.messages;
CREATE POLICY session_broadcast_subscribe_access
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sessions s
      WHERE 'session-' || s.id::text = realtime.messages.topic
        AND (
          (s.workspace_type = 'personal' AND s.organization_id IS NULL AND s.user_id = auth.uid())
          OR (
            s.workspace_type = 'organization'
            AND s.organization_id IS NOT NULL
            AND public.org_current_user_has_brand_access(s.organization_id, s.brand_project_id)
          )
          OR public.is_admin_user(auth.uid())
        )
    )
  );

-- ============================================================================
-- MANUAL STEPS THAT CANNOT BE COMPLETED FROM THIS REPO — see FIXLOG.md
-- "REALTIME EXPOSURE VERDICT" for full detail:
--   1. Confirm in the Supabase Dashboard (Database → Publications) that
--      `generations` is a member of the `supabase_realtime` publication.
--      No migration in this repo adds it there, meaning it was almost
--      certainly toggled on via the Dashboard UI outside of version control.
--      Once this migration ships, that publication membership becomes
--      irrelevant to THIS feature specifically (broadcast-from-database does
--      not go through the postgres_changes replication path at all — it
--      writes directly to `realtime.messages`, which the Realtime server
--      reads independently of table publications). Leaving `generations` in
--      the publication has no bearing on this fix's security properties,
--      but if it is ever consumed by another `postgres_changes` subscriber
--      that was not covered by this audit, that subscriber remains exposed
--      to the pre-fix problem — verify no such subscriber exists.
--   2. Confirm the project's Realtime server version enforces RLS on
--      `realtime.messages` for private channels (this has been the default
--      behavior since Supabase's Realtime Authorization GA; the installed
--      supabase-js version in this repo, ^2.89.0, requires it). No
--      dashboard toggle is expected to be needed, but the owner should
--      verify once against a live subscribe attempt from a non-member
--      account (see FIXLOG journey check "second user / org non-member
--      attempting to subscribe").
-- ============================================================================
