CREATE TABLE IF NOT EXISTS public.org_calendar_view_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('personal', 'shared')),
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  view_mode text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  layout jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_calendar_view_presets_org_scope
  ON public.org_calendar_view_presets(organization_id, scope, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_org_calendar_view_presets_owner
  ON public.org_calendar_view_presets(owner_user_id, organization_id)
  WHERE owner_user_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_org_calendar_view_presets_updated_at'
  ) THEN
    CREATE TRIGGER set_org_calendar_view_presets_updated_at
      BEFORE UPDATE ON public.org_calendar_view_presets
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

ALTER TABLE public.org_calendar_view_presets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE policyname = 'org_calendar_view_presets_member_read'
      AND tablename = 'org_calendar_view_presets'
  ) THEN
    CREATE POLICY org_calendar_view_presets_member_read
      ON public.org_calendar_view_presets
      FOR SELECT
      USING (
        public.org_current_user_is_active_member(organization_id)
        AND (
          scope = 'shared'
          OR owner_user_id = auth.uid()
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
    WHERE policyname = 'org_calendar_view_presets_write'
      AND tablename = 'org_calendar_view_presets'
  ) THEN
    CREATE POLICY org_calendar_view_presets_write
      ON public.org_calendar_view_presets
      FOR INSERT
      WITH CHECK (
        public.org_current_user_is_active_member(organization_id)
        AND created_by = auth.uid()
        AND (
          (
            scope = 'personal'
            AND owner_user_id = auth.uid()
          )
          OR (
            scope = 'shared'
            AND owner_user_id IS NULL
            AND public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
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
    WHERE policyname = 'org_calendar_view_presets_update'
      AND tablename = 'org_calendar_view_presets'
  ) THEN
    CREATE POLICY org_calendar_view_presets_update
      ON public.org_calendar_view_presets
      FOR UPDATE
      USING (
        public.org_current_user_is_active_member(organization_id)
        AND (
          (scope = 'personal' AND owner_user_id = auth.uid())
          OR (
            scope = 'shared'
            AND public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
          )
        )
      )
      WITH CHECK (
        public.org_current_user_is_active_member(organization_id)
        AND (
          (
            scope = 'personal'
            AND owner_user_id = auth.uid()
            AND created_by = auth.uid()
          )
          OR (
            scope = 'shared'
            AND owner_user_id IS NULL
            AND public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
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
    WHERE policyname = 'org_calendar_view_presets_delete'
      AND tablename = 'org_calendar_view_presets'
  ) THEN
    CREATE POLICY org_calendar_view_presets_delete
      ON public.org_calendar_view_presets
      FOR DELETE
      USING (
        public.org_current_user_is_active_member(organization_id)
        AND (
          (scope = 'personal' AND owner_user_id = auth.uid())
          OR (
            scope = 'shared'
            AND public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin')
          )
        )
      );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.org_post_asset_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.org_asset_library(id) ON DELETE CASCADE,
  asset_role text NOT NULL DEFAULT 'reference'
    CHECK (asset_role IN ('primary', 'supporting', 'reference')),
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_post_asset_links_post_asset_unique UNIQUE (post_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_org_post_asset_links_org_post
  ON public.org_post_asset_links(organization_id, post_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_org_post_asset_links_asset
  ON public.org_post_asset_links(asset_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_org_post_asset_links_updated_at'
  ) THEN
    CREATE TRIGGER set_org_post_asset_links_updated_at
      BEFORE UPDATE ON public.org_post_asset_links
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

ALTER TABLE public.org_post_asset_links ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE policyname = 'org_post_asset_links_member_read'
      AND tablename = 'org_post_asset_links'
  ) THEN
    CREATE POLICY org_post_asset_links_member_read
      ON public.org_post_asset_links
      FOR SELECT
      USING (public.org_current_user_is_active_member(organization_id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE policyname = 'org_post_asset_links_write'
      AND tablename = 'org_post_asset_links'
  ) THEN
    CREATE POLICY org_post_asset_links_write
      ON public.org_post_asset_links
      FOR INSERT
      WITH CHECK (
        public.org_current_user_is_active_member(organization_id)
        AND (
          public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin', 'editor')
          OR EXISTS (
            SELECT 1
            FROM public.posts
            WHERE posts.id = post_id
              AND posts.organization_id = organization_id
              AND posts.user_id = auth.uid()
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
    WHERE policyname = 'org_post_asset_links_update'
      AND tablename = 'org_post_asset_links'
  ) THEN
    CREATE POLICY org_post_asset_links_update
      ON public.org_post_asset_links
      FOR UPDATE
      USING (
        public.org_current_user_is_active_member(organization_id)
        AND (
          public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin', 'editor')
          OR EXISTS (
            SELECT 1
            FROM public.posts
            WHERE posts.id = post_id
              AND posts.organization_id = organization_id
              AND posts.user_id = auth.uid()
          )
        )
      )
      WITH CHECK (
        public.org_current_user_is_active_member(organization_id)
        AND (
          public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin', 'editor')
          OR EXISTS (
            SELECT 1
            FROM public.posts
            WHERE posts.id = post_id
              AND posts.organization_id = organization_id
              AND posts.user_id = auth.uid()
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
    WHERE policyname = 'org_post_asset_links_delete'
      AND tablename = 'org_post_asset_links'
  ) THEN
    CREATE POLICY org_post_asset_links_delete
      ON public.org_post_asset_links
      FOR DELETE
      USING (
        public.org_current_user_is_active_member(organization_id)
        AND (
          public.org_current_user_role(organization_id) IN ('org_owner', 'org_admin', 'editor')
          OR EXISTS (
            SELECT 1
            FROM public.posts
            WHERE posts.id = post_id
              AND posts.organization_id = organization_id
              AND posts.user_id = auth.uid()
          )
        )
      );
  END IF;
END
$$;
