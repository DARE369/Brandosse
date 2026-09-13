const fs = require('fs');
const path = require('path');

const root = process.cwd();
const srcDir = path.join(root, 'src');
const strict = process.env.UI_CONSISTENCY_STRICT === '1';
const extensions = new Set(['.css', '.scss', '.js', '.jsx', '.ts', '.tsx']);

const ignoredDirs = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);
const maxSamples = Number(process.env.UI_CONSISTENCY_SAMPLES || 18);

const findings = {
  rawColors: [],
  tokenDefinitions: [],
  genericGlobals: [],
  transitionAll: [],
  missingAlt: [],
  unlabeledIconButtons: [],
};

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }

    if (extensions.has(path.extname(entry.name))) files.push(fullPath);
  }

  return files;
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function addFinding(bucket, file, lineNumber, line, note) {
  findings[bucket].push({
    file: rel(file),
    lineNumber,
    line: line.trim().slice(0, 180),
    note,
  });
}

function lineNumberFor(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function isAllowedRawColor(line, file) {
  const normalized = `${rel(file)} ${line}`.toLowerCase();
  // A token source file is where raw colour is SUPPOSED to live — that is what
  // makes it the single definition point. src/styles/tokens.css was allowlisted
  // for exactly this reason; src/ui-v2/tokens.css is the canonical source for
  // design-system v2 and was not, so the locked design system was reporting 62
  // findings against itself. Flagging the definition alongside the misuse is
  // what buries the real signal.
  if (rel(file) === 'src/styles/tokens.css') return true;
  if (rel(file) === 'src/ui-v2/tokens.css') return true;

  return [
    'platform',
    'instagram',
    'youtube',
    'tiktok',
    'facebook',
    'linkedin',
    'twitter',
    'chart',
    'spark',
    'kpi',
    'recharts',
    'brand-kit',
    'brandkit',
    'brand color',
    'brand_color',
    'brandcolor',
    'logo',
    'svg',
    'data:image',
    'canvas',
    'gradient',
    'box-shadow',
    'shadow',
    'fill=',
    'stroke=',
    'bordercolor',
    'stopcolor',
    'type="color"',
    'task-status-color',
    'taskstatus',
    'status.color',
    'payload.color',
    'folder_color',
    'folder color',
    'assetfolders',
    'color_swatches',
  ].some((token) => normalized.includes(token));
}

function scanFile(file) {
  const ext = path.extname(file);
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split(/\r?\n/);

  // CSS Modules hash every class name at build time, so a class called `.card`
  // in Badge.module.css is not a global selector and cannot collide with
  // anything. The generic-global rule was flagging the design system's own
  // primitives for using the obvious name inside their own scoped file.
  const isCssModule = /\.module\.(css|scss)$/.test(file);

  // Whole-file opt-out, for files whose SUBJECT is colour that is not this
  // app's chrome: a caption-style preview showing what white subtitles look
  // like burned onto video, or an illustration of another operating system's
  // window controls. The marker must carry its reason on the same line, so it
  // stays auditable rather than becoming a way to silence the check.
  const fileOptedOut = /ui-consistency-allow-file:/.test(source);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    // A colour named in prose is documentation, not a style declaration.
    const isComment = /^\s*(\/\/|\*|\/\*|<!--)/.test(line);
    // Explicit, auditable opt-out for the cases that are genuinely correct —
    // e.g. a scrim over an arbitrary thumbnail, which must hold its contrast
    // because the image behind it never re-themes. Deliberately per-line and
    // self-documenting, rather than widening the category allowlist.
    // Scans back to the start of the current rule block, so one marker covers
    // the declarations it introduces — a multi-line comment and several
    // consecutive properties — rather than only the single next line.
    let optedOut = fileOptedOut || /ui-consistency-allow/.test(line);
    for (let k = index - 1; !optedOut && k >= 0 && index - k <= 12; k -= 1) {
      const prev = lines[k];
      if (/ui-consistency-allow/.test(prev)) { optedOut = true; break; }
      if (/[{}]\s*$/.test(prev) || prev.trim() === '') break;
    }

    if (!isComment && !optedOut
      && (/(^|[^-\w])#[0-9a-fA-F]{3,8}\b|rgba?\s*\(/.test(line)) && !isAllowedRawColor(line, file)) {
      // Defining a colour and hardcoding one at the point of use are opposite
      // things, and lumping them together is what buried the signal here.
      // `--lp-accent: #FF5C38;` is a token definition — the thing we WANT, and
      // the only place a literal may live. `color: #FF5C38;` is the defect.
      // Definitions are reported in their own bucket so an ad-hoc local palette
      // is still visible, but they never block the ratchet.
      if (/^\s*--[\w-]+\s*:/.test(line)) {
        addFinding('tokenDefinitions', file, lineNumber, line, 'Custom property defined with a literal colour — fine in a token source, drift anywhere else.');
      } else {
        addFinding('rawColors', file, lineNumber, line, 'Prefer canonical CSS tokens over raw colors.');
      }
    }

    if (/transition\s*:\s*all\b/.test(line)) {
      addFinding('transitionAll', file, lineNumber, line, 'Use explicit transition properties.');
    }

    if ((ext === '.css' || ext === '.scss') && !isCssModule && /^\.(card|badge|btn-primary|btn-secondary|btn-danger|modal-overlay|status-badge|empty-state)(?=$|[\s.{:#,[>])/.test(line)) {
      addFinding('genericGlobals', file, lineNumber, line, 'Scope legacy component classes or migrate to shared ui primitives.');
    }

    if (/\b<button\b/.test(line) && !/aria-label=|aria-labelledby=|title=/.test(line)) {
      const looksIconOnly = /icon|close|toggle|menu|chevron|kebab|ellipsis|more|back|next|prev|delete|remove|trash/i.test(line);
      const hasInlineText = />\s*[A-Za-z0-9][^<]*<\/button>/.test(line);
      if (looksIconOnly && !hasInlineText) {
        addFinding('unlabeledIconButtons', file, lineNumber, line, 'Icon-only buttons need an accessible label.');
      }
    }
  });

  // Requires whitespace after the tag name, so a bare `<img>` written inside
  // prose is not treated as markup. Without this the checker reported three
  // "missing alt" failures in src/calendar/** that were all the literal string
  // "<img>" inside code comments explaining a past fix — every real <img> in
  // those files already carried alt. False positives are what stop a check
  // being made strict, so this is a prerequisite for enforcing it.
  const imgRegex = /<img\b\s[^>]*>/g;
  const sourceLines = source.split(/\r?\n/);
  let match;
  while ((match = imgRegex.exec(source))) {
    const tag = match[0];
    const lineNumber = lineNumberFor(source, match.index);
    const lineText = sourceLines[lineNumber - 1] || '';
    // Belt and braces: skip anything sitting on a comment line.
    if (/^\s*(\/\/|\*|\/\*)/.test(lineText)) continue;
    if (!/\salt=/.test(tag)) {
      addFinding('missingAlt', file, lineNumber, tag, 'Images need alt text. Use alt="" only for decorative images.');
    }
  }
}

function printBucket(title, items) {
  console.log(`\n${title}: ${items.length}`);
  for (const item of items.slice(0, maxSamples)) {
    console.log(`  ${item.file}:${item.lineNumber} - ${item.note}`);
    console.log(`    ${item.line}`);
  }
  if (items.length > maxSamples) {
    console.log(`  ... ${items.length - maxSamples} more`);
  }
}

for (const file of walk(srcDir)) scanFile(file);

console.log('UI consistency guardrail report');
printBucket('Raw color candidates', findings.rawColors);
printBucket('Token definitions with literal colours (advisory)', findings.tokenDefinitions);
printBucket('Generic global class selectors', findings.genericGlobals);
printBucket('transition: all declarations', findings.transitionAll);
printBucket('Images missing alt', findings.missingAlt);
printBucket('Possibly unlabeled icon buttons', findings.unlabeledIconButtons);

const total = Object.values(findings).reduce((sum, list) => sum + list.length, 0);
console.log(`\nTotal findings: ${total}`);

// ── Ratchet ──────────────────────────────────────────────────────────────────
// Flipping the whole repo strict in one move would mean fixing 180+ findings
// before anything else could merge, so nobody would do it and the check would
// stay advisory forever. Instead, paths that have been cleaned are enforced
// individually and the enforced set grows. A file listed here can never
// regress; everything else still reports.
const strictPaths = (process.env.UI_CONSISTENCY_STRICT_PATHS || '')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

if (strictPaths.length > 0) {
  // tokenDefinitions is advisory by design: a file that defines its own palette
  // (LandingPage.css and its --lp-* namespace, for instance) is doing the right
  // thing, and must not be blocked for it. Every other bucket is enforced.
  const enforcedBuckets = Object.entries(findings)
    .filter(([name]) => name !== 'tokenDefinitions')
    .map(([, list]) => list);

  const violations = enforcedBuckets
    .flat()
    .filter((item) => strictPaths.some((prefix) => item.file === prefix || item.file.startsWith(prefix)));

  console.log(`\nEnforced paths (${strictPaths.length}): ${strictPaths.join(', ')}`);

  if (violations.length > 0) {
    console.error(`\nUI consistency check FAILED: ${violations.length} finding(s) in enforced paths.`);
    for (const v of violations.slice(0, maxSamples)) {
      console.error(`  ${v.file}:${v.lineNumber} - ${v.note}`);
      console.error(`    ${v.line}`);
    }
    process.exit(1);
  }
  console.log('  clean — no findings in any enforced path.');
}

if (strict && total > 0) {
  console.error('UI consistency check failed in strict mode.');
  process.exit(1);
}

if (!strict && total > 0) {
  console.log(
    'Non-strict mode: findings outside enforced paths are reported without failing. '
    + 'Use UI_CONSISTENCY_STRICT_PATHS=a,b to enforce specific paths, or UI_CONSISTENCY_STRICT=1 for everything.'
  );
}
