CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.platform_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  icon_url text,
  brand_color text NOT NULL,
  supported_profile_types text[] NOT NULL DEFAULT '{}'::text[],
  supported_content_types text[] NOT NULL DEFAULT '{}'::text[],
  character_limit integer,
  supports_scheduling boolean NOT NULL DEFAULT true,
  supports_stories boolean NOT NULL DEFAULT false,
  supports_reels boolean NOT NULL DEFAULT false,
  supports_carousels boolean NOT NULL DEFAULT false,
  mock_login_headline text,
  mock_login_description text,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.connected_accounts
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS brand_project_id uuid REFERENCES public.brand_projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS profile_type text DEFAULT 'Business',
  ADD COLUMN IF NOT EXISTS follower_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS account_category text,
  ADD COLUMN IF NOT EXISTS is_mock boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mock_token text,
  ADD COLUMN IF NOT EXISTS last_token_refresh_at timestamptz,
  ADD COLUMN IF NOT EXISTS health_score integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS consecutive_failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failure_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_failure_reason text,
  ADD COLUMN IF NOT EXISTS last_successful_publish_at timestamptz,
  ADD COLUMN IF NOT EXISTS total_posts_published integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_posts_scheduled integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS granted_member_ids uuid[] DEFAULT '{}'::uuid[];

UPDATE public.connected_accounts
SET
  scope = coalesce(nullif(scope, ''), 'personal'),
  display_name = coalesce(nullif(display_name, ''), nullif(account_name, ''), nullif(username, '')),
  account_name = coalesce(nullif(account_name, ''), nullif(display_name, ''), nullif(username, '')),
  profile_picture_url = coalesce(nullif(profile_picture_url, ''), nullif(avatar_url, '')),
  avatar_url = coalesce(nullif(avatar_url, ''), nullif(profile_picture_url, '')),
  profile_type = coalesce(nullif(profile_type, ''), 'Business'),
  follower_count = coalesce(follower_count, 0),
  health_score = coalesce(health_score, 100),
  consecutive_failure_count = coalesce(consecutive_failure_count, 0),
  total_posts_published = coalesce(total_posts_published, 0),
  total_posts_scheduled = coalesce(total_posts_scheduled, 0),
  granted_member_ids = coalesce(granted_member_ids, '{}'::uuid[]),
  is_mock = coalesce(is_mock, false)
WHERE true;

UPDATE public.connected_accounts
SET is_mock = true
WHERE is_mock = false
  AND (
    lower(coalesce(connection_status, '')) = 'mock'
    OR mock_token IS NOT NULL
    OR access_token ILIKE 'mock_token_%'
    OR coalesce((platform_metadata ->> 'mock')::boolean, false)
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'connected_accounts_scope_check'
      AND conrelid = 'public.connected_accounts'::regclass
  ) THEN
    ALTER TABLE public.connected_accounts
      ADD CONSTRAINT connected_accounts_scope_check
      CHECK (scope IN ('personal', 'organization'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_connected_accounts_scope
  ON public.connected_accounts(scope, user_id);

CREATE INDEX IF NOT EXISTS idx_connected_accounts_org
  ON public.connected_accounts(organization_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_connected_accounts_status
  ON public.connected_accounts(connection_status);

CREATE INDEX IF NOT EXISTS idx_connected_accounts_health
  ON public.connected_accounts(consecutive_failure_count)
  WHERE consecutive_failure_count > 0;

CREATE TABLE IF NOT EXISTS public.connection_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  platform text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_simulated_failure boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connection_events_account
  ON public.connection_events(connected_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connection_events_org
  ON public.connection_events(organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_connection_events_severity
  ON public.connection_events(severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connection_events_failures
  ON public.connection_events(connected_account_id, event_type, created_at DESC)
  WHERE event_type = 'publish_failure';

CREATE TABLE IF NOT EXISTS public.mock_publish_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  mock_post_id text,
  mock_post_url text,
  simulated_failure_reason text,
  failure_is_retriable boolean DEFAULT false,
  caption_snapshot text,
  media_url_snapshot text,
  platform_snapshot text,
  published_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mock_publish_account
  ON public.mock_publish_logs(connected_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mock_publish_post
  ON public.mock_publish_logs(post_id);

CREATE INDEX IF NOT EXISTS idx_mock_publish_status
  ON public.mock_publish_logs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.account_severity_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  severity text NOT NULL DEFAULT 'warning',
  alert_type text NOT NULL,
  platform text NOT NULL,
  account_display_name text,
  failure_count integer NOT NULL DEFAULT 0,
  message text NOT NULL,
  is_resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_severity_alerts_org
  ON public.account_severity_alerts(organization_id, is_resolved, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_severity_alerts_user
  ON public.account_severity_alerts(user_id, is_resolved, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_severity_alerts_unresolved
  ON public.account_severity_alerts(is_resolved, severity, created_at DESC)
  WHERE is_resolved = false;

CREATE TABLE IF NOT EXISTS public.admin_account_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES auth.users(id),
  target_connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  target_user_id uuid REFERENCES auth.users(id),
  target_organization_id uuid REFERENCES public.organizations(id),
  action text NOT NULL,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_account
  ON public.admin_account_actions(target_connected_account_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.check_account_failure_severity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alert_exists boolean;
BEGIN
  IF NEW.consecutive_failure_count < 3 THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.account_severity_alerts
    WHERE connected_account_id = NEW.id
      AND is_resolved = false
      AND alert_type = 'repeated_failures'
  )
  INTO v_alert_exists;

  IF NOT v_alert_exists THEN
    INSERT INTO public.account_severity_alerts (
      connected_account_id,
      user_id,
      organization_id,
      severity,
      alert_type,
      platform,
      account_display_name,
      failure_count,
      message
    )
    VALUES (
      NEW.id,
      CASE WHEN NEW.scope = 'personal' THEN NEW.user_id ELSE NULL END,
      NEW.organization_id,
      CASE WHEN NEW.consecutive_failure_count >= 5 THEN 'critical' ELSE 'warning' END,
      'repeated_failures',
      NEW.platform,
      coalesce(NEW.display_name, NEW.account_name, NEW.username, NEW.platform),
      NEW.consecutive_failure_count,
      coalesce(NEW.display_name, NEW.account_name, NEW.username, NEW.platform)
        || ' (' || coalesce(NEW.platform, 'platform') || ') has failed to publish '
        || NEW.consecutive_failure_count || ' times in a row.'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS account_failure_severity_check ON public.connected_accounts;
CREATE TRIGGER account_failure_severity_check
  AFTER UPDATE OF consecutive_failure_count ON public.connected_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.check_account_failure_severity();

ALTER TABLE public.connection_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_publish_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_severity_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_account_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_registry ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connected_accounts'
      AND policyname = 'ca_org_member_read'
  ) THEN
    CREATE POLICY "ca_org_member_read"
      ON public.connected_accounts
      FOR SELECT
      USING (
        (scope = 'personal' AND user_id = auth.uid())
        OR (
          scope = 'organization'
          AND organization_id IN (
            SELECT om.organization_id
            FROM public.organization_members om
            WHERE om.user_id = auth.uid()
              AND om.status = 'active'
          )
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connected_accounts'
      AND policyname = 'ca_org_admin_write'
  ) THEN
    CREATE POLICY "ca_org_admin_write"
      ON public.connected_accounts
      FOR ALL
      USING (
        (scope = 'personal' AND user_id = auth.uid())
        OR (
          scope = 'organization'
          AND EXISTS (
            SELECT 1
            FROM public.organization_members om
            WHERE om.organization_id = connected_accounts.organization_id
              AND om.user_id = auth.uid()
              AND om.status = 'active'
              AND coalesce(om.org_role_key, om.role) IN ('org_owner', 'org_admin')
          )
        )
      )
      WITH CHECK (
        (scope = 'personal' AND user_id = auth.uid())
        OR (
          scope = 'organization'
          AND user_id = auth.uid()
          AND EXISTS (
            SELECT 1
            FROM public.organization_members om
            WHERE om.organization_id = connected_accounts.organization_id
              AND om.user_id = auth.uid()
              AND om.status = 'active'
              AND coalesce(om.org_role_key, om.role) IN ('org_owner', 'org_admin')
          )
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connection_events'
      AND policyname = 'conn_events_personal_read'
  ) THEN
    CREATE POLICY "conn_events_personal_read"
      ON public.connection_events
      FOR SELECT
      USING (
        user_id = auth.uid()
        OR (
          organization_id IN (
            SELECT om.organization_id
            FROM public.organization_members om
            WHERE om.user_id = auth.uid()
              AND om.status = 'active'
              AND coalesce(om.org_role_key, om.role) IN ('org_owner', 'org_admin')
          )
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connection_events'
      AND policyname = 'conn_events_insert'
  ) THEN
    CREATE POLICY "conn_events_insert"
      ON public.connection_events
      FOR INSERT
      WITH CHECK (user_id = auth.uid());
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mock_publish_logs'
      AND policyname = 'publish_logs_read'
  ) THEN
    CREATE POLICY "publish_logs_read"
      ON public.mock_publish_logs
      FOR SELECT
      USING (
        user_id = auth.uid()
        OR (
          organization_id IN (
            SELECT om.organization_id
            FROM public.organization_members om
            WHERE om.user_id = auth.uid()
              AND om.status = 'active'
              AND coalesce(om.org_role_key, om.role) IN ('org_owner', 'org_admin')
          )
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'account_severity_alerts'
      AND policyname = 'alerts_admin_read'
  ) THEN
    CREATE POLICY "alerts_admin_read"
      ON public.account_severity_alerts
      FOR SELECT
      USING (
        user_id = auth.uid()
        OR organization_id IN (
          SELECT om.organization_id
          FROM public.organization_members om
          WHERE om.user_id = auth.uid()
            AND om.status = 'active'
            AND coalesce(om.org_role_key, om.role) IN ('org_owner', 'org_admin')
        )
        OR EXISTS (
          SELECT 1
          FROM public.admin_roles ar
          WHERE ar.user_id = auth.uid()
            AND ar.role = 'super_admin'
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'admin_account_actions'
      AND policyname = 'admin_account_actions_super_admin_read'
  ) THEN
    CREATE POLICY "admin_account_actions_super_admin_read"
      ON public.admin_account_actions
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.admin_roles ar
          WHERE ar.user_id = auth.uid()
            AND ar.role = 'super_admin'
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'platform_registry'
      AND policyname = 'platform_registry_read'
  ) THEN
    CREATE POLICY "platform_registry_read"
      ON public.platform_registry
      FOR SELECT
      USING (true);
  END IF;
END
$$;

INSERT INTO public.platform_registry (
  platform_key,
  display_name,
  brand_color,
  supported_profile_types,
  supported_content_types,
  character_limit,
  supports_scheduling,
  supports_stories,
  supports_reels,
  supports_carousels,
  mock_login_headline,
  mock_login_description,
  is_active,
  display_order
)
VALUES
  ('instagram', 'Instagram', '#E1306C', ARRAY['Business','Creator','Personal'], ARRAY['image','video','carousel','story','reel'], 2200, true, true, true, true, 'Sign in to Instagram', 'Connect your Instagram account to SocialAI to schedule and publish content.', true, 1),
  ('tiktok', 'TikTok', '#010101', ARRAY['Business','Creator','Personal'], ARRAY['video'], 2200, true, false, false, false, 'Sign in to TikTok', 'Connect your TikTok account to SocialAI to schedule videos.', true, 2),
  ('youtube', 'YouTube', '#FF0000', ARRAY['Business','Creator'], ARRAY['video'], 5000, true, false, false, false, 'Sign in to YouTube', 'Connect your YouTube channel to SocialAI to publish videos.', true, 3),
  ('facebook', 'Facebook', '#1877F2', ARRAY['Business','Personal'], ARRAY['image','video','carousel'], 63206, true, true, false, true, 'Sign in to Facebook', 'Connect your Facebook Page to SocialAI to manage and schedule posts.', true, 4),
  ('linkedin', 'LinkedIn', '#0A66C2', ARRAY['Business','Personal'], ARRAY['image','video'], 3000, true, false, false, true, 'Sign in to LinkedIn', 'Connect your LinkedIn profile or company page to SocialAI.', true, 5),
  ('twitter', 'X (Twitter)', '#000000', ARRAY['Business','Personal'], ARRAY['image','video'], 280, true, false, false, false, 'Sign in to X', 'Connect your X account to SocialAI to schedule tweets.', true, 6),
  ('pinterest', 'Pinterest', '#E60023', ARRAY['Business','Creator','Personal'], ARRAY['image','video'], 500, true, false, false, false, 'Sign in to Pinterest', 'Connect your Pinterest account to SocialAI to schedule pins.', true, 7),
  ('threads', 'Threads', '#101010', ARRAY['Business','Creator','Personal'], ARRAY['image','video'], 500, true, false, false, false, 'Sign in to Threads', 'Connect your Threads account to SocialAI to schedule posts.', true, 8)
ON CONFLICT (platform_key) DO UPDATE
SET
  display_name = excluded.display_name,
  brand_color = excluded.brand_color,
  supported_profile_types = excluded.supported_profile_types,
  supported_content_types = excluded.supported_content_types,
  character_limit = excluded.character_limit,
  supports_scheduling = excluded.supports_scheduling,
  supports_stories = excluded.supports_stories,
  supports_reels = excluded.supports_reels,
  supports_carousels = excluded.supports_carousels,
  mock_login_headline = excluded.mock_login_headline,
  mock_login_description = excluded.mock_login_description,
  is_active = excluded.is_active,
  display_order = excluded.display_order;
