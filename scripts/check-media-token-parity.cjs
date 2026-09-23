#!/usr/bin/env node
/**
 * check-media-token-parity.cjs — the two halves of the media token must agree.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * TikTok photo posts are PULL_FROM_URL only: TikTok fetches the image from a
 * URL on our verified domain. That URL carries an HMAC token MINTED in Deno
 * (supabase/functions/_shared/mediaToken.ts) and VERIFIED in Node
 * (app/api/_lib/mediaToken.js) — two implementations of one signature, in two
 * runtimes, in two files nobody edits together.
 *
 * Drift between them is invisible until a real photo post: TikTok fetches the
 * URL, our own proxy answers 403, and TikTok reports that it could not
 * download the image. Every clue points at TikTok or the file; none points at
 * the signature.
 *
 * This is the same twin-file risk as tokenCrypto (Node encrypts, Deno
 * decrypts), which is already guarded for the same reason.
 *
 * ── What it asserts ─────────────────────────────────────────────────────────
 *  1. Both files exist and agree on the payload shape ({g, p, exp}), base64url
 *     encoding and HMAC-SHA256.
 *  2. Both refuse a secret shorter than 32 characters — a mint path that fell
 *     back to a default would sign tokens anyone could forge.
 *  3. Both read the SAME env var. A rename on one side alone produces exactly
 *     the failure above.
 *  4. The TTLs match, so a token is not rejected while the minting side thinks
 *     it is still alive.
 *  5. END TO END: a minted token verifies; one whose payload was swapped for
 *     another generation id does not; an expired one does not.
 *
 * Running the Deno half here would need Deno in CI for this one check; the two
 * are compared structurally instead, and the live proof is the first real photo
 * post (tracked in TIKTOK-APP-REVIEW-PLAN.md).
 *
 *   Usage:  node scripts/check-media-token-parity.cjs
 *   Exit 0 = the halves agree. Exit 1 = a finding.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const NODE_FILE = 'app/api/_lib/mediaToken.js';
const DENO_FILE = 'supabase/functions/_shared/mediaToken.ts';

const findings = [];
const read = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};
const assert = (condition, message) => { if (!condition) findings.push(message); };

const nodeSrc = read(NODE_FILE);
const denoSrc = read(DENO_FILE);

assert(nodeSrc, `${NODE_FILE} is missing — the media proxy cannot verify anything.`);
assert(denoSrc, `${DENO_FILE} is missing — the publish adapter cannot mint a photo URL.`);

if (nodeSrc && denoSrc) {
  // 1. Same secret, same algorithm, same refusal of a weak key.
  for (const [label, src, file] of [['Node', nodeSrc, NODE_FILE], ['Deno', denoSrc, DENO_FILE]]) {
    assert(
      /MEDIA_PROXY_SECRET/.test(src),
      `${file} does not read MEDIA_PROXY_SECRET. The ${label} half would sign or verify with a `
      + 'different key, and every photo post would 403 against our own proxy.',
    );
    assert(
      /SHA-?256/i.test(src),
      `${file} no longer names SHA-256. The two halves must use one algorithm.`,
    );
    assert(
      /length\s*<\s*32/.test(src),
      `${file} no longer refuses a secret shorter than 32 characters. A weak or defaulted `
      + 'signing key makes the public media proxy forgeable.',
    );
  }

  // 2. Same payload shape.
  for (const key of ['g:', 'p:', 'exp:']) {
    assert(
      nodeSrc.includes(key) && denoSrc.includes(key),
      `The payload key "${key.replace(':', '')}" is missing from one half. Node verifies what Deno `
      + 'mints; a key present on one side only cannot round-trip.',
    );
  }

  // 3. Same TTL.
  const ttl = (src) => (/MEDIA_TOKEN_TTL_SECONDS\s*=\s*(\d+)/.exec(src) || [])[1];
  assert(
    ttl(nodeSrc) && ttl(nodeSrc) === ttl(denoSrc),
    `MEDIA_TOKEN_TTL_SECONDS differs: ${NODE_FILE}=${ttl(nodeSrc)}, ${DENO_FILE}=${ttl(denoSrc)}.`,
  );

  // 4. base64url on both sides: standard base64's + and / change meaning inside
  //    a URL path and would corrupt the token in transit.
  assert(
    /base64url/.test(nodeSrc) && /base64url/i.test(denoSrc),
    'One half is not using base64url.',
  );
}

// 5. The Node half must round-trip, and reject tampering.
if (nodeSrc) {
  process.env.MEDIA_PROXY_SECRET = 'x'.repeat(48); // test-only, never a real key
  (async () => {
    const href = 'file://' + path.join(ROOT, NODE_FILE).split(path.sep).join('/');
    const mod = await import(href);
    const token = mod.createMediaToken({ generationId: 'gen-123', postId: 'post-456' });

    const ok = mod.verifyMediaToken(token);
    assert(ok.ok && ok.generationId === 'gen-123', 'A freshly minted token does not verify.');

    const sig = token.split('.')[1];
    const tamperedPayload = Buffer.from(
      JSON.stringify({ g: 'someone-elses-generation', p: 'post-456', exp: Math.floor(Date.now() / 1000) + 600 }),
    ).toString('base64url');
    assert(
      mod.verifyMediaToken(`${tamperedPayload}.${sig}`).ok === false,
      'A token whose payload was swapped for another generation id still verifies. The public '
      + "media proxy would serve any user's asset to anyone who can edit a URL.",
    );

    const expired = mod.createMediaToken({ generationId: 'gen-123', postId: null, ttlSeconds: -10 });
    assert(mod.verifyMediaToken(expired).ok === false, 'An expired token still verifies.');

    report();
  })();
} else {
  report();
}

function report() {
  if (findings.length === 0) {
    console.log('check-media-token-parity: PASS');
    console.log('  both halves sign the same payload with the same algorithm and TTL;');
    console.log('  minted tokens verify, tampered and expired ones do not.');
    process.exit(0);
  }
  console.error(`check-media-token-parity: FAIL — ${findings.length} finding(s)\n`);
  for (const f of findings) console.error(`  ✗ ${f}\n`);
  console.error('  A photo post would fail with a 403 from our own proxy, and every symptom');
  console.error('  would point at TikTok or the image instead of the signature.');
  process.exit(1);
}
