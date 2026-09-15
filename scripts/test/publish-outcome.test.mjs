#!/usr/bin/env node
/**
 * publish-outcome.test.mjs — the receipt may never claim more than it knows.
 *
 * Exercises the REAL module (src/calendar/publishOutcome.js), not a copy.
 *
 * ── The defect this protects against ────────────────────────────────────────
 * On 2026-09-11 a post reported success and died fourteen seconds later with
 * "YouTube requires a video. This post has no media attached." The receipt in
 * the library-v3 mockup originally said "Published to N of your accounts" with
 * a green tick AT CLICK TIME — a claim the product cannot make, because
 * publish-post has exactly one caller: the cron worker, registered '* * * * *'.
 *
 * The two claims this suite refuses:
 *   1. "Published" before the row's status has actually moved.
 *   2. "Published" when only SOME destinations succeeded. A multi-destination
 *      send half-succeeds for real, and the direction that hides a failure is
 *      the one that costs someone a post.
 *
 *   Usage:  node scripts/test/publish-outcome.test.mjs
 *   Exit 0 = pass, 1 = fail (fails CI).
 */
import {
  OUTCOME,
  deriveOutcome,
  restrictionFor,
  summarise,
} from '../../src/calendar/publishOutcome.js';

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

const post = (over = {}) => ({
  id: 'p1', platform: 'linkedin', status: 'scheduled',
  error_message: null, workflow_state: {}, ...over,
});

// ── 1. PER-ROW STATES ───────────────────────────────────────────────────────

check('a scheduled row is QUEUED', deriveOutcome(post()).state, OUTCOME.QUEUED);
check('a queued row is not terminal', deriveOutcome(post()).isTerminal, false);
check('publishing is SENDING', deriveOutcome(post({ status: 'publishing' })).state, OUTCOME.SENDING);
check('published is PUBLISHED', deriveOutcome(post({ status: 'published' })).state, OUTCOME.PUBLISHED);
check('failed is FAILED', deriveOutcome(post({ status: 'failed' })).state, OUTCOME.FAILED);
check('a draft is DRAFT, never queued', deriveOutcome(post({ status: 'draft' })).state, OUTCOME.DRAFT);

// A retriable failure writes status back to 'scheduled' with a retry count.
// Indistinguishable from "waiting its turn" to the schema; very different to a
// person, because something already went wrong.
{
  const retrying = deriveOutcome(post({
    status: 'scheduled',
    error_message: 'Upload timed out.',
    workflow_state: { publish: { retry_count: 2 } },
  }));
  check('a retried row is RETRYING, not queued', retrying.state, OUTCOME.RETRYING);
  ok('retrying names the attempt', /2 of 3/.test(retrying.label), retrying.label);
  ok("retrying keeps the adapter's reason", /timed out/i.test(retrying.detail), retrying.detail);
  check('retrying is not terminal', retrying.isTerminal, false);
}

// The adapter's own words survive to the user. A generic message would throw
// away the only thing that says what to fix.
{
  const failed = deriveOutcome(post({
    status: 'failed',
    error_message: 'YouTube requires a video. This post has no media attached.',
  }));
  ok('a failure shows the real reason', /no media attached/.test(failed.detail), failed.detail);
}
{
  const silent = deriveOutcome(post({ status: 'failed', error_message: null }));
  ok(
    'a failure with no reason says so rather than inventing one',
    /no reason was recorded/i.test(silent.detail),
    silent.detail,
  );
}

// A published row must not imply a link it does not have.
{
  const withUrl = deriveOutcome(post({
    status: 'published',
    workflow_state: { publish: { platform_post_url: 'https://example.com/p/1' } },
  }));
  check('a published row exposes its URL', withUrl.url, 'https://example.com/p/1');

  const noUrl = deriveOutcome(post({ status: 'published' }));
  check('a published row with no URL exposes null, not a broken link', noUrl.url, null);
  ok('and says the link is missing', /no direct link/i.test(noUrl.detail), noUrl.detail);
}

// A queued row must never carry a URL, whatever is on the record.
{
  const queuedWithStaleUrl = deriveOutcome(post({
    status: 'scheduled',
    workflow_state: { publish: { platform_post_url: 'https://example.com/stale' } },
  }));
  check('a queued row never exposes a URL', queuedWithStaleUrl.url, null);
}

// ── 2. LIVE PLATFORM RESTRICTIONS ───────────────────────────────────────────
//
// Both are true right now and neither is our bug. A bare "Published" hides
// them, which is how someone believes they posted publicly and did not.

{
  const yt = post({ platform: 'youtube', status: 'published', workflow_state: { youtube: { privacy_status: 'private' } } });
  ok('a forced-private YouTube upload says so', /only you can see it/i.test(restrictionFor(yt)), restrictionFor(yt));

  const ytPublic = post({ platform: 'youtube', status: 'published', workflow_state: { youtube: { privacy_status: 'public' } } });
  check('a public YouTube upload carries no caveat', restrictionFor(ytPublic), '');

  const tt = post({ platform: 'tiktok', status: 'published', workflow_state: { tiktok: { privacyLevel: 'SELF_ONLY' } } });
  ok('a SELF_ONLY TikTok post says so', /visible only to you/i.test(restrictionFor(tt)), restrictionFor(tt));

  const ttPublic = post({ platform: 'tiktok', status: 'published', workflow_state: { tiktok: { privacyLevel: 'PUBLIC_TO_EVERYONE' } } });
  check('a public TikTok post carries no caveat', restrictionFor(ttPublic), '');

  // The caveat must be derived, so it disappears on its own when the audit
  // passes. A hardcoded string would outlive the restriction.
  check('an unrestricted platform carries no caveat', restrictionFor(post({ platform: 'linkedin' })), '');
}

// ── 3. THE HEADLINE — where the lie would live ──────────────────────────────

// Nothing settled: the click-time truth, and the ONLY thing claimable then.
{
  const s = summarise([post(), post({ id: 'p2', platform: 'youtube' })]);
  check('all queued reads as pending', s.tone, 'pending');
  ok('the pending headline does not claim publication', !/published/i.test(s.title), s.title);
  ok('going out now names the count', /2 accounts/.test(s.title), s.title);
  ok('it states the real mechanism', /every minute/i.test(s.detail), s.detail);
  check('pending is not settled', s.allSettled, false);
}

// One still moving: must NOT report success yet, even though one succeeded.
{
  const s = summarise([
    post({ status: 'published' }),
    post({ id: 'p2', platform: 'youtube', status: 'scheduled' }),
  ]);
  check('a partially-settled send stays pending', s.tone, 'pending');
  ok(
    'it does not claim success while a destination is still moving',
    !/^Published/.test(s.title),
    s.title,
  );
}

// THE CASE THE SCREEN EXISTS FOR: a genuine half-success.
{
  const s = summarise([
    post({ status: 'published' }),
    post({ id: 'p2', platform: 'youtube', status: 'failed', error_message: 'No media.' }),
  ]);
  check('a half-success is reported as partial', s.tone, 'warning');
  ok('the headline states BOTH numbers', /1 of 2/.test(s.title), s.title);
  ok('it never reads as blanket success', !/^Published to 2/.test(s.title), s.title);
  ok('it says the failures can be retried alone', /without touching/i.test(s.detail), s.detail);
}

// Everything failed.
{
  const s = summarise([
    post({ status: 'failed', error_message: 'a' }),
    post({ id: 'p2', status: 'failed', error_message: 'b' }),
  ]);
  check('a total failure is danger', s.tone, 'danger');
  ok('and does not use the word published', !/published/i.test(s.title), s.title);
}

// Everything succeeded — the one case where success is honest.
{
  const s = summarise([post({ status: 'published' }), post({ id: 'p2', status: 'published' })]);
  check('an all-success is success', s.tone, 'success');
  ok('and says so plainly', /Published to 2 accounts/.test(s.title), s.title);
  check('all-success is settled', s.allSettled, true);
}

// ── 4. THE INVARIANT, GENERATED ─────────────────────────────────────────────
//
// Across every combination of destination states, a blanket-success headline is
// permitted ONLY when every destination actually published. This is the rule the
// 2026-09-11 defect broke, stated once and checked exhaustively rather than
// trusted to the cases someone thought to write.
{
  const STATES = ['scheduled', 'publishing', 'published', 'failed', 'draft'];
  let generated = 0;
  for (const a of STATES) {
    for (const b of STATES) {
      for (const c of STATES) {
        const s = summarise([
          post({ id: 'a', status: a }),
          post({ id: 'b', status: b }),
          post({ id: 'c', status: c }),
        ]);
        const allPublished = [a, b, c].every((x) => x === 'published');
        generated += 1;
        if ((s.tone === 'success') !== allPublished) {
          failures += 1;
          console.error(
            `  FAIL  blanket success only when all published — [${a}, ${b}, ${c}]`
            + `\n          tone: ${s.tone}, title: ${s.title}`,
          );
        }
      }
    }
  }
  checks += generated;
  console.log(`  (${generated} generated destination combinations checked)`);
}

// ── Report ──────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n\x1b[31m✖ publish-outcome  ${failures} of ${checks} checks failed\x1b[0m\n`);
  process.exit(1);
}
console.log(
  `\x1b[32m✔ publish-outcome\x1b[0m  ${checks} checks passed — the receipt reports queued until the `
  + "row moves, never calls a half-success a success, keeps the adapter's own failure reason, and "
  + 'states the live platform restrictions a bare "Published" would hide.',
);
