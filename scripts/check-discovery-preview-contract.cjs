#!/usr/bin/env node
/**
 * check-discovery-preview-contract.cjs — Phases 5 and 6.
 *
 * ── Phase 5: an optional number must never become a blocker ────────────────
 * The scorer is a paid LLM call behind a rate limit, and it throws. The defect
 * to prevent is not a wrong score; it is a composer that cannot send because an
 * OPTIONAL number failed to arrive — which would block hardest precisely when
 * the scoring provider is down.
 *
 * The obvious way that happens is not malice, it is a reasonable-looking
 * refactor: someone adds `|| scoring` to the disabled expression "so people do
 * not send before it finishes". This check exists to fail that commit.
 *
 * ── Phase 6: a fold number without provenance is a guess presented as fact ──
 * No platform publishes where it truncates a caption. Every figure here is
 * observed behaviour, so each must carry a grade and a source — and must live
 * in ONE table, because the moment a second copy exists the two drift and the
 * preview starts lying about the only thing it is for.
 *
 * READ-ONLY. Exit 0 = the rules hold. Exit 1 = one broke (fails CI).
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const failures = [];
const passes = [];

function read(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    failures.push(`${rel} does not exist. The contract cannot be checked.`);
    return '';
  }
  return fs.readFileSync(p, 'utf8');
}

/** Strip comments — a guard that reads its own rationale as evidence is worse
 *  than no guard. CRLF is normalised first because `.` does not match `\r`. */
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

const score = stripComments(read('src/calendar/discoveryScore.js'));
const preview = stripComments(read('src/calendar/platformPreview.js'));
const composer = stripComments(read('src/calendar/components/QuickPostComposer.jsx'));

// ── 1. SCORING NEVER GATES A SEND ───────────────────────────────────────────

// The send gates, read from the composer and checked for any scoring term.
for (const gate of ['sendBlocked', 'scheduleBlocked']) {
  const decl = new RegExp(`const\\s+${gate}\\s*=([\\s\\S]*?);`).exec(composer);
  assert(
    Boolean(decl),
    `QuickPostComposer.jsx no longer declares ${gate}. The send gates are what this check reads; `
    + 'without them it cannot tell whether scoring has crept into them.',
    `${gate} is declared and readable`,
  );
  if (!decl) continue;

  const mentionsScoring = /scor|discover|SCORE_STATE/i.test(decl[1]);
  assert(
    !mentionsScoring,
    `${gate} now depends on the discovery score. The score is ADVISORY: it is a paid call behind `
    + 'a rate limit, and gating a send on it means the composer stops working exactly when the '
    + `scoring provider does. Remove it from ${gate}.`,
    `${gate} does not depend on the discovery score`,
  );
}

assert(
  /blocksPublishing/.test(score) && /return false;/.test(score),
  'discoveryScore.js no longer states that scoring cannot block publishing. That answer is a '
  + 'function rather than a comment so it is greppable and assertable — keep it that way.',
  'blocksPublishing() still answers no',
);

// ── 2. SCORING CANNOT THROW AT ITS BOUNDARY ─────────────────────────────────
//
// The property that makes the design safe: a caller CANNOT await-and-fail on
// it, so the composer cannot come to depend on it succeeding.
assert(
  !/\bthrow\b/.test(score),
  'discoveryScore.js now throws. Its entire purpose is that it cannot — every path resolves to a '
  + 'state object whose worst value is `unavailable`, so a scoring outage degrades to "not '
  + 'scored" instead of propagating into the composer.',
  'the scoring module has no throw path',
);

assert(
  /catch\s*\(/.test(score) && /UNAVAILABLE/.test(score),
  "discoveryScore.js no longer catches the scorer's failure into an UNAVAILABLE state, so a "
  + 'rate limit would surface as an exception from an optional number.',
  'a scoring failure degrades to UNAVAILABLE',
);

// A missing score must not render as zero. `Number(null)` is 0 and finite, so a
// bare isFinite guard let absence fall through and band as "Could be stronger"
// — telling the user their caption is weak when nothing had been measured.
assert(
  /score === null \|\| score === undefined/.test(score),
  'bandFor() no longer checks for an ABSENT score before coercing. Number(null) is 0 and passes '
  + 'Number.isFinite, so a missing score would band as "Could be stronger" — a fabricated reading '
  + 'of a caption nobody measured.',
  'an absent score bands as "Not scored" rather than as a weak one',
);

// The composer must render the unavailable state, not hide it.
assert(
  /SCORE_STATE\.UNAVAILABLE/.test(composer),
  'QuickPostComposer.jsx does not render the UNAVAILABLE score state. A score that silently '
  + 'vanishes on failure looks identical to one that was never requested.',
  'the composer says when a score could not be taken',
);

// ── 3. EVERY FOLD IS SOURCED ────────────────────────────────────────────────

const table = /PLATFORM_FOLD\s*=\s*\{([\s\S]*?)\n\};/.exec(preview);
assert(
  Boolean(table),
  'platformPreview.js no longer exports a readable PLATFORM_FOLD table. The fold figures must '
  + 'live in one place with their provenance beside them.',
  'the fold table is readable',
);

if (table) {
  const entries = [...table[1].matchAll(/(\w+):\s*\{([\s\S]*?)\}/g)];
  assert(
    entries.length > 0,
    'PLATFORM_FOLD is empty, so no platform has a fold and every preview would silently show '
    + 'nothing.',
    `the fold table has ${entries.length} platforms`,
  );

  for (const [, platform, body] of entries) {
    // chars, grade and source travel TOGETHER. Editing a number without
    // touching the line beside it that says where it came from is the drift
    // this pairing exists to make awkward.
    assert(
      /chars:\s*\d+/.test(body),
      `PLATFORM_FOLD.${platform} has no numeric \`chars\`.`,
      `${platform} has a fold length`,
    );
    assert(
      /grade:\s*'(MEASURED|DOCS|UNVERIFIED)'/.test(body),
      `PLATFORM_FOLD.${platform} is not graded MEASURED / DOCS / UNVERIFIED. An ungraded figure `
      + 'gets presented to the user as fact while being a guess.',
      `${platform} is graded`,
    );
    assert(
      /source:\s*['"`]/.test(body),
      `PLATFORM_FOLD.${platform} cites no source. No platform publishes where it truncates a `
      + 'caption, so every figure here is observed behaviour and must say whose observation.',
      `${platform} cites its source`,
    );
  }
}

// ── 4. ONE TABLE, NOT TWO ───────────────────────────────────────────────────
//
// The moment a fold number is duplicated into a component, the two drift and
// the preview starts lying about the one thing it exists to get right.
assert(
  !/fold\s*[:=]\s*\d+/i.test(composer) && !/foldChars/i.test(composer),
  'QuickPostComposer.jsx hardcodes a fold length instead of taking it from PLATFORM_FOLD. Two '
  + 'tables of the same number is how the preview drifts away from the figure that carries the '
  + 'source note.',
  'the composer takes every fold from the single table',
);

// The HARD limit must still come from the adapter-mirroring spec, never from a
// second copy inside the preview module.
assert(
  /getPlatformSpec/.test(preview) && !/captionMax:\s*\d+/.test(preview),
  'platformPreview.js defines its own captionMax instead of reading platformCaptionSpecs. That '
  + 'file mirrors the ADAPTERS, which refuse rather than truncate — a second copy here would let '
  + 'the counter disagree with what actually gets enforced at send time.',
  'the hard caption limit still comes from the adapter-mirroring spec',
);

// ── 5. TRUNCATION COUNTS CODE POINTS ────────────────────────────────────────
//
// "🎉".length is 2. Counting UTF-16 units reports an emoji-heavy caption as
// folding far sooner than it does — an error that grows with exactly the
// captions this product generates.
assert(
  /\[\.\.\.\s*text\s*\]/.test(preview) || /Array\.from\(\s*text/.test(preview),
  'platformPreview.js no longer counts the caption by code point. Using .length would fold an '
  + 'emoji-heavy caption early and could split a surrogate pair in half.',
  'truncation counts code points, not UTF-16 units',
);

// ── Report ──────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error('\n\x1b[31m✖ check-discovery-preview-contract FAILED\x1b[0m\n');
  for (const f of failures) console.error(`  • ${f}\n`);
  process.exit(1);
}

console.log(
  '\x1b[32m✔ check-discovery-preview-contract\x1b[0m  '
  + `${passes.length} checks: the discovery score cannot throw and cannot gate a send, an absent `
  + 'score bands as "Not scored" rather than weak, every fold carries a grade and a source in one '
  + 'table, and truncation counts code points.',
);
