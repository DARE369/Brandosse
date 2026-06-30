const fs = require('fs');
const path = require('path');

const root = process.cwd();
const srcDir = path.join(root, 'src');
const strict = process.env.UI_CONSISTENCY_STRICT === '1';
const extensions = new Set(['.css', '.scss', '.js', '.jsx', '.ts', '.tsx']);

const ignoredDirs = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);
const maxSamples = 18;

const findings = {
  rawColors: [],
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
  if (rel(file) === 'src/styles/tokens.css') return true;

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

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (/(^|[^-\w])#[0-9a-fA-F]{3,8}\b|rgba?\s*\(/.test(line) && !isAllowedRawColor(line, file)) {
      addFinding('rawColors', file, lineNumber, line, 'Prefer canonical CSS tokens over raw colors.');
    }

    if (/transition\s*:\s*all\b/.test(line)) {
      addFinding('transitionAll', file, lineNumber, line, 'Use explicit transition properties.');
    }

    if ((ext === '.css' || ext === '.scss') && /^\.(card|badge|btn-primary|btn-secondary|btn-danger|modal-overlay|status-badge|empty-state)(?=$|[\s.{:#,[>])/.test(line)) {
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

  const imgRegex = /<img\b[^>]*>/g;
  let match;
  while ((match = imgRegex.exec(source))) {
    const tag = match[0];
    if (!/\salt=/.test(tag)) {
      addFinding('missingAlt', file, lineNumberFor(source, match.index), tag, 'Images need alt text. Use alt="" only for decorative images.');
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
printBucket('Generic global class selectors', findings.genericGlobals);
printBucket('transition: all declarations', findings.transitionAll);
printBucket('Images missing alt', findings.missingAlt);
printBucket('Possibly unlabeled icon buttons', findings.unlabeledIconButtons);

const total = Object.values(findings).reduce((sum, list) => sum + list.length, 0);
console.log(`\nTotal findings: ${total}`);

if (strict && total > 0) {
  console.error('UI consistency check failed in strict mode.');
  process.exit(1);
}

if (!strict && total > 0) {
  console.log('Non-strict mode: findings are reported without failing. Use UI_CONSISTENCY_STRICT=1 to enforce.');
}
