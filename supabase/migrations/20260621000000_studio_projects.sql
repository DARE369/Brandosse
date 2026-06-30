-- Studio Projects: personal user project grouping above sessions
-- Lets users organise sessions into named campaigns (e.g. "Summer Drop")

CREATE TABLE IF NOT EXISTS public.studio_projects (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  color       text        NOT NULL DEFAULT '#7C5CFC',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS studio_projects_user_id_idx
  ON public.studio_projects (user_id);

-- Attach sessions to a project (nullable — existing sessions remain unassigned)
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS project_id uuid
  REFERENCES public.studio_projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sessions_project_id_idx
  ON public.sessions (project_id);

-- Row-level security
ALTER TABLE public.studio_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_studio_projects"
  ON public.studio_projects
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.touch_studio_projects_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS studio_projects_updated_at ON public.studio_projects;
CREATE TRIGGER studio_projects_updated_at
  BEFORE UPDATE ON public.studio_projects
  FOR EACH ROW EXECUTE FUNCTION public.touch_studio_projects_updated_at();
