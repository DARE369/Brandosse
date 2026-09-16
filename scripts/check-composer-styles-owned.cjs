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
const classesIn = (css) => new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

function walkCss(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkCss(full, out);
    else if (/\.css$/.test(entry.name) && !/\.module\.css$/.test(entry.name)) out.push(full);
  }
  return out;
}

// Only classes this sheet defines EXCLUSIVELY. Generic ones — ui-button,
// active, media-preview — are also defined in global stylesheets every page
// loads, so a file using them does not depend on this sheet. Without this
// narrowing the rule flagged nine files for classes they already get elsewhere,
// which would teach people to silence it rather than read it.
const sheetPath = path.join(SRC, 'calendar', STYLESHEET);
const elsewhere = new Set(
  walkCss(SRC)
    .filter((f) => path.resolve(f) !== path.resolve(sheetPath))
    .flatMap((f) => [...classesIn(fs.readFileSync(f, 'utf8'))]),
);
// Hyphenated names only. The sheet also defines bare words like `.pass` and
// `.fail`, and those words appear near `className=` all over the codebase as
// CSS-module keys (`styles.fail`) that have nothing to do with this sheet. The
// sheet's own component classes are all namespaced — quickpost-*, schedule-*,
// asset-picker-* — so that is what is checked.
const sheetClasses = new Set(
  [...classesIn(fs.readFileSync(sheetPath, 'utf8'))].filter((c) => !elsewhere.has(c) && /[-_]/.test(c)),
);

// Reads the text following each `className=` and picks out whole-word tokens
// that are exclusive classes of the sheet. A quoted-string pattern missed
// class names built in template literals — `quickpost-copy-review__btn${…}` —
// which is how conditional classes are usually written, so it passed files it
// could not see.
function usesSheetClasses(src) {
  const used = [];
  for (const m of src.matchAll(/className=/g)) {
    const region = src.slice(m.index, m.index + 240);
    for (const token of region.matchAll(/[a-zA-Z][\w-]*/g)) {
      if (sheetClasses.has(token[0])) used.push(token[0]);
    }
  }
  return used;
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

// Any file outside the Calendar that USES a class this stylesheet defines must
// import the stylesheet itself — not only files that import a calendar
// component. The Library's asset copy review reuses the composer's stale-pulse
// class; relying on the composer being elsewhere in the page graph is the same
// accidental dependency that left the composer unstyled.
for (const file of walk(SRC)) {
  if (CALENDAR_SURFACE.some((dir) => file.startsWith(dir + path.sep))) continue;
  const src = fs.readFileSync(file, 'utf8');
  const used = usesSheetClasses(src);
  if (used.length === 0) continue;
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  checked.push(`${rel} (uses ${[...new Set(used)].join(', ')})`);
  if (!importsStylesheet(src)) {
    failures.push(
      `${rel} uses ${[...new Set(used)].join(', ')} from ${STYLESHEET} but does not import it. It only `
      + 'looks right when something else on the page happens to load that sheet.',
    );
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
