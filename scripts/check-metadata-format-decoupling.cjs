#!/usr/bin/env node
/**
 * check-metadata-format-decoupling.cjs
 *
 * Guards the structural fix for a failure that recurred all day on 2026-08-23
 * and survived four separate patches (PO tokens, cookies, the tv client, a
 * client fallback ladder).
 *
 * THE DEFECT: _get_video_metadata inherited the DOWNLOAD format selector from
 * YTDLP_BASE_OPTIONS. yt-dlp applies that selector during extract_info, so any
 * moment YouTube returned formats that did not match it, the job died at
 * PREFLIGHT with "Requested format is not available" — on videos that were
 * downloadable minutes earlier.
 *
 * Proven by forcing the condition with an unmatchable selector: metadata failed
 * on ALL FOUR ladder rungs, because every rung carried the same selector. A
 * fallback that varies the client cannot rescue a constraint that does not vary.
 *
 * THE INVARIANT: fetching a title and a duration must never depend on a
 * downloadable media format existing. Only the download stage needs a format.
 *
 * This guard is source-level on purpose: the behavioural proof needs the live
 * worker and YouTube, neither of which belongs in CI.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'video-worker', 'stages', 'download.py');
const src = fs.readFileSync(file, 'utf8');

// Isolate _get_video_metadata's body, up to the first extraction attempt.
const start = src.indexOf('def _get_video_metadata');
if (start === -1) {
  console.error('check-metadata-format-decoupling: _get_video_metadata not found — was it renamed?');
  process.exit(1);
}
const nextDef = src.indexOf('\ndef ', start + 1);
const body = src.slice(start, nextDef === -1 ? src.length : nextDef);

const failures = [];

// 1. The selector must be removed from the metadata options.
if (!/opts\.pop\(\s*['"]format['"]/.test(body)) {
  failures.push(
    'metadata options still carry the download format selector — ' +
      "add opts.pop('format', None). A format that matches nothing must not be " +
      'able to fail a title/duration lookup.',
  );
}

// 2. And a format-less response must not be treated as an error.
if (!/ignore_no_formats_error/.test(body)) {
  failures.push(
    "metadata options do not set ignore_no_formats_error — a response carrying " +
      'no usable formats should still yield title and duration.',
  );
}

// 3. The download stage must still degrade rather than fail on a height filter.
const fmtMatch = src.match(/'format':\s*\(([\s\S]*?)\)/);
const fmtLiteral = fmtMatch ? fmtMatch[1] : (src.match(/'format':\s*'([^']*)'/) || [])[1] || '';
const fmt = fmtLiteral.replace(/['\s\n]/g, '');
if (!fmt.endsWith('/best')) {
  failures.push(
    `download format selector does not end in a bare '/best' fallback (got "${fmt}") — ` +
      'without it, a source whose formats miss the height filter fails instead of degrading.',
  );
}

if (failures.length) {
  console.error('Metadata/format decoupling BROKEN:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(
  'Metadata/format decoupling intact — title/duration cannot be failed by format selection, ' +
    'and the download selector degrades to /best.',
);
