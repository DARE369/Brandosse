#!/usr/bin/env node
/**
 * analytics-tenancy-probe.mjs — can one user read another user's analytics?
 *
 * WHY THIS EXISTS SEPARATELY FROM cross-tenant-probe.mjs
 * ------------------------------------------------------
 * That probe logs in as the QA account and checks every row it can read
 * belongs to it. For the social_* analytics tables that check is VACUOUS:
 * measured 2026-09-22, the QA account is the one that owns every analytics row
 * in the database, so there is no foreign row for it to fail to see. A probe
 * that cannot fail proves nothing (CLAUDE.md: RLS changes need the behavioural
 * probe, and a probe with nothing to catch is not one).
 *
 * So this one MAKES a foreign tenant: a throwaway auth user, with a connected
 * account, an ingestion run, and one fact row in every analytics table that
 * exists — then signs in as the QA user with the PUBLIC anon key and asserts
 * none of it is readable, directly or through social_snapshot_summary().
 * Everything it creates is deleted in `finally`, including the auth user.
 *
 * WRITES: yes — throwaway rows only, owned by a user this script creates and
 * deletes. No real user's data is read or touched.
 *
 *   Usage:  node scripts/security/analytics-tenancy-probe.mjs
 *   Exit 0 = isolated. Exit 1 = leak. Exit 2 = cannot run.
 *
 *   Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY, E2E_USER_EMAIL, E2E_USER_PASSWORD
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = env.SUPABASE_SERVICE_ROLE_KEY;
for (const [k, v] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: base, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
  SUPABASE_SERVICE_ROLE_KEY: svc, E2E_USER_EMAIL: env.E2E_USER_EMAIL, E2E_USER_PASSWORD: env.E2E_USER_PASSWORD })) {
  if (!v) { console.error(`FATAL: ${k} is not set in .env.local`); process.exit(2); }
}

const svcHeaders = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' };
const TIMEOUT = 20_000;

async function call(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  return { res, json, text };
}

async function svcInsert(table, row) {
  const { res, json, text } = await call(`${base}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...svcHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  return { ok: res.ok, status: res.status, row: Array.isArray(json) ? json[0] : null, text };
}

const today = new Date().toISOString().slice(0, 10);
const now = new Date().toISOString();

/** One fact row per analytics table; a table absent on this database is skipped, not failed. */
const FACTS = (accountId, runId) => [
  ['social_post_metrics_daily', { connected_account_id: accountId, platform_post_id: '__xt_probe__', metric_key: 'views',
    metric_date: today, value: 1, reporting_timezone: 'UTC', ingestion_run_id: runId, user_id: '00000000-0000-0000-0000-000000000000', scope: 'personal', platform: 'tiktok' }],
  ['social_account_metrics_daily', { connected_account_id: accountId, metric_key: 'views', metric_date: today, value: 1,
    reporting_timezone: 'UTC', ingestion_run_id: runId, user_id: '00000000-0000-0000-0000-000000000000', scope: 'personal', platform: 'tiktok' }],
  ['social_post_metrics_snapshot', { connected_account_id: accountId, platform_post_id: '__xt_probe__', metric_key: 'views',
    observed_at: now, value: 1, ingestion_run_id: runId, user_id: '00000000-0000-0000-0000-000000000000', scope: 'personal', platform: 'tiktok' }],
  ['social_account_metrics_snapshot', { connected_account_id: accountId, metric_key: 'followers_total', observed_at: now,
    value: 1, ingestion_run_id: runId, user_id: '00000000-0000-0000-0000-000000000000', scope: 'personal', platform: 'tiktok' }],
  ['social_platform_posts', { connected_account_id: accountId, platform_post_id: '__xt_probe__', title: 'probe', last_seen_at: now,
    ingestion_run_id: runId, user_id: '00000000-0000-0000-0000-000000000000', scope: 'personal', platform: 'tiktok' }],
];

let foreignUserId = null;
let foreignAccountId = null;
let exitCode = 0;

try {
  console.log('analytics tenancy probe');

  // ── 1. A foreign tenant that exists only for this run ─────────────────────
  const email = `analytics-probe+${crypto.randomUUID()}@example.invalid`;
  const created = await call(`${base}/auth/v1/admin/users`, {
    method: 'POST', headers: svcHeaders,
    body: JSON.stringify({ email, password: crypto.randomUUID(), email_confirm: true }),
  });
  foreignUserId = created.json?.id || null;
  if (!foreignUserId) throw new Error(`could not create throwaway user: HTTP ${created.res.status}`);

  const acct = await svcInsert('connected_accounts', {
    user_id: foreignUserId, platform: 'tiktok', scope: 'personal', account_id: `__xt_probe_${Date.now()}`,
    account_name: 'probe', display_name: 'probe', username: 'probe', provider: 'tiktok',
    connection_status: 'active', is_mock: true,
  });
  if (!acct.ok) throw new Error(`could not seed connected account: HTTP ${acct.status} ${acct.text.slice(0, 200)}`);
  foreignAccountId = acct.row.id;

  const run = await svcInsert('social_ingestion_runs', {
    connected_account_id: foreignAccountId, platform: 'tiktok', source: '__xt_probe__',
    mode: 'incremental', status: 'succeeded', finished_at: now,
  });
  if (!run.ok) throw new Error(`could not seed ingestion run: HTTP ${run.status} ${run.text.slice(0, 200)}`);

  const seeded = [];
  for (const [table, row] of FACTS(foreignAccountId, run.row.id)) {
    const r = await svcInsert(table, row);
    if (r.ok) seeded.push(table);
    else if (r.status === 404) console.log(`  skip   ${table.padEnd(34)} not on this database yet`);
    else throw new Error(`could not seed ${table}: HTTP ${r.status} ${r.text.slice(0, 200)}`);
  }
  if (seeded.length === 0) throw new Error('no analytics table accepted a seed row — nothing to test');

  // ── 2. Sign in as the ordinary QA user, public anon key only ──────────────
  const auth = await call(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.E2E_USER_EMAIL, password: env.E2E_USER_PASSWORD }),
  });
  const token = auth.json?.access_token;
  if (!token) throw new Error('QA user login failed');
  const userHeaders = { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // ── 3. The foreign rows must be invisible ─────────────────────────────────
  const leaks = [];
  for (const table of seeded) {
    const r = await call(`${base}/rest/v1/${table}?select=connected_account_id&connected_account_id=eq.${foreignAccountId}`,
      { headers: userHeaders });
    const n = Array.isArray(r.json) ? r.json.length : 0;
    if (!r.res.ok) console.log(`  ok     ${table.padEnd(34)} denied (HTTP ${r.res.status})`);
    else if (n > 0) { leaks.push(`${table}: ${n} foreign row(s)`); console.log(`  LEAK   ${table.padEnd(34)} ${n} foreign row(s)`); }
    else console.log(`  ok     ${table.padEnd(34)} foreign row invisible`);
  }

  let summaryChecked = false;
  const rpc = await call(`${base}/rest/v1/rpc/social_snapshot_summary`, {
    method: 'POST', headers: userHeaders, body: JSON.stringify({ p_since: '1970-01-01T00:00:00Z' }),
  });
  if (rpc.res.status === 404) {
    console.log(`  skip   ${'rpc social_snapshot_summary'.padEnd(34)} not on this database yet`);
  } else {
    summaryChecked = true;
    const hit = (Array.isArray(rpc.json) ? rpc.json : []).filter((r) => r.connected_account_id === foreignAccountId);
    if (hit.length) { leaks.push(`social_snapshot_summary: ${hit.length} foreign row(s)`); console.log(`  LEAK   ${'rpc social_snapshot_summary'.padEnd(34)} ${hit.length} foreign row(s)`); }
    else console.log(`  ok     ${'rpc social_snapshot_summary'.padEnd(34)} foreign account absent`);
  }

  // ── 4. And the ingester's write functions must refuse a browser ───────────
  for (const [fn, body] of [
    ['merge_account_platform_metadata', { p_account_id: foreignAccountId, p_patch: { hijacked: true } }],
    ['request_social_ingestion', { p_account_id: foreignAccountId }],
  ]) {
    const r = await call(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: userHeaders, body: JSON.stringify(body) });
    if (r.res.status === 404) console.log(`  skip   ${`rpc ${fn}`.padEnd(34)} not on this database yet`);
    else if (r.res.ok) { leaks.push(`${fn} callable by an ordinary user`); console.log(`  LEAK   ${`rpc ${fn}`.padEnd(34)} callable (HTTP ${r.res.status})`); }
    else console.log(`  ok     ${`rpc ${fn}`.padEnd(34)} refused (HTTP ${r.res.status})`);
  }

  console.log('');
  if (leaks.length) {
    console.error(`FAIL — analytics isolation broken:\n  ${leaks.join('\n  ')}`);
    exitCode = 1;
  } else {
    // Says exactly what was checked: claiming the summary function was covered
    // when it is not deployed yet would be the doc-vs-code lie in a test.
    console.log(
      `PASS — another user's analytics are invisible across ${seeded.length} table(s)`
      + `${summaryChecked ? ' and social_snapshot_summary' : ' (summary function not deployed yet — NOT covered)'}.`);
  }
} catch (err) {
  console.error(`FATAL: ${err.message}`);
  exitCode = 2;
} finally {
  // Deleting the account cascades every seeded fact and the run
  // (20260909140000 §4, 20260922120000). The auth user goes last.
  if (foreignAccountId) {
    await call(`${base}/rest/v1/connected_accounts?id=eq.${foreignAccountId}`, { method: 'DELETE', headers: svcHeaders })
      .catch((e) => { console.error(`cleanup: account ${foreignAccountId} NOT deleted: ${e.message}`); exitCode = exitCode || 2; });
  }
  if (foreignUserId) {
    await call(`${base}/auth/v1/admin/users/${foreignUserId}`, { method: 'DELETE', headers: svcHeaders })
      .catch((e) => { console.error(`cleanup: auth user ${foreignUserId} NOT deleted: ${e.message}`); exitCode = exitCode || 2; });
  }
  process.exit(exitCode);
}
