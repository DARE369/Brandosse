// Shared helpers for every verify-*.js script in this kit. Plain CommonJS,
// only dependency is @supabase/supabase-js (already in package.json).
'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const QA_PREFIX = 'QA-VERIFY-';

// ── .env loader (no `dotenv` dependency — hand-rolled, this file format is
// simple enough not to need one) ────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    fail(
      'Missing .env file',
      `Expected to find it at: ${envPath}\n` +
      `Copy .env.example to .env in the qa-kit folder and fill in real values first (see README.md).`,
    );
    process.exit(1);
  }

  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }

  const required = [
    'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
    'TEST_USER_EMAIL', 'TEST_USER_PASSWORD',
  ];
  const missing = required.filter((k) => !process.env[k] || process.env[k].includes('change-me') || process.env[k].includes('YOUR-PROJECT'));
  if (missing.length) {
    fail(
      '.env is incomplete',
      `These values are still missing or look like placeholders: ${missing.join(', ')}\n` +
      `Fill in real values in qa-kit/.env (see README.md / RUNBOOK.md Part A).`,
    );
    process.exit(1);
  }

  return {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    TEST_USER_EMAIL: process.env.TEST_USER_EMAIL,
    TEST_USER_PASSWORD: process.env.TEST_USER_PASSWORD,
    TEST_USER_2_EMAIL: process.env.TEST_USER_2_EMAIL || null,
    TEST_USER_2_PASSWORD: process.env.TEST_USER_2_PASSWORD || null,
    TEST_IMAGE_URL: process.env.TEST_IMAGE_URL || null,
  };
}

// ── Clients ──────────────────────────────────────────────────────────────
function adminClient(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Returns a signed-in client + the auth user row. Throws a clear error
// (via fail()) if sign-in fails, since almost every script needs this to
// succeed before anything else is meaningful.
async function signIn(env, email, password, label = 'user') {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data?.user) {
    fail(
      `Could not sign in as ${label} (${email})`,
      `Supabase auth error: ${error?.message || 'no user returned'}\n` +
      `Check the email/password in .env, and confirm this account actually exists ` +
      `and has a confirmed email (RUNBOOK.md Part A explains how to create it).`,
    );
    process.exit(1);
  }
  return { client, user: data.user, session: data.session };
}

// ── Output — PASS/FAIL printers. Scripts should use these instead of raw
// console.log for verdicts, so a non-expert owner never has to interpret
// a dump themselves. ─────────────────────────────────────────────────────
let anyFailure = false;

function section(title) {
  console.log('\n' + '='.repeat(78));
  console.log(title);
  console.log('='.repeat(78));
}

function pass(what, detail = '') {
  console.log(`\n✅ PASS — ${what}`);
  if (detail) console.log(`   ${detail.split('\n').join('\n   ')}`);
}

function fail(what, detail = '') {
  anyFailure = true;
  console.log(`\n❌ FAIL — ${what}`);
  if (detail) console.log(`   ${detail.split('\n').join('\n   ')}`);
}

function info(what, detail = '') {
  console.log(`\nℹ️  ${what}`);
  if (detail) console.log(`   ${detail.split('\n').join('\n   ')}`);
}

function skip(what, detail = '') {
  console.log(`\n⏭️  SKIPPED — ${what}`);
  if (detail) console.log(`   ${detail.split('\n').join('\n   ')}`);
}

// Call at the very end of every script — sets the process exit code so
// scripts can be chained with `&&` and a failure actually stops the chain.
function finish() {
  console.log('\n' + '='.repeat(78));
  if (anyFailure) {
    console.log('RESULT: at least one check FAILED — see ❌ FAIL entries above.');
    process.exitCode = 1;
  } else {
    console.log('RESULT: all checks in this script PASSED.');
    process.exitCode = 0;
  }
  console.log('='.repeat(78) + '\n');
}

// ── Misc ─────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

// Every QA-created row's identifying text field should run through this so
// it's unmistakably a test record, and so cleanup/verification scripts can
// find it again by prefix.
function qaTag(label = '') {
  return `${QA_PREFIX}${label ? label + '-' : ''}${randomSuffix()}`;
}

// Simple stdin y/n prompt — used by scripts that cost real credits.
function ask(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (data) => {
      process.stdin.pause();
      resolve(String(data).trim().toLowerCase());
    });
  });
}

async function confirmCost(description) {
  const answer = await ask(`\n💰 ${description}\n   Proceed? (y/n): `);
  return answer === 'y' || answer === 'yes';
}

// Cleanup registry — scripts push { table, column, value } (or a raw
// description string for manual-only cleanup) as they create QA rows, then
// call cleanupAll() at the end (in a finally block) so a crash mid-script
// doesn't silently leave test data behind uncleaned AND unreported.
function makeCleanupRegistry(admin) {
  const items = [];
  return {
    track(table, idColumn, idValue, note = '') {
      items.push({ table, idColumn, idValue, note });
    },
    trackManual(note) {
      items.push({ manual: true, note });
    },
    async run() {
      const manual = items.filter((i) => i.manual);
      const auto = items.filter((i) => !i.manual);
      let deleted = 0;
      let failed = 0;
      for (const item of auto) {
        try {
          const { error } = await admin.from(item.table).delete().eq(item.idColumn, item.idValue);
          if (error) throw error;
          deleted += 1;
        } catch (err) {
          failed += 1;
          manual.push({ manual: true, note: `${item.table}.${item.idColumn}=${item.idValue} (${item.note}) — delete failed: ${err.message}` });
        }
      }
      section('CLEANUP');
      console.log(`Auto-cleaned ${deleted} QA row(s) this script created.`);
      if (failed > 0) console.log(`${failed} row(s) could not be auto-deleted (see below).`);
      if (manual.length) {
        console.log('\nThe following need MANUAL cleanup (or were never auto-cleanable by design):');
        manual.forEach((m) => console.log(`  - ${m.note}`));
      } else {
        console.log('Nothing left to clean up manually.');
      }
    },
  };
}

module.exports = {
  QA_PREFIX,
  loadEnv,
  adminClient,
  signIn,
  section,
  pass,
  fail,
  info,
  skip,
  finish,
  sleep,
  qaTag,
  ask,
  confirmCost,
  makeCleanupRegistry,
};
