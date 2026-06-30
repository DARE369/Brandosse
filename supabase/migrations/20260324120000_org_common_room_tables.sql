CREATE TABLE IF NOT EXISTS public.common_room_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  brand_project_id uuid REFERENCES public.brand_projects(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  channel_type text NOT NULL DEFAULT 'group'
    CHECK (channel_type IN ('group', 'project', 'private', 'ai_session')),
  is_default boolean NOT NULL DEFAULT false,
  member_ids uuid[],
  created_by uuid REFERENCES auth.users(id),
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channels_org
  ON public.common_room_channels(organization_id, is_archived);

CREATE INDEX IF NOT EXISTS idx_channels_project
  ON public.common_room_channels(brand_project_id);

CREATE TABLE IF NOT EXISTS public.common_room_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.common_room_channels(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_type text NOT NULL DEFAULT 'user'
    CHECK (sender_type IN ('user', 'ai')),
  content text NOT NULL,
  content_type text NOT NULL DEFAULT 'text'
    CHECK (content_type IN ('text', 'file', 'asset_reference', 'pipeline_reference', 'ai_response')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  reply_to_id uuid REFERENCES public.common_room_messages(id) ON DELETE SET NULL,
  reactions jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_deleted boolean NOT NULL DEFAULT false,
  edited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_channel
  ON public.common_room_messages(channel_id, created_at DESC)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_messages_org
  ON public.common_room_messages(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_session_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key text NOT NULL UNIQUE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  brand_project_id uuid REFERENCES public.brand_projects(id) ON DELETE SET NULL,
  channel_id uuid REFERENCES public.common_room_channels(id) ON DELETE SET NULL,
  initiated_by uuid NOT NULL REFERENCES auth.users(id),
  session_type text NOT NULL DEFAULT 'private'
    CHECK (session_type IN ('group', 'private', 'generation_assist', 'brief_generation')),
  model_used text NOT NULL DEFAULT 'grok',
  credits_consumed integer NOT NULL DEFAULT 0,
  message_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_logs_org
  ON public.ai_session_logs(organization_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_logs_member
  ON public.ai_session_logs(initiated_by, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_logs_channel
  ON public.ai_session_logs(channel_id, started_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_common_room_channels_updated_at'
  ) THEN
    CREATE TRIGGER set_common_room_channels_updated_at
      BEFORE UPDATE ON public.common_room_channels
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;
