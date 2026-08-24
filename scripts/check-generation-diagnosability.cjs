#!/usr/bin/env node
/**
 * check-generation-diagnosability.cjs
 *
 * Found 2026-08-24 from a real failed generation. Two defects, one theme:
 * the system knew exactly what went wrong and told the user nothing useful.
 *
 * 1. A brand-wide `min_caption_words` (default 20, BrandKitForm.jsx) was
 *    applied identically to every platform. The user asked for a short,
 *    conversational X post; the model correctly produced 7 and 13 words; the
 *    guardrail rejected both and then hard-blocked the generation when the
 *    revision call could not be reached. X caps a post at 280 characters — a
 *    20-word floor is most of the post. The output was right; the rule was
 *    wrong. The floor is now CAPPED per platform (lowered, never raised) and
 *    the maximum is untouched.
 *
 * 2. When every variant failed, the per-variant reasons were collected in
 *    `outcomes` and then discarded in favour of "All variants failed to
 *    generate." The real causes — an edge-function 504 and a guardrail block
 *    — were already in hand and thrown away.
 *
 * Note on the CORS red herring: _shared/http.ts sends
 * Access-Control-Allow-Origin: "*". A "blocked by CORS policy" error from an
 * edge function is therefore NOT a CORS misconfiguration — it is a function
 * that died (timeout/crash) and returned no headers at all. Do not "fix CORS".
 */
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const gate  = strip(read('src/services/qualityGate.js'));
const store = strip(read('src/stores/SessionStore.js'));
const http  = read('supabase/functions/_shared/http.ts');

const failures = [];
const need = (cond, msg) => { if (!cond) failures.push(msg); };

// ── 1. Caption floor must be platform-aware ───────────────────────────────
need(/PLATFORM_MIN_WORD_CEILING/.test(gate),
  'qualityGate.js: caption minimum is not platform-aware — a 20-word floor on X rejects correct short posts');
// Must be CALLED by the length check, not merely declared. A bare
// /effectiveMinWords\(/ matched the function's own declaration and passed
// while the check had been reverted to the raw brand minimum.
need(/const\s+min\s*=\s*effectiveMinWords\(/.test(gate),
  'qualityGate.js: effectiveMinWords is declared but the length check does not call it');
// It must LOWER a floor, never raise one. Math.min is the whole guarantee.
need(/Math\.min\(\s*brandMin\s*,\s*ceiling\s*\)/.test(gate),
  'qualityGate.js: the platform ceiling does not use Math.min — it could RAISE a brand minimum');
need(/\bx:\s*\d+/.test(gate) && /twitter:\s*\d+/.test(gate),
  'qualityGate.js: X/Twitter missing from the platform ceiling table');
// The MAXIMUM must stay the brand's, untouched by platform.
need(/max_caption_words/.test(gate),
  'qualityGate.js: caption maximum no longer read from the brand kit');
need(!/effectiveMaxWords/.test(gate),
  'qualityGate.js: the platform table must not alter the maximum, only the minimum');

// ── 2. Failure reasons must reach the user ────────────────────────────────
const allFailedBlock = store.slice(
  Math.max(0, store.indexOf('All variants failed to generate')) - 900,
  store.indexOf('All variants failed to generate') + 200,
);
need(/reasons/.test(allFailedBlock),
  'SessionStore.js: "All variants failed" discards the per-variant reasons it already collected');
need(/o\.error/.test(allFailedBlock),
  'SessionStore.js: the aggregated failure message does not include outcome errors');

// ── 3. The CORS red herring must stay impossible ──────────────────────────
need(/"Access-Control-Allow-Origin":\s*"\*"/.test(http),
  '_shared/http.ts: CORS is no longer open — a preview deploy would fail for REAL, and the misleading "CORS" symptom would become genuine');

if (failures.length) {
  console.error('\n  check-generation-diagnosability FAILED\n');
  for (const f of failures) console.error('   - ' + f);
  console.error('');
  process.exit(1);
}
console.log('  check-generation-diagnosability: OK');
