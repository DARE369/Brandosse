#!/usr/bin/env node
/**
 * discovery-and-preview.test.mjs — Phases 5 and 6.
 *
 * Exercises the REAL modules (src/calendar/discoveryScore.js and
 * src/calendar/platformPreview.js), not copies.
 *
 * ── Phase 5: the score is advisory, and must stay that way ──────────────────
 * The scorer throws — on a rate limit, on a provider outage. The failure mode
 * to prevent is not a wrong number; it is a composer that cannot send because
 * an OPTIONAL number failed to arrive. That would block hardest exactly when
 * the scoring provider is down, i.e. when the user least deserves it.
 *
 * ── Phase 6: the fold is the only thing the preview must get right ──────────
 * Platform chrome changes constantly and a pixel-copy rots. Being wrong about
 * the fold is the expensive kind of wrong: a hook buried below it is a post
 * nobody reads. So the maths is tested and the visuals are not.
 *
 *   Usage:  node scripts/test/discovery-and-preview.test.mjs
 *   Exit 0 = pass, 1 = fail (fails CI).
 */
import {
  SCORE_STATE,
  bandFor,
  blocksPublishing,
  scoreDestination,
  scoreDestinations,
} from '../../src/calendar/discoveryScore.js';
import {
  PLATFORM_FOLD,
  foldCapacity,
  foldFor,
  previewFor,
  splitAtFold,
} from '../../src/calendar/platformPreview.js';
import { getPlatformSpec } from '../../src/services/platforms/platformCaptionSpecs.js';

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

// ── PHASE 5 — ADVISORY BY CONSTRUCTION ──────────────────────────────────────

// The single most important property: publishing is never gated on a score.
check('scoring never blocks publishing', blocksPublishing(), false);

{
  // A scorer that throws — a rate limit, a dead provider, the common case.
  const throwing = async () => { throw new Error('Rate limit exceeded.'); };
  const res = await scoreDestination(throwing, { platform: 'linkedin', caption: 'hello' });
  check('a throwing scorer degrades to UNAVAILABLE', res.state, SCORE_STATE.UNAVAILABLE);
  check('…and reports no score rather than zero', res.score, null);
  ok('…and carries the reason', /rate limit/i.test(res.reason), res.reason);
}

{
  // The subtle one: a response with no number must NOT render as 0. Zero says
  // "your caption is terrible"; null says "nothing was measured".
  const numberless = async () => ({ seoCategory: 'ok' });
  const res = await scoreDestination(numberless, { platform: 'linkedin', caption: 'hello' });
  check('a numberless response is UNAVAILABLE, not 0', res.state, SCORE_STATE.UNAVAILABLE);
  check('…and score stays null', res.score, null);
}
{
  const nanScore = async () => ({ seoScore: 'not-a-number' });
  const res = await scoreDestination(nanScore, { platform: 'x', caption: 'hi' });
  check('a non-numeric score is UNAVAILABLE', res.state, SCORE_STATE.UNAVAILABLE);
}

{
  const good = async () => ({ seoScore: 84, seoCategory: 'strong', seoSuggestions: ['add a hook', ''] });
  const res = await scoreDestination(good, { platform: 'linkedin', caption: 'hello' });
  check('a good response scores', res.state, SCORE_STATE.SCORED);
  check('…with the number', res.score, 84);
  check('…and drops empty suggestions', res.suggestions.length, 1);
}

{
  // An empty caption is IDLE, not a failure — otherwise the composer shows a
  // scary "unavailable" during ordinary typing.
  const never = async () => { throw new Error('should not be called'); };
  const res = await scoreDestination(never, { platform: 'linkedin', caption: '   ' });
  check('an empty caption is IDLE', res.state, SCORE_STATE.IDLE);
}

{
  // One destination failing must not remove another's score.
  const flaky = async ({ platform }) => {
    if (platform === 'youtube') throw new Error('provider down');
    return { seoScore: 70 };
  };
  const out = await scoreDestinations(flaky, [
    { platform: 'linkedin', caption: 'a' },
    { platform: 'youtube', caption: 'b' },
  ]);
  check('a healthy destination still scores', out.linkedin.state, SCORE_STATE.SCORED);
  check('…while the failing one degrades', out.youtube.state, SCORE_STATE.UNAVAILABLE);
}

{
  // The property that makes the whole design safe: it cannot reject, so a
  // caller cannot accidentally make the composer depend on it succeeding.
  const exploding = async () => { throw new Error('boom'); };
  let rejected = false;
  await scoreDestinations(exploding, [{ platform: 'x', caption: 'a' }]).catch(() => { rejected = true; });
  check('scoreDestinations never rejects', rejected, false);
}

// Bands are presentation only — no band may read as a refusal.
check('a missing score bands as Not scored', bandFor(null).key, 'none');
check('a high score bands strong', bandFor(95).key, 'strong');
check('a low score bands weak, not "fail"', bandFor(10).key, 'weak');
ok('no band is labelled as a failure', !['fail', 'blocked', 'error'].includes(bandFor(0).key), bandFor(0).key);

// ── PHASE 6 — THE FOLD ──────────────────────────────────────────────────────

// Every fold carries its provenance. An unsourced number would be presented to
// the user as fact while being a guess.
for (const [platform, entry] of Object.entries(PLATFORM_FOLD)) {
  ok(
    `${platform} fold has a positive size (chars, or lines × charsPerLine)`,
    Number.isFinite(foldCapacity(entry)) && foldCapacity(entry) > 0,
    JSON.stringify({ chars: entry.chars, lines: entry.lines, charsPerLine: entry.charsPerLine }),
  );
  ok(`${platform} fold is graded`, ['MEASURED', 'DOCS', 'UNVERIFIED'].includes(entry.grade), entry.grade);
  ok(`${platform} fold cites a source`, typeof entry.source === 'string' && entry.source.length > 20, entry.source);
}

// The fold is a SOFT limit and must never exceed the platform's HARD limit — a
// caption cannot be hidden past a point it could never reach.
for (const platform of Object.keys(PLATFORM_FOLD)) {
  const spec = getPlatformSpec(platform);
  ok(
    `${platform}'s fold does not exceed its hard caption limit`,
    foldCapacity(PLATFORM_FOLD[platform]) <= spec.captionMax,
    `fold ${foldCapacity(PLATFORM_FOLD[platform])} > captionMax ${spec.captionMax}`,
  );
}

// ── LINE-BASED FOLDS — measured on real YouTube videos, 2026-09-16 ─────────
//
// YouTube collapses a description to 3 RENDERED LINES and a line break uses a
// line. A flat character count got both cases below wrong: it said 157 for all.
{
  const yt = PLATFORM_FOLD.youtube;
  check('YouTube is modelled in lines', Number.isFinite(yt.lines), true);
  check('YouTube folds at 3 lines, as measured', yt.lines, 3);
  check('YouTube is graded MEASURED', yt.grade, 'MEASURED');

  // The real description that exposed it: "line ⏎ ⏎ line ⏎ ⏎ more…". Three
  // lines are used by line one, the blank line, and line two — so only those
  // two lines show, however short they are.
  const rick = 'The official video for “Never Gonna Give You Up” by Rick Astley.\n\n'
    + 'Never: The Autobiography 📚 OUT NOW!\n\nFollow Rick Astley everywhere';
  const r = splitAtFold(rick, 'youtube');
  check('a blank line consumes a line: it folds', r.folds, true);
  ok('…after exactly the first two text lines', r.visible.trimEnd().endsWith('OUT NOW!'), JSON.stringify(r.visible.slice(-20)));
  ok('…with the rest hidden', r.hidden.includes('Follow Rick Astley'), r.hidden);
  check('…and reports the model it used', r.model, 'lines');
  check('nothing is lost across the split', r.visible + r.hidden, rick);

  // One unbroken paragraph fills all 3 lines.
  const para = 'w'.repeat(yt.lines * yt.charsPerLine + 25);
  const p = splitAtFold(para, 'youtube');
  check('an unbroken paragraph folds', p.folds, true);
  check('…at lines × charsPerLine', [...p.visible].length, yt.lines * yt.charsPerLine);

  // Short enough, with breaks, still fits.
  const fits = splitAtFold('one\ntwo\nthree', 'youtube');
  check('three short lines fit in three lines', fits.folds, false);
  const fourth = splitAtFold('one\ntwo\nthree\nfour', 'youtube');
  check('a fourth line folds, however short', fourth.folds, true);
  check('…and the fourth line is what is hidden', fourth.hidden, 'four');

  // Trailing blank lines past the fold are not hidden content. (A single
  // trailing "\n" ends exactly at the cut and never reached this branch — the
  // first version of this case passed with the rule deleted, so it used two.)
  const trailing = splitAtFold('one\ntwo\nthree\n\n\n', 'youtube');
  check('trailing blank lines alone do not count as folding', trailing.folds, false);
  check('…and nothing is reported hidden', trailing.hidden, '');

  // Emoji still count as one character inside the line model.
  const emojiLine = splitAtFold('🎉'.repeat(yt.lines * yt.charsPerLine + 3), 'youtube');
  check('the line model counts code points too', [...emojiLine.visible].length, yt.lines * yt.charsPerLine);
  ok('…without splitting a surrogate pair', !/[\uD800-\uDBFF]$/.test(emojiLine.visible), 'trailing high surrogate');

  // A MEASURED fold must carry its evidence, and the tool must exist.
  ok('the measurement is dated', /^\d{4}-\d{2}-\d{2}$/.test(yt.measured?.date || ''), yt.measured?.date);
  ok('the measurement names its viewport', Boolean(yt.measured?.viewport), yt.measured?.viewport);
  ok('the measurement counts its samples', Number(yt.measured?.samples) > 0, String(yt.measured?.samples));
}

check('an unknown platform has no fold', foldFor('myspace'), null);
{
  const res = splitAtFold('some caption', 'myspace');
  check('…and is reported as not folding rather than guessed', res.folds, false);
  check('…with a null foldAt so the UI can say "unknown"', res.foldAt, null);
}

// Exact truncation, counted in CODE POINTS.
{
  const fold = PLATFORM_FOLD.instagram.chars;
  const text = 'a'.repeat(fold + 10);
  const res = splitAtFold(text, 'instagram');
  check('folds when longer than the fold', res.folds, true);
  check('visible is exactly the fold length', [...res.visible].length, fold);
  check('hidden holds the remainder', [...res.hidden].length, 10);
  check('nothing is lost in the split', res.visible + res.hidden, text);
}
{
  const fold = PLATFORM_FOLD.instagram.chars;
  const exact = 'a'.repeat(fold);
  const res = splitAtFold(exact, 'instagram');
  check('exactly at the fold does not fold', res.folds, false);
  check('…and hides nothing', res.hidden, '');
}
{
  const fold = PLATFORM_FOLD.instagram.chars;
  const res = splitAtFold('a'.repeat(fold + 1), 'instagram');
  check('one past the fold folds', res.folds, true);
}

// Emoji are ONE character. "🎉".length is 2 in JavaScript, and counting UTF-16
// units would report an emoji-heavy caption as folding far sooner than it does
// — an error that grows with exactly the captions this product generates.
{
  const fold = PLATFORM_FOLD.instagram.chars;
  const emoji = '🎉'.repeat(fold);
  const res = splitAtFold(emoji, 'instagram');
  check('an emoji counts as one character, so this does not fold', res.folds, false);
  ok('…even though its UTF-16 length is double', emoji.length === fold * 2, String(emoji.length));

  const over = '🎉'.repeat(fold + 5);
  const res2 = splitAtFold(over, 'instagram');
  check('…and folding still splits on whole emoji', [...res2.visible].length, fold);
  ok('…without producing a broken surrogate', !/[\uD800-\uDBFF]$/.test(res2.visible), 'trailing high surrogate');
}

// previewFor joins hashtags the way the publisher does, because hashtags are
// exactly what pushes a hook past the fold.
{
  const caption = 'x'.repeat(100);
  const withTags = previewFor({ platform: 'instagram', caption, hashtags: ['#a', '#b'] });
  const without = previewFor({ platform: 'instagram', caption, hashtags: [] });
  ok('hashtags count toward the fold', withTags.total > without.total, `${withTags.total} vs ${without.total}`);
}
{
  const spec = getPlatformSpec('x');
  const over = previewFor({ platform: 'x', caption: 'y'.repeat(spec.captionMax + 1), hashtags: [] });
  check('a caption past the HARD limit is flagged', over.overHardLimit, true);
  const under = previewFor({ platform: 'x', caption: 'y'.repeat(spec.captionMax - 1), hashtags: [] });
  check('…and one inside it is not', under.overHardLimit, false);
}

// ── Report ──────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n\x1b[31m✖ discovery-and-preview  ${failures} of ${checks} checks failed\x1b[0m\n`);
  process.exit(1);
}
console.log(
  `\x1b[32m✔ discovery-and-preview\x1b[0m  ${checks} checks passed — scoring degrades to "not scored" `
  + "and never blocks a send, every fold is sourced and sits inside its platform's hard limit, and "
  + 'truncation counts code points so emoji do not fold a caption early.',
);
