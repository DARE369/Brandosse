-- ============================================================================
-- Migration: baseline_core_tables
-- Purpose:
--   `generations`, `posts`, `sessions`, `user_credits`, and `credit_transactions`
--   were created directly on the live database before this project's
--   migration history began — only incremental ALTER TABLE statements against
--   them are tracked. This migration is a documentation baseline: it records
--   the fullest column/constraint/trigger/RLS picture that can be
--   reconstructed today, so schema history stops depending on someone
--   manually diffing every ALTER TABLE statement across ~30 files.
--
-- HOW THIS WAS BUILT (read before applying):
--   Docker was not available for a `supabase db dump`, but the human
--   supplied a genuine live schema introspection (2026-07-10, post-Phase-2-
--   migration-apply) for every table in this project, which superseded and
--   corrected the static reconstruction below wherever they conflicted. Two
--   corrections of note: (1) `posts` does NOT have platform_post_id/
--   platform_post_url/failure_reason/consecutive_failure_count/
--   last_failure_at as the 20260601000000_scheduled_publish_worker.sql
--   migration's ADD COLUMN statements assumed — that migration apparently
--   never actually ran against the live DB; the real columns are
--   external_post_id/failed_at/error_message/engagement_data/
--   optimal_time_score/is_auto_scheduled instead. (2) `generations` was
--   missing enhanced_prompt/output_url/provider/provider_model/aspect_ratio
--   entirely — see 20260710100000_generations_provider_columns.sql, a real
--   (non-documentation) ALTER TABLE fixing this, since current production
--   code depends on those columns existing. Every statement below is marked
--   with its source:
--     [LIVE-CONFIRMED]   — directly verified against the live DB via the
--                          service-role key by an earlier session (see
--                          docs/calendar-library-rebuild/packet-2-personal-library/
--                          DECISIONS_LOG.md, 2026-06-25). Only `generations`
--                          has this, and only as of that date.
--     [ORIGINAL-SCHEMA]  — found in supabase/video-engine-stage-1-schema.sql,
--                          the actual original CREATE TABLE script for
--                          `user_credits`/`credit_transactions` (run by hand
--                          per that file's own header, never through the
--                          migrations table). Highest confidence source for
--                          those two tables — this is the real origin file,
--                          not a reconstruction.
--     [MIGRATION-TRACKED] — introduced by a specific ALTER TABLE/CREATE
--                          TRIGGER/CREATE POLICY in supabase/migrations/
--                          (cited inline).
--     [CODE-INFERRED]     — referenced by name in app code but not found in
--                          any migration or original schema file. This is
--                          exactly the undocumented drift this migration
--                          exists to surface.
--
--   CREATE TABLE IF NOT EXISTS is used throughout, so on the live database
--   (where these tables already exist) every CREATE TABLE block no-ops —
--   this migration does not retroactively add anything by itself. Several
--   real ambiguities were found while reconstructing this (overlapping RLS
--   policies never cleaned up, columns attested only once with no
--   corroborating code reference, a promised-but-never-created FK, two
--   independent signup triggers both seeding user_credits). These are called
--   out in comments rather than silently resolved — see the summary at the
--   bottom of this file.
--
-- NOT APPLIED: per instructions, this migration has not been run against
--   the live database. Review column-by-column before applying, especially
--   every block marked [CODE-INFERRED].
-- ============================================================================


-- ============================================================================
-- 1. generations
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.generations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),          -- [LIVE-CONFIRMED 2026-06-25]
  user_id               uuid REFERENCES auth.users(id) ON DELETE CASCADE,    -- [LIVE-CONFIRMED]
  message_id            uuid,                                               -- [LIVE-CONFIRMED] AMBIGUOUS: zero code references found anywhere in src/**, supabase/functions/**. Type/purpose not independently confirmed — verify live before relying on it.
  session_id            uuid,                                               -- [LIVE-CONFIRMED] NOTE: no enforced FK to sessions(id) found anywhere (unlike content_plans.session_id, which does have one) — likely oversight, confirm live.
  prompt                text,                                               -- [LIVE-CONFIRMED]
  enhanced_prompt       text,                                               -- [FIXED 2026-07-10] confirmed MISSING from live DB despite being written by generateImage/generateVideo/editImage on every call — see 20260710100000_generations_provider_columns.sql (real ALTER TABLE, not documentation) which adds this and the four columns below
  media_type            text,                                               -- [MIGRATION-TRACKED 20260321113000_admin_moderation_schema_alignment.sql] (ADD COLUMN IF NOT EXISTS — may predate this migration)
  status                text,                                               -- [LIVE-CONFIRMED] AMBIGUOUS: no CHECK constraint found anywhere for this column, unlike posts.status which has one. Values in use: queued|processing|completed|failed (src/constants/statuses.js GENERATION_STATUS). Confirm whether the live column is actually unconstrained.
  progress              integer,                                            -- [LIVE-CONFIRMED]
  storage_path          text,                                               -- [MIGRATION-TRACKED 20260321113000] canonical media URL for both images and videos — confirmed by cross-reference against SessionStore.js/historyLoader.js (DECISIONS_LOG.md 2026-06-25T11:05), not a separate thumbnail field
  output_url            text,                                               -- [FIXED 2026-07-10] see enhanced_prompt note; current code sets this to the same value as storage_path on every call site — not currently used to hold a distinct URL
  provider              text,                                               -- [FIXED 2026-07-10] e.g. 'fal-ai'; see enhanced_prompt note
  provider_model        text,                                               -- [FIXED 2026-07-10] e.g. 'fal-ai/ideogram/v3'; see enhanced_prompt note
  aspect_ratio          text,                                               -- [FIXED 2026-07-10] see enhanced_prompt note
  cost                  numeric,                                            -- [LIVE-CONFIRMED] AMBIGUOUS: zero code references found; current edge functions record cost inside metadata->>'cost_usd' instead — possible parallel/abandoned convention, not resolved here
  metadata              jsonb DEFAULT '{}'::jsonb,                          -- [MIGRATION-TRACKED 20260321113000]
  parent_generation_id  uuid REFERENCES public.generations(id) ON DELETE SET NULL, -- [LIVE-CONFIRMED] AMBIGUOUS: zero code references found; FK direction/ON DELETE inferred by convention, not confirmed
  root_generation_id    uuid REFERENCES public.generations(id) ON DELETE SET NULL, -- [LIVE-CONFIRMED] AMBIGUOUS: same as parent_generation_id
  iteration_index       integer,                                            -- [LIVE-CONFIRMED] AMBIGUOUS: zero code references found
  batch_id              uuid,                                               -- [CODE-INFERRED] used by generationPipeline.js carousel orchestration; no ADD COLUMN found anywhere despite content_plans_batch_id_idx's own migration comment promising "batch_id FK to generations added AFTER generations columns are altered (step 4)" — that FK was never actually created in any tracked migration. Confirmed drift.
  batch_index           integer,                                            -- [CODE-INFERRED] used by generationPipeline.js; no ADD COLUMN found anywhere
  content_plan_id       uuid REFERENCES public.content_plans(id),           -- [MIGRATION-TRACKED 20260220041938_brand_kit.sql]
  carousel_slide_index  integer,                                            -- [MIGRATION-TRACKED 20260220041938_brand_kit.sql]
  carousel_slide_total  integer,                                            -- [MIGRATION-TRACKED 20260220041938_brand_kit.sql]
  slide_prompt          text,                                               -- [MIGRATION-TRACKED 20260220041938_brand_kit.sql]
  organization_id       uuid REFERENCES public.organizations(id) ON DELETE SET NULL, -- [MIGRATION-TRACKED 20260324150000_org_posts_generations_columns.sql]
  brand_project_id      uuid REFERENCES public.brand_projects(id) ON DELETE SET NULL, -- [MIGRATION-TRACKED 20260324150000]
  created_at            timestamptz NOT NULL DEFAULT now(),                 -- [LIVE-CONFIRMED]
  updated_at            timestamptz NOT NULL DEFAULT now()                  -- [LIVE-CONFIRMED] NOTE: no DB trigger maintains this column (unlike posts' enforce_post_lifecycle) — every app-code writer sets it manually. Confirm this is intentional.
);

CREATE INDEX IF NOT EXISTS generations_content_plan_id_idx ON public.generations(content_plan_id);
CREATE INDEX IF NOT EXISTS idx_generations_admin_user_created ON public.generations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generations_admin_status_created ON public.generations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generations_org ON public.generations(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_generations_project ON public.generations(brand_project_id) WHERE brand_project_id IS NOT NULL;

ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;

-- RLS AMBIGUITY, not resolved here: the migration trail shows three
-- permissive policies created over time and only some later dropped:
--   1. "Users or admins manage own generations" (20260227103000) — later dropped
--   2. "Users or scoped admins manage own generations" (20260312153000,
--      dynamically created via a FOREACH-scoped-table loop) — NEVER dropped
--      by any later migration found
--   3. org_workspace_member_read_generations, SELECT-only (20260324160000) — additive, not a replacement
--   4. workspace_scoped_generations_access (20260404120000, below) — the
--      newest/most complete policy, but its own DROP list does not name #2
-- Net effect: #2, #3, and #4 may all be simultaneously live today. This
-- migration only recreates #4 (the intended current policy) — confirm live
-- whether #2 still exists and should be explicitly dropped.
DROP POLICY IF EXISTS "Users or admins manage own generations" ON public.generations;
DROP POLICY IF EXISTS workspace_scoped_generations_access ON public.generations;
CREATE POLICY workspace_scoped_generations_access
  ON public.generations FOR ALL
  USING (
    (
      auth.uid() = user_id
      AND (organization_id IS NULL OR public.org_current_user_has_brand_access(organization_id, brand_project_id))
    )
    OR public.is_admin_user(auth.uid())
  )
  WITH CHECK (
    (
      auth.uid() = user_id
      AND (organization_id IS NULL OR public.org_current_user_has_brand_access(organization_id, brand_project_id))
    )
    OR public.is_admin_user(auth.uid())
  );
-- [MIGRATION-TRACKED 20260404120000_org_workflow_stabilization.sql]

DROP TRIGGER IF EXISTS generations_audit ON public.generations;
CREATE TRIGGER generations_audit
  AFTER UPDATE ON public.generations
  FOR EACH ROW
  EXECUTE FUNCTION public.log_generation_event();
-- [MIGRATION-TRACKED] created 001_audit_triggers.sql, function body replaced
-- (CREATE OR REPLACE, added actor_role/organization_id/metadata columns to
-- its audit_logs insert) by 20260321153000_admin_v4_notifications_notes_and_activity.sql

DROP TRIGGER IF EXISTS touch_last_active_from_generation_insert ON public.generations;
CREATE TRIGGER touch_last_active_from_generation_insert
  AFTER INSERT ON public.generations
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_profile_last_active();
-- [MIGRATION-TRACKED 20260312153000_admin_foundation.sql]

DROP TRIGGER IF EXISTS zz_sync_generation_org_scope_to_posts ON public.generations;
CREATE TRIGGER zz_sync_generation_org_scope_to_posts
  AFTER INSERT OR UPDATE OF organization_id, brand_project_id ON public.generations
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_generation_org_scope_to_posts();
-- [MIGRATION-TRACKED 20260324170000_org_helper_functions.sql]


-- ============================================================================
-- 2. posts
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.posts (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  generation_id              uuid REFERENCES public.generations(id) ON DELETE SET NULL, -- [CODE-INFERRED base column] required by ensure_draft_post_for_generation() trigger, 20260227103000
  account_id                 uuid REFERENCES public.connected_accounts(id) ON DELETE SET NULL, -- [MIGRATION-TRACKED 20260321113000] FK added NOT VALID then VALIDATEd; column itself pre-existing
  caption                    text,                                          -- [CODE-INFERRED base column]
  title                      text,                                          -- [MIGRATION-TRACKED 20260404120000_org_workflow_stabilization.sql]
  hashtags                   text[] DEFAULT '{}',                           -- [MIGRATION-TRACKED 20260227090000_calendar_library_alignment.sql]
  platform                   text,                                          -- [MIGRATION-TRACKED 20260227090000]
  scheduled_at               timestamptz,                                   -- [CODE-INFERRED base column]
  status                     text NOT NULL DEFAULT 'draft'                  -- [MIGRATION-TRACKED 20260302110000 + 20260622000003] 'archived' was removed then deliberately reintroduced (20260622000003's own header explains this)
    CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'archived')),
  is_locked                  boolean NOT NULL DEFAULT false,                -- [MIGRATION-TRACKED 20260227090000]
  content_pillar_id          uuid REFERENCES public.content_pillars(id) ON DELETE SET NULL, -- [MIGRATION-TRACKED 20260227090000] (conditional — only if content_pillars exists)
  moderation_status          text NOT NULL DEFAULT 'none'                   -- [MIGRATION-TRACKED 20260312153000_admin_foundation.sql]
    CHECK (moderation_status IN ('none', 'flagged', 'under_review', 'approved', 'archived', 'pending_deletion', 'deleted')),
  flagged_by_admin_id        uuid REFERENCES auth.users(id),                -- [MIGRATION-TRACKED 20260312153000]
  force_published_by         uuid REFERENCES auth.users(id),                -- [MIGRATION-TRACKED 20260312153000]
  assigned_moderator_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- [MIGRATION-TRACKED 20260330112000_posts_assigned_moderator.sql]
  delete_reason              text,                                         -- [MIGRATION-TRACKED 20260312153000]
  quality_review_id          uuid REFERENCES public.content_quality_reviews(id) ON DELETE SET NULL, -- [MIGRATION-TRACKED 20260312153000]
  organization_id            uuid REFERENCES public.organizations(id) ON DELETE SET NULL, -- [MIGRATION-TRACKED 20260324150000_org_posts_generations_columns.sql]
  brand_project_id           uuid REFERENCES public.brand_projects(id) ON DELETE SET NULL, -- [MIGRATION-TRACKED 20260324150000]
  pipeline_item_id           uuid REFERENCES public.pipeline_items(id) ON DELETE SET NULL, -- [MIGRATION-TRACKED 20260324150000]
  task_id                    uuid REFERENCES public.org_tasks(id) ON DELETE SET NULL, -- [MIGRATION-TRACKED 20260327030000_org_tasks_stage4.sql]
  seo_state                  jsonb NOT NULL DEFAULT '{}'::jsonb,            -- [MIGRATION-TRACKED 20260404120000]
  workflow_state             jsonb NOT NULL DEFAULT '{}'::jsonb,            -- [MIGRATION-TRACKED 20260404120000]
  published_at               timestamptz,                                  -- [LIVE-CONFIRMED 2026-07-10]
  failed_at                  timestamptz,                                  -- [LIVE-CONFIRMED 2026-07-10]
  error_message              text,                                         -- [LIVE-CONFIRMED 2026-07-10]
  external_post_id           text,                                         -- [LIVE-CONFIRMED 2026-07-10]
  engagement_data            jsonb,                                        -- [LIVE-CONFIRMED 2026-07-10]
  optimal_time_score         integer,                                      -- [LIVE-CONFIRMED 2026-07-10]
  is_auto_scheduled          boolean,                                      -- [LIVE-CONFIRMED 2026-07-10]
  archived_at                timestamptz,                                  -- [MIGRATION-TRACKED 20260622000003_post_archive_status.sql]
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),           -- [MIGRATION-TRACKED 20260227090000] auto-maintained by enforce_post_lifecycle trigger below
  deleted_at                 timestamptz                                   -- [MIGRATION-TRACKED 20260227090000]
);
-- CORRECTION 2026-07-10: platform_post_id/platform_post_url/failure_reason/
-- consecutive_failure_count/last_failure_at (all from
-- 20260601000000_scheduled_publish_worker.sql) do NOT exist on the live
-- table — that migration's ADD COLUMN statements apparently never actually
-- ran. The real publish-tracking columns are external_post_id/failed_at/
-- error_message/engagement_data/optimal_time_score/is_auto_scheduled above,
-- confirmed via live introspection. Whatever code path
-- 20260601000000_scheduled_publish_worker.sql was meant to support should be
-- re-checked against these real column names, not the ones it assumed.

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_unique_draft_per_generation_account
  ON public.posts(user_id, generation_id, coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'draft' AND generation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_user_status ON public.posts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_posts_user_scheduled ON public.posts(user_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_posts_user_platform ON public.posts(user_id, platform);
CREATE INDEX IF NOT EXISTS idx_posts_moderation_status ON public.posts(moderation_status, status);
CREATE INDEX IF NOT EXISTS idx_posts_quality_review_id ON public.posts(quality_review_id);
CREATE INDEX IF NOT EXISTS idx_posts_admin_user_created ON public.posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_admin_generation_created ON public.posts(generation_id, created_at DESC) WHERE generation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_admin_moderation_date ON public.posts(moderation_status, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_admin_scheduled_date ON public.posts(status, scheduled_at DESC) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_posts_org ON public.posts(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_project ON public.posts(brand_project_id) WHERE brand_project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_pipeline_item ON public.posts(pipeline_item_id) WHERE pipeline_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_task_unique ON public.posts(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_assigned_moderator_status_created ON public.posts(assigned_moderator_id, moderation_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_org_workflow_status ON public.posts(organization_id, brand_project_id, status, updated_at DESC) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_workflow_state_gin ON public.posts USING gin(workflow_state);
CREATE INDEX IF NOT EXISTS idx_posts_seo_state_gin ON public.posts USING gin(seo_state);
-- AMBIGUITY: idx_posts_admin_scheduled_date (above, 20260321113000) and
-- idx_posts_scheduled_due (below, 20260601000000) both index
-- (status, scheduled_at) filtered WHERE status='scheduled', created seven
-- weeks apart with neither migration dropping/superseding the other — likely
-- coexist live as functional duplicates. Kept both here to match actual
-- history; consider consolidating in a follow-up migration.
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_due ON public.posts(status, scheduled_at) WHERE status = 'scheduled';

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- RLS: "Users or scoped admins manage own posts" (20260312153000) was never
-- dropped by any later migration and is the current base ownership policy —
-- reproduced below under its original name. org_workspace_member_read_posts
-- (SELECT, 20260324160000) and org_workspace_member_schedule_posts (UPDATE,
-- 20260324200000) layer on top of it additively; both reproduced too.
DROP POLICY IF EXISTS "Users or admins manage own posts" ON public.posts;
DROP POLICY IF EXISTS "Users or scoped admins manage own posts" ON public.posts;
CREATE POLICY "Users or scoped admins manage own posts"
  ON public.posts FOR ALL
  USING (auth.uid() = user_id OR public.can_admin_access_user(auth.uid(), user_id))
  WITH CHECK (auth.uid() = user_id OR public.can_admin_access_user(auth.uid(), user_id));
-- [MIGRATION-TRACKED 20260312153000_admin_foundation.sql]

DROP POLICY IF EXISTS org_workspace_member_read_posts ON public.posts;
CREATE POLICY org_workspace_member_read_posts
  ON public.posts FOR SELECT
  USING (public.org_current_user_has_brand_access(organization_id, brand_project_id));
-- [MIGRATION-TRACKED 20260324160000_org_rls_policies.sql]

DROP POLICY IF EXISTS org_workspace_member_schedule_posts ON public.posts;
CREATE POLICY org_workspace_member_schedule_posts
  ON public.posts FOR UPDATE
  USING (
    organization_id IS NOT NULL
    AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_schedule')
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
    AND public.get_member_permission(organization_id, 'can_schedule')
  );
-- [MIGRATION-TRACKED 20260324200000_org_calendar_schedule_write_policy.sql]

DROP TRIGGER IF EXISTS posts_audit ON public.posts;
CREATE TRIGGER posts_audit
  AFTER INSERT OR UPDATE ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.log_post_event();
-- [MIGRATION-TRACKED] created 001_audit_triggers.sql, function replaced by 20260321153000

DROP TRIGGER IF EXISTS enforce_post_lifecycle ON public.posts;
CREATE TRIGGER enforce_post_lifecycle
  BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_terminal_posts();
-- [MIGRATION-TRACKED 20260227090000_calendar_library_alignment.sql] sets
-- is_locked := true when status is published/publishing; raises on illegal
-- transitions off a terminal status; always sets updated_at := now().

DROP TRIGGER IF EXISTS library_item_after_post_insert ON public.posts;
CREATE TRIGGER library_item_after_post_insert
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.create_library_item_from_post();
-- [MIGRATION-TRACKED 20260227090000]

DROP TRIGGER IF EXISTS touch_last_active_from_post_insert ON public.posts;
CREATE TRIGGER touch_last_active_from_post_insert
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_profile_last_active();
-- [MIGRATION-TRACKED 20260312153000]

DROP TRIGGER IF EXISTS set_posts_org_scope_from_generation ON public.posts;
CREATE TRIGGER set_posts_org_scope_from_generation
  BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_generation_org_scope_to_post();
-- [MIGRATION-TRACKED 20260324170000_org_helper_functions.sql]

DROP TRIGGER IF EXISTS sync_org_task_status_from_post ON public.posts;
CREATE TRIGGER sync_org_task_status_from_post
  AFTER INSERT OR UPDATE OF status, task_id ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_org_task_status_from_post();
-- [MIGRATION-TRACKED 20260327030000_org_tasks_stage4.sql]

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
-- [MIGRATION-TRACKED 20260227103000_generation_post_unification_and_rls.sql]
-- This pair is the entire "AI output becomes a draft post" hand-off — no
-- application code decides that a completed generation should become a post.


-- ============================================================================
-- 3. sessions
-- ============================================================================
-- Confirmed to be a custom app table (Studio session/prompt history), not
-- auth.sessions — 20260323103000_risk_cron_and_legacy_table_deprecation.sql
-- explicitly marks the legacy generation_sessions table as dormant, noting
-- "Active routed app uses public.sessions."
--
-- MAJOR FLAG (2026-07-10 live introspection): this Supabase project's
-- public.sessions table is SHARED with an entirely unrelated domain — the
-- live table also carries parent_id, child_id, tutor_name, subject,
-- session_date, duration_minutes, tutor_id, tutor_notes, ai_summary,
-- parent_rating, cancellation_reason, recording_url,
-- reminder_48h_sent_at/2h_sent_at, and more, none of which belong to this
-- product (the live DB also contains children/tutors/diagnostic_requests/
-- billing_records/progress_summaries tables — an apparent tutoring-platform
-- schema coexisting in the same public schema, likely the same Supabase
-- project hosting two unrelated products). This migration only documents
-- the columns this product's code actually uses; the tutoring-domain
-- columns are deliberately NOT listed here since they're out of scope, but
-- their existence on the same table is a real architectural risk (a
-- NOT NULL constraint or trigger added for one product's "sessions" concept
-- could break the other's inserts) — flagged for Phase 7, not resolved here.
CREATE TABLE IF NOT EXISTS public.sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users(id) ON DELETE CASCADE,       -- [CODE-INFERRED base column]
  title             text,                                                  -- [CODE-INFERRED base column]
  metadata          jsonb DEFAULT '{}'::jsonb,                              -- [CODE-INFERRED base column] holds e.g. draft_prompt; no migration found adding this
  workspace_type    text NOT NULL DEFAULT 'personal'                       -- [MIGRATION-TRACKED 20260404120000_org_workflow_stabilization.sql]
    CHECK (workspace_type IN ('personal', 'organization')),
  organization_id   uuid REFERENCES public.organizations(id) ON DELETE SET NULL, -- [MIGRATION-TRACKED 20260404120000]
  brand_project_id  uuid REFERENCES public.brand_projects(id) ON DELETE SET NULL, -- [MIGRATION-TRACKED 20260404120000]
  project_id        uuid REFERENCES public.studio_projects(id) ON DELETE SET NULL, -- [MIGRATION-TRACKED 20260621000000_studio_projects.sql]
  created_at        timestamptz NOT NULL DEFAULT now(),                    -- [CODE-INFERRED base column]
  updated_at        timestamptz NOT NULL DEFAULT now()                     -- [CODE-INFERRED base column] AMBIGUOUS: no DB trigger maintains this (unlike posts) — every writer sets it manually via SessionStore.js. Confirm this is intentional, not a missed trigger.
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_workspace_updated ON public.sessions(user_id, workspace_type, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_org_workspace_updated ON public.sessions(organization_id, brand_project_id, updated_at DESC) WHERE workspace_type = 'organization';
CREATE INDEX IF NOT EXISTS sessions_project_id_idx ON public.sessions(project_id);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- Same RLS-layering ambiguity as generations: "Users or scoped admins manage
-- own sessions" (20260312153000) is never dropped by 20260404120000's DROP
-- list (which only names the older "Users or admins..." policy and the
-- not-yet-existing workspace_scoped_sessions_access). Both may coexist live.
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
          workspace_type = 'organization' AND organization_id IS NOT NULL
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
          workspace_type = 'organization' AND organization_id IS NOT NULL
          AND public.org_current_user_has_brand_access(organization_id, brand_project_id)
        )
      )
    )
    OR public.is_admin_user(auth.uid())
  );
-- [MIGRATION-TRACKED 20260404120000_org_workflow_stabilization.sql]

-- No CREATE TRIGGER targets public.sessions in any migration found — updated_at
-- maintenance is entirely app-side, a real asymmetry vs. posts/generations.


-- ============================================================================
-- 4. user_credits
-- ============================================================================
-- [ORIGINAL-SCHEMA] Verbatim from supabase/video-engine-stage-1-schema.sql
-- (run by hand per that file's own header, never through the migrations
-- table). This is the actual origin file for this table, not a
-- reconstruction — highest-confidence section of this whole migration.
--
-- NOTE the id default uses uuid_generate_v4() (uuid-ossp extension), not
-- gen_random_uuid() (pgcrypto) like every other table in this codebase —
-- a real, pre-existing inconsistency, reproduced as-is rather than "fixed"
-- silently.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.user_credits (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  balance             integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_purchased  integer NOT NULL DEFAULT 0,
  lifetime_consumed   integer NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- No created_at column — confirmed intentional, not drift: src/lib/video-engine/types.ts's
-- UserCredits interface also omits it.

ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own credits" ON public.user_credits;
CREATE POLICY "Users can view own credits"
  ON public.user_credits FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users cannot modify credits directly" ON public.user_credits;
CREATE POLICY "Users cannot modify credits directly"
  ON public.user_credits FOR UPDATE
  USING (false);
-- No INSERT/DELETE policy exists for authenticated users either — direct
-- client writes are denied by default (RLS default-deny). All real writes
-- go through the deduct_credits/refund_credits SECURITY DEFINER RPCs
-- (supabase/migrations/20260622000001_deduct_credits_rpc.sql,
-- 20260706120000_credit_category_tracking.sql) or the two signup triggers below.

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_user_credits ON public.user_credits;
CREATE TRIGGER set_updated_at_user_credits
  BEFORE UPDATE ON public.user_credits
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user_credits()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_credits (user_id, balance)
  VALUES (NEW.id, 30)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_credits ON auth.users;
CREATE TRIGGER on_auth_user_created_credits
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_credits();
-- DUPLICATION FLAG: supabase/migrations/20260513160000_database_integrity_security_cleanup.sql's
-- handle_new_user_profile() (bound to the SAME auth.users AFTER INSERT event,
-- via trigger on_auth_user_created) ALSO inserts a balance=30 user_credits
-- row, guarded by its own WHERE NOT EXISTS check. Both triggers fire on every
-- signup; both are idempotent against each other via ON CONFLICT/WHERE NOT
-- EXISTS, so this is safe but duplicated business logic living in two
-- unrelated places. Not consolidated here — flagging for your awareness,
-- not silently merging the two.


-- ============================================================================
-- 5. credit_transactions
-- ============================================================================
-- [ORIGINAL-SCHEMA] Verbatim from supabase/video-engine-stage-1-schema.sql,
-- plus the category column added later. Cross-confirmed against
-- src/lib/video-engine/types.ts's CreditTransaction interface — exact match.
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id            uuid REFERENCES public.video_jobs(id) ON DELETE SET NULL, -- video-engine job this transaction paid for, if any (NULL for image/carousel/edit generations)
  amount            integer NOT NULL,                                        -- signed: negative for consumption, positive for purchase/refund
  balance_after     integer NOT NULL,
  transaction_type  text NOT NULL CHECK (transaction_type IN (
                      'purchase', 'consumption', 'refund', 'bonus', 'adjustment'
                    )),
  description       text,
  stripe_payment_id text,
  category          text                                                    -- [MIGRATION-TRACKED 20260706120000_credit_category_tracking.sql]
    CHECK (category IN ('image', 'video', 'carousel', 'edit', 'other')),
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- category is NULL for legacy rows recorded before 2026-07-06 and for
-- non-generation transactions (purchase/refund/bonus/adjustment without a
-- specific category) — per that migration's own COMMENT ON COLUMN.

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON public.credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON public.credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created ON public.credit_transactions(user_id, created_at DESC);

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own transactions" ON public.credit_transactions;
CREATE POLICY "Users can view own transactions"
  ON public.credit_transactions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users cannot insert transactions directly" ON public.credit_transactions;
CREATE POLICY "Users cannot insert transactions directly"
  ON public.credit_transactions FOR INSERT
  WITH CHECK (false);
-- No UPDATE/DELETE policy either — append-only ledger, default-deny for
-- both. All rows are inserted by deduct_credits/refund_credits (SECURITY
-- DEFINER RPCs), the Stripe webhook handler, or the Python video-worker.


-- ============================================================================
-- Summary of unresolved ambiguities found while reconstructing this baseline
-- (repeated here from inline comments so they're not missed):
--
-- 1. generations: message_id, cost, parent_generation_id, root_generation_id,
--    iteration_index are attested only by the 2026-06-25 live introspection
--    comment, with zero corroborating code references anywhere. Confirm
--    against the live DB before trusting types/defaults assumed above.
-- 2. generations.status has no CHECK constraint anywhere (posts.status does)
--    — confirm the live column is genuinely unconstrained.
-- 3. content_plans.batch_id -> generations FK was promised in a migration
--    comment but never actually created in any tracked migration.
-- 4. RLS layering on generations and sessions: 20260404120000 creates a new
--    workspace_scoped_*_access policy without dropping the older
--    "...scoped admins manage own *" policy from 20260312153000. Both may be
--    live simultaneously.
-- 5. Two near-duplicate scheduled-post partial indexes on posts
--    (idx_posts_admin_scheduled_date vs idx_posts_scheduled_due).
-- 6. user_credits/credit_transactions use uuid_generate_v4() (uuid-ossp)
--    while every other table uses gen_random_uuid() (pgcrypto).
-- 7. Two independent auth.users signup triggers both seed a user_credits
--    row with balance=30 (on_auth_user_created_credits here, and
--    handle_new_user_profile in 20260513160000) — safe (both idempotent)
--    but duplicated logic, not consolidated in this migration.
-- 8. generations.session_id has no enforced FK to sessions(id), unlike
--    content_plans.session_id which does.
-- 9. sessions has no updated_at-maintaining trigger at all, unlike posts.
-- ============================================================================
