// supabase/functions/_shared/tokenCrypto.ts
//
// DENO TWIN of app/api/_lib/tokenCrypto.js — byte-identical algorithm and
// wire format, so a token encrypted by a Next.js route decrypts here and
// vice versa.
//
// Why a twin exists at all: tokens are WRITTEN by Next.js API routes (Node)
// during the OAuth callback, and READ here by the publish adapter, because
// the pg_cron scheduler dispatches to edge functions via pg_net. The two
// runtimes do not share a bundle.
//
// Why it is safe to duplicate: both sides are pure WebCrypto, which is the
// same specification in Node 22 and Deno, and the duplication is GUARDED —
// scripts/security/token-crypto.test.mjs round-trips ciphertext between the
// two files and fails if either drifts. That is an interop proof, not a text
// diff, so it catches semantic drift a diff would miss.
//
// If you change one of these files, change the other, and run:
//   node scripts/security/token-crypto.test.mjs
//
// DO NOT let these drift. A mismatch here does not corrupt formatting; it
// makes every stored token permanently undecryptable.

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

function bytesToB64url(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s: string) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function b64ToBytes(s: string) {
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
  const raw = Deno.env.get('TOKEN_ENCRYPTION_KEY') || '';

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

async function importKey(usage: KeyUsage) {
  return subtle().importKey('raw', readKeyBytes(), { name: 'AES-GCM' }, false, [usage]);
}

/**
 * Encrypt a token for storage.
 *
 * @param {string} plaintext the raw platform token
 * @returns {Promise<string>} versioned, self-describing ciphertext
 */
export async function encryptToken(plaintext: string): Promise<string> {
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
export async function decryptToken(stored: string): Promise<string> {
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

  let iv: Uint8Array; let tag: Uint8Array; let ct: Uint8Array;
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
