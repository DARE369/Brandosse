#!/usr/bin/env node
/**
 * check-token-contrast.cjs — every design token used as TEXT clears WCAG AA
 * against the surface it sits on, in both themes.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * `--uiv2-accent-text` was #E14E2F in light theme: 3.94:1 on white, below the
 * 4.5:1 floor for normal text. It is used 62 times as a text colour — calendar
 * status labels, empty-state links, active icon buttons — so every one of those
 * failed AA, in the default theme, for as long as the token existed.
 *
 * Nobody noticed because contrast is invisible to everyone who can already read
 * it. It was found on 2026-09-02 only because a design mockup had independently
 * darkened the same colour and the difference was worth checking.
 *
 * That is the whole argument for this file. Contrast is arithmetic: it can be
 * computed exactly, it never needs judgement, and a human reviewer will never
 * reliably catch a 3.94 that should be a 4.5. So it gets a guard, and the guard
 * runs on every push rather than when someone happens to wonder.
 *
 * ── What is asserted ────────────────────────────────────────────────────────
 * For each theme, every `--uiv2-*-text` token is checked against that theme's
 * page and surface backgrounds at the 4.5:1 normal-text floor.
 *
 * Tokens that are NOT body text are listed in EXCEPTIONS with the reason and
 * the rule that does apply — a token exempted without a reason is how a real
 * failure gets waved through.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const TOKENS = path.join(ROOT, 'src', 'ui-v2', 'tokens.css');

/** WCAG 2.1 normal-text minimum. Large text (>=24px, or >=19px bold) may use 3:1. */
const AA_NORMAL = 4.5;
/** Non-text UI (borders, icons, state indicators) must clear 3:1 — WCAG 1.4.11. */
const AA_NON_TEXT = 3;

/**
 * Tokens whose value is not normal body text, each with the rule that DOES
 * apply and why. Never add a token here to silence a genuine failure.
 */
const EXCEPTIONS = {
  // --uiv2-text-tertiary is deliberately NOT here. The first draft of this file
  // exempted it to the non-text floor on the grounds that it is "de-emphasised
  // metadata", which is not a rule WCAG has: 1.4.3 requires 4.5:1 for all normal
  // text, and this app sets tertiary at 11-12px. Writing the exemption was
  // easier than darkening the token, which is exactly how a guard becomes
  // decoration. Both themes were darkened instead.
  '--uiv2-text-disabled': {
    floor: 0,
    reason:
      'WCAG 1.4.3 explicitly exempts disabled controls. Low contrast is the AFFORDANCE here — '
      + 'making it compliant would stop it reading as disabled.',
  },
  '--uiv2-accent-on-solid-dark': {
    floor: 0,
    reason: 'Sits on --uiv2-accent-solid, not on a page background. Checked in the pairs below.',
  },
  '--uiv2-accent-on-solid-light': {
    floor: 0,
    reason: 'Sits on --uiv2-accent-solid, not on a page background. Checked in the pairs below.',
  },
  '--uiv2-accent-on-solid': {
    floor: 0,
    reason: 'Alias of the two above.',
  },
};

/** Foreground/background pairs that are real and not page-relative. */
const EXPLICIT_PAIRS = [
  ['--uiv2-accent-on-solid-dark', '--uiv2-accent-solid', 'dark', AA_NORMAL],
  ['--uiv2-accent-on-solid-light', '--uiv2-accent-solid', 'light', AA_NORMAL],
];

// ── Colour maths (WCAG 2.1) ──────────────────────────────────────────────────

function parseHex(value) {
  const match = String(value).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  let body = match[1].toLowerCase();
  if (body.length === 3) body = body.split('').map((c) => c + c).join('');
  const n = parseInt(body, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  if (a === null || b === null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Pull the declarations out of one selector block. A brace-depth walk rather
 * than a regex so a nested at-rule cannot silently truncate a theme.
 */
function blockFor(css, selector) {
  const start = css.indexOf(selector);
  if (start < 0) return null;
  const open = css.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}

function tokensIn(block) {
  const out = new Map();
  if (!block) return out;
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

/** Resolve var() indirection one level, which is all this file uses. */
function resolve(name, theme, base) {
  const raw = theme.get(name) ?? base.get(name);
  if (!raw) return null;
  const varMatch = raw.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/i);
  if (varMatch) return resolve(varMatch[1], theme, base);
  return parseHex(raw) ? raw.trim() : null;
}

const failures = [];
const checked = [];

function main() {
  if (!fs.existsSync(TOKENS)) {
    console.error(`✖ check-token-contrast: ${path.relative(ROOT, TOKENS)} not found`);
    process.exit(1);
  }
  const css = fs.readFileSync(TOKENS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');

  const base = tokensIn(blockFor(css, ':root'));
  const themes = {
    dark: tokensIn(blockFor(css, '[data-uiv2-theme="dark"]')),
    light: tokensIn(blockFor(css, '[data-uiv2-theme="light"]')),
  };

  for (const [name, block] of Object.entries(themes)) {
    if (!block || block.size === 0) {
      failures.push(`Could not parse the "${name}" theme block — the check would silently pass.`);
    }
  }

  for (const [themeName, theme] of Object.entries(themes)) {
    // The real ground tokens in this file. An earlier draft looked for
    // --uiv2-bg-page, which belongs to the OLD src/styles/tokens.css and does not
    // exist here — so only the surface was ever checked and the canvas, which is
    // darker/lighter and therefore the tighter test, was skipped entirely.
    const grounds = ['--uiv2-bg-canvas', '--uiv2-bg-surface', '--uiv2-bg-elevated']
      .map((token) => [token, resolve(token, theme, base)])
      .filter(([, hex]) => hex);

    if (grounds.length === 0) {
      failures.push(`No background tokens resolved for the ${themeName} theme.`);
      continue;
    }

    // Every token whose NAME says it is text.
    const textTokens = [...new Set([...theme.keys(), ...base.keys()])]
      .filter((name) => /-text$/.test(name) || /-text-/.test(name));

    for (const token of textTokens) {
      const hex = resolve(token, theme, base);
      if (!hex) continue;

      const exception = EXCEPTIONS[token];
      const floor = exception ? exception.floor : AA_NORMAL;
      if (floor === 0) continue;

      for (const [groundToken, groundHex] of grounds) {
        const ratio = contrast(hex, groundHex);
        if (ratio === null) continue;
        checked.push({ themeName, token, groundToken, ratio });

        if (ratio < floor) {
          failures.push(
            `${themeName}: ${token} (${hex}) on ${groundToken} (${groundHex}) is `
            + `${ratio.toFixed(2)}:1, below ${floor}:1.\n`
            + (exception
              ? `    This token is held to the non-text floor because: ${exception.reason}`
              : '    Contrast is arithmetic — a reviewer will never reliably catch this by eye. '
                + 'Darken the token, or add it to EXCEPTIONS with the rule that actually applies.'),
          );
        }
      }
    }
  }

  for (const [fgToken, bgToken, themeName, floor] of EXPLICIT_PAIRS) {
    const theme = themes[themeName];
    const fg = resolve(fgToken, theme, base);
    const bg = resolve(bgToken, theme, base);
    if (!fg || !bg) continue;
    const ratio = contrast(fg, bg);
    checked.push({ themeName, token: fgToken, groundToken: bgToken, ratio });
    if (ratio < floor) {
      failures.push(
        `${themeName}: ${fgToken} (${fg}) on ${bgToken} (${bg}) is ${ratio.toFixed(2)}:1, `
        + `below ${floor}:1. This is the text drawn on a solid accent button.`,
      );
    }
  }

  if (checked.length < 10) {
    failures.push(
      `Only ${checked.length} token pairs were checked. The parser is probably not finding the `
      + 'theme blocks, which would make this guard decorative.',
    );
  }

  if (failures.length > 0) {
    console.error('\n\x1b[31m✖ check-token-contrast FAILED\x1b[0m\n');
    for (const failure of failures) console.error(`  • ${failure}\n`);
    process.exit(1);
  }

  const worst = checked.reduce((a, b) => (a.ratio < b.ratio ? a : b));
  console.log(
    `\x1b[32m✔ check-token-contrast\x1b[0m  ${checked.length} token/background pairs across both `
    + `themes clear their floor; tightest is ${worst.token} on ${worst.groundToken} `
    + `(${worst.themeName}) at ${worst.ratio.toFixed(2)}:1.`,
  );
}

main();
