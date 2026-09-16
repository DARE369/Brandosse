#!/usr/bin/env node
/**
 * check-composer-styles-owned.cjs — a calendar component mounted outside the
 * Calendar must bring its own stylesheet.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * src/calendar/calendar-engine-v2.css was imported by exactly one file:
 * CalendarPage.jsx. QuickPostComposer depends on it for everything that makes it
 * a dialog — `.modal-backdrop`, `.quickpost-modal`, the fold preview, the copy
 * review pulse. Mounted from the Library on a direct page load, the rule was in
 * no loaded stylesheet, `.quickpost-modal` computed to position:static with a
 * transparent background, and "Publish" appended an unstyled form below the
 * grid. Measured in a real browser 2026-09-16.
 *
 * It looked correct whenever someone had visited the Calendar first, because
 * Next keeps a visited route's CSS in the document. So it passed every manual
 * check that started from the Calendar, and the E2E, whose `toBeVisible` is true
 * for an unstyled element. Nothing about the defect was visible to `next build`.
 *
 * ── What this asserts ───────────────────────────────────────────────────────
 * For every file OUTSIDE the Calendar that imports a component from
 * src/calendar/components/, either that component or the importing file must
 * itself import calendar-engine-v2.css. A calendar component reached from a new
 * surface without its styles fails here, instead of shipping unstyled.
 *
 * READ-ONLY. Exit 0 = every cross-surface mount owns its styles. Exit 1 = not.
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const STYLESHEET = 'calendar-engine-v2.css';
const COMPONENT_DIR = path.join(SRC, 'calendar', 'components');

// Files that ARE the Calendar surface; they load the sheet at page level.
const CALENDAR_SURFACE = [
  path.join(SRC, 'pages', 'Calendar'),
  path.join(SRC, 'calendar'),
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const importsStylesheet = (src) => new RegExp(`import\\s+['"][^'"]*${STYLESHEET.replace('.', '\\.')}['"]`).test(src);

// Class names the stylesheet actually defines. A component that uses none of
// them — CopyReviewReport is styled entirely inline with tokens — does not need
// the sheet, and demanding it would teach people to import 69 KB of CSS to
// silence a check.
const sheetClasses = new Set(
  [...fs.readFileSync(path.join(SRC, 'calendar', STYLESHEET), 'utf8').matchAll(/\.([a-zA-Z][\w-]*)/g)]
    .map((m) => m[1]),
);

function usesSheetClasses(src) {
  const used = [...src.matchAll(/className=\{?[`'"]([^`'"]+)[`'"]/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .map((c) => c.replace(/\$\{[^}]*\}/g, '').trim())
    .filter(Boolean);
  return used.filter((c) => sheetClasses.has(c));
}

const failures = [];
const checked = [];

for (const file of walk(SRC)) {
  if (CALENDAR_SURFACE.some((dir) => file.startsWith(dir + path.sep))) continue;
  const src = fs.readFileSync(file, 'utf8');
  const imports = [...src.matchAll(/import\s+[^;]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

  for (const spec of imports) {
    if (!spec.startsWith('.')) continue;
    const base = path.resolve(path.dirname(file), spec);
    if (!base.startsWith(COMPONENT_DIR + path.sep)) continue;

    const candidates = [base, `${base}.jsx`, `${base}.js`, path.join(base, 'index.jsx'), path.join(base, 'index.js')];
    const target = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
    if (!target) continue;

    const componentSrc = fs.readFileSync(target, 'utf8');
    const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
    if (usesSheetClasses(componentSrc).length === 0) continue;
    checked.push(`${rel(file)} -> ${rel(target)}`);

    if (!importsStylesheet(componentSrc) && !importsStylesheet(src)) {
      failures.push(
        `${rel(file)} mounts ${rel(target)}, but neither imports ${STYLESHEET}. On a direct `
        + 'load of that page the component renders unstyled — for the composer, an unstyled '
        + 'form below the page instead of a dialog. Import the stylesheet in the component.',
      );
    }
  }
}

// The specific instance that shipped, asserted directly so this check cannot
// quietly pass by finding no importers at all.
const composer = fs.readFileSync(path.join(COMPONENT_DIR, 'QuickPostComposer.jsx'), 'utf8');
if (!importsStylesheet(composer)) {
  failures.push(
    `QuickPostComposer.jsx no longer imports ${STYLESHEET}. It is mounted from the Library, `
    + 'where nothing else loads that sheet.',
  );
}
if (checked.length === 0) {
  failures.push(
    'Found no file outside the Calendar importing a calendar component. The Library mounts '
    + 'QuickPostComposer, so this check is not reading what it thinks it is.',
  );
}

if (failures.length > 0) {
  console.error('\n\x1b[31m✖ check-composer-styles-owned FAILED\x1b[0m\n');
  for (const f of failures) console.error(`  • ${f}\n`);
  process.exit(1);
}

console.log(
  `\x1b[32m✔ check-composer-styles-owned\x1b[0m  ${checked.length} cross-surface mount(s) of calendar `
  + `components, each bringing ${STYLESHEET}: ${checked.join('; ')}`,
);
