/**
 * mediaToken.js — signed, expiring tokens for the public media proxy.
 *
 * ── Why a public media route exists at all ──────────────────────────────────
 * TikTok photo posts accept PULL_FROM_URL ONLY: TikTok's servers fetch the
 * images themselves, with no credential of ours, and the docs require that
 * "developer must verify the ownership of the URL prefix or domain". Our media
 * lives on <project>.supabase.co, a host we can never verify. So the bytes must
 * be served from brandosse.com.
 *
 * That makes this the first endpoint in the product that serves user media to
 * an unauthenticated caller, and the token is the only thing standing in front
 * of it. Hence:
 *
 *   * it names ONE generation — never a path, a bucket, or a pattern, so the
 *     route cannot be steered at another object;
 *   * it expires, so a leaked URL stops working;
 *   * it is bound to the post it was minted for, so a token issued for one
 *     publish cannot be replayed to fetch a different user's asset;
 *   * it is HMAC-signed with a secret the browser never sees.
 *
 * Format:  base64url(JSON payload) + "." + base64url(HMAC-SHA256 of that)
 * Payload: { g: generation_id, p: post_id, exp: unix seconds }
 *
 * The twin of this file is supabase/functions/_shared/mediaToken.ts, which
 * MINTS tokens inside the publish adapter (Deno). The two must agree byte for
 * byte or every photo post fails with a 403 from our own proxy —
 * scripts/check-media-token-parity.cjs asserts they do.
 */

import crypto from 'node:crypto';

/** How long a minted token stays valid. TikTok fetches within seconds. */
export const MEDIA_TOKEN_TTL_SECONDS = 1800; // 30 minutes

function getSecret() {
  const secret = process.env.MEDIA_PROXY_SECRET;
  // Fail closed. A default or a fallback here would mean anyone who reads this
  // open-source-shaped file can mint tokens for any generation id they can
  // guess, which is the whole security model of this route.
  if (!secret || secret.length < 32) {
    throw new Error(
      'MEDIA_PROXY_SECRET is missing or shorter than 32 characters. The media '
      + 'proxy refuses to run without it.',
    );
  }
  return secret;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payloadB64) {
  return crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
}

/**
 * Mint a token for one generation, for one post.
 * @returns {string} the token, to be placed in the proxy URL path
 */
export function createMediaToken({ generationId, postId, ttlSeconds = MEDIA_TOKEN_TTL_SECONDS }) {
  if (!generationId) throw new Error('createMediaToken: generationId is required');
  const payload = {
    g: String(generationId),
    p: postId ? String(postId) : null,
    exp: Math.floor(Date.now() / 1000) + Number(ttlSeconds || MEDIA_TOKEN_TTL_SECONDS),
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/**
 * Verify a token and return its payload.
 *
 * Returns { ok: false, reason } rather than throwing, so the route can answer
 * 403 for every failure without leaking which check failed.
 */
export function verifyMediaToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) {
    return { ok: false, reason: 'malformed' };
  }
  const [payloadB64, signature] = token.split('.', 2);
  if (!payloadB64 || !signature) return { ok: false, reason: 'malformed' };

  let expected;
  try {
    expected = sign(payloadB64);
  } catch (err) {
    return { ok: false, reason: 'not_configured', detail: err.message };
  }

  // Constant-time: a length-sensitive or early-exit comparison leaks the
  // signature one byte at a time to anyone willing to time the responses.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (!payload?.g) return { ok: false, reason: 'malformed' };
  if (!Number.isFinite(payload.exp) || payload.exp * 1000 < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, generationId: String(payload.g), postId: payload.p ? String(payload.p) : null };
}
