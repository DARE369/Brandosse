#!/usr/bin/env node
/*
 * Every --uiv2-* token referenced anywhere in src/ must be defined in
 * src/ui-v2/tokens.css.
 *
 * WHY THIS EXISTS
 * ---------------
 * `var(--uiv2-surface, #17181B)` looks like a themed declaration and is not.
 * If --uiv2-surface is never defined, the fallback wins permanently — so the
 * element renders a fixed colour that never follows the theme. On 2026-09-13
 * six such tokens were live:
 *
 *   --uiv2-surface, --uiv2-surface-2, --uiv2-border-subtle, --uiv2-accent
 *       in TikTokOptionsPanel.module.css and YouTubeOptionsPanel.module.css
 *   --uiv2-surface-raised, --uiv2-surface-sunken
 *       in StudioPage.jsx
 *
 * Every one of them carried a hardcoded DARK fallback, so in light theme the
 * TikTok and YouTube publishing panels painted near-black surfaces on a light
 * page. One of them (#FF6B2C) was not even the brand accent. Nothing caught it,
 * because a CSS custom property with a fallback never errors — it silently does
 * the wrong thing, which is precisely the failure mode Law 3 names.
 *
 * A fallback is not forbidden. An UNDEFINED token is.
 */
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const TOKENS = path.join(root, 'src', 'ui-v2', 'tokens.css');
const SRC = path.join(root, 'src');
const EXT = new Set(['.css', '.scss', '.js', '.jsx', '.ts', '.tsx']);
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(e.name))) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(root, p).split(path.sep).join('/');

if (!fs.existsSync(TOKENS)) {
  console.error(`check-uiv2-token-definitions: cannot find ${rel(TOKENS)}`);
  process.exit(1);
}

const tokenSource = fs.readFileSync(TOKENS, 'utf8');
const defined = new Set(
  [...tokenSource.matchAll(/(--uiv2-[a-z0-9-]+)\s*:/g)].map((m) => m[1])
);

const used = new Map();
for (const file of walk(SRC)) {
  if (rel(file) === 'src/ui-v2/tokens.css') continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const m of source.matchAll(/var\(\s*(--uiv2-[a-z0-9-]+)/g)) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(rel(file));
  }
}

const missing = [...used.entries()].filter(([token]) => !defined.has(token));

if (missing.length > 0) {
  console.error(
    `\ncheck-uiv2-token-definitions FAILED: ${missing.length} token(s) used but never defined in src/ui-v2/tokens.css.\n`
  );
  console.error('Each of these silently renders its fallback and never follows the theme.\n');
  for (const [token, files] of missing.sort()) {
    console.error(`  ${token}`);
    for (const f of [...files].sort()) console.error(`      ${f}`);
  }
  console.error('\nFix by pointing the usage at a token that exists, not by adding a fallback.\n');
  process.exit(1);
}

console.log(
  `✔ check-uiv2-token-definitions  ${used.size} distinct --uiv2-* tokens referenced across src/; every one resolves against src/ui-v2/tokens.css (${defined.size} defined).`
);
