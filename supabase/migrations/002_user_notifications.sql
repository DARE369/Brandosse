-- =============================================================================
-- Migration 002: user_notifications table
-- Stores admin-sent notifications for display in the user's in-app navbar bell.
--
-- RUN IN: Supabase SQL Editor
-- SAFE TO RE-RUN: Yes — uses IF NOT EXISTS throughout
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: user_notifications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sent_by_admin_id UUID         NOT NULL REFERENCES auth.users(id),
  channel         TEXT          NOT NULL CHECK (channel IN ('in_app', 'email', 'both')),
  subject         TEXT          NOT NULL,
  body            TEXT          NOT NULL,
  is_read         BOOLEAN       NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Index: fast lookup for a user's unread notifications (used by navbar bell)
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_id
  ON public.user_notifications (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
DROP POLICY IF EXISTS "user_notifications_user_select" ON public.user_notifications;
CREATE POLICY "user_notifications_user_select"
  ON public.user_notifications
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can mark their own notifications as read (UPDATE is_read only)
DROP POLICY IF EXISTS "user_notifications_user_update" ON public.user_notifications;
CREATE POLICY "user_notifications_user_update"
  ON public.user_notifications
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admins can insert notifications
DROP POLICY IF EXISTS "user_notifications_admin_insert" ON public.user_notifications;
CREATE POLICY "user_notifications_admin_insert"
  ON public.user_notifications
  FOR INSERT
  WITH CHECK (public.is_admin_user(auth.uid()));

-- Admins can read all notifications (for audit purposes)
DROP POLICY IF EXISTS "user_notifications_admin_select" ON public.user_notifications;
CREATE POLICY "user_notifications_admin_select"
  ON public.user_notifications
  FOR SELECT
  USING (public.is_admin_user(auth.uid()));
