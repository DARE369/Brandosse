#!/usr/bin/env node
/**
 * check-brand-provenance.cjs — the Brand Kit tells the truth about where each
 * value came from, and the design layer it measures actually reaches the user.
 *
 * ── Defect 1: a flag that could never fire ──────────────────────────────────
 * Three components each decided independently whether to show "AI inferred
 * this — please verify", and all three wrote the same broken condition:
 *
 *   confidence === 'low' || confidence === 'inferred'
 *
 * `extractBrandKit` has always returned NUMBERS (clampConfidence, 0.0–1.0). A
 * number never equals the string 'low'. The flag had never rendered, for any
 * field, for any user, in any environment — while the UI's copy promised it
 * did. That is the "UI stops lying" class of defect, three times over.
 *
 * ── Defect 2 this prevents: the harvester's work being thrown away ──────────
 * The site harvester measures colour roles, a type scale, a contact block and
 * social handles, and returns them as `design`. If any link in
 * extractBrandKit -> ExtractLoader -> store draft -> review-form save is
 * missing, all of it is discarded one step before the database and the user
 * sees a kit that quietly lost what was measured. This repo's dominant defect
 * is disconnection, so the chain is asserted rather than assumed.
 *
 * ── Defect 3 this prevents: two answers to one number ───────────────────────
 * WCAG contrast is implemented twice — once in the Deno edge module and once
 * for the browser, because the browser cannot import a `.ts` edge module. Both
 * copies are imported here and asserted to agree, so the Design tab cannot
 * tell a user their text passes while the renderer decides it fails.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { pathToFileURL } = require('node:url');
const { stripComments } = require('./lib/strip-comments.cjs');

const ROOT = process.cwd();
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ── 1. The string-comparison bug must not come back ──────────────────────────

const PROVENANCE_CONSUMERS = [
  'src/components/BrandKit/BrandKitReviewForm.jsx',
  'src/components/BrandKit/BrandKitLivePreview.jsx',
  'src/components/BrandKit/BrandKitDiffModal.jsx',
];

function checkNoStringConfidence() {
  for (const rel of PROVENANCE_CONSUMERS) {
    const source = stripComments(read(rel));

    // A confidence value compared to a quoted literal, in any of the shapes the
    // three broken copies used.
    const patterns = [
      /confidence\w*\s*===?\s*['"]/i,
      /\[\s*\w+\.key\s*\]\s*===?\s*['"](low|inferred|high|medium)['"]/i,
    ];
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match) {
        const line = source.slice(0, match.index).split(/\r?\n/).length;
        failures.push(
          `${rel}:${line} compares a confidence value to a string literal.\n` +
          `    ${match[0]}\n` +
          '    The extractor sends NUMBERS — this condition is always false, which is\n' +
          '    exactly how the "please verify" flag went unrendered for the product\'s\n' +
          '    whole life. Use fieldProvenance() from src/utils/brandProvenance.js.',
        );
      }
    }

    assert(
      /from '\.\.\/\.\.\/utils\/brandProvenance'/.test(source),
      `${rel} does not import brandProvenance — every component that shows provenance must share one implementation.`,
    );
  }
}

// ── 2. The design layer reaches the database ─────────────────────────────────

function checkDesignChain() {
  const edge = stripComments(read('supabase/functions/extractBrandKit/index.ts'));
  assert(
    /\bdesign,/.test(edge) && /buildDesignUpdate\(/.test(edge),
    'extractBrandKit must build the design layer via buildDesignUpdate and return it as `design`.',
  );

  const loader = stripComments(read('src/components/BrandKit/BrandKitExtractLoader.jsx'));
  assert(
    /data\?\.design/.test(loader),
    'BrandKitExtractLoader must read `design` off the extract response — otherwise every measured colour role is discarded at the first hop.',
  );
  assert(
    /setExtractedDraft\([^)]*design/s.test(loader),
    'BrandKitExtractLoader must pass `design` into setExtractedDraft.',
  );

  const store = stripComments(read('src/stores/BrandKitStore.js'));
  assert(
    /setExtractedDraft:\s*\([^)]*design/s.test(store),
    'BrandKitStore.setExtractedDraft must accept and keep `design`.',
  );
  assert(
    /design:\s*design\s*\|\|\s*null/.test(store),
    'BrandKitStore must store the design layer on the draft.',
  );
  assert(
    /diffData\?\.design/.test(store),
    'applyDiff must persist the design layer when the user accepts imported values.',
  );

  const form = stripComments(read('src/components/BrandKit/BrandKitReviewForm.jsx'));
  assert(
    /extractedDraft\?\.design/.test(form),
    'BrandKitReviewForm must include the draft design layer in its save payload — this is the last hop before the database.',
  );
  assert(
    /\.\.\.design,/.test(form),
    'BrandKitReviewForm must spread the design layer into the saved payload.',
  );
  // check-brand-design-writer exempts the review form from the single-writer
  // rule on the grounds that it normalises first. If it stops doing that, the
  // exemption becomes a hole, so the claim is asserted here rather than trusted.
  assert(
    /normalizeDesignForSave\(/.test(form),
    'BrandKitReviewForm must put form state through normalizeDesignForSave() before saving.\n'
    + '    Without it a user typing "#gg" into a colour role writes "#gg" to the database —\n'
    + '    the jsonb CHECK constraints only assert the column holds an object.',
  );

  const dashboard = stripComments(read('src/components/BrandKit/BrandKitDashboard.jsx'));
  assert(
    /extractionEvidence:/.test(dashboard) && /design:\s*data\?\.design/.test(dashboard),
    'The re-import flow must carry provenance and the design layer into the diff modal.',
  );

  const page = stripComments(read('src/pages/Settings/BrandKitPage.jsx'));
  assert(
    /newExtractionEvidence=\{diffData\.newExtractionEvidence\}/.test(page),
    'BrandKitPage must pass newExtractionEvidence to the diff modal, or every badge falls back to "inferred".',
  );
}

// ── 3. The Design tab exists and is reachable ────────────────────────────────

function checkDesignTab() {
  const form = read('src/components/BrandKit/BrandKitReviewForm.jsx');
  assert(/key:\s*'Design'/.test(form), 'The review form must register a Design tab.');
  assert(
    /activeTab === 'Design' && renderDesign\(\)/.test(form),
    'A registered tab that renders nothing is a dead nav item — Design must be wired to its renderer.',
  );
  for (const field of ['color_roles', 'type_scale', 'logo_rules', 'layout_rules', 'contact_block', 'social_handles', 'imagery_rules']) {
    assert(
      new RegExp(`${field}: normalizeObject`).test(form),
      `toFormState must initialise ${field}, or the Design tab edits a value that is dropped on save.`,
    );
  }
}

// ── 4. Behaviour of the shared helper ────────────────────────────────────────

async function checkBehaviour() {
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/utils/brandProvenance.js')).href);
  const { fieldProvenance, PROVENANCE, normalizeConfidence } = mod;

  // The exact case that was broken: a numeric confidence must produce a flag.
  const low = fieldProvenance('tagline', { confidenceMap: { tagline: 0.3 } });
  assert(
    low.needsReview === true && low.source === PROVENANCE.INFERRED,
    `A numeric low confidence must flag for review. Got ${JSON.stringify(low)}`,
  );

  const high = fieldProvenance('tagline', { confidenceMap: { tagline: 0.95 } });
  assert(high.needsReview === false, 'A high-confidence inference must not nag.');
  assert(high.source === PROVENANCE.INFERRED, 'A confidence number can only have come from the extractor.');

  // Measured values are facts. Flagging them would train people to ignore the
  // flag on the values that genuinely need it.
  const measured = fieldProvenance('color_palette', {
    confidenceMap: { color_palette: 0.99 },
    extractionEvidence: { color_palette: { source: 'measured', url: 'https://orikisoda.test/', confidence: 0.99 } },
  });
  assert(measured.source === PROVENANCE.MEASURED, 'An explicitly measured field must report as measured.');
  assert(measured.needsReview === false, 'A measured value must never be flagged for review.');
  assert(
    measured.description.includes('orikisoda.test'),
    `A measured field should say where it was read from. Got "${measured.description}"`,
  );

  const lowMeasured = fieldProvenance('color_palette', {
    extractionEvidence: { color_palette: { source: 'measured', url: '', confidence: 0.1 } },
  });
  assert(
    lowMeasured.needsReview === false,
    'Measured means read off the site. Even a low confidence number must not turn it into a guess.',
  );

  const typed = fieldProvenance('brand_name', {
    extractionEvidence: { brand_name: { source: 'user', url: '', confidence: 1 } },
  });
  assert(typed.needsReview === false, 'A value the user typed is not something to ask them to verify.');

  // Nothing known at all must stay silent rather than invent a warning.
  const unknown = fieldProvenance('industry', {});
  assert(
    unknown.source === null && unknown.needsReview === false && unknown.label === '',
    `An unknown field must produce no claim at all. Got ${JSON.stringify(unknown)}`,
  );

  // Legacy string confidences from older drafts must still work.
  assert(normalizeConfidence('low') !== null, 'Legacy string confidences must still resolve.');
  assert(
    fieldProvenance('tagline', { confidenceMap: { tagline: 'low' } }).needsReview === true,
    'A draft saved before the extractor returned numbers must not silently lose its flags.',
  );
  assert(normalizeConfidence(5) === 1 && normalizeConfidence(-2) === 0, 'Confidence must clamp to 0–1.');
  assert(normalizeConfidence('nonsense') === null, 'An unparseable confidence is null, not 0.');
}

// ── 5. One number, two implementations, same answer ──────────────────────────

async function checkContrastParity() {
  const browser = await import(pathToFileURL(path.join(ROOT, 'src/utils/wcagContrast.js')).href);

  const edgeSource = read('supabase/functions/_shared/brandDesign.ts');
  const output = ts.transpileModule(edgeSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contrast-'));
  try {
    const file = path.join(dir, 'brandDesign.mjs');
    fs.writeFileSync(file, output, 'utf8');
    const edge = await import(pathToFileURL(file).href);

    const pairs = [
      ['#000000', '#ffffff'],
      ['#ffffff', '#0a2540'],
      ['#767676', '#ffffff'],
      ['#ff5a3c', '#ffffff'],
      ['#1b1f24', '#f7f6f3'],
      ['#fdf6e3', '#0a2540'],
      ['#abc', '#fff'],
    ];
    for (const [fg, bg] of pairs) {
      const a = edge.contrastRatio(fg, bg);
      const b = browser.contrastRatio(fg, bg);
      assert(
        Math.abs(a - b) < 0.011,
        `Contrast implementations disagree on ${fg} over ${bg}: edge=${a}, browser=${b}. ` +
        'The Design tab and the renderer would give a user two different answers.',
      );
    }

    assert(
      edge.MIN_TEXT_CONTRAST === browser.MIN_TEXT_CONTRAST,
      `The AA threshold differs between edge (${edge.MIN_TEXT_CONTRAST}) and browser (${browser.MIN_TEXT_CONTRAST}).`,
    );

    // The browser copy must distinguish "cannot measure" from "fails".
    assert(
      browser.contrastRatio('not-a-colour', '#ffffff') === null,
      'An unparseable colour must return null, not a number — an unset role must not render as a failure the user did not cause.',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── 6. The two design normalisers agree on what is valid ────────────────────

async function checkDesignBoundsParity() {
  const client = await import(pathToFileURL(path.join(ROOT, 'src/utils/brandDesignClient.js')).href);
  const edgeSource = read('supabase/functions/_shared/brandDesign.ts');

  // Each bound appears in the edge module as `asNumber(source.x, default, min, max)`.
  for (const [key, [min, max]] of Object.entries(client.DESIGN_BOUNDS)) {
    if (key === 'weight') continue; // asserted separately below, different call shape
    // Escapes are doubled: this is a template literal, so `\(` would collapse to
    // a bare `(` and silently turn the pattern into a different regex.
    const pattern = new RegExp(
      `asNumber\\(\\s*(?:source|entry)\\.${key}\\s*,[^,]*,\\s*${min}\\s*,\\s*${max}\\s*\\)`,
    );
    assert(
      pattern.test(edgeSource),
      `Bound drift on "${key}": the browser normaliser clamps to [${min}, ${max}], but ` +
      'brandDesign.ts does not use the same range. The Design tab would accept a value ' +
      'the renderer rejects, or the reverse.',
    );
  }

  // Behavioural: an invalid hex is DROPPED, never corrected to a plausible colour.
  const cleaned = client.normalizeDesignForSave({
    color_roles: {
      background: { hex: '#FFF' },
      accent: { hex: 'banana' },
    },
    layout_rules: { safe_margin_pct: 90 },
    logo_rules: { clear_space_ratio: -5 },
    social_handles: { Instagram: 'orikisoda' },
    type_scale: { display: { weight: 700 } },
  });
  assert(cleaned.color_roles.background?.hex === '#ffffff', 'A shorthand hex must expand and lowercase.');
  assert(
    cleaned.color_roles.accent === undefined,
    'An unparseable hex must be DROPPED. Correcting it to black puts a colour in a brand that nobody chose.',
  );
  assert(cleaned.layout_rules.safe_margin_pct <= 25, 'safe_margin_pct must clamp.');
  assert(cleaned.logo_rules.clear_space_ratio >= 0, 'clear_space_ratio must clamp.');
  assert(cleaned.social_handles.instagram?.handle === '@orikisoda', 'Handles must normalise to a leading @ and a lowercase platform key.');
  assert(
    cleaned.type_scale.display === undefined,
    'A type role with a weight but no family cannot set a line and must be dropped.',
  );
}

async function main() {
  checkNoStringConfidence();
  checkDesignChain();
  checkDesignTab();
  await checkBehaviour();
  await checkContrastParity();
  await checkDesignBoundsParity();

  if (failures.length > 0) {
    console.error('\n\x1b[31m✖ check-brand-provenance FAILED\x1b[0m\n');
    for (const failure of failures) console.error(`  • ${failure}\n`);
    process.exit(1);
  }

  console.log(
    '\x1b[32m✔ check-brand-provenance\x1b[0m  provenance flags can actually fire, the design layer ' +
    'reaches the database, and both contrast implementations agree.',
  );
}

main().catch((err) => {
  console.error('✖ check-brand-provenance crashed:', err);
  process.exit(1);
});
