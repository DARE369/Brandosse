/**
 * wcagContrast.js — WCAG 2.1 contrast, browser side.
 *
 * ── Why this is a separate file ─────────────────────────────────────────────
 * The same arithmetic lives in `supabase/functions/_shared/brandDesign.ts`,
 * which the browser cannot import: it is a Deno edge module with `.ts` import
 * specifiers. So there are necessarily two implementations.
 *
 * Two implementations of a number is how two answers appear. The Brand Kit's
 * Design tab tells a user their text passes at 4.6:1 while the renderer,
 * running the other copy, decides it fails and silently substitutes a colour —
 * and nobody can tell which was right.
 *
 * Keeping it here rather than inline in the component means
 * `scripts/check-brand-provenance.cjs` can import BOTH copies and assert they
 * agree on a fixed set of pairs. A duplicate that is checked is fine; a
 * duplicate that is merely believed is not.
 *
 * The threshold constant lives here too, for the same reason.
 */

/** WCAG AA for body text. Below this, text is not placed — it is fixed. */
export const MIN_TEXT_CONTRAST = 4.5;

function srgbChannel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance, or null when the colour cannot be parsed. */
export function relativeLuminance(hex) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!match) return null;
  let body = match[1].toLowerCase();
  if (body.length === 3) {
    body = `${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  }
  const n = parseInt(body, 16);
  return 0.2126 * srgbChannel((n >> 16) & 255)
    + 0.7152 * srgbChannel((n >> 8) & 255)
    + 0.0722 * srgbChannel(n & 255);
}

/**
 * Contrast ratio, 1–21, rounded to two decimals.
 *
 * Returns null — not 0, and not 1 — when either colour is unparseable, so a
 * caller cannot mistake "I could not measure this" for "this fails". An unset
 * role must render as unset, never as a failure the user did not cause.
 */
export function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  if (a === null || b === null) return null;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

export function passesTextContrast(foreground, background) {
  const ratio = contrastRatio(foreground, background);
  return ratio !== null && ratio >= MIN_TEXT_CONTRAST;
}
