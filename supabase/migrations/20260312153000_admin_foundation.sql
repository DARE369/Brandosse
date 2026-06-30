-- ============================================================================
-- Migration: admin_foundation
-- Date: 2026-03-12
-- Purpose:
--   1) Introduce organization + admin RBAC tables
--   2) Add admin governance, audit, complaints, quality, and versioning tables
--   3) Extend core profile/post schemas for scoped admin operations
--   4) Align helper functions and RLS with super_admin vs org_admin scope
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -- Shared helpers -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs rows are immutable';
END;
$$;

-- -- New admin / governance tables -------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  plan text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'pending_deletion', 'deleted')),
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('org_admin', 'member')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'removed')),
  invited_by uuid REFERENCES auth.users(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  role text NOT NULL CHECK (role IN ('super_admin', 'org_admin')),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  granted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_admin_id uuid NOT NULL REFERENCES auth.users(id),
  event_type text NOT NULL
    CHECK (event_type IN (
      'suspended', 'unsuspended',
      'login_suspended', 'publishing_suspended', 'generation_suspended',
      'restriction_lifted', 'deletion_requested', 'deletion_approved',
      'deletion_cancelled', 'deleted'
    )),
  reason_code text,
  note text,
  suspension_type text CHECK (suspension_type IN ('login', 'publishing', 'generation', 'full')),
  duration_hours integer,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  submitted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  linked_generation_id uuid REFERENCES public.generations(id) ON DELETE SET NULL,
  complaint_type text NOT NULL CHECK (complaint_type IN (
    'account_issue', 'publishing_issue', 'credits_issue',
    'content_quality', 'brand_mismatch', 'abuse_report', 'connection_issue', 'other'
  )),
  subject text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'triaged', 'in_progress', 'waiting_on_user',
    'escalated', 'resolved', 'closed'
  )),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  assigned_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_note text,
  sla_due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.complaint_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id),
  author_type text NOT NULL CHECK (author_type IN ('user', 'admin')),
  body text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.content_quality_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL REFERENCES public.generations(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  triggered_by text NOT NULL CHECK (triggered_by IN ('auto', 'admin')),
  triggered_by_admin_id uuid REFERENCES auth.users(id),
  score_prompt_adherence numeric(3, 1),
  score_brand_alignment numeric(3, 1),
  score_visual_quality numeric(3, 1),
  score_caption_relevance numeric(3, 1),
  score_platform_fit numeric(3, 1),
  score_hashtag_quality numeric(3, 1),
  score_publish_readiness numeric(3, 1),
  overall_score numeric(5, 1),
  confidence_level text CHECK (confidence_level IN ('low', 'medium', 'high')),
  recommended_action text CHECK (recommended_action IN (
    'ready', 'minor_review', 'needs_revision', 'regenerate_recommended'
  )),
  score_explanation jsonb,
  risk_flags jsonb,
  suggested_rewrite_instructions text,
  suggested_regen_direction text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.content_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL REFERENCES public.generations(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  version_number integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT false,
  is_original boolean NOT NULL DEFAULT false,
  created_by_admin_id uuid REFERENCES auth.users(id),
  prompt text,
  caption text,
  hashtags jsonb,
  storage_path text,
  media_url text,
  platform_target text,
  brand_context_snapshot jsonb,
  quality_review_id uuid REFERENCES public.content_quality_reviews(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by_admin_id uuid NOT NULL REFERENCES auth.users(id),
  approved_by_admin_id uuid REFERENCES auth.users(id),
  action_type text NOT NULL CHECK (action_type IN (
    'user_deletion', 'content_deletion', 'org_suspension',
    'bulk_content_removal', 'force_publish', 'platform_disconnect'
  )),
  target_user_id uuid REFERENCES auth.users(id),
  target_post_id uuid REFERENCES public.posts(id),
  target_org_id uuid REFERENCES public.organizations(id),
  reason_code text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'executed')),
  eligibility_checks_passed boolean,
  eligibility_check_details jsonb,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_type text CHECK (actor_type IN ('user', 'admin', 'system')),
  actor_role text,
  organization_id uuid,
  event_category text NOT NULL CHECK (event_category IN (
    'authentication', 'user_action', 'admin_action',
    'content_pipeline', 'scheduling_publishing', 'ai_generation',
    'platform_sync', 'credit_transaction', 'security', 'error'
  )),
  event_type text NOT NULL,
  entity_type text,
  entity_id text,
  summary text NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  metadata jsonb,
  risk_level text CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  correlation_id uuid,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (notification_type IN (
    'complaint_assigned', 'publish_failure', 'flagged_content',
    'low_quality_generation', 'password_reset_completed', 'suspension_expiring',
    'platform_connection_broken', 'deletion_request_pending', 'approval_required'
  )),
  title text NOT NULL,
  body text,
  entity_type text,
  entity_id text,
  is_read boolean NOT NULL DEFAULT false,
  snoozed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- -- Indexes ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_organizations_status ON public.organizations(status);
CREATE INDEX IF NOT EXISTS idx_organization_members_org_user ON public.organization_members(organization_id, user_id);
CREATE INDEX IF NOT EXISTS idx_admin_roles_org_role ON public.admin_roles(organization_id, role);
CREATE INDEX IF NOT EXISTS idx_user_status_events_user_created ON public.user_status_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_org_status ON public.complaints(organization_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_complaints_assigned ON public.complaints(assigned_admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_complaint_comments_complaint ON public.complaint_comments(complaint_id, created_at);
CREATE INDEX IF NOT EXISTS idx_quality_reviews_generation_created ON public.content_quality_reviews(generation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_versions_post_version ON public.content_versions(post_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_admin_action_requests_status ON public.admin_action_requests(status, action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_category_created ON public.audit_logs(event_category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation ON public.audit_logs(correlation_id);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_recipient_read ON public.admin_notifications(recipient_admin_id, is_read, created_at DESC);

-- -- Existing table extensions ------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz,
  ADD COLUMN IF NOT EXISTS activity_status text NOT NULL DEFAULT 'active'
    CHECK (activity_status IN (
      'highly_active', 'active', 'dormant', 'inactive',
      'suspended', 'pending_deletion', 'deleted'
    )),
  ADD COLUMN IF NOT EXISTS suspension_type text
    CHECK (suspension_type IN ('login', 'publishing', 'generation', 'full')),
  ADD COLUMN IF NOT EXISTS suspension_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_eligible_at timestamptz;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'none'
    CHECK (moderation_status IN (
      'none', 'flagged', 'under_review', 'approved',
      'archived', 'pending_deletion', 'deleted'
    )),
  ADD COLUMN IF NOT EXISTS flagged_by_admin_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS force_published_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS delete_reason text,
  ADD COLUMN IF NOT EXISTS quality_review_id uuid REFERENCES public.content_quality_reviews(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_organization_activity ON public.profiles(organization_id, activity_status);
CREATE INDEX IF NOT EXISTS idx_posts_moderation_status ON public.posts(moderation_status, status);
CREATE INDEX IF NOT EXISTS idx_posts_quality_review_id ON public.posts(quality_review_id);

-- Backfill admin roles from legacy profile.role admin markers for compatibility.
INSERT INTO public.admin_roles (user_id, role, organization_id)
SELECT
  p.id,
  CASE
    WHEN lower(coalesce(p.role, '')) = 'org_admin' THEN 'org_admin'
    ELSE 'super_admin'
  END,
  p.organization_id
FROM public.profiles p
INNER JOIN auth.users u
  ON u.id = p.id
WHERE lower(coalesce(p.role, '')) IN ('admin', 'super_admin', 'org_admin')
ON CONFLICT (user_id) DO UPDATE
SET
  role = EXCLUDED.role,
  organization_id = COALESCE(public.admin_roles.organization_id, EXCLUDED.organization_id);

-- -- Admin scope helpers ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_role(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT ar.role
     FROM public.admin_roles ar
     WHERE ar.user_id = p_user_id
     LIMIT 1),
    (SELECT CASE
      WHEN lower(coalesce(p.role, '')) = 'org_admin' THEN 'org_admin'
      WHEN lower(coalesce(p.role, '')) IN ('admin', 'super_admin') THEN 'super_admin'
      ELSE NULL
    END
     FROM public.profiles p
     WHERE p.id = p_user_id
     LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.get_admin_organization_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT ar.organization_id
     FROM public.admin_roles ar
     WHERE ar.user_id = p_user_id
     LIMIT 1),
    (SELECT p.organization_id
     FROM public.profiles p
     WHERE p.id = p_user_id
     LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_admin_role(p_user_id) = 'super_admin';
$$;

CREATE OR REPLACE FUNCTION public.is_admin_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_admin_role(p_user_id) IN ('super_admin', 'org_admin');
$$;

CREATE OR REPLACE FUNCTION public.can_admin_access_organization(p_admin_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_admin_id IS NULL THEN false
    WHEN public.is_super_admin_user(p_admin_id) THEN true
    WHEN public.get_admin_role(p_admin_id) = 'org_admin'
      THEN p_org_id IS NOT NULL AND public.get_admin_organization_id(p_admin_id) = p_org_id
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_admin_access_user(p_admin_id uuid, p_target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_admin_id IS NULL OR p_target_user_id IS NULL THEN false
    WHEN public.is_super_admin_user(p_admin_id) THEN true
    WHEN public.get_admin_role(p_admin_id) = 'org_admin'
      THEN EXISTS (
        SELECT 1
        FROM public.profiles target_profile
        WHERE target_profile.id = p_target_user_id
          AND target_profile.organization_id = public.get_admin_organization_id(p_admin_id)
      )
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_organization_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_super_admin_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_admin_access_organization(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_admin_access_user(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_admin_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_organization_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_admin_access_organization(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_admin_access_user(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.write_audit_log(
  p_actor_id uuid,
  p_actor_type text,
  p_actor_role text,
  p_organization_id uuid,
  p_event_category text,
  p_event_type text,
  p_entity_type text,
  p_entity_id text,
  p_summary text,
  p_previous_value jsonb DEFAULT NULL,
  p_new_value jsonb DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL,
  p_risk_level text DEFAULT 'low',
  p_correlation_id uuid DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_id uuid;
BEGIN
  INSERT INTO public.audit_logs (
    actor_id,
    actor_type,
    actor_role,
    organization_id,
    event_category,
    event_type,
    entity_type,
    entity_id,
    summary,
    previous_value,
    new_value,
    metadata,
    risk_level,
    correlation_id,
    ip_address,
    user_agent
  )
  VALUES (
    p_actor_id,
    p_actor_type,
    p_actor_role,
    p_organization_id,
    p_event_category,
    p_event_type,
    p_entity_type,
    p_entity_id,
    p_summary,
    p_previous_value,
    p_new_value,
    p_metadata,
    p_risk_level,
    COALESCE(p_correlation_id, gen_random_uuid()),
    p_ip_address,
    p_user_agent
  )
  RETURNING id INTO inserted_id;

  RETURN inserted_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.write_audit_log(
  uuid, text, text, uuid, text, text, text, text, text, jsonb, jsonb, jsonb, text, uuid, text, text
) TO authenticated;

-- -- Activity helpers ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_profile_last_active()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    UPDATE public.profiles
    SET last_active_at = COALESCE(NEW.created_at, now())
    WHERE id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_profile_activity_statuses()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer := 0;
BEGIN
  UPDATE public.profiles
  SET activity_status = CASE
    WHEN deletion_requested_at IS NOT NULL THEN 'pending_deletion'
    WHEN suspension_type IS NOT NULL
      AND (suspension_expires_at IS NULL OR suspension_expires_at > now()) THEN 'suspended'
    WHEN coalesce(last_active_at, created_at) >= now() - interval '3 days' THEN 'highly_active'
    WHEN coalesce(last_active_at, created_at) >= now() - interval '15 days' THEN 'active'
    WHEN coalesce(last_active_at, created_at) >= now() - interval '30 days' THEN 'dormant'
    ELSE 'inactive'
  END;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_profile_activity_statuses() TO authenticated;

DROP TRIGGER IF EXISTS touch_last_active_from_generation_insert ON public.generations;
CREATE TRIGGER touch_last_active_from_generation_insert
  AFTER INSERT ON public.generations
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_profile_last_active();

DROP TRIGGER IF EXISTS touch_last_active_from_post_insert ON public.posts;
CREATE TRIGGER touch_last_active_from_post_insert
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_profile_last_active();

-- -- Updated-at triggers ------------------------------------------------------
DROP TRIGGER IF EXISTS set_organizations_updated_at ON public.organizations;
CREATE TRIGGER set_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_complaints_updated_at ON public.complaints;
CREATE TRIGGER set_complaints_updated_at
  BEFORE UPDATE ON public.complaints
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_admin_action_requests_updated_at ON public.admin_action_requests;
CREATE TRIGGER set_admin_action_requests_updated_at
  BEFORE UPDATE ON public.admin_action_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS prevent_audit_log_update ON public.audit_logs;
CREATE TRIGGER prevent_audit_log_update
  BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_audit_log_mutation();

DROP TRIGGER IF EXISTS prevent_audit_log_delete ON public.audit_logs;
CREATE TRIGGER prevent_audit_log_delete
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_audit_log_mutation();

-- -- RLS alignment ------------------------------------------------------------
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_quality_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_action_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own profile or scoped admins" ON public.profiles;
CREATE POLICY "Users read own profile or scoped admins"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id OR public.can_admin_access_user(auth.uid(), id));

DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Scoped admins update profiles" ON public.profiles;
CREATE POLICY "Scoped admins update profiles"
  ON public.profiles FOR UPDATE
  USING (public.can_admin_access_user(auth.uid(), id))
  WITH CHECK (public.can_admin_access_user(auth.uid(), id));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'connected_accounts'
  ) THEN
    EXECUTE 'ALTER TABLE public.connected_accounts ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Users or scoped admins manage own connected accounts" ON public.connected_accounts';
    EXECUTE $policy$
      CREATE POLICY "Users or scoped admins manage own connected accounts"
      ON public.connected_accounts FOR ALL
      USING (auth.uid() = user_id OR public.can_admin_access_user(auth.uid(), user_id))
      WITH CHECK (auth.uid() = user_id OR public.can_admin_access_user(auth.uid(), user_id))
    $policy$;
  END IF;
END
$$;

DO $$
DECLARE
  scoped_table text;
BEGIN
  FOREACH scoped_table IN ARRAY ARRAY[
    'sessions',
    'generations',
    'posts',
    'content_plans',
    'media_assets',
    'content_templates',
    'content_library_items'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = scoped_table
        AND column_name = 'user_id'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', scoped_table);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Users or admins manage own ' || scoped_table, scoped_table);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Users or scoped admins manage own ' || scoped_table, scoped_table);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL USING (auth.uid() = user_id OR public.can_admin_access_user(auth.uid(), user_id)) WITH CHECK (auth.uid() = user_id OR public.can_admin_access_user(auth.uid(), user_id))',
        'Users or scoped admins manage own ' || scoped_table,
        scoped_table
      );
    END IF;
  END LOOP;
END
$$;

DROP POLICY IF EXISTS "Admins read accessible organizations" ON public.organizations;
CREATE POLICY "Admins read accessible organizations"
  ON public.organizations FOR SELECT
  USING (public.can_admin_access_organization(auth.uid(), id));

DROP POLICY IF EXISTS "Super admins manage organizations" ON public.organizations;
CREATE POLICY "Super admins manage organizations"
  ON public.organizations FOR ALL
  USING (public.is_super_admin_user(auth.uid()))
  WITH CHECK (public.is_super_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Org admins update own organization" ON public.organizations;
CREATE POLICY "Org admins update own organization"
  ON public.organizations FOR UPDATE
  USING (
    public.get_admin_role(auth.uid()) = 'org_admin'
    AND public.can_admin_access_organization(auth.uid(), id)
  )
  WITH CHECK (
    public.get_admin_role(auth.uid()) = 'org_admin'
    AND public.can_admin_access_organization(auth.uid(), id)
  );

DROP POLICY IF EXISTS "Org members read own membership" ON public.organization_members;
CREATE POLICY "Org members read own membership"
  ON public.organization_members FOR SELECT
  USING (user_id = auth.uid() OR public.can_admin_access_organization(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Scoped admins manage members" ON public.organization_members;
CREATE POLICY "Scoped admins manage members"
  ON public.organization_members FOR ALL
  USING (public.can_admin_access_organization(auth.uid(), organization_id))
  WITH CHECK (public.can_admin_access_organization(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Admins read own role row" ON public.admin_roles;
CREATE POLICY "Admins read own role row"
  ON public.admin_roles FOR SELECT
  USING (user_id = auth.uid() OR public.is_super_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Super admins manage admin roles" ON public.admin_roles;
CREATE POLICY "Super admins manage admin roles"
  ON public.admin_roles FOR ALL
  USING (public.is_super_admin_user(auth.uid()))
  WITH CHECK (public.is_super_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Users read own complaints and admins read scoped complaints" ON public.complaints;
CREATE POLICY "Users read own complaints and admins read scoped complaints"
  ON public.complaints FOR SELECT
  USING (
    submitted_by_user_id = auth.uid()
    OR created_by_admin_id = auth.uid()
    OR assigned_admin_id = auth.uid()
    OR public.can_admin_access_organization(auth.uid(), organization_id)
    OR public.can_admin_access_user(auth.uid(), submitted_by_user_id)
  );

DROP POLICY IF EXISTS "Users create own complaints and admins create scoped complaints" ON public.complaints;
CREATE POLICY "Users create own complaints and admins create scoped complaints"
  ON public.complaints FOR INSERT
  WITH CHECK (
    submitted_by_user_id = auth.uid()
    OR created_by_admin_id = auth.uid()
    OR public.can_admin_access_organization(auth.uid(), organization_id)
    OR public.can_admin_access_user(auth.uid(), submitted_by_user_id)
  );

DROP POLICY IF EXISTS "Admins update scoped complaints" ON public.complaints;
CREATE POLICY "Admins update scoped complaints"
  ON public.complaints FOR UPDATE
  USING (
    public.can_admin_access_organization(auth.uid(), organization_id)
    OR public.can_admin_access_user(auth.uid(), submitted_by_user_id)
  )
  WITH CHECK (
    public.can_admin_access_organization(auth.uid(), organization_id)
    OR public.can_admin_access_user(auth.uid(), submitted_by_user_id)
  );

DROP POLICY IF EXISTS "Users read own complaint comments and admins read scoped" ON public.complaint_comments;
CREATE POLICY "Users read own complaint comments and admins read scoped"
  ON public.complaint_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.complaints c
      WHERE c.id = complaint_id
        AND (
          c.submitted_by_user_id = auth.uid()
          OR public.can_admin_access_organization(auth.uid(), c.organization_id)
          OR public.can_admin_access_user(auth.uid(), c.submitted_by_user_id)
        )
    )
  );

DROP POLICY IF EXISTS "Users create own complaint comments and admins create scoped" ON public.complaint_comments;
CREATE POLICY "Users create own complaint comments and admins create scoped"
  ON public.complaint_comments FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND (
      (author_type = 'user' AND is_internal = false)
      OR (author_type = 'admin' AND public.is_admin_user(auth.uid()))
    )
    AND EXISTS (
      SELECT 1
      FROM public.complaints c
      WHERE c.id = complaint_id
        AND (
          c.submitted_by_user_id = auth.uid()
          OR public.can_admin_access_organization(auth.uid(), c.organization_id)
          OR public.can_admin_access_user(auth.uid(), c.submitted_by_user_id)
        )
    )
  );

DROP POLICY IF EXISTS "Users and scoped admins read status events" ON public.user_status_events;
CREATE POLICY "Users and scoped admins read status events"
  ON public.user_status_events FOR SELECT
  USING (user_id = auth.uid() OR public.can_admin_access_user(auth.uid(), user_id));

DROP POLICY IF EXISTS "Scoped admins create status events" ON public.user_status_events;
CREATE POLICY "Scoped admins create status events"
  ON public.user_status_events FOR INSERT
  WITH CHECK (
    actor_admin_id = auth.uid()
    AND public.can_admin_access_user(auth.uid(), user_id)
  );

DROP POLICY IF EXISTS "Users and scoped admins read quality reviews" ON public.content_quality_reviews;
CREATE POLICY "Users and scoped admins read quality reviews"
  ON public.content_quality_reviews FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.generations g
      WHERE g.id = generation_id
        AND (g.user_id = auth.uid() OR public.can_admin_access_user(auth.uid(), g.user_id))
    )
  );

DROP POLICY IF EXISTS "Scoped admins manage quality reviews" ON public.content_quality_reviews;
CREATE POLICY "Scoped admins manage quality reviews"
  ON public.content_quality_reviews FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.generations g
      WHERE g.id = generation_id
        AND public.can_admin_access_user(auth.uid(), g.user_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.generations g
      WHERE g.id = generation_id
        AND public.can_admin_access_user(auth.uid(), g.user_id)
    )
  );

DROP POLICY IF EXISTS "Users and scoped admins read content versions" ON public.content_versions;
CREATE POLICY "Users and scoped admins read content versions"
  ON public.content_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.generations g
      WHERE g.id = generation_id
        AND (g.user_id = auth.uid() OR public.can_admin_access_user(auth.uid(), g.user_id))
    )
  );

DROP POLICY IF EXISTS "Scoped admins manage content versions" ON public.content_versions;
CREATE POLICY "Scoped admins manage content versions"
  ON public.content_versions FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.generations g
      WHERE g.id = generation_id
        AND public.can_admin_access_user(auth.uid(), g.user_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.generations g
      WHERE g.id = generation_id
        AND public.can_admin_access_user(auth.uid(), g.user_id)
    )
  );

DROP POLICY IF EXISTS "Scoped admins read action requests" ON public.admin_action_requests;
CREATE POLICY "Scoped admins read action requests"
  ON public.admin_action_requests FOR SELECT
  USING (
    requested_by_admin_id = auth.uid()
    OR approved_by_admin_id = auth.uid()
    OR public.is_super_admin_user(auth.uid())
    OR public.can_admin_access_organization(auth.uid(), target_org_id)
    OR public.can_admin_access_user(auth.uid(), target_user_id)
  );

DROP POLICY IF EXISTS "Scoped admins create action requests" ON public.admin_action_requests;
CREATE POLICY "Scoped admins create action requests"
  ON public.admin_action_requests FOR INSERT
  WITH CHECK (
    requested_by_admin_id = auth.uid()
    AND (
      public.is_super_admin_user(auth.uid())
      OR public.can_admin_access_organization(auth.uid(), target_org_id)
      OR public.can_admin_access_user(auth.uid(), target_user_id)
      OR EXISTS (
        SELECT 1
        FROM public.posts p
        WHERE p.id = target_post_id
          AND public.can_admin_access_user(auth.uid(), p.user_id)
      )
    )
  );

DROP POLICY IF EXISTS "Approvers update action requests" ON public.admin_action_requests;
CREATE POLICY "Approvers update action requests"
  ON public.admin_action_requests FOR UPDATE
  USING (
    public.is_super_admin_user(auth.uid())
    OR requested_by_admin_id = auth.uid()
  )
  WITH CHECK (
    public.is_super_admin_user(auth.uid())
    OR requested_by_admin_id = auth.uid()
  );

DROP POLICY IF EXISTS "Super admins read audit logs" ON public.audit_logs;
CREATE POLICY "Super admins read audit logs"
  ON public.audit_logs FOR SELECT
  USING (public.is_super_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Admins insert audit logs" ON public.audit_logs;
CREATE POLICY "Admins insert audit logs"
  ON public.audit_logs FOR INSERT
  WITH CHECK (
    public.is_admin_user(auth.uid())
    AND (
      actor_id = auth.uid()
      OR (actor_type = 'system' AND actor_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "Recipients read own notifications" ON public.admin_notifications;
CREATE POLICY "Recipients read own notifications"
  ON public.admin_notifications FOR SELECT
  USING (recipient_admin_id = auth.uid());

DROP POLICY IF EXISTS "Recipients update own notifications" ON public.admin_notifications;
CREATE POLICY "Recipients update own notifications"
  ON public.admin_notifications FOR UPDATE
  USING (recipient_admin_id = auth.uid())
  WITH CHECK (recipient_admin_id = auth.uid());

DROP POLICY IF EXISTS "Scoped admins create notifications" ON public.admin_notifications;
CREATE POLICY "Scoped admins create notifications"
  ON public.admin_notifications FOR INSERT
  WITH CHECK (public.is_admin_user(auth.uid()));

-- Bring profile activity bands in line immediately after migration.
SELECT public.refresh_profile_activity_statuses();
