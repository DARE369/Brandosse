/**
 * strip-comments.cjs — blank out comments in JS/TS source while preserving
 * every byte offset and line break.
 *
 * ── Why this is a state machine and not a regex ─────────────────────────────
 * Guards in this repo search source for patterns that must not appear. Two
 * things break the naive approaches:
 *
 *   • Scanning raw source means a pattern named in a COMMENT — including the
 *     comment explaining why the pattern is forbidden — trips the guard. Both
 *     check-outbound-fetch-guard and check-brand-version-hash hit this on their
 *     first run, flagging their own documentation.
 *
 *   • Stripping `//` to end-of-line with a regex destroys every string literal
 *     containing a URL, and this codebase is full of them
 *     ("https://api.anthropic.com/v1/messages"). That silently corrupts the
 *     very literals a guard may be relying on.
 *
 * So string and template states have to be tracked properly. Offsets are
 * preserved so a match index still maps to the right line number in the
 * ORIGINAL source, which is what gets printed to the developer.
 */

function stripComments(source) {
  const out = source.split('');
  let state = 'code';

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line'; out[i] = ' '; }
      else if (ch === '/' && next === '*') { state = 'block'; out[i] = ' '; }
      else if (ch === '"') state = 'double';
      else if (ch === "'") state = 'single';
      else if (ch === '`') state = 'template';
      continue;
    }

    if (state === 'line') {
      if (ch === '\n') state = 'code';
      else out[i] = ' ';
      continue;
    }

    if (state === 'block') {
      if (ch === '*' && next === '/') { out[i] = ' '; out[i + 1] = ' '; i += 1; state = 'code'; }
      else if (ch !== '\n') out[i] = ' ';
      continue;
    }

    // Inside a string literal: honour escapes so `\"` does not end it.
    if (ch === '\\') { i += 1; continue; }
    if (state === 'double' && ch === '"') state = 'code';
    else if (state === 'single' && ch === "'") state = 'code';
    else if (state === 'template' && ch === '`') state = 'code';
  }

  return out.join('');
}

module.exports = { stripComments };
