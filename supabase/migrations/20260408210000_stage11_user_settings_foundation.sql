CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'UTC',
  locale text NOT NULL DEFAULT 'en-US',
  theme_preference text NOT NULL DEFAULT 'system',
  default_workspace_route text NOT NULL DEFAULT '/app/dashboard',
  notification_preferences jsonb NOT NULL DEFAULT jsonb_build_object(
    'content_updates', true,
    'approvals', true,
    'tasks', true,
    'system_alerts', true,
    'weekly_digest', false
  ),
  generation_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  calendar_defaults jsonb NOT NULL DEFAULT jsonb_build_object(
    'default_view', 'month',
    'week_starts_on', 'monday'
  ),
  privacy_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en-US',
  ADD COLUMN IF NOT EXISTS theme_preference text NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS default_workspace_route text NOT NULL DEFAULT '/app/dashboard',
  ADD COLUMN IF NOT EXISTS notification_preferences jsonb NOT NULL DEFAULT jsonb_build_object(
    'content_updates', true,
    'approvals', true,
    'tasks', true,
    'system_alerts', true,
    'weekly_digest', false
  ),
  ADD COLUMN IF NOT EXISTS generation_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS calendar_defaults jsonb NOT NULL DEFAULT jsonb_build_object(
    'default_view', 'month',
    'week_starts_on', 'monday'
  ),
  ADD COLUMN IF NOT EXISTS privacy_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.user_settings
SET
  timezone = COALESCE(NULLIF(trim(timezone), ''), 'UTC'),
  locale = COALESCE(NULLIF(trim(locale), ''), 'en-US'),
  theme_preference = CASE
    WHEN theme_preference IN ('system', 'light', 'dark') THEN theme_preference
    ELSE 'system'
  END,
  default_workspace_route = CASE
    WHEN default_workspace_route IN (
      '/app/dashboard',
      '/app/generate',
      '/app/calendar',
      '/app/library',
      '/app/help',
      '/app/settings'
    ) THEN default_workspace_route
    ELSE '/app/dashboard'
  END,
  notification_preferences = COALESCE(notification_preferences, '{}'::jsonb),
  generation_defaults = COALESCE(generation_defaults, '{}'::jsonb),
  calendar_defaults = COALESCE(calendar_defaults, '{}'::jsonb),
  privacy_preferences = COALESCE(privacy_preferences, '{}'::jsonb)
WHERE
  timezone IS NULL
  OR trim(timezone) = ''
  OR locale IS NULL
  OR trim(locale) = ''
  OR theme_preference IS NULL
  OR default_workspace_route IS NULL
  OR notification_preferences IS NULL
  OR generation_defaults IS NULL
  OR calendar_defaults IS NULL
  OR privacy_preferences IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_settings_theme_preference_check'
      AND conrelid = 'public.user_settings'::regclass
  ) THEN
    ALTER TABLE public.user_settings
      ADD CONSTRAINT user_settings_theme_preference_check
      CHECK (theme_preference IN ('system', 'light', 'dark'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_settings_default_workspace_route_check'
      AND conrelid = 'public.user_settings'::regclass
  ) THEN
    ALTER TABLE public.user_settings
      ADD CONSTRAINT user_settings_default_workspace_route_check
      CHECK (
        default_workspace_route IN (
          '/app/dashboard',
          '/app/generate',
          '/app/calendar',
          '/app/library',
          '/app/help',
          '/app/settings'
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_user_settings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_settings_updated_at ON public.user_settings;
CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_user_settings_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_settings_user_id
  ON public.user_settings(user_id);

CREATE INDEX IF NOT EXISTS idx_user_settings_updated_at
  ON public.user_settings(updated_at DESC);

INSERT INTO public.user_settings (user_id)
SELECT auth_user.id
FROM auth.users AS auth_user
WHERE auth_user.id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own settings" ON public.user_settings;
CREATE POLICY "Users read own settings"
  ON public.user_settings
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own settings" ON public.user_settings;
CREATE POLICY "Users insert own settings"
  ON public.user_settings
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own settings" ON public.user_settings;
CREATE POLICY "Users update own settings"
  ON public.user_settings
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
