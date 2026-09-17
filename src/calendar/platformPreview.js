// src/calendar/platformPreview.js
//
// Where each platform cuts a caption, and what the reader sees before deciding
// whether to tap "more". Pure functions, no React, no chrome.
//
// ── What this is FOR, and what it deliberately is not ───────────────────────
// The value of a preview is showing WHERE THE CAPTION IS CUT. It is not
// imitating anyone's app. Platform chrome changes constantly and a pixel-copy
// rots into a lie about someone else's product; the fold moves far less often,
// and being wrong about it is the expensive kind of wrong — a hook buried past
// the fold is a post nobody reads.
//
// So: generic layout, exact truncation. A preview that is subtly wrong about
// spacing is tolerable. One that is wrong about the fold is worse than none.
// (LIBRARY-PUBLISH-IMPLEMENTATION-PLAN.md §2.4.)
//
// ── Two different limits, routinely confused ────────────────────────────────
//   * captionMax  — the HARD limit. Past it the platform, or our own adapter,
//                   refuses or truncates. Lives in platformCaptionSpecs.js,
//                   which mirrors the adapters, and is NOT duplicated here.
//   * foldChars   — the SOFT limit. The caption survives intact; the reader
//                   simply stops seeing it until they expand. This file owns
//                   only the second.
//
// Every fold below carries its source. They are observed UI behaviour rather
// than documented API values — no platform publishes them — so each is graded,
// and check-preview-fold-sources.cjs fails if an entry loses its provenance.
import { getPlatformSpec } from '../services/platforms/platformCaptionSpecs.js';

/**
 * Characters visible before each platform collapses the caption.
 *
 * `chars` is approximate BY NATURE — real clients wrap by pixel width, not by
 * character count, so a caption of wide characters folds sooner. Treated as a
 * guide and LABELLED as one in the UI, never presented as exact.
 *
 * grade:  MEASURED   — counted against the live product, date given.
 *         DOCS       — stated by the platform, or derived from a cited doc.
 *         UNVERIFIED — believed from secondary sources. Do not present as fact.
 */
export const PLATFORM_FOLD = {
  instagram: {
    chars: 125,
    // Cut after a whole word, never mid-word: every measured cut ended "…a word...".
    wordBoundary: true,
    grade: 'MEASURED',
    measured: {
      date: '2026-09-16',
      viewport: 'desktop 1366×900 and phone 390×844, instagram.com feed, signed in',
      samples: 16,
      tool: 'scripts/measure/measure-feed-folds.mjs',
    },
    source: 'Measured on 16 real posts in a signed-in feed: cut with "..." at a word boundary and '
      + 'never past 124 characters, on desktop and phone alike — the widely-cited 125 holds.',
    // Observed, not modelled: captions with early line breaks were cut at
    // 40–53 characters. The rule behind that was not clean enough to encode.
    note: 'Line breaks near the start can cut an Instagram caption sooner.',
  },
  linkedin: {
    chars: 140,
    grade: 'DOCS',
    // The SMALLER of the two figures is used deliberately: a hook that clears
    // the mobile fold clears both, and most reading is mobile.
    source: 'PLATFORM-PUBLISH-FIELDS.md §3 — ~140 mobile, ~210 desktop; mobile taken.',
  },
  tiktok: {
    chars: 100,
    grade: 'UNVERIFIED',
    source: 'Observed overlay truncation on the video player. TikTok publishes no figure.',
  },
  // LINE-based, and measured. The previous flat 157-character figure was wrong
  // in both directions: YouTube collapses the description to THREE RENDERED
  // LINES, and a line break consumes a line — so a description opening
  // "line ⏎ ⏎ line" folds after ~100 characters, while one unbroken paragraph
  // shows 300–420. A character count cannot express either.
  youtube: {
    lines: 3,
    // Conservative: the LOWEST full three-line capacity observed for a single
    // paragraph (299) rather than the highest (421). Wrap is by pixel width, so
    // a caption of wide glyphs folds sooner; erring early means a hook the
    // preview calls safe really is above the line.
    charsPerLine: 100,
    grade: 'MEASURED',
    measured: {
      date: '2026-09-16',
      viewport: 'desktop 1366×900, youtube.com watch page, logged out',
      samples: 5,
      tool: 'scripts/measure/measure-caption-fold.mjs',
    },
    source: 'Measured on real public videos: 3 rendered lines before "…more"; blank lines count; '
      + 'single paragraphs showed 299–421 visible characters. Desktop only.',
    // Mobile web was blocked by a consent sheet during measurement. The page
    // it rendered placed the description in a hidden element with a "more"
    // control beside the title — which suggests phones show NO description
    // before the tap. Recorded, not asserted.
    note: 'On phones YouTube may show only the title until "more" is tapped (not yet measured).',
  },
  facebook: {
    // The old 250 was a guess, and a generous one: a hook at character 200
    // looked safe in the preview and was hidden on every real feed.
    chars: 170,
    grade: 'MEASURED',
    measured: {
      date: '2026-09-16',
      viewport: 'desktop 1366×900 and phone 390×844, facebook.com feed, signed in',
      samples: 42,
      tool: 'scripts/measure/measure-feed-folds.mjs',
    },
    source: 'Measured on 42 real "See more" posts in a signed-in feed: a hard cut at exactly 170 '
      + 'characters, mid-word, on desktop (2 lines) and phone (4 lines) alike — a character limit, '
      + 'not a line limit.',
    note: 'Line breaks near the start can cut a Facebook caption sooner.',
  },
  pinterest: {
    chars: 50,
    grade: 'UNVERIFIED',
    source: 'Pin detail view truncates the description early.',
  },
  x: {
    chars: 280,
    grade: 'DOCS',
    source: 'The post limit IS the fold — nothing is hidden below it.',
  },
  twitter: {
    chars: 280,
    grade: 'DOCS',
    // Kept as a separate entry rather than an alias lookup because
    // platformCaptionSpecs.js carries both keys too, and a caller that resolved
    // one but not the other would silently lose the fold.
    source: 'Alias of x — the same 280-character post limit, with nothing hidden below it.',
  },
};

/** The fold for a platform, or null when there is no honest figure for it. */
export function foldFor(platform) {
  const key = String(platform || '').trim().toLowerCase();
  return PLATFORM_FOLD[key] || null;
}

/**
 * The most characters a fold can ever show, for either model — a flat `chars`
 * budget, or `lines × charsPerLine` for a single unbroken paragraph. Used to
 * check a fold never exceeds the platform's hard caption limit.
 */
export function foldCapacity(fold) {
  if (!fold) return null;
  if (Number.isFinite(fold.lines) && Number.isFinite(fold.charsPerLine)) return fold.lines * fold.charsPerLine;
  return Number.isFinite(fold.chars) ? fold.chars : null;
}

/**
 * Where a LINE-based fold cuts this particular caption, as a code-point index.
 *
 * Each paragraph (text between line breaks) takes ceil(length / charsPerLine)
 * rendered lines, and an empty paragraph still takes one — a blank line is a
 * line. The cut falls inside the first paragraph that does not fit.
 */
function lineFoldIndex(chars, { lines, charsPerLine }) {
  let linesLeft = lines;
  let index = 0;
  const total = chars.length;
  while (index < total && linesLeft > 0) {
    let end = index;
    while (end < total && chars[end] !== '\n') end += 1;
    const paragraphLength = end - index;
    const needed = Math.max(1, Math.ceil(paragraphLength / charsPerLine));
    if (needed > linesLeft) {
      return index + linesLeft * charsPerLine;
    }
    linesLeft -= needed;
    index = end < total ? end + 1 : end; // step past the line break itself
  }
  return index;
}

/**
 * Split a caption at the fold.
 *
 * Counts by CODE POINT, not by UTF-16 unit, so an emoji counts as one character
 * rather than two. `"🎉".length` is 2 in JavaScript, and using it would report
 * an emoji-heavy caption as folding sooner than it really does — an error that
 * grows with exactly the kind of caption this product generates.
 *
 * @returns {{visible:string, hidden:string, folds:boolean, foldAt:number|null,
 *            grade:string|null, total:number}}
 */
export function splitAtFold(caption, platform) {
  const text = String(caption ?? '');
  const chars = [...text];
  const total = chars.length;
  const fold = foldFor(platform);

  if (!fold) {
    // No honest figure. Say nothing rather than guess — an invented fold is
    // worse than no preview, because the user would act on it.
    return { visible: text, hidden: '', folds: false, foldAt: null, grade: null, total };
  }

  const model = Number.isFinite(fold.lines) ? 'lines' : 'chars';
  let cut = model === 'lines' ? lineFoldIndex(chars, fold) : fold.chars;

  // Some platforms never cut mid-word — Instagram ends its "..." after a whole
  // word, measured 2026-09-16 — so the visible part stops at the last space at
  // or before the limit. A caption with no space before the limit is still cut
  // hard, as the platform must do.
  if (model === 'chars' && fold.wordBoundary && total > cut) {
    let i = cut;
    while (i > 0 && !/\s/.test(chars[i])) i -= 1;
    if (i > 0) cut = i;
  }
  const extra = { model, lines: fold.lines ?? null, note: fold.note ?? null };

  // A trailing line break at the cut is not "hidden content" — only fold when
  // something a reader would see is actually below the line.
  const remainder = chars.slice(cut).join('');
  if (total <= cut || !remainder.trim()) {
    return { visible: text, hidden: '', folds: false, foldAt: model === 'lines' ? foldCapacity(fold) : fold.chars, grade: fold.grade, total, ...extra };
  }

  return {
    visible: chars.slice(0, cut).join(''),
    hidden: remainder,
    folds: true,
    foldAt: cut,
    grade: fold.grade,
    total,
    ...extra,
  };
}

/**
 * Everything one preview row needs, for one platform.
 *
 * Reports the HARD limit alongside the fold, taken from platformCaptionSpecs
 * (which mirrors the adapters) rather than from a second table here — two
 * tables of limits is how a counter drifts away from what the adapter actually
 * enforces, and the adapter REFUSES rather than truncating.
 */
export function previewFor({ platform, caption, hashtags }) {
  const spec = getPlatformSpec(platform);
  const tags = Array.isArray(hashtags)
    ? hashtags.map((t) => String(t || '').trim()).filter(Boolean).join(' ')
    : String(hashtags || '');

  // Preview what is actually SENT, joined the way the publisher joins it —
  // otherwise the fold is computed against a shorter string than the reader
  // will see, and hashtags are precisely what pushes a hook past the fold.
  const full = tags ? `${caption || ''}\n\n${tags}` : String(caption || '');
  const split = splitAtFold(full, platform);

  return {
    platform: String(platform || '').toLowerCase(),
    label: spec.label,
    ...split,
    captionMax: spec.captionMax,
    overHardLimit: split.total > spec.captionMax,
  };
}
