  -- ============================================================================
  -- Migration: database_integrity_security_cleanup
  -- Date: 2026-05-13
  -- Purpose:
  --   1) Repair signup/profile provisioning drift.
  --   2) Harden profile self-service writes so users cannot elevate role/credits.
  --   3) Add code-required uniqueness only when existing data is already clean.
  -- Notes:
  --   - Non-destructive: duplicate composite-key data is reported with NOTICE.
  --   - Follow up by running the duplicate detection queries in the audit report.
  -- ============================================================================

  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  -- -- Profile role domain ------------------------------------------------------
  -- Earlier signup code writes profiles.role = 'user'. Some environments still
  -- have the legacy tutoring-domain check that only allows parent/admin/advisor/tutor.
  DO $$
  DECLARE
    c record;
  BEGIN
    FOR c IN
      SELECT pc.conname
      FROM pg_constraint pc
      WHERE pc.conrelid = 'public.profiles'::regclass
        AND pc.contype = 'c'
        AND pg_get_constraintdef(pc.oid) ILIKE '%role%'
    LOOP
      EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS %I', c.conname);
    END LOOP;
  END
  $$;

  UPDATE public.profiles
  SET role = 'user'
  WHERE role IS NULL OR btrim(role) = '';

  UPDATE public.profiles
  SET role = lower(role)
  WHERE role IS NOT NULL AND role <> lower(role);

  ALTER TABLE public.profiles
    ALTER COLUMN role SET DEFAULT 'user';

  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_allowed
    CHECK (
      role IS NULL
      OR role IN (
        'user',
        'creator',
        'member',
        'client',
        'parent',
        'admin',
        'advisor',
        'tutor',
        'super_admin',
        'org_admin'
      )
    ) NOT VALID;

  DO $$
  DECLARE
    invalid_count bigint := 0;
  BEGIN
    SELECT count(*)
    INTO invalid_count
    FROM public.profiles
    WHERE role IS NOT NULL
      AND role NOT IN (
        'user',
        'creator',
        'member',
        'client',
        'parent',
        'admin',
        'advisor',
        'tutor',
        'super_admin',
        'org_admin'
      );

    IF invalid_count = 0 THEN
      ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_role_allowed;
    ELSE
      RAISE NOTICE 'profiles_role_allowed left NOT VALID because % profile rows have non-canonical role values.', invalid_count;
    END IF;
  END
  $$;

  -- Ensure profiles remain tied to auth.users where the FK was never created.
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.profiles'::regclass
        AND conname = 'profiles_id_fkey'
    ) THEN
      ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_id_fkey
        FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    END IF;
  END
  $$;

  DO $$
  DECLARE
    orphan_count bigint := 0;
  BEGIN
    SELECT count(*)
    INTO orphan_count
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE u.id IS NULL;

    IF orphan_count = 0 THEN
      ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_id_fkey;
    ELSE
      RAISE NOTICE 'profiles_id_fkey left NOT VALID because % orphan profile rows exist.', orphan_count;
    END IF;
  END
  $$;

  -- -- Harden profile self-service policies ------------------------------------
  CREATE OR REPLACE FUNCTION public.profile_self_update_guard(
    p_profile_id uuid,
    p_email text,
    p_role text,
    p_is_admin text,
    p_credits integer,
    p_status text,
    p_organization_id uuid,
    p_activity_status text,
    p_suspension_type text,
    p_suspension_expires_at timestamptz,
    p_deletion_requested_at timestamptz,
    p_deletion_eligible_at timestamptz
  )
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1
      FROM public.profiles current_profile
      WHERE current_profile.id = p_profile_id
        AND current_profile.id = auth.uid()
        AND current_profile.email IS NOT DISTINCT FROM p_email
        AND current_profile.role IS NOT DISTINCT FROM p_role
        AND current_profile.is_admin IS NOT DISTINCT FROM p_is_admin
        AND current_profile.credits IS NOT DISTINCT FROM p_credits
        AND current_profile.status IS NOT DISTINCT FROM p_status
        AND current_profile.organization_id IS NOT DISTINCT FROM p_organization_id
        AND current_profile.activity_status IS NOT DISTINCT FROM p_activity_status
        AND current_profile.suspension_type IS NOT DISTINCT FROM p_suspension_type
        AND current_profile.suspension_expires_at IS NOT DISTINCT FROM p_suspension_expires_at
        AND current_profile.deletion_requested_at IS NOT DISTINCT FROM p_deletion_requested_at
        AND current_profile.deletion_eligible_at IS NOT DISTINCT FROM p_deletion_eligible_at
    );
  $$;

  REVOKE ALL ON FUNCTION public.profile_self_update_guard(
    uuid, text, text, text, integer, text, uuid, text, text, timestamptz, timestamptz, timestamptz
  ) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.profile_self_update_guard(
    uuid, text, text, text, integer, text, uuid, text, text, timestamptz, timestamptz, timestamptz
  ) TO authenticated;

  ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
  CREATE POLICY "Users insert own profile"
    ON public.profiles
    FOR INSERT
    WITH CHECK (
      auth.uid() = id
      AND coalesce(nullif(role, ''), 'user') IN ('user', 'creator', 'member', 'client')
      AND coalesce(nullif(is_admin, ''), 'false') IN ('false', '0', 'no', 'n')
      AND coalesce(credits, 100) BETWEEN 0 AND 100
      AND coalesce(nullif(status, ''), 'active') = 'active'
      AND organization_id IS NULL
      AND coalesce(nullif(activity_status, ''), 'active') = 'active'
      AND suspension_type IS NULL
      AND suspension_expires_at IS NULL
      AND deletion_requested_at IS NULL
      AND deletion_eligible_at IS NULL
    );

  DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
  CREATE POLICY "Users update own profile"
    ON public.profiles
    FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (
      auth.uid() = id
      AND public.profile_self_update_guard(
        id,
        email,
        role,
        is_admin,
        credits,
        status,
        organization_id,
        activity_status,
        suspension_type,
        suspension_expires_at,
        deletion_requested_at,
        deletion_eligible_at
      )
    );

  -- -- Signup provisioning ------------------------------------------------------
  CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    inferred_full_name text;
  BEGIN
    inferred_full_name := COALESCE(
      NULLIF(
        TRIM(
          COALESCE(
            NEW.raw_user_meta_data ->> 'full_name',
            NEW.raw_user_meta_data ->> 'name'
          )
        ),
        ''
      ),
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      'New User'
    );

    INSERT INTO public.profiles (id, full_name, email, role, status, credits)
    VALUES (NEW.id, inferred_full_name, NEW.email, 'user', 'active', 100)
    ON CONFLICT (id) DO UPDATE
    SET
      full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
      email = COALESCE(public.profiles.email, EXCLUDED.email),
      role = COALESCE(NULLIF(public.profiles.role, ''), 'user'),
      status = COALESCE(NULLIF(public.profiles.status, ''), 'active'),
      credits = COALESCE(public.profiles.credits, 100);

    IF to_regclass('public.user_settings') IS NOT NULL THEN
      EXECUTE 'INSERT INTO public.user_settings (user_id)
              SELECT $1
              WHERE NOT EXISTS (
                SELECT 1 FROM public.user_settings WHERE user_id = $1
              )'
      USING NEW.id;
    END IF;

    IF to_regclass('public.user_credits') IS NOT NULL THEN
      EXECUTE 'INSERT INTO public.user_credits (user_id, balance)
              SELECT $1, 30
              WHERE NOT EXISTS (
                SELECT 1 FROM public.user_credits WHERE user_id = $1
              )'
      USING NEW.id;
    END IF;

    RETURN NEW;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING '[handle_new_user_profile] Failed for user %: %', NEW.id, SQLERRM;
      RETURN NEW;
  END;
  $$;

  DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
  CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user_profile();

  INSERT INTO public.profiles (id, full_name, email, role, status, credits)
  SELECT
    u.id,
    COALESCE(
      NULLIF(TRIM(COALESCE(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')), ''),
      NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
      'New User'
    ),
    u.email,
    'user',
    'active',
    100
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE p.id IS NULL;

  DO $$
  BEGIN
    IF to_regclass('public.user_settings') IS NOT NULL THEN
      EXECUTE 'INSERT INTO public.user_settings (user_id)
              SELECT u.id
              FROM auth.users u
              WHERE NOT EXISTS (
                SELECT 1 FROM public.user_settings us WHERE us.user_id = u.id
              )';
    END IF;

    IF to_regclass('public.user_credits') IS NOT NULL THEN
      EXECUTE 'INSERT INTO public.user_credits (user_id, balance)
              SELECT u.id, 30
              FROM auth.users u
              WHERE NOT EXISTS (
                SELECT 1 FROM public.user_credits uc WHERE uc.user_id = u.id
              )';
    END IF;
  END
  $$;

  -- -- Connected account read model redaction ----------------------------------
  -- The health summary is used by client UI. It should not expose token columns,
  -- even in mock mode, because the same contract will eventually carry real OAuth.
  DO $$
  BEGIN
    IF to_regclass('public.connected_accounts') IS NOT NULL
      AND to_regclass('public.platform_registry') IS NOT NULL
    THEN
      EXECUTE $view$
        CREATE OR REPLACE VIEW public.user_account_health_summary
        WITH (security_invoker = true) AS
        SELECT
          ca.user_id,
          COUNT(*) FILTER (
            WHERE coalesce(ca.connection_status, 'active') IN ('active', 'mock')
              AND coalesce(ca.consecutive_failure_count, 0) = 0
          ) AS healthy_count,
          COUNT(*) FILTER (
            WHERE coalesce(ca.connection_status, 'active') NOT IN ('active', 'mock')
              OR coalesce(ca.consecutive_failure_count, 0) > 0
          ) AS issues_count,
          COUNT(*) FILTER (
            WHERE coalesce(ca.connection_status, 'active') NOT IN ('revoked', 'disconnected')
          ) AS total_count,
          MAX(ca.last_successful_publish_at) AS last_publish_at,
          BOOL_OR(coalesce(ca.consecutive_failure_count, 0) >= 3) AS has_critical
        FROM public.connected_accounts ca
        WHERE ca.scope = 'personal'
          AND coalesce(ca.connection_status, 'active') NOT IN ('revoked', 'disconnected')
        GROUP BY ca.user_id
      $view$;

      EXECUTE $view$
        CREATE OR REPLACE VIEW public.org_account_health_summary
        WITH (security_invoker = true) AS
        SELECT
          ca.organization_id,
          COUNT(*) FILTER (
            WHERE coalesce(ca.connection_status, 'active') IN ('active', 'mock')
              AND coalesce(ca.consecutive_failure_count, 0) = 0
          ) AS healthy_count,
          COUNT(*) FILTER (
            WHERE coalesce(ca.connection_status, 'active') NOT IN ('active', 'mock')
              OR coalesce(ca.consecutive_failure_count, 0) > 0
          ) AS issues_count,
          COUNT(*) FILTER (
            WHERE coalesce(ca.connection_status, 'active') NOT IN ('revoked', 'disconnected')
          ) AS total_count,
          MAX(ca.last_successful_publish_at) AS last_publish_at
        FROM public.connected_accounts ca
        WHERE ca.scope = 'organization'
          AND coalesce(ca.connection_status, 'active') NOT IN ('revoked', 'disconnected')
        GROUP BY ca.organization_id
      $view$;

      EXECUTE $view$
        CREATE OR REPLACE VIEW public.platform_account_health_overview
        WITH (security_invoker = true) AS
        SELECT
          COUNT(*) FILTER (
            WHERE coalesce(connection_status, 'active') NOT IN ('revoked', 'disconnected')
          ) AS total_connected,
          COUNT(*) FILTER (
            WHERE health_score > 70
              AND coalesce(connection_status, 'active') IN ('active', 'mock')
              AND coalesce(consecutive_failure_count, 0) = 0
          ) AS healthy,
          COUNT(*) FILTER (
            WHERE (
              health_score BETWEEN 30 AND 70
              OR coalesce(consecutive_failure_count, 0) BETWEEN 1 AND 2
            )
              AND coalesce(connection_status, 'active') NOT IN ('revoked', 'disconnected')
          ) AS degraded,
          COUNT(*) FILTER (
            WHERE health_score < 30
              OR coalesce(consecutive_failure_count, 0) >= 3
              OR coalesce(connection_status, 'active') IN ('error', 'expired', 'reconnecting')
          ) AS critical
        FROM public.connected_accounts
        WHERE coalesce(connection_status, 'active') NOT IN ('revoked', 'disconnected')
      $view$;

      -- Removing mock_token changes the view column list; PostgreSQL cannot do
      -- that with CREATE OR REPLACE VIEW, so this one view must be rebuilt.
      EXECUTE 'DROP VIEW IF EXISTS public.connected_accounts_health_summary';

      EXECUTE $view$
        CREATE VIEW public.connected_accounts_health_summary
        WITH (security_invoker = true) AS
        SELECT
          ca.id,
          ca.user_id,
          ca.organization_id,
          ca.brand_project_id,
          ca.scope,
          ca.platform,
          ca.account_name,
          ca.display_name,
          ca.username,
          ca.profile_type,
          ca.profile_picture_url,
          ca.avatar_url,
          ca.connection_status,
          ca.health_score,
          ca.consecutive_failure_count,
          ca.last_failure_at,
          ca.last_failure_reason,
          ca.last_successful_publish_at,
          ca.total_posts_published,
          ca.total_posts_scheduled,
          ca.is_mock,
          ca.token_expires_at,
          ca.follower_count,
          ca.account_category,
          ca.granted_member_ids,
          pr.brand_color,
          pr.display_name AS platform_display_name,
          pr.icon_url,
          pr.supported_profile_types,
          pr.supported_content_types,
          pr.supports_stories,
          pr.supports_reels,
          pr.supports_carousels,
          pr.character_limit
        FROM public.connected_accounts ca
        JOIN public.platform_registry pr
          ON pr.platform_key = ca.platform
        WHERE coalesce(ca.connection_status, 'active') NOT IN ('revoked', 'disconnected')
      $view$;

      EXECUTE 'GRANT SELECT ON public.user_account_health_summary TO authenticated';
      EXECUTE 'GRANT SELECT ON public.org_account_health_summary TO authenticated';
      EXECUTE 'GRANT SELECT ON public.platform_account_health_overview TO authenticated';
      EXECUTE 'GRANT SELECT ON public.connected_accounts_health_summary TO authenticated';
    END IF;
  END
  $$;

  -- Limit authenticated client reads of connected account rows to non-token
  -- columns. Mock/live provider secrets should not be selectable from browsers.
  DO $$
  BEGIN
    IF to_regclass('public.connected_accounts') IS NOT NULL THEN
      REVOKE SELECT ON TABLE public.connected_accounts FROM PUBLIC, anon, authenticated;

      GRANT SELECT (
        id,
        user_id,
        platform,
        account_name,
        account_id,
        avatar_url,
        created_at,
        connection_status,
        username,
        profile_picture_url,
        token_expires_at,
        last_token_refresh,
        scopes,
        updated_at,
        deleted_at,
        scope,
        organization_id,
        brand_project_id,
        display_name,
        profile_type,
        follower_count,
        account_category,
        is_mock,
        last_token_refresh_at,
        health_score,
        consecutive_failure_count,
        last_failure_at,
        last_failure_reason,
        last_successful_publish_at,
        total_posts_published,
        total_posts_scheduled,
        granted_member_ids
      ) ON TABLE public.connected_accounts TO authenticated;
    END IF;
  EXCEPTION
    WHEN undefined_object THEN
      RAISE NOTICE 'Skipped connected_accounts column privilege hardening because Supabase API roles are not present.';
  END
  $$;

  -- -- Code-required unique keys -----------------------------------------------
  DO $$
  DECLARE
    duplicate_count bigint := 0;
  BEGIN
    IF to_regclass('public.organization_members') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.organization_members'::regclass
          AND contype = 'u'
          AND conkey = ARRAY[
            (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.organization_members'::regclass AND attname = 'organization_id'),
            (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.organization_members'::regclass AND attname = 'user_id')
          ]::smallint[]
      )
      AND to_regclass('public.idx_organization_members_org_user_unique') IS NULL
    THEN
      SELECT count(*) INTO duplicate_count
      FROM (
        SELECT organization_id, user_id
        FROM public.organization_members
        GROUP BY organization_id, user_id
        HAVING count(*) > 1
      ) duplicates;

      IF duplicate_count = 0 THEN
        CREATE UNIQUE INDEX idx_organization_members_org_user_unique
          ON public.organization_members(organization_id, user_id);
      ELSE
        RAISE NOTICE 'Skipped organization_members(organization_id,user_id) unique index; % duplicate groups exist.', duplicate_count;
      END IF;
    END IF;
  END
  $$;

  DO $$
  DECLARE
    duplicate_count bigint := 0;
  BEGIN
    IF to_regclass('public.brand_projects') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.brand_projects'::regclass
          AND contype IN ('u', 'p')
          AND conkey = ARRAY[
            (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.brand_projects'::regclass AND attname = 'organization_id'),
            (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.brand_projects'::regclass AND attname = 'slug')
          ]::smallint[]
      )
      AND to_regclass('public.idx_brand_projects_org_slug_unique') IS NULL
    THEN
      SELECT count(*) INTO duplicate_count
      FROM (
        SELECT organization_id, slug
        FROM public.brand_projects
        GROUP BY organization_id, slug
        HAVING count(*) > 1
      ) duplicates;

      IF duplicate_count = 0 THEN
        CREATE UNIQUE INDEX idx_brand_projects_org_slug_unique
          ON public.brand_projects(organization_id, slug);
      ELSE
        RAISE NOTICE 'Skipped brand_projects(organization_id,slug) unique index; % duplicate groups exist.', duplicate_count;
      END IF;
    END IF;
  END
  $$;

  DO $$
  DECLARE
    duplicate_count bigint := 0;
  BEGIN
    IF to_regclass('public.org_role_templates') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.org_role_templates'::regclass
          AND contype IN ('u', 'p')
          AND conkey = ARRAY[
            (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.org_role_templates'::regclass AND attname = 'organization_id'),
            (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.org_role_templates'::regclass AND attname = 'role_key')
          ]::smallint[]
      )
      AND to_regclass('public.idx_org_role_templates_org_role_key_unique') IS NULL
    THEN
      SELECT count(*) INTO duplicate_count
      FROM (
        SELECT organization_id, role_key
        FROM public.org_role_templates
        GROUP BY organization_id, role_key
        HAVING count(*) > 1
      ) duplicates;

      IF duplicate_count = 0 THEN
        CREATE UNIQUE INDEX idx_org_role_templates_org_role_key_unique
          ON public.org_role_templates(organization_id, role_key);
      ELSE
        RAISE NOTICE 'Skipped org_role_templates(organization_id,role_key) unique index; % duplicate groups exist.', duplicate_count;
      END IF;
    END IF;
  END
  $$;

  DO $$
  DECLARE
    duplicate_count bigint := 0;
  BEGIN
    IF to_regclass('public.org_task_statuses') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.org_task_statuses'::regclass
          AND contype IN ('u', 'p')
          AND conkey = ARRAY[
            (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.org_task_statuses'::regclass AND attname = 'organization_id'),
            (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.org_task_statuses'::regclass AND attname = 'key')
          ]::smallint[]
      )
      AND to_regclass('public.idx_org_task_statuses_org_key_unique') IS NULL
    THEN
      SELECT count(*) INTO duplicate_count
      FROM (
        SELECT organization_id, key
        FROM public.org_task_statuses
        GROUP BY organization_id, key
        HAVING count(*) > 1
      ) duplicates;

      IF duplicate_count = 0 THEN
        CREATE UNIQUE INDEX idx_org_task_statuses_org_key_unique
          ON public.org_task_statuses(organization_id, key);
      ELSE
        RAISE NOTICE 'Skipped org_task_statuses(organization_id,key) unique index; % duplicate groups exist.', duplicate_count;
      END IF;
    END IF;
  END
  $$;

  DO $$
  DECLARE
    duplicate_count bigint := 0;
  BEGIN
    IF to_regclass('public.org_member_dashboard_state') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.org_member_dashboard_state'::regclass
          AND contype IN ('u', 'p')
          AND conkey = ARRAY[
            (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.org_member_dashboard_state'::regclass AND attname = 'organization_id'),
            (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.org_member_dashboard_state'::regclass AND attname = 'user_id')
          ]::smallint[]
      )
      AND to_regclass('public.idx_org_member_dashboard_state_org_user_unique') IS NULL
    THEN
      SELECT count(*) INTO duplicate_count
      FROM (
        SELECT organization_id, user_id
        FROM public.org_member_dashboard_state
        GROUP BY organization_id, user_id
        HAVING count(*) > 1
      ) duplicates;

      IF duplicate_count = 0 THEN
        CREATE UNIQUE INDEX idx_org_member_dashboard_state_org_user_unique
          ON public.org_member_dashboard_state(organization_id, user_id);
      ELSE
        RAISE NOTICE 'Skipped org_member_dashboard_state(organization_id,user_id) unique index; % duplicate groups exist.', duplicate_count;
      END IF;
    END IF;
  END
  $$;

  DO $$
  DECLARE
    duplicate_count bigint := 0;
  BEGIN
    IF to_regclass('public.common_room_channel_reads') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.common_room_channel_reads'::regclass
          AND contype IN ('u', 'p')
          AND conkey = ARRAY[
            (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.common_room_channel_reads'::regclass AND attname = 'channel_id'),
            (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.common_room_channel_reads'::regclass AND attname = 'user_id')
          ]::smallint[]
      )
      AND to_regclass('public.idx_common_room_channel_reads_channel_user_unique') IS NULL
    THEN
      SELECT count(*) INTO duplicate_count
      FROM (
        SELECT channel_id, user_id
        FROM public.common_room_channel_reads
        GROUP BY channel_id, user_id
        HAVING count(*) > 1
      ) duplicates;

      IF duplicate_count = 0 THEN
        CREATE UNIQUE INDEX idx_common_room_channel_reads_channel_user_unique
          ON public.common_room_channel_reads(channel_id, user_id);
      ELSE
        RAISE NOTICE 'Skipped common_room_channel_reads(channel_id,user_id) unique index; % duplicate groups exist.', duplicate_count;
      END IF;
    END IF;
  END
  $$;

  DO $$
  DECLARE
    duplicate_count bigint := 0;
  BEGIN
    IF to_regclass('public.org_post_asset_links') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.org_post_asset_links'::regclass
          AND contype IN ('u', 'p')
          AND conkey = ARRAY[
            (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.org_post_asset_links'::regclass AND attname = 'post_id'),
            (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.org_post_asset_links'::regclass AND attname = 'asset_id')
          ]::smallint[]
      )
      AND to_regclass('public.idx_org_post_asset_links_post_asset_unique') IS NULL
    THEN
      SELECT count(*) INTO duplicate_count
      FROM (
        SELECT post_id, asset_id
        FROM public.org_post_asset_links
        GROUP BY post_id, asset_id
        HAVING count(*) > 1
      ) duplicates;

      IF duplicate_count = 0 THEN
        CREATE UNIQUE INDEX idx_org_post_asset_links_post_asset_unique
          ON public.org_post_asset_links(post_id, asset_id);
      ELSE
        RAISE NOTICE 'Skipped org_post_asset_links(post_id,asset_id) unique index; % duplicate groups exist.', duplicate_count;
      END IF;
    END IF;
  END
  $$;

  DO $$
  DECLARE
    duplicate_count bigint := 0;
  BEGIN
    IF to_regclass('public.org_brand_kits') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.org_brand_kits'::regclass
          AND contype IN ('u', 'p')
          AND conkey = ARRAY[
            (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.org_brand_kits'::regclass AND attname = 'brand_project_id')
          ]::smallint[]
      )
      AND to_regclass('public.idx_org_brand_kits_project_unique') IS NULL
    THEN
      SELECT count(*) INTO duplicate_count
      FROM (
        SELECT brand_project_id
        FROM public.org_brand_kits
        GROUP BY brand_project_id
        HAVING count(*) > 1
      ) duplicates;

      IF duplicate_count = 0 THEN
        CREATE UNIQUE INDEX idx_org_brand_kits_project_unique
          ON public.org_brand_kits(brand_project_id);
      ELSE
        RAISE NOTICE 'Skipped org_brand_kits(brand_project_id) unique index; % duplicate groups exist.', duplicate_count;
      END IF;
    END IF;
  END
  $$;

  DO $$
  DECLARE
    duplicate_count bigint := 0;
  BEGIN
    IF to_regclass('public.org_brand_kit_editors') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.org_brand_kit_editors'::regclass
          AND contype IN ('u', 'p')
          AND conkey = ARRAY[
            (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.org_brand_kit_editors'::regclass AND attname = 'brand_kit_id'),
            (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.org_brand_kit_editors'::regclass AND attname = 'user_id')
          ]::smallint[]
      )
      AND to_regclass('public.idx_org_brand_kit_editors_kit_user_unique') IS NULL
    THEN
      SELECT count(*) INTO duplicate_count
      FROM (
        SELECT brand_kit_id, user_id
        FROM public.org_brand_kit_editors
        GROUP BY brand_kit_id, user_id
        HAVING count(*) > 1
      ) duplicates;

      IF duplicate_count = 0 THEN
        CREATE UNIQUE INDEX idx_org_brand_kit_editors_kit_user_unique
          ON public.org_brand_kit_editors(brand_kit_id, user_id);
      ELSE
        RAISE NOTICE 'Skipped org_brand_kit_editors(brand_kit_id,user_id) unique index; % duplicate groups exist.', duplicate_count;
      END IF;
    END IF;
  END
  $$;

  DO $$
  DECLARE
    duplicate_count bigint := 0;
  BEGIN
    IF to_regclass('public.optimal_posting_times') IS NOT NULL
      AND to_regclass('public.idx_optimal_posting_times_user_platform_day_hour_unique') IS NULL
    THEN
      SELECT count(*) INTO duplicate_count
      FROM (
        SELECT user_id, platform, day_of_week, hour_of_day
        FROM public.optimal_posting_times
        GROUP BY user_id, platform, day_of_week, hour_of_day
        HAVING count(*) > 1
      ) duplicates;

      IF duplicate_count = 0 THEN
        CREATE UNIQUE INDEX idx_optimal_posting_times_user_platform_day_hour_unique
          ON public.optimal_posting_times(user_id, platform, day_of_week, hour_of_day);
      ELSE
        RAISE NOTICE 'Skipped optimal_posting_times(user_id,platform,day_of_week,hour_of_day) unique index; % duplicate groups exist.', duplicate_count;
      END IF;
    END IF;
  END
  $$;

  DO $$
  DECLARE
    duplicate_count bigint := 0;
  BEGIN
    IF to_regclass('public.user_settings') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.user_settings'::regclass
          AND contype IN ('u', 'p')
          AND conkey = ARRAY[
            (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.user_settings'::regclass AND attname = 'user_id')
          ]::smallint[]
      )
      AND to_regclass('public.idx_user_settings_user_id_unique') IS NULL
    THEN
      SELECT count(*) INTO duplicate_count
      FROM (
        SELECT user_id
        FROM public.user_settings
        GROUP BY user_id
        HAVING count(*) > 1
      ) duplicates;

      IF duplicate_count = 0 THEN
        CREATE UNIQUE INDEX idx_user_settings_user_id_unique
          ON public.user_settings(user_id);
      ELSE
        RAISE NOTICE 'Skipped user_settings(user_id) unique index; % duplicate groups exist.', duplicate_count;
      END IF;
    END IF;
  END
  $$;

  DO $$
  DECLARE
    duplicate_count bigint := 0;
  BEGIN
    IF to_regclass('public.mock_publish_logs') IS NOT NULL
      AND to_regclass('public.idx_mock_publish_logs_request_unique') IS NULL
    THEN
      SELECT count(*) INTO duplicate_count
      FROM (
        SELECT publish_request_id, post_id, connected_account_id
        FROM public.mock_publish_logs
        WHERE publish_request_id IS NOT NULL
        GROUP BY publish_request_id, post_id, connected_account_id
        HAVING count(*) > 1
      ) duplicates;

      IF duplicate_count = 0 THEN
        CREATE UNIQUE INDEX idx_mock_publish_logs_request_unique
          ON public.mock_publish_logs(publish_request_id, post_id, connected_account_id)
          WHERE publish_request_id IS NOT NULL;
      ELSE
        RAISE NOTICE 'Skipped mock_publish_logs publish request unique index; % duplicate groups exist.', duplicate_count;
      END IF;
    END IF;
  END
  $$;
