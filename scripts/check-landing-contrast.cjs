#!/usr/bin/env node
/**
 * check-landing-contrast.cjs — every colour in the LANDING page palette that is
 * used as text clears WCAG AA against the ground it actually sits on.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * On 2026-09-04 a Lighthouse run against the landing page reported ELEVEN
 * failing elements. `check-token-contrast.cjs` was green at the same moment,
 * and was right to be: it reads src/ui-v2/tokens.css and nothing else, while
 * src/pages/Landing/LandingPage.css defines its own self-contained `--lp-*`
 * palette and uses zero `--uiv2` tokens. The guard did not miss the defect —
 * it could not see the file. That is the more dangerous shape of the bug:
 * a green check that proves nothing about the surface in question.
 *
 * What was actually failing, on the page every visitor sees first:
 *   --lp-faint       #A3A6AB   2.44:1 on white   (footer, hero meta)
 *   --lp-muted-2     #85888E   3.15:1 on paper-2 (cost note, float head)
 *   --lp-accent-ink  #D9401C   4.28:1 on paper   (section eyebrows)
 *   #FFF on --lp-accent        3.07:1            (the PRIMARY CTA)
 *
 * The last one is the one that mattered commercially: the "Get started" button
 * was the least readable element on the page. It was also carrying a comment
 * claiming it was "at text contrast", which it was not — a doc disagreeing with
 * the code is a bug, so the comment now carries the measured number.
 *
 * ── What is asserted ────────────────────────────────────────────────────────
 * Each PAIR below is a foreground/background combination that genuinely occurs
 * in LandingPage.css, checked at the 4.5:1 normal-text floor. The landing page
 * commits to one light look and ignores the app theme, so there is one palette
 * to check rather than two.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SHEET = path.join(ROOT, 'src', 'pages', 'Landing', 'LandingPage.css');

/** WCAG 2.1 normal-text minimum. Large text (>=24px, or >=18.66px bold) may use 3:1. */
const AA_NORMAL = 4.5;

/**
 * Foreground/background pairs that really occur on the page. Adding a pair here
 * is how a new landing colour gets covered; removing one to make this pass is
 * how the guard becomes decoration.
 */
const PAIRS = [
  ['--lp-ink',        '--lp-paper',        'body copy on the page ground'],
  ['--lp-ink',        '--lp-paper-2',      'body copy on the alternate band'],
  ['--lp-ink',        '--lp-card',         'body copy on cards'],
  ['--lp-ink-2',      '--lp-paper',        'secondary copy on the page ground'],
  ['--lp-ink-2',      '--lp-card',         'secondary copy on cards'],
  ['--lp-muted',      '--lp-paper',        'muted copy on the page ground'],
  ['--lp-muted',      '--lp-paper-2',      'muted copy on the alternate band'],
  ['--lp-muted',      '--lp-card',         'muted copy on cards'],
  ['--lp-muted-2',    '--lp-paper',        'dimmer copy on the page ground'],
  ['--lp-muted-2',    '--lp-paper-2',      'cost note on the alternate band'],
  ['--lp-muted-2',    '--lp-card',         'float-head labels on cards'],
  ['--lp-faint',      '--lp-paper',        'hero meta on the page ground'],
  ['--lp-faint',      '--lp-card',         'footer mono labels on cards'],
  ['--lp-accent-ink', '--lp-paper',        'section eyebrows on the page ground'],
  ['--lp-accent-ink', '--lp-card',         'accent text on cards'],
  ['--lp-accent-on',  '--lp-accent',       'the PRIMARY CTA label'],
  ['--lp-accent-on',  '--lp-accent-press', 'the PRIMARY CTA label, hover state'],
];

function srgbToLinear(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Pull `--lp-*: #RRGGBB;` declarations out of the .lp-root block. */
function readPalette(css) {
  const start = css.indexOf('.lp-root {');
  if (start === -1) return null;
  const end = css.indexOf('}', start);
  if (end === -1) return null;
  const block = css.slice(start, end);
  const palette = {};
  const re = /(--lp-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  let m;
  while ((m = re.exec(block)) !== null) palette[m[1]] = m[2];
  return palette;
}

function main() {
  if (!fs.existsSync(SHEET)) {
    console.error(`\n\x1b[31m✖ check-landing-contrast FAILED\x1b[0m\n\n  • ${SHEET} does not exist.\n`);
    process.exit(1);
  }

  const css = fs.readFileSync(SHEET, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const palette = readPalette(css);
  const failures = [];

  if (!palette) {
    failures.push('Could not find the .lp-root block. The parser is broken, so this guard proves nothing.');
  } else if (Object.keys(palette).length < 12) {
    failures.push(
      `Only ${Object.keys(palette).length} --lp-* colours parsed out of .lp-root. The parser is `
      + 'probably not matching the block, which would make this guard decorative.',
    );
  }

  const checked = [];
  if (palette) {
    for (const [fgToken, bgToken, where] of PAIRS) {
      const fg = palette[fgToken];
      const bg = palette[bgToken];
      if (!fg || !bg) {
        failures.push(
          `${!fg ? fgToken : bgToken} is not defined in .lp-root, but this guard checks it `
          + `(${where}). Either the token was renamed and this list is stale, or it was deleted.`,
        );
        continue;
      }
      const ratio = contrast(fg, bg);
      checked.push({ fgToken, bgToken, ratio, where });
      if (ratio < AA_NORMAL) {
        failures.push(
          `${fgToken} (${fg}) on ${bgToken} (${bg}) is ${ratio.toFixed(2)}:1, below the `
          + `${AA_NORMAL}:1 normal-text floor. This is ${where}.`,
        );
      }
    }
  }

  if (checked.length < PAIRS.length) {
    failures.push(
      `Only ${checked.length} of ${PAIRS.length} declared pairs were actually measured.`,
    );
  }

  if (failures.length > 0) {
    console.error('\n\x1b[31m✖ check-landing-contrast FAILED\x1b[0m\n');
    for (const failure of failures) console.error(`  • ${failure}\n`);
    process.exit(1);
  }

  const worst = checked.reduce((a, b) => (a.ratio < b.ratio ? a : b));
  console.log(
    `\x1b[32m✔ check-landing-contrast\x1b[0m  ${checked.length} landing colour pairs clear `
    + `${AA_NORMAL}:1; tightest is ${worst.fgToken} on ${worst.bgToken} `
    + `(${worst.where}) at ${worst.ratio.toFixed(2)}:1.`,
  );
}

main();
