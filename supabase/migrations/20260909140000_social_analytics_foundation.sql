-- 20260909140000_social_analytics_foundation.sql
--
-- The cross-platform analytics data model: YouTube, TikTok and LinkedIn on one
-- schema, designed before any of the three ingests a row.
--
-- ── Why the whole model lands at once ────────────────────────────────────────
-- Because a schema shaped around one platform gets rebuilt when the second
-- arrives, and this repository already has the scar. `platform_analytics`
-- exists LIVE (never migrated — it is part of the 89-vs-65 drift noted in
-- CLAUDE.md) with a shape of one flat lifetime row per post. That shape cannot
-- represent a time series, which is most of what YouTube gives and all of what
-- makes the data worth having.
--
-- It has three readers and zero writers:
--   * supabase/functions/daily-analysis/index.ts:155 — deployed, on cron
--   * src/services/OptimalTimesService.js:30         — the known dead module
--   * src/pages/AnalyticsPage/PersonalAnalyticsPage.jsx:143, whose own comment
--     says "platform_analytics has 0 rows and no code calls a platform
--     insights API"
--
-- So there is a live consumer waiting for rows nobody produces. This migration
-- does NOT touch that table: its live shape cannot be verified from the
-- migration history, and replacing a drifted table whose definition you cannot
-- read is how you lose data. Repointing daily-analysis at these tables, and
-- then dropping platform_analytics once confirmed empty, is a separate change
-- that ships WITH ingestion.
--
-- ── The one decision everything else follows from ────────────────────────────
-- Facts are split by SHAPE, not by platform:
--
--   social_post_metrics_daily     — additive, per calendar day.
--                                   YouTube's `day` dimension; LinkedIn DAILY.
--   social_post_metrics_snapshot  — cumulative lifetime totals, observed at a
--                                   moment. TikTok's counters; LinkedIn TOTAL.
--
-- These are deliberately two tables rather than one table with a `kind`
-- column. Summing daily values over a range is correct; summing lifetime
-- snapshots is meaningless and silently produces a number that looks
-- plausible. One table would put those two operations one WHERE clause apart
-- and invite the mistake in every query written from here on. Two tables make
-- the wrong query impossible to write by accident.
--
-- TikTok exposes no time series at all — only counters as they stand right
-- now. The only way to obtain a TikTok trend is to snapshot on a schedule and
-- difference it, which is why snapshots are a first-class shape and not a
-- degenerate case of daily.
--
-- ── Nothing may show fabricated data (CLAUDE.md, Law 3) ──────────────────────
-- Four rules, enforced structurally rather than by convention:
--
--   1. NULL IS NOT ZERO. There is no DEFAULT 0 on any value column. A row
--      exists only where a platform actually reported a number. "We have no
--      observation" is the ABSENCE of a row; "the platform reported zero" is a
--      row with value 0. Defaulting would erase that distinction permanently,
--      and a chart cannot tell you which one it is drawing.
--   2. Every fact row carries ingestion_run_id NOT NULL. A number with no
--      provenance is indistinguishable from a number somebody made up. This
--      also makes a bad run revocable: delete the run, delete its rows.
--   3. Every daily row carries reporting_timezone NOT NULL. YouTube aggregates
--      days in Pacific time; other platforms use their own boundary. Storing
--      "2026-09-09" without recording whose day that was is a silent multi-hour
--      error — and daily-analysis/index.ts:219 already has exactly that bug in
--      its `new Date(scheduled_at).getHours()` (UTC in Deno), which is why this
--      is a column and not a comment.
--   4. Metric availability is DATA, in social_metric_platform_support. TikTok
--      does not report impressions. Without a table saying so, a UI renders 0
--      and the user reads it as "no impressions" rather than "not measurable".
--      That is fabrication by omission, and it is the exact defect class that
--      produced five months of invented trend data.
--
-- ── Deletion obligations are satisfied structurally ──────────────────────────
-- Every fact table cascades from connected_accounts. Disconnect is a HARD
-- delete of that row (app/api/auth/social/[provider]/disconnect/route.js:170,
-- written that way for LinkedIn API Terms §4.4 "immediately delete all Content
-- collected"). So revoking an account deletes its analytics with no extra code
-- and no chance of an orphan surviving the obligation.
--
-- Raw payloads carry an explicit expires_at and are reaped, because YouTube's
-- API Terms cap retention of API data at 30 days.
--
-- VERIFY:
--   SELECT metric_key, platform, granularity, platform_metric_name
--   FROM public.social_metric_platform_support ORDER BY platform, metric_key;
--
--   -- must be zero: a fact row whose tenancy disagrees with its account
--   SELECT count(*) FROM public.social_post_metrics_daily d
--   JOIN public.connected_accounts ca ON ca.id = d.connected_account_id
--   WHERE d.user_id IS DISTINCT FROM ca.user_id;
--
-- SAFE TO RE-RUN: yes.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The metric vocabulary
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Same pattern as publish_providers (20260904140000), for the same reason:
-- adding a platform must be an INSERT, not a schema change, and the answer to
-- "does this platform measure this?" must live in one queryable place instead
-- of being re-derived in every consumer.

CREATE TABLE IF NOT EXISTS public.social_metric_definitions (
  metric_key    text PRIMARY KEY,
  display_name  text NOT NULL,
  -- 'count'   — whole things: views, likes
  -- 'seconds' — durations
  -- 'ratio'   — 0..1
  -- 'percent' — 0..100, kept distinct from ratio because platforms disagree
  --             and a silent 100x error is invisible in a chart
  unit          text NOT NULL CHECK (unit IN ('count', 'seconds', 'ratio', 'percent')),
  -- Can daily values be summed over a range? False for averages and ratios,
  -- where summing is nonsense and averaging needs a weight.
  is_additive   boolean NOT NULL,
  description   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.social_metric_definitions IS
  'Canonical metric vocabulary. Platform-specific names map onto these keys in '
  'social_metric_platform_support, so a consumer never needs to know which '
  'platform a number came from to know what it means.';

INSERT INTO public.social_metric_definitions
  (metric_key, display_name, unit, is_additive, description)
VALUES
  ('views',                     'Views',                     'count',   true,  'A view as the platform defines it. Definitions differ between platforms and are NOT comparable across them.'),
  ('impressions',               'Impressions',               'count',   true,  'Times the content was served. Not available on every platform.'),
  ('reach',                     'Reach',                     'count',   false, 'Unique people. Never additive: summing daily unique counts double-counts returning viewers.'),
  ('likes',                     'Likes',                     'count',   true,  'Positive reactions of any kind, collapsed to one key.'),
  ('comments',                  'Comments',                  'count',   true,  'Top-level comments plus replies where the platform does not separate them.'),
  ('shares',                    'Shares',                    'count',   true,  'Reshares/reposts.'),
  ('saves',                     'Saves',                     'count',   true,  'Bookmarks/favourites.'),
  ('clicks',                    'Link clicks',               'count',   true,  'Clicks on a link in the content.'),
  ('watch_time_seconds',        'Watch time',                'seconds', true,  'Total seconds watched. YouTube reports minutes; converted at ingestion so one unit is stored.'),
  ('avg_view_duration_seconds', 'Average view duration',     'seconds', false, 'Mean seconds per view. Not additive — re-derive from watch_time_seconds / views over a range.'),
  ('avg_view_percentage',       'Average percentage viewed', 'percent', false, 'Mean share of the video watched, 0..100.'),
  ('followers_gained',          'Followers gained',          'count',   true,  'New followers/subscribers attributed to this content or day.'),
  ('followers_lost',            'Followers lost',            'count',   true,  'Unfollows attributed to this content or day.'),
  ('followers_total',           'Followers',                 'count',   false, 'Account-level running total. A standing balance, never a daily delta.'),
  ('profile_views',             'Profile views',             'count',   true,  'Visits to the account profile.'),
  ('video_count',               'Videos published',          'count',   false, 'Account-level running total of published videos.')
ON CONFLICT (metric_key) DO UPDATE
SET display_name = excluded.display_name,
    unit         = excluded.unit,
    is_additive  = excluded.is_additive,
    description  = excluded.description;

-- ── 1b. Which platform actually provides which metric, and at what shape ─────
--
-- This table is the anti-fabrication device. A metric absent here is a metric
-- the platform DOES NOT MEASURE, and a consumer must say so rather than
-- render zero.

CREATE TABLE IF NOT EXISTS public.social_metric_platform_support (
  metric_key           text NOT NULL REFERENCES public.social_metric_definitions(metric_key) ON DELETE CASCADE,
  platform             text NOT NULL,
  -- 'daily'    — the platform reports it per calendar day
  -- 'snapshot' — only a lifetime total as it stands right now
  -- 'both'     — available either way
  granularity          text NOT NULL CHECK (granularity IN ('daily', 'snapshot', 'both')),
  -- What the platform calls it, so an adapter maps names in ONE place.
  platform_metric_name text NOT NULL,
  -- Set where the platform's own definition differs enough that comparing it
  -- across platforms would mislead.
  caveat               text,
  PRIMARY KEY (metric_key, platform)
);

COMMENT ON TABLE public.social_metric_platform_support IS
  'Which metrics each platform genuinely exposes. A (metric, platform) pair '
  'absent from this table is NOT MEASURABLE, not zero — consumers must render '
  'it as unavailable. Absence of a fact row means "not yet fetched"; absence '
  'of a row HERE means "the platform does not provide it at all".';

INSERT INTO public.social_metric_platform_support
  (metric_key, platform, granularity, platform_metric_name, caveat)
VALUES
  -- ── YouTube: YouTube Analytics API, a (metrics x dimensions) cube ─────────
  ('views',                     'youtube', 'daily', 'views', NULL),
  ('likes',                     'youtube', 'daily', 'likes', NULL),
  ('comments',                  'youtube', 'daily', 'comments', NULL),
  ('shares',                    'youtube', 'daily', 'shares', NULL),
  ('watch_time_seconds',        'youtube', 'daily', 'estimatedMinutesWatched', 'Reported in MINUTES; multiplied by 60 at ingestion so the column is always seconds.'),
  ('avg_view_duration_seconds', 'youtube', 'daily', 'averageViewDuration', NULL),
  ('avg_view_percentage',       'youtube', 'daily', 'averageViewPercentage', NULL),
  ('followers_gained',          'youtube', 'daily', 'subscribersGained', NULL),
  ('followers_lost',            'youtube', 'daily', 'subscribersLost', NULL),
  -- NOTE what is absent: thumbnail impressions and click-through rate are
  -- YouTube STUDIO metrics and are not exposed by the Analytics API at all.
  -- They are omitted deliberately. If a UI wants "impressions" for YouTube,
  -- the honest answer is that it cannot be had, and this table is what says so.

  -- ── TikTok: lifetime counters only. No time series exists ────────────────
  ('views',            'tiktok', 'snapshot', 'view_count',    'A TikTok view is counted on impression, not on watch. Not comparable with a YouTube view.'),
  ('likes',            'tiktok', 'snapshot', 'like_count',    NULL),
  ('comments',         'tiktok', 'snapshot', 'comment_count', NULL),
  ('shares',           'tiktok', 'snapshot', 'share_count',   NULL),
  ('saves',            'tiktok', 'snapshot', 'collect_count', 'Not returned for every video; absent means not reported, not zero.'),
  ('followers_total',  'tiktok', 'snapshot', 'follower_count', NULL),
  ('video_count',      'tiktok', 'snapshot', 'video_count',   NULL),

  -- ── LinkedIn: one metric per API request; DAILY unsupported for several ───
  ('impressions',      'linkedin', 'both',     'IMPRESSION', NULL),
  ('reach',            'linkedin', 'snapshot', 'MEMBERS_REACHED', 'TOTAL only — LinkedIn does not support a DAILY breakdown for unique members reached.'),
  ('likes',            'linkedin', 'both',     'REACTION', NULL),
  ('comments',         'linkedin', 'both',     'COMMENT', NULL),
  ('shares',           'linkedin', 'both',     'RESHARE', NULL),
  ('saves',            'linkedin', 'both',     'POST_SAVE', NULL),
  ('clicks',           'linkedin', 'snapshot', 'LINK_CLICKS', 'TOTAL only.'),
  ('followers_gained', 'linkedin', 'snapshot', 'FOLLOWER_GAINED_FROM_CONTENT', 'TOTAL only.'),
  ('profile_views',    'linkedin', 'snapshot', 'PROFILE_VIEW_FROM_CONTENT', 'TOTAL only.')
ON CONFLICT (metric_key, platform) DO UPDATE
SET granularity          = excluded.granularity,
    platform_metric_name = excluded.platform_metric_name,
    caveat               = excluded.caveat;

-- Revoke first, for the reason given in section 4f: Supabase's default
-- privileges already granted ALL on these tables the moment they were created.
REVOKE ALL ON public.social_metric_definitions      FROM authenticated, anon;
REVOKE ALL ON public.social_metric_platform_support FROM authenticated, anon;

GRANT SELECT ON public.social_metric_definitions      TO authenticated, anon;
GRANT SELECT ON public.social_metric_platform_support TO authenticated, anon;

ALTER TABLE public.social_metric_definitions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_metric_platform_support ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Vocabulary, not tenant data. Readable by all so the UI can explain itself.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'social_metric_definitions' AND policyname = 'smd_read') THEN
    CREATE POLICY "smd_read" ON public.social_metric_definitions FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'social_metric_platform_support' AND policyname = 'smps_read') THEN
    CREATE POLICY "smps_read" ON public.social_metric_platform_support FOR SELECT USING (true);
  END IF;
END
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The ingestion ledger — the control plane, and the guard surface
-- ═══════════════════════════════════════════════════════════════════════════
--
-- This is the single most important table here, and it is not the one holding
-- the numbers.
--
-- Without it, ingestion that silently stops is undetectable: the tables simply
-- stop gaining rows, every chart keeps rendering the last thing it saw, and
-- nothing anywhere reports a problem. That is precisely how Groq failed 100%
-- for days and how trend data was fabricated for five months (CLAUDE.md).
--
-- It does four jobs at once:
--   * incremental cursor  — where the last run got to, so the next resumes
--   * backfill controller — which windows have been covered
--   * quota budget        — YouTube's quota is per CLOUD PROJECT and shared
--                           across every user, so spend must be counted
--                           centrally, not per account
--   * liveness detector   — "did anything run in the last N hours?" is a
--                           question with an answer

CREATE TABLE IF NOT EXISTS public.social_ingestion_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connected_account_id  uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  platform              text NOT NULL,
  -- Which API surface: 'youtube_analytics_reports', 'youtube_videos_list',
  -- 'tiktok_video_list', 'linkedin_post_analytics', ...
  source                text NOT NULL,
  mode                  text NOT NULL CHECK (mode IN ('backfill', 'incremental')),

  -- Window requested, in the PLATFORM's reporting timezone (see the daily
  -- table). NULL for snapshot sources, which have no window — they observe now.
  window_start          date,
  window_end            date,

  status                text NOT NULL DEFAULT 'running'
    CHECK (status IN (
      'running',
      'succeeded',
      'partial',              -- some rows written, then a failure; NOT a success
      'failed',
      'skipped_no_scope',     -- the account never granted the scope this needs
      'skipped_rate_limited', -- deferred on purpose, not an error
      'skipped_not_supported',-- the platform does not expose this at all
      'abandoned'             -- reaped: started, never finished (see §6)
    )),

  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,

  rows_written          integer NOT NULL DEFAULT 0,
  http_requests         integer NOT NULL DEFAULT 0,
  -- YouTube bills in quota units; TikTok and LinkedIn bill in request counts.
  -- Stored uniformly so one query answers "what did today cost?".
  quota_units_spent     integer NOT NULL DEFAULT 0,

  -- Opaque resume token: a page token, a next-cursor, or a high-water date.
  cursor                text,

  error_code            text,
  error_detail          text,

  CONSTRAINT social_ingestion_runs_window_ordered
    CHECK (window_start IS NULL OR window_end IS NULL OR window_start <= window_end),
  -- A finished run must say when. An unfinished one must not.
  CONSTRAINT social_ingestion_runs_finished_consistent
    CHECK ((status = 'running') = (finished_at IS NULL)),
  -- A failure must be explicable. "It failed" with no code is the silence this
  -- whole table exists to prevent.
  CONSTRAINT social_ingestion_runs_failure_explained
    CHECK (status NOT IN ('failed', 'partial') OR error_code IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_sir_account_source_started
  ON public.social_ingestion_runs(connected_account_id, source, started_at DESC);
-- Powers the liveness detector and the daily quota total.
CREATE INDEX IF NOT EXISTS idx_sir_platform_started
  ON public.social_ingestion_runs(platform, started_at DESC);
-- Finds runs the reaper must close.
CREATE INDEX IF NOT EXISTS idx_sir_running
  ON public.social_ingestion_runs(started_at)
  WHERE status = 'running';

COMMENT ON TABLE public.social_ingestion_runs IS
  'Every attempt to pull analytics, successful or not. Ingestion that silently '
  'stops is otherwise undetectable — charts keep rendering stale numbers and '
  'nothing reports a fault. Also the incremental cursor, the backfill '
  'controller, and the per-project quota budget.';

-- ── 2b. Raw payloads, briefly ────────────────────────────────────────────────
--
-- Kept so a later analysis can re-derive fields nobody thought to extract, and
-- so a suspect number can be traced back to exactly what the platform said.
--
-- expires_at is NOT optional: YouTube's API Terms cap retention of API data at
-- 30 days. The reaper in §6 enforces it. A retention rule with no enforcement
-- is a claim, and Law 2 says a claim the code does not honour is a bug.

CREATE TABLE IF NOT EXISTS public.social_ingestion_raw (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_run_id uuid NOT NULL REFERENCES public.social_ingestion_runs(id) ON DELETE CASCADE,
  request_summary  text NOT NULL,   -- endpoint + params, never credentials
  payload          jsonb NOT NULL,
  fetched_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sir_raw_expires ON public.social_ingestion_raw(expires_at);
CREATE INDEX IF NOT EXISTS idx_sir_raw_run     ON public.social_ingestion_raw(ingestion_run_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Tenancy, denormalised but impossible to drift
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Fact tables carry user_id / organization_id / scope / platform directly.
-- The alternative — resolving tenancy through a join to connected_accounts
-- inside every RLS policy — re-runs that join for every row of every read, on
-- the tables that will hold by far the most rows in this schema.
--
-- Denormalisation normally trades correctness for speed. Here it does not: the
-- columns are set by a BEFORE trigger that OVERWRITES whatever the writer
-- supplied with the values from connected_accounts. A caller cannot write a
-- fact row into the wrong tenant even deliberately, because its input is
-- discarded. Drift is not policed after the fact; it is unrepresentable.

CREATE OR REPLACE FUNCTION public.social_metrics_set_tenancy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ca record;
BEGIN
  SELECT user_id, organization_id, scope, platform
    INTO ca
  FROM public.connected_accounts
  WHERE id = NEW.connected_account_id;

  IF NOT FOUND THEN
    -- The FK would catch this too; failing here names the cause precisely.
    RAISE EXCEPTION 'connected_account % does not exist — refusing to write a fact row with no owner',
      NEW.connected_account_id;
  END IF;

  -- Deliberately unconditional assignment. NOT "fill in if the caller left it
  -- blank": a caller that supplies the wrong user_id must be corrected, not
  -- obeyed. This is the whole reason the denormalisation is safe.
  NEW.user_id         := ca.user_id;
  NEW.organization_id := ca.organization_id;
  NEW.scope           := ca.scope;
  NEW.platform        := ca.platform;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.social_metrics_set_tenancy() IS
  'Copies tenancy from connected_accounts onto a fact row, overwriting whatever '
  'the writer passed. Makes cross-tenant analytics rows unrepresentable rather '
  'than merely forbidden.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The fact tables
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 4a. Daily, additive ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.social_post_metrics_daily (
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  -- The PLATFORM's id for the post (YouTube video id, TikTok video id,
  -- LinkedIn share URN). Keyed on this rather than on posts.id because
  -- analytics must survive a post being deleted on our side, and because a
  -- backfill covers content published before this product existed.
  platform_post_id     text NOT NULL,
  metric_key           text NOT NULL REFERENCES public.social_metric_definitions(metric_key),
  metric_date          date NOT NULL,
  value                numeric NOT NULL,

  -- Whose day is "metric_date"? YouTube aggregates in Pacific time. Recording
  -- this is the difference between a correct "best time to post" and one that
  -- is silently hours out.
  reporting_timezone   text NOT NULL,

  -- Our post, when we published it. NULL for backfilled content that predates
  -- the product — which is normal, not an error.
  post_id              uuid REFERENCES public.posts(id) ON DELETE SET NULL,

  ingestion_run_id     uuid NOT NULL REFERENCES public.social_ingestion_runs(id) ON DELETE CASCADE,
  fetched_at           timestamptz NOT NULL DEFAULT now(),

  -- Set by trigger; never trusted from the writer.
  user_id              uuid NOT NULL,
  organization_id      uuid,
  scope                text NOT NULL,
  platform             text NOT NULL,

  PRIMARY KEY (connected_account_id, platform_post_id, metric_key, metric_date)
);

-- ── 4b. Snapshots: cumulative totals as they stood at an instant ─────────────

CREATE TABLE IF NOT EXISTS public.social_post_metrics_snapshot (
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  platform_post_id     text NOT NULL,
  metric_key           text NOT NULL REFERENCES public.social_metric_definitions(metric_key),
  observed_at          timestamptz NOT NULL,
  -- Cumulative since publication, NOT a delta. Differencing two snapshots is
  -- how a TikTok trend is derived; adding them is meaningless.
  value                numeric NOT NULL,

  post_id              uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  ingestion_run_id     uuid NOT NULL REFERENCES public.social_ingestion_runs(id) ON DELETE CASCADE,
  fetched_at           timestamptz NOT NULL DEFAULT now(),

  user_id              uuid NOT NULL,
  organization_id      uuid,
  scope                text NOT NULL,
  platform             text NOT NULL,

  PRIMARY KEY (connected_account_id, platform_post_id, metric_key, observed_at)
);

-- ── 4c. Dimensional breakdowns ───────────────────────────────────────────────
--
-- YouTube's cube: country, traffic source, device, age/gender, subscribed
-- status. Empty for TikTok, honestly — TikTok's API exposes no breakdowns, and
-- social_metric_platform_support is what tells a consumer that.

CREATE TABLE IF NOT EXISTS public.social_post_breakdowns (
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  platform_post_id     text NOT NULL,
  metric_key           text NOT NULL REFERENCES public.social_metric_definitions(metric_key),
  -- 'country', 'insight_traffic_source_type', 'device_type', 'age_group',
  -- 'gender', 'subscribed_status', 'operating_system'
  dimension_key        text NOT NULL,
  dimension_value      text NOT NULL,
  -- Breakdowns are requested over a range, not per day: the per-day cube is
  -- prohibitively expensive in quota and rarely more useful.
  period_start         date NOT NULL,
  period_end           date NOT NULL,
  value                numeric NOT NULL,
  reporting_timezone   text NOT NULL,

  post_id              uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  ingestion_run_id     uuid NOT NULL REFERENCES public.social_ingestion_runs(id) ON DELETE CASCADE,
  fetched_at           timestamptz NOT NULL DEFAULT now(),

  user_id              uuid NOT NULL,
  organization_id      uuid,
  scope                text NOT NULL,
  platform             text NOT NULL,

  PRIMARY KEY (connected_account_id, platform_post_id, metric_key,
               dimension_key, dimension_value, period_start, period_end),
  CONSTRAINT social_post_breakdowns_period_ordered CHECK (period_start <= period_end)
);

-- ── 4d. Audience retention curves ────────────────────────────────────────────
--
-- The only data any platform gives that answers "what should I CHANGE" rather
-- than "how did it do" — it shows WHERE viewers leave. YouTube-only today.
-- Stored as its own table rather than as a breakdown because the x-axis is
-- continuous, and because a curve is read whole, never filtered by bucket.

CREATE TABLE IF NOT EXISTS public.social_retention_curves (
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  platform_post_id     text NOT NULL,
  observed_at          timestamptz NOT NULL,
  -- Position through the video, 0..1 (YouTube's elapsedVideoTimeRatio).
  elapsed_ratio        numeric NOT NULL CHECK (elapsed_ratio >= 0 AND elapsed_ratio <= 1),
  -- Share of viewers still watching at that position (audienceWatchRatio).
  -- Can exceed 1 where a segment is rewatched — so it is NOT capped at 1.
  watch_ratio          numeric NOT NULL CHECK (watch_ratio >= 0),

  post_id              uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  ingestion_run_id     uuid NOT NULL REFERENCES public.social_ingestion_runs(id) ON DELETE CASCADE,
  fetched_at           timestamptz NOT NULL DEFAULT now(),

  user_id              uuid NOT NULL,
  organization_id      uuid,
  scope                text NOT NULL,
  platform             text NOT NULL,

  PRIMARY KEY (connected_account_id, platform_post_id, observed_at, elapsed_ratio)
);

-- ── 4e. Account-level metrics ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.social_account_metrics_daily (
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  metric_key           text NOT NULL REFERENCES public.social_metric_definitions(metric_key),
  metric_date          date NOT NULL,
  value                numeric NOT NULL,
  reporting_timezone   text NOT NULL,

  ingestion_run_id     uuid NOT NULL REFERENCES public.social_ingestion_runs(id) ON DELETE CASCADE,
  fetched_at           timestamptz NOT NULL DEFAULT now(),

  user_id              uuid NOT NULL,
  organization_id      uuid,
  scope                text NOT NULL,
  platform             text NOT NULL,

  PRIMARY KEY (connected_account_id, metric_key, metric_date)
);

-- ── 4f. Triggers, indexes and RLS, applied uniformly ─────────────────────────
--
-- Generated rather than written out five times. Five hand-written copies is
-- five chances to omit RLS on one table, and an omitted policy on an analytics
-- table is a cross-tenant read.

DO $$
DECLARE
  t text;
  fact_tables CONSTANT text[] := ARRAY[
    'social_post_metrics_daily',
    'social_post_metrics_snapshot',
    'social_post_breakdowns',
    'social_retention_curves',
    'social_account_metrics_daily'
  ];
BEGIN
  FOREACH t IN ARRAY fact_tables LOOP
    -- Tenancy trigger
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_tenancy ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_tenancy BEFORE INSERT OR UPDATE ON public.%1$I '
      'FOR EACH ROW EXECUTE FUNCTION public.social_metrics_set_tenancy()', t);

    -- Read paths: "my analytics", and "this post's analytics".
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%1$s_user_platform ON public.%1$I(user_id, platform)', t);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%1$s_org ON public.%1$I(organization_id) '
      'WHERE organization_id IS NOT NULL', t);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%1$s_run ON public.%1$I(ingestion_run_id)', t);

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Mirrors ca_org_member_read on connected_accounts (20260328000000:273):
    -- the analytics of an account must be visible to exactly the people who can
    -- see the account itself. Any looser rule is a cross-tenant leak; any
    -- tighter one hides an org's own data from the org.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_read'
    ) THEN
      EXECUTE format($p$
        CREATE POLICY %1$I ON public.%2$I
          FOR SELECT
          USING (
            (scope = 'personal' AND user_id = auth.uid())
            OR (
              scope = 'organization'
              AND organization_id IN (
                SELECT om.organization_id
                FROM public.organization_members om
                WHERE om.user_id = auth.uid()
                  AND om.status = 'active'
              )
            )
          )
      $p$, t || '_read', t);
    END IF;

    -- SELECT only. Writes are service-role, from the ingestion worker: these
    -- rows are claims about what a platform reported, and a client that could
    -- write them could fabricate its own analytics.
    --
    -- The REVOKE is not belt-and-braces, it is load-bearing. Supabase ships
    -- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ...
    -- anon, authenticated, service_role`, so a newly created table arrives
    -- ALREADY writable by every logged-in user. Granting SELECT does not undo
    -- that — nothing removes a privilege except REVOKE.
    --
    -- Caught by post-condition 7b on the live database 2026-09-11: the tables
    -- were created client-writable. RLS would still have refused the inserts
    -- (there is no INSERT policy, and RLS denies by default), but a grant
    -- nobody intended is a grant nobody is watching — exactly the reasoning in
    -- 20260904140000 §4, where write grants outlived the read grants they were
    -- paired with.
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated, anon', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END
$$;

-- The ledger and raw payloads are operational, not user-facing. Service-role
-- only, like connected_account_secrets (20260904120000).
--
-- "No grant" is not the same as "no privilege": Supabase's default privileges
-- granted ALL on both tables at creation, so they must be REVOKED rather than
-- simply not granted. social_ingestion_raw holds verbatim platform responses,
-- which is the last thing that should be readable from a browser.
REVOKE ALL ON public.social_ingestion_runs FROM authenticated, anon;
REVOKE ALL ON public.social_ingestion_raw  FROM authenticated, anon;

ALTER TABLE public.social_ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_ingestion_raw  ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Freshness, exposed as data
-- ═══════════════════════════════════════════════════════════════════════════
--
-- "When was this last updated, and did the last attempt work?" must be
-- answerable by the UI. A dashboard that cannot distinguish "quiet week" from
-- "ingestion has been broken since Tuesday" will show the first and mean the
-- second — which is the fabrication Law 3 forbids.

CREATE OR REPLACE VIEW public.social_analytics_freshness
WITH (security_invoker = true) AS
SELECT
  ca.id   AS connected_account_id,
  ca.user_id,
  ca.organization_id,
  ca.scope,
  ca.platform,
  r.source,
  max(r.started_at) FILTER (WHERE r.status = 'succeeded')          AS last_success_at,
  max(r.started_at)                                                AS last_attempt_at,
  (array_agg(r.status ORDER BY r.started_at DESC))[1]              AS last_status,
  (array_agg(r.error_code ORDER BY r.started_at DESC))[1]          AS last_error_code,
  count(*) FILTER (WHERE r.status IN ('failed', 'partial', 'abandoned')
                     AND r.started_at > now() - interval '24 hours') AS failures_24h
FROM public.connected_accounts ca
LEFT JOIN public.social_ingestion_runs r ON r.connected_account_id = ca.id
GROUP BY ca.id, ca.user_id, ca.organization_id, ca.scope, ca.platform, r.source;

COMMENT ON VIEW public.social_analytics_freshness IS
  'Per account and source: when analytics last succeeded, what happened last, '
  'and how much has failed today. Consumers MUST render staleness from this '
  'rather than assuming the newest fact row is current — an empty week and a '
  'broken ingester look identical in the fact tables alone.';

GRANT SELECT ON public.social_analytics_freshness TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Reapers
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CLAUDE.md: "Every non-terminal state needs a reaper." `running` is a
-- non-terminal state, and a crashed worker leaves rows in it forever — which
-- both blocks the next run's cursor logic and makes the freshness view lie.
--
-- Deliberately plain SQL on pg_cron, with no HTTP call. The token-refresh cron
-- authenticates to an edge function using the Vault service_role_key, and that
-- key is currently drifted from the runtime's (docs/handoff/2026-09-09 §10) so
-- those runs get a bare 401. A SQL-only job has no such dependency and cannot
-- be silenced the same way.

CREATE OR REPLACE FUNCTION public.reap_social_ingestion()
RETURNS TABLE (abandoned_runs integer, expired_raw integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a integer;
  e integer;
BEGIN
  -- A run still 'running' after an hour is not running.
  WITH reaped AS (
    UPDATE public.social_ingestion_runs
    SET status      = 'abandoned',
        finished_at = now(),
        error_code  = coalesce(error_code, 'reaped_stale_run'),
        error_detail = coalesce(
          error_detail,
          'Still ''running'' more than 1 hour after start. The worker died, was '
          'redeployed mid-run, or timed out. Rows it wrote before dying are kept '
          'and remain attributable to this run.')
    WHERE status = 'running'
      AND started_at < now() - interval '1 hour'
    RETURNING 1
  )
  SELECT count(*)::integer INTO a FROM reaped;

  -- YouTube API Terms cap retention of API data at 30 days. expires_at is set
  -- per row at write time; this enforces it.
  WITH gone AS (
    DELETE FROM public.social_ingestion_raw
    WHERE expires_at <= now()
    RETURNING 1
  )
  SELECT count(*)::integer INTO e FROM gone;

  RETURN QUERY SELECT a, e;
END;
$$;

COMMENT ON FUNCTION public.reap_social_ingestion() IS
  'Closes ingestion runs stuck in the non-terminal ''running'' state and deletes '
  'raw payloads past their retention deadline. Plain SQL on pg_cron, so it does '
  'not depend on the service-role key the edge-function crons authenticate with.';

DO $$
DECLARE
  job_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE WARNING
      'pg_cron is not installed, so reap_social_ingestion() is NOT scheduled. '
      'The function exists and can be called by hand. Enable pg_cron via '
      'Database > Extensions and re-apply this migration to schedule it.';
  ELSE
    -- Unschedule before scheduling: re-applying must not leave two jobs.
    SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'reap-social-ingestion' LIMIT 1;
    IF job_id IS NOT NULL THEN
      PERFORM cron.unschedule(job_id);
    END IF;

    PERFORM cron.schedule(
      'reap-social-ingestion',
      '17 * * * *',   -- hourly, off the hour so it does not collide with ingestion
      $cron$ SELECT public.reap_social_ingestion(); $cron$
    );
  END IF;
END
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Post-conditions — exercise the rules, do not merely assert they exist
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  probe_user    uuid;
  other_user    uuid;
  probe_account uuid;
  probe_run     uuid;
  t             text;
  ok_count      integer;
BEGIN
  -- 7a. Every fact table has RLS ON and a read policy. A missing policy on one
  --     of these is a cross-tenant read of somebody's audience data.
  FOREACH t IN ARRAY ARRAY['social_post_metrics_daily', 'social_post_metrics_snapshot',
                           'social_post_breakdowns', 'social_retention_curves',
                           'social_account_metrics_daily'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'post-condition failed: RLS is not enabled on public.%', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_read') THEN
      RAISE EXCEPTION 'post-condition failed: public.% has no read policy', t;
    END IF;
    -- 7b. No client may ever WRITE a metric. These rows are claims about what a
    --     platform reported; a client that could write them could fabricate its
    --     own analytics and the product would have no way to tell.
    IF has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE') THEN
      RAISE EXCEPTION 'post-condition failed: authenticated can write public.% — analytics must be service-role only', t;
    END IF;
  END LOOP;

  -- 7c. The ledger and raw payloads are unreachable from the browser entirely.
  IF has_table_privilege('authenticated', 'public.social_ingestion_runs', 'SELECT')
     OR has_table_privilege('authenticated', 'public.social_ingestion_raw', 'SELECT') THEN
    RAISE EXCEPTION 'post-condition failed: authenticated can read the ingestion ledger';
  END IF;

  -- 7d. The vocabulary is populated. An empty support matrix would make every
  --     metric read as "not measurable" and the feature would be silently dead.
  SELECT count(*) INTO ok_count FROM public.social_metric_platform_support;
  IF ok_count < 20 THEN
    RAISE EXCEPTION 'post-condition failed: only % platform-metric mappings seeded', ok_count;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.social_metric_platform_support
                 WHERE platform = 'tiktok' AND granularity = 'snapshot') THEN
    RAISE EXCEPTION 'post-condition failed: TikTok must be seeded as snapshot-only — it exposes no time series';
  END IF;
  -- The honesty check: TikTok must NOT claim impressions.
  IF EXISTS (SELECT 1 FROM public.social_metric_platform_support
             WHERE platform = 'tiktok' AND metric_key = 'impressions') THEN
    RAISE EXCEPTION 'post-condition failed: TikTok does not expose impressions; claiming it would render a fabricated zero';
  END IF;

  -- 7e. THE REAL TEST: the tenancy trigger must overwrite a wrong user_id.
  --     Asserting the trigger exists is not the same as proving it corrects a
  --     hostile write, and it is the write that matters.
  SELECT id INTO probe_user FROM auth.users LIMIT 1;
  IF probe_user IS NOT NULL THEN
    SELECT id INTO other_user FROM auth.users WHERE id <> probe_user LIMIT 1;

    INSERT INTO public.connected_accounts
      (user_id, platform, scope, account_id, account_name, display_name, username,
       provider, connection_status, is_mock)
    VALUES
      (probe_user, 'youtube', 'personal', '__analytics_probe__', 'probe', 'probe', 'probe',
       'youtube', 'active', false)
    RETURNING id INTO probe_account;

    INSERT INTO public.social_ingestion_runs
      (connected_account_id, platform, source, mode, status, finished_at)
    VALUES
      (probe_account, 'youtube', '__probe__', 'incremental', 'succeeded', now())
    RETURNING id INTO probe_run;

    -- Claim the row belongs to somebody else. The trigger must ignore that.
    INSERT INTO public.social_post_metrics_daily
      (connected_account_id, platform_post_id, metric_key, metric_date, value,
       reporting_timezone, ingestion_run_id, user_id, scope, platform)
    VALUES
      (probe_account, '__probe_video__', 'views', current_date, 42,
       'America/Los_Angeles', probe_run,
       coalesce(other_user, '00000000-0000-0000-0000-000000000000'::uuid),
       'organization', 'tiktok');

    IF NOT EXISTS (
      SELECT 1 FROM public.social_post_metrics_daily
      WHERE connected_account_id = probe_account
        AND user_id = probe_user AND scope = 'personal' AND platform = 'youtube'
    ) THEN
      RAISE EXCEPTION
        'post-condition failed: the tenancy trigger did not overwrite a falsified user_id/scope/platform';
    END IF;

    -- 7f. A fact row must not survive its account. This is what makes the
    --     LinkedIn §4.4 / YouTube 30-day deletion obligations structural.
    DELETE FROM public.connected_accounts WHERE id = probe_account;

    IF EXISTS (SELECT 1 FROM public.social_post_metrics_daily WHERE connected_account_id = probe_account) THEN
      RAISE EXCEPTION
        'post-condition failed: analytics survived the deletion of its connected account — disconnect would leave user data behind';
    END IF;
    IF EXISTS (SELECT 1 FROM public.social_ingestion_runs WHERE id = probe_run) THEN
      RAISE EXCEPTION 'post-condition failed: the ingestion run survived its account';
    END IF;
  END IF;

  -- 7g. The reaper runs and reports.
  PERFORM public.reap_social_ingestion();

  RAISE NOTICE 'social analytics foundation live: 5 fact tables, ledger, reaper, tenancy proven.';
END;
$$;

COMMIT;
