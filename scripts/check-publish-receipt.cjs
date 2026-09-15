#!/usr/bin/env node
/**
 * check-publish-receipt.cjs — a send always ends in a receipt, and the receipt
 * never claims more than it knows.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * Before Phase 4 a publish ended in a toast and left the user on the grid. Two
 * very different outcomes looked identical there:
 *
 *   * every destination published, and
 *   * LinkedIn published while YouTube failed on media.
 *
 * createQuickPost writes ONE ROW PER PLATFORM and each is dispatched
 * independently, so a half-success is not an edge case — it is the normal shape
 * of a multi-destination send. A single green toast reports it as a clean one.
 *
 * And the live post's URL, which the adapter writes into
 * workflow_state.publish.platform_post_url, was read by nothing at all: the
 * string appeared exactly once in the entire repository, inside a comment.
 *
 * ── What this asserts ───────────────────────────────────────────────────────
 *  1. ROUTED    — every non-draft submit opens the receipt rather than
 *                 returning to the grid on a toast.
 *  2. MOUNTED   — the receipt component is actually rendered by that page. A
 *                 state variable nobody renders is this repo's signature defect.
 *  3. POLLED    — the receipt re-reads the rows. Publishing is asynchronous; a
 *                 receipt that renders once can only ever say "queued".
 *  4. HONEST    — the outcome module refuses blanket success unless every
 *                 destination published, and no surface hardcodes a success
 *                 claim of its own.
 *  5. LINKED    — the platform URL reaches the UI, and only on a confirmed row.
 *
 * READ-ONLY. Exit 0 = connected. Exit 1 = a link is broken (fails CI).
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const failures = [];
const passes = [];

function read(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    failures.push(`${rel} does not exist. The receipt contract cannot be checked.`);
    return '';
  }
  return fs.readFileSync(p, 'utf8');
}

/**
 * Strip comments before matching. A guard that reads its own rationale as
 * evidence is worse than no guard — this bit twice in Phase 2, and the CRLF
 * normalisation is load-bearing because JavaScript's `.` does not match `\r`.
 */
function stripComments(src) {
  return src
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

function assert(condition, message, okMessage) {
  if (condition) passes.push(okMessage);
  else failures.push(message);
}

const libraryPage = stripComments(read('src/pages/Library/LibraryPage.jsx'));
const receipt = stripComments(read('src/pages/Library/components/PublishReceipt.jsx'));
const outcome = stripComments(read('src/calendar/publishOutcome.js'));

// ── 1. ROUTED ───────────────────────────────────────────────────────────────

assert(
  /mode\s*!==\s*["']draft["']/.test(libraryPage) && /setReceipt\(/.test(libraryPage),
  'LibraryPage.jsx does not open a receipt for a non-draft send. The user is returned to the '
  + 'grid on a toast, where a half-succeeded send looks exactly like a clean one.',
  'every non-draft send opens a receipt',
);

// The receipt needs the ids of the rows that were actually created. Without
// them it has nothing to poll and can only ever show the click-time guess.
assert(
  /createQuickPost\(/.test(libraryPage) && /\.map\(\s*\(?row\)?\s*=>\s*row\.id\s*\)/.test(libraryPage),
  'LibraryPage.jsx does not capture the created post ids from createQuickPost. The receipt has '
  + 'nothing to follow, so it could never report a real outcome.',
  'the created post ids are captured and handed to the receipt',
);

// ── 2. MOUNTED ──────────────────────────────────────────────────────────────

assert(
  /<PublishReceipt/.test(libraryPage),
  'LibraryPage.jsx tracks receipt state but never renders <PublishReceipt>. A state variable '
  + 'nobody renders is exactly the OptimalTimesService class of defect: present, wired to '
  + 'nothing, and invisible until someone looks.',
  'the receipt component is actually rendered',
);

// ── 3. POLLED ───────────────────────────────────────────────────────────────

assert(
  /setTimeout\(/.test(receipt) && /allSettled/.test(receipt),
  'PublishReceipt.jsx does not re-read the rows until they settle. Publishing is asynchronous — '
  + 'publish-post has one caller, the cron worker — so a receipt that renders once can only ever '
  + 'say "queued", and would sit on that forever while the post published or failed behind it.',
  'the receipt polls until every destination settles',
);

// A poll with no ceiling spins forever against the database when something is
// genuinely wrong, and shows a spinner that will never resolve.
assert(
  /POLL_CEILING_MS/.test(receipt) && /setGaveUp\(true\)/.test(receipt),
  'PublishReceipt.jsx polls without a ceiling, or reaches one without saying so. A spinner that '
  + 'never resolves is its own kind of lie, and an unbounded poll hammers the database during '
  + 'exactly the outage that caused it.',
  'the poll is bounded and says so when it gives up',
);

// ── 4. HONEST ───────────────────────────────────────────────────────────────

// The one rule the 2026-09-11 defect broke.
assert(
  /published\s*===\s*total/.test(outcome),
  'publishOutcome.js no longer requires EVERY destination to have published before reporting '
  + 'success. `failed === 0` is not the same test — a draft is terminal and is not a failure, and '
  + 'that gap once reported three drafts as "Published to 0 accounts".',
  'blanket success requires every destination to have published',
);

// No surface may mint its own success claim; summarise() owns that wording.
// Matched as a BARE WORD, not only as a quoted string. The first version of
// this check looked for a quoted "Published" and was defeated by replacing
// {summary.title} with the raw JSX text Published! — which is exactly how a
// hardcoded claim would really be written. The word must not appear in this
// component at all; every claim comes from summarise(), and the outcome
// constants are referenced as OUTCOME.PUBLISHED rather than as the word.
assert(
  !/Published/.test(receipt),
  'PublishReceipt.jsx hardcodes a "Published" string instead of taking its wording from '
  + 'summarise(). Every claim on this screen must come from the rows, not from the component.',
  'the receipt takes every claim from the outcome module',
);

assert(
  // Bound to the RENDERED summary, not merely to the word appearing somewhere.
  // The loose form matched the import line and the poll's own call, so a
  // component that computed its headline by hand still passed.
  /const\s+summary\s*=\s*summarise\(/.test(receipt),
  'PublishReceipt.jsx does not bind its rendered summary to summarise(), so its headline is not '
  + 'governed by the rules publish-outcome.test.mjs enforces.',
  'the receipt headline is governed by the tested summariser',
);

// The live platform restrictions must survive to the screen. "Published" alone
// hides a YouTube upload forced private and a TikTok post visible only to its
// author — which is how someone believes they posted publicly and did not.
assert(
  /restriction/.test(receipt) && /export function restrictionFor\(/.test(outcome),
  'The receipt drops the platform restriction. A YouTube upload locked to private and a TikTok '
  + 'post at SELF_ONLY both read as an unqualified success without it.',
  'live platform restrictions are stated on the receipt',
);

// ── 5. LINKED ───────────────────────────────────────────────────────────────

assert(
  /platform_post_url/.test(outcome),
  'Nothing reads workflow_state.publish.platform_post_url. The adapter records the live post URL '
  + 'and the UI throws it away at the boundary — which was true of the entire repository before '
  + 'Phase 4.',
  'the live post URL is read back out of workflow_state',
);

// …but only for a row that actually published. Offering a link on a queued row
// would be asserting an outcome that has not happened.
assert(
  /url: null/.test(outcome),
  'publishOutcome.js no longer forces the URL to null on unsettled rows. A queued destination '
  + 'would offer a "View post" link to something that does not exist yet.',
  'an unpublished row exposes no URL',
);

// ── Report ──────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error('\n\x1b[31m✖ check-publish-receipt FAILED\x1b[0m\n');
  for (const f of failures) console.error(`  • ${f}\n`);
  process.exit(1);
}

console.log(
  '\x1b[32m✔ check-publish-receipt\x1b[0m  '
  + `${passes.length} links verified: every non-draft send opens a receipt, the receipt is `
  + 'rendered and polls until each destination settles, its wording comes from the tested '
  + 'summariser, live platform restrictions are stated, and the post URL reaches the UI only '
  + 'once that platform has confirmed.',
);
