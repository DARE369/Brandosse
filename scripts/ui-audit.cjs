#!/usr/bin/env node
/* =============================================================================
   ui-audit.cjs — Design-system governance guardrail (Stage 1 of rebuild)
   -----------------------------------------------------------------------------
   Scans src/ for the drift patterns that made the UI inconsistent, so we can
   (a) get a baseline, and (b) prevent regressions as pages are migrated.

   Run:  node scripts/ui-audit.cjs
         node scripts/ui-audit.cjs --top 15     (show more offenders)

   Checks:
     1. Raw hex colors in CSS/JSX (outside the token layer) — should be tokens.
     2. `transition: all`                                    — should be explicit.
     3. Inline style={{ }} in JSX                            — should be classes/tokens.
     4. Generic global class DEFINITIONS (.card/.btn-primary/.badge/...) in page
        CSS — collide across surfaces; should be scoped or use ui-primitives.
   Exit code is always 0 (report-only). Flip FAIL_ON_REGRESSION later for CI.
   ============================================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// Token/foundation files are allowed to hold raw hex (they ARE the source).
const TOKEN_FILES = new Set([
  'tokens.css', 'variables.css', 'theme.css',
]);
// Generic names that must not be DEFINED in page CSS (cross-surface collisions).
const GENERIC_CLASSES = ['card', 'btn-primary', 'btn-secondary', 'badge', 'modal-overlay', 'status-badge', 'empty-state', 'sidebar-toggle-btn'];

const TOP = (() => {
  const i = process.argv.indexOf('--top');
  return i > -1 ? Number(process.argv[i + 1]) || 10 : 10;
})();

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

const results = {
  rawHex: {},        // file -> count
  transitionAll: {}, // file -> count
  inlineStyle: {},   // file -> count
  genericClass: {},  // file -> [classes]
};

// ---- CSS files ----
for (const file of walk(SRC, ['.css', '.scss'])) {
  const name = path.basename(file);
  const text = fs.readFileSync(file, 'utf8');

  if (!TOKEN_FILES.has(name)) {
    const hex = text.match(HEX);
    if (hex) results.rawHex[rel(file)] = hex.length;
  }
  const ta = text.match(/transition:\s*all/g);
  if (ta) results.transitionAll[rel(file)] = ta.length;

  const generic = GENERIC_CLASSES.filter((c) => new RegExp(`\\.${c}\\s*[,{]`).test(text));
  if (generic.length) results.genericClass[rel(file)] = generic;
}

// ---- JSX files ----
for (const file of walk(SRC, ['.jsx', '.tsx'])) {
  const text = fs.readFileSync(file, 'utf8');
  const inline = text.match(/style=\{\{/g);
  if (inline) results.inlineStyle[rel(file)] = inline.length;
  const hex = text.match(HEX);
  if (hex) results.rawHex[rel(file)] = (results.rawHex[rel(file)] || 0) + hex.length;
}

function total(map) { return Object.values(map).reduce((a, b) => a + (Array.isArray(b) ? b.length : b), 0); }
function topList(map, n) {
  return Object.entries(map)
    .sort((a, b) => (Array.isArray(b[1]) ? b[1].length : b[1]) - (Array.isArray(a[1]) ? a[1].length : a[1]))
    .slice(0, n);
}

const C = { dim: '\x1b[2m', red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', bold: '\x1b[1m', reset: '\x1b[0m' };

console.log(`\n${C.bold}UI Governance Audit${C.reset}  ${C.dim}(Midnight Aurora foundation)${C.reset}\n`);

const rows = [
  ['Raw hex colors (outside token layer)', total(results.rawHex), Object.keys(results.rawHex).length],
  ['transition: all', total(results.transitionAll), Object.keys(results.transitionAll).length],
  ['Inline style={{ }} in JSX', total(results.inlineStyle), Object.keys(results.inlineStyle).length],
  ['Generic global class definitions', total(results.genericClass), Object.keys(results.genericClass).length],
];
for (const [label, count, files] of rows) {
  const color = count === 0 ? C.green : count < 50 ? C.yellow : C.red;
  console.log(`  ${color}${String(count).padStart(5)}${C.reset}  ${label}  ${C.dim}(${files} files)${C.reset}`);
}

function section(title, map) {
  const t = topList(map, TOP);
  if (!t.length) return;
  console.log(`\n${C.bold}Top ${title}:${C.reset}`);
  for (const [file, val] of t) {
    const v = Array.isArray(val) ? val.join(', ') : val;
    console.log(`  ${C.dim}${String(Array.isArray(val) ? val.length : val).padStart(4)}${C.reset}  ${file}  ${Array.isArray(val) ? C.dim + '[' + v + ']' + C.reset : ''}`);
  }
}
section('raw-hex offenders', results.rawHex);
section('inline-style offenders', results.inlineStyle);
section('generic-class definitions', results.genericClass);
section('transition:all offenders', results.transitionAll);

console.log(`\n${C.dim}Report-only. Goal: drive these toward zero as pages migrate onto ui-primitives + tokens.${C.reset}\n`);
