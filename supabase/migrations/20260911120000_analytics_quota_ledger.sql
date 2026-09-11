-- 20260911120000_analytics_quota_ledger.sql
--
-- Make API quota a budget the ingestion worker can CHECK, not a limit it
-- discovers by being refused.
--
-- ── Why this is not optional, and not "add it later" ────────────────────────
-- YouTube's quota is per CLOUD PROJECT, shared across every user of the app.
-- It is not per-channel and not per-user. So one user with 400 videos, or a
-- backfill that looks reasonable in isolation, can exhaust the entire
-- product's daily allowance and stop analytics for everybody else — including
-- users who did nothing.
--
-- Without a ledger the worker cannot know that until Google returns
-- quotaExceeded, by which point the budget is already gone and the only
-- remedy is waiting for the reset. A budget you can only observe by hitting
-- it is not a budget.
--
-- ── The reset boundary is NOT midnight UTC ──────────────────────────────────
-- YouTube resets quota at midnight PACIFIC time. Computing "today's spend" in
-- UTC would be wrong for 7-8 hours of every day, and wrong in the dangerous
-- direction: between 00:00 UTC and the real Pacific reset, a UTC-based ledger
-- reports a fresh budget while Google still counts yesterday's. The worker
-- would happily spend a quota it does not have.
--
-- This is the same class of error as reporting_timezone on the daily fact
-- tables, and the same class as daily-analysis/index.ts:220 computing
-- "best hour to post" with getHours() in a UTC runtime. Storing the boundary
-- is the only thing that makes the number mean what it says.
--
-- ── Why limits are DATA, not constants in the worker ────────────────────────
-- Quota changes: an audit grants more, Google revises defaults, a second
-- platform arrives with a different unit entirely. A constant in TypeScript
-- means a redeploy to change a number the platform already changed, and
-- means the number is invisible to anyone reading the database.
--
-- Same reasoning as publish_providers (20260904140000) and
-- social_metric_platform_support: capability and limits belong in tables.
--
-- VERIFY:
--   SELECT * FROM public.social_api_quota_today ORDER BY platform, quota_key;
--
-- SAFE TO RE-RUN: yes.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. What each platform allows
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.social_api_quota_limits (
  platform        text NOT NULL,
  -- A platform can meter several things independently. YouTube bills general
  -- calls against a units pool while videos.insert has its own COUNT-based
  -- allowance — the two do not draw from each other, so they cannot be one row.
  quota_key       text NOT NULL,
  daily_limit     integer NOT NULL CHECK (daily_limit > 0),
  -- 'units'    — YouTube's weighted cost model
  -- 'requests' — a plain call count
  unit            text NOT NULL CHECK (unit IN ('units', 'requests')),
  -- IANA zone in which the platform's day rolls over. NOT decorative: see the
  -- header. YouTube is Pacific.
  reset_timezone  text NOT NULL,
  -- Stop before the wall, not at it. A backfill that consumes the last unit
  -- leaves incremental ingestion dead until reset, so the worker reserves a
  -- margin for the runs that keep existing data fresh.
  reserve_percent integer NOT NULL DEFAULT 20
                  CHECK (reserve_percent >= 0 AND reserve_percent < 100),
  notes           text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, quota_key)
);

COMMENT ON TABLE public.social_api_quota_limits IS
  'Per-platform API allowances. Quota is per PROJECT, shared by every user, so '
  'this is a product-wide budget rather than a per-account one. Limits live in '
  'data because they change without our code changing.';

INSERT INTO public.social_api_quota_limits
  (platform, quota_key, daily_limit, unit, reset_timezone, reserve_percent, notes)
VALUES
  ('youtube', 'general', 10000, 'units', 'America/Los_Angeles', 20,
   'YouTube Data + Analytics API default. Weighted: most reads cost 1 unit, '
   'search.list costs 100. Raise only after the compliance audit grants it — '
   'and update this row when they do, or the worker throttles itself for no reason.'),

  ('youtube', 'videos_insert', 100, 'requests', 'America/Los_Angeles', 10,
   'Uploads have their OWN counter, separate from the units pool. 100 per day '
   'across the WHOLE app, not per user. The widely-repeated "1600 units per '
   'upload out of 10000" figure is out of date.'),

  ('tiktok', 'general', 600, 'requests', 'UTC', 20,
   'TikTok documents ~30 requests/minute rather than a daily cap; 600 is a '
   'conservative daily working budget so a backfill cannot monopolise the '
   'minute-rate for every other account.'),

  ('linkedin', 'general', 5000, 'requests', 'UTC', 20,
   'Community Management dev tier. LinkedIn accepts ONE metric per request, so '
   'a single post with 11 metrics costs 11 — request count matters far more '
   'here than it looks.')
ON CONFLICT (platform, quota_key) DO UPDATE
SET daily_limit     = excluded.daily_limit,
    unit            = excluded.unit,
    reset_timezone  = excluded.reset_timezone,
    reserve_percent = excluded.reserve_percent,
    notes           = excluded.notes,
    updated_at      = now();

REVOKE ALL ON public.social_api_quota_limits FROM authenticated, anon;
ALTER TABLE public.social_api_quota_limits ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Which quota_key a run draws from
-- ═══════════════════════════════════════════════════════════════════════════
--
-- social_ingestion_runs records what a run SPENT; it did not record which
-- meter it spent from. With YouTube metering uploads separately from reads,
-- summing every run together would charge reads against the upload allowance
-- and vice versa — a ledger that is confidently wrong.

ALTER TABLE public.social_ingestion_runs
  ADD COLUMN IF NOT EXISTS quota_key text NOT NULL DEFAULT 'general';

COMMENT ON COLUMN public.social_ingestion_runs.quota_key IS
  'Which meter this run drew from, matching social_api_quota_limits.quota_key. '
  'Defaults to general: every existing analytics run is a read.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Today's spend, in the platform's own day
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.social_api_quota_today AS
SELECT
  l.platform,
  l.quota_key,
  l.daily_limit,
  l.unit,
  l.reset_timezone,
  -- The platform's current calendar day, not ours.
  (now() AT TIME ZONE l.reset_timezone)::date          AS quota_date,
  coalesce(sum(r.quota_units_spent), 0)::integer       AS spent,
  -- What the worker is actually allowed to use, after the reserve that keeps
  -- incremental ingestion alive.
  (l.daily_limit * (100 - l.reserve_percent) / 100)::integer AS usable_limit,
  greatest(
    (l.daily_limit * (100 - l.reserve_percent) / 100)
      - coalesce(sum(r.quota_units_spent), 0),
    0
  )::integer                                            AS remaining,
  count(r.id)                                           AS runs_today
FROM public.social_api_quota_limits l
LEFT JOIN public.social_ingestion_runs r
  ON  r.platform  = l.platform
  AND r.quota_key = l.quota_key
  -- Bucket each run into the platform's day, so a run at 23:00 Pacific counts
  -- against the day Google says it does.
  AND (r.started_at AT TIME ZONE l.reset_timezone)::date
      = (now() AT TIME ZONE l.reset_timezone)::date
GROUP BY l.platform, l.quota_key, l.daily_limit, l.unit,
         l.reset_timezone, l.reserve_percent;

COMMENT ON VIEW public.social_api_quota_today IS
  'Spend against allowance for the platform''s CURRENT day, computed in the '
  'platform''s own reset timezone. The worker must consult `remaining` before '
  'each call: quota is shared across all users, so one backfill can otherwise '
  'stop analytics for everybody.';

-- Service-role only. Not secret, but it is operational plumbing, and the
-- default privileges would otherwise have made it writable — the defect
-- post-condition 7b caught in 20260909140000.
REVOKE ALL ON public.social_api_quota_today FROM authenticated, anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Post-conditions
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  n integer;
  yt record;
BEGIN
  -- 4a. Limits are seeded. An empty table would make `remaining` zero for every
  --     platform and silently stop all ingestion — failure disguised as thrift.
  SELECT count(*) INTO n FROM public.social_api_quota_limits;
  IF n < 4 THEN
    RAISE EXCEPTION 'post-condition failed: only % quota limit(s) seeded', n;
  END IF;

  -- 4b. YouTube's two meters are SEPARATE rows. Collapsing them would charge
  --     reads against the upload allowance, which is how you lose the ability
  --     to publish by reading analytics.
  IF NOT EXISTS (SELECT 1 FROM public.social_api_quota_limits
                 WHERE platform = 'youtube' AND quota_key = 'general')
     OR NOT EXISTS (SELECT 1 FROM public.social_api_quota_limits
                    WHERE platform = 'youtube' AND quota_key = 'videos_insert') THEN
    RAISE EXCEPTION
      'post-condition failed: YouTube must have separate general and videos_insert meters';
  END IF;

  -- 4c. The reset boundary must be Pacific, not UTC. A UTC boundary reports a
  --     fresh budget for 7-8 hours while Google still counts yesterday's.
  SELECT * INTO yt FROM public.social_api_quota_limits
  WHERE platform = 'youtube' AND quota_key = 'general';
  IF yt.reset_timezone <> 'America/Los_Angeles' THEN
    RAISE EXCEPTION
      'post-condition failed: YouTube quota resets at midnight Pacific, not %', yt.reset_timezone;
  END IF;

  -- 4d. The view computes, and reserves. With no runs today, remaining must be
  --     the usable limit — strictly LESS than the raw allowance.
  SELECT * INTO yt FROM public.social_api_quota_today
  WHERE platform = 'youtube' AND quota_key = 'general';
  IF yt IS NULL THEN
    RAISE EXCEPTION 'post-condition failed: social_api_quota_today returns no row for youtube/general';
  END IF;
  IF yt.usable_limit >= yt.daily_limit THEN
    RAISE EXCEPTION
      'post-condition failed: the reserve is not being applied (usable % >= limit %)',
      yt.usable_limit, yt.daily_limit;
  END IF;

  -- 4e. The ledger stays out of the browser.
  IF has_table_privilege('authenticated', 'public.social_api_quota_limits', 'SELECT')
     OR has_table_privilege('authenticated', 'public.social_api_quota_limits', 'INSERT') THEN
    RAISE EXCEPTION 'post-condition failed: authenticated can reach social_api_quota_limits';
  END IF;

  RAISE NOTICE 'quota ledger live: youtube usable %/% units, resets midnight %',
    yt.usable_limit, yt.daily_limit, yt.reset_timezone;
END;
$$;

COMMIT;
