ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS workspace_type text NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS brand_project_id uuid REFERENCES public.brand_projects(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sessions_workspace_type_check'
      AND conrelid = 'public.sessions'::regclass
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_workspace_type_check
      CHECK (workspace_type IN ('personal', 'organization'));
  END IF;
END $$;

UPDATE public.sessions
SET workspace_type = CASE
  WHEN organization_id IS NOT NULL THEN 'organization'
  ELSE 'personal'
END
WHERE workspace_type IS NULL
   OR workspace_type NOT IN ('personal', 'organization');

CREATE INDEX IF NOT EXISTS idx_sessions_user_workspace_updated
  ON public.sessions(user_id, workspace_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_org_workspace_updated
  ON public.sessions(organization_id, brand_project_id, updated_at DESC)
  WHERE workspace_type = 'organization';

DELETE FROM public.sessions AS session_row
WHERE NOT EXISTS (
  SELECT 1
  FROM public.generations AS generation_row
  WHERE generation_row.session_id = session_row.id
)
AND (
  COALESCE(NULLIF(trim(session_row.title), ''), '') = ''
  OR trim(session_row.title) IN ('New Session', 'Draft Session')
)
AND COALESCE(NULLIF(trim(COALESCE(session_row.metadata->>'draft_prompt', '')), ''), '') = '';

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users or admins manage own sessions" ON public.sessions;
DROP POLICY IF EXISTS workspace_scoped_sessions_access ON public.sessions;
CREATE POLICY workspace_scoped_sessions_access
  ON public.sessions FOR ALL
  USING (
    (
      auth.uid() = user_id
      AND (
        (workspace_type = 'personal' AND organization_id IS NULL)
        OR (
          workspace_type = 'organization'
          AND organization_id IS NOT NULL
          AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
        )
      )
    )
    OR public.is_admin_user(auth.uid())
  )
  WITH CHECK (
    (
      auth.uid() = user_id
      AND (
        (workspace_type = 'personal' AND organization_id IS NULL)
        OR (
          workspace_type = 'organization'
          AND organization_id IS NOT NULL
          AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
        )
      )
    )
    OR public.is_admin_user(auth.uid())
  );

DROP POLICY IF EXISTS "Users or admins manage own generations" ON public.generations;
DROP POLICY IF EXISTS workspace_scoped_generations_access ON public.generations;
CREATE POLICY workspace_scoped_generations_access
  ON public.generations FOR ALL
  USING (
    (
      auth.uid() = user_id
      AND (
        organization_id IS NULL
        OR public.org_current_user_has_brand_access(organization_id, brand_project_id)
      )
    )
    OR public.is_admin_user(auth.uid())
  )
  WITH CHECK (
    (
      auth.uid() = user_id
      AND (
        organization_id IS NULL
        OR public.org_current_user_has_brand_access(organization_id, brand_project_id)
      )
    )
    OR public.is_admin_user(auth.uid())
  );

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS seo_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS workflow_state jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.posts AS post
SET title = COALESCE(
  NULLIF(trim(post.title), ''),
  NULLIF(left(trim(COALESCE(post.caption, '')), 120), ''),
  (
    SELECT NULLIF(left(trim(COALESCE(generation.prompt, '')), 120), '')
    FROM public.generations AS generation
    WHERE generation.id = post.generation_id
  ),
  'Untitled draft'
)
WHERE post.title IS NULL
   OR trim(post.title) = '';

UPDATE public.posts
SET seo_state = COALESCE(seo_state, '{}'::jsonb),
    workflow_state = COALESCE(workflow_state, '{}'::jsonb)
WHERE seo_state IS NULL
   OR workflow_state IS NULL;

CREATE INDEX IF NOT EXISTS idx_posts_org_workflow_status
  ON public.posts(organization_id, brand_project_id, status, updated_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_workflow_state_gin
  ON public.posts
  USING gin (workflow_state);

CREATE INDEX IF NOT EXISTS idx_posts_seo_state_gin
  ON public.posts
  USING gin (seo_state);
