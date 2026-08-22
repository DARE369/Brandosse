#!/usr/bin/env node
/**
 * cross-tenant-write-probe.mjs — LOCK L6.4.
 *
 * The read half of tenant isolation is proven: cross-tenant-probe.mjs logs in
 * as a real non-admin user and confirms it can read nothing it does not own.
 * The write half was never tested. The audit says so explicitly — "writes were
 * deliberately not tested" — and an untested half is not a safe half. RLS
 * SELECT and RLS UPDATE/DELETE/INSERT are separate policies; fixing the first
 * says nothing about the second.
 *
 * Four distinct attacks, all of which the read probe would miss:
 *
 *   UPDATE  — change a row belonging to someone else
 *   DELETE  — destroy a row belonging to someone else
 *   INSERT  — create a row stamped with someone else's user_id, planting
 *             content inside their account
 *   REASSIGN— take a row you legitimately own and move it into someone else's
 *             account by changing user_id
 *
 * ── Why this creates its own accounts ───────────────────────────────────────
 * A write probe cannot be run against real users' rows. If isolation holds,
 * nothing happens; if it does not, the probe has damaged a real account to find
 * out. So it registers two throwaway accounts — a victim and an attacker — and
 * runs every attack between them. Same signal, no blast radius. Both are
 * deleted afterwards.
 *
 * ── The trap this is built around ───────────────────────────────────────────
 * PostgREST returns 204 No Content for an UPDATE or DELETE that matched zero
 * rows, which is byte-identical to one that matched and succeeded. During this
 * audit that ambiguity produced a false "credit minting" finding that had to be
 * retracted. So no verdict here is taken from a status code: after every write
 * attempt the row is re-read with the service key, and the verdict comes from
 * whether the DATA actually changed.
 *
 * ── What each verdict does and does not prove ───────────────────────────────
 * Verified 2026-08-22 by pointing the attacker at its OWN account, where every
 * write should land. UPDATE, INSERT and DELETE all flipped to LEAKED, so those
 * detectors work and their "blocked" verdicts are real cross-tenant refusals.
 *
 * Three did NOT flip — `user_credits.balance`, `profiles.status`, and moving a
 * row's `user_id` — because they are refused for the owner too. That is the
 * stricter and correct behaviour (a balance a user can edit is not a balance),
 * but it means those three prove "nobody may write this", not specifically
 * "no OTHER user may write this". Worth knowing before treating them as
 * cross-tenant evidence. It is also the direct confirmation that the credit
 * minting finding raised during this audit was wrong to raise, and right to
 * retract.
 *
 *   Usage:  node scripts/security/cross-tenant-write-probe.mjs
 *   Exit 0 = every write refused.  1 = a write landed.  2 = could not run.
 *
 *   Requires in .env.local:
 *     NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *     SUPABASE_SERVICE_ROLE_KEY  (to create/verify/clean up, never to attack)
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

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
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

if (!BASE || !ANON || !SERVICE) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and');
  console.error('       SUPABASE_SERVICE_ROLE_KEY are all required.');
  process.exit(2);
}

const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const asUser = (token) => ({ apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

/**
 * The tables to attack, with a minimal row each user can legitimately create
 * and one text column safe to try to overwrite.
 *
 * `posts` and `generations` are here because they are the two tables that
 * ACTUALLY leaked on read (P10s-001/002). Proving the read side is closed on
 * them says nothing about the write side — separate policies, separate
 * verdicts — so they get attacked directly rather than letting `sessions`
 * stand in for them.
 */
const TARGETS = [
  {
    table: 'sessions',
    field: 'title',
    row: (userId) => ({ user_id: userId, title: 'probe-session' }),
  },
  {
    table: 'posts',
    field: 'caption',
    row: (userId) => ({ user_id: userId, caption: 'probe-caption', status: 'draft' }),
  },
  {
    table: 'generations',
    field: 'prompt',
    row: (userId) => ({ user_id: userId, prompt: 'probe-prompt', media_type: 'image', status: 'pending' }),
  },
];

async function signUp(label) {
  const s = stamp();
  const email = `wprobe-${label}+${s}@brandosse-qa.dev`;
  const password = `Wprobe-${s}!`;
  const res = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  const token = body.access_token || body.session?.access_token;
  const id = body.user?.id || body.id;
  if (!token || !id) {
    console.error(`FATAL: could not create the ${label} account:`, JSON.stringify(body).slice(0, 200));
    process.exit(2);
  }
  return { email, password, id, token };
}

/** Delete a user, walking whatever foreign keys refuse to let go (horizon H13). */
async function destroy(user) {
  if (!user?.id) return;
  for (let i = 0; i < 12; i += 1) {
    const res = await fetch(`${BASE}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: svc });
    if (res.ok) return;
    let message = await res.text();
    try { message = JSON.parse(message)?.message ?? message; } catch { /* raw text */ }
    const named = [...message.matchAll(/on table "([^"]+)"/g)].map((m) => m[1]);
    const table = named.length > 1 ? named[named.length - 1] : null;
    if (!table) {
      console.warn(`  WARNING: could not remove ${user.email} — ${message.slice(0, 140)}`);
      return;
    }
    await fetch(`${BASE}/rest/v1/${table}?user_id=eq.${user.id}`, { method: 'DELETE', headers: svc });
  }
  console.warn(`  WARNING: could not remove ${user.email} after 12 attempts.`);
}

/** Read a row with the service key — the only source of truth about what happened. */
async function readRow(table, id) {
  const res = await fetch(`${BASE}/rest/v1/${table}?id=eq.${id}&select=*`, { headers: svc });
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

const results = [];
function record(attack, table, blocked, detail) {
  results.push({ attack, table, blocked, detail });
  const mark = blocked ? 'blocked' : 'LEAKED ';
  console.log(`  ${mark}  ${attack.padEnd(9)} ${table.padEnd(14)} ${detail}`);
}

async function main() {
  console.log('cross-tenant WRITE probe (L6.4)');
  console.log(`  ${BASE}\n`);

  const victim = await signUp('victim');
  const attacker = await signUp('attacker');
  console.log(`  victim   ${victim.id}`);
  console.log(`  attacker ${attacker.id}\n`);

  try {
    // The attacker must be an ordinary user, or the whole probe is vacuous.
    const roles = await (await fetch(
      `${BASE}/rest/v1/admin_roles?user_id=eq.${attacker.id}&select=role`, { headers: svc },
    )).json();
    if (Array.isArray(roles) && roles.length > 0) {
      console.error('FATAL: the attacker account holds admin_roles — this would prove nothing.');
      process.exit(2);
    }

    const atk = asUser(attacker.token);
    const vic = asUser(victim.token);

    // ── The four attacks, run against every target table ────────────────────
    for (const target of TARGETS) {
      const { table, field } = target;

      // The victim creates a row it genuinely owns, through the anon key — a
      // real user-owned row, not a service-role artefact.
      const mine = `victim-private-${stamp()}`;
      const created = await fetch(`${BASE}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...vic, Prefer: 'return=representation' },
        body: JSON.stringify({ ...target.row(victim.id), [field]: mine }),
      });
      const createdRows = await created.json().catch(() => null);
      const victimRow = Array.isArray(createdRows) ? createdRows[0] : null;
      if (!victimRow?.id) {
        console.error(`FATAL: the victim could not create its own ${table} row (${created.status}):`);
        console.error(`       ${JSON.stringify(createdRows).slice(0, 220)}`);
        console.error('       Without a row to defend, no verdict on this table would mean anything.');
        process.exit(2);
      }

      // ── 0. Positive control ───────────────────────────────────────────────
      // Every check below concludes "nothing happened", and a probe that can
      // only observe nothing happening reports PASS just as happily when it is
      // misconfigured, pointed at the wrong column, or unable to write at all.
      // So first prove writes land: the victim edits its OWN row. If this
      // fails, no refusal below means anything — and the product is broken
      // besides, because users could not edit their own data either.
      const renamed = `victim-renamed-${stamp()}`;
      await fetch(`${BASE}/rest/v1/${table}?id=eq.${victimRow.id}`, {
        method: 'PATCH', headers: vic, body: JSON.stringify({ [field]: renamed }),
      });
      const selfEdit = await readRow(table, victimRow.id);
      if (selfEdit?.[field] !== renamed) {
        console.error(`FATAL: positive control failed on ${table} — the victim could not edit its own row.`);
        console.error(`       ${field} is "${selfEdit?.[field]}" after a self-update.`);
        await destroy(victim);
        await destroy(attacker);
        process.exit(2);
      }
      await fetch(`${BASE}/rest/v1/${table}?id=eq.${victimRow.id}`, {
        method: 'PATCH', headers: vic, body: JSON.stringify({ [field]: mine }),
      });
      console.log(`  control  ${''.padEnd(9)} ${table.padEnd(14)} self-write lands — refusals below are real`);

      // ── 1. UPDATE someone else's row ──────────────────────────────────────
      await fetch(`${BASE}/rest/v1/${table}?id=eq.${victimRow.id}`, {
        method: 'PATCH', headers: atk, body: JSON.stringify({ [field]: 'OWNED-BY-ATTACKER' }),
      });
      // Status deliberately ignored: 204 means "no rows matched" exactly as
      // often as "it worked". Only the stored value settles it.
      let after = await readRow(table, victimRow.id);
      record('UPDATE', table, after?.[field] === mine,
        after ? `${field} is "${String(after[field]).slice(0, 30)}"` : 'row vanished');

      // ── 2. INSERT a row stamped with the victim's id ──────────────────────
      const plantMark = `PLANTED-${stamp()}`;
      const planted = await fetch(`${BASE}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...atk, Prefer: 'return=representation' },
        body: JSON.stringify({ ...target.row(victim.id), [field]: plantMark }),
      });
      const plantCheck = await (await fetch(
        `${BASE}/rest/v1/${table}?user_id=eq.${victim.id}&${field}=eq.${plantMark}&select=id`,
        { headers: svc },
      )).json();
      const plantLanded = Array.isArray(plantCheck) && plantCheck.length > 0;
      record('INSERT', table, !plantLanded,
        plantLanded ? 'attacker planted a row inside the victim account' : `refused (${planted.status})`);
      if (plantLanded) {
        await fetch(`${BASE}/rest/v1/${table}?${field}=eq.${plantMark}`, { method: 'DELETE', headers: svc });
      }

      // ── 3. REASSIGN a row the attacker owns into the victim's account ─────
      const ownMark = `attacker-own-${stamp()}`;
      const own = await fetch(`${BASE}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...atk, Prefer: 'return=representation' },
        body: JSON.stringify({ ...target.row(attacker.id), [field]: ownMark }),
      });
      const ownRows = await own.json().catch(() => null);
      const ownId = Array.isArray(ownRows) ? ownRows[0]?.id : null;
      if (ownId) {
        await fetch(`${BASE}/rest/v1/${table}?id=eq.${ownId}`, {
          method: 'PATCH', headers: atk, body: JSON.stringify({ user_id: victim.id }),
        });
        const moved = await readRow(table, ownId);
        record('REASSIGN', table, moved?.user_id === attacker.id,
          moved ? (moved.user_id === attacker.id ? 'owner unchanged' : 'OWNER IS NOW THE VICTIM') : 'row vanished');
      } else {
        record('REASSIGN', table, true, `attacker could not create a row to move (${own.status})`);
      }

      // ── 4. DELETE someone else's row ──────────────────────────────────────
      // Last for this table, so an unexpected success cannot invalidate the
      // probes above it.
      await fetch(`${BASE}/rest/v1/${table}?id=eq.${victimRow.id}`, { method: 'DELETE', headers: atk });
      after = await readRow(table, victimRow.id);
      record('DELETE', table, Boolean(after),
        after ? 'victim row still present' : 'VICTIM ROW DESTROYED');
    }

    // ── 5. The money table ────────────────────────────
    // user_credits is the one place where a write leak converts directly into
    // free product, so it gets its own pass rather than relying on sessions
    // standing in for every table.
    const before = await (await fetch(
      `${BASE}/rest/v1/user_credits?user_id=eq.${victim.id}&select=balance`, { headers: svc },
    )).json();
    const startBalance = before?.[0]?.balance;

    await fetch(`${BASE}/rest/v1/user_credits?user_id=eq.${victim.id}`, {
      method: 'PATCH', headers: atk, body: JSON.stringify({ balance: 999999 }),
    });
    const afterCredits = await (await fetch(
      `${BASE}/rest/v1/user_credits?user_id=eq.${victim.id}&select=balance`, { headers: svc },
    )).json();
    const endBalance = afterCredits?.[0]?.balance;
    record('UPDATE', 'user_credits', endBalance === startBalance,
      `balance ${startBalance} -> ${endBalance}`);

    // And the attacker topping up its OWN balance, which needs no cross-tenant
    // access at all and is the more likely attempt.
    const selfBefore = await (await fetch(
      `${BASE}/rest/v1/user_credits?user_id=eq.${attacker.id}&select=balance`, { headers: svc },
    )).json();
    await fetch(`${BASE}/rest/v1/user_credits?user_id=eq.${attacker.id}`, {
      method: 'PATCH', headers: atk, body: JSON.stringify({ balance: 999999 }),
    });
    const selfAfter = await (await fetch(
      `${BASE}/rest/v1/user_credits?user_id=eq.${attacker.id}&select=balance`, { headers: svc },
    )).json();
    record('SELF-TOPUP', 'user_credits', selfAfter?.[0]?.balance === selfBefore?.[0]?.balance,
      `own balance ${selfBefore?.[0]?.balance} -> ${selfAfter?.[0]?.balance}`);

    // ── 6. Profiles — the escalation surface ────────────────────────────────
    await fetch(`${BASE}/rest/v1/profiles?id=eq.${victim.id}`, {
      method: 'PATCH', headers: atk, body: JSON.stringify({ status: 'suspended' }),
    });
    const victimProfile = await (await fetch(
      `${BASE}/rest/v1/profiles?id=eq.${victim.id}&select=status`, { headers: svc },
    )).json();
    record('UPDATE', 'profiles', victimProfile?.[0]?.status !== 'suspended',
      `victim status is "${victimProfile?.[0]?.status}"`);
  } finally {
    console.log('');
    await destroy(victim);
    await destroy(attacker);
    console.log('  probe accounts removed');
  }

  const leaked = results.filter((r) => !r.blocked);
  console.log('');
  if (leaked.length === 0) {
    console.log(`PASS — all ${results.length} cross-tenant write attempts were refused.`);
    process.exit(0);
  }

  console.error(`FAIL — ${leaked.length} of ${results.length} write attempts LANDED:\n`);
  for (const r of leaked) console.error(`  ${r.attack} on ${r.table}: ${r.detail}`);
  console.error('\nAn ordinary user can modify another account. This is the write-side');
  console.error('equivalent of P10s-001 and is a BLOCKER.');
  process.exit(1);
}

main().catch((err) => {
  console.error('FATAL: probe crashed:', err);
  process.exit(2);
});
