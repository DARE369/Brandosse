-- ============================================================================
-- Migration: overdue_scheduled_posts_alarm
--
-- Phase 3's guard: every non-terminal state needs a reaper, and `scheduled` did
-- not have one.
--
-- ── What was already covered, and what was not ──────────────────────────────
--   * posts.status = 'publishing'  — reaped by reap_stuck_records()
--     (20260821160000), every 5 minutes. A row stranded mid-dispatch is failed.
--   * posts.status = 'scheduled' that can NEVER dispatch — no account_id and no
--     platform, or an account since revoked — is failed each minute by
--     process_scheduled_posts() itself (20260716140000).
--   * posts.status = 'scheduled' that CAN dispatch but simply never did — the
--     cron job stopped, the edge function 500s, the HTTP call times out — was
--     covered by NOTHING. The row sits in 'scheduled' with a past scheduled_at,
--     shows in the calendar as pending, and is never sent and never reported.
--     Indefinitely.
--
-- That last case is what this migration detects. It is the same shape as the
-- defects this repository keeps producing: working code that silently stopped,
-- with nothing watching.
--
-- ── Why this ALERTS and does not auto-fail ──────────────────────────────────
-- Deliberate, and the most important decision here.
--
-- The overwhelmingly likely cause of many posts going overdue at once is that
-- the DISPATCHER stopped — cron unscheduled, database paused, worker erroring.
-- In that world the posts are perfectly good and will send correctly the moment
-- the dispatcher returns. Auto-failing them would convert a recoverable outage
-- into permanent, silent content loss across every affected user at once, which
-- is exactly the harm Law 3 forbids. Marking someone's content failed is not a
-- safe default; it is the destructive one.
--
-- So this reports, and a human decides whether to retry or fail.
--
-- ── Why the alarm is a log line and not a notification row ──────────────────
-- Also deliberate. `admin_notifications` carries two overlapping column sets
-- after 20260330113000 canonicalised it mid-life (admin_id/type/read alongside
-- recipient_admin_id/notification_type/is_read), there is no admin_users table
-- to resolve recipients from, and this repo's live schema is known to have
-- drifted from its migrations. An INSERT written against a shape nobody can
-- verify from here would risk this function throwing on every five-minute run —
-- and a reaper that errors is worse than no reaper, because it looks installed.
-- RAISE WARNING has no schema dependency, cannot fail, and lands where an
-- operator actually looks. A notification row can be added later by someone who
-- has verified the live table.
-- ============================================================================

-- ── 1. How late is late ─────────────────────────────────────────────────────
--
-- The dispatcher runs every minute and caps at 50 posts per run, so a healthy
-- backlog can legitimately take a few minutes to drain. Fifteen minutes is well
-- clear of that — it would take a 750-post backlog to reach it honestly — while
-- still catching an outage inside one coffee break.
CREATE OR REPLACE FUNCTION public.overdue_scheduled_posts(grace_minutes int DEFAULT 15)
RETURNS TABLE (
  post_id      uuid,
  user_id      uuid,
  platform     text,
  scheduled_at timestamptz,
  minutes_late numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.user_id,
    p.platform,
    p.scheduled_at,
    round((extract(epoch FROM (now() - p.scheduled_at)) / 60.0)::numeric, 1)
  FROM public.posts p
  WHERE p.status = 'scheduled'
    AND p.scheduled_at IS NOT NULL
    AND p.scheduled_at <= now() - make_interval(mins => grace_minutes)
  ORDER BY p.scheduled_at ASC;
$$;

REVOKE ALL ON FUNCTION public.overdue_scheduled_posts(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.overdue_scheduled_posts(int) TO service_role;

COMMENT ON FUNCTION public.overdue_scheduled_posts(int) IS
  'Posts that are due, dispatchable, and still unsent past the grace period — '
  'the detector posts.status = ''scheduled'' never had. Reports only; see '
  'raise_overdue_scheduled_alarm() for why nothing here auto-fails.';

-- ── 2. The alarm ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.raise_overdue_scheduled_alarm(grace_minutes int DEFAULT 15)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  overdue_count int;
  oldest_late   numeric;
BEGIN
  SELECT count(*), coalesce(max(minutes_late), 0)
    INTO overdue_count, oldest_late
  FROM public.overdue_scheduled_posts(grace_minutes);

  IF overdue_count = 0 THEN
    RETURN 0;
  END IF;

  RAISE WARNING
    'overdue scheduled posts: % post(s) past due by up to % minute(s). The dispatcher (cron job process-scheduled-posts) may have stopped. Nothing has been auto-failed.',
    overdue_count, oldest_late;

  RETURN overdue_count;
END;
$$;

REVOKE ALL ON FUNCTION public.raise_overdue_scheduled_alarm(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.raise_overdue_scheduled_alarm(int) TO service_role;

COMMENT ON FUNCTION public.raise_overdue_scheduled_alarm(int) IS
  'Phase 3 reaper for posts.status = ''scheduled''. Runs every 5 minutes via '
  'pg_cron (job: alarm-overdue-scheduled-posts). ALERTS ONLY, deliberately: the '
  'likeliest cause of a mass overdue is a stopped dispatcher, and auto-failing '
  'would turn a recoverable outage into permanent content loss.';

-- ── 3. Schedule it ──────────────────────────────────────────────────────────
--
-- Idempotent: unschedule-then-schedule, so re-running this migration cannot
-- leave two jobs racing each other.
DO $$
BEGIN
  PERFORM cron.unschedule('alarm-overdue-scheduled-posts');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- not previously scheduled
END;
$$;

SELECT cron.schedule(
  'alarm-overdue-scheduled-posts',
  '*/5 * * * *',
  $$SELECT public.raise_overdue_scheduled_alarm();$$
);

-- ── 4. Post-condition ───────────────────────────────────────────────────────
--
-- Asserts the DETECTOR works, not that the system is currently clean. There may
-- legitimately be overdue posts right now — failing the migration for that would
-- be wrong, and would also make the migration un-rerunnable. What must hold is
-- that both functions execute, agree with each other, and that the job is
-- actually registered. A reaper that errors on its first run, or one that is
-- installed but never scheduled, is the stale guard this repo has been bitten by
-- before.
DO $$
DECLARE
  found_count int;
  alarm_count int;
  job_exists  boolean;
BEGIN
  SELECT count(*) INTO found_count FROM public.overdue_scheduled_posts(15);
  alarm_count := public.raise_overdue_scheduled_alarm(15);

  IF alarm_count <> found_count THEN
    RAISE EXCEPTION
      'post-condition failed: detector found % overdue post(s) but the alarm reported %',
      found_count, alarm_count;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'alarm-overdue-scheduled-posts'
  ) INTO job_exists;

  IF NOT job_exists THEN
    RAISE EXCEPTION
      'post-condition failed: cron job alarm-overdue-scheduled-posts is not registered, so the detector would never run';
  END IF;

  RAISE NOTICE
    'overdue-scheduled alarm installed and scheduled; % post(s) currently overdue', found_count;
END;
$$;
