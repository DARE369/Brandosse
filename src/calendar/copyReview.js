// src/calendar/copyReview.js
//
// The copy review report: a score taken of a post's text, and — once the post
// has published — frozen onto it permanently.
//
// ── Naming ──────────────────────────────────────────────────────────────────
// "Copy review", never "discovery" or "discoverability". LOCK L5.11: the score
// reads only the post's own text, has no external signal and cannot learn, so
// it must not be labelled as a prediction of reach. PostDetailDrawer already
// says "Copy review"; everything here follows it.
//
// ── The lifecycle, and where each half lives ────────────────────────────────
//   workflow_state.copy_review.snapshot — what the composer had scored when the
//       post was saved. Advisory, replaceable, and only trusted if the text it
//       scored is still the text on the row (see the fingerprint).
//   workflow_state.copy_review.final — written ONCE, after the post publishes,
//       by the finalize-copy-reviews worker. Never rewritten by anything. This
//       is the "at the point of publishing, these were the scores" record.
//
// If the snapshot still matches the published text, the worker promotes it
// without a second paid call. If the text changed after scoring, or was never
// scored, the worker scores it then.
//
// ── Why a fingerprint and not a timestamp ───────────────────────────────────
// A caption can be edited in the Calendar drawer between being scored in the
// composer and being published. A score only describes the text it read;
// attaching it to different text is a fabricated reading. The fingerprint is of
// the exact inputs scored — platform, caption, title, hashtags — and the server
// computes the same fingerprint of the row it published. The canonical form
// MUST match supabase/functions/_shared/copyReview.ts byte for byte;
// copy-review.test.mjs imports both and fails if they diverge.

export const COPY_REVIEW_VERSION = 1;

/** Every metric the scorer returns, in display order, with the words used for it. */
export const COPY_REVIEW_METRICS = [
  ['hookStrength', 'Hook strength'],
  ['readability', 'Readability'],
  ['platformFit', 'Platform fit'],
  ['keywordRelevance', 'Keyword relevance'],
  ['hashtagQuality', 'Hashtag quality'],
  ['ctaStrength', 'Call to action'],
  ['brandConsistency', 'Brand consistency'],
  ['visualCaptionAlignment', 'Matches the visual'],
  ['recommendationPotential', 'Recommendation potential'],
];

/**
 * The exact string a fingerprint is taken of.
 *
 * Normalises only what cannot change what the scorer reads: line endings,
 * surrounding whitespace, hashtag order and duplicates. Anything a reader would
 * notice — a changed word, a changed title — changes the string.
 */
export function canonicalCopyInputs({ platform, caption, title, hashtags } = {}) {
  const tags = (Array.isArray(hashtags) ? hashtags : [])
    .map((t) => String(t ?? '').trim())
    .filter(Boolean);
  return JSON.stringify([
    `v${COPY_REVIEW_VERSION}`,
    String(platform ?? '').trim().toLowerCase(),
    String(caption ?? '').replace(/\r\n?/g, '\n').trim(),
    String(title ?? '').replace(/\r\n?/g, '\n').trim(),
    [...new Set(tags)].sort(),
  ]);
}

/** SHA-256 of the canonical inputs, hex. Web Crypto — present in browsers, Node and Deno. */
export async function fingerprintCopyInputs(inputs) {
  const bytes = new TextEncoder().encode(canonicalCopyInputs(inputs));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The persisted shape of one scoring result. Only numbers the scorer actually
 * produced are kept as numbers; see measuredMetrics for how absence is shown.
 */
export function toStoredResult(scored) {
  return {
    overall: Number.isFinite(Number(scored?.score)) && scored?.score !== null ? Number(scored.score) : null,
    category: scored?.category || null,
    breakdown: (scored?.breakdown && typeof scored.breakdown === 'object') ? scored.breakdown : {},
    measured: Array.isArray(scored?.measured) ? scored.measured : null,
    suggestions: Array.isArray(scored?.suggestions) ? scored.suggestions.filter(Boolean) : [],
    benchmark_report: Array.isArray(scored?.benchmarkReport) ? scored.benchmarkReport : [],
    provider: scored?.provider || null,
    model: scored?.model || null,
  };
}

/**
 * The snapshot the composer attaches to a row, or null when there is nothing
 * honest to attach — never scored, scoring failed, or the score describes text
 * that is not what the row will carry.
 */
export async function buildSnapshot({ scored, scoredInputs, rowInputs, now = new Date() }) {
  if (!scored || scored.state !== 'scored') return null;
  if (scored.score === null || scored.score === undefined || !Number.isFinite(Number(scored.score))) return null;
  if (canonicalCopyInputs(scoredInputs) !== canonicalCopyInputs(rowInputs)) return null;
  return {
    version: COPY_REVIEW_VERSION,
    fingerprint: await fingerprintCopyInputs(rowInputs),
    scored_at: now.toISOString(),
    result: toStoredResult(scored),
  };
}

/**
 * One row per metric for display. A metric the scorer did not return is shown
 * as NOT MEASURED — never as 0. When `measured` is unknown (a score taken
 * before coverage was recorded), values are shown but flagged, because a zero
 * could then be either.
 */
export function measuredMetrics(result) {
  const breakdown = (result?.breakdown && typeof result.breakdown === 'object') ? result.breakdown : {};
  const measured = Array.isArray(result?.measured) ? new Set(result.measured) : null;
  return COPY_REVIEW_METRICS.map(([key, label]) => {
    const raw = breakdown[key];
    const hasNumber = raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw));
    const isMeasured = measured ? measured.has(key) && hasNumber : hasNumber;
    return {
      key,
      label,
      value: isMeasured ? Number(raw) : null,
      measured: isMeasured,
      coverageKnown: measured !== null,
    };
  });
}

/** Read the copy_review block off a post row without trusting its shape. */
export function readCopyReview(post) {
  const w = (post?.workflow_state && typeof post.workflow_state === 'object') ? post.workflow_state : {};
  const block = (w.copy_review && typeof w.copy_review === 'object') ? w.copy_review : {};
  const final = (block.final && typeof block.final === 'object') ? block.final : null;
  const snapshot = (block.snapshot && typeof block.snapshot === 'object') ? block.snapshot : null;
  return {
    snapshot,
    final,
    attempts: Number(block.final_attempts || 0) || 0,
    lastError: block.last_error || null,
  };
}

/**
 * How far back the finalize-copy-reviews worker looks for published posts.
 * MUST equal LOOKBACK_DAYS in supabase/functions/_shared/copyReview.ts —
 * copy-review.test.mjs asserts it. Past this, no report will ever be taken, so
 * the UI must stop saying one is coming.
 */
export const FINALIZE_LOOKBACK_DAYS = 7;

/**
 * How long after publishing a report is normally taken. The worker runs every
 * two minutes; past this, "being taken now" would be a claim the evidence no
 * longer supports.
 */
export const REPORT_EXPECTED_WITHIN_MINUTES = 30;

/**
 * The state of a post's frozen report, for the receipt and the details panel.
 *
 *   frozen         — a scored report exists and will not change.
 *   unavailable    — the worker tried and could not score; that too is frozen.
 *   pending        — published recently; the report is expected shortly.
 *   overdue        — published a while ago, still inside the window, no report.
 *                    Something is wrong with the job, and the UI says so.
 *   not_recorded   — published before the window (or before this existed);
 *                    no report will ever be taken, and the UI must not promise one.
 *   not_applicable — the post has not published, so there is no "at publish".
 *
 * `pending` used to be returned for EVERY published post without a report. A
 * post published five days earlier — before the worker existed — rendered
 * "Being taken now", and would have said so forever. Caught in a real browser.
 */
export function finalReportState(post, now = Date.now()) {
  const { final } = readCopyReview(post);
  const status = String(post?.status || '').toLowerCase();
  if (final?.state === 'scored' && final.result) return 'frozen';
  if (final?.state === 'unavailable') return 'unavailable';
  if (status !== 'published') return 'not_applicable';

  const publishedAt = Date.parse(post?.published_at || '');
  if (!Number.isFinite(publishedAt)) {
    // A published row with no publish time cannot be placed in the window, so
    // nothing can honestly be promised about it.
    return 'not_recorded';
  }
  const ageMs = now - publishedAt;
  if (ageMs > FINALIZE_LOOKBACK_DAYS * 86_400_000) return 'not_recorded';
  if (ageMs > REPORT_EXPECTED_WITHIN_MINUTES * 60_000) return 'overdue';
  return 'pending';
}
