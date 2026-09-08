#!/usr/bin/env node
/**
 * check-brand-design-writer.cjs — the brand-kit design layer has exactly one
 * writer, and that writer's colour arithmetic is correct.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * The design columns (migration 20260901120000) are jsonb. The database checks
 * that each holds an object; it cannot check that the object means anything.
 * `{"backgroundd": "blue"}` satisfies every constraint and produces a graphic
 * with no background colour.
 *
 * This repo's dominant defect is disconnection — five separate surfaces were
 * found holding live brand data no consumer read. A second writer for these
 * columns is how that happens again: two code paths, one of them subtly wrong,
 * and no way to tell which produced a given row.
 *
 * ── What this asserts ───────────────────────────────────────────────────────
 *  1. EXCLUSIVITY — only _shared/brandDesign.ts writes these column names as
 *     object keys. Reading them (`kit.color_roles`) is fine and common; writing
 *     them (`color_roles:`) outside the normaliser is not. Callers compose a
 *     payload with toBrandDesignUpdate() instead.
 *  2. SCHEMA AGREEMENT — BRAND_DESIGN_COLUMNS matches the columns the migration
 *     actually creates, so a rename cannot leave the normaliser writing to a
 *     column that no longer exists.
 *  3. BEHAVIOUR — the WCAG contrast maths is right, and the normaliser drops
 *     values it cannot vouch for rather than inventing them. A normaliser that
 *     silently substitutes a plausible colour is worse than none.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { pathToFileURL } = require('node:url');
const { stripComments } = require('./lib/strip-comments.cjs');

const ROOT = process.cwd();
const NORMALIZER = path.join(ROOT, 'supabase', 'functions', '_shared', 'brandDesign.ts');
const MIGRATION = path.join(ROOT, 'supabase', 'migrations', '20260901120000_brand_kit_design_layer.sql');

const DESIGN_COLUMNS = [
  'color_roles',
  'contrast_pairs',
  'type_scale',
  'logo_rules',
  'layout_rules',
  'contact_block',
  'social_handles',
  'required_marks',
  'imagery_rules',
  'extraction_evidence',
];

// Only these files may write the column names as object keys.
const ALLOWED_WRITERS = [
  'supabase/functions/_shared/brandDesign.ts',
  // The browser's normaliser. The Design tab saves straight to Supabase with no
  // server hop, so it cannot use the edge module (Deno, .ts specifiers). This is
  // the ONE browser-side writer, and check-brand-provenance.cjs asserts its
  // bounds match the edge module's so the two cannot disagree about what is valid.
  'src/utils/brandDesignClient.js',
];

/**
 * Files that legitimately name a design column as an object key WITHOUT
 * building a database payload from it. Kept separate from ALLOWED_WRITERS so
 * "may write this column" and "happens to mention it" never blur together —
 * adding a file here must never be a way to get a real writer past the check.
 */
const NON_WRITER_MENTIONS = [
  {
    file: 'src/components/BrandKit/BrandKitReviewForm.jsx',
    reason:
      'The Design tab names these columns to build React FORM STATE and to render '
      + 'editors. It never writes them raw: saveNow() puts the form through '
      + 'normalizeDesignForSave() first, which check-brand-provenance.cjs asserts.',
  },
  {
    file: 'src/utils/brandKitHash.js',
    reason:
      'HASH_EXCLUDED_FIELDS maps each excluded column to the REASON it is excluded. '
      + 'The keys are documentation of a decision, not a payload — this file never '
      + 'touches the database.',
  },
];

const SCAN_DIRS = [
  path.join(ROOT, 'supabase', 'functions'),
  path.join(ROOT, 'src'),
  path.join(ROOT, 'app'),
];

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

const failures = [];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

// ── 1. Exclusivity ───────────────────────────────────────────────────────────

function checkExclusivity() {
  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (ALLOWED_WRITERS.includes(rel)) continue;
      if (NON_WRITER_MENTIONS.some((entry) => entry.file === rel)) continue;

      const source = stripComments(fs.readFileSync(file, 'utf8'));
      const lines = source.split(/\r?\n/);

      for (const column of DESIGN_COLUMNS) {
        // `color_roles:` as an object key or type member. Not `kit.color_roles`
        // (a read) and not `'color_roles'` (a name in a list).
        const re = new RegExp(`(?<![\\w.$'"\`])${column}\\s*:`, 'g');
        let match;
        while ((match = re.exec(source)) !== null) {
          const lineNumber = source.slice(0, match.index).split(/\r?\n/).length;
          failures.push(
            `${rel}:${lineNumber} writes "${column}" directly.\n` +
            `    ${(lines[lineNumber - 1] || '').trim()}\n` +
            '    Build the payload with toBrandDesignUpdate() from _shared/brandDesign.ts instead —\n' +
            '    a second writer for these columns is how the shape drifts.',
          );
        }
      }
    }
  }
}

// ── 2. Schema agreement ──────────────────────────────────────────────────────

function checkSchemaAgreement(moduleColumns) {
  if (!fs.existsSync(MIGRATION)) {
    failures.push(`Migration not found: ${path.relative(ROOT, MIGRATION)}`);
    return;
  }
  const sql = fs.readFileSync(MIGRATION, 'utf8');

  for (const column of DESIGN_COLUMNS) {
    if (!new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${column}\\b`).test(sql)) {
      failures.push(
        `"${column}" is treated as a design column here but the migration never adds it. ` +
        'The normaliser would be writing to a column that does not exist.',
      );
    }
  }

  const declared = Array.isArray(moduleColumns) ? [...moduleColumns].sort() : [];
  const expected = [...DESIGN_COLUMNS].sort();
  if (declared.join(',') !== expected.join(',')) {
    failures.push(
      'BRAND_DESIGN_COLUMNS in brandDesign.ts does not match the design columns.\n' +
      `    module:   ${declared.join(', ') || '(none)'}\n` +
      `    expected: ${expected.join(', ')}`,
    );
  }
}

// ── 3. Behaviour ─────────────────────────────────────────────────────────────

function transpile() {
  const output = ts.transpileModule(fs.readFileSync(NORMALIZER, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'branddesign-'));
  const file = path.join(dir, 'brandDesign.mjs');
  fs.writeFileSync(file, output, 'utf8');
  return { file, dir };
}

function approx(a, b, tolerance = 0.05) {
  return Math.abs(a - b) <= tolerance;
}

async function checkBehaviour() {
  const { file, dir } = transpile();
  try {
    const m = await import(pathToFileURL(file).href);

    // -- WCAG contrast maths. These are the published reference values; if
    //    these drift, every contrast decision downstream is wrong.
    if (m.contrastRatio('#000000', '#ffffff') !== 21) {
      failures.push(`contrastRatio(black, white) must be 21, got ${m.contrastRatio('#000000', '#ffffff')}`);
    }
    if (m.contrastRatio('#ffffff', '#ffffff') !== 1) {
      failures.push(`contrastRatio(white, white) must be 1, got ${m.contrastRatio('#ffffff', '#ffffff')}`);
    }
    // #767676 on white is the canonical "exactly passes AA" grey (4.54:1).
    if (!approx(m.contrastRatio('#767676', '#ffffff'), 4.54, 0.06)) {
      failures.push(`contrastRatio(#767676, white) should be ~4.54, got ${m.contrastRatio('#767676', '#ffffff')}`);
    }
    if (m.contrastRatio('not-a-hex', '#ffffff') !== 0) {
      failures.push('contrastRatio must return 0 for an unparseable colour, not a plausible number.');
    }
    if (m.wcagLevel(4.6) !== 'AA' || m.wcagLevel(7.5) !== 'AAA' || m.wcagLevel(2) !== 'fail') {
      failures.push('wcagLevel thresholds are wrong (expected >=7 AAA, >=4.5 AA, <3 fail).');
    }

    // -- Hex normalisation
    if (m.normalizeHex('#ABC') !== '#aabbcc') {
      failures.push(`normalizeHex('#ABC') must expand to '#aabbcc', got '${m.normalizeHex('#ABC')}'`);
    }
    if (m.normalizeHex('rgb(1,2,3)') !== '' || m.normalizeHex('#12345') !== '') {
      failures.push('normalizeHex must return "" for anything that is not a 3/6-digit hex.');
    }

    // -- The normaliser must DROP what it cannot vouch for, never invent it.
    const roles = m.normalizeColorRoles({
      background: { hex: '#ffffff', name: 'Paper', source: 'measured' },
      text_primary: { hex: '#111111', source: 'measured' },
      accent: { hex: 'not a colour', name: 'Brand Blue' },
    });
    if (roles.accent !== undefined) {
      failures.push('A role with an unparseable hex must be DROPPED. Inventing a colour here is how a brand silently acquires one.');
    }
    if (!roles.background || roles.background.hex !== '#ffffff') {
      failures.push('A valid role was lost during normalisation.');
    }
    if (!roles.text_primary || !approx(roles.text_primary.contrast_vs_background, 18.88, 0.5)) {
      failures.push(
        'contrast_vs_background must be computed against the background role, got ' +
        `${roles.text_primary && roles.text_primary.contrast_vs_background}`,
      );
    }
    if (roles.text_primary && roles.text_primary.source !== 'measured') {
      failures.push('An explicit source must be preserved, not overwritten.');
    }
    // An absent source must default to the CAUTIOUS value, not the confident one.
    const unsourced = m.normalizeColorRoles({ background: { hex: '#ffffff' } });
    if (unsourced.background.source !== 'inferred') {
      failures.push(
        `A role with no stated source must default to "inferred", got "${unsourced.background.source}". ` +
        'Defaulting to "measured" would label a guess as a fact.',
      );
    }

    // -- Contrast pairs are computed, never accepted from input.
    const pairs = m.buildContrastPairs(roles);
    if (!pairs.some((p) => p.fg === '#111111' && p.bg === '#ffffff' && p.wcag === 'AAA')) {
      failures.push('buildContrastPairs did not produce the text_primary/background pair.');
    }

    // -- Illegible combinations must be reported at render time.
    const bad = m.normalizeColorRoles({
      background: { hex: '#ffffff' },
      text_primary: { hex: '#f0f0f0' },
    });
    const failing = m.failingTextRoles(bad);
    if (!failing.some((f) => f.fg === 'text_primary')) {
      failures.push('failingTextRoles must flag #f0f0f0 text on a white background (1.1:1).');
    }
    if (m.failingTextRoles(roles).length !== 0) {
      failures.push('failingTextRoles flagged a legible pair.');
    }

    // -- Defaults must be real values a renderer can use, not zeros.
    const layout = m.normalizeLayoutRules({});
    if (!(layout.safe_margin_pct > 0 && layout.grid >= 2 && layout.text_max_lines >= 1)) {
      failures.push('normalizeLayoutRules({}) must return usable defaults, not zeros.');
    }
    if (m.normalizeLayoutRules({ safe_margin_pct: 90 }).safe_margin_pct > 25) {
      failures.push('safe_margin_pct must be clamped — past ~25% there is no canvas left to design on.');
    }
    if (m.normalizeTypeScale({ min_body_px: 4 }).min_body_px < 12) {
      failures.push('min_body_px must be clamped to a legibility floor of 12px.');
    }
    if (m.normalizeTypeScale({ display: { weight: 400 } }).display !== undefined) {
      failures.push('A type role with no family must be dropped — a weight alone cannot set a line.');
    }

    // -- Handles normalise to a single form so the compositor never has to guess.
    const handles = m.normalizeSocialHandles({ Instagram: 'orikisoda', x: { handle: '@oriki' } });
    if (handles.instagram?.handle !== '@orikisoda' || handles.x?.handle !== '@oriki') {
      failures.push(`Social handles must normalise to a leading @ and lowercase platform key, got ${JSON.stringify(handles)}`);
    }

    // -- The update payload writes every design column and nothing else.
    const payload = m.toBrandDesignUpdate(m.normalizeBrandDesign({}));
    const payloadKeys = Object.keys(payload).sort();
    if (payloadKeys.join(',') !== [...DESIGN_COLUMNS].sort().join(',')) {
      failures.push(
        'toBrandDesignUpdate must write exactly the design columns.\n' +
        `    got:      ${payloadKeys.join(', ')}\n` +
        `    expected: ${[...DESIGN_COLUMNS].sort().join(', ')}`,
      );
    }

    return m.BRAND_DESIGN_COLUMNS;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  if (!fs.existsSync(NORMALIZER)) {
    console.error(`✖ check-brand-design-writer: ${path.relative(ROOT, NORMALIZER)} not found`);
    process.exit(1);
  }

  checkExclusivity();
  const moduleColumns = await checkBehaviour();
  checkSchemaAgreement(moduleColumns);

  if (failures.length > 0) {
    console.error('\n\x1b[31m✖ check-brand-design-writer FAILED\x1b[0m\n');
    for (const failure of failures) console.error(`  • ${failure}\n`);
    process.exit(1);
  }

  console.log(
    `\x1b[32m✔ check-brand-design-writer\x1b[0m  ${DESIGN_COLUMNS.length} design columns have exactly one ` +
    'writer, agree with the migration, and the contrast maths is correct.',
  );
}

main().catch((err) => {
  console.error('✖ check-brand-design-writer crashed:', err);
  process.exit(1);
});
