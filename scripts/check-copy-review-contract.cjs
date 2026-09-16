#!/usr/bin/env node
/**
 * check-copy-review-contract.cjs — the copy review is reviewed on request,
 * frozen once at publish, never rewritten, and never labelled as a prediction.
 *
 * ── Why each link is here ───────────────────────────────────────────────────
 * The report is only worth anything if "at the point of publishing, these were
 * the scores" is literally true. That breaks quietly in several independent
 * places, none of which a build or a unit test would notice:
 *
 *   * something other than the worker writes `final`, so it can change later;
 *   * the worker's write stops being conditional, so an overlapping run or a
 *     retry overwrites a report the user already saw;
 *   * the worker exists but nothing schedules it — the stale-guard failure;
 *   * the composer drifts back to scoring on a timer, spending a paid,
 *     rate-limited call on every pause in someone's typing;
 *   * the stale signal is carried by motion alone, invisible with reduced motion;
 *   * an unreturned metric is drawn as a 0 bar and frozen that way forever;
 *   * the score is relabelled "discovery" — LOCK L5.11.
 *
 * READ-ONLY. Exit 0 = the contract holds. Exit 1 = a link is broken (fails CI).
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const failures = [];
const passes = [];

function read(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    failures.push(`${rel} does not exist. The copy review contract cannot be checked.`);
    return '';
  }
  return fs.readFileSync(p, 'utf8');
}

/** Strip comments — a guard that reads its own rationale as evidence is worse
 *  than no guard. CRLF first, because `.` does not match `\r`. */
function stripComments(src) {
  return src
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

function assert(condition, message, okMessage) {
  if (condition) passes.push(okMessage);
  else failures.push(message);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const WORKER = 'supabase/functions/finalize-copy-reviews/index.ts';
const worker = stripComments(read(WORKER));
const composer = stripComments(read('src/calendar/components/QuickPostComposer.jsx'));
const service = stripComments(read('src/calendar/services/calendarService.js'));
const report = stripComments(read('src/calendar/components/CopyReviewReport.jsx'));
const receipt = stripComments(read('src/pages/Library/components/PublishReceipt.jsx'));
const drawer = stripComments(read('src/calendar/components/PostDetailDrawer.jsx'));
const css = read('src/calendar/calendar-engine-v2.css');
const seo = stripComments(read('supabase/functions/_shared/seo.ts'));
const seoScoreFn = stripComments(read('supabase/functions/seo-score/index.ts'));

// ── 1. ONLY THE WORKER FREEZES A REPORT ─────────────────────────────────────

{
  const writers = walk(path.join(ROOT, 'src'))
    .map((f) => ({ f, src: stripComments(fs.readFileSync(f, 'utf8')) }))
    .filter(({ src }) => /copy_review\s*:\s*\{[^}]*\bfinal\b/.test(src) || /final_attempts\s*:/.test(src));
  assert(
    writers.length === 0,
    `Client code writes the frozen copy review: ${writers.map(({ f }) => path.relative(ROOT, f)).join(', ')}. `
    + 'Only finalize-copy-reviews may write `final`. A report the client can write is a report that '
    + 'can change after publish, which makes "these were the scores at publish" untrue.',
    'no client code writes copy_review.final',
  );
}

assert(
  /copy_review:\s*\{\s*snapshot:/.test(service) && !/copy_review:\s*\{[^}]*final/.test(service),
  'calendarService.js no longer writes the copy review as a SNAPSHOT only. The composer may attach an '
  + 'advisory snapshot; it must never write the frozen record.',
  'the composer path writes a snapshot, never a final report',
);

assert(
  /await\s+buildSnapshot\(/.test(service),
  'calendarService.js attaches a copy review without buildSnapshot(), so nothing checks the review '
  + 'describes the text the row carries — a score of different words would be frozen at publish.',
  'snapshots pass through the exact-text check',
);

// ── 2. THE WORKER'S WRITE IS CONDITIONAL ON NOTHING BEING FROZEN ─────────────

{
  const update = /\.update\(\s*\{\s*workflow_state[\s\S]*?\.select\(/.exec(worker);
  assert(
    Boolean(update) && /\.is\(\s*["']workflow_state->copy_review->final["']\s*,\s*null\s*\)/.test(update[0]),
    'finalize-copy-reviews writes without requiring `final` to still be absent. An overlapping run, or a '
    + 'retry, would overwrite a report the user has already been shown.',
    "the worker's write is conditional on no frozen report",
  );
}

assert(
  /decideFinalisation\(/.test(worker) && /fingerprintCopyInputs\(/.test(worker),
  'finalize-copy-reviews no longer decides through decideFinalisation(fingerprint). The branches '
  + 'copy-review.test.mjs proves — never replace, promote only matching text, give up after the '
  + 'ceiling — would not be the ones that run.',
  'the worker runs the tested decision logic',
);

assert(
  /requireInvokeSecret\(/.test(worker),
  'finalize-copy-reviews does not require the invoke secret. It writes to every user\'s posts with the '
  + 'service role and spends paid model calls; an unauthenticated caller must not be able to trigger it.',
  'the worker requires the invoke secret',
);

assert(
  /SCORE_BUDGET_PER_RUN/.test(worker) && /START_DEADLINE_MS/.test(worker),
  'finalize-copy-reviews has no per-run scoring budget or deadline. A score can take two minutes and '
  + 'the function is killed near 150s; unbounded, a backlog kills every run mid-write and nothing freezes.',
  'the worker bounds paid scoring per run',
);

// ── 3. THE WORKER IS ACTUALLY SCHEDULED ─────────────────────────────────────

{
  const migDir = path.join(ROOT, 'supabase', 'migrations');
  const mig = fs.readdirSync(migDir)
    .map((f) => fs.readFileSync(path.join(migDir, f), 'utf8'))
    .find((sql) => /cron\.schedule\(\s*'finalize-copy-reviews'/.test(sql));
  assert(
    Boolean(mig) && /\/functions\/v1\/finalize-copy-reviews/.test(mig) && /X-Invoke-Secret/.test(mig),
    'No migration schedules finalize-copy-reviews against its own function with the invoke secret. A '
    + 'worker nothing runs is the stale-guard failure: installed, correct, and never executed.',
    'a migration schedules the worker with the header that authorises it',
  );
}

// ── 4. REVIEWED ON REQUEST, AND THE STALE SIGNAL IS NOT MOTION ALONE ─────────

assert(
  !/setTimeout\([\s\S]{0,400}scoreDestinations/.test(composer),
  'QuickPostComposer.jsx scores on a timer again. The review is a paid, rate-limited model call; '
  + 'scoring every pause in typing spends money nobody asked to spend and exhausts the limit mid-draft.',
  'the composer does not score on a timer',
);

assert(
  /onClick=\{\(\)\s*=>\s*reviewCopy\(/.test(composer),
  'QuickPostComposer.jsx has no user-initiated review. Scoring is on request only.',
  'the copy review is started by the user',
);

assert(
  /is-stale/.test(composer) && /\.quickpost-copy-review__btn\.is-stale/.test(css),
  'The review button no longer marks a stale review. Once the text changes, the score on screen '
  + 'describes words that are no longer there, and the button must say so.',
  'the review button marks a stale review',
);

assert(
  /prefers-reduced-motion:\s*reduce[\s\S]*?quickpost-copy-review__btn\.is-stale[\s\S]*?animation:\s*none/.test(css),
  'The stale pulse has no reduced-motion fallback. Users who ask for less motion get an animation '
  + 'they asked not to see.',
  'the pulse respects prefers-reduced-motion',
);

assert(
  /aria-live="polite"/.test(composer) && /Changed since the last review/.test(composer),
  'The stale state is carried by motion alone. It must also be said in words, announced politely, so a '
  + 'screen-reader or reduced-motion user learns the review is out of date.',
  'the stale state is also stated in words',
);

// ── 5. NOT MEASURED IS NEVER DRAWN AS ZERO ──────────────────────────────────

assert(
  /measuredMetrics\(/.test(report) && /m\.measured\s*\?/.test(report) && /Not measured/.test(report),
  'CopyReviewReport no longer distinguishes an unreturned metric. It would draw a 0 bar for a reading '
  + 'nobody took — and this report is frozen, so the fabricated 0 would be permanent.',
  'the report shows unreturned metrics as not measured',
);

assert(
  /value === null \|\| value === undefined \|\| value === ""/.test(seo),
  '_shared/seo.ts parseScore checks only NaN again. Number(null) is 0, so an unreturned metric becomes a '
  + 'real-looking 0 and is weighted into the overall.',
  'the scorer treats an absent metric as absent, not 0',
);

assert(
  /measuredWeight/.test(seo) && /measured,/.test(seo) && /measured:\s*normalized\.measured/.test(seoScoreFn),
  'The overall is no longer averaged over MEASURED metrics only, or seo-score stopped returning which '
  + 'metrics were measured. An answer that skipped hook strength would lose up to 12 points for '
  + 'something never assessed.',
  'the overall weights only measured metrics, and says which they were',
);

// ── 6. SHOWN WHERE THE USER LOOKS ───────────────────────────────────────────

assert(
  /<CopyReviewReport/.test(receipt) && /OUTCOME\.PUBLISHED/.test(receipt),
  'The publish receipt does not show the copy review once a destination publishes.',
  'the receipt shows the report on success',
);

assert(
  /isPublished\s*&&[\s\S]{0,200}<CopyReviewReport/.test(drawer),
  "The post details panel does not show the frozen report for a published post — the place it is meant "
  + 'to live permanently.',
  'the details panel shows the frozen report',
);

// ── 7. LOCK L5.11 — NEVER A REACH PREDICTION ────────────────────────────────

for (const [name, src] of [['QuickPostComposer.jsx', composer], ['CopyReviewReport.jsx', report], ['PublishReceipt.jsx', receipt]]) {
  const userFacing = [...src.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]).join(' ')
    + ' ' + [...src.matchAll(/['"`]([^'"`]{6,})['"`]/g)].map((m) => m[1]).join(' ');
  assert(
    !/discoverab|discovery score/i.test(userFacing),
    `${name} labels the score as discovery/discoverability. LOCK L5.11: it reads only the post's own text, `
    + 'has no external signal and cannot learn, so it must not be presented as a prediction of reach. '
    + 'Call it "Copy review".',
    `${name} does not present the score as a reach prediction`,
  );
}

// ── Report ──────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error('\n\x1b[31m✖ check-copy-review-contract FAILED\x1b[0m\n');
  for (const f of failures) console.error(`  • ${f}\n`);
  process.exit(1);
}

console.log(
  '\x1b[32m✔ check-copy-review-contract\x1b[0m  '
  + `${passes.length} links verified: reviewed on request with a stale signal in motion AND words, `
  + 'snapshotted only for the exact text, frozen once by a scheduled and authenticated worker whose '
  + 'write cannot overwrite a report, unreturned metrics shown as not measured, shown on the receipt '
  + 'and the details panel, and never labelled a reach prediction.',
);
