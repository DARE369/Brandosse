#!/usr/bin/env node
/**
 * oauth-state.test.mjs — guard for LOCK L1.6.
 *
 * The Zernio OAuth callback establishes WHICH user an incoming social account
 * belongs to. It used to read that from an unsigned `profileId` query param
 * with no session check, so anyone able to induce a victim to load the callback
 * could attach an account they control to that victim's workspace — and since
 * `connected_accounts` is what the publisher dispatches to, the victim's
 * content would then publish to the attacker's account.
 *
 * Identity now comes from a signed state. These tests assert that forging,
 * tampering with, replaying past expiry, or cross-using a state all fail.
 *
 *   Usage:  node scripts/security/oauth-state.test.mjs
 *   Exit 0 = pass, 1 = fail (fails CI).
 */

import fs from 'node:fs';
import path from 'node:path';

// Load .env.local so OAUTH_STATE_SECRET is available.
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
}

const { createOAuthState, verifyOAuthState } = await import('../../app/api/_lib/oauthState.js');

const passed = [];
const failed = [];

function test(name, fn) {
  try { fn(); passed.push(name); }
  catch (err) { failed.push(`${name} -> ${err.message}`); }
}

/** Assert that `fn` throws with exactly `code`. */
function throwsWith(fn, code) {
  try { fn(); }
  catch (err) {
    if (err.message === code) return;
    throw new Error(`expected "${code}", got "${err.message}"`);
  }
  throw new Error(`expected throw "${code}", but the call SUCCEEDED`);
}

const valid = createOAuthState({ userId: 'user-A', platform: 'tiktok' });

test('a state minted for a user round-trips to that user', () => {
  const payload = verifyOAuthState(valid, { platform: 'tiktok' });
  if (payload.uid !== 'user-A') throw new Error(`uid was "${payload.uid}"`);
});

test('a missing state is rejected', () => {
  throwsWith(() => verifyOAuthState(null), 'oauth_state_missing');
});

test('a malformed state is rejected', () => {
  throwsWith(() => verifyOAuthState('not-a-state'), 'oauth_state_malformed');
});

// The core attack: swap the payload for one naming a different user, keeping a
// signature that was valid for the original payload.
test('a FORGED state naming another user is rejected', () => {
  const forged = Buffer.from(JSON.stringify({
    uid: 'victim-B', platform: 'tiktok', exp: 2000000000, nonce: 'x',
  })).toString('base64url') + '.' + valid.split('.')[1];
  throwsWith(() => verifyOAuthState(forged), 'oauth_state_bad_signature');
});

test('a state issued for one platform cannot be used for another', () => {
  throwsWith(() => verifyOAuthState(valid, { platform: 'instagram' }), 'oauth_state_platform_mismatch');
});

test('an expired state is rejected', () => {
  const expired = createOAuthState({ userId: 'u', platform: 'tiktok', ttlSeconds: -1 });
  throwsWith(() => verifyOAuthState(expired), 'oauth_state_expired');
});

test('each state is unique (nonce present)', () => {
  const a = createOAuthState({ userId: 'u', platform: 'tiktok' });
  const b = createOAuthState({ userId: 'u', platform: 'tiktok' });
  if (a === b) throw new Error('two states were identical — nonce not applied');
});

// ── returnTo: the redirect target rides inside the state ─────────────────────
//
// A user starts a connect from Settings, the composer, onboarding or a failed
// post, and must land back where they left. That destination survives a round
// trip through a third-party authorization server, so it travels in the signed
// state — which makes it a redirect target that a caller can influence.
//
// An unvalidated one is an open redirect: a link that starts on our real
// domain, carries our branding through a real login, and drops the user on a
// page somebody else controls. It is also the standard route for exfiltrating
// an OAuth authorization code.
//
// Signing does NOT make it safe — a signature proves we minted the value, not
// that the value is harmless. So these assert VALIDATION, at mint and at verify.

test('a legitimate in-app path survives the round trip', () => {
  const s = createOAuthState({ userId: 'u', platform: 'tiktok', returnTo: '/app/calendar?draft=abc' });
  const got = verifyOAuthState(s).rt;
  if (got !== '/app/calendar?draft=abc') throw new Error(`mangled a valid path: ${got}`);
});

test('an absolute off-origin URL is refused', () => {
  const s = createOAuthState({ userId: 'u', platform: 'tiktok', returnTo: 'https://evil.example/steal' });
  const got = verifyOAuthState(s).rt;
  if (got.includes('evil.example')) throw new Error(`open redirect: ${got}`);
});

test('a protocol-relative URL is refused (//evil.example reads as https://evil.example)', () => {
  const s = createOAuthState({ userId: 'u', platform: 'tiktok', returnTo: '//evil.example/steal' });
  const got = verifyOAuthState(s).rt;
  if (got.startsWith('//') || got.includes('evil.example')) throw new Error(`open redirect: ${got}`);
});

test('a backslash-smuggled URL is refused (browsers normalise \\ to /)', () => {
  for (const attack of ['/\\evil.example', '\\\\evil.example', '/app\\..\\..\\evil']) {
    const got = verifyOAuthState(createOAuthState({ userId: 'u', platform: 'tiktok', returnTo: attack })).rt;
    if (got.includes('\\')) throw new Error(`backslash survived: ${got}`);
  }
});

test('CR/LF cannot be smuggled in to split the Location header', () => {
  const attack = '/app/settings\r\nSet-Cookie: session=attacker';
  const got = verifyOAuthState(createOAuthState({ userId: 'u', platform: 'tiktok', returnTo: attack })).rt;
  if (got.includes('\r') || got.includes('\n')) throw new Error('CRLF survived into the redirect target');
});

test('a javascript: payload is refused', () => {
  const got = verifyOAuthState(
    createOAuthState({ userId: 'u', platform: 'tiktok', returnTo: 'javascript:alert(1)' }),
  ).rt;
  if (got.toLowerCase().includes('javascript')) throw new Error(`XSS sink: ${got}`);
});

test('an absent returnTo yields a safe same-origin default', () => {
  const got = verifyOAuthState(createOAuthState({ userId: 'u', platform: 'tiktok' })).rt;
  if (typeof got !== 'string' || !got.startsWith('/') || got.startsWith('//')) {
    throw new Error(`default is not a safe relative path: ${got}`);
  }
});

// The one that matters most: verify must not trust the payload just because the
// signature checks out. Mint a state whose returnTo is hostile by tampering
// BEFORE signing — i.e. simulate a future caller that skipped sanitising, or a
// leaked secret. verify() must still refuse to hand back an off-origin target.
test('verify re-validates returnTo even when the signature is genuine', async () => {
  const crypto = await import('node:crypto');
  const payload = {
    uid: 'u', platform: 'tiktok', scope: 'personal',
    rt: 'https://evil.example/steal',
    nonce: 'x', exp: Math.floor(Date.now() / 1000) + 600,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.OAUTH_STATE_SECRET)
    .update(b64).digest('base64url');

  const got = verifyOAuthState(`${b64}.${sig}`).rt;
  if (got.includes('evil.example')) {
    throw new Error('verify trusted a hostile returnTo because the signature was valid');
  }
});

test('signing fails closed when the secret is absent', () => {
  const saved = process.env.OAUTH_STATE_SECRET;
  process.env.OAUTH_STATE_SECRET = '';
  try {
    let threw = false;
    try { createOAuthState({ userId: 'u', platform: 'tiktok' }); }
    catch { threw = true; }
    if (!threw) throw new Error('minted a state with NO secret configured');
  } finally {
    process.env.OAUTH_STATE_SECRET = saved;
  }
});

console.log('oauth state guard (LOCK L1.6)\n');
for (const p of passed) console.log(`  ok    ${p}`);
for (const f of failed) console.log(`  FAIL  ${f}`);
console.log('');

if (failed.length) {
  console.error(`FAIL — ${failed.length} of ${passed.length + failed.length} checks failed.`);
  process.exit(1);
}
console.log(`PASS — ${passed.length} checks.`);
process.exit(0);
