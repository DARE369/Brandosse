#!/usr/bin/env node
/**
 * check-brand-kit-trust.cjs — the brand kit is loaded, never accepted.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * `generateVideo` and `generateImage` both took the brand kit from the REQUEST
 * BODY and used it without ever loading it by `user_id`. The client sends it
 * (`src/services/media.service.js:363`), and the server trusted it — so the
 * "user's brand kit" was in fact arbitrary text chosen by whoever made the
 * request.
 *
 * The impact was bounded only because the values were used as prompt text. It
 * stops being bounded the moment any kit value influences model routing or
 * credit tier, because that is client-controlled spend. The rule:
 *
 *     Free text may reach a prompt. It must never reach a router.
 *
 * ── What this asserts ───────────────────────────────────────────────────────
 * No edge function READS a brand kit off the request body. Declaring the field
 * is fine — older clients still send it and rejecting them would be a needless
 * break — but reading it is not.
 *
 * Any function that uses brand data must call loadBrandKit() from
 * _shared/brandKit.ts, which is scoped by the authenticated user's id.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const FUNCTIONS_DIR = path.join(ROOT, 'supabase', 'functions');

// Reads of a kit off the request body, in the shapes this repo actually uses.
const FORBIDDEN_READS = [
  /\bbody\s*\.\s*brandKit\b/,
  /\bbody\s*\[\s*['"]brandKit['"]\s*\]/,
  /\bbody\s*\.\s*brand_kit\b/,
  /\bconst\s*\{[^}]*\bbrandKit\b[^}]*\}\s*=\s*body\b/,
];

// A type declaration is not a read. Older clients still send the field; the
// point is that the value is ignored, not that the request is rejected.
const DECLARATION = /^\s*(\/\*|\*|\/\/)|^\s*brandKit\?:/;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

if (!fs.existsSync(FUNCTIONS_DIR)) {
  console.error('  check-brand-kit-trust: FAIL — supabase/functions not found.');
  process.exit(1);
}

const failures = [];
let scanned = 0;

for (const file of walk(FUNCTIONS_DIR)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  scanned += 1;

  lines.forEach((line, i) => {
    if (DECLARATION.test(line)) return;
    for (const pattern of FORBIDDEN_READS) {
      if (pattern.test(line)) {
        failures.push(
          `${rel}:${i + 1} reads the brand kit from the request body.\n` +
          `      ${line.trim()}\n` +
          `      Use loadBrandKit(adminClient, user.id) from _shared/brandKit.ts. ` +
          `A kit taken from the body is attacker-controlled, not the ` +
          `authenticated user's.`,
        );
        break;
      }
    }
  });
}

if (failures.length > 0) {
  console.error('  check-brand-kit-trust: FAIL\n');
  for (const f of failures) console.error(`    - ${f}\n`);
  process.exit(1);
}

console.log(`  check-brand-kit-trust: OK (${scanned} edge function files, no body-sourced brand kits)`);
