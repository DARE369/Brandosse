#!/usr/bin/env node
/**
 * copy-review.test.mjs — the copy review report, frozen at publish.
 *
 * Imports the REAL client module (src/calendar/copyReview.js) AND the REAL
 * server module (supabase/functions/_shared/copyReview.ts, loaded through
 * Node's type stripping) — not copies of either.
 *
 * ── What must hold ──────────────────────────────────────────────────────────
 *  1. The client and server fingerprint the same text identically. If they
 *     drift, every composer review looks stale to the worker, which then pays
 *     to re-score every published post while reporting nothing wrong.
 *  2. A review is attached to a post ONLY if it describes that post's exact
 *     text. Otherwise it is a reading of words the post does not carry.
 *  3. A frozen report is never replaced — "at the point of publishing, these
 *     were the scores" is only true if nothing edits it afterwards.
 *  4. A metric the reviewer did not return is NOT MEASURED, never 0.
 *
 *   Usage:  node scripts/test/copy-review.test.mjs
 *   Exit 0 = pass, 1 = fail (fails CI).
 */
import * as client from '../../src/calendar/copyReview.js';
import * as server from '../../supabase/functions/_shared/copyReview.ts';

let failures = 0;
let checks = 0;
function check(label, actual, expected) {
  checks += 1;
  if (actual !== expected) {
    failures += 1;
    console.error(`  FAIL  ${label}\n          expected: ${expected}\n          actual:   ${actual}`);
  }
}
function ok(label, condition, detail = '') {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`);
  }
}

// ── 1. CLIENT AND SERVER AGREE, BYTE FOR BYTE ──────────────────────────────

const CORPUS = [
  { platform: 'linkedin', caption: 'Hello world', title: 'Launch', hashtags: [] },
  { platform: 'YouTube ', caption: '  padded  ', title: '', hashtags: ['#b', '#a', '#a', ' '] },
  { platform: 'tiktok', caption: 'line one\r\nline two\rline three', title: null, hashtags: null },
  { platform: 'instagram', caption: '🎉 emoji — and “quotes”', title: 'Ünïcödé', hashtags: ['#café'] },
  { platform: '', caption: '', title: '', hashtags: [] },
  {},
];

for (const [i, inputs] of CORPUS.entries()) {
  check(`canonical form matches client/server [${i}]`, client.canonicalCopyInputs(inputs), server.canonicalCopyInputs(inputs));
  // eslint-disable-next-line no-await-in-loop
  const [a, b] = await Promise.all([client.fingerprintCopyInputs(inputs), server.fingerprintCopyInputs(inputs)]);
  check(`fingerprint matches client/server [${i}]`, a, b);
  ok(`fingerprint is 64 hex chars [${i}]`, /^[0-9a-f]{64}$/.test(a), a);
}
check('both sides are on the same version', client.COPY_REVIEW_VERSION, server.COPY_REVIEW_VERSION);

// Normalisations that cannot change what a reader sees must not change the print…
{
  const base = { platform: 'linkedin', caption: 'Hi there', title: 'T', hashtags: ['#a', '#b'] };
  const same = await client.fingerprintCopyInputs(base);
  check('CRLF vs LF is the same text', await client.fingerprintCopyInputs({ ...base, caption: 'Hi there\r\n' }), same);
  check('hashtag order is not a change', await client.fingerprintCopyInputs({ ...base, hashtags: ['#b', '#a'] }), same);
  check('platform case is not a change', await client.fingerprintCopyInputs({ ...base, platform: 'LinkedIn' }), same);
  // …and anything a reader WOULD see must.
  ok('a changed word is a change', await client.fingerprintCopyInputs({ ...base, caption: 'Hi therE' }) !== same);
  ok('a changed title is a change', await client.fingerprintCopyInputs({ ...base, title: 'U' }) !== same);
  ok('a different platform is a change', await client.fingerprintCopyInputs({ ...base, platform: 'x' }) !== same);
  ok('an added hashtag is a change', await client.fingerprintCopyInputs({ ...base, hashtags: ['#a', '#b', '#c'] }) !== same);
}

// ── 2. A REVIEW IS ATTACHED ONLY TO THE TEXT IT READ ───────────────────────

const scored = {
  state: 'scored', score: 72, category: 'Good',
  breakdown: { hookStrength: 64, readability: 80 }, measured: ['hookStrength', 'readability'],
  suggestions: ['Lead with the outcome'], benchmarkReport: [], provider: 'p', model: 'm',
};
const row = { platform: 'linkedin', caption: 'Caption', title: 'Asset name', hashtags: [] };

{
  const snap = await client.buildSnapshot({ scored, scoredInputs: row, rowInputs: row });
  ok('a matching review becomes a snapshot', snap !== null);
  check('the snapshot fingerprint is the ROW fingerprint', snap.fingerprint, await client.fingerprintCopyInputs(row));
  check('the headline score is kept', snap.result.overall, 72);
  check('measured coverage is kept', snap.result.measured.length, 2);
}
{
  const edited = await client.buildSnapshot({ scored, scoredInputs: row, rowInputs: { ...row, caption: 'Caption, edited' } });
  check('a review of text since edited is dropped, not attached', edited, null);
}
{
  // The composer scores with the effective title (user title or asset name).
  // If it had scored with an empty title while the row carries the asset name,
  // the snapshot must be refused — they are different text.
  const titleless = await client.buildSnapshot({ scored, scoredInputs: { ...row, title: '' }, rowInputs: row });
  check('a review taken without the title the row carries is dropped', titleless, null);
}
for (const bad of [
  { ...scored, state: 'unavailable' },
  { ...scored, score: null },
  { ...scored, score: undefined },
  { ...scored, score: 'n/a' },
]) {
  // eslint-disable-next-line no-await-in-loop
  check(`no snapshot from a review with score=${String(bad.score)} state=${bad.state}`, await client.buildSnapshot({ scored: bad, scoredInputs: row, rowInputs: row }), null);
}

// ── 3. THE WORKER NEVER REPLACES A FROZEN REPORT ───────────────────────────

const fp = await server.fingerprintCopyInputs(row);
const published = (block) => ({ status: 'published', workflow_state: { copy_review: block } });

check('an unpublished post is skipped', server.decideFinalisation({ status: 'scheduled', workflow_state: {} }, fp).action, 'skip');
check('a frozen report is never touched', server.decideFinalisation(published({ final: { state: 'scored' } }), fp).action, 'skip');
check('a frozen UNAVAILABLE report is never touched either', server.decideFinalisation(published({ final: { state: 'unavailable' } }), fp).action, 'skip');

{
  const snap = await client.buildSnapshot({ scored, scoredInputs: row, rowInputs: row });
  check('a fresh composer review is promoted without a second paid call', server.decideFinalisation(published({ snapshot: snap }), fp).action, 'promote');

  const otherFp = await server.fingerprintCopyInputs({ ...row, caption: 'edited in the Calendar after review' });
  check('a review of text edited before publish is re-scored, not promoted', server.decideFinalisation(published({ snapshot: snap }), otherFp).action, 'score');

  const noScore = { ...snap, result: { ...snap.result, overall: null } };
  check('a snapshot with no score is never promoted', server.decideFinalisation(published({ snapshot: noScore }), fp).action, 'score');
}
{
  const d = server.decideFinalisation(published({}), fp);
  check('never reviewed: scored at publish', d.action, 'score');
  check('…as attempt 1', d.attempt, 1);
  const d2 = server.decideFinalisation(published({ final_attempts: 2 }), fp);
  check('attempts count up', d2.attempt, 3);
  check('after the ceiling it gives up rather than paying forever',
    server.decideFinalisation(published({ final_attempts: server.MAX_FINAL_ATTEMPTS }), fp).action, 'give_up');
}

// The server refuses to freeze a result with no measured metrics — a permanent
// "0" for text the model said nothing about.
check('no measured metrics is not a storable result',
  server.storedResultFromPayload({ overall: 0, category: 'Poor', breakdown: {}, measured: [], suggestions: [], benchmarkReport: [], provider: null, model: null }), null);
ok('a measured result is storable',
  server.storedResultFromPayload({ overall: 70, category: 'Good', breakdown: { hookStrength: 70 }, measured: ['hookStrength'], suggestions: [], benchmarkReport: [], provider: null, model: null }) !== null);

// ── 4. NOT MEASURED IS NEVER ZERO ──────────────────────────────────────────

{
  const rows = client.measuredMetrics({ breakdown: { hookStrength: 64, readability: 0, platformFit: 0 }, measured: ['hookStrength', 'readability'] });
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  check('a measured metric shows its value', byKey.hookStrength.value, 64);
  check('a measured ZERO is still a real zero', byKey.readability.value, 0);
  check('…and counts as measured', byKey.readability.measured, true);
  check('an unreturned metric at 0 is NOT MEASURED', byKey.platformFit.measured, false);
  check('…with no value at all', byKey.platformFit.value, null);
  check('every metric the reviewer returns is listed', rows.length, client.COPY_REVIEW_METRICS.length);
  ok('hook strength leads the list', rows[0].key === 'hookStrength', rows[0].key);
}
{
  const legacy = client.measuredMetrics({ breakdown: { hookStrength: 0 }, measured: null });
  check('a score from before coverage was recorded is flagged', legacy[0].coverageKnown, false);
}

// ── 5. REPORT STATE ─────────────────────────────────────────────────────────

check('the UI and the worker agree on the lookback window', client.FINALIZE_LOOKBACK_DAYS, server.LOOKBACK_DAYS);

{
  const NOW = Date.parse('2026-09-16T12:00:00Z');
  const minsAgo = (m) => new Date(NOW - m * 60_000).toISOString();
  const pub = (at, block = {}) => ({ status: 'published', published_at: at, workflow_state: { copy_review: block } });

  check('a draft has no report at publish', client.finalReportState({ status: 'draft' }, NOW), 'not_applicable');
  check('just published, nothing frozen: pending', client.finalReportState(pub(minsAgo(2)), NOW), 'pending');
  check('published long past the expected window: overdue, not "being taken"',
    client.finalReportState(pub(minsAgo(client.REPORT_EXPECTED_WITHIN_MINUTES + 5)), NOW), 'overdue');

  // The defect caught in a real browser: a post published five days before
  // this feature existed rendered "Being taken now" — and would have forever
  // once it aged past the worker's window.
  check('published before the worker window: not recorded, never pending',
    client.finalReportState(pub(minsAgo((client.FINALIZE_LOOKBACK_DAYS * 24 * 60) + 60)), NOW), 'not_recorded');
  check('a published row with no publish time promises nothing',
    client.finalReportState({ status: 'published', workflow_state: {} }, NOW), 'not_recorded');

  check('a frozen scored report is frozen, whatever its age',
    client.finalReportState(pub(minsAgo(99_999), { final: { state: 'scored', result: { overall: 1 } } }), NOW), 'frozen');
  check('a frozen failure is unavailable, not pending forever',
    client.finalReportState(pub(minsAgo(3), { final: { state: 'unavailable' } }), NOW), 'unavailable');
}

if (failures > 0) {
  console.error(`\n\x1b[31m✖ copy-review  ${failures} of ${checks} checks failed\x1b[0m\n`);
  process.exit(1);
}
console.log(
  `\x1b[32m✔ copy-review\x1b[0m  ${checks} checks passed — client and server fingerprint text identically, a `
  + 'review is kept only for the exact text it read, a frozen report is never replaced, and an unreturned '
  + 'metric is shown as not measured rather than 0.',
);
