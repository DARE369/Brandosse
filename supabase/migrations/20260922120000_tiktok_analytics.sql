-- 20260922120000_tiktok_analytics.sql
--
-- What TikTok analytics ingestion needs from the schema, and one correction to
-- a claim the foundation migration made about TikTok.
--
-- Founder decision 2026-09-22: TikTok analytics ships in the app-review
-- application (scopes user.info.profile, user.info.stats, video.list alongside
-- user.info.basic and video.publish).
--
-- ── 1. A false claim, removed ───────────────────────────────────────────────
-- 20260909140000:199 seeded ('saves', 'tiktok', 'snapshot', 'collect_count').
-- TikTok's Video object has no collect_count and no favourites field of any
-- kind (developers.tiktok.com/doc/tiktok-api-v2-video-object, checked
-- 2026-09-22: id, create_time, title, video_description, duration,
-- cover_image_url, share_url, embed_link, like_count, comment_count,
-- share_count, view_count). The row told every consumer that TikTok measures
-- saves, so the UI would render "not fetched yet" forever for a number that can
-- never arrive. Absent from this table is how "not measurable" is expressed,
-- so the fix is removal.
--
-- ── 2. Account-level snapshots get their own table ──────────────────────────
-- TikTok's user.info.stats returns follower_count, following_count,
-- likes_count and video_count: running totals as they stand NOW, with no
-- history. The foundation split post facts by SHAPE (daily vs snapshot) so that
-- summing lifetime totals is a query nobody can write by accident. Account
-- facts only got the daily table. Writing a TikTok follower total into
-- social_account_metrics_daily would reintroduce the exact mistake the split
-- exists to prevent, one SUM() away. So the account side gets the same split.
--
-- ── 3. Two metrics TikTok reports that the vocabulary lacked ────────────────
-- likes_count (likes across all the creator's videos) and following_count.
--
-- ── 4. TikTok analytics gets its own meter ──────────────────────────────────
-- Same reasoning as youtube/analytics in 20260911140000: reads must not draw
-- down the allowance publishing depends on.
--
-- ── 5. What the numbers are ABOUT: social_platform_posts ────────────────────
-- Fact rows are keyed on the platform's post id. The UI names a post from
-- posts.title, which only exists for content published through us. A TikTok
-- creator's catalogue is mostly videos posted in the TikTok app, so without
-- this table the analytics page would label them with a 19-digit id.
-- video.list returns title, description, share_url and create_time; they are
-- stored here. cover_image_url is deliberately NOT stored: TikTok documents a
-- 6-hour TTL on it, so a stored copy is a broken image within a day.
--
-- VERIFY:
--   SELECT metric_key, platform_metric_name FROM public.social_metric_platform_support
--   WHERE platform = 'tiktok' ORDER BY 1;
--   SELECT * FROM public.social_api_quota_today WHERE platform = 'tiktok';
--
-- SAFE TO RE-RUN: yes.

BEGIN;

-- ── 1. Remove the false saves claim ─────────────────────────────────────────

DELETE FROM public.social_metric_platform_support
WHERE platform = 'tiktok' AND metric_key = 'saves';

-- ── 3. Vocabulary ───────────────────────────────────────────────────────────

INSERT INTO public.social_metric_definitions
  (metric_key, display_name, unit, is_additive, description)
VALUES
  ('likes_received_total', 'Total likes', 'count', false,
   'Account-level running total of likes across all of the creator''s videos. A standing balance, never a delta.'),
  ('following_total', 'Following', 'count', false,
   'Account-level running total of accounts this creator follows. A standing balance, never a delta.')
ON CONFLICT (metric_key) DO UPDATE
SET display_name = excluded.display_name,
    unit         = excluded.unit,
    is_additive  = excluded.is_additive,
    description  = excluded.description;

INSERT INTO public.social_metric_platform_support
  (metric_key, platform, granularity, platform_metric_name, caveat)
VALUES
  ('likes_received_total', 'tiktok', 'snapshot', 'likes_count', NULL),
  ('following_total',      'tiktok', 'snapshot', 'following_count', NULL),
  -- Re-stated to attach the caveat TikTok's own docs give.
  ('video_count',          'tiktok', 'snapshot', 'video_count',
   'Publicly posted videos only. Posts visible to "Only me" or friends are not counted.')
ON CONFLICT (metric_key, platform) DO UPDATE
SET granularity          = excluded.granularity,
    platform_metric_name = excluded.platform_metric_name,
    caveat               = excluded.caveat;

-- ── 2. social_account_metrics_snapshot ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.social_account_metrics_snapshot (
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  metric_key           text NOT NULL REFERENCES public.social_metric_definitions(metric_key),
  observed_at          timestamptz NOT NULL,
  -- The total as it stood at observed_at. Differencing two rows is a trend;
  -- adding them is meaningless.
  value                numeric NOT NULL,

  ingestion_run_id     uuid NOT NULL REFERENCES public.social_ingestion_runs(id) ON DELETE CASCADE,
  fetched_at           timestamptz NOT NULL DEFAULT now(),

  -- Set by trigger; never trusted from the writer.
  user_id              uuid NOT NULL,
  organization_id      uuid,
  scope                text NOT NULL,
  platform             text NOT NULL,

  PRIMARY KEY (connected_account_id, metric_key, observed_at)
);

COMMENT ON TABLE public.social_account_metrics_snapshot IS
  'Account-level running totals (followers, total likes, videos) as observed at '
  'an instant. Never sum across rows; the latest row per metric is the current '
  'value, and the difference between two rows is the change.';

-- ── 5. social_platform_posts ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.social_platform_posts (
  connected_account_id uuid NOT NULL REFERENCES public.connected_accounts(id) ON DELETE CASCADE,
  platform_post_id     text NOT NULL,
  title                text,
  description          text,
  share_url            text,
  published_at         timestamptz,
  duration_seconds     integer,
  -- Our post, when it was published through us. NULL for the creator's own
  -- uploads, which is normal.
  post_id              uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  last_seen_at         timestamptz NOT NULL,

  ingestion_run_id     uuid NOT NULL REFERENCES public.social_ingestion_runs(id) ON DELETE CASCADE,
  fetched_at           timestamptz NOT NULL DEFAULT now(),

  user_id              uuid NOT NULL,
  organization_id      uuid,
  scope                text NOT NULL,
  platform             text NOT NULL,

  PRIMARY KEY (connected_account_id, platform_post_id)
);

COMMENT ON TABLE public.social_platform_posts IS
  'The platform''s own description of each post the metrics are about — title, '
  'link, publish time — including posts not published through this product. '
  'Written only by ingestion; deleted with the connected account.';

-- Same generated block as 20260909140000 §4f: tenancy trigger, indexes, RLS
-- read policy mirroring connected_accounts, and the REVOKE that Supabase's
-- default privileges make load-bearing.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['social_account_metrics_snapshot', 'social_platform_posts'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_tenancy ON public.%1$I', t);
  EXECUTE format(
    'CREATE TRIGGER trg_%1$s_tenancy BEFORE INSERT OR UPDATE ON public.%1$I '
    'FOR EACH ROW EXECUTE FUNCTION public.social_metrics_set_tenancy()', t);

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_%1$s_user_platform ON public.%1$I(user_id, platform)', t);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_%1$s_org ON public.%1$I(organization_id) '
    'WHERE organization_id IS NOT NULL', t);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_%1$s_run ON public.%1$I(ingestion_run_id)', t);

  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

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

  EXECUTE format('REVOKE ALL ON public.%I FROM authenticated, anon', t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END
$$;

-- "Latest value per metric for this account" is the only read the UI makes.
CREATE INDEX IF NOT EXISTS idx_social_account_metrics_snapshot_latest
  ON public.social_account_metrics_snapshot (connected_account_id, metric_key, observed_at DESC);
-- Same read for posts: the newest snapshot per video and metric.
CREATE INDEX IF NOT EXISTS idx_social_post_metrics_snapshot_latest
  ON public.social_post_metrics_snapshot (connected_account_id, platform_post_id, metric_key, observed_at DESC);

-- ── 6. social_snapshot_summary — the read the UI makes ──────────────────────
--
-- Snapshot tables grow by (videos x metrics) every run: 200 videos x 4 metrics
-- x 4 runs a day x 30 days is ~96,000 rows per account. PostgREST caps a
-- response at max_rows (1000 by default on Supabase) and truncates WITHOUT an
-- error, so a client reading raw rows would get an arbitrary slice and render
-- a "latest" value that is not the latest. That is a fabricated number.
--
-- So the database does the reduction: one row per (account, post, metric)
-- with the latest and earliest observation in the window and how many there
-- were. SECURITY INVOKER, so RLS on the underlying tables scopes it to exactly
-- what the caller could read anyway. Account-level facts come back with
-- platform_post_id NULL. Ordered, so a caller can page through it with Range.

CREATE OR REPLACE FUNCTION public.social_snapshot_summary(p_since timestamptz)
RETURNS TABLE (
  connected_account_id uuid,
  platform             text,
  platform_post_id     text,
  post_id              uuid,
  metric_key           text,
  latest_value         numeric,
  latest_at            timestamptz,
  earliest_value       numeric,
  earliest_at          timestamptz,
  observations         bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  -- The window is clamped to 400 days whatever the caller passes. An unbounded
  -- p_since would aggregate an account's whole history on every page read,
  -- and a statement timeout would take the analytics page down with it.
  WITH bounds AS (
    SELECT greatest(coalesce(p_since, now() - interval '30 days'), now() - interval '400 days') AS since
  ),
  facts AS (
    SELECT s.connected_account_id, s.platform, s.platform_post_id, s.post_id,
           s.metric_key, s.observed_at, s.value
    FROM public.social_post_metrics_snapshot s, bounds b
    WHERE s.observed_at >= b.since
    UNION ALL
    SELECT a.connected_account_id, a.platform, NULL::text, NULL::uuid,
           a.metric_key, a.observed_at, a.value
    FROM public.social_account_metrics_snapshot a, bounds b
    WHERE a.observed_at >= b.since
  )
  SELECT f.connected_account_id,
         (array_agg(f.platform ORDER BY f.observed_at DESC))[1],
         f.platform_post_id,
         (array_agg(f.post_id ORDER BY f.observed_at DESC))[1],
         f.metric_key,
         (array_agg(f.value ORDER BY f.observed_at DESC))[1],
         max(f.observed_at),
         (array_agg(f.value ORDER BY f.observed_at ASC))[1],
         min(f.observed_at),
         count(*)
  FROM facts f
  GROUP BY f.connected_account_id, f.platform_post_id, f.metric_key
  ORDER BY f.connected_account_id, f.platform_post_id NULLS FIRST, f.metric_key
$$;

COMMENT ON FUNCTION public.social_snapshot_summary(timestamptz) IS
  'Latest and earliest observation per (account, post, metric) since p_since, '
  'for snapshot-shaped platforms. Exists because PostgREST truncates raw reads '
  'silently at max_rows. SECURITY INVOKER: RLS scopes it to the caller.';

REVOKE ALL ON FUNCTION public.social_snapshot_summary(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_snapshot_summary(timestamptz) TO authenticated;

-- ── 7. Atomic JSON merges for the ingester ──────────────────────────────────
--
-- The ingester reads a row, spends up to 30s talking to TikTok, then writes a
-- JSON column back. Written from the client as "read, modify, write whole",
-- anything another writer put in that column during those 30s is lost — the
-- workflow_state defect of 2026-09-09 (441fd12) in a new place. These do the
-- merge inside one UPDATE, so there is no window.
--
-- Service role only: they are the ingester's write path, and a browser that
-- could call them could rewrite any post's publish state or any account's
-- profile.

-- Merge p_patch into posts.workflow_state->'tiktok'. When p_new_external_id is
-- given, also swap external_post_id — but ONLY if it still equals
-- p_expected_external_id (compare-and-swap). Returns whether a row changed.
CREATE OR REPLACE FUNCTION public.merge_post_tiktok_state(
  p_post_id              uuid,
  p_expected_external_id text,
  p_new_external_id      text,
  p_patch                jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  changed integer;
BEGIN
  UPDATE public.posts
  SET workflow_state = jsonb_set(
        coalesce(workflow_state, '{}'::jsonb),
        '{tiktok}',
        coalesce(workflow_state -> 'tiktok', '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb),
        true),
      external_post_id = coalesce(p_new_external_id, external_post_id)
  WHERE id = p_post_id
    AND external_post_id IS NOT DISTINCT FROM p_expected_external_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed > 0;
END;
$$;

-- Merge top-level keys into connected_accounts.platform_metadata. Keys not in
-- p_patch (author_urn from connect, anything added later) are untouched.
CREATE OR REPLACE FUNCTION public.merge_account_platform_metadata(
  p_account_id uuid,
  p_patch      jsonb
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.connected_accounts
  SET platform_metadata = coalesce(platform_metadata, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb)
  WHERE id = p_account_id;
$$;

REVOKE ALL ON FUNCTION public.merge_post_tiktok_state(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_account_platform_metadata(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_post_tiktok_state(uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_account_platform_metadata(uuid, jsonb) TO service_role;

-- ── 8. Collect one account now, not in up to six hours ──────────────────────
--
-- The cron runs every six hours. A TikTok account connected just before a
-- review recording would show "no collection has run" for the whole session.
-- The connect callback calls this to queue one ingestion for just that
-- account, through the SAME authenticated path the cron uses (Vault secrets,
-- X-Invoke-Secret), so no new secret has to exist anywhere else.
--
-- SECURITY DEFINER because it reads Vault; service role only, because it
-- spends shared API budget on demand. Returns the pg_net request id.

CREATE OR REPLACE FUNCTION public.request_social_ingestion(p_account_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_url   text;
  role_key   text;
  invoke_key text;
  request_id bigint;
BEGIN
  SELECT substring(command from 'https://[a-z0-9]+\.supabase\.co') INTO base_url
  FROM cron.job WHERE jobname = 'ingest-social-analytics' LIMIT 1;
  SELECT decrypted_secret INTO role_key   FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  SELECT decrypted_secret INTO invoke_key FROM vault.decrypted_secrets WHERE name = 'function_invoke_secret' LIMIT 1;

  -- Fail loudly: a request that cannot authenticate would 401 and report
  -- nothing, which is the silent failure the cron migration refuses too.
  IF base_url IS NULL OR role_key IS NULL OR invoke_key IS NULL THEN
    RAISE EXCEPTION 'request_social_ingestion: cron job URL or Vault secrets missing (url=%, role=%, invoke=%)',
      base_url IS NOT NULL, role_key IS NOT NULL, invoke_key IS NOT NULL;
  END IF;

  -- body is jsonb: pg_net's signature. A ::text cast here is the 2026-09-10
  -- regression that killed scheduled publishing (check-pgnet-body-type.cjs).
  SELECT net.http_post(
    url     := base_url || '/functions/v1/ingest-social-analytics',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || role_key,
      'X-Invoke-Secret', invoke_key
    ),
    body    := jsonb_build_object('account_id', p_account_id)
  ) INTO request_id;

  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_social_ingestion(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_social_ingestion(uuid) TO service_role;

-- ── 4. The meter ────────────────────────────────────────────────────────────

INSERT INTO public.social_api_quota_limits
  (platform, quota_key, daily_limit, unit, reset_timezone, reserve_percent, notes)
VALUES
  ('tiktok', 'analytics', 600, 'requests', 'UTC', 20,
   'TikTok user/info + video/list + publish status reads for analytics, counted per '
   'request. UNVERIFIED CEILING: TikTok documents per-minute rate limits, not a daily '
   'cap; 600/day is a conservative working budget so a large backfill cannot starve '
   'other accounts. Separate from tiktok/general so reading analytics never costs the '
   'ability to publish.')
ON CONFLICT (platform, quota_key) DO UPDATE
SET daily_limit     = excluded.daily_limit,
    unit            = excluded.unit,
    reset_timezone  = excluded.reset_timezone,
    reserve_percent = excluded.reserve_percent,
    notes           = excluded.notes,
    updated_at      = now();

-- ── 5. Post-conditions — exercised, not merely asserted ─────────────────────

DO $$
DECLARE
  probe_user    uuid;
  other_user    uuid;
  probe_account uuid;
  probe_run     uuid;
  bad           text;
  t             text;
BEGIN
  -- 5a. The false claim is gone.
  IF EXISTS (SELECT 1 FROM public.social_metric_platform_support
             WHERE platform = 'tiktok' AND metric_key = 'saves') THEN
    RAISE EXCEPTION 'post-condition failed: TikTok still claims to report saves';
  END IF;

  -- 5b. Every TikTok mapping names a field TikTok actually documents. A mapping
  --     to an invented field is a metric that can never arrive.
  SELECT string_agg(platform_metric_name, ', ') INTO bad
  FROM public.social_metric_platform_support
  WHERE platform = 'tiktok'
    AND platform_metric_name NOT IN (
      'view_count', 'like_count', 'comment_count', 'share_count',          -- Video object
      'follower_count', 'following_count', 'likes_count', 'video_count'    -- User object (user.info.stats)
    );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'post-condition failed: TikTok mappings to undocumented fields: %', bad;
  END IF;

  -- 5c. RLS on, policy present, no client writes — for both new tables.
  FOREACH t IN ARRAY ARRAY['social_account_metrics_snapshot', 'social_platform_posts'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'post-condition failed: RLS is not enabled on public.%', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = t AND policyname = t || '_read') THEN
      RAISE EXCEPTION 'post-condition failed: public.% has no read policy', t;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE') THEN
      RAISE EXCEPTION 'post-condition failed: authenticated can write public.% — ingestion only', t;
    END IF;
  END LOOP;

  -- 5c2. The summary function must run as the CALLER. A SECURITY DEFINER
  --      version would bypass RLS and return every tenant's analytics.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'social_snapshot_summary' AND p.prosecdef) THEN
    RAISE EXCEPTION 'post-condition failed: social_snapshot_summary is SECURITY DEFINER — it would bypass RLS';
  END IF;
  IF has_function_privilege('anon', 'public.social_snapshot_summary(timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'post-condition failed: anon can execute social_snapshot_summary';
  END IF;

  -- 5c3. The ingester's write paths are not callable from a browser.
  IF has_function_privilege('authenticated', 'public.merge_post_tiktok_state(uuid, text, text, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.merge_account_platform_metadata(uuid, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.request_social_ingestion(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.request_social_ingestion(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'post-condition failed: an ingester write function is executable by a client role';
  END IF;

  -- 5d. The meter is visible where the worker reads it.
  IF NOT EXISTS (SELECT 1 FROM public.social_api_quota_today
                 WHERE platform = 'tiktok' AND quota_key = 'analytics') THEN
    RAISE EXCEPTION 'post-condition failed: tiktok/analytics meter not visible in social_api_quota_today';
  END IF;

  -- 5e. The tenancy trigger corrects a falsified owner, and the row dies with
  --     its account. Same hostile-write probe as 20260909140000 §7e/7f.
  SELECT id INTO probe_user FROM auth.users LIMIT 1;
  IF probe_user IS NOT NULL THEN
    SELECT id INTO other_user FROM auth.users WHERE id <> probe_user LIMIT 1;

    INSERT INTO public.connected_accounts
      (user_id, platform, scope, account_id, account_name, display_name, username,
       provider, connection_status, is_mock)
    VALUES
      (probe_user, 'tiktok', 'personal', '__tiktok_analytics_probe__', 'probe', 'probe', 'probe',
       'tiktok', 'active', false)
    RETURNING id INTO probe_account;

    INSERT INTO public.social_ingestion_runs
      (connected_account_id, platform, source, mode, status, finished_at)
    VALUES
      (probe_account, 'tiktok', '__probe__', 'incremental', 'succeeded', now())
    RETURNING id INTO probe_run;

    INSERT INTO public.social_account_metrics_snapshot
      (connected_account_id, metric_key, observed_at, value, ingestion_run_id,
       user_id, scope, platform)
    VALUES
      (probe_account, 'followers_total', now(), 7, probe_run,
       coalesce(other_user, '00000000-0000-0000-0000-000000000000'::uuid),
       'organization', 'youtube');

    IF NOT EXISTS (
      SELECT 1 FROM public.social_account_metrics_snapshot
      WHERE connected_account_id = probe_account
        AND user_id = probe_user AND scope = 'personal' AND platform = 'tiktok'
    ) THEN
      RAISE EXCEPTION 'post-condition failed: tenancy trigger did not overwrite a falsified owner';
    END IF;

    -- The summary reduces two observations to latest/earliest, never a sum.
    INSERT INTO public.social_account_metrics_snapshot
      (connected_account_id, metric_key, observed_at, value, ingestion_run_id,
       user_id, scope, platform)
    VALUES
      (probe_account, 'followers_total', now() - interval '1 day', 3, probe_run,
       probe_user, 'personal', 'tiktok');

    IF NOT EXISTS (
      SELECT 1 FROM public.social_snapshot_summary(now() - interval '7 days') s
      WHERE s.connected_account_id = probe_account
        AND s.metric_key = 'followers_total'
        AND s.platform_post_id IS NULL
        AND s.latest_value = 7 AND s.earliest_value = 3 AND s.observations = 2
    ) THEN
      RAISE EXCEPTION 'post-condition failed: social_snapshot_summary did not return latest=7, earliest=3, observations=2';
    END IF;

    INSERT INTO public.social_platform_posts
      (connected_account_id, platform_post_id, title, last_seen_at, ingestion_run_id,
       user_id, scope, platform)
    VALUES
      (probe_account, '7300000000000000001', 'probe', now(), probe_run,
       coalesce(other_user, '00000000-0000-0000-0000-000000000000'::uuid),
       'organization', 'youtube');

    IF NOT EXISTS (
      SELECT 1 FROM public.social_platform_posts
      WHERE connected_account_id = probe_account
        AND user_id = probe_user AND scope = 'personal' AND platform = 'tiktok'
    ) THEN
      RAISE EXCEPTION 'post-condition failed: tenancy trigger did not correct social_platform_posts';
    END IF;

    -- The metadata merge keeps keys it was not given.
    UPDATE public.connected_accounts
    SET platform_metadata = '{"author_urn": "keep-me"}'::jsonb
    WHERE id = probe_account;
    PERFORM public.merge_account_platform_metadata(probe_account, '{"tiktok_profile": {"username": "probe"}}'::jsonb);
    IF NOT EXISTS (
      SELECT 1 FROM public.connected_accounts
      WHERE id = probe_account
        AND platform_metadata ->> 'author_urn' = 'keep-me'
        AND platform_metadata -> 'tiktok_profile' ->> 'username' = 'probe'
    ) THEN
      RAISE EXCEPTION 'post-condition failed: merge_account_platform_metadata dropped an existing key';
    END IF;

    DELETE FROM public.connected_accounts WHERE id = probe_account;

    IF EXISTS (SELECT 1 FROM public.social_account_metrics_snapshot
               WHERE connected_account_id = probe_account)
       OR EXISTS (SELECT 1 FROM public.social_platform_posts
                  WHERE connected_account_id = probe_account) THEN
      RAISE EXCEPTION 'post-condition failed: TikTok analytics rows survived their account';
    END IF;
  END IF;

  RAISE NOTICE 'tiktok analytics schema live: saves claim removed, account snapshots, tiktok/analytics meter.';
END;
$$;

COMMIT;
