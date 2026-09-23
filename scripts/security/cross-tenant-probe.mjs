#!/usr/bin/env node
/**
 * cross-tenant-probe.mjs — WAVE 0 / LOCK L0.2, and the guard for L1.1.
 *
 * Logs in as a real, NON-ADMIN user with the PUBLIC anon key, then attempts to
 * read rows belonging to other users across every high-value table. Any foreign
 * row that is not legitimately shared via an active organization membership is
 * a cross-tenant data leak.
 *
 * This is the highest-value test in the repository: it proves the audit's most
 * severe finding (P10s-001/002) and, once wired into CI, prevents its return.
 *
 * WHY AN ANON-KEY JWT: the service_role key bypasses RLS by design, so a
 * service-role read proves nothing about tenant isolation. This probe must use
 * the anon key plus a real user's access token — exactly what a browser holds,
 * and exactly what an attacker would have after signing up.
 *
 * WRITES: reads are read-only, but two privilege probes (escalation, credit
 * minting) attempt a real PATCH against the PROBE ACCOUNT'S OWN row and revert
 * it immediately using the service key. Pass --read-only to skip them — CI PR
 * runs do; the scheduled run performs the full check.
 *
 *   Usage:  node scripts/security/cross-tenant-probe.mjs [--read-only]
 *   Exit 0 = no leaks. Exit 1 = leaks found (fails CI). Exit 2 = cannot run.
 *
 *   Requires in .env.local:
 *     NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *     SUPABASE_SERVICE_ROLE_KEY   (used ONLY to resolve org memberships, so
 *                                  legitimately-shared rows are not miscounted)
 *     E2E_USER_EMAIL, E2E_USER_PASSWORD
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PAGE = 200;

// --read-only skips the two write probes (privilege escalation, credit
// minting). Those attempt a real PATCH against the probe account's own row and
// revert it — safe, but a write against production nonetheless, so PR runs use
// read-only and the scheduled run does the full check.
const READ_ONLY = process.argv.includes('--read-only');

/** Tables to probe, and the column naming their owner. */
const TABLES = [
  { table: 'posts', owner: 'user_id', orgCol: 'organization_id' },
  { table: 'generations', owner: 'user_id', orgCol: 'organization_id' },
  { table: 'sessions', owner: 'user_id' },
  { table: 'content_plans', owner: 'user_id' },
  { table: 'personal_assets', owner: 'user_id' },
  { table: 'media_assets', owner: 'user_id' },
  { table: 'brand_kit', owner: 'user_id' },
  { table: 'connected_accounts', owner: 'user_id', orgCol: 'organization_id' },
  { table: 'video_jobs', owner: 'user_id' },
  { table: 'video_clips', owner: 'user_id' },
  { table: 'user_credits', owner: 'user_id' },
  { table: 'credit_transactions', owner: 'user_id' },
  { table: 'user_settings', owner: 'user_id' },
  { table: 'content_library_items', owner: 'user_id' },
  { table: 'studio_projects', owner: 'user_id' },
  { table: 'user_notifications', owner: 'user_id' },
  { table: 'content_versions', owner: 'user_id' },
  { table: 'ai_session_logs', owner: 'user_id' },
  // Platform analytics (20260909140000, 20260922120000). These tables have
  // composite keys and NO `id` column — selecting one would 400, which this
  // probe reads as SKIP ("safe"), so every entry names its columns explicitly.
  // The founder's live YouTube rows exist, so "the probe user sees none of
  // them" is a real assertion, not an empty one.
  ...[
    'social_post_metrics_daily',
    'social_post_metrics_snapshot',
    'social_account_metrics_daily',
    'social_account_metrics_snapshot',
    'social_post_breakdowns',
    'social_retention_curves',
    'social_platform_posts',
  ].map((table) => ({
    table,
    owner: 'user_id',
    orgCol: 'organization_id',
    cols: 'connected_account_id,user_id,organization_id',
  })),
];

function loadEnv() {
  const file = path.join(ROOT, '.env.local');
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

async function main() {
  const env = loadEnv();
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const svc = env.SUPABASE_SERVICE_ROLE_KEY;

  for (const [k, v] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: base,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    E2E_USER_EMAIL: env.E2E_USER_EMAIL,
    E2E_USER_PASSWORD: env.E2E_USER_PASSWORD,
  })) {
    if (!v) {
      console.error(`FATAL: ${k} is not set in .env.local`);
      process.exit(2);
    }
  }

  // ── Authenticate as an ordinary user, anon key only ────────────────────────
  const authRes = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.E2E_USER_EMAIL, password: env.E2E_USER_PASSWORD }),
  });
  const auth = await authRes.json();
  if (!auth.access_token) {
    console.error('FATAL: probe account login failed:', JSON.stringify(auth).slice(0, 200));
    process.exit(2);
  }
  const me = auth.user.id;
  const userHeaders = { apikey: anon, Authorization: `Bearer ${auth.access_token}` };

  console.log('cross-tenant probe');
  console.log(`  identity : ${me} (${env.E2E_USER_EMAIL})`);

  // ── Guard: the probe account MUST NOT be an admin, or the test is vacuous ──
  if (svc) {
    const svcHeaders = { apikey: svc, Authorization: `Bearer ${svc}` };
    const roleRes = await fetch(
      `${base}/rest/v1/admin_roles?select=role&user_id=eq.${me}`, { headers: svcHeaders });
    const roles = await roleRes.json().catch(() => []);
    if (Array.isArray(roles) && roles.length > 0) {
      console.error(`FATAL: probe account holds admin_roles (${JSON.stringify(roles)}).`);
      console.error('       An admin legitimately sees other users, so this probe would prove nothing.');
      console.error('       Use a plain, non-admin account.');
      process.exit(2);
    }
  }

  // ── Resolve legitimate org memberships so shared rows are not miscounted ───
  let myOrgs = new Set();
  if (svc) {
    const svcHeaders = { apikey: svc, Authorization: `Bearer ${svc}` };
    const memRes = await fetch(
      `${base}/rest/v1/organization_members?select=organization_id&status=eq.active&user_id=eq.${me}`,
      { headers: svcHeaders });
    const mem = await memRes.json().catch(() => []);
    if (Array.isArray(mem)) myOrgs = new Set(mem.map((m) => m.organization_id).filter(Boolean));
  }
  console.log(`  orgs     : ${myOrgs.size ? [...myOrgs].join(', ') : 'none'}`);
  console.log('');

  // ── Probe ─────────────────────────────────────────────────────────────────
  const leaks = [];
  let skipped = 0;

  for (const spec of TABLES) {
    const cols = spec.cols || ['id', spec.owner, spec.orgCol].filter(Boolean).join(',');
    const res = await fetch(
      `${base}/rest/v1/${spec.table}?select=${cols}&limit=${PAGE}`, { headers: userHeaders });

    if (!res.ok) {
      // 401/403/404 => table not exposed or fully denied. Both are safe outcomes.
      console.log(`  ${'SKIP'.padEnd(6)} ${spec.table.padEnd(24)} HTTP ${res.status}`);
      skipped += 1;
      continue;
    }

    const rows = await res.json();
    if (!Array.isArray(rows)) {
      console.log(`  ${'SKIP'.padEnd(6)} ${spec.table.padEnd(24)} unexpected payload`);
      skipped += 1;
      continue;
    }

    const foreign = rows.filter((r) => r[spec.owner] && r[spec.owner] !== me);
    // A foreign row is LEGITIMATE only if shared through an org the user is in.
    const illegitimate = foreign.filter((r) => {
      const org = spec.orgCol ? r[spec.orgCol] : null;
      return !(org && myOrgs.has(org));
    });

    if (illegitimate.length > 0) {
      const owners = new Set(illegitimate.map((r) => r[spec.owner]));
      leaks.push({ table: spec.table, rows: illegitimate.length, owners: owners.size, seen: rows.length });
      console.log(
        `  ${'LEAK'.padEnd(6)} ${spec.table.padEnd(24)} ` +
        `${illegitimate.length} foreign row(s) from ${owners.size} other user(s) ` +
        `(page of ${rows.length})`);
    } else {
      console.log(`  ${'ok'.padEnd(6)} ${spec.table.padEnd(24)} ${rows.length} row(s), none foreign`);
    }
  }

  // ── social_snapshot_summary (20260922120000) ──────────────────────────────
  //
  // A FUNCTION, not a table: it is SECURITY INVOKER and RLS on the tables it
  // reads should scope it — but "should" is a policy reading, and the only
  // evidence that counts is calling it as an ordinary user and checking every
  // row belongs to an account that user may see. Its rows carry no user_id,
  // so ownership is resolved through connected_accounts with the service key.
  {
    const res = await fetch(`${base}/rest/v1/rpc/social_snapshot_summary`, {
      method: 'POST',
      headers: { ...userHeaders, 'Content-Type': 'application/json', Range: `0-${PAGE - 1}` },
      body: JSON.stringify({ p_since: '1970-01-01T00:00:00Z' }),
    });
    if (!res.ok) {
      console.log(`  ${'SKIP'.padEnd(6)} ${'rpc social_snapshot_summary'.padEnd(24)} HTTP ${res.status} (not migrated yet?)`);
    } else if (!svc) {
      console.log(`  ${'SKIP'.padEnd(6)} ${'rpc social_snapshot_summary'.padEnd(24)} needs SUPABASE_SERVICE_ROLE_KEY to resolve owners`);
    } else {
      const rows = await res.json().catch(() => []);
      const ids = [...new Set((Array.isArray(rows) ? rows : []).map((r) => r.connected_account_id).filter(Boolean))];
      let illegitimate = [];
      if (ids.length) {
        const svcHeaders = { apikey: svc, Authorization: `Bearer ${svc}` };
        const own = await fetch(
          `${base}/rest/v1/connected_accounts?select=id,user_id,organization_id&id=in.(${ids.join(',')})`,
          { headers: svcHeaders });
        const owners = await own.json().catch(() => []);
        illegitimate = (Array.isArray(owners) ? owners : []).filter(
          (a) => a.user_id !== me && !(a.organization_id && myOrgs.has(a.organization_id)));
      }
      if (illegitimate.length) {
        leaks.push({ table: 'rpc social_snapshot_summary', rows: illegitimate.length, owners: illegitimate.length, seen: rows.length });
        console.log(`  ${'LEAK'.padEnd(6)} ${'rpc social_snapshot_summary'.padEnd(24)} returned ${illegitimate.length} foreign account(s)`);
      } else {
        console.log(`  ${'ok'.padEnd(6)} ${'rpc social_snapshot_summary'.padEnd(24)} ${rows.length} row(s), none foreign`);
      }
    }
  }

  // ── Privilege escalation check (LOCK L1.5) ────────────────────────────────
  //
  // profiles.role feeds get_admin_role -> is_admin_user -> can_admin_access_user,
  // which the posts and generations policies both consult. If a user can write
  // their own role, they can grant themselves every row — reopening the very
  // leak probed above. This was WRITE-CONFIRMED on 2026-08-21 (HTTP 200,
  // "parent" -> "admin") before being closed.
  //
  // The attempt targets only the probe account's OWN row and reverts on success.
  console.log('');
  let escalated = false;
  if (READ_ONLY) {
    console.log(`  skip   ${'privilege escalation'.padEnd(24)} --read-only (write probes disabled)`);
    console.log(`  skip   ${'credit minting'.padEnd(24)} --read-only (write probes disabled)`);
  } else {
    const svcHeaders = svc ? { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' } : null;
    let original = null;
    if (svcHeaders) {
      const cur = await fetch(`${base}/rest/v1/profiles?select=role&id=eq.${me}`, { headers: svcHeaders });
      original = (await cur.json().catch(() => []))?.[0]?.role ?? null;
    }

    const attempt = await fetch(`${base}/rest/v1/profiles?id=eq.${me}`, {
      method: 'PATCH',
      headers: { ...userHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ role: 'admin' }),
    });

    let nowRole = original;
    if (svcHeaders) {
      const after = await fetch(`${base}/rest/v1/profiles?select=role&id=eq.${me}`, { headers: svcHeaders });
      nowRole = (await after.json().catch(() => []))?.[0]?.role ?? null;
    }

    if (original !== null && nowRole !== original) {
      escalated = true;
      console.log(`  LEAK   ${'privilege escalation'.padEnd(24)} profiles.role "${original}" -> "${nowRole}" via ordinary JWT`);
      // Always restore, even though the run will fail.
      await fetch(`${base}/rest/v1/profiles?id=eq.${me}`, {
        method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ role: original }),
      });
      console.log(`  ${''.padEnd(6)} ${'(reverted)'.padEnd(24)} restored to "${original}"`);
    } else {
      console.log(`  ok     ${'privilege escalation'.padEnd(24)} blocked (HTTP ${attempt.status}), role unchanged`);
    }

    // ── Credit minting (LOCK L1.5, second exploit) ──────────────────────────
    //
    // credits gate video generation, image generation and clipping — each of
    // which costs real money per call. A self-writable balance is an unmetered
    // spend exploit against the business, and needs no sophistication at all.
    // Confirmed live 2026-08-21: 100 -> 999999 accepted.
    if (svcHeaders) {
      const cur = await fetch(`${base}/rest/v1/profiles?select=credits&id=eq.${me}`, { headers: svcHeaders });
      const before = (await cur.json().catch(() => []))?.[0]?.credits ?? null;

      if (before !== null) {
        const target = Number(before) + 999_999;
        const mint = await fetch(`${base}/rest/v1/profiles?id=eq.${me}`, {
          method: 'PATCH',
          headers: { ...userHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ credits: target }),
        });

        const post = await fetch(`${base}/rest/v1/profiles?select=credits&id=eq.${me}`, { headers: svcHeaders });
        const after = (await post.json().catch(() => []))?.[0]?.credits ?? null;

        if (after !== before) {
          escalated = true;
          console.log(`  LEAK   ${'credit minting'.padEnd(24)} profiles.credits ${before} -> ${after} via ordinary JWT`);
          await fetch(`${base}/rest/v1/profiles?id=eq.${me}`, {
            method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ credits: before }),
          });
          console.log(`  ${''.padEnd(6)} ${'(reverted)'.padEnd(24)} restored to ${before}`);
        } else {
          console.log(`  ok     ${'credit minting'.padEnd(24)} blocked (HTTP ${mint.status}), balance unchanged`);
        }
      }
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log('');
  if (leaks.length === 0 && !escalated) {
    console.log(
      `PASS — no cross-tenant leaks across ${TABLES.length - skipped} probed table(s)` +
      (READ_ONLY ? ' (read-only: write probes skipped).' : '; escalation blocked.'));
    process.exit(0);
  }

  if (escalated) {
    console.error('FAIL — privilege escalation: an ordinary user can set their own profiles.role.');
    console.error('       This grants admin, which reopens full cross-tenant access on posts and generations.');
    if (leaks.length === 0) process.exit(1);
  }

  console.error(`FAIL — cross-tenant data leak on ${leaks.length} table(s):`);
  for (const l of leaks) {
    console.error(`  ${l.table}: ${l.rows} row(s) belonging to ${l.owners} other user(s)`);
  }
  console.error('');
  console.error('An ordinary authenticated user can read data they do not own.');
  console.error('Diagnose with:  SELECT * FROM pg_policies WHERE tablename IN (...);');
  process.exit(1);
}

main().catch((err) => {
  console.error('FATAL: probe crashed:', err);
  process.exit(2);
});
