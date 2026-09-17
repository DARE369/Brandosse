#!/usr/bin/env node
/**
 * check-fk-delete-rule-guard.cjs
 *
 * The static half of the guard for 20260917120000. Its live half,
 * scripts/security/delete-rule-probe.mjs, reads the real catalog but needs a
 * database and therefore only runs on the scheduled job. This one runs on every
 * PR and catches the two ways the September 2026 defect was able to happen.
 *
 * ── Defect 1: a migration that guards on the constraint NAME ────────────────
 * 20260321113000:310-317 adds posts_account_id_fkey as ON DELETE SET NULL,
 * wrapped in `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname =
 * 'posts_account_id_fkey')`. A constraint of that name already existed live
 * with ON DELETE CASCADE, so the block did nothing — and said it had succeeded.
 * Five months later, disconnecting a YouTube account deleted two published
 * posts.
 *
 * A name is not a rule. Any block that adds a FOREIGN KEY must either not test
 * for existence at all, or test something that reflects BEHAVIOUR
 * (confdeltype), or drop first and recreate unconditionally.
 *
 * ── Defect 2: the manifest drifting from the migration ──────────────────────
 * The rules pinned in delete-rule-probe.mjs and the rules asserted by
 * 20260917120000 are the same decision written twice. If they diverge, the
 * probe passes while enforcing something nobody decided. So they are compared
 * mechanically here.
 *
 *   Usage:  node scripts/check-fk-delete-rule-guard.cjs
 *   Exit 0 = clean. Exit 1 = a finding.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const PROBE = path.join(ROOT, 'scripts', 'security', 'delete-rule-probe.mjs');
const PINNED_MIGRATION = path.join(
  MIGRATIONS_DIR,
  '20260917120000_delete_rules_protect_user_content.sql',
);

/**
 * Occurrences that already shipped. Applied migrations are not rewritten —
 * doing so leaves the repo describing a database nobody has — so each is listed
 * with what is actually known about the rule it failed to guarantee. Keyed by
 * file AND constraint, so a new foreign key added to one of these files is
 * still caught.
 *
 * This list is evidence of how common the pattern was: four occurrences, one of
 * which cost two published posts.
 */
const KNOWN_HISTORIC = new Set([
  // THE DEFECT. Live rule was CASCADE, not the SET NULL this claimed to add.
  // Superseded by 20260917120000, which drops and recreates unconditionally.
  '20260321113000_admin_moderation_schema_alignment.sql::posts_account_id_fkey',

  // profiles.id -> auth.users. Live rule read 2026-09-16: CASCADE, which is
  // what both migrations intended. Correct by luck, not by construction.
  '20260227090000_calendar_library_alignment.sql::profiles_id_fkey',
  '20260513160000_database_integrity_security_cleanup.sql::profiles_id_fkey',

  // organizations.plan_key -> plans. Live delete rule UNVERIFIED; it references
  // a configuration table rather than user content, so it cannot destroy
  // anything a user made. delete-rule-probe.mjs reports it either way.
  '20260324180000_org_seed_plan_data.sql::organizations_plan_key_fkey',
]);

const findings = [];

// ───────────────────────────────────────────────────────────────────────────
// 1. No FOREIGN KEY may be added under a name-only existence guard
// ───────────────────────────────────────────────────────────────────────────

const ADD_FK = /ADD\s+CONSTRAINT\s+([A-Za-z0-9_"]+)\s+FOREIGN\s+KEY/gi;

for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

  for (const match of sql.matchAll(ADD_FK)) {
    const constraintName = match[1].replace(/"/g, '');
    if (KNOWN_HISTORIC.has(`${file}::${constraintName}`)) continue;

    // Look back over the enclosing block for the existence test that decides
    // whether this ADD runs at all. 1200 characters comfortably covers a DO
    // block's condition without reaching into an unrelated earlier statement.
    const from = Math.max(0, match.index - 1200);
    const preceding = sql.slice(from, match.index);

    const guardsOnName = /NOT\s+EXISTS[\s\S]{0,400}?pg_constraint[\s\S]{0,400}?conname\s*=/i.test(preceding);
    if (!guardsOnName) continue;

    // Testing the delete rule, or dropping first, makes the guard honest.
    const checksBehaviour = /confdeltype/i.test(preceding);
    const dropsFirst = /DROP\s+CONSTRAINT/i.test(preceding);
    if (checksBehaviour || dropsFirst) continue;

    const line = sql.slice(0, match.index).split('\n').length;
    findings.push(
      `${file}:${line} adds FOREIGN KEY ${match[1]} only when no constraint of that NAME exists.\n`
      + '    A constraint with the right name and the wrong ON DELETE rule makes this block\n'
      + '    skip itself and report success. That is exactly how posts <- connected_accounts\n'
      + '    stayed CASCADE for five months and deleted two published posts.\n'
      + '    Fix: DROP the constraint first and recreate it, or test confdeltype, not conname.',
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 2. The probe's pinned rules must match the migration's assertions
// ───────────────────────────────────────────────────────────────────────────

function parseProbePinned(src) {
  const block = src.match(/const PINNED = \[([\s\S]*?)\n\];/);
  if (!block) return null;
  const out = [];
  const entry = /child:\s*'([^']+)',\s*column:\s*'([^']+)',\s*parent:\s*'([^']+)',\s*\n?\s*rule:\s*'([^']+)'/g;
  for (const m of block[1].matchAll(entry)) out.push(`${m[1]}|${m[2]}|${m[3]}|${m[4]}`);
  return out;
}

function parseMigrationExpected(sql) {
  const block = sql.match(/expected\s+CONSTANT\s+text\[\]\[\]\s*:=\s*ARRAY\[([\s\S]*?)\n\s*\];/);
  if (!block) return null;
  const out = [];
  const row = /\[\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\]/g;
  for (const m of block[1].matchAll(row)) out.push(`${m[1]}|${m[2]}|${m[3]}|${m[4]}`);
  return out;
}

if (!fs.existsSync(PROBE)) {
  findings.push(
    'scripts/security/delete-rule-probe.mjs is missing. The live delete rules would then be\n'
    + '    unobserved, which is the condition that let this defect class survive undetected.',
  );
} else if (!fs.existsSync(PINNED_MIGRATION)) {
  findings.push(
    `${path.basename(PINNED_MIGRATION)} is missing. The probe would be asserting rules that no\n`
    + '    migration establishes.',
  );
} else {
  const probeRules = parseProbePinned(fs.readFileSync(PROBE, 'utf8'));
  const migrationRules = parseMigrationExpected(fs.readFileSync(PINNED_MIGRATION, 'utf8'));

  if (!probeRules || probeRules.length === 0) {
    findings.push('delete-rule-probe.mjs: could not parse its PINNED list — the guard cannot verify it.');
  } else if (!migrationRules || migrationRules.length === 0) {
    findings.push(`${path.basename(PINNED_MIGRATION)}: could not parse its expected[] assertions.`);
  } else {
    const onlyProbe = probeRules.filter((r) => !migrationRules.includes(r));
    const onlyMigration = migrationRules.filter((r) => !probeRules.includes(r));

    for (const r of onlyProbe) {
      findings.push(
        `delete-rule-probe.mjs pins "${r}" but ${path.basename(PINNED_MIGRATION)} does not assert it.\n`
        + '    The probe would enforce a rule no migration establishes.',
      );
    }
    for (const r of onlyMigration) {
      findings.push(
        `${path.basename(PINNED_MIGRATION)} asserts "${r}" but the probe does not pin it.\n`
        + '    Nothing would notice if that rule drifted back afterwards.',
      );
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 3. Report
// ───────────────────────────────────────────────────────────────────────────

if (findings.length === 0) {
  console.log('check-fk-delete-rule-guard: PASS');
  console.log('  no FOREIGN KEY is added under a name-only guard; probe and migration agree.');
  process.exit(0);
}

console.error(`check-fk-delete-rule-guard: FAIL — ${findings.length} finding(s)\n`);
for (const f of findings) console.error(`  ${f}\n`);
console.error('  A delete rule is behaviour, not a name. Verify it against the live catalog:');
console.error('    node scripts/security/delete-rule-probe.mjs');
process.exit(1);
