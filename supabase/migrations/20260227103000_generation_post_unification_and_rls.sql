-- ============================================================================
-- Migration: generation_post_unification_and_rls
-- Purpose:
--   1) Ensure completed generations always map to draft posts (canonical lifecycle)
--   2) Enforce user-scoped access with admin visibility
--   3) Prevent duplicate draft rows for same generation/account pair
-- Notes:
--   - Non-destructive migration (no table drops)
--   - Safe to apply incrementally
-- ============================================================================

-- -- Admin helper -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_user_id
      AND lower(coalesce(p.role, '')) = 'admin'
  );
$$;

-- -- RLS alignment for core content tables -----------------------------------
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users or admins manage own sessions" ON public.sessions;
CREATE POLICY "Users or admins manage own sessions"
  ON public.sessions FOR ALL
  USING (auth.uid() = user_id OR public.is_admin_user(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Users or admins manage own generations" ON public.generations;
CREATE POLICY "Users or admins manage own generations"
  ON public.generations FOR ALL
  USING (auth.uid() = user_id OR public.is_admin_user(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Users or admins manage own posts" ON public.posts;
CREATE POLICY "Users or admins manage own posts"
  ON public.posts FOR ALL
  USING (auth.uid() = user_id OR public.is_admin_user(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Users or admins manage own content plans" ON public.content_plans;
CREATE POLICY "Users or admins manage own content plans"
  ON public.content_plans FOR ALL
  USING (auth.uid() = user_id OR public.is_admin_user(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_admin_user(auth.uid()));

-- Library-aligned tables should also permit admin visibility.
DROP POLICY IF EXISTS "Users manage own media assets" ON public.media_assets;
CREATE POLICY "Users manage own media assets"
  ON public.media_assets FOR ALL
  USING (auth.uid() = user_id OR public.is_admin_user(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Users manage own content templates" ON public.content_templates;
CREATE POLICY "Users manage own content templates"
  ON public.content_templates FOR ALL
  USING (auth.uid() = user_id OR public.is_admin_user(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Users manage own content library items" ON public.content_library_items;
CREATE POLICY "Users manage own content library items"
  ON public.content_library_items FOR ALL
  USING (auth.uid() = user_id OR public.is_admin_user(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_admin_user(auth.uid()));

-- -- Duplicate draft prevention ----------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_unique_draft_per_generation_account
  ON public.posts(
    user_id,
    generation_id,
    coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'draft' AND generation_id IS NOT NULL;

-- -- Auto-create drafts from completed generations ---------------------------
CREATE OR REPLACE FUNCTION public.ensure_draft_post_for_generation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.posts p
    WHERE p.user_id = NEW.user_id
      AND p.generation_id = NEW.id
      AND p.status = 'draft'
  ) THEN
    INSERT INTO public.posts (
      user_id,
      generation_id,
      account_id,
      caption,
      scheduled_at,
      status,
      created_at
    )
    VALUES (
      NEW.user_id,
      NEW.id,
      NULL,
      coalesce(NEW.prompt, ''),
      NULL,
      'draft',
      coalesce(NEW.created_at, now())
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS generations_to_draft_post_insert ON public.generations;
CREATE TRIGGER generations_to_draft_post_insert
  AFTER INSERT ON public.generations
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_draft_post_for_generation();

DROP TRIGGER IF EXISTS generations_to_draft_post_update ON public.generations;
CREATE TRIGGER generations_to_draft_post_update
  AFTER UPDATE OF status ON public.generations
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.ensure_draft_post_for_generation();

-- -- Backfill completed generations without posts ----------------------------
INSERT INTO public.posts (
  user_id,
  generation_id,
  account_id,
  caption,
  scheduled_at,
  status,
  created_at
)
SELECT
  g.user_id,
  g.id,
  NULL,
  coalesce(g.prompt, ''),
  NULL,
  'draft',
  coalesce(g.created_at, now())
FROM public.generations g
WHERE g.status = 'completed'
  AND g.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.posts p
    WHERE p.user_id = g.user_id
      AND p.generation_id = g.id
  );

-- Ensure library item mapping exists after backfill.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'content_library_items'
  ) THEN
    INSERT INTO public.content_library_items (user_id, post_id, item_type, created_at)
    SELECT p.user_id, p.id, 'post', coalesce(p.created_at, now())
    FROM public.posts p
    LEFT JOIN public.content_library_items li ON li.post_id = p.id
    WHERE p.generation_id IS NOT NULL
      AND li.id IS NULL;
  END IF;
END
$$;
