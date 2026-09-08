#!/usr/bin/env node
/**
 * check-font-metrics.cjs — measured text widths agree with what resvg draws.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 * `check-compositor-fonts.cjs` proves the compositor renders, refuses a missing
 * font, and clears 4.5:1. None of that checks whether the WIDTH numbers are
 * right — and every wrap, every shrink-to-fit, and the whole safe-area
 * guarantee is computed from `FontMetrics.measure()`.
 *
 * If those numbers are wrong the compositor confidently lays a headline off the
 * edge of the canvas, and each individual check above still passes. So this
 * measures against ground truth: render each string with the same engine the
 * compositor uses, find the real ink bounding box, compare.
 *
 * ── The specific property asserted ──────────────────────────────────────────
 * fontMetrics.ts sums advance widths and applies no kerning or ligatures. That
 * is safe ONLY because both make real text NARROWER — so predictions err wide,
 * wrapping a word early, which looks fine. Erring narrow overflows the box.
 *
 * That asymmetry is the justification for the whole approach, so it is asserted
 * rather than trusted. Measured 2026-09-02 over 4 faces x 2 sizes x 7 strings:
 * worst under-estimate -0.14% (sub-pixel), worst over-estimate +8.6% on
 * "AVATAR Wave To" — the heavy-kerning case, exactly as predicted.
 *
 * ── Also asserted: the silent-blank hazard ──────────────────────────────────
 * resvg renders text in a font it does not have as a BLANK image with no error.
 * The compositor's ink check exists for that. This proves the hazard is real, so
 * that check can never be dismissed as paranoia and deleted.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { pathToFileURL } = require('node:url');

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'supabase', 'functions', '_shared', 'fontMetrics.ts');

// Real fonts on whichever platform this runs. CI is ubuntu (DejaVu/Liberation
// ship with the runner image); development here is Windows.
const FONT_CANDIDATES = [
  ['Georgia', 'C:/Windows/Fonts/georgia.ttf'],
  ['Arial', 'C:/Windows/Fonts/arial.ttf'],
  ['Verdana', 'C:/Windows/Fonts/verdana.ttf'],
  ['Trebuchet MS', 'C:/Windows/Fonts/trebuc.ttf'],
  ['DejaVu Sans', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
  ['DejaVu Serif', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'],
  ['Liberation Sans', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'],
  ['Liberation Serif', '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf'],
];

const SAMPLES = [
  'Brewed slow, poured cold',
  'Hibiscus, ginger, and nothing else',
  'AVATAR Wave To',            // heavy kerning pairs — worst case for advance-only measurement
  'illiterate minimum',        // narrow glyphs
  'WOMBAT QUARTZ',             // wide caps
  'Small-batch sodas, Lagos',
  '50% off this weekend only',
];

// Predicting narrower than reality overflows the box. Sub-pixel tolerance only.
const MAX_UNDER_ESTIMATE_PCT = -1.5;
// Wide is safe, but wildly wide shrinks type for no reason. Kerning on a
// pathological string is worth about 9%.
const MAX_OVER_ESTIMATE_PCT = 15;

const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const escapeXml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inkBounds(rendered) {
  const { pixels, width, height } = rendered;
  let minX = width; let maxX = -1; let ink = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] > 40) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        ink += 1;
      }
    }
  }
  return { width: maxX < 0 ? 0 : maxX - minX + 1, ink };
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`✖ check-font-metrics: ${path.relative(ROOT, SOURCE)} not found`);
    process.exit(1);
  }

  let initWasm; let Resvg;
  try {
    ({ initWasm, Resvg } = require('@resvg/resvg-wasm'));
  } catch {
    console.error('✖ check-font-metrics: @resvg/resvg-wasm is not installed. Run `npm ci`.');
    process.exit(1);
  }
  await initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));

  // Transpile the real module — no reimplementation, so it cannot drift from
  // what actually ships.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fontmetrics-'));
  const outFile = path.join(dir, 'fontMetrics.mjs');
  fs.writeFileSync(outFile, ts.transpileModule(fs.readFileSync(SOURCE, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText, 'utf8');

  try {
    const { parseFontMetrics, FontParseError } = await import(pathToFileURL(outFile).href);

    const available = FONT_CANDIDATES.filter(([, file]) => fs.existsSync(file));
    if (available.length === 0) {
      console.error(
        '✖ check-font-metrics: no test font found on this machine.\n' +
        `  Looked for:\n${FONT_CANDIDATES.map(([, f]) => `    ${f}`).join('\n')}\n` +
        '  Not skipped: a measurement check that measures nothing would pass forever.',
      );
      process.exit(1);
    }

    let cases = 0;
    let worstUnder = 0;
    let worstOver = 0;
    let worstOverLabel = '';

    for (const [family, file] of available) {
      const buffer = fs.readFileSync(file);

      let metrics;
      try {
        metrics = parseFontMetrics(new Uint8Array(buffer));
      } catch (error) {
        failures.push(`parseFontMetrics threw for ${family} (${file}), a real valid font: ${error.message}`);
        continue;
      }

      if (!(metrics.unitsPerEm > 0)) {
        failures.push(`${family}: unitsPerEm is ${metrics.unitsPerEm}; the head table parse is wrong.`);
        continue;
      }
      if (!(metrics.ascent > 0 && metrics.descent < 0)) {
        failures.push(
          `${family}: ascent must be positive and descent negative; got ${metrics.ascent}/${metrics.descent}. `
          + 'Baseline placement is computed from these, so a sign error puts every line in the wrong place.',
        );
      }
      if (!(metrics.advanceOf('A'.codePointAt(0)) > 0)) {
        failures.push(`${family}: advanceOf('A') returned ${metrics.advanceOf(65)}; the cmap/hmtx parse is wrong.`);
      }

      for (const size of [32, 64]) {
        for (const text of SAMPLES) {
          const predicted = metrics.measure(text, size);
          const svg =
            `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="200">`
            + `<text x="20" y="140" font-family="${escapeXml(family)}" font-size="${size}" fill="#000">`
            + `${escapeXml(text)}</text></svg>`;

          const rendered = new Resvg(svg, {
            fitTo: { mode: 'original' },
            font: { fontBuffers: [buffer], defaultFontFamily: family, loadSystemFonts: false },
          }).render();

          const { width: actual, ink } = inkBounds(rendered);
          if (ink === 0) {
            failures.push(`${family} @ ${size}px rendered NOTHING for "${text}" — the font buffer was not applied.`);
            continue;
          }

          const deltaPct = ((predicted - actual) / actual) * 100;
          cases += 1;
          if (deltaPct < worstUnder) worstUnder = deltaPct;
          if (deltaPct > worstOver) { worstOver = deltaPct; worstOverLabel = `${family} "${text}"`; }

          if (deltaPct < MAX_UNDER_ESTIMATE_PCT) {
            failures.push(
              `UNDER-ESTIMATE ${deltaPct.toFixed(2)}% — ${family} @ ${size}px "${text}" `
              + `(predicted ${predicted.toFixed(1)}px, actually drew ${actual}px).\n`
              + '    Predicting narrower than reality means wrapped text overflows its box. This is the '
              + 'one direction the measurement is not allowed to be wrong in.',
            );
          }
          if (deltaPct > MAX_OVER_ESTIMATE_PCT) {
            failures.push(
              `OVER-ESTIMATE ${deltaPct.toFixed(2)}% — ${family} @ ${size}px "${text}". Wide is safe, but this `
              + 'is far enough out to shrink type for no reason; the advance table is probably misread.',
            );
          }
        }
      }

      // Measurement must scale linearly with size — the compositor's
      // shrink-to-fit loop assumes it.
      const atThirty = metrics.measure('Brewed slow', 30);
      const atSixty = metrics.measure('Brewed slow', 60);
      if (Math.abs(atSixty - atThirty * 2) > 0.5) {
        failures.push(`${family}: measure() is not linear in font size (${atThirty} at 30px vs ${atSixty} at 60px).`);
      }
      if (metrics.measure('', 48) !== 0) {
        failures.push(`${family}: an empty string must measure 0, got ${metrics.measure('', 48)}.`);
      }

      // Scripts whose rendered width depends on shaping must be flagged, since
      // an advance-width sum genuinely cannot predict them.
      if (typeof metrics.isReliable === 'function') {
        if (metrics.isReliable('مرحبا بالعالم')) {
          failures.push(
            `${family}: isReliable() returned true for Arabic. Advance widths cannot express `
            + 'shaping, so the caller is never told to widen its margin and the text overflows.',
          );
        }
        if (!metrics.isReliable('Brewed slow')) {
          failures.push(`${family}: isReliable() returned false for plain Latin text.`);
        }
      }
    }

    // Garbage bytes must be refused, not silently treated as a font.
    try {
      parseFontMetrics(new Uint8Array(2048).fill(0x41));
      failures.push(
        'parseFontMetrics accepted 2KB of the letter "A" as a font. Unusable bytes reaching resvg '
        + 'render as nothing at all, which is the silent-blank failure.',
      );
    } catch (error) {
      if (FontParseError && !(error instanceof FontParseError) && error.name !== 'FontParseError') {
        failures.push(`Garbage bytes threw ${error.name}, not FontParseError.`);
      }
    }

    // The hazard the compositor's ink check exists for.
    const blank = new Resvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200">'
      + '<text x="20" y="120" font-size="48" fill="#000">Brewed slow</text></svg>',
      { fitTo: { mode: 'original' }, font: { fontBuffers: [], loadSystemFonts: false } },
    ).render();
    if (inkBounds(blank).ink !== 0) {
      failures.push(
        'Rendering text with NO fonts produced ink. The compositor\'s ink check is written against '
        + 'the opposite behaviour — re-check it.',
      );
    }

    if (failures.length === 0) {
      console.log(
        `\x1b[32m✔ check-font-metrics\x1b[0m  ${cases} measurements across ${available.length} real font(s) `
        + `match rendered ink; worst under-estimate ${worstUnder.toFixed(2)}% (limit ${MAX_UNDER_ESTIMATE_PCT}%), `
        + `worst over-estimate +${worstOver.toFixed(2)}% (${worstOverLabel}); missing fonts confirmed to render `
        + 'blank without error.',
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error('\n\x1b[31m✖ check-font-metrics FAILED\x1b[0m\n');
    for (const failure of failures) console.error(`  • ${failure}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('✖ check-font-metrics crashed:', err);
  process.exit(1);
});
