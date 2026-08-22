#!/usr/bin/env node
/**
 * secret-scan.mjs — LOCK L0.5.
 *
 * Fails if a live credential appears in a tracked file.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * The live WORKER_WEBHOOK_SECRET sat in docs/VIDEO_LAB_COMPLETE_GUIDE.md:538
 * from the repository's first commit until 2026-08-21 — in a DOCUMENTATION
 * file, which is exactly where nobody looks for one. It matched the value in
 * both .env.local and video-worker/.env.
 *
 * So this deliberately scans docs and markdown too, not just source. The
 * committed secret was never in a .ts file.
 *
 *   Usage:  node scripts/security/secret-scan.mjs
 *   Exit 0 = clean. Exit 1 = secret found (fails CI).
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';

/**
 * High-confidence patterns only. A scanner that cries wolf gets disabled, which
 * is worse than no scanner — so placeholders and examples must not trip it.
 */
const PATTERNS = [
  { name: 'Supabase/JWT token',   re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'Anthropic API key',    re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI-style key',     re: /\bsk-[A-Za-z0-9]{32,}/ },
  { name: 'Groq API key',         re: /\bgsk_[A-Za-z0-9]{30,}/ },
  { name: 'Stripe secret key',    re: /\bsk_(live|test)_[A-Za-z0-9]{20,}/ },
  { name: 'Stripe webhook secret',re: /\bwhsec_[A-Za-z0-9]{20,}/ },
  { name: 'fal.ai key',           re: /\bfal-[A-Za-z0-9-]{20,}:[A-Za-z0-9]{20,}/ },
  { name: 'Replicate token',      re: /\br8_[A-Za-z0-9]{30,}/ },
  { name: 'Paystack secret key',  re: /\bsk_(live|test)_[a-f0-9]{40}/ },
  { name: 'AWS access key id',    re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Private key block',    re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  // Assignment of a long opaque value to a secret-sounding name. This is the
  // shape the committed webhook secret had: NAME=<32 hex chars> in markdown.
  { name: 'Secret-shaped assignment',
    re: /\b[A-Z][A-Z0-9_]*(SECRET|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN)\s*[:=]\s*["']?[A-Za-z0-9+/_-]{24,}["']?/ },
];

/** Values that look like secrets but are deliberately fake. */
const PLACEHOLDER = /(your[_-]|example|placeholder|changeme|xxx+|\.\.\.|<[^>]+>|redacted|dummy|sample|test[_-]?key|ci-placeholder|never-commit)/i;

/**
 * Structural placeholder test, applied to the matched VALUE.
 *
 * A real credential is opaque: base64/hex-ish, mixed case or digits, no
 * dictionary structure. A placeholder reads as prose —
 * `the_same_secret_from_video-worker_env` is all lowercase words joined by
 * separators, which no generator produces.
 *
 * This exists because a keyword blocklist is whack-a-mole, and a scanner that
 * cries wolf gets switched off — which is strictly worse than no scanner.
 */
function looksLikeProse(value) {
  const v = String(value).replace(/^["']|["']$/g, '');
  if (/[A-Z]/.test(v)) return false;        // mixed case -> opaque
  if (/\d/.test(v)) return false;           // digits -> opaque
  // 3+ separator-joined lowercase words reads as a description, not a secret.
  return v.split(/[_-]/).filter((w) => w.length > 1).length >= 3;
}

/** Files that legitimately contain credential-shaped strings. */
const SKIP_PATHS = [
  '.env.example',                       // documented placeholders
  'scripts/security/secret-scan.mjs',   // this file's own patterns
  'package-lock.json',                  // integrity hashes
];

function isSkipped(file) {
  return SKIP_PATHS.some((p) => file === p || file.endsWith(`/${p}`));
}

let files;
try {
  // Tracked files only — .env.local and friends are gitignored and must stay
  // scannable-free by never being committed in the first place.
  files = execSync('git ls-files', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean);
} catch (err) {
  console.error('FATAL: could not list tracked files (not a git repo?)', err.message);
  process.exit(2);
}

const findings = [];
let scanned = 0;

for (const file of files) {
  if (isSkipped(file)) continue;

  let content;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;  // skip huge/binary
    content = fs.readFileSync(file, 'utf8');
  } catch {
    continue;  // unreadable or binary
  }
  if (content.includes('\0')) continue;

  scanned += 1;
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > 2000) continue;       // minified bundle
    if (PLACEHOLDER.test(line)) continue;   // documented fake

    for (const { name, re } of PATTERNS) {
      const m = re.exec(line);
      if (m) {
        // Split NAME=VALUE and judge the value, not the whole match — the name
        // always contains SECRET/PASSWORD, so testing the match is useless.
        const value = m[0].includes('=') ? m[0].split('=').slice(1).join('=')
                    : m[0].includes(':') ? m[0].split(':').slice(1).join(':')
                    : m[0];
        if (looksLikeProse(value)) break;   // documented placeholder

        findings.push({
          file,
          line: i + 1,
          name,
          // Never print the full value, even in a failure log CI will retain.
          preview: `${m[0].slice(0, 10)}…(${m[0].length} chars)`,
        });
        break;  // one finding per line is enough
      }
    }
  }
}

console.log(`secret scan (LOCK L0.5) — ${scanned} tracked files\n`);

if (findings.length === 0) {
  console.log('PASS — no live credentials found in tracked files.');
  process.exit(0);
}

for (const f of findings) {
  console.error(`  LEAK  ${f.file}:${f.line}  ${f.name}  ${f.preview}`);
}
console.error('');
console.error(`FAIL — ${findings.length} possible credential(s) in tracked files.`);
console.error('       Rotate the value FIRST (it is compromised the moment it is committed),');
console.error('       then remove it. If it is a placeholder, make that obvious in the text');
console.error('       so the scanner can tell — see the PLACEHOLDER pattern in this script.');
process.exit(1);
