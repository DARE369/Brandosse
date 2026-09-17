#!/usr/bin/env node
/**
 * check-scheduled-failure-messages.cjs
 *
 * The guard for 20260917140000.
 *
 * ── What it protects ───────────────────────────────────────────────────────
 * When a scheduled post cannot reach a usable account, the database fails it
 * and writes posts.error_message. That sentence is the ONLY explanation the
 * user ever gets — there is no other surface that says why a post did not go
 * out.
 *
 * Until 2026-09-17 every cause produced the same sentence: "No active connected
 * account could be matched for this scheduled post. Reselect a target platform
 * and reschedule." It is right for one of the four causes and actively
 * misleading for the rest. A user whose YouTube connection expired follows it,
 * reselects YouTube, reschedules, and fails again — the instruction cannot
 * work, and they have no way to know that.
 *
 * ── Why a guard ────────────────────────────────────────────────────────────
 * process_scheduled_posts() has been redefined in THREE migrations, each
 * pasting the previous body. A fourth that pastes the pre-2026-09-17 body would
 * restore the single message, and no test of behaviour would notice: posts
 * would still fail, still carry an error, still show it in the UI. Only the
 * WORDING regresses, and wording is the whole feature here.
 *
 *   Usage:  node scripts/check-scheduled-failure-messages.cjs
 *   Exit 0 = clean. Exit 1 = a finding.
 */

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');

const OLD_BLANKET = /No active connected account could be matched for this scheduled post/i;

/** Newest migration whose text defines the given function. */
function newestDefinerOf(fnName) {
  const re = new RegExp(`FUNCTION\\s+public\\.${fnName}\\s*\\(`, 'i');
  const hits = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => re.test(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')))
    .sort(); // timestamps
  return hits.length ? hits[hits.length - 1] : null;
}

const findings = [];

// ── 1. The worker must delegate its wording to the classifier ──────────────

const workerFile = newestDefinerOf('process_scheduled_posts');

if (!workerFile) {
  findings.push(
    'No migration defines process_scheduled_posts(). Scheduled posts would never be\n'
    + '    dispatched at all — the cron job would run and do nothing, successfully.',
  );
} else {
  const worker = fs.readFileSync(path.join(MIGRATIONS_DIR, workerFile), 'utf8');

  if (!/fail_undispatchable_scheduled_posts\s*\(/i.test(worker)) {
    findings.push(
      `${workerFile} is the newest definition of process_scheduled_posts() and it does not\n`
      + '    call fail_undispatchable_scheduled_posts().\n'
      + '    Either undispatchable posts sit as "scheduled" forever with no error shown\n'
      + '    (the defect 20260716140000 fixed), or the wording has been inlined again and the\n'
      + '    classifier can no longer be tested without dispatching real publishes.',
    );
  }

  if (OLD_BLANKET.test(worker) && !/Re-message the posts already failed/i.test(worker)) {
    findings.push(
      `${workerFile} writes the old single message back into posts.error_message.\n`
      + '    That sentence tells a user whose connection EXPIRED to reselect a platform,\n'
      + '    which cannot fix anything and fails again on the next attempt.',
    );
  }
}

// ── 2. The classifier must actually distinguish the causes ─────────────────

const classifierFile = newestDefinerOf('fail_undispatchable_scheduled_posts');

if (!classifierFile) {
  findings.push(
    'No migration defines fail_undispatchable_scheduled_posts(). Apply\n'
    + '    supabase/migrations/20260917140000_scheduled_failure_names_its_cause.sql.',
  );
} else {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, classifierFile), 'utf8');

  // Each of these is a cause the user can only act on if it is named.
  const causes = [
    { id: 'expired', re: /'expired'/i, why: 'an expired connection must say "reconnect", not "reselect"' },
    { id: 'revoked', re: /'revoked'/i, why: 'a withdrawn grant must say so; the user withdrew it' },
    {
      id: 'no platform chosen',
      re: /account_id IS NULL AND coalesce\(p\.platform, ''\) = ''/i,
      why: 'the one case where choosing a platform IS the fix must stay distinguishable',
    },
  ];

  for (const c of causes) {
    if (!c.re.test(sql)) {
      findings.push(
        `${classifierFile}: the classifier no longer distinguishes "${c.id}".\n`
        + `    ${c.why}.`,
      );
    }
  }

  // Distinct branches are worth nothing if they all end at the same sentence.
  const messages = [...sql.matchAll(/'((?:[^']|'')[^']{40,}?)'\s*$/gm)].map((m) => m[1]);
  const inCase = messages.filter((m) => /schedule it again|publish/i.test(m));
  if (new Set(inCase).size < 3 && inCase.length > 0) {
    findings.push(
      `${classifierFile}: fewer than three distinct failure messages were found.\n`
      + '    Separate branches that produce the same sentence are the original defect with\n'
      + '    extra steps.',
    );
  }
}

if (findings.length === 0) {
  console.log('check-scheduled-failure-messages: PASS');
  console.log('  a failed schedule names its own cause, and the worker delegates the wording.');
  process.exit(0);
}

console.error(`check-scheduled-failure-messages: FAIL — ${findings.length} finding(s)\n`);
for (const f of findings) console.error(`  ${f}\n`);
console.error('  posts.error_message is the only explanation a user ever sees for a post that');
console.error('  did not go out. Wrong advice there costs them the next attempt too.');
process.exit(1);
