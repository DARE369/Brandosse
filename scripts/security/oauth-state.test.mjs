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
