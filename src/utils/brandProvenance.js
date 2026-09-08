/**
 * brandProvenance.js — where a brand-kit field's value came from, in one place.
 *
 * ── The defect this fixes ───────────────────────────────────────────────────
 * Three separate components each decided independently whether to show a
 * "Review this — AI inferred it" flag, and all three did it the same wrong way:
 *
 *   BrandKitReviewForm.jsx:253   confidence === 'low' || confidence === 'inferred'
 *   BrandKitLivePreview.jsx:7    confidence === 'low' || confidence === 'inferred'
 *   BrandKitDiffModal.jsx:145    newConfidenceMap[key] === 'low' || === 'inferred'
 *
 * `extractBrandKit` has always returned NUMBERS for confidence — clamped 0.0 to
 * 1.0 (see clampConfidence there). A number is never equal to the string
 * 'low'. So the flag has never rendered, for any field, for any user, in any
 * environment. The product has been telling people it marks uncertain
 * AI-inferred fields while marking none of them.
 *
 * That is the exact shape this repo keeps finding: working code, a plausible UI
 * affordance, and a condition that is silently always false.
 *
 * ── Why one module instead of three fixes ───────────────────────────────────
 * Because it happened three times. A shared helper means the next component
 * that needs this cannot invent a fourth variant, and the guard
 * (scripts/check-brand-provenance.cjs) can assert that nobody compares a
 * confidence value to a string again.
 *
 * ── The distinction that matters ────────────────────────────────────────────
 * Since the site harvester landed there are three kinds of value in a kit, and
 * they must not look alike:
 *
 *   measured — read out of the client's own site (a hex parsed from their CSS,
 *              a name from their JSON-LD). A FACT. Never needs review.
 *   inferred — a language model's reading of their prose. A GUESS.
 *   user     — typed by the person. Theirs.
 *
 * Presenting a guess and a fact with identical authority is the fabricated-data
 * failure the third law forbids, so the review UI has to be able to tell them
 * apart.
 */

export const PROVENANCE = {
  MEASURED: 'measured',
  INFERRED: 'inferred',
  USER: 'user',
};

/**
 * Below this, an inferred value is worth a second look.
 *
 * 0.7 rather than 0.5: the extractor is confidently wrong more often than it is
 * hesitantly wrong, so a middling score is the interesting case. Measured values
 * are exempt regardless — their confidence describes the reading, not a guess.
 */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Legacy string confidences, still present in drafts saved before the extractor
 * returned numbers. Accepted rather than ignored so an old draft does not
 * silently lose its flags — the same class of silence this module exists to end.
 */
const LEGACY_CONFIDENCE = {
  low: 0.3,
  inferred: 0.3,
  medium: 0.6,
  high: 0.95,
  measured: 1,
};

/** A 0–1 number, or null when there is genuinely no signal. */
export function normalizeConfidence(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  if (typeof value === 'string') {
    const key = value.trim().toLowerCase();
    if (key in LEGACY_CONFIDENCE) return LEGACY_CONFIDENCE[key];
    const parsed = Number(key);
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(1, parsed));
  }
  return null;
}

/**
 * What to say about one field.
 *
 * @param {string} field                    column name, e.g. 'color_palette'
 * @param {object} options
 * @param {object} options.confidenceMap    field -> number (or legacy string)
 * @param {object} options.extractionEvidence field -> { source, url, confidence }
 * @returns {{
 *   source: 'measured'|'inferred'|'user'|null,
 *   confidence: number|null,
 *   sourceUrl: string,
 *   needsReview: boolean,
 *   label: string,
 *   description: string,
 * }}
 */
export function fieldProvenance(field, options = {}) {
  const { confidenceMap = {}, extractionEvidence = {} } = options || {};
  const evidence = extractionEvidence && typeof extractionEvidence === 'object'
    ? extractionEvidence[field]
    : null;

  const rawSource = evidence && typeof evidence === 'object' ? evidence.source : null;
  const source = Object.values(PROVENANCE).includes(rawSource) ? rawSource : null;

  const confidence = normalizeConfidence(
    evidence && typeof evidence === 'object' && evidence.confidence !== undefined
      ? evidence.confidence
      : confidenceMap?.[field],
  );

  const sourceUrl = evidence && typeof evidence === 'object' ? String(evidence.url || '') : '';

  // A measured value was read off the site. It is not a guess and must never be
  // presented as one — flagging it for "review" would train people to ignore the
  // flag on the values that genuinely need it.
  if (source === PROVENANCE.MEASURED) {
    return {
      source,
      confidence,
      sourceUrl,
      needsReview: false,
      label: 'Measured',
      description: sourceUrl
        ? `Read directly from ${shortHost(sourceUrl)}`
        : 'Read directly from the site',
    };
  }

  if (source === PROVENANCE.USER) {
    return {
      source,
      confidence,
      sourceUrl,
      needsReview: false,
      label: 'You entered this',
      description: 'Entered by you',
    };
  }

  // Either explicitly inferred, or we only have a confidence number — which can
  // only have come from the extractor, so it is inference either way.
  const isInferred = source === PROVENANCE.INFERRED || confidence !== null;
  if (!isInferred) {
    return {
      source: null,
      confidence: null,
      sourceUrl: '',
      needsReview: false,
      label: '',
      description: '',
    };
  }

  const needsReview = confidence === null || confidence < REVIEW_CONFIDENCE_THRESHOLD;
  return {
    source: PROVENANCE.INFERRED,
    confidence,
    sourceUrl,
    needsReview,
    label: 'AI inferred',
    description: needsReview
      ? 'The AI read this from your site’s wording. Worth checking.'
      : 'The AI read this from your site’s wording.',
  };
}

function shortHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Convenience for lists: how many fields were measured rather than guessed. */
export function countMeasured(fields, options = {}) {
  return fields.reduce(
    (total, field) => (fieldProvenance(field, options).source === PROVENANCE.MEASURED ? total + 1 : total),
    0,
  );
}
