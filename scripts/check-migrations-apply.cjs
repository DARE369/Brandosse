#!/usr/bin/env node
/**
 * check-migrations-apply.cjs — the brand-kit migrations actually apply, are
 * idempotent, and their constraints actually reject bad data.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * CLAUDE.md requires migrations to be "idempotent, transactional, and assert
 * their post-condition". Nothing verified any of that. A migration was correct
 * if it looked correct, and the live schema is already drifted (89 tables live
 * against 65 in migrations), so nobody could safely test one by running it.
 *
 * This runs them against a throwaway Postgres in Docker. On its first use it
 * immediately found a real defect in 20260901120000: a PL/pgSQL variable named
 * `is_nullable` shadows the information_schema column of the same name, so the
 * post-condition block aborted with "column reference is ambiguous". That
 * migration would have failed on the production database.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 * The brand_kit / brand_assets chain only. The full migration set has ordering
 * dependencies on tables this does not create, and pretending to verify all of
 * them would be worse than verifying one chain honestly. Extend CHAIN as other
 * chains are made testable.
 *
 * Skips itself with a clear message when Docker is unavailable, rather than
 * failing a developer machine that legitimately has no Docker — but it must
 * never skip silently, because a check that quietly does nothing is the exact
 * failure this repo keeps finding.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const CONTAINER = 'bk-migcheck';
const IMAGE = 'postgres:16-alpine';

// Applied in order. Two of these fail partway on tables outside this chain
// (public.sessions, storage.buckets); `tolerateUnrelated` says so explicitly so
// a genuine failure in the brand_kit half is still caught by the assertions at
// the end rather than being written off.
const CHAIN = [
  { file: '20260220041938_brand_kit.sql', tolerateUnrelated: true },
  { file: '20260330111000_brand_kit_version_hash.sql' },
  { file: '20260708140000_brand_kit_multi_kit.sql', tolerateUnrelated: true },
  { file: '20260831020000_brand_kit_derived_banned_phrases.sql' },
  { file: '20260901120000_brand_kit_design_layer.sql', idempotent: true },
];

// Minimal Supabase surface these migrations reference.
const STUBS = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid
);
`;

// Each assertion is [label, sql, mustSucceed]. The rejections are the point:
// a CHECK constraint that exists but does not bite is decoration.
const USER_ID = '11111111-1111-1111-1111-111111111111';
const ASSERTIONS = [
  ['seed user', `INSERT INTO auth.users (id) VALUES ('${USER_ID}') ON CONFLICT DO NOTHING;`, true],
  ['seed kit', `INSERT INTO public.brand_kit (user_id, brand_name) VALUES ('${USER_ID}', 'Test Brand');`, true],
  [
    'design columns default to empty, never NULL',
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM public.brand_kit WHERE color_roles IS NULL OR contrast_pairs IS NULL
                    OR type_scale IS NULL OR extraction_evidence IS NULL) THEN
         RAISE EXCEPTION 'a design column defaulted to NULL';
       END IF;
       IF NOT EXISTS (SELECT 1 FROM public.brand_kit WHERE color_roles = '{}'::jsonb
                        AND contrast_pairs = '[]'::jsonb AND design_setup_completed = false) THEN
         RAISE EXCEPTION 'design column defaults are not the documented empty values';
       END IF;
     END $$;`,
    true,
  ],
  ['reject a string in color_roles', `UPDATE public.brand_kit SET color_roles = '"nope"'::jsonb;`, false],
  ['reject an array in color_roles', `UPDATE public.brand_kit SET color_roles = '[1,2]'::jsonb;`, false],
  ['reject an object in contrast_pairs', `UPDATE public.brand_kit SET contrast_pairs = '{}'::jsonb;`, false],
  ['reject NULL in color_roles', `UPDATE public.brand_kit SET color_roles = NULL;`, false],
  [
    'accept a well-formed design layer',
    `UPDATE public.brand_kit SET
       color_roles = '{"background":{"hex":"#0a2540","name":"Navy","source":"measured","contrast_vs_background":0}}'::jsonb,
       contrast_pairs = '[{"fg":"#ffffff","bg":"#0a2540","ratio":14.2,"wcag":"AAA"}]'::jsonb;`,
    true,
  ],
  [
    'reject an unknown brand_assets.variant',
    `INSERT INTO public.brand_assets (user_id, brand_kit_id, name, asset_type, file_name, mime_type, storage_path, variant)
       SELECT '${USER_ID}', id, 'l', 'logo', 'l.svg', 'image/svg+xml', 'p', 'not_a_variant' FROM public.brand_kit;`,
    false,
  ],
  [
    'accept a harvested logo awaiting review',
    `INSERT INTO public.brand_assets (user_id, brand_kit_id, name, asset_type, file_name, mime_type, storage_path, variant, source_url, status)
       SELECT '${USER_ID}', id, 'l', 'logo', 'l.svg', 'image/svg+xml', 'p', 'dark_bg', 'https://x.test/', 'proposed' FROM public.brand_kit;`,
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
  if (docker(['ps']).status !== 0) {
    // Loud, and explicitly not a pass.
    console.log(
      '\x1b[33m⚠ check-migrations-apply SKIPPED\x1b[0m  Docker is not available on this machine.\n' +
      '  This check is not passing — it did not run. CI has Docker and will run it.',
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
      console.error(`✖ check-migrations-apply: could not start ${IMAGE}\n${run.stderr}`);
      process.exit(1);
    }

    // Readiness is proven with a real QUERY, not with pg_isready.
    //
    // The postgres image starts a temporary server to run its init scripts, then
    // stops it and starts the real one. pg_isready answers "yes" to that
    // temporary server, so a check that trusts it races the restart: this guard
    // passed when run alone and failed roughly one run in two inside the full
    // suite, reporting "Supabase stub schema failed to apply". A flaky guard is
    // worse than no guard — it teaches people to re-run until green.
    let ready = false;
    for (let i = 0; i < 90; i += 1) {
      const probe = psql('SELECT 1;');
      if (probe.status === 0) {
        ready = true;
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
    if (!ready) {
      console.error('✖ check-migrations-apply: Postgres never became ready');
      process.exit(1);
    }

    const stubResult = psql(STUBS);
    if (stubResult.status !== 0) {
      failures.push(`Supabase stub schema failed to apply:\n${stubResult.stderr}`);
    }

    for (const step of CHAIN) {
      const file = path.join(MIGRATIONS, step.file);
      if (!fs.existsSync(file)) {
        failures.push(`Migration missing from disk: ${step.file}`);
        continue;
      }
      const sql = fs.readFileSync(file, 'utf8');

      const first = psql(sql, { stopOnError: !step.tolerateUnrelated });
      if (first.status !== 0 && !step.tolerateUnrelated) {
        failures.push(`${step.file} failed to apply:\n${first.stderr.trim()}`);
        continue;
      }

      if (step.idempotent) {
        const second = psql(sql);
        if (second.status !== 0) {
          failures.push(
            `${step.file} is NOT IDEMPOTENT — it applied once and failed on the second run:\n` +
            second.stderr.trim(),
          );
        }
      }
    }

    for (const [label, sql, mustSucceed] of ASSERTIONS) {
      const result = psql(sql);
      const succeeded = result.status === 0;
      if (mustSucceed && !succeeded) {
        failures.push(`Expected to SUCCEED but failed — ${label}:\n${result.stderr.trim()}`);
      }
      if (!mustSucceed && succeeded) {
        failures.push(
          `Expected to be REJECTED but was accepted — ${label}. ` +
          'The constraint exists but does not bite.',
        );
      }
    }
  } finally {
    cleanup();
  }

  if (failures.length > 0) {
    console.error('\n\x1b[31m✖ check-migrations-apply FAILED\x1b[0m\n');
    for (const failure of failures) console.error(`  • ${failure}\n`);
    process.exit(1);
  }

  console.log(
    `\x1b[32m✔ check-migrations-apply\x1b[0m  ${CHAIN.length} migrations applied against real Postgres, ` +
    `design layer re-applied cleanly, ${ASSERTIONS.length} schema assertions passed.`,
  );
}

main();
