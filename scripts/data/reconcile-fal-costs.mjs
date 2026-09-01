#!/usr/bin/env node
/**
 * reconcile-fal-costs.mjs — backfill actual_cost_usd from fal's own billing.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The cost ledger (LOCK L5.14) stores estimated_cost_usd at submit time and
 * leaves actual_cost_usd null, because fal does not report cost in the
 * generation response. Copying the estimate across would have made price drift
 * invisible, which defeats the reason both columns exist.
 *
 * fal DOES report real per-request cost, via the Platform Usage API. This
 * script pulls it and fills in the actual, matched on the fal request id we
 * already store as provider_job_id.
 *
 * Once actuals are present, three things become possible that are guesses
 * today: measuring how far our estimates drift, detecting a provider reprice
 * within a day instead of at month end, and reconciling our ledger against
 * fal's invoice.
 *
 * ── Credentials ─────────────────────────────────────────────────────────────
 * Needs FAL_ADMIN_KEY — an **Admin-scope** fal key. This is NOT the same key
 * the edge functions generate with: the usage endpoint requires admin scope,
 * and the generation key does not have it. Create one in the fal dashboard and
 * keep it out of the runtime environment; nothing that serves a request should
 * hold a key that can read billing.
 *
 *   Usage:
 *     node scripts/data/reconcile-fal-costs.mjs                # dry run, last 7 days
 *     node scripts/data/reconcile-fal-costs.mjs --days 30
 *     node scripts/data/reconcile-fal-costs.mjs --apply
 */

import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const daysArg = process.argv.indexOf('--days');
const DAYS = daysArg !== -1 ? Number(process.argv[daysArg + 1]) : 7;

const USAGE_URL = 'https://api.fal.ai/v1/models/usage';
const PAGE_LIMIT = 40; // pages, not rows — a stop so a bad cursor cannot loop forever

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

const env = loadEnv();
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const FAL_ADMIN_KEY = env.FAL_ADMIN_KEY || process.env.FAL_ADMIN_KEY;

if (!BASE || !KEY) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(2);
}
if (!FAL_ADMIN_KEY) {
  console.error(
    'FATAL: FAL_ADMIN_KEY is not set.\n' +
    '  The usage endpoint requires an ADMIN-scope fal key — the generation key\n' +
    '  does not have that scope. Create one in the fal dashboard and set it in\n' +
    '  .env.local or the environment. Do not deploy it to any runtime that\n' +
    '  serves requests: nothing answering a user should be able to read billing.',
  );
  process.exit(2);
}

const sbHeaders = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const since = new Date(Date.now() - DAYS * 86400000).toISOString();

// ── 1. Ledger rows still missing an actual ──────────────────────────────────
const pendingRes = await fetch(
  `${BASE}/rest/v1/video_cost_ledger` +
  `?select=id,provider_job_id,model_id,estimated_cost_usd,actual_cost_usd` +
  `&provider=eq.fal&actual_cost_usd=is.null&provider_job_id=not.is.null` +
  `&created_at=gte.${since}&limit=5000`,
  { headers: sbHeaders },
);
const pending = await pendingRes.json();
if (!Array.isArray(pending)) {
  console.error('FATAL: could not read video_cost_ledger:', JSON.stringify(pending).slice(0, 300));
  process.exit(2);
}

console.log(`\n  window ................... last ${DAYS} day(s)`);
console.log(`  ledger rows missing cost . ${pending.length}`);

if (pending.length === 0) {
  console.log('\n  Nothing to reconcile.\n');
  process.exit(0);
}

const byRequestId = new Map(pending.map((r) => [String(r.provider_job_id), r]));

// ── 2. fal's own billing records ────────────────────────────────────────────
const usage = [];
let cursor = null;
let pages = 0;

do {
  const url = new URL(USAGE_URL);
  url.searchParams.set('start_time', since);
  if (cursor) url.searchParams.set('cursor', cursor);

  const res = await fetch(url, { headers: { Authorization: `Key ${FAL_ADMIN_KEY}` } });
  if (!res.ok) {
    const body = await res.text();
    console.error(
      `\nFATAL: fal usage API returned ${res.status}.\n  ${body.slice(0, 400)}\n\n` +
      (res.status === 401 || res.status === 403
        ? '  A 401/403 here almost always means the key lacks ADMIN scope rather\n' +
          '  than being wrong. Check the key\'s scope in the fal dashboard.\n'
        : ''),
    );
    process.exit(3);
  }
  const body = await res.json();
  const items = body.items ?? body.data ?? [];
  if (!Array.isArray(items)) {
    console.error(
      '\nFATAL: unexpected usage response shape. Expected an items array; got:\n  ' +
      JSON.stringify(body).slice(0, 400) +
      '\n\n  The API shape has changed. Fix this script rather than guessing at a\n' +
      '  mapping — a wrong mapping writes wrong money into the ledger.\n',
    );
    process.exit(3);
  }
  usage.push(...items);
  cursor = body.next_cursor ?? null;
  pages += 1;
} while (cursor && pages < PAGE_LIMIT);

console.log(`  fal billing records ...... ${usage.length} (${pages} page(s))`);

// ── 3. Match and report ─────────────────────────────────────────────────────
const updates = [];
let unmatched = 0;

for (const item of usage) {
  const requestId = item.request_id ?? item.requestId ?? null;
  if (!requestId) continue;
  const row = byRequestId.get(String(requestId));
  if (!row) {
    unmatched += 1;
    continue;
  }
  const cost = item.cost_total ?? item.costTotal ?? null;
  if (typeof cost !== 'number') continue;
  updates.push({ id: row.id, actual: cost, estimated: row.estimated_cost_usd, model: row.model_id });
}

console.log(`  matched .................. ${updates.length}`);
console.log(`  fal records with no ledger row ... ${unmatched}` +
  (unmatched > 0 ? '  <- spend we did not record; investigate' : ''));

if (updates.length > 0) {
  // Drift is the number this whole exercise exists to produce.
  const withEstimate = updates.filter((u) => typeof u.estimated === 'number' && u.estimated > 0);
  if (withEstimate.length > 0) {
    const drift = withEstimate.reduce((s, u) => s + (u.actual - u.estimated), 0);
    const totalEst = withEstimate.reduce((s, u) => s + u.estimated, 0);
    const totalAct = withEstimate.reduce((s, u) => s + u.actual, 0);
    console.log(`\n  estimated total .......... $${totalEst.toFixed(4)}`);
    console.log(`  actual total ............. $${totalAct.toFixed(4)}`);
    console.log(`  drift .................... $${drift.toFixed(4)} ` +
      `(${totalEst > 0 ? ((drift / totalEst) * 100).toFixed(1) : '0.0'}%)`);

    const byModel = {};
    for (const u of withEstimate) {
      byModel[u.model] ??= { est: 0, act: 0, n: 0 };
      byModel[u.model].est += u.estimated;
      byModel[u.model].act += u.actual;
      byModel[u.model].n += 1;
    }
    console.log('\n  per model:');
    for (const [model, m] of Object.entries(byModel)) {
      const pct = m.est > 0 ? (((m.act - m.est) / m.est) * 100).toFixed(1) : '—';
      console.log(`    ${String(m.n).padStart(4)}  ${model.padEnd(42)} est $${m.est.toFixed(4)}  act $${m.act.toFixed(4)}  ${pct}%`);
    }
  }
}

if (!APPLY) {
  console.log(`\n  DRY RUN — nothing written. Re-run with --apply to backfill ${updates.length} row(s).\n`);
  process.exit(0);
}

let written = 0;
for (const u of updates) {
  const res = await fetch(`${BASE}/rest/v1/video_cost_ledger?id=eq.${u.id}`, {
    method: 'PATCH',
    headers: sbHeaders,
    body: JSON.stringify({ actual_cost_usd: u.actual }),
  });
  if (res.ok) written += 1;
  else console.error(`  update failed for ${u.id}: ${res.status} ${await res.text()}`);
}

console.log(`\n  OK. ${written}/${updates.length} row(s) backfilled with actual cost.\n`);
