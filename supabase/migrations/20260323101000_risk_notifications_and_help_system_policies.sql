-- ============================================================================
-- Migration: risk_notifications_and_help_system_policies
-- Date: 2026-03-23
-- Purpose:
--   1) Remove superseded broad/scoped policy overlap for notifications and notes
--   2) Add scoped RLS for complaint history, risk counts, and v2 admin notifications
-- ============================================================================

ALTER TABLE public.risk_event_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_status_history ENABLE ROW LEVEL SECURITY;

-- -- risk_event_counts --------------------------------------------------------
DROP POLICY IF EXISTS "risk_counts_admin_read" ON public.risk_event_counts;
DROP POLICY IF EXISTS "risk_counts_service_write" ON public.risk_event_counts;
DROP POLICY IF EXISTS "Super admins read risk counts" ON public.risk_event_counts;
DROP POLICY IF EXISTS "Scoped admins read risk counts" ON public.risk_event_counts;

CREATE POLICY "Scoped admins read risk counts"
  ON public.risk_event_counts FOR SELECT
  USING (
    public.is_super_admin_user(auth.uid())
    OR (
      organization_id IS NOT NULL
      AND public.can_admin_access_organization(auth.uid(), organization_id)
    )
  );

-- -- complaint_status_history -------------------------------------------------
DROP POLICY IF EXISTS "complaint_history_admin_all" ON public.complaint_status_history;
DROP POLICY IF EXISTS "complaint_history_user_read" ON public.complaint_status_history;
DROP POLICY IF EXISTS "Complaint history admins read scoped" ON public.complaint_status_history;
DROP POLICY IF EXISTS "Complaint history admins write scoped" ON public.complaint_status_history;
DROP POLICY IF EXISTS "Complaint history users read own" ON public.complaint_status_history;

CREATE POLICY "Complaint history admins read scoped"
  ON public.complaint_status_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.complaints c
      WHERE c.id = complaint_id
        AND (
          public.can_admin_access_organization(auth.uid(), c.organization_id)
          OR public.can_admin_access_user(auth.uid(), c.submitted_by_user_id)
        )
    )
  );

CREATE POLICY "Complaint history admins write scoped"
  ON public.complaint_status_history FOR INSERT
  WITH CHECK (
    public.is_admin_user(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.complaints c
      WHERE c.id = complaint_id
        AND (
          public.can_admin_access_organization(auth.uid(), c.organization_id)
          OR public.can_admin_access_user(auth.uid(), c.submitted_by_user_id)
        )
    )
  );

CREATE POLICY "Complaint history users read own"
  ON public.complaint_status_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.complaints c
      WHERE c.id = complaint_id
        AND c.submitted_by_user_id = auth.uid()
    )
  );

-- -- complaints ---------------------------------------------------------------
DROP POLICY IF EXISTS "complaints_user_insert" ON public.complaints;
DROP POLICY IF EXISTS "complaints_user_read" ON public.complaints;
DROP POLICY IF EXISTS "complaints_user_update_notifications" ON public.complaints;

-- Keep the scoped admin policies from admin_foundation; add clean user aliases
CREATE POLICY "complaints_user_insert"
  ON public.complaints FOR INSERT
  WITH CHECK (submitted_by_user_id = auth.uid());

CREATE POLICY "complaints_user_read"
  ON public.complaints FOR SELECT
  USING (submitted_by_user_id = auth.uid());

-- -- user_notifications cleanup ----------------------------------------------
DROP POLICY IF EXISTS "user_notifications_user_select" ON public.user_notifications;
DROP POLICY IF EXISTS "user_notifications_user_update" ON public.user_notifications;
DROP POLICY IF EXISTS "user_notifications_admin_insert" ON public.user_notifications;
DROP POLICY IF EXISTS "user_notifications_admin_select" ON public.user_notifications;
DROP POLICY IF EXISTS "Users read own notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "Users update own notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "Scoped admins create notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "Scoped admins read notifications" ON public.user_notifications;

CREATE POLICY "Users read own notifications"
  ON public.user_notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users update own notifications"
  ON public.user_notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Scoped admins create notifications"
  ON public.user_notifications FOR INSERT
  WITH CHECK (
    public.is_admin_user(auth.uid())
    AND public.can_admin_access_user(auth.uid(), user_id)
    AND (sent_by_admin_id = auth.uid() OR sent_by_admin_id IS NULL)
  );

CREATE POLICY "Scoped admins read notifications"
  ON public.user_notifications FOR SELECT
  USING (
    public.is_admin_user(auth.uid())
    AND public.can_admin_access_user(auth.uid(), user_id)
  );

-- -- admin_notes cleanup ------------------------------------------------------
DROP POLICY IF EXISTS "admin_notes_admin_select" ON public.admin_notes;
DROP POLICY IF EXISTS "admin_notes_admin_insert" ON public.admin_notes;
DROP POLICY IF EXISTS "admin_notes_admin_update" ON public.admin_notes;
DROP POLICY IF EXISTS "admin_notes_admin_delete" ON public.admin_notes;
DROP POLICY IF EXISTS "Scoped admins read notes" ON public.admin_notes;
DROP POLICY IF EXISTS "Scoped admins manage notes" ON public.admin_notes;

CREATE POLICY "Scoped admins read notes"
  ON public.admin_notes FOR SELECT
  USING (
    public.is_admin_user(auth.uid())
    AND public.can_admin_access_user(auth.uid(), target_user_id)
  );

CREATE POLICY "Scoped admins manage notes"
  ON public.admin_notes FOR ALL
  USING (
    public.is_admin_user(auth.uid())
    AND public.can_admin_access_user(auth.uid(), target_user_id)
  )
  WITH CHECK (
    public.is_admin_user(auth.uid())
    AND public.can_admin_access_user(auth.uid(), target_user_id)
    AND author_admin_id = auth.uid()
  );

-- -- admin_notifications v2 ---------------------------------------------------
DROP POLICY IF EXISTS "Recipients read own notifications" ON public.admin_notifications;
DROP POLICY IF EXISTS "Recipients update own notifications" ON public.admin_notifications;
DROP POLICY IF EXISTS "Scoped admins create notifications" ON public.admin_notifications;
DROP POLICY IF EXISTS "admin_notifications_read" ON public.admin_notifications;
DROP POLICY IF EXISTS "admin_notifications_update_own" ON public.admin_notifications;
DROP POLICY IF EXISTS "Scoped admins read broadcast notifications" ON public.admin_notifications;
DROP POLICY IF EXISTS "Scoped admins update broadcast notifications" ON public.admin_notifications;

CREATE POLICY "Scoped admins read notifications v2"
  ON public.admin_notifications FOR SELECT
  USING (
    public.is_super_admin_user(auth.uid())
    OR admin_id = auth.uid()
    OR recipient_admin_id = auth.uid()
    OR (
      admin_id IS NULL
      AND organization_id IS NOT NULL
      AND public.can_admin_access_organization(auth.uid(), organization_id)
    )
  );

CREATE POLICY "Scoped admins update notifications v2"
  ON public.admin_notifications FOR UPDATE
  USING (
    public.is_super_admin_user(auth.uid())
    OR admin_id = auth.uid()
    OR recipient_admin_id = auth.uid()
    OR (
      admin_id IS NULL
      AND organization_id IS NOT NULL
      AND public.can_admin_access_organization(auth.uid(), organization_id)
    )
  )
  WITH CHECK (
    public.is_super_admin_user(auth.uid())
    OR admin_id = auth.uid()
    OR recipient_admin_id = auth.uid()
    OR (
      admin_id IS NULL
      AND organization_id IS NOT NULL
      AND public.can_admin_access_organization(auth.uid(), organization_id)
    )
  );

CREATE POLICY "Scoped admins create notifications v2"
  ON public.admin_notifications FOR INSERT
  WITH CHECK (
    public.is_admin_user(auth.uid())
    AND (
      admin_id IS NULL
      OR admin_id = auth.uid()
      OR public.is_super_admin_user(auth.uid())
    )
  );
