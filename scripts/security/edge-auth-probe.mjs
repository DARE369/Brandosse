#!/usr/bin/env node
/**
 * edge-auth-probe.mjs — LOCK L6.3.
 *
 * Calls every deployed edge function with NO Authorization header and asserts
 * that exactly the intended set answers.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * There was no supabase/config.toml in this repository, so every function's
 * `verify_jwt` setting was whatever the CLI happened to default to on the day
 * it was deployed. Audit finding P10s-004 flagged that as unverified, and it
 * stayed unverified because there was nothing written down to check.
 *
 * Probing it live on 2026-08-22 answered the question in both directions:
 *
 *   51 functions correctly refused an unauthenticated caller.
 *   1 function refused one that it needs to accept.
 *
 * `job-webhook` is the URL handed to fal.ai when a video render is submitted.
 * fal.ai is a third party with no Supabase session, so every completion
 * callback it ever sent was rejected at the gateway with
 * UNAUTHORIZED_NO_AUTH_HEADER — before a line of the function ran. Videos still
 * finished, because the `process-jobs` pg_cron poller picked them up, and the
 * function's own header calls that path the FALLBACK. The preferred path had
 * never worked once, and the fallback quietly covering for it is precisely why
 * nobody noticed.
 *
 * ── Why an allowlist, not a count ───────────────────────────────────────────
 * The interesting failure is not "how many are open" but "WHICH". A guard that
 * counted would pass while one function closed and another opened. Both
 * directions fail here: an unlisted function that answers is an exposure, and a
 * listed function that refuses is a broken integration.
 *
 *   Usage:  node scripts/security/edge-auth-probe.mjs
 *   Exit 0 = the open set matches exactly.  1 = it does not.  2 = cannot run.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/**
 * Functions that MUST be callable without a Supabase JWT, and the auth they
 * use instead. Adding a name here is a security decision: say what guards it.
 */
const INTENTIONALLY_OPEN = new Map([
  [
    'job-webhook',
    'fal.ai render callbacks; guarded by a per-job crypto.randomUUID() capability '
      + 'token compared against background_jobs.payload.webhook_token, and inert on '
      + 'any job not in `running`',
  ],
]);

function loadEnv() {
  const file = path.join(ROOT, '.env.local');
  const env = { ...process.env };
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const i = line.indexOf('=');
      const key = line.slice(0, i).trim();
      if (!env[key]) env[key] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
    }
  }
  return env;
}

const env = loadEnv();
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
if (!BASE) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL is required.');
  process.exit(2);
}

const functionsDir = path.join(ROOT, 'supabase', 'functions');
if (!fs.existsSync(functionsDir)) {
  console.error('FATAL: supabase/functions not found. Run from the repository root.');
  process.exit(2);
}
const names = fs
  .readdirSync(functionsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
  .map((d) => d.name)
  .sort();

console.log('edge auth probe (L6.3)');
console.log(`  ${BASE}`);
console.log(`  ${names.length} function(s), called with no Authorization header\n`);

const open = [];
const guarded = [];
const undeployed = [];

for (const name of names) {
  let res;
  try {
    res = await fetch(`${BASE}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    undeployed.push([name, 'unreachable']);
    continue;
  }
  if (res.status === 401) guarded.push(name);
  else if (res.status === 404) undeployed.push([name, 'not deployed']);
  else open.push([name, res.status]);
}

const openNames = new Set(open.map(([n]) => n));
const unexpectedlyOpen = [...openNames].filter((n) => !INTENTIONALLY_OPEN.has(n));
const unexpectedlyClosed = [...INTENTIONALLY_OPEN.keys()].filter(
  (n) => !openNames.has(n) && !undeployed.some(([u]) => u === n),
);

console.log(`  JWT-guarded : ${guarded.length}`);
console.log(`  open        : ${open.length}`);
console.log(`  not deployed: ${undeployed.length}`);
for (const [name] of open) {
  const why = INTENTIONALLY_OPEN.get(name);
  console.log(`      ${name} — ${why ? 'intended' : 'NOT ON THE ALLOWLIST'}`);
}
console.log('');

const problems = [];

if (unexpectedlyOpen.length > 0) {
  problems.push(
    'Reachable without authentication, and not on the allowlist:\n'
      + unexpectedlyOpen.map((n) => `    ${n}`).join('\n')
      + '\n  Either it was deployed with verify_jwt = false by mistake, or it is a\n'
      + '  deliberate decision that nobody wrote down. Add it to INTENTIONALLY_OPEN\n'
      + '  with the auth it actually uses, or redeploy it guarded.',
  );
}

if (unexpectedlyClosed.length > 0) {
  problems.push(
    'Expected to be callable by a third party, but refusing:\n'
      + unexpectedlyClosed
        .map((n) => `    ${n} — ${INTENTIONALLY_OPEN.get(n)}`)
        .join('\n')
      + '\n  The gateway is rejecting the caller before the function runs, so the\n'
      + '  integration is silently dead. Set verify_jwt = false for it in\n'
      + '  supabase/config.toml and redeploy.',
  );
}

if (undeployed.length > 0) {
  problems.push(
    'In the repository but not answering in production:\n'
      + undeployed.map(([n, r]) => `    ${n} (${r})`).join('\n'),
  );
}

if (problems.length > 0) {
  console.error('FAIL — edge function auth does not match what is declared.\n');
  for (const p of problems) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log(
  `PASS — ${guarded.length} guarded, ${open.length} open exactly as declared.`,
);
process.exit(0);
