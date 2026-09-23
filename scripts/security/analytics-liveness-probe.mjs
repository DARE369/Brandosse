#!/usr/bin/env node
/**
 * analytics-liveness-probe.mjs — is analytics collection actually running?
 *
 * WHY THIS EXISTS
 * ---------------
 * `ingest-social-analytics` is invoked by pg_cron every six hours and its
 * reply is read by nobody. If the function starts throwing, times out, or its
 * cron job is unscheduled, the fact tables simply stop gaining rows: every
 * chart keeps rendering the last figures it saw and NOTHING reports a fault.
 * That is exactly how Groq failed 100% for days and how trend data was
 * fabricated for five months (CLAUDE.md, law 1).
 *
 * The ingestion ledger was built so this question has an answer. This asks it:
 * every active, non-mock account on a collected platform must have a run in
 * social_ingestion_runs within MAX_AGE_HOURS.
 *
 * Deliberately NOT asserted: that runs SUCCEEDED. A run that fails is loud in
 * its own row and may be the platform's fault; a run that never happens is
 * silent, and that is what this catches. Accounts connected less than one
 * cron interval ago are exempt, because their first run may not be due.
 *
 * Read-only.
 *
 *   Usage:  node scripts/security/analytics-liveness-probe.mjs [--max-age-hours N]
 *   Exit 0 = collection is running. Exit 1 = an account is going uncollected.
 *   Exit 2 = cannot run.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Cron is every 6h; 7 allows one missed tick plus clock skew before alarming. */
const DEFAULT_MAX_AGE_HOURS = 7;
const PLATFORMS = ['youtube', 'tiktok'];

const argIndex = process.argv.indexOf('--max-age-hours');
const MAX_AGE_HOURS = argIndex > -1 ? Number(process.argv[argIndex + 1]) || DEFAULT_MAX_AGE_HOURS : DEFAULT_MAX_AGE_HOURS;

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
const svc = env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !svc) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(2);
}
const headers = { apikey: svc, Authorization: `Bearer ${svc}` };

async function get(pathAndQuery) {
  const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${pathAndQuery.split('?')[0]}`);
  return res.json();
}

try {
  console.log(`analytics liveness probe — every collected account must have a run within ${MAX_AGE_HOURS}h`);

  const accounts = await get(
    `connected_accounts?select=id,platform,display_name,created_at,connection_status`
    + `&platform=in.(${PLATFORMS.join(',')})&is_mock=eq.false&connection_status=in.(active,connected)`);

  if (accounts.length === 0) {
    // Not a pass by luck: say why there was nothing to check.
    console.log('PASS — no active YouTube or TikTok accounts are connected, so nothing is due for collection.');
    process.exit(0);
  }

  const cutoff = Date.now() - MAX_AGE_HOURS * 3_600_000;
  const runs = await get(
    `social_ingestion_runs?select=connected_account_id,started_at,status`
    + `&started_at=gte.${new Date(cutoff).toISOString()}&order=started_at.desc&limit=5000`);

  const latest = new Map();
  for (const r of runs) {
    if (!latest.has(r.connected_account_id)) latest.set(r.connected_account_id, r);
  }

  const stale = [];
  for (const a of accounts) {
    const connectedAgo = Date.now() - new Date(a.created_at).getTime();
    const run = latest.get(a.id);
    const name = `${a.platform}/${(a.display_name || a.id).slice(0, 24)}`;
    if (run) {
      console.log(`  ok     ${name.padEnd(34)} last run ${run.status} at ${run.started_at}`);
    } else if (connectedAgo < MAX_AGE_HOURS * 3_600_000) {
      console.log(`  grace  ${name.padEnd(34)} connected ${Math.round(connectedAgo / 3_600_000)}h ago; first run not yet due`);
    } else {
      stale.push(`${name} (${a.id})`);
      console.log(`  STALE  ${name.padEnd(34)} no run in the last ${MAX_AGE_HOURS}h`);
    }
  }

  console.log('');
  if (stale.length === 0) {
    console.log(`PASS — all ${accounts.length} collected account(s) had a run within ${MAX_AGE_HOURS}h.`);
    process.exit(0);
  }

  console.error(`FAIL — ${stale.length} account(s) are not being collected:`);
  for (const s of stale) console.error(`  ${s}`);
  console.error('');
  console.error('Analytics is silently frozen for these accounts: the page keeps showing the last');
  console.error('figures it saw. Check the cron job and the function logs:');
  console.error("  SELECT jobname, active FROM cron.job WHERE jobname = 'ingest-social-analytics';");
  console.error('  supabase functions logs ingest-social-analytics');
  process.exit(1);
} catch (err) {
  console.error(`FATAL: ${err.message}`);
  process.exit(2);
}
