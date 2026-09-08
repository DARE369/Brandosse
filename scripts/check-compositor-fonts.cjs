#!/usr/bin/env node
/**
 * check-compositor-fonts.cjs — the compositor draws real text, or refuses.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * A spike on 2026-09-02 established the exact failure mode this whole approach
 * had to survive: resvg, given an SVG containing text and NO font buffer,
 * renders **zero pixels and throws nothing**. `composite.ts:70-72` had already
 * documented it in passing ("rasterises without the text rather than failing").
 *
 * That is the third law's silent no-op in its purest form. The user is billed,
 * the response says success, and the graphic is blank where the headline should
 * be. Nothing downstream can tell.
 *
 * So the compositor is required to (a) always hand resvg real font bytes,
 * (b) count the ink it produced and refuse when text was requested and none
 * appeared, and (c) never quietly substitute a face. This asserts all three by
 * RENDERING, not by reading the source.
 *
 * ── It also asserts the contrast matrix ─────────────────────────────────────
 * Every template, against several palettes including deliberately hostile ones,
 * must end up with legible text. Contrast is the one thing here that is pure
 * arithmetic, so there is no excuse for shipping a combination that fails it.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { pathToFileURL } = require('node:url');
const { stripComments } = require('./lib/strip-comments.cjs');

const ROOT = process.cwd();
const SHARED = path.join(ROOT, 'supabase', 'functions', '_shared');

const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

// A real TTF to render with. Any font works — the mechanism is what is tested.
const FONT_CANDIDATES = [
  'C:/Windows/Fonts/georgia.ttf',
  'C:/Windows/Fonts/arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
];

function findFont() {
  return FONT_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
}

// ── 1. Static guarantees ─────────────────────────────────────────────────────

function checkSource() {
  const compositor = stripComments(fs.readFileSync(path.join(SHARED, 'designCompositor.ts'), 'utf8'));

  assert(
    /fontBuffers/.test(compositor),
    'The compositor must pass fontBuffers to resvg. Without them text renders as zero pixels.',
  );
  assert(
    /loadSystemFonts:\s*false/.test(compositor),
    'loadSystemFonts must stay FALSE. Whatever faces happen to exist on an edge host are not the '
    + "brand's, and allowing them makes output depend on which machine served the request.",
  );
  assert(
    /requestedSlots > 0 && ink === 0/.test(compositor),
    'The compositor must refuse when text was requested and the raster produced no ink. '
    + 'That is the exact silent-blank failure the spike demonstrated.',
  );
  assert(
    /CompositorUnavailableError/.test(compositor),
    'A compositor that cannot run must throw a typed error the caller can fall back from.',
  );

  const fonts = stripComments(fs.readFileSync(path.join(SHARED, 'fonts.ts'), 'utf8'));
  assert(
    /reason:/.test(fonts),
    'fonts.ts must return a stated reason on every failure path — a silent miss is what this guards against.',
  );
  assert(
    !/loadSystemFonts:\s*true/.test(fonts) && !/loadSystemFonts:\s*true/.test(compositor),
    'System fonts must never be enabled.',
  );

  const caller = stripComments(fs.readFileSync(
    path.join(ROOT, 'supabase', 'functions', 'generateImage', 'index.ts'), 'utf8'));
  assert(
    /catch\s*\([^)]*\)\s*\{[\s\S]{0,400}compose_failed/.test(caller),
    'generateImage must catch a compositor failure and continue — the render is already billed, so '
    + 'the user gets the plain background with a stated reason rather than an error.',
  );
  assert(
    /compose_error/.test(caller) && /compose_applied/.test(caller),
    'compose_applied and compose_error must reach the response and the generation metadata, or a '
    + 'compositor that quietly stopped running would look exactly like one never asked to run.',
  );
}

// ── 2. Behavioural: render and look at the pixels ────────────────────────────

function transpile(fontPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compositor-'));
  // Absolute file URLs: the temp dir sits outside the project, so a bare
  // specifier like 'imagescript' cannot be resolved from it.
  const imagescriptUrl = pathToFileURL(require.resolve('imagescript')).href;
  const resvgUrl = pathToFileURL(require.resolve('@resvg/resvg-wasm')).href;
  fs.writeFileSync(
    path.join(dir, 'shim-imagescript.mjs'),
    `export { Image } from ${JSON.stringify(imagescriptUrl)};\n`,
  );
  // resvg-wasm resolves to CommonJS here, which ESM cannot name-import.
  fs.writeFileSync(
    path.join(dir, 'shim-resvg.mjs'),
    `import pkg from ${JSON.stringify(resvgUrl)};\n`
    + 'export const { initWasm, Resvg } = pkg;\n',
  );

  // Stands in for the Google Fonts download. Same contract: bytes, or null with
  // a reason. "Missing Face" is deliberately unresolvable so the refusal path
  // can be exercised.
  fs.writeFileSync(path.join(dir, 'fonts.mjs'), `
import fs from 'node:fs';
const BYTES = new Uint8Array(fs.readFileSync(${JSON.stringify(fontPath)}));
export async function resolveFont(family) {
  if (!family || /missing/i.test(family)) {
    return { font: null, reason: \`"\${family}" is unavailable\` };
  }
  return { font: { family, variant: 'regular', bytes: BYTES, substituted: false }, reason: '' };
}
export function _resetFontCaches() {}
`);

  for (const name of ['brandDesign', 'fontMetrics', 'designTemplates', 'composite', 'designCompositor']) {
    let js = ts.transpileModule(fs.readFileSync(path.join(SHARED, `${name}.ts`), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    js = js
      .replace(/from\s+["']https:\/\/deno\.land\/x\/imagescript[^"']*["']/g, `from './shim-imagescript.mjs'`)
      .replace(/["']https:\/\/esm\.sh\/@resvg\/resvg-wasm@2\.6\.2["']/g, `'./shim-resvg.mjs'`)
      .replace(/from\s+["']\.\/(\w+)\.ts["']/g, `from './$1.mjs'`)
      .replace(/initWasm\(fetch\([^)]*\)\)/g, 'Promise.resolve()');
    fs.writeFileSync(path.join(dir, `${name}.mjs`), js);
  }
  return dir;
}

const PALETTES = {
  'dark brand': {
    background: { hex: '#0a2540' }, surface: { hex: '#123456' },
    text_primary: { hex: '#ffffff' }, text_secondary: { hex: '#c9d6e3' },
    accent: { hex: '#ff5a3c' }, cta_bg: { hex: '#ff5a3c' }, cta_text: { hex: '#ffffff' },
  },
  'light brand': {
    background: { hex: '#faf9f6' }, surface: { hex: '#ffffff' },
    text_primary: { hex: '#141414' }, text_secondary: { hex: '#4a4a4a' },
    accent: { hex: '#b3123c' }, cta_bg: { hex: '#b3123c' }, cta_text: { hex: '#ffffff' },
  },
  // Hostile on purpose: a brand whose own roles are illegible against each
  // other. The compositor must recolour rather than ship unreadable text.
  'hostile brand': {
    background: { hex: '#ffffff' }, surface: { hex: '#fefefe' },
    text_primary: { hex: '#f2f2f2' }, text_secondary: { hex: '#efefef' },
    accent: { hex: '#fdfdfd' }, cta_bg: { hex: '#ffffff' }, cta_text: { hex: '#fcfcfc' },
  },
};

const TEXT = {
  headline: 'Brewed slow, poured cold — small-batch hibiscus soda from Lagos',
  subhead: 'Fruit bought the same week it is pressed, never from concentrate.',
  cta: 'Order now',
  legal: 'Contains natural sugars.',
  contact: 'orikisoda.test · @orikisoda',
};

async function checkBehaviour(fontPath) {
  const { Image } = require('imagescript');
  const resvg = require('@resvg/resvg-wasm');
  await resvg.initWasm(fs.readFileSync(
    path.join(ROOT, 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm'),
  ));

  const dir = transpile(fontPath);
  try {
    const { compositeDesign, CompositorUnavailableError } =
      await import(pathToFileURL(path.join(dir, 'designCompositor.mjs')).href);
    const { DESIGN_TEMPLATES, backgroundDirectiveFor, pickTemplate } =
      await import(pathToFileURL(path.join(dir, 'designTemplates.mjs')).href);

    // A background with a bright blob, so the scrim path is actually exercised
    // rather than merely present.
    const makeBackground = async (w, h) => {
      const img = new Image(w, h);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const t = y / h;
          const dx = (x - w * 0.66) / (w * 0.22);
          const dy = (y - h * 0.72) / (h * 0.16);
          const blob = Math.max(0, 1 - (dx * dx + dy * dy));
          img.setPixelAt(x + 1, y + 1, Image.rgbaToColor(
            Math.min(255, 18 + t * 70 + blob * 210),
            Math.min(255, 34 + t * 60 + blob * 205),
            Math.min(255, 58 + t * 52 + blob * 190), 255));
        }
      }
      return new Uint8Array(await img.encodeJPEG(90));
    };

    const baseSquare = await makeBackground(720, 720);

    for (const [paletteName, colorRoles] of Object.entries(PALETTES)) {
      for (const template of DESIGN_TEMPLATES) {
        const design = {
          color_roles: colorRoles,
          type_scale: { display: { family: 'Test Display', weight: 700 }, body: { family: 'Test Body', weight: 400 } },
          layout_rules: { safe_margin_pct: 6 },
          logo_rules: { clear_space_ratio: 0.5, min_width_px: 48 },
        };

        let result;
        try {
          result = await compositeDesign({ baseImage: baseSquare, template, text: TEXT, design, logo: null });
        } catch (error) {
          failures.push(`${template.id} / ${paletteName}: threw — ${error.message}`);
          continue;
        }

        assert(
          result.inkPixels > 500,
          `${template.id} / ${paletteName}: rendered only ${result.inkPixels} ink pixels. Text was requested; `
          + 'a near-blank raster is the silent-blank failure.',
        );

        for (const entry of result.contrastReport) {
          assert(
            entry.ratio >= 4.5,
            `${template.id} / ${paletteName}: "${entry.slot}" ended at ${entry.ratio}:1 `
            + `(${entry.fill} on ${entry.ground}). Contrast is arithmetic — there is no excuse for shipping this.`,
          );
        }
      }
    }

    // The refusal path. An unresolvable font must THROW, never render blank.
    let refused = false;
    try {
      await compositeDesign({
        baseImage: baseSquare,
        template: DESIGN_TEMPLATES[0],
        text: { headline: 'Must not render' },
        design: {
          color_roles: PALETTES['dark brand'],
          type_scale: { display: { family: 'Missing Face' }, body: { family: 'Missing Face' } },
        },
        logo: null,
      });
    } catch (error) {
      refused = error instanceof CompositorUnavailableError
        || error.name === 'CompositorUnavailableError';
    }
    assert(
      refused,
      'An unresolvable font must throw CompositorUnavailableError. Rendering anyway produces a '
      + 'blank graphic that reports success — exactly what the spike showed resvg does.',
    );

    // Long copy must WRAP, not be capped. The word-count limit was the defect.
    const longResult = await compositeDesign({
      baseImage: baseSquare,
      template: DESIGN_TEMPLATES.find((t) => t.id === 'lower-third'),
      text: { headline: 'A deliberately long headline that would have been impossible under a seven word cap and must still be laid out legibly across several lines' },
      design: {
        color_roles: PALETTES['dark brand'],
        type_scale: { display: { family: 'Test Display', weight: 700 }, body: { family: 'Test Body' } },
      },
      logo: null,
    });
    assert(longResult.inkPixels > 500, 'A long headline must still render.');

    // Template rotation: sameness is a slop tell in its own right.
    const first = pickTemplate([]);
    const second = pickTemplate([first.id]);
    assert(
      second.id !== first.id,
      'pickTemplate must not return the layout just used — twelve posts with identical geometry '
      + 'read as automated even when each one is individually fine.',
    );

    // Every template's background directive must forbid text, several ways.
    for (const template of DESIGN_TEMPLATES) {
      const directive = backgroundDirectiveFor(template);
      assert(/NO text/i.test(directive), `${template.id}: background directive must forbid text.`);
      assert(
        (directive.match(/\bNO\b/g) || []).length >= 4,
        `${template.id}: the no-text rule must be stated several ways — image models treat a single `
        + 'negative as a weak preference, and one stray word defeats the whole approach.',
      );
      assert(
        /calm|uncluttered|open|simple|free of/i.test(directive),
        `${template.id}: the directive must tell the model which region to leave calm for the text.`,
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  checkSource();

  const fontPath = findFont();
  if (!fontPath) {
    console.log(
      '\x1b[33m⚠ check-compositor-fonts: static checks ran; RENDER checks SKIPPED\x1b[0m\n' +
      '  No system TTF was found to render with. This check is not fully passing — it did not run.',
    );
  } else {
    await checkBehaviour(fontPath);
  }

  if (failures.length > 0) {
    console.error('\n\x1b[31m✖ check-compositor-fonts FAILED\x1b[0m\n');
    for (const failure of failures) console.error(`  • ${failure}\n`);
    process.exit(1);
  }

  console.log(
    '\x1b[32m✔ check-compositor-fonts\x1b[0m  text renders from real font bytes, a missing font is ' +
    'refused rather than drawn blank, and every template × palette passes 4.5:1.',
  );
}

main().catch((err) => {
  console.error('✖ check-compositor-fonts crashed:', err);
  process.exit(1);
});
