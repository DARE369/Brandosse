#!/usr/bin/env node
/**
 * backfill-hotlinked-assets.mjs — LOCK L5.10.
 *
 * Copies generation assets that live on someone else's server into our own
 * storage, and reports the rows that are stock/demo imagery rather than real
 * user output.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * 77 of 159 generations (48%) point at hosts we do not control. Two distinct
 * problems hide in that number, and they need opposite treatment:
 *
 *   REAL user generations, hotlinked (image/video.pollinations.ai — 36 rows)
 *     The user made these. We show them as their content. But we never stored
 *     them, so they exist only for as long as a third party chooses to serve
 *     that URL. If pollinations changes or disappears, user content silently
 *     becomes broken images. These SHOULD be copied into our storage.
 *
 *   DEMO / SEED data (picsum.photos, unsplash, a Google sample MP4,
 *   placehold.co — 41 rows)
 *     Stock photos and a placeholder image stored as a completed video. Copying
 *     these into our storage would launder demo content into the product as
 *     though it were real user output — the same class of defect as the
 *     fabricated trends removed in L1.3. These are REPORTED, never copied.
 *
 * The ongoing defect is already closed: generateImage downloads from the
 * provider and uploads to storage, so new generations are owned. This is
 * backfill for rows created before that.
 *
 *   Usage:
 *     node scripts/data/backfill-hotlinked-assets.mjs            # dry run
 *     node scripts/data/backfill-hotlinked-assets.mjs --apply    # do it
 *     node scripts/data/backfill-hotlinked-assets.mjs --apply --limit 5
 *
 * DRY RUN BY DEFAULT. It writes to production storage and mutates
 * generations.storage_path, so it must be asked twice.
 */

import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity;
const BUCKET = 'generated_assets';
const FETCH_TIMEOUT_MS = 60_000;

/** Hosts whose content is genuinely the user's, just stored in the wrong place. */
const MIGRATABLE = /(^|\.)pollinations\.ai$/i;

/** Hosts that serve stock or placeholder imagery. Never copy these. */
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

function classify(storagePath) {
  const value = String(storagePath || '');
  if (!value) return 'empty';
  if (!value.startsWith('http')) return 'owned';
  let host;
  try { host = new URL(value).hostname; } catch { return 'unparseable'; }
  if (host.endsWith('supabase.co')) return 'owned';
  if (DEMO.test(host)) return 'demo';
  if (MIGRATABLE.test(host)) return 'migratable';
  return 'unknown-external';
}

const env = loadEnv();
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(2);
}
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const res = await fetch(
  `${BASE}/rest/v1/generations?select=id,user_id,media_type,storage_path,status&limit=2000`,
  { headers },
);
const rows = await res.json();
if (!Array.isArray(rows)) {
  console.error('FATAL: could not read generations:', JSON.stringify(rows).slice(0, 200));
  process.exit(2);
}

const buckets = { owned: [], demo: [], migratable: [], empty: [], unparseable: [], 'unknown-external': [] };
for (const row of rows) buckets[classify(row.storage_path)].push(row);

console.log(`hotlinked-asset backfill (LOCK L5.10) — ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
console.log(`  total generations   : ${rows.length}`);
console.log(`  already owned       : ${buckets.owned.length}`);
console.log(`  MIGRATABLE          : ${buckets.migratable.length}  (real user output, hotlinked)`);
console.log(`  demo/seed           : ${buckets.demo.length}  (stock imagery — reported, never copied)`);
console.log(`  unknown external    : ${buckets['unknown-external'].length}`);
console.log(`  no path             : ${buckets.empty.length}`);
console.log('');

if (buckets['unknown-external'].length > 0) {
  // An unrecognised host is a judgement call, not something to guess at:
  // copying it might launder demo content, skipping it might lose real output.
  console.log('  Unrecognised hosts — classify these before running with --apply:');
  const hosts = new Set(buckets['unknown-external'].map((r) => {
    try { return new URL(r.storage_path).hostname; } catch { return '?'; }
  }));
  for (const h of hosts) console.log(`    ${h}`);
  console.log('');
}

if (!APPLY) {
  console.log(`  Would copy ${Math.min(buckets.migratable.length, LIMIT)} asset(s) into the "${BUCKET}" bucket.`);
  console.log('  Re-run with --apply to do it. Nothing has been changed.');
  process.exit(0);
}

let copied = 0;
const failures = [];

for (const row of buckets.migratable.slice(0, LIMIT)) {
  try {
    const assetRes = await fetch(row.storage_path, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!assetRes.ok) throw new Error(`source returned ${assetRes.status}`);

    const contentType = assetRes.headers.get('content-type') || 'application/octet-stream';
    const ext = contentType.includes('png') ? 'png'
      : contentType.includes('mp4') ? 'mp4'
      : contentType.includes('webp') ? 'webp' : 'jpg';
    const objectPath = `${row.user_id}/backfill_${row.id}.${ext}`;
    const bytes = new Uint8Array(await assetRes.arrayBuffer());

    if (bytes.byteLength === 0) throw new Error('source returned an empty body');

    const upload = await fetch(`${BASE}/storage/v1/object/${BUCKET}/${objectPath}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'true' },
      body: bytes,
    });
    if (!upload.ok) throw new Error(`upload failed ${upload.status}: ${(await upload.text()).slice(0, 120)}`);

    const publicUrl = `${BASE}/storage/v1/object/public/${BUCKET}/${objectPath}`;
    const patch = await fetch(`${BASE}/rest/v1/generations?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ storage_path: publicUrl }),
    });
    if (!patch.ok) throw new Error(`row update failed ${patch.status}`);

    copied += 1;
    console.log(`  ok    ${row.id.slice(0, 8)}  ${(bytes.byteLength / 1024).toFixed(0)}KB  -> ${objectPath}`);
  } catch (err) {
    failures.push({ id: row.id, reason: err.message });
    console.log(`  FAIL  ${row.id.slice(0, 8)}  ${err.message}`);
  }
}

console.log('');
console.log(`  copied ${copied}, failed ${failures.length}`);
if (failures.length) {
  // A hotlink that no longer resolves is itself the finding: that content is
  // already gone, and the row is pointing at nothing.
  console.log('  Failures usually mean the source URL no longer resolves — that');
  console.log('  content is already lost, and the row should be reclassified.');
}
process.exit(failures.length && copied === 0 ? 1 : 0);
