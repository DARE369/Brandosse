#!/usr/bin/env node
/**
 * delete-nonowned-generations.mjs — remove experiment-era generation rows.
 *
 * Founder decision 2026-08-31: the pollinations and stock/placeholder rows date
 * from the period when image providers were still being evaluated. They are not
 * real product output and must stop appearing to users. Delete them.
 *
 * ── Scope, as decided ───────────────────────────────────────────────────────
 *   DELETE   pollinations.ai            — ~36 rows, experiment-era output
 *   DELETE   picsum / unsplash /        — ~41 rows, stock and placeholder
 *            googleapis sample / placehold.co
 *   KEEP     supabase.co and any        — real, owned, model-generated output
 *            non-http storage_path
 *   KEEP     every `sessions` row       — sessions are never touched, even if a
 *                                         deletion empties one
 *
 * This is the opposite treatment to backfill-hotlinked-assets.mjs, which was
 * written to COPY the pollinations rows into our storage. That script is now
 * superseded for these rows and should not be run against them.
 *
 * ── Safety properties ───────────────────────────────────────────────────────
 *   1. DRY RUN BY DEFAULT. --apply is required to delete anything.
 *   2. Writes a full JSON backup of every row before deleting it, so the
 *      operation is reversible.
 *   3. Prints a per-user breakdown and REFUSES to run if rows span more than
 *      one user_id, unless --multi-user is passed. The stated assumption is
 *      that these all belong to one test account; this verifies it rather
 *      than trusting it.
 *   4. Deletes by explicit id list, never by a host pattern sent to the
 *      database — the classifier runs here, where it can be read.
 *   5. Asserts its post-condition: re-queries afterwards and fails loudly if
 *      any target row survives or if the owned-row count changed.
 *
 *   Usage:
 *     node scripts/data/delete-nonowned-generations.mjs             # dry run
 *     node scripts/data/delete-nonowned-generations.mjs --apply
 *     node scripts/data/delete-nonowned-generations.mjs --apply --multi-user
 */

import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const ALLOW_MULTI_USER = process.argv.includes('--multi-user');

/** Experiment-era output: the user made it, but via a provider we abandoned. */
const POLLINATIONS = /(^|\.)pollinations\.ai$/i;

/** Stock and placeholder imagery that was never real output. */
const DEMO = /(picsum\.photos|unsplash\.com|commondatastorage\.googleapis\.com|placehold\.co)/i;

function loadEnv() {
  const file = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(file)) {
    console.error('FATAL: .env.local not found. Run from the repository root.');
    process.exit(2);
  }
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  return env;
}

/** Returns 'delete' | 'keep'. Anything not positively identified is KEPT. */
function classify(storagePath) {
  const value = String(storagePath || '');
  if (!value) return 'keep';                    // empty path — not ours to judge here
  if (!value.startsWith('http')) return 'keep'; // storage-relative — owned
  let host;
  try { host = new URL(value).hostname; } catch { return 'keep'; }
  if (host.endsWith('supabase.co')) return 'keep';
  if (POLLINATIONS.test(host) || DEMO.test(host)) return 'delete';
  return 'keep';                                // unknown host — never delete blind
}

const env = loadEnv();
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(2);
}
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function fetchAll() {
  const res = await fetch(
    `${BASE}/rest/v1/generations?select=id,user_id,media_type,storage_path,status,created_at&limit=5000`,
    { headers },
  );
  const rows = await res.json();
  if (!Array.isArray(rows)) {
    console.error('FATAL: could not read generations:', JSON.stringify(rows).slice(0, 300));
    process.exit(2);
  }
  return rows;
}

const rows = await fetchAll();
const targets = rows.filter((r) => classify(r.storage_path) === 'delete');
const kept = rows.filter((r) => classify(r.storage_path) === 'keep');

console.log(`\n  generations total ......... ${rows.length}`);
console.log(`  to delete ................. ${targets.length}`);
console.log(`  to keep ................... ${kept.length}\n`);

if (targets.length === 0) {
  console.log('  Nothing matches. Exiting.\n');
  process.exit(0);
}

// ── Host breakdown, so the operator can see exactly what is matched ──────────
const byHost = {};
for (const r of targets) {
  let host = 'unparseable';
  try { host = new URL(r.storage_path).hostname; } catch { /* keep default */ }
  byHost[host] = (byHost[host] || 0) + 1;
}
console.log('  by host:');
for (const [host, n] of Object.entries(byHost).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(4)}  ${host}`);
}

// ── Ownership check — verifies the "one test account" assumption ─────────────
const byUser = {};
for (const r of targets) byUser[r.user_id] = (byUser[r.user_id] || 0) + 1;
const userIds = Object.keys(byUser);
console.log('\n  by user_id:');
for (const [uid, n] of Object.entries(byUser).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(4)}  ${uid}`);
}

if (userIds.length > 1 && !ALLOW_MULTI_USER) {
  console.error(
    `\n  REFUSING: rows span ${userIds.length} user accounts, not one.\n` +
    `  These were described as belonging to a single test account. They do not.\n` +
    `  Review the list above. If deleting across all of them is genuinely intended,\n` +
    `  re-run with --multi-user.\n`,
  );
  process.exit(3);
}

if (!APPLY) {
  console.log(`\n  DRY RUN — nothing deleted. Re-run with --apply to delete ${targets.length} rows.\n`);
  process.exit(0);
}

// ── Backup before destroying anything ───────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(process.cwd(), `deleted-generations-${stamp}.json`);
fs.writeFileSync(backupPath, JSON.stringify(targets, null, 2));
console.log(`\n  Backup written: ${backupPath}`);

// ── Delete by explicit id, in batches ───────────────────────────────────────
const ids = targets.map((r) => r.id);
const BATCH = 50;
let deleted = 0;
for (let i = 0; i < ids.length; i += BATCH) {
  const slice = ids.slice(i, i + BATCH);
  const list = slice.map((id) => `"${id}"`).join(',');
  const res = await fetch(`${BASE}/rest/v1/generations?id=in.(${list})`, {
    method: 'DELETE',
    headers: { ...headers, Prefer: 'return=representation' },
  });
  if (!res.ok) {
    console.error(`\n  FATAL: delete failed on batch ${i / BATCH + 1}: ${res.status} ${await res.text()}`);
    console.error(`  ${deleted} rows were already deleted. Backup is at ${backupPath}.`);
    process.exit(4);
  }
  const body = await res.json();
  deleted += Array.isArray(body) ? body.length : slice.length;
  process.stdout.write(`\r  deleted ${deleted}/${ids.length}`);
}
console.log('');

// ── Post-condition: assert the end state, do not assume it ──────────────────
const after = await fetchAll();
const survivors = after.filter((r) => classify(r.storage_path) === 'delete');
const keptAfter = after.filter((r) => classify(r.storage_path) === 'keep');

let failed = false;
if (survivors.length !== 0) {
  console.error(`\n  POST-CONDITION FAILED: ${survivors.length} target rows still present.`);
  failed = true;
}
if (keptAfter.length !== kept.length) {
  console.error(
    `\n  POST-CONDITION FAILED: kept-row count changed ${kept.length} -> ${keptAfter.length}.` +
    `\n  Real generations may have been affected. Restore from ${backupPath}.`,
  );
  failed = true;
}
if (failed) process.exit(5);

console.log(
  `\n  OK. ${deleted} rows deleted. ${keptAfter.length} real generations untouched.` +
  `\n  Sessions were not modified.\n`,
);
