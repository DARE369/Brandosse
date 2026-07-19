-- ============================================================================
-- Migration: week3_background_jobs
-- Purpose (Week 3 Fix 3 — see audit-brief/FIXLOG.md "WEEK 3"):
--   General-purpose server-side job table backing true async video
--   generation. Scoped to VIDEO ONLY in this batch — Phase 0.3 confirmed a
--   real, working scheduled-post promoter already exists
--   (process_scheduled_posts/dispatch_scheduled_post, pg_cron+pg_net,
--   idempotent via a status-guarded claim). Building a second
--   'scheduled_publish' job type here would duplicate that working
--   mechanism and reintroduce the exact "two writers per invariant"
--   anti-pattern this batch exists to eliminate elsewhere — so job_type is
--   deliberately left open (text, not an enum) for future job kinds without
--   requiring this table to already anticipate scheduled_publish.
--
-- Rollback: DROP TABLE IF EXISTS public.background_jobs CASCADE;
--   (cascades the trigger below; RLS policies drop with the table)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.background_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id   uuid,
  brand_project_id  uuid,
  job_type          text NOT NULL,
  status            text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  result            jsonb,
  error             text,
  request_id        text,
  attempts          integer NOT NULL DEFAULT 0,
  run_after         timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One job per (job_type, request_id) — a resubmitted client request (e.g.
-- double-invoke of the video submit action) finds its existing job instead
-- of creating a second one. Partial so job types/requests that don't pass a
-- request_id are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_background_jobs_request_idempotency
  ON public.background_jobs(job_type, request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_background_jobs_status_run_after
  ON public.background_jobs(status, run_after);

CREATE INDEX IF NOT EXISTS idx_background_jobs_user_type_created
  ON public.background_jobs(user_id, job_type, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_background_jobs_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS background_jobs_touch_updated_at ON public.background_jobs;
CREATE TRIGGER background_jobs_touch_updated_at
  BEFORE UPDATE ON public.background_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_background_jobs_updated_at();

ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;

-- Owner read-only. All writes go through SECURITY DEFINER functions /
-- service-role edge functions (job-webhook, process-jobs, generateVideo) —
-- there is no direct-write policy for `authenticated`, matching the
-- rate_limit_events pattern from Week 2 Fix 5 (RLS-enabled-with-no-write-
-- policy denies every non-owner/non-service-role write by construction).
DROP POLICY IF EXISTS "Users or admins read own background jobs" ON public.background_jobs;
CREATE POLICY "Users or admins read own background jobs"
  ON public.background_jobs FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.is_admin_user(auth.uid())
    OR (organization_id IS NOT NULL AND public.org_current_user_has_brand_access(organization_id, brand_project_id))
  );

-- ── Realtime: private per-user broadcast, same pattern as Week 2 Fix 1's
-- session-scoped generation broadcasts, so the client's job drawer updates
-- live without a second postgres_changes-on-a-whole-table exposure. ────────
CREATE OR REPLACE FUNCTION public.broadcast_background_job_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM realtime.broadcast_changes(
    'background-jobs-' || NEW.user_id::text,
    TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS background_jobs_broadcast ON public.background_jobs;
CREATE TRIGGER background_jobs_broadcast
  AFTER INSERT OR UPDATE ON public.background_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_background_job_change();

-- realtime.messages already has RLS enabled by default (see Week 2 Fix 1's
-- migration for the defensive ALTER TABLE — not repeated here, same table).
DROP POLICY IF EXISTS background_jobs_broadcast_subscribe_access ON realtime.messages;
CREATE POLICY background_jobs_broadcast_subscribe_access
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    topic = 'background-jobs-' || auth.uid()::text
    OR public.is_admin_user(auth.uid())
  );
