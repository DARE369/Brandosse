#!/usr/bin/env node
/**
 * check-extract-progress-honesty.cjs — the extraction screen reports what is
 * actually happening, and bills for one extraction per import.
 *
 * ── The defects this exists to prevent ──────────────────────────────────────
 * Reported as "stuck here for Ages ... no real progress indicator and just a
 * bad UX". Three separate bugs were behind one screen:
 *
 *  1. THE PROGRESS WAS FICTION. Stages completed on setTimeout — "Reading your
 *     site" after 500ms, "Extracting brand fields" after 1800ms — regardless of
 *     what the server was doing. The bar then sat frozen at 30% for the real
 *     duration (22.8s measured against a live site) under the words "This
 *     usually takes ~30 seconds". A stalled determinate bar reads as a hang,
 *     which is worse than no bar at all.
 *
 *  2. IT GENUINELY HUNG. `cancelledRef.current` was set true by the effect
 *     cleanup and never reset. React StrictMode (reactStrictMode: true) mounts
 *     every effect, tears it down and mounts it again, so the flag was
 *     permanently true by the second mount. The request then completed, the
 *     server did the work and charged for it, and `if (cancelledRef.current)
 *     return` threw the result away. The screen waited forever for a response
 *     it had already received.
 *
 *  3. IT BILLED TWICE. The same double-mount fired two extractBrandKit calls
 *     per import — two site crawls and two LLM calls, confirmed by two 200s on
 *     the network for one click.
 *
 * ── What this asserts ───────────────────────────────────────────────────────
 * That none of the three comes back: no timer-driven stage completion, no
 * percentage the client cannot know, the cancelled flag reset on every effect
 * run, and one in-flight request per input.
 */

const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./lib/strip-comments.cjs');

const ROOT = process.cwd();
const LOADER = path.join(ROOT, 'src', 'components', 'BrandKit', 'BrandKitExtractLoader.jsx');

const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

if (!fs.existsSync(LOADER)) {
  console.error('✖ check-extract-progress-honesty: BrandKitExtractLoader.jsx not found');
  process.exit(1);
}
const source = stripComments(fs.readFileSync(LOADER, 'utf8'));

// ── 1. No invented progress ──────────────────────────────────────────────────

assert(
  !/setTimeout\(\s*\(\)\s*=>\s*\{[^}]*markStageDone/s.test(source),
  'A stage is marked done by a setTimeout again. Timers know nothing about the request; a stage '
  + 'that "completes" on a clock is fiction, and the bar then freezes for the real duration.',
);
assert(
  !/style=\{\{\s*width:\s*`\$\{progress\}%`/.test(source),
  'The progress bar is driven by a percentage again. There is one network call here and no '
  + 'progress stream, so any percentage is invented — and a frozen one reads as a hang.',
);
assert(
  /extractProgressIndeterminate/.test(source),
  'The indeterminate progress bar is gone. Motion is the only honest signal available: it says '
  + '"still running" and claims nothing more.',
);
assert(
  /elapsed/.test(source) && /setElapsed/.test(source),
  'The elapsed-time counter is gone. It is the only number on this screen that is true by '
  + 'construction, and it answers the question the user actually has.',
);
// The screen must read differently when it runs long, or slow and stuck look identical.
assert(
  /elapsed\s*>=\s*\d+/.test(source),
  'Nothing changes in the copy as time passes, so a slow site looks exactly like a stuck one — '
  + 'which is the complaint that started this.',
);

// ── 2. The hang ──────────────────────────────────────────────────────────────

const effectStart = source.indexOf('if (!file && !websiteUrl) return undefined;');
const resetIndex = source.indexOf('cancelledRef.current = false');
assert(
  resetIndex > 0,
  'cancelledRef is never reset to false. The effect cleanup sets it true, and StrictMode mounts '
  + 'every effect twice — so by the second mount it is permanently true and the completed '
  + 'response is discarded. The screen then waits forever for a reply it already has.',
);
assert(
  resetIndex > 0 && effectStart > 0 && resetIndex > effectStart
    && resetIndex < source.indexOf('const runExtraction'),
  'cancelledRef is reset somewhere other than the top of the effect. It must be cleared before '
  + 'the extraction starts, or the run it is meant to protect is already doomed.',
);

// ── 3. Paying twice ──────────────────────────────────────────────────────────

assert(
  /inFlightRef/.test(source),
  'There is no in-flight request guard. This effect makes a PAID call and StrictMode runs it '
  + 'twice, so one import becomes two site crawls and two LLM calls.',
);
assert(
  /inFlightRef\.current\.key\s*!==/.test(source),
  'The in-flight guard does not compare an input key, so either it never re-runs for a genuinely '
  + 'new URL or file, or it does not dedupe at all.',
);
assert(
  /await inFlightRef\.current\.promise/.test(source),
  'The effect does not await the shared in-flight promise, so the second mount cannot attach to '
  + 'the first request and will start its own.',
);

if (failures.length > 0) {
  console.error('\n\x1b[31m✖ check-extract-progress-honesty FAILED\x1b[0m\n');
  for (const failure of failures) console.error(`  • ${failure}\n`);
  process.exit(1);
}

console.log(
  '\x1b[32m✔ check-extract-progress-honesty\x1b[0m  no timer-driven stages, no invented '
  + 'percentage, elapsed time shown, cancelled flag reset per run, and one paid extraction per '
  + 'import.',
);
