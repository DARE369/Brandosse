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
    grade: 'UNVERIFIED',
    source: 'Widely-cited community figure for the feed "… more" cut. Not published by Meta.',
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
  youtube: {
    chars: 157,
    grade: 'UNVERIFIED',
    source: 'Description collapses at roughly three lines above "Show more"; varies with viewport.',
  },
  facebook: {
    chars: 250,
    grade: 'UNVERIFIED',
    source: 'Feed "See more" cut. Meta publishes no figure and it varies by post type.',
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

  if (total <= fold.chars) {
    return { visible: text, hidden: '', folds: false, foldAt: fold.chars, grade: fold.grade, total };
  }

  return {
    visible: chars.slice(0, fold.chars).join(''),
    hidden: chars.slice(fold.chars).join(''),
    folds: true,
    foldAt: fold.chars,
    grade: fold.grade,
    total,
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
