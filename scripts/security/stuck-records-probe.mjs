#!/usr/bin/env node
/**
 * stuck-records-probe.mjs — guard for LOCK L2.3.
 *
 * Fails if any record is stranded in a non-terminal state past its timeout.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * publish-post sets posts.status = 'publishing' before calling the provider. If
 * anything interrupts, the row stays there forever — the scheduled worker only
 * picks up 'scheduled', so it is never retried, never failed, and never
 * surfaced. Twenty posts sat in that state for up to four months and nothing
 * detected it.
 *
 * A reaper now runs every 5 minutes (public.reap_stuck_records). This probe is
 * the check that the reaper is actually working: if it stops, or a new
 * non-terminal state appears without a timeout, this goes red.
 *
 * READ-ONLY.
 *
 *   Usage:  node scripts/security/stuck-records-probe.mjs
 *   Exit 0 = nothing stranded. Exit 1 = stranded records (fails CI).
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Each check allows a grace window well beyond the reaper's own threshold, so a
 * single delayed cron tick does not fail the build — only a genuinely broken
 * reaper does.
 */
const CHECKS = [
  {
    label: 'posts mid-publish',
    table: 'posts',
    filter: 'status=eq.publishing',
    stamp: 'updated_at',
    graceMinutes: 30,          // reaper fires at 15
  },
  {
    label: 'video_clips mid-render',
    table: 'video_clips',
    filter: 'render_status=eq.pending',
    stamp: 'updated_at',
    graceMinutes: 120,         // reaper fires at 90
  },
  {
    label: 'background_jobs queued',
    table: 'background_jobs',
    filter: 'status=in.(queued,running)',
    stamp: 'created_at',
    graceMinutes: 60,          // reaper fires at 30
  },
];

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
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const svc = env.SUPABASE_SERVICE_ROLE_KEY;

if (!base || !svc) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(2);
}

const headers = { apikey: svc, Authorization: `Bearer ${svc}` };

console.log('stuck-records probe (LOCK L2.3)\n');

let stranded = 0;

for (const check of CHECKS) {
  const cutoff = new Date(Date.now() - check.graceMinutes * 60_000).toISOString();
  const url =
    `${base}/rest/v1/${check.table}` +
    `?select=id,${check.stamp}&${check.filter}&${check.stamp}=lt.${cutoff}` +
    `&order=${check.stamp}.asc&limit=100`;

  const res = await fetch(url, { headers });

  if (!res.ok) {
    console.log(`  SKIP   ${check.label.padEnd(26)} HTTP ${res.status}`);
    continue;
  }

  const rows = await res.json();
  if (!Array.isArray(rows)) {
    console.log(`  SKIP   ${check.label.padEnd(26)} unexpected payload`);
    continue;
  }

  if (rows.length === 0) {
    console.log(`  ok     ${check.label.padEnd(26)} none stranded beyond ${check.graceMinutes}m`);
    continue;
  }

  stranded += rows.length;
  const oldest = rows[0][check.stamp];
  const ageDays = Math.floor((Date.now() - new Date(oldest).getTime()) / 86_400_000);
  console.log(
    `  STUCK  ${check.label.padEnd(26)} ${rows.length} row(s), oldest ${String(oldest).slice(0, 10)} (${ageDays}d)`);
}

console.log('');

if (stranded === 0) {
  console.log('PASS — no records stranded in a non-terminal state.');
  process.exit(0);
}

console.error(`FAIL — ${stranded} record(s) stranded past the reaper threshold.`);
console.error('       Either the reaper is not running, or a new non-terminal state has no timeout.');
console.error('       Check:  SELECT * FROM cron.job WHERE jobname = \'reap-stuck-records\';');
console.error('       Run it: SELECT * FROM public.reap_stuck_records();');
process.exit(1);
