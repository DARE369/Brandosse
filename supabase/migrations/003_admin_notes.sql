-- =============================================================================
-- Migration 003: admin_notes table
-- Private admin notes attached to user profiles.
-- Never visible to the end user. Frontend (AdminNotesPanel.jsx) is already built.
--
-- RUN IN: Supabase SQL Editor
-- SAFE TO RE-RUN: Yes — uses IF NOT EXISTS throughout
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: admin_notes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_notes (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id    UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_admin_id   UUID          NOT NULL REFERENCES auth.users(id),
  body              TEXT          NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Index: fast lookup for all notes on a given user
CREATE INDEX IF NOT EXISTS idx_admin_notes_target_user
  ON public.admin_notes (target_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Auto-update updated_at on every row change
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_notes_set_updated_at ON public.admin_notes;
CREATE TRIGGER admin_notes_set_updated_at
  BEFORE UPDATE ON public.admin_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY
-- Admin-only: users NEVER see their own admin notes
-- ---------------------------------------------------------------------------

ALTER TABLE public.admin_notes ENABLE ROW LEVEL SECURITY;

-- Only admins may read notes
DROP POLICY IF EXISTS "admin_notes_admin_select" ON public.admin_notes;
CREATE POLICY "admin_notes_admin_select"
  ON public.admin_notes
  FOR SELECT
  USING (public.is_admin_user(auth.uid()));

-- Only admins may insert notes
DROP POLICY IF EXISTS "admin_notes_admin_insert" ON public.admin_notes;
CREATE POLICY "admin_notes_admin_insert"
  ON public.admin_notes
  FOR INSERT
  WITH CHECK (public.is_admin_user(auth.uid()));

-- Only the author admin may update their own notes
DROP POLICY IF EXISTS "admin_notes_admin_update" ON public.admin_notes;
CREATE POLICY "admin_notes_admin_update"
  ON public.admin_notes
  FOR UPDATE
  USING (public.is_admin_user(auth.uid()) AND author_admin_id = auth.uid())
  WITH CHECK (public.is_admin_user(auth.uid()) AND author_admin_id = auth.uid());

-- Only the author admin may delete their own notes
DROP POLICY IF EXISTS "admin_notes_admin_delete" ON public.admin_notes;
CREATE POLICY "admin_notes_admin_delete"
  ON public.admin_notes
  FOR DELETE
  USING (public.is_admin_user(auth.uid()) AND author_admin_id = auth.uid());
