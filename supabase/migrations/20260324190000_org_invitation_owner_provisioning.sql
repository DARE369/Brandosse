ALTER TABLE public.org_invitations
  ADD COLUMN IF NOT EXISTS invited_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requires_password_setup boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_org_invitations_invited_user
  ON public.org_invitations(invited_user_id)
  WHERE invited_user_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE policyname = 'org_workspace_super_admin_read_invitations'
      AND tablename = 'org_invitations'
  ) THEN
    CREATE POLICY org_workspace_super_admin_read_invitations
      ON public.org_invitations
      FOR SELECT
      USING (public.is_super_admin_user(auth.uid()));
  END IF;
END
$$;
