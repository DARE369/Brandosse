#!/usr/bin/env node
/**
 * token-crypto.test.mjs — guard for defect D1 (platform token custody).
 *
 * Platform access and refresh tokens are durable credentials to somebody's
 * real social presence: the ability to post as them, indefinitely, from
 * anywhere. They used to land in `connected_accounts.access_token`, a bare text
 * column on a table that grants SELECT to `authenticated` — RLS filters rows,
 * never columns, so a user could read their own token out of devtools and an
 * XSS could harvest every token it reached. 20260904120000 closed the read
 * path; this module makes the stored value ciphertext.
 *
 * These tests assert the properties that matter if the database, a backup, or
 * a log line leaks — and, just as importantly, that the module REFUSES to
 * operate rather than quietly storing plaintext when the key is absent.
 *
 * They also prove CROSS-RUNTIME INTEROP. Tokens are written by Next.js API
 * routes (Node) and read by Supabase edge functions (Deno), from two separate
 * files. A text diff between those files would not catch semantic drift; a
 * round trip between them does. If Deno is not installed the interop check
 * reports as skipped rather than silently passing — CI has Deno.
 *
 *   Usage:  node scripts/security/token-crypto.test.mjs
 *   Exit 0 = pass, 1 = fail (fails CI).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Load .env.local if present, then guarantee a key so this runs anywhere —
// including CI, where no real key is configured and none is needed.
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
}
if (!process.env.TOKEN_ENCRYPTION_KEY) {
  process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
}

const NODE_IMPL = '../../app/api/_lib/tokenCrypto.js';
const DENO_IMPL = 'supabase/functions/_shared/tokenCrypto.ts';

const { encryptToken, decryptToken, isTokenCryptoConfigured } = await import(NODE_IMPL);

const passed = [];
const failed = [];
const skipped = [];

async function test(name, fn) {
  try { await fn(); passed.push(name); }
  catch (err) { failed.push(`${name} -> ${err.message}`); }
}

/** Assert that awaiting `fn()` rejects with `code`. */
async function throwsWith(fn, code) {
  try { await fn(); }
  catch (err) {
    if (err.message === code || err.message.startsWith(code)) return;
    throw new Error(`expected "${code}", got "${err.message}"`);
  }
  throw new Error(`expected throw "${code}", but the call SUCCEEDED`);
}

// A realistic subject: long, opaque, and the kind of thing a platform actually
// issues. Short test strings hide padding and block-boundary bugs.
const TOKEN = 'EAAG' + crypto.randomBytes(96).toString('base64url');

// ── Core round trip ──────────────────────────────────────────────────────────

await test('a token round-trips through encrypt/decrypt unchanged', async () => {
  const out = await decryptToken(await encryptToken(TOKEN));
  if (out !== TOKEN) throw new Error('round trip did not preserve the token');
});

await test('ciphertext does not contain the plaintext', async () => {
  const ct = await encryptToken(TOKEN);
  if (ct.includes(TOKEN)) throw new Error('plaintext is present in the ciphertext');
  if (ct.includes(TOKEN.slice(10, 40))) throw new Error('a plaintext fragment leaked');
});

await test('unicode and long tokens survive intact', async () => {
  const odd = 'tok_' + 'é中文🚀'.repeat(50);
  const back = await decryptToken(await encryptToken(odd));
  if (back !== odd) throw new Error('lossy for non-ASCII input');
});

// ── The property that makes GCM worth using ──────────────────────────────────

await test('the same token encrypts differently every time (fresh IV)', async () => {
  const a = await encryptToken(TOKEN);
  const b = await encryptToken(TOKEN);
  if (a === b) throw new Error('identical ciphertext for identical input — the IV is being reused');
});

await test('IVs do not repeat across many encryptions', async () => {
  const seen = new Set();
  for (let i = 0; i < 300; i += 1) {
    const ct = await encryptToken(TOKEN);
    const iv = ct.split('.')[1];
    if (seen.has(iv)) throw new Error('an IV repeated within 300 encryptions');
    seen.add(iv);
  }
});

// ── Tampering must be detected, not silently tolerated ───────────────────────

await test('a tampered ciphertext is rejected, not silently corrupted', async () => {
  const parts = (await encryptToken(TOKEN)).split('.');
  const ct = Buffer.from(parts[3], 'base64url');
  ct[0] ^= 0xff;
  parts[3] = ct.toString('base64url');
  await throwsWith(() => decryptToken(parts.join('.')), 'token_ciphertext_auth_failed');
});

await test('a tampered auth tag is rejected', async () => {
  const parts = (await encryptToken(TOKEN)).split('.');
  const tag = Buffer.from(parts[2], 'base64url');
  tag[0] ^= 0xff;
  parts[2] = tag.toString('base64url');
  await throwsWith(() => decryptToken(parts.join('.')), 'token_ciphertext_auth_failed');
});

await test('a swapped IV is rejected', async () => {
  const a = (await encryptToken(TOKEN)).split('.');
  const b = (await encryptToken(TOKEN)).split('.');
  a[1] = b[1];
  await throwsWith(() => decryptToken(a.join('.')), 'token_ciphertext_auth_failed');
});

await test('ciphertext from a DIFFERENT key does not decrypt', async () => {
  const ct = await encryptToken(TOKEN);
  const saved = process.env.TOKEN_ENCRYPTION_KEY;
  try {
    process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    await throwsWith(() => decryptToken(ct), 'token_ciphertext_auth_failed');
  } finally {
    process.env.TOKEN_ENCRYPTION_KEY = saved;
  }
});

// ── Format and version discipline ────────────────────────────────────────────

await test('a malformed value is rejected', async () => {
  await throwsWith(() => decryptToken('not-a-ciphertext'), 'token_ciphertext_malformed');
  await throwsWith(() => decryptToken('v1.only.three'), 'token_ciphertext_malformed');
});

await test('an unknown version is rejected rather than guessed at', async () => {
  const parts = (await encryptToken(TOKEN)).split('.');
  parts[0] = 'v2';
  await throwsWith(() => decryptToken(parts.join('.')), 'token_ciphertext_unknown_version');
});

await test('ciphertext is version-prefixed, so the key can ever be rotated', async () => {
  const ct = await encryptToken(TOKEN);
  if (!ct.startsWith('v1.')) {
    throw new Error('no version prefix — a future re-encryption could not tell key eras apart');
  }
});

// ── Fail closed ──────────────────────────────────────────────────────────────

await test('encryption REFUSES when no key is configured (never stores plaintext)', async () => {
  const saved = process.env.TOKEN_ENCRYPTION_KEY;
  try {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    let threw = false;
    try { await encryptToken(TOKEN); } catch { threw = true; }
    if (!threw) throw new Error('encrypted with NO key configured — this would store plaintext');
    if (isTokenCryptoConfigured()) throw new Error('reports configured with no key set');
  } finally {
    process.env.TOKEN_ENCRYPTION_KEY = saved;
  }
});

await test('a short key is refused rather than silently weakening every token', async () => {
  const saved = process.env.TOKEN_ENCRYPTION_KEY;
  try {
    process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(16).toString('base64');
    let threw = false;
    try { await encryptToken(TOKEN); } catch { threw = true; }
    if (!threw) throw new Error('accepted a 16-byte key for AES-256');
  } finally {
    process.env.TOKEN_ENCRYPTION_KEY = saved;
  }
});

await test('empty input is refused at both ends', async () => {
  await throwsWith(() => encryptToken(''), 'encryptToken');
  await throwsWith(() => decryptToken(''), 'decryptToken');
});

// ── Cross-runtime interop — the reason the twin file is safe to have ─────────
//
// Tokens are ENCRYPTED in Node (the OAuth callback) and DECRYPTED in Deno (the
// publish adapter, which must live in an edge function so the pg_cron
// scheduler can reach it). Two files, two runtimes, one wire format.
//
// Drift here would not be cosmetic: every stored token would become
// permanently undecryptable, and the symptom would be every publish failing
// with an auth error that points at the platform rather than at us.

function hasDeno() {
  try { execFileSync('deno', ['--version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

if (!fs.existsSync(DENO_IMPL)) {
  failed.push(`the Deno twin is missing at ${DENO_IMPL}`);
} else if (!hasDeno()) {
  skipped.push('cross-runtime interop (Deno is not installed on this machine — CI runs it)');
} else {
  const key = process.env.TOKEN_ENCRYPTION_KEY;

  await test('Deno can DECRYPT what Node encrypted', async () => {
    const ct = await encryptToken(TOKEN);
    const script = `
      const { decryptToken } = await import("./${DENO_IMPL}");
      const out = await decryptToken(${JSON.stringify(ct)});
      console.log(out);
    `;
    const out = execFileSync('deno', ['eval', '--quiet', '--allow-env', script], {
      encoding: 'utf8',
      env: { ...process.env, TOKEN_ENCRYPTION_KEY: key },
    }).trim();
    if (out !== TOKEN) throw new Error(`Deno decrypted to something else (${out.slice(0, 24)}…)`);
  });

  await test('Node can DECRYPT what Deno encrypted', async () => {
    const script = `
      const { encryptToken } = await import("./${DENO_IMPL}");
      console.log(await encryptToken(${JSON.stringify(TOKEN)}));
    `;
    const ct = execFileSync('deno', ['eval', '--quiet', '--allow-env', script], {
      encoding: 'utf8',
      env: { ...process.env, TOKEN_ENCRYPTION_KEY: key },
    }).trim();
    const out = await decryptToken(ct);
    if (out !== TOKEN) throw new Error('Node could not read Deno-produced ciphertext');
  });
}

// ── Report ───────────────────────────────────────────────────────────────────

console.log('token custody guard (defect D1)\n');
for (const p of passed) console.log(`  ok    ${p}`);
for (const s of skipped) console.log(`  skip  ${s}`);
for (const f of failed) console.log(`  FAIL  ${f}`);
console.log('');

if (failed.length) {
  console.error(`FAIL — ${failed.length} of ${passed.length + failed.length} checks failed.`);
  process.exit(1);
}
console.log(`PASS — ${passed.length} checks${skipped.length ? `, ${skipped.length} skipped` : ''}.`);
process.exit(0);
