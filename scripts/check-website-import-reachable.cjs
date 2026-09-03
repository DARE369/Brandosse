#!/usr/bin/env node
/**
 * check-website-import-reachable.cjs — a user can actually reach the website
 * import.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * The URL import is the best extraction path in the product and the only one
 * that MEASURES a brand: real hex codes parsed out of the site's own CSS, the
 * actual typefaces, contact details and social handles from its structured
 * data. Every other path infers from prose.
 *
 * It was reachable from exactly one screen: BrandKitPage's `kits.length === 0`
 * landing state, which a user sees once and never again. Every later route into
 * setup — "Start from scratch", "New brand kit", or simply already owning one
 * kit — lands on BrandKitSetupChoice, which offered four options and not this
 * one. Reported by the founder on 2026-09-03 as "there is no option to extract
 * the kit from the website URL".
 *
 * The edge function had supported `websiteUrl` the whole time. The harvester,
 * the measured palette, the provenance labelling — all of it sat behind a screen
 * most users could no longer get to. Disconnection, not absence, again.
 *
 * ── What this asserts ───────────────────────────────────────────────────────
 *  1. The setup screen offers the website path and hands it to onSelectPath.
 *  2. BrandKitPage HANDLES that path — a card that calls a handler with no
 *     matching branch is a button that does nothing.
 *  3. The handler routes to the extractor with the URL, not to a dead end.
 *  4. The zero-kits landing screen still offers it too.
 */

const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./lib/strip-comments.cjs');

const ROOT = process.cwd();
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

function read(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) {
    failures.push(`Missing file: ${relPath}`);
    return '';
  }
  return stripComments(fs.readFileSync(full, 'utf8'));
}

const choice = read('src/components/BrandKit/BrandKitSetupChoice.jsx');
const page = read('src/pages/Settings/BrandKitPage.jsx');

// ── 1. The setup screen offers it ────────────────────────────────────────────

assert(
  /onSelectPath\(\s*['"]website['"]/.test(choice),
  'BrandKitSetupChoice never calls onSelectPath("website"). The setup screen is where every '
  + 'route into brand-kit setup lands after the first one, so the website import is unreachable '
  + 'for anyone who already has a kit.',
);
assert(
  /<input/.test(choice) && /placeholder=["'][^"']*\./i.test(choice),
  'BrandKitSetupChoice has no URL input. The website path needs somewhere to type an address; '
  + 'the other four paths are one-click and this one is not.',
);
assert(
  /aria-label=/.test(choice),
  'The URL input has no accessible label. It is the primary control on this screen.',
);

// ── 2 + 3. The page handles it and routes to the extractor ───────────────────

assert(
  /path === ['"]website['"]/.test(page),
  'BrandKitPage.handleSelectPath has no "website" branch. The card would call the handler and '
  + 'nothing would happen — the worst kind of broken, because it looks wired.',
);

const websiteBranch = (() => {
  const start = page.search(/if \(path === ['"]website['"]/);
  if (start < 0) return '';
  const end = page.indexOf('return;', start);
  return end < 0 ? page.slice(start, start + 600) : page.slice(start, end);
})();

assert(
  /setImportUrl\(/.test(websiteBranch),
  'The website branch does not set the import URL, so the extractor would run with nothing.',
);
assert(
  /setScreen\(['"]extracting['"]\)/.test(websiteBranch),
  'The website branch does not send the user to the extracting screen.',
);
assert(
  /setUploadedFile\(null\)/.test(websiteBranch),
  'The website branch does not clear any previously selected document. BrandKitExtractLoader '
  + 'prefers a file over a URL when both are present, so a stale file would silently win and the '
  + 'user would get a document extraction they did not ask for.',
);

// The loader must actually be handed the URL.
assert(
  /websiteUrl=\{importUrl/.test(page),
  'BrandKitExtractLoader is not given importUrl, so the URL never reaches the edge function.',
);

// ── 4. The landing screen keeps it ───────────────────────────────────────────

assert(
  /handleEmptyImport/.test(page) && /emptyUrl/.test(page),
  'The zero-kits landing screen lost its URL import. That is the first thing a new account sees.',
);

if (failures.length > 0) {
  console.error('\n\x1b[31m✖ check-website-import-reachable FAILED\x1b[0m\n');
  for (const failure of failures) console.error(`  • ${failure}\n`);
  process.exit(1);
}

console.log(
  '\x1b[32m✔ check-website-import-reachable\x1b[0m  the website import is offered on the setup '
  + 'screen and the landing screen, and BrandKitPage routes it to the extractor with the URL.',
);
