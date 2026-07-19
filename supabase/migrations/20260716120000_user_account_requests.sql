-- =============================================================================
-- Migration: user_account_requests table
-- Records self-service "delete my account" and "export my data" requests from
-- Settings > Data & privacy. These are request-only (no automated pipeline
-- yet) — an admin/founder actions them manually until a real deletion/export
-- pipeline exists. Do not confuse with admin_account_actions (org-scoped
-- connected-account moderation).
--
-- RUN IN: Supabase SQL Editor
-- SAFE TO RE-RUN: Yes — uses IF NOT EXISTS throughout
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_account_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_type TEXT        NOT NULL CHECK (request_type IN ('deletion', 'export')),
  status       TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_account_requests_user_id
  ON public.user_account_requests (user_id, created_at DESC);

ALTER TABLE public.user_account_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_account_requests_user_select" ON public.user_account_requests;
CREATE POLICY "user_account_requests_user_select"
  ON public.user_account_requests
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_account_requests_user_insert" ON public.user_account_requests;
CREATE POLICY "user_account_requests_user_insert"
  ON public.user_account_requests
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users may cancel their own pending request (status -> cancelled only; no
-- other column is user-writable post-insert).
DROP POLICY IF EXISTS "user_account_requests_user_update" ON public.user_account_requests;
CREATE POLICY "user_account_requests_user_update"
  ON public.user_account_requests
  FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_account_requests_admin_select" ON public.user_account_requests;
CREATE POLICY "user_account_requests_admin_select"
  ON public.user_account_requests
  FOR SELECT
  USING (public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "user_account_requests_admin_update" ON public.user_account_requests;
CREATE POLICY "user_account_requests_admin_update"
  ON public.user_account_requests
  FOR UPDATE
  USING (public.is_admin_user(auth.uid()));
