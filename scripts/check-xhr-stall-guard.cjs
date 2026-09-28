#!/usr/bin/env node
/**
 * check-xhr-stall-guard.cjs — every XMLHttpRequest is watched by a stall
 * timeout, so no promise built on one can stay pending forever.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * Reported 2026-09-24: on the video job page, Keep and Schedule spun forever.
 * No error, no toast, nothing to click — `personal-asset-upload` simply sat in
 * the Network tab as (pending) until the tab was closed.
 *
 * XMLHttpRequest does not settle on its own when a connection stalls. `onerror`
 * fires for a transport error and `onload` for a response; a socket that goes
 * quiet is neither. All three XHR call sites in this repo wrapped one in
 * `new Promise(...)` and resolved only from those two events, so a stall left
 * the promise pending for the life of the page, along with every `await`
 * waiting behind it:
 *
 *   src/services/assetLibraryService.js  — Library upload  (the reported one)
 *   src/services/videoEngineApi.js       — source video upload to the worker
 *   src/stores/BrandKitStore.js          — brand logo / asset upload
 *
 * Three identical omissions, because the lifecycle was copied twice. Only the
 * first was ever reported; the other two were the same bug waiting for a worse
 * connection.
 *
 * CLAUDE.md, non-negotiable: "Every outbound call needs a timeout."
 *
 * ── Why this check and not a `fetch` audit ──────────────────────────────────
 * `fetch` at least rejects when the connection drops, and an `await fetch(...)`
 * with no AbortSignal is a slow path, not an unterminated one. XHR wrapped in a
 * Promise is the shape that can hang forever with no way back, so that is the
 * shape this asserts. The guard is deliberately narrow enough to be exact:
 * three call sites today, and a fourth cannot be added without passing here.
 *
 * ── What this asserts, per file containing `new XMLHttpRequest` ─────────────
 *  1. It imports guardXhrAgainstStalls from src/services/xhrStallGuard.js.
 *  2. It constructs the guard once per XHR construction — no XHR left unwatched
 *     in a file where a sibling happens to be watched.
 *  3. It calls `.arm()`, since constructing the guard only attaches listeners;
 *     an unarmed guard never fires and would pass a shallower check.
 *
 * It also asserts the helper itself still aborts and still reports, because a
 * guard whose implementation quietly became a no-op is worse than none: every
 * call site would still look correct.
 *
 * READ-ONLY. Exit 0 = every XHR is watched. Exit 1 = one can hang (fails CI).
 */

const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./lib/strip-comments.cjs');

const ROOT = process.cwd();
const SCAN_ROOTS = ['src', 'app'];
const SOURCE_FILE = /\.(?:jsx?|tsx?)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '__snapshots__']);

const HELPER_PATH = path.join(ROOT, 'src', 'services', 'xhrStallGuard.js');
const HELPER_REL = 'src/services/xhrStallGuard.js';

const failures = [];

// ── The helper must still do what its name promises ─────────────────────────

if (!fs.existsSync(HELPER_PATH)) {
  failures.push(
    `${HELPER_REL} is missing. Every XHR in this repo depends on it to settle `
    + 'when a connection stalls.',
  );
} else {
  const helper = stripComments(fs.readFileSync(HELPER_PATH, 'utf8'));

  if (!/export\s+function\s+guardXhrAgainstStalls/.test(helper)) {
    failures.push(`${HELPER_REL} no longer exports guardXhrAgainstStalls.`);
  }
  if (!/setTimeout\s*\(/.test(helper)) {
    failures.push(
      `${HELPER_REL} contains no setTimeout. Without one the watchdog never `
      + 'fires and every call site is unprotected while still looking correct.',
    );
  }
  if (!/\.abort\s*\(\s*\)/.test(helper)) {
    failures.push(
      `${HELPER_REL} no longer aborts the request on stall. Rejecting without `
      + 'aborting leaves the socket open and the connection slot occupied.',
    );
  }
  if (!/onStall\s*\(/.test(helper)) {
    failures.push(
      `${HELPER_REL} no longer invokes its onStall callback, so the promise it `
      + 'is supposed to settle stays pending — the exact defect it exists for.',
    );
  }
}

// ── Every XHR call site must be wired to it ─────────────────────────────────

function collect(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collect(full, out);
    } else if (SOURCE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

const files = [];
for (const root of SCAN_ROOTS) {
  const abs = path.join(ROOT, root);
  if (fs.existsSync(abs)) collect(abs, files);
}

const countOf = (haystack, pattern) => (haystack.match(pattern) || []).length;

let sitesChecked = 0;

for (const absolute of files) {
  if (path.resolve(absolute) === path.resolve(HELPER_PATH)) continue;

  const source = stripComments(fs.readFileSync(absolute, 'utf8'));
  const constructions = countOf(source, /new\s+XMLHttpRequest\s*\(/g);
  if (constructions === 0) continue;

  const relative = path.relative(ROOT, absolute).split(path.sep).join('/');
  sitesChecked += constructions;

  if (!/guardXhrAgainstStalls/.test(source)) {
    failures.push(
      `${relative} constructs XMLHttpRequest but never imports `
      + 'guardXhrAgainstStalls. A promise resolved only from onload/onerror '
      + 'stays pending forever when the connection goes silent — which is how '
      + 'Keep and Schedule spun with no way to recover. Wire it through '
      + `${HELPER_REL}.`,
    );
    continue;
  }

  const guards = countOf(source, /guardXhrAgainstStalls\s*\(/g);
  if (guards < constructions) {
    failures.push(
      `${relative} constructs XMLHttpRequest ${constructions} time(s) but calls `
      + `guardXhrAgainstStalls ${guards} time(s). At least one request is `
      + 'unwatched; a guarded sibling in the same file does not protect it.',
    );
  }

  if (!/\.arm\s*\(\s*\)/.test(source)) {
    failures.push(
      `${relative} builds the stall guard but never calls .arm(). Constructing `
      + 'it only attaches listeners — until it is armed after send(), a request '
      + 'that never produces a single progress event is not watched at all.',
    );
  }
}

if (sitesChecked === 0) {
  failures.push(
    'No XMLHttpRequest construction was found in '
    + `${SCAN_ROOTS.join('/ or ')}/. This check has nothing to assert, which `
    + 'means either the call sites moved or the scan is broken — both need a '
    + 'look, because a check that examines nothing passes for the wrong reason.',
  );
}

// ── Report ──────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error('\n\x1b[31m✖ check-xhr-stall-guard FAILED\x1b[0m\n');
  for (const failure of failures) console.error('  • ' + failure + '\n');
  process.exit(1);
}

console.log(
  `\x1b[32m✔ check-xhr-stall-guard\x1b[0m  ${sitesChecked} XMLHttpRequest call `
  + 'site(s) are armed with a stall watchdog that aborts and rejects, so no '
  + 'upload promise can stay pending forever.',
);
