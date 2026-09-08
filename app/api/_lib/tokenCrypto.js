/**
 * tokenCrypto.js — envelope encryption for platform access/refresh tokens.
 * SERVER ONLY.
 *
 * ── The defect this exists to close (D1) ────────────────────────────────────
 * `connected_accounts.access_token` and `.refresh_token` were bare `text`
 * columns (20260321113000:46-48) on a table that granted SELECT to
 * `authenticated` (20260712150000). RLS filters ROWS, not COLUMNS — so a user
 * could read their own token out of the browser console, and any XSS could
 * harvest every token it reached. 20260904120000 moved the secrets to a table
 * with no client grant; this module makes the stored value ciphertext, so a
 * database dump, backup snapshot, log line, or mis-scoped service-role query
 * yields nothing usable.
 *
 * ── Why WebCrypto rather than node:crypto ───────────────────────────────────
 * Tokens are WRITTEN by Next.js API routes (Node) and READ by Supabase edge
 * functions (Deno) — the publish adapter has to live in the edge function so
 * the existing pg_cron scheduler can reach it via pg_net.
 *
 * That means two runtimes must agree on the format exactly. `node:crypto` is
 * only partially supported in Supabase's Deno runtime, so relying on it would
 * make correctness depend on which subset happens to be implemented. WebCrypto
 * is guaranteed in both and is the same specification on each side.
 *
 * The cost is that every operation is async. That is worth paying to avoid the
 * alternative — two implementations kept in step by hand, which is exactly the
 * arrangement `platformCaptionSpecs` already has, complete with a comment
 * asking future readers to remember. A drift here would not be a formatting
 * bug; it would be every stored token becoming undecryptable.
 *
 * The Deno twin is supabase/functions/_shared/tokenCrypto.ts. It is the same
 * algorithm, and scripts/security/token-crypto.test.mjs proves the two
 * interoperate by round-tripping ciphertext between them — a real interop
 * check, not a text diff.
 *
 * ── AES-256-GCM, and why authenticated encryption specifically ──────────────
 * GCM authenticates as well as encrypts, so tampering is caught at decrypt
 * rather than silently producing a corrupted token that fails at the platform
 * with an unrelated-looking error. An unauthenticated mode would turn a
 * storage-integrity bug into a mystery publish failure.
 *
 * ── Format ──────────────────────────────────────────────────────────────────
 *   v1.<iv-b64url>.<authTag-b64url>.<ciphertext-b64url>
 *
 * The version prefix is not speculative. TOKEN_ENCRYPTION_KEY cannot be
 * rotated without re-encrypting every stored token, and doing that in place
 * means reading old-key rows while writing new-key rows. Without a version
 * marker that migration cannot tell them apart, so it must exist from the
 * first write or it can never be added.
 */

const IV_BYTES = 12;   // 96-bit nonce, the size GCM is specified for
const KEY_BYTES = 32;  // AES-256
const TAG_BYTES = 16;  // GCM auth tag, 128-bit
const VERSION = 'v1';

/** WebCrypto lives at globalThis.crypto in Node 18+ and in Deno. */
function subtle() {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error('WebCrypto is unavailable in this runtime — cannot handle platform tokens.');
  }
  return c.subtle;
}

// ── base64url helpers, runtime-agnostic ──────────────────────────────────────
// Buffer exists in Node but not necessarily in Deno's edge runtime, so these
// are written against atob/btoa, which both provide.

function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function b64ToBytes(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Resolve and validate the key. Throws rather than degrading.
 *
 * A missing key must never fall back to storing plaintext. That is the
 * fail-open pattern the audit found to be this codebase's recurring source of
 * silent compromise, and here it would mean the security property is absent
 * precisely on the environment that forgot to set it — where nobody is looking.
 */
function readKeyBytes() {
  // Read from whichever runtime is hosting us.
  const raw = (typeof process !== 'undefined' && process.env?.TOKEN_ENCRYPTION_KEY)
    || (typeof Deno !== 'undefined' && Deno.env?.get?.('TOKEN_ENCRYPTION_KEY'))
    || '';

  if (!raw) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is not set. Refusing to handle platform tokens without '
      + 'encryption. Generate one with: '
      + 'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }

  let bytes;
  try {
    bytes = b64ToBytes(raw);
  } catch {
    throw new Error('TOKEN_ENCRYPTION_KEY is not valid base64.');
  }

  if (bytes.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes `
      + `(got ${bytes.length}). A short key silently weakens every stored token.`,
    );
  }
  return bytes;
}

async function importKey(usage) {
  return subtle().importKey('raw', readKeyBytes(), { name: 'AES-GCM' }, false, [usage]);
}

/**
 * Encrypt a token for storage.
 *
 * @param {string} plaintext the raw platform token
 * @returns {Promise<string>} versioned, self-describing ciphertext
 */
export async function encryptToken(plaintext) {
  if (typeof plaintext !== 'string' || plaintext === '') {
    throw new Error('encryptToken: a non-empty string is required');
  }

  const key = await importKey('encrypt');

  // A fresh random IV per encryption. Reusing an IV under the same key breaks
  // GCM catastrophically — it leaks the XOR of plaintexts and forfeits
  // authentication entirely — so this is never derived from the token, the
  // account id, or anything else stable.
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const sealed = new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-GCM', iv, tagLength: TAG_BYTES * 8 },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );

  // WebCrypto appends the auth tag to the ciphertext; node:crypto exposes it
  // separately. Splitting it out keeps the stored format identical to what a
  // node:crypto implementation would produce, so the format is not tied to the
  // library that happened to write it.
  const ct = sealed.slice(0, sealed.length - TAG_BYTES);
  const tag = sealed.slice(sealed.length - TAG_BYTES);

  return `${VERSION}.${bytesToB64url(iv)}.${bytesToB64url(tag)}.${bytesToB64url(ct)}`;
}

/**
 * Decrypt a stored token.
 *
 * Throws on tampering, truncation, an unknown version, or the wrong key. Each
 * of those is a real failure that must surface as "reconnect this account"
 * rather than as a corrupted token handed to a platform API.
 *
 * @param {string} stored value produced by encryptToken
 * @returns {Promise<string>} the raw platform token
 */
export async function decryptToken(stored) {
  if (typeof stored !== 'string' || stored === '') {
    throw new Error('decryptToken: a non-empty string is required');
  }

  const parts = stored.split('.');
  if (parts.length !== 4) throw new Error('token_ciphertext_malformed');

  const [version, ivB64, tagB64, ctB64] = parts;
  if (version !== VERSION) {
    // Explicit, so a future v2 rotation fails loudly on unmigrated rows
    // instead of producing garbage.
    throw new Error(`token_ciphertext_unknown_version:${version}`);
  }

  let iv; let tag; let ct;
  try {
    iv = b64urlToBytes(ivB64);
    tag = b64urlToBytes(tagB64);
    ct = b64urlToBytes(ctB64);
  } catch {
    throw new Error('token_ciphertext_malformed');
  }

  if (iv.length !== IV_BYTES) throw new Error('token_ciphertext_bad_iv');
  if (tag.length !== TAG_BYTES) throw new Error('token_ciphertext_bad_tag');

  // Re-join tag onto ciphertext, which is the layout WebCrypto expects.
  const sealed = new Uint8Array(ct.length + tag.length);
  sealed.set(ct, 0);
  sealed.set(tag, ct.length);

  const key = await importKey('decrypt');

  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv, tagLength: TAG_BYTES * 8 },
      key,
      sealed,
    );
    return new TextDecoder().decode(plain);
  } catch {
    // GCM's authentication check failed: the ciphertext was altered, truncated,
    // or encrypted under a different key. Deliberately not distinguishing which
    // — that distinction is useful to an attacker and to nobody else.
    throw new Error('token_ciphertext_auth_failed');
  }
}

/** Is encryption available here? For health checks and startup asserts. */
export function isTokenCryptoConfigured() {
  try { readKeyBytes(); return true; } catch { return false; }
}
