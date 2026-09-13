#!/usr/bin/env node
/**
 * check-video-prefs-contract.cjs — guard for the video clip-preferences chain.
 *
 * Found 2026-08-23: the submit form collected six clip preferences, the
 * database had columns for them, the worker read them — and the API route's
 * zod schema silently stripped every one, so all jobs ran with defaults
 * regardless of what the user picked. Four layers, three implemented, zero
 * connected. This guard asserts the chain END TO END in source:
 *
 *   SubmitForm sends field  ->  submit route validates it  ->  route inserts it
 *                           ->  worker reads it
 *
 * Any link missing for any field fails the build with the field named.
 */
const fs = require('fs');
const path = require('path');

const FIELDS = [
  'aspect_ratio',
  'caption_style',
  'clip_count_target',
  'min_duration_secs',
  'max_duration_secs',
  'specific_moments',
];

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// Repointed 2026-09-13. This read src/components/video-engine/SubmitForm.jsx,
// which is unreachable from any route — a transitive import graph from all 106
// Next.js entry points never reaches it. So the contract passed while proving
// nothing about the form a user can actually open. The live submit UI is
// NewJobSheet.jsx, reached from VideosPage via /app/video/jobs.
// Verified at the time of the change: NewJobSheet already sends all six fields,
// so this corrects the guard's aim without changing what it asserts.
const form = read('src/pages/VideoEngine/components/NewJobSheet.jsx');
const route = read('app/api/video/submit/route.ts');
const analyze = read('video-worker/stages/analyze.py');
const render = read('video-worker/stages/render.py');
const worker = analyze + render;

// The route must both declare the field in its schema AND spread it into the
// insert. One mention could be either; the guard demands both.
const failures = [];
for (const f of FIELDS) {
  if (!form.includes(f)) failures.push(`${f}: not sent by SubmitForm.jsx`);
  // Two PRECISE links, not a mention count — comments and half the chain can
  // satisfy a count while the schema entry is missing, which is exactly the
  // bug this guards against (zod strips unknown keys silently).
  if (!new RegExp(`${f}:\\s*z\\s*\\.`).test(route)) {
    failures.push(`${f}: missing from the zod schema in submit/route.ts — zod will strip it silently`);
  }
  if (!route.includes(`${f}: body.${f}`)) {
    failures.push(`${f}: validated but never inserted in submit/route.ts`);
  }
  if (!worker.includes(`'${f}'`) && !worker.includes(`"${f}"`)) {
    failures.push(`${f}: never read by the worker (analyze.py / render.py)`);
  }
}

if (failures.length) {
  console.error('Video preferences contract BROKEN:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(
  `Video preferences contract intact — ${FIELDS.length} fields verified form -> route schema -> insert -> worker.`,
);
