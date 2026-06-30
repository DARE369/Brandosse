/**
 * clip-utils.js
 *
 * Shared utility functions for clip display components.
 * Imported by ClipListPanel, ClipPreviewPanel, PreviewModal, and ClipsGallery.
 */

/**
 * Normalises a score to the 0–100 integer range for display.
 *
 * The database stored scores on a 0–1 scale in earlier mock data (e.g. 0.85).
 * After Pack 1's real AI pipeline, scores are written as 0–100 integers (e.g. 85).
 * If the raw value is ≤ 1.0 it multiplies by 100; if already > 1.0 it rounds.
 * Returns null if the value is null, undefined, or not a number.
 */
export function normalizeScore(raw) {
  if (raw === null || raw === undefined) return null;
  const n = parseFloat(raw);
  if (isNaN(n)) return null;
  return n <= 1.0 ? Math.round(n * 100) : Math.round(n);
}

/**
 * Returns a CSS variable string for a 0–100 score.
 *   >= 80 : success (high virality)
 *   >= 50 : warning (moderate)
 *   < 50  : danger  (low)
 *   null  : text-tertiary (unknown / not yet calculated)
 */
export function scoreColor(score) {
  if (score === null || score === undefined) return "var(--color-text-tertiary)";
  if (score >= 80) return "var(--color-success)";
  if (score >= 50) return "var(--color-warning)";
  return "var(--color-danger)";
}

/**
 * Centralised score sub-bar colours keyed by dimension name.
 * Imported by ClipListPanel, ClipPreviewPanel, ClipsGallery, PreviewModal.
 */
export const SCORE_BAR_COLORS = {
  Hook:  "var(--color-primary)",
  Flow:  "var(--color-info)",
  Value: "var(--color-success)",
  Trend: "var(--color-warning)",
};

/**
 * Formats a duration in seconds to a human-readable string.
 *   0   → ""
 *   22  → "22s"
 *   65  → "1m 5s"
 *   120 → "2m"
 */
export function formatDuration(secs) {
  if (!secs || isNaN(secs)) return "";
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}
