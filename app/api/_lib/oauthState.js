/**
 * oauthState.js — signed OAuth state for the Zernio connect flow (LOCK L1.6).
 *
 * SERVER ONLY. Lives under app/api/_lib/ rather than src/ because it reads
 * OAUTH_STATE_SECRET. Anything under src/ is client-bundleable, so a future
 * component could import this and ship the secret to the browser — which is
 * exactly what scripts/check-env-security.cjs flagged when it was first
 * written there. The underscore prefix keeps Next from treating it as a route.
 *
 * ── The defect this closes ───────────────────────────────────────────────────
 * /api/auth/zernio/callback used to determine WHICH Brandosse user an incoming
 * social account belonged to by reading an unsigned `profileId` query
 * parameter and looking it up in `profiles.zernio_profile_id`. There was no
 * session check and no CSRF state.
 *
 * That means anyone who could induce a logged-in victim to load the callback
 * URL — or who learned a victim's zernio_profile_id — could attach an account
 * of their choosing to that victim's workspace. The harm is not merely a bogus
 * row: `connected_accounts` is what the publisher dispatches to, so the
 * victim's scheduled content would publish to an account the attacker controls.
 *
 * ── The fix ─────────────────────────────────────────────────────────────────
 * /connect authenticates the user (it already did), then signs a short-lived
 * state carrying that verified user id. /callback verifies the signature before
 * trusting anything, and derives the user from the STATE — never from a
 * query parameter the caller supplied.
 *
 * Format:  base64url(JSON payload) + "." + base64url(HMAC-SHA256)
 * This is deliberately dependency-free and symmetric — we issue and verify
 * both ends, so a JWT library would add surface without adding safety.
 *
 * Fails closed: a missing OAUTH_STATE_SECRET throws rather than degrading to
 * an unverified flow. An unverifiable state is indistinguishable from a forged
 * one, and this codebase's audit found fail-open defaults to be a recurring
 * source of silent compromise.
 */
import crypto from 'node:crypto';

const DEFAULT_TTL_SECONDS = 600; // 10 minutes — an OAuth round trip is seconds

function getSecret() {
  const secret = process.env.OAUTH_STATE_SECRET || '';
  if (secret.length < 32) {
    throw new Error(
      'OAUTH_STATE_SECRET is missing or too short (min 32 chars). ' +
      'OAuth connect is disabled until it is set — refusing to run an unverified flow.',
    );
  }
  return secret;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payloadB64) {
  return crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
}

/**
 * Create a signed state for a verified user starting a connect flow.
 *
 * @param {{ userId: string, platform: string, scope?: string, ttlSeconds?: number }} args
 * @returns {string} opaque state token
 */
export function createOAuthState({ userId, platform, scope = 'personal', ttlSeconds = DEFAULT_TTL_SECONDS }) {
  if (!userId) throw new Error('createOAuthState: userId is required');
  if (!platform) throw new Error('createOAuthState: platform is required');

  const payload = {
    uid: userId,
    platform: String(platform).toLowerCase(),
    scope,
    // Nonce makes each state unique even for identical user+platform, so a
    // captured state cannot be silently reused within its TTL window.
    nonce: crypto.randomBytes(12).toString('base64url'),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };

  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/**
 * Verify a state token and return its payload.
 *
 * @param {string} state
 * @param {{ platform?: string }} [expect] optional cross-check
 * @returns {{ uid: string, platform: string, scope: string, nonce: string, exp: number }}
 * @throws if missing, malformed, tampered with, expired, or platform-mismatched
 */
export function verifyOAuthState(state, expect = {}) {
  if (!state || typeof state !== 'string') {
    throw new Error('oauth_state_missing');
  }

  const [payloadB64, signature] = state.split('.');
  if (!payloadB64 || !signature) {
    throw new Error('oauth_state_malformed');
  }

  // Constant-time comparison — a length-safe equality check prevents the
  // timing side channel that a plain === would expose.
  const expected = sign(payloadB64);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('oauth_state_bad_signature');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw new Error('oauth_state_unparseable');
  }

  if (!payload?.uid) throw new Error('oauth_state_no_subject');

  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('oauth_state_expired');
  }

  if (expect.platform && payload.platform !== String(expect.platform).toLowerCase()) {
    throw new Error('oauth_state_platform_mismatch');
  }

  return payload;
}
