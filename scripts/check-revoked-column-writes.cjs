#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * check-revoked-column-writes.cjs — guard for defect D1's second half.
 *
 * ── The bug this exists to prevent ──────────────────────────────────────────
 * Migration 20260904120000 moved platform credentials into
 * connected_account_secrets and revoked client access to the old columns on
 * connected_accounts:
 *
 *     access_token, refresh_token, mock_token
 *
 * Three client code paths were still WRITING those columns — disconnect,
 * reconnect, and mock connect. Every one of them began returning 403 the
 * moment the migration landed, and the first anyone knew was a user unable to
 * remove an account.
 *
 * That is the expensive shape of failure: the schema change was correct, the
 * client was stale, nothing connected the two, and the symptom appeared far
 * from the cause. `tsc` cannot catch it — these are string keys in an object
 * literal handed to PostgREST. Only a check that knows about the denylist can.
 *
 * ── What it enforces ────────────────────────────────────────────────────────
 * No file under src/ may write a revoked column on connected_accounts.
 *
 * Edge functions are deliberately NOT scanned: they run as service-role, which
 * retains full access, and admin-account-action / admin-seed-connected-account
 * legitimately still write mock_token there.
 *
 * Run: node scripts/check-revoked-column-writes.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

/** Must match the denylist in apply_connected_accounts_column_grants(). */
const REVOKED = ['access_token', 'refresh_token', 'mock_token'];

/**
 * Supabase's own auth session objects use access_token/refresh_token too, and
 * those are unrelated to connected_accounts. Skip files that are clearly
 * dealing with an auth session rather than a connected account.
 */
const AUTH_SESSION_FILES = [
  'src/pages/Auth/ResetPassword.jsx',
  'src/lib/video-engine/auth-helpers.ts',
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const findings = [];

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (AUTH_SESSION_FILES.includes(rel)) continue;

  const text = fs.readFileSync(file, 'utf8');
  // Only worth checking files that touch the table at all.
  if (!text.includes('connected_accounts')) continue;

  text.split(/\r?\n/).forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');          // ignore line comments
    if (/^\s*\*/.test(line) || /^\s*\/\*/.test(line)) return;  // block comments

    for (const col of REVOKED) {
      // An object-literal assignment: `access_token: something`
      const re = new RegExp(`(^|[\\s{,])${col}\\s*:`);
      if (re.test(code)) {
        findings.push({ file: rel, line: i + 1, col, text: line.trim().slice(0, 100) });
      }
    }
  });
}

console.log('revoked-column write guard (defect D1)\n');

if (findings.length === 0) {
  console.log(`  ok    no client writes to ${REVOKED.join(', ')} on connected_accounts`);
  console.log('\nPASS');
  process.exit(0);
}

for (const f of findings) {
  console.log(`  FAIL  ${f.file}:${f.line}  writes "${f.col}"`);
  console.log(`          ${f.text}`);
}

console.error(
  `\nFAIL — ${findings.length} client write(s) to a revoked column.\n\n`
  + 'These columns were revoked from `authenticated` by migration 20260904120000;\n'
  + 'writing them from the browser returns 403 at runtime, not at build time.\n'
  + 'Real credentials belong in connected_account_secrets, written server-side.\n'
  + 'If the value is genuinely unused, delete the assignment rather than\n'
  + 're-granting the column.',
);
process.exit(1);
