#!/usr/bin/env node
/**
 * check-nonterminal-state-reapers.cjs — every time-bound non-terminal post
 * state has something watching it.
 *
 * ── The rule this enforces ──────────────────────────────────────────────────
 * CLAUDE.md: "Every non-terminal state needs a reaper." That rule existed and
 * was half-kept. `publishing` was reaped (20260821160000). `scheduled` was not:
 * a post that was due, dispatchable, and simply never sent — because the cron
 * job stopped, or the edge function 500d — sat in `scheduled` forever, shown in
 * the calendar as pending, never sent and never reported. Exactly the shape of
 * every serious finding in this codebase: working code that silently stopped,
 * with nothing watching.
 *
 * Adding the detector fixes today. This check is what keeps it fixed, and what
 * makes a NEW non-terminal status impossible to add unguarded.
 *
 * ── Why `draft` is exempt, explicitly ───────────────────────────────────────
 * `draft` is non-terminal and has no reaper, correctly. It is where unfinished
 * work rests, indefinitely and on purpose; reaping it would delete things people
 * are still writing. The distinction that matters is not terminal vs
 * non-terminal, it is whether the state carries a PROMISE THAT TIME WILL PASS.
 * `scheduled` promises the post goes out; `publishing` promises it is going out
 * now. `draft` promises nothing. Encoded below rather than left to judgement,
 * so the exemption is a decision on record and not an oversight.
 *
 * READ-ONLY. Exit 0 = every promise is watched. Exit 1 = one is not (fails CI).
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const failures = [];
const passes = [];

function assert(condition, message, okMessage) {
  if (condition) passes.push(okMessage);
  else failures.push(message);
}

// ── Read the statuses from the source of truth, never a hardcoded copy ──────
//
// A hardcoded list here would silently stop covering a status the moment
// someone added one — which is the precise failure this check exists to make
// impossible.
const statusesSrc = fs.readFileSync(path.join(ROOT, 'src/constants/statuses.js'), 'utf8');
const block = /export const POST_STATUS = \{([\s\S]*?)\}/.exec(statusesSrc);

assert(
  Boolean(block),
  'src/constants/statuses.js no longer exports a POST_STATUS object this check can read. '
  + 'Without it, nothing verifies that new statuses arrive with a detector.',
  'POST_STATUS is readable from the source of truth',
);

const allStatuses = block
  ? [...block[1].matchAll(/^\s*[A-Z_]+:\s*'([a-z_]+)'/gm)].map((m) => m[1])
  : [];

/**
 * States that promise time will pass, and therefore need a detector.
 * States that are terminal, or that rest indefinitely by design, do not.
 */
const NEEDS_DETECTOR = {
  scheduled: 'promises the post will go out at a stated time',
  publishing: 'promises the post is going out right now',
};
const NO_DETECTOR_NEEDED = {
  draft: 'rests indefinitely by design — this is where unfinished work waits',
  published: 'terminal',
  failed: 'terminal',
  archived: 'terminal',
};

// Every status must be classified. An unclassified one is a status nobody
// decided about, which is how `scheduled` went unwatched in the first place.
for (const status of allStatuses) {
  assert(
    status in NEEDS_DETECTOR || status in NO_DETECTOR_NEEDED,
    `POST_STATUS '${status}' is not classified in check-nonterminal-state-reapers.cjs. `
    + 'Decide explicitly whether it promises that time will pass — and therefore needs a '
    + 'detector — or whether it is terminal or a resting state. An unclassified status is '
    + 'an unwatched one.',
    `POST_STATUS '${status}' is classified`,
  );
}

// ── Each state that needs a detector must actually have one, scheduled ──────

const migrationsDir = path.join(ROOT, 'supabase/migrations');
const migrations = fs.readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => ({ name: f, sql: fs.readFileSync(path.join(migrationsDir, f), 'utf8') }));

const DETECTORS = {
  scheduled: {
    fn: 'raise_overdue_scheduled_alarm',
    job: 'alarm-overdue-scheduled-posts',
  },
  publishing: {
    fn: 'reap_stuck_records',
    job: 'reap-stuck-records',
  },
};

for (const status of Object.keys(NEEDS_DETECTOR)) {
  const detector = DETECTORS[status];
  assert(
    Boolean(detector),
    `posts.status = '${status}' ${NEEDS_DETECTOR[status]}, but no detector is named for it here.`,
    `'${status}' has a named detector`,
  );
  if (!detector) continue;

  const defining = migrations.find((m) => new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${detector.fn}\\b`,
  ).test(m.sql));
  assert(
    Boolean(defining),
    `No migration defines public.${detector.fn}(), so posts stuck in '${status}' have no `
    + 'detector. A post that promises to go out and never does would be invisible.',
    `public.${detector.fn}() is defined by a migration`,
  );

  // Defined is not running. A function nobody calls is this repo's signature
  // defect — OptimalTimesService.js, 466 lines, imported nowhere.
  const scheduling = migrations.find((m) => new RegExp(
    `cron\\.schedule\\(\\s*'${detector.job}'`,
  ).test(m.sql));
  assert(
    Boolean(scheduling),
    `public.${detector.fn}() exists but no migration registers the cron job `
    + `'${detector.job}', so it never runs. A detector nobody calls is not a detector.`,
    `'${detector.job}' is registered with pg_cron`,
  );
}

// ── The overdue alarm must not quietly become an auto-fail ──────────────────
//
// This is the decision most likely to be "improved" by someone who sees an
// alarm that only logs and thinks it should act. It must not.
//
// The likeliest cause of many posts going overdue at once is that the
// DISPATCHER stopped — cron unscheduled, database paused, worker erroring. Those
// posts are fine and will send the moment it returns. Auto-failing them converts
// a recoverable outage into permanent, silent content loss across every affected
// user simultaneously. Law 3.
const alarmMigration = migrations.find((m) => /raise_overdue_scheduled_alarm/.test(m.sql));
if (alarmMigration) {
  // Strip comments first: this migration's own rationale says the words
  // "status" and "failed" repeatedly, and a guard that reads its own
  // documentation as evidence is worse than no guard. (Learned the hard way in
  // Phase 2; the CRLF normalisation is load-bearing — `.` does not match `\r`.)
  const code = alarmMigration.sql
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

  assert(
    !/UPDATE\s+public\.posts[\s\S]{0,400}?SET[\s\S]{0,200}?status\s*=\s*'failed'/i.test(code),
    `${alarmMigration.name} now auto-fails overdue scheduled posts. It must not. The likeliest `
    + 'cause of a mass overdue is a stopped dispatcher, and those posts are recoverable — '
    + 'failing them turns an outage into permanent content loss for every affected user at '
    + 'once. Alert, and let a human decide.',
    'the overdue alarm reports without auto-failing recoverable posts',
  );

  assert(
    /RAISE\s+WARNING/i.test(code),
    `${alarmMigration.name} no longer raises a warning, so an overdue backlog would be `
    + 'detected and then reported to nobody.',
    'the overdue alarm is actually observable',
  );
}

// ── Report ──────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error('\n\x1b[31m✖ check-nonterminal-state-reapers FAILED\x1b[0m\n');
  for (const f of failures) console.error(`  • ${f}\n`);
  process.exit(1);
}

console.log(
  '\x1b[32m✔ check-nonterminal-state-reapers\x1b[0m  '
  + `${passes.length} checks: all ${allStatuses.length} post statuses are classified, every state `
  + 'that promises time will pass has a detector that is both defined and scheduled, and the '
  + 'overdue alarm still reports rather than auto-failing recoverable posts.',
);
