CREATE TABLE IF NOT EXISTS public.org_member_dashboard_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dismissed_action_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  team_pulse_collapsed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_member_dashboard_state_org_user_unique UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_member_dashboard_state_org
  ON public.org_member_dashboard_state(organization_id);

CREATE INDEX IF NOT EXISTS idx_org_member_dashboard_state_user
  ON public.org_member_dashboard_state(user_id);

CREATE OR REPLACE FUNCTION public.prepare_org_member_dashboard_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.dismissed_action_keys IS NULL OR jsonb_typeof(NEW.dismissed_action_keys) <> 'array' THEN
    NEW.dismissed_action_keys := '[]'::jsonb;
  END IF;

  IF NEW.team_pulse_collapsed IS NULL THEN
    NEW.team_pulse_collapsed := false;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_org_member_dashboard_state_updated_at'
  ) THEN
    CREATE TRIGGER set_org_member_dashboard_state_updated_at
      BEFORE UPDATE ON public.org_member_dashboard_state
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'prepare_org_member_dashboard_state'
  ) THEN
    CREATE TRIGGER prepare_org_member_dashboard_state
      BEFORE INSERT OR UPDATE ON public.org_member_dashboard_state
      FOR EACH ROW
      EXECUTE FUNCTION public.prepare_org_member_dashboard_state();
  END IF;
END
$$;

ALTER TABLE public.org_member_dashboard_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_workspace_member_read_dashboard_state ON public.org_member_dashboard_state;
CREATE POLICY org_workspace_member_read_dashboard_state
  ON public.org_member_dashboard_state
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND public.org_current_user_is_active_member(organization_id)
  );

DROP POLICY IF EXISTS org_workspace_member_insert_dashboard_state ON public.org_member_dashboard_state;
CREATE POLICY org_workspace_member_insert_dashboard_state
  ON public.org_member_dashboard_state
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND public.org_current_user_is_active_member(organization_id)
  );

DROP POLICY IF EXISTS org_workspace_member_update_dashboard_state ON public.org_member_dashboard_state;
CREATE POLICY org_workspace_member_update_dashboard_state
  ON public.org_member_dashboard_state
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND public.org_current_user_is_active_member(organization_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND public.org_current_user_is_active_member(organization_id)
  );

DROP POLICY IF EXISTS org_workspace_member_delete_dashboard_state ON public.org_member_dashboard_state;
CREATE POLICY org_workspace_member_delete_dashboard_state
  ON public.org_member_dashboard_state
  FOR DELETE
  USING (
    user_id = auth.uid()
    AND public.org_current_user_is_active_member(organization_id)
  );
