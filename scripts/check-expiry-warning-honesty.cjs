#!/usr/bin/env node
/**
 * check-expiry-warning-honesty.cjs
 *
 * The guard for 20260917130000.
 *
 * ── What it protects ───────────────────────────────────────────────────────
 * connected_accounts_health_summary.credential_expiring_soon drives a visible
 * warning: "Expiring soon — Reconnect soon to keep publishing without
 * interruption" (ConnectedAccountCard.jsx:75).
 *
 * Until 2026-09-17 it asked only "does this token expire within 7 days?".
 * Google access tokens last ONE HOUR and are renewed automatically by
 * refresh-social-tokens, so every YouTube account displayed that warning
 * permanently, from connection until removal, with nothing wrong. A warning
 * that is always on is a warning nobody reads — and LinkedIn, which issues no
 * refresh token and genuinely does need a manual reconnect, is the account that
 * pays for it.
 *
 * The fix adds `AND has_refresh_token IS NOT TRUE`: an account that renews
 * itself is never "expiring".
 *
 * ── Why a guard and not just the migration ─────────────────────────────────
 * This view has been redefined in FOUR separate migrations, each one
 * copy-pasting the previous body. The fifth will too. The likely regression is
 * not someone arguing with the fix — it is someone pasting an older body over
 * it without noticing, which no test of today's database would catch, because
 * today's database would still be correct until that migration ran.
 *
 *   Usage:  node scripts/check-expiry-warning-honesty.cjs
 *   Exit 0 = clean. Exit 1 = a finding.
 */

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const VIEW = 'connected_accounts_health_summary';

const definers = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => /CREATE\s+(OR\s+REPLACE\s+)?VIEW\s+public\.connected_accounts_health_summary/i
    .test(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')))
  .sort(); // filenames are timestamps, so the last is the live definition

if (definers.length === 0) {
  console.error(`check-expiry-warning-honesty: FAIL — no migration defines ${VIEW}.`);
  console.error('  Every consumer of can_publish reads that view; it cannot simply not exist.');
  process.exit(1);
}

const newest = definers[definers.length - 1];
const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, newest), 'utf8');

// The expression is everything inside the parentheses that carry the alias.
// Matching on the alias keeps this working however the body is reformatted.
const expr = sql.match(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*AS\s+credential_expiring_soon/i);

if (!expr) {
  console.error(`check-expiry-warning-honesty: FAIL — ${newest} defines ${VIEW} but no`);
  console.error('  credential_expiring_soon column could be parsed.');
  console.error('  ConnectedAccountCard.jsx:75 reads that column; without it the badge silently');
  console.error('  never appears, and LinkedIn users learn their token died from a failed post.');
  process.exit(1);
}

const body = expr[1];
const findings = [];

if (!/has_refresh_token/i.test(body)) {
  findings.push(
    `${newest}: credential_expiring_soon does not consider has_refresh_token.\n`
    + '    Google access tokens last one hour and refresh automatically, so this warns on\n'
    + '    every healthy YouTube account forever. Restore:\n'
    + '      AND ca.has_refresh_token IS NOT TRUE',
  );
}

if (!/token_expires_at/i.test(body)) {
  findings.push(
    `${newest}: credential_expiring_soon no longer looks at token_expires_at, so it cannot\n`
    + '    be about expiry at all.',
  );
}

// The column the expression depends on has to be maintained by the trigger, not
// by application code — application code cannot read the secrets table.
const maintainer = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .some((f) => {
    const s = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    return /has_refresh_token\s*=\s*EXISTS/i.test(s) && /refresh_token_ciphertext/i.test(s);
  });

if (!maintainer) {
  findings.push(
    'No migration maintains connected_accounts.has_refresh_token from\n'
    + '    connected_account_secrets.refresh_token_ciphertext. The column would stay false\n'
    + '    forever, which restores the false alarm by another route.',
  );
}

if (findings.length === 0) {
  console.log('check-expiry-warning-honesty: PASS');
  console.log(`  ${newest} warns only when nothing will renew the credential.`);
  process.exit(0);
}

console.error(`check-expiry-warning-honesty: FAIL — ${findings.length} finding(s)\n`);
for (const f of findings) console.error(`  ${f}\n`);
process.exit(1);
