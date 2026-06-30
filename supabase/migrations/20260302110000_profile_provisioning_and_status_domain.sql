-- ============================================================================
-- Migration: profile_provisioning_and_status_domain
-- Date: 2026-03-02
-- Purpose:
--   1) Guarantee profile provisioning via auth.users trigger
--   2) Remove archived from post lifecycle domain
--   3) Validate profiles FK when no orphan rows remain
-- ============================================================================

-- -- Profile provisioning trigger ------------------------------------------------
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
    role = COALESCE(public.profiles.role, 'user'),
    status = COALESCE(public.profiles.status, 'active'),
    credits = COALESCE(public.profiles.credits, 100);

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

-- Backfill current auth users that do not yet have a profile row.
INSERT INTO public.profiles (id, full_name, email, role, status, credits)
SELECT
  u.id,
  COALESCE(
    NULLIF(TRIM(COALESCE(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')), ''),
    NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
    'New User'
  ) AS full_name,
  u.email,
  'user' AS role,
  'active' AS status,
  100 AS credits
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

-- -- Post status canonical domain (remove archived) -----------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'posts'
      AND column_name = 'status'
  ) THEN
    UPDATE public.posts
    SET status = 'failed'
    WHERE lower(COALESCE(status::text, '')) = 'archived';

    -- Convert to text to avoid enum lock-in and enforce a canonical CHECK domain.
    ALTER TABLE public.posts
      ALTER COLUMN status TYPE text
      USING lower(status::text);
  END IF;
END
$$;

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT pc.conname
    FROM pg_constraint pc
    JOIN pg_class t ON t.oid = pc.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'posts'
      AND pc.contype = 'c'
      AND pg_get_constraintdef(pc.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'posts'
      AND column_name = 'status'
  ) THEN
    UPDATE public.posts
    SET status = 'draft'
    WHERE status IS NULL OR btrim(status) = '';

    UPDATE public.posts
    SET status = lower(status);

    UPDATE public.posts
    SET status = 'failed'
    WHERE status NOT IN ('draft', 'scheduled', 'publishing', 'published', 'failed');

    ALTER TABLE public.posts
      ALTER COLUMN status SET DEFAULT 'draft';

    ALTER TABLE public.posts
      DROP CONSTRAINT IF EXISTS posts_status_allowed;

    ALTER TABLE public.posts
      ADD CONSTRAINT posts_status_allowed
      CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed'));
  END IF;
END
$$;

-- -- FK validation gate for profiles.id -> auth.users.id -----------------------
DO $$
DECLARE
  orphan_count bigint := 0;
BEGIN
  SELECT COUNT(*)
  INTO orphan_count
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE u.id IS NULL;

  IF orphan_count = 0 THEN
    BEGIN
      ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_id_fkey;
    EXCEPTION
      WHEN undefined_object THEN
        RAISE NOTICE 'profiles_id_fkey not present; skipping validation.';
    END;
  ELSE
    RAISE NOTICE 'profiles_id_fkey validation skipped because % orphan profile rows exist.', orphan_count;
  END IF;
END
$$;
