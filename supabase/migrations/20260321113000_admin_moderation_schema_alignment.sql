-- ============================================================================
-- Migration: admin_moderation_schema_alignment
-- Date: 2026-03-21
-- Purpose:
--   1) Guarantee the database contract required by the admin moderation page
--   2) Ensure connected_accounts exists and can relate to posts.account_id
--   3) Backfill safe defaults used by moderation filters, drawers, and actions
--   4) Add indexes that support the admin-list-posts edge function and UI flows
-- Notes:
--   - Idempotent and non-destructive
--   - Designed to be safe on environments that partially applied earlier packets
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -- Connected accounts ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.connected_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL,
  account_name text,
  account_id text,
  username text,
  avatar_url text,
  profile_picture_url text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}',
  connection_status text NOT NULL DEFAULT 'active',
  platform_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_token_refresh timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE public.connected_accounts
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS account_name text,
  ADD COLUMN IF NOT EXISTS account_id text,
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS profile_picture_url text,
  ADD COLUMN IF NOT EXISTS access_token text,
  ADD COLUMN IF NOT EXISTS refresh_token text,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS connection_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS platform_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_token_refresh timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.connected_accounts
  ALTER COLUMN scopes SET DEFAULT '{}',
  ALTER COLUMN connection_status SET DEFAULT 'active',
  ALTER COLUMN platform_metadata SET DEFAULT '{}'::jsonb,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

UPDATE public.connected_accounts
SET scopes = '{}'
WHERE scopes IS NULL;

UPDATE public.connected_accounts
SET platform_metadata = '{}'::jsonb
WHERE platform_metadata IS NULL;

UPDATE public.connected_accounts
SET connection_status = 'active'
WHERE connection_status IS NULL OR btrim(connection_status) = '';

UPDATE public.connected_accounts
SET platform = lower(platform)
WHERE platform IS NOT NULL
  AND platform <> lower(platform);

UPDATE public.connected_accounts
SET connection_status = lower(connection_status)
WHERE connection_status IS NOT NULL
  AND connection_status <> lower(connection_status);

UPDATE public.connected_accounts
SET created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, created_at, now())
WHERE created_at IS NULL OR updated_at IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'set_updated_at'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS set_connected_accounts_updated_at ON public.connected_accounts';
    EXECUTE '
      CREATE TRIGGER set_connected_accounts_updated_at
      BEFORE UPDATE ON public.connected_accounts
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at()
    ';
  END IF;
END
$$;

ALTER TABLE public.connected_accounts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS "Users or scoped admins manage own connected accounts" ON public.connected_accounts';
  EXECUTE 'DROP POLICY IF EXISTS "Users manage own connected accounts" ON public.connected_accounts';

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'can_admin_access_user'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Users or scoped admins manage own connected accounts"
      ON public.connected_accounts FOR ALL
      USING (auth.uid() = user_id OR public.can_admin_access_user(auth.uid(), user_id))
      WITH CHECK (auth.uid() = user_id OR public.can_admin_access_user(auth.uid(), user_id))
    $policy$;
  ELSE
    EXECUTE $policy$
      CREATE POLICY "Users manage own connected accounts"
      ON public.connected_accounts FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id)
    $policy$;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_connected_accounts_user_status_created
  ON public.connected_accounts(user_id, connection_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connected_accounts_user_platform_created
  ON public.connected_accounts(user_id, platform, created_at DESC);

-- -- Moderation compatibility columns ----------------------------------------
ALTER TABLE public.generations
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS hashtags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS moderation_status text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS flagged_by_admin_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS force_published_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS delete_reason text,
  ADD COLUMN IF NOT EXISTS quality_review_id uuid REFERENCES public.content_quality_reviews(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz,
  ADD COLUMN IF NOT EXISTS activity_status text DEFAULT 'active';

UPDATE public.generations
SET metadata = '{}'::jsonb
WHERE metadata IS NULL;

UPDATE public.generations
SET media_type = lower(media_type)
WHERE media_type IS NOT NULL
  AND media_type <> lower(media_type);

UPDATE public.posts
SET hashtags = '{}'
WHERE hashtags IS NULL;

UPDATE public.posts
SET moderation_status = 'none'
WHERE moderation_status IS NULL OR btrim(moderation_status) = '';

UPDATE public.posts
SET platform = lower(platform)
WHERE platform IS NOT NULL
  AND platform <> lower(platform);

UPDATE public.posts
SET moderation_status = lower(moderation_status)
WHERE moderation_status IS NOT NULL
  AND moderation_status <> lower(moderation_status);

UPDATE public.profiles
SET activity_status = 'active'
WHERE activity_status IS NULL OR btrim(activity_status) = '';

-- Backfill organization scope for admin moderation joins.
WITH preferred_membership AS (
  SELECT DISTINCT ON (om.user_id)
    om.user_id,
    om.organization_id
  FROM public.organization_members om
  WHERE om.status = 'active'
  ORDER BY om.user_id, om.joined_at ASC, om.organization_id
)
UPDATE public.profiles p
SET organization_id = pm.organization_id
FROM preferred_membership pm
WHERE pm.user_id = p.id
  AND p.organization_id IS NULL;

UPDATE public.profiles p
SET organization_id = ar.organization_id
FROM public.admin_roles ar
WHERE ar.user_id = p.id
  AND ar.organization_id IS NOT NULL
  AND p.organization_id IS NULL;

WITH preferred_org_admin_membership AS (
  SELECT DISTINCT ON (om.user_id)
    om.user_id,
    om.organization_id
  FROM public.organization_members om
  WHERE lower(coalesce(om.role, '')) = 'org_admin'
    AND om.status = 'active'
  ORDER BY om.user_id, om.joined_at ASC, om.organization_id
)
INSERT INTO public.admin_roles (user_id, role, organization_id)
SELECT poam.user_id, 'org_admin', poam.organization_id
FROM preferred_org_admin_membership poam
LEFT JOIN public.admin_roles ar ON ar.user_id = poam.user_id
WHERE ar.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;

WITH preferred_org_admin_membership AS (
  SELECT DISTINCT ON (om.user_id)
    om.user_id,
    om.organization_id
  FROM public.organization_members om
  WHERE lower(coalesce(om.role, '')) = 'org_admin'
    AND om.status = 'active'
  ORDER BY om.user_id, om.joined_at ASC, om.organization_id
)
UPDATE public.admin_roles ar
SET organization_id = poam.organization_id
FROM preferred_org_admin_membership poam
WHERE ar.user_id = poam.user_id
  AND ar.role = 'org_admin'
  AND ar.organization_id IS NULL
  AND poam.organization_id IS NOT NULL;

-- Fill post platform from the connected account when possible.
UPDATE public.posts p
SET platform = ca.platform
FROM public.connected_accounts ca
WHERE p.account_id = ca.id
  AND ca.platform IS NOT NULL
  AND (p.platform IS NULL OR btrim(p.platform) = '');

-- Keep posts.quality_review_id aligned with the latest post-scoped review.
WITH latest_post_reviews AS (
  SELECT DISTINCT ON (post_id)
    post_id,
    id
  FROM public.content_quality_reviews
  WHERE post_id IS NOT NULL
  ORDER BY post_id, created_at DESC, id DESC
)
UPDATE public.posts p
SET quality_review_id = lpr.id
FROM latest_post_reviews lpr
WHERE p.id = lpr.post_id
  AND (p.quality_review_id IS NULL OR p.quality_review_id <> lpr.id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'refresh_profile_activity_statuses'
  ) THEN
    PERFORM public.refresh_profile_activity_statuses();
  END IF;
END
$$;

-- -- Relationship alignment --------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'posts'
      AND column_name = 'account_id'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'connected_accounts'
      AND column_name = 'id'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'posts_account_id_fkey'
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.connected_accounts(id) ON DELETE SET NULL NOT VALID;
  END IF;
END
$$;

DO $$
DECLARE
  orphan_count bigint := 0;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'posts_account_id_fkey'
  ) THEN
    SELECT COUNT(*)
    INTO orphan_count
    FROM public.posts p
    LEFT JOIN public.connected_accounts ca ON ca.id = p.account_id
    WHERE p.account_id IS NOT NULL
      AND ca.id IS NULL;

    IF orphan_count = 0 THEN
      ALTER TABLE public.posts VALIDATE CONSTRAINT posts_account_id_fkey;
    ELSE
      RAISE NOTICE 'posts_account_id_fkey validation skipped because % orphan account_id rows exist.', orphan_count;
    END IF;
  END IF;
END
$$;

-- -- Query support indexes ---------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_posts_admin_user_created
  ON public.posts(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_admin_generation_created
  ON public.posts(generation_id, created_at DESC)
  WHERE generation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_admin_moderation_date
  ON public.posts(moderation_status, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_admin_scheduled_date
  ON public.posts(status, scheduled_at DESC)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_generations_admin_user_created
  ON public.generations(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generations_admin_status_created
  ON public.generations(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quality_reviews_post_created
  ON public.content_quality_reviews(post_id, created_at DESC)
  WHERE post_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quality_reviews_generation_post_created
  ON public.content_quality_reviews(generation_id, post_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_versions_generation_created
  ON public.content_versions(generation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_versions_post_active_created
  ON public.content_versions(post_id, is_active, created_at DESC)
  WHERE post_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_action_requests_target_post_status
  ON public.admin_action_requests(target_post_id, status, created_at DESC)
  WHERE target_post_id IS NOT NULL;
