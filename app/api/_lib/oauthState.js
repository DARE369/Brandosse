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

/** Where a connect flow lands when it carries no returnTo, or an unsafe one. */
export const DEFAULT_RETURN_TO = '/app/settings';

/** Long enough for any real in-app path; short enough to bound the state token. */
const MAX_RETURN_TO_LENGTH = 512;

/**
 * Reduce a caller-supplied returnTo to a path that can only land inside this
 * app, or fall back.
 *
 * ── Why this is not merely defensive ────────────────────────────────────────
 * A user can start a connect from Settings, the composer, onboarding, the
 * calendar, or a failed-post retry, and must come back to the one they left
 * with their draft intact. That destination has to survive a round trip
 * through a third-party authorization server, so it rides inside the signed
 * state.
 *
 * The moment a redirect target is attacker-influenceable, it is an open
 * redirect: a link that begins on our real domain, carries our real branding
 * through a real login, and deposits the user on a page somebody else
 * controls. Open redirects are also the standard way OAuth authorization codes
 * get exfiltrated.
 *
 * This file exists because the Zernio callback once trusted a query parameter
 * to decide WHICH USER an account belonged to (LOCK L1.6). Repeating that
 * mistake with the redirect target would be the same defect wearing a hat.
 *
 * Signing alone is not the answer either: a signed state proves WE minted the
 * value, not that the value is safe. If a route ever passes an unvalidated
 * `?next=` straight into createOAuthState, the signature would faithfully
 * authenticate an attacker's destination. So the value is validated at mint
 * AND re-validated at verify.
 *
 * Rejected, and why each one matters:
 *   - anything not starting with "/"  → absolute URLs go off-origin
 *   - "//evil.com"                    → protocol-relative; the browser reads
 *                                       this as https://evil.com
 *   - backslashes                     → several browsers normalise "\" to "/",
 *                                       so "/\evil.com" becomes "//evil.com"
 *   - control characters              → CR/LF enable Location header splitting
 *
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string} a safe same-origin path
 */
export function sanitizeReturnTo(value, fallback = DEFAULT_RETURN_TO) {
  if (typeof value !== 'string') return fallback;

  const v = value.trim();
  if (v === '' || v.length > MAX_RETURN_TO_LENGTH) return fallback;

  if (!v.startsWith('/')) return fallback;   // not a same-origin path at all
  if (v.startsWith('//')) return fallback;   // protocol-relative -> off-origin
  if (v.includes('\\')) return fallback;     // normalises to "/" in some browsers

  // Control characters, checked by code point: a CR or LF here would let a
  // caller split the Location header this value ends up in.
  for (let i = 0; i < v.length; i += 1) {
    const code = v.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return fallback;
  }

  return v;
}

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
 * `returnTo` is sanitised here rather than trusted. A caller that passes a
 * raw `?next=` through would otherwise get an attacker's destination faithfully
 * signed by us — the signature proves we minted it, never that it is safe.
 *
 * @param {{ userId: string, platform: string, scope?: string, returnTo?: string, ttlSeconds?: number }} args
 * @returns {string} opaque state token
 */
export function createOAuthState({
  userId,
  platform,
  scope = 'personal',
  returnTo,
  ttlSeconds = DEFAULT_TTL_SECONDS,
}) {
  if (!userId) throw new Error('createOAuthState: userId is required');
  if (!platform) throw new Error('createOAuthState: platform is required');

  const payload = {
    uid: userId,
    platform: String(platform).toLowerCase(),
    scope,
    // Where to land the user after the round trip. Sanitised at mint AND
    // re-checked at verify: signing authenticates the value, it does not
    // validate it.
    rt: sanitizeReturnTo(returnTo),
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

  // Re-sanitise on the way out. Defence in depth: if a future change ever mints
  // a state without validating returnTo — or the secret leaks and someone mints
  // their own — the callback still cannot be steered off-origin. The cost is one
  // string check; the failure it prevents is an open redirect wearing our
  // domain and our branding.
  payload.rt = sanitizeReturnTo(payload.rt);

  return payload;
}
