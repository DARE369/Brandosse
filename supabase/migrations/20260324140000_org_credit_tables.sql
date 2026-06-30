CREATE TABLE IF NOT EXISTS public.credit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  brand_project_id uuid REFERENCES public.brand_projects(id) ON DELETE SET NULL,
  channel_id uuid REFERENCES public.common_room_channels(id) ON DELETE SET NULL,
  member_id uuid NOT NULL REFERENCES auth.users(id),
  event_type text NOT NULL,
  credits_consumed integer NOT NULL,
  model_used text,
  reference_id uuid,
  reference_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_events_org
  ON public.credit_events(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_events_member
  ON public.credit_events(member_id, organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_events_period
  ON public.credit_events(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.credit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  amount_requested integer NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'partial')),
  amount_approved integer,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_requests_org
  ON public.credit_requests(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_credit_requests_member
  ON public.credit_requests(requested_by, status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_credit_requests_updated_at'
  ) THEN
    CREATE TRIGGER set_credit_requests_updated_at
      BEFORE UPDATE ON public.credit_requests
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;
