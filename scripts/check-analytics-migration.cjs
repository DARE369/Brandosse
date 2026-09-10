#!/usr/bin/env node
/**
 * check-analytics-migration.cjs — 20260909140000_social_analytics_foundation
 * actually applies, is idempotent, and its rules actually bite.
 *
 * ── Why a separate suite from check-migrations-apply.cjs ─────────────────────
 * That guard states its own scope: "The brand_kit / brand_assets chain only.
 * The full migration set has ordering dependencies on tables this does not
 * create, and pretending to verify all of them would be worse than verifying
 * one chain honestly." Its stubs create auth.users and storage.* and nothing
 * else. The analytics migration needs connected_accounts, posts,
 * organization_members, publish_providers and the authenticated/anon roles, so
 * it needs a different stub set — a different suite, not a longer CHAIN.
 *
 * The Docker plumbing here is duplicated from that file rather than extracted.
 * Deliberate, and worth stating: neither guard can be executed on this dev
 * machine (Docker Desktop is installed but not running), so refactoring a
 * working guard to share code with a new one would mean shipping an untested
 * change to something that currently works. Merge them into one runner with a
 * shared harness once there is a machine that can run both and prove the merge.
 *
 * ── What this proves that reading the SQL cannot ─────────────────────────────
 * The migration carries its own post-conditions, and applying it is therefore
 * most of the test: a failed assertion aborts the transaction and this guard
 * reports it. But post-conditions can only assert what SUCCEEDS. A constraint
 * that must REJECT something cannot be tested from inside the migration,
 * because the rejection would roll the migration back.
 *
 * So the assertions below are mostly the rejections — the cases where a
 * constraint exists but might not bite. Every one of them corresponds to a way
 * this schema could silently accept fabricated or untraceable data:
 *
 *   * a metric with no ingestion run  → a number with no provenance
 *   * a metric with no value          → would DEFAULT to 0 if anyone added one
 *   * a failed run with no error code → the silent failure Law 3 forbids
 *   * a finished run with no end time → the reaper can never close it
 *   * retention outside 0..1          → a curve that cannot be drawn
 *
 * ── Stubs are stubs ─────────────────────────────────────────────────────────
 * The dependency tables below mirror only the columns this migration touches.
 * That is enough to prove the migration's own logic — triggers, constraints,
 * RLS, cascades, post-conditions — and is NOT a claim about how it behaves
 * against the live schema, which is drifted (89 tables live vs 65 in
 * migrations, per CLAUDE.md). Applying against production remains a separate,
 * reviewed step.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const CONTAINER = 'analytics-migcheck';
const IMAGE = 'postgres:16-alpine';
// Applied in order, in one throwaway database. The capability flip depends on
// publish_providers, which the stub schema creates, so both are verifiable here.
const MIGRATIONS_UNDER_TEST = [
  '20260909140000_social_analytics_foundation.sql',
  '20260909160000_mark_tiktok_youtube_publishable.sql',
];

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

/**
 * Minimal Supabase + app surface the analytics migration references.
 *
 * The roles matter as much as the tables: the migration issues GRANTs to
 * `authenticated` and asserts with has_table_privilege(). Without the roles
 * those statements error, and a suite that cannot get past the GRANTs proves
 * nothing about the RLS below them.
 */
const STUBS = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon;          END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role;  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT NULL::uuid $fn$;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

-- Mirrors 20260904140000. The FK from connected_accounts.provider points here,
-- so 'youtube' must be registered or the post-condition probe cannot insert.
CREATE TABLE IF NOT EXISTS public.publish_providers (
  provider text PRIMARY KEY,
  kind text NOT NULL DEFAULT 'direct',
  is_supported boolean NOT NULL DEFAULT false,
  requires_credential boolean NOT NULL DEFAULT true,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.publish_providers (provider) VALUES
  ('youtube'), ('tiktok'), ('linkedin'), ('mock'), ('zernio'), ('direct')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.connected_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'personal',
  platform text NOT NULL,
  account_id text,
  account_name text,
  display_name text,
  username text,
  provider text REFERENCES public.publish_providers(provider),
  connection_status text DEFAULT 'active',
  is_mock boolean DEFAULT false
);

INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}') ON CONFLICT DO NOTHING;
`;

/**
 * Fixtures created AFTER the migration, for the rejection assertions below.
 * Kept separate from STUBS because they depend on tables the migration makes.
 */
const FIXTURES = `
INSERT INTO public.connected_accounts
  (id, user_id, scope, platform, account_id, provider, connection_status, is_mock)
VALUES
  ('33333333-3333-3333-3333-333333333333', '${USER_A}', 'personal', 'youtube',
   'fixture-channel', 'youtube', 'active', false);

INSERT INTO public.social_ingestion_runs (id, connected_account_id, platform, source, mode, status, finished_at)
VALUES ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333',
        'youtube', 'youtube_analytics_reports', 'incremental', 'succeeded', now());
`;

const ACCOUNT = "'33333333-3333-3333-3333-333333333333'";
const RUN = "'44444444-4444-4444-4444-444444444444'";

// [label, sql, mustSucceed]. The rejections are the point: a constraint that
// exists but does not bite is decoration.
const ASSERTIONS = [
  [
    'tiktok and youtube are registered as publishable, meta is not',
    `DO $t$ BEGIN
       IF EXISTS (SELECT 1 FROM public.publish_providers
                  WHERE provider IN ('tiktok','youtube') AND is_supported IS NOT TRUE) THEN
         RAISE EXCEPTION 'an adapter exists but the provider still reports unsupported — the UI would say \"Not yet supported\" for a working account';
       END IF;
       IF EXISTS (SELECT 1 FROM public.publish_providers
                  WHERE provider IN ('meta','facebook','instagram') AND is_supported IS TRUE) THEN
         RAISE EXCEPTION 'a provider with no adapter is marked supported';
       END IF;
     END $t$;`,
    true,
  ],
  [
    'the metric vocabulary is seeded',
    `DO $t$ BEGIN
       IF (SELECT count(*) FROM public.social_metric_definitions) < 15 THEN
         RAISE EXCEPTION 'metric definitions not seeded';
       END IF;
     END $t$;`,
    true,
  ],
  [
    'TikTok is snapshot-only and claims no impressions',
    `DO $t$ BEGIN
       IF EXISTS (SELECT 1 FROM public.social_metric_platform_support
                  WHERE platform = 'tiktok' AND granularity <> 'snapshot') THEN
         RAISE EXCEPTION 'tiktok must be snapshot-only — it exposes no time series';
       END IF;
       IF EXISTS (SELECT 1 FROM public.social_metric_platform_support
                  WHERE platform = 'tiktok' AND metric_key = 'impressions') THEN
         RAISE EXCEPTION 'tiktok must not claim impressions';
       END IF;
     END $t$;`,
    true,
  ],
  [
    'a well-formed daily metric is accepted',
    `INSERT INTO public.social_post_metrics_daily
       (connected_account_id, platform_post_id, metric_key, metric_date, value,
        reporting_timezone, ingestion_run_id, user_id, scope, platform)
     VALUES (${ACCOUNT}, 'vid1', 'views', DATE '2026-09-08', 1234,
             'America/Los_Angeles', ${RUN}, '${USER_A}', 'personal', 'youtube');`,
    true,
  ],
  [
    'reject a metric with NO ingestion run — a number with no provenance',
    `INSERT INTO public.social_post_metrics_daily
       (connected_account_id, platform_post_id, metric_key, metric_date, value,
        reporting_timezone, user_id, scope, platform)
     VALUES (${ACCOUNT}, 'vid2', 'views', DATE '2026-09-08', 1, 'UTC', '${USER_A}', 'personal', 'youtube');`,
    false,
  ],
  [
    'reject a metric with NO value — there must be no DEFAULT 0',
    `INSERT INTO public.social_post_metrics_daily
       (connected_account_id, platform_post_id, metric_key, metric_date,
        reporting_timezone, ingestion_run_id, user_id, scope, platform)
     VALUES (${ACCOUNT}, 'vid3', 'views', DATE '2026-09-08', 'UTC', ${RUN}, '${USER_A}', 'personal', 'youtube');`,
    false,
  ],
  [
    'reject a metric with NO reporting timezone',
    `INSERT INTO public.social_post_metrics_daily
       (connected_account_id, platform_post_id, metric_key, metric_date, value,
        ingestion_run_id, user_id, scope, platform)
     VALUES (${ACCOUNT}, 'vid4', 'views', DATE '2026-09-08', 5, ${RUN}, '${USER_A}', 'personal', 'youtube');`,
    false,
  ],
  [
    'reject an unknown metric_key — the vocabulary is closed',
    `INSERT INTO public.social_post_metrics_daily
       (connected_account_id, platform_post_id, metric_key, metric_date, value,
        reporting_timezone, ingestion_run_id, user_id, scope, platform)
     VALUES (${ACCOUNT}, 'vid5', 'not_a_real_metric', DATE '2026-09-08', 5,
             'UTC', ${RUN}, '${USER_A}', 'personal', 'youtube');`,
    false,
  ],
  [
    'the tenancy trigger overwrites a falsified user_id',
    `DO $t$
     BEGIN
       INSERT INTO public.social_post_metrics_snapshot
         (connected_account_id, platform_post_id, metric_key, observed_at, value,
          ingestion_run_id, user_id, scope, platform)
       VALUES (${ACCOUNT}, 'vid6', 'views', now(), 99, ${RUN},
               '${USER_B}', 'organization', 'tiktok');

       IF NOT EXISTS (
         SELECT 1 FROM public.social_post_metrics_snapshot
         WHERE platform_post_id = 'vid6'
           AND user_id = '${USER_A}' AND scope = 'personal' AND platform = 'youtube'
       ) THEN
         RAISE EXCEPTION 'trigger did not correct falsified tenancy';
       END IF;
     END $t$;`,
    true,
  ],
  [
    "reject a 'failed' run with no error code — a failure must be explicable",
    `INSERT INTO public.social_ingestion_runs
       (connected_account_id, platform, source, mode, status, finished_at)
     VALUES (${ACCOUNT}, 'youtube', 's', 'incremental', 'failed', now());`,
    false,
  ],
  [
    'reject a finished run with no finished_at — the reaper could never close it',
    `INSERT INTO public.social_ingestion_runs
       (connected_account_id, platform, source, mode, status)
     VALUES (${ACCOUNT}, 'youtube', 's', 'incremental', 'succeeded');`,
    false,
  ],
  [
    "reject a 'running' run that already claims to have finished",
    `INSERT INTO public.social_ingestion_runs
       (connected_account_id, platform, source, mode, status, finished_at)
     VALUES (${ACCOUNT}, 'youtube', 's', 'incremental', 'running', now());`,
    false,
  ],
  [
    'reject a backwards ingestion window',
    `INSERT INTO public.social_ingestion_runs
       (connected_account_id, platform, source, mode, status, finished_at, window_start, window_end)
     VALUES (${ACCOUNT}, 'youtube', 's', 'backfill', 'succeeded', now(),
             DATE '2026-09-08', DATE '2026-09-01');`,
    false,
  ],
  [
    'reject a retention point outside 0..1',
    `INSERT INTO public.social_retention_curves
       (connected_account_id, platform_post_id, observed_at, elapsed_ratio, watch_ratio,
        ingestion_run_id, user_id, scope, platform)
     VALUES (${ACCOUNT}, 'vid7', now(), 1.5, 0.5, ${RUN}, '${USER_A}', 'personal', 'youtube');`,
    false,
  ],
  [
    'ACCEPT a watch_ratio above 1 — a rewatched segment is real, not an error',
    `INSERT INTO public.social_retention_curves
       (connected_account_id, platform_post_id, observed_at, elapsed_ratio, watch_ratio,
        ingestion_run_id, user_id, scope, platform)
     VALUES (${ACCOUNT}, 'vid8', now(), 0.25, 1.8, ${RUN}, '${USER_A}', 'personal', 'youtube');`,
    true,
  ],
  [
    'the reaper closes a run stuck in the non-terminal running state',
    `DO $t$
     DECLARE stuck uuid;
     BEGIN
       INSERT INTO public.social_ingestion_runs
         (connected_account_id, platform, source, mode, status, started_at)
       VALUES (${ACCOUNT}, 'youtube', 'stuck', 'incremental', 'running', now() - interval '3 hours')
       RETURNING id INTO stuck;

       PERFORM public.reap_social_ingestion();

       IF (SELECT status FROM public.social_ingestion_runs WHERE id = stuck) <> 'abandoned' THEN
         RAISE EXCEPTION 'the reaper left a 3-hour-old running row untouched';
       END IF;
       IF (SELECT finished_at FROM public.social_ingestion_runs WHERE id = stuck) IS NULL THEN
         RAISE EXCEPTION 'the reaper abandoned a run without recording when';
       END IF;
     END $t$;`,
    true,
  ],
  [
    'the reaper deletes raw payloads past their retention deadline',
    `DO $t$
     BEGIN
       INSERT INTO public.social_ingestion_raw
         (ingestion_run_id, request_summary, payload, expires_at)
       VALUES (${RUN}, 'GET /probe', '{"a":1}'::jsonb, now() - interval '1 day');

       PERFORM public.reap_social_ingestion();

       IF EXISTS (SELECT 1 FROM public.social_ingestion_raw WHERE expires_at <= now()) THEN
         RAISE EXCEPTION 'expired raw payloads survived the reaper — the 30-day YouTube retention cap is not enforced';
       END IF;
     END $t$;`,
    true,
  ],
  [
    'deleting the account deletes its analytics — disconnect must leave nothing behind',
    `DO $t$
     BEGIN
       DELETE FROM public.connected_accounts WHERE id = ${ACCOUNT};

       IF EXISTS (SELECT 1 FROM public.social_post_metrics_daily WHERE connected_account_id = ${ACCOUNT})
          OR EXISTS (SELECT 1 FROM public.social_post_metrics_snapshot WHERE connected_account_id = ${ACCOUNT})
          OR EXISTS (SELECT 1 FROM public.social_retention_curves WHERE connected_account_id = ${ACCOUNT})
          OR EXISTS (SELECT 1 FROM public.social_ingestion_runs WHERE connected_account_id = ${ACCOUNT}) THEN
         RAISE EXCEPTION 'analytics survived the deletion of its connected account';
       END IF;
     END $t$;`,
    true,
  ],
];

function docker(args, options = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', ...options });
}

function psql(sql, { stopOnError = true } = {}) {
  return docker(
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'testdb', '-q',
      '-v', `ON_ERROR_STOP=${stopOnError ? 1 : 0}`],
    { input: sql },
  );
}

function cleanup() {
  docker(['rm', '-f', CONTAINER], { stdio: 'ignore' });
}

function main() {
  for (const name of MIGRATIONS_UNDER_TEST) {
    if (!fs.existsSync(path.join(MIGRATIONS, name))) {
      console.error(
        `✖ check-analytics-migration: ${name} is missing from disk.\n` +
        '  If it was renamed, repoint this guard. If it was removed, remove this guard\n' +
        '  with it — but note these migrations have no other verification.',
      );
      process.exit(1);
    }
  }

  if (docker(['ps']).status !== 0) {
    // Loud, and explicitly not a pass. Same discipline as check-migrations-apply:
    // a check that quietly does nothing is the failure this repo keeps finding.
    console.log(
      '\x1b[33m⚠ check-analytics-migration SKIPPED\x1b[0m  Docker is not available on this machine.\n' +
      '  This check is NOT passing — it did not run. CI has Docker and will run it.\n' +
      '  To run locally: start Docker Desktop, then `node scripts/check-analytics-migration.cjs`.',
    );
    return;
  }

  const failures = [];
  cleanup();

  try {
    const run = docker([
      'run', '-d', '--name', CONTAINER,
      '-e', 'POSTGRES_PASSWORD=test', '-e', 'POSTGRES_DB=testdb',
      IMAGE,
    ]);
    if (run.status !== 0) {
      console.error(`✖ check-analytics-migration: could not start ${IMAGE}\n${run.stderr}`);
      process.exit(1);
    }

    // Readiness proven with a real query, never pg_isready: the postgres image
    // runs a TEMPORARY server for its init scripts, which pg_isready happily
    // reports as ready, and the check then races the restart.
    let ready = false;
    for (let i = 0; i < 90; i += 1) {
      if (psql('SELECT 1;').status === 0) { ready = true; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
    if (!ready) {
      console.error('✖ check-analytics-migration: Postgres never became ready');
      process.exit(1);
    }

    const stub = psql(STUBS);
    if (stub.status !== 0) {
      failures.push(`Stub schema failed to apply:\n${stub.stderr.trim()}`);
    }

    // ── Apply each migration once, then again ────────────────────────────────
    // Each migration's own post-conditions run here. A failed assertion aborts
    // the transaction, so applying it IS the test for everything inside it.
    let applied = true;
    for (const name of MIGRATIONS_UNDER_TEST) {
      const sql = fs.readFileSync(path.join(MIGRATIONS, name), 'utf8');

      const first = psql(sql);
      if (first.status !== 0) {
        failures.push(
          `${name} failed to apply:\n${first.stderr.trim()}\n` +
          '    (If the message names a post-condition, the migration applied but its own\n' +
          '     assertion rejected the result — read that message, it names the rule.)',
        );
        applied = false;
        break;
      }

      // CLAUDE.md requires idempotence.
      const second = psql(sql);
      if (second.status !== 0) {
        failures.push(
          `${name} is NOT IDEMPOTENT — it applied once and failed on the second run:\n` +
          second.stderr.trim(),
        );
      }
    }

    if (applied) {
      const fixtures = psql(FIXTURES);
      if (fixtures.status !== 0) {
        failures.push(`Fixtures failed to apply:\n${fixtures.stderr.trim()}`);
      } else {
        for (const [label, assertionSql, mustSucceed] of ASSERTIONS) {
          const result = psql(assertionSql);
          const succeeded = result.status === 0;
          if (mustSucceed && !succeeded) {
            failures.push(`Expected to SUCCEED but failed — ${label}:\n${result.stderr.trim()}`);
          }
          if (!mustSucceed && succeeded) {
            failures.push(
              `Expected to be REJECTED but was accepted — ${label}.\n` +
              '    The constraint exists but does not bite.',
            );
          }
        }
      }
    }
  } finally {
    cleanup();
  }

  if (failures.length > 0) {
    console.error('✖ check-analytics-migration failed.\n');
    for (const f of failures) console.error(`- ${f}\n`);
    process.exit(1);
  }

  console.log(
    'check-analytics-migration passed — the analytics schema applies, is idempotent, '
    + 'its post-conditions hold, and its constraints actually reject bad data.',
  );
}

main();
