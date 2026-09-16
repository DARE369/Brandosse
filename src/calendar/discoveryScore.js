// src/calendar/discoveryScore.js
//
// The discovery score, made ADVISORY BY CONSTRUCTION rather than by convention.
//
// ── Why this module exists instead of calling the service directly ──────────
// scorePostSeo() (postProduction.service.js) THROWS: on a rate limit, on a
// provider outage, on a missing caption. A composer that awaited it naively
// would surface an exception from an optional, decorative number — and the
// obvious "fix" under deadline is a try/catch that disables the send button
// "until scoring finishes". That is how an advisory feature becomes a blocker,
// and it would block hardest exactly when the scoring provider is down.
//
// So the rule is enforced in the shape, not in a comment: this module NEVER
// rejects and NEVER throws. Every path resolves to a state object, and the
// worst state it can return is `unavailable`. There is nothing here for a
// caller to await-and-fail on, so the composer cannot come to depend on it.
//
// The plan's guard for this phase is exactly that property:
//   "a check that a scoring failure degrades to 'not scored' and never blocks
//    the composer."  (LIBRARY-PUBLISH-IMPLEMENTATION-PLAN.md, Phase 5.)

/** The states a score can be in. `unavailable` is a first-class answer. */
export const SCORE_STATE = {
  IDLE: 'idle',                 // nothing to score yet — no caption
  SCORING: 'scoring',
  SCORED: 'scored',
  UNAVAILABLE: 'unavailable',   // we could not score. NOT "it scored badly".
};

/**
 * Bands for presentation only. Deliberately NOT a pass/fail: there is no score
 * at which this product refuses to publish, and rendering a red "fail" chip
 * would imply one.
 */
export function bandFor(score) {
  // `Number(null)` is 0, and `Number('')` is 0 — both FINITE. A bare
  // Number.isFinite() guard therefore let a MISSING score fall through and band
  // as "Could be stronger", telling the user their caption is weak when nothing
  // had been measured at all. That is the same fabricated reading this module
  // exists to prevent, and it got in here anyway; caught by the test, not by
  // review. Absence is checked before coercion for that reason.
  if (score === null || score === undefined || score === '') {
    return { key: 'none', label: 'Not scored', tone: 'neutral' };
  }
  const n = Number(score);
  if (!Number.isFinite(n)) return { key: 'none', label: 'Not scored', tone: 'neutral' };
  if (n >= 80) return { key: 'strong', label: 'Strong', tone: 'success' };
  if (n >= 60) return { key: 'fair', label: 'Fair', tone: 'neutral' };
  return { key: 'weak', label: 'Could be stronger', tone: 'warning' };
}

/**
 * Score one destination. Resolves — always.
 *
 * @param {Function} scoreFn the real scorer, injected so this is testable
 *        without a network or a Supabase client.
 * @returns {Promise<{state:string, score:number|null, category:string|null,
 *                    suggestions:string[], reason:string}>}
 */
export async function scoreDestination(scoreFn, { platform, caption, title, hashtags, mediaType } = {}) {
  const text = String(caption || '').trim();

  if (!text) {
    // Not a failure. There is simply nothing to score yet, and saying
    // "unavailable" here would read as breakage during normal typing.
    return { state: SCORE_STATE.IDLE, score: null, category: null, suggestions: [], reason: '' };
  }

  try {
    const result = await scoreFn({
      platform, caption: text, title: title || '', hashtags: hashtags || [], mediaType: mediaType || null,
    });

    const score = Number(result?.seoScore);
    if (!Number.isFinite(score)) {
      // A response carrying no number is UNAVAILABLE, not zero. Rendering a
      // missing score as 0 would tell the user their caption is terrible when
      // nothing was actually measured — a fabricated reading, which Law 3
      // forbids more plainly than any missing feature.
      return {
        state: SCORE_STATE.UNAVAILABLE,
        score: null,
        category: null,
        suggestions: [],
        reason: 'The scorer replied without a score.',
      };
    }

    return {
      state: SCORE_STATE.SCORED,
      score,
      category: result?.seoCategory || null,
      suggestions: Array.isArray(result?.seoSuggestions) ? result.seoSuggestions.filter(Boolean) : [],
      reason: '',
    };
  } catch (err) {
    // Swallowed HERE and only here, and never silently: the message is carried
    // into the returned state so the UI can say why, and it is logged. The
    // alternative — letting it propagate — is what turns an optional number
    // into a blocked composer.
    console.error('[discovery] scoring failed:', err?.message || err);
    return {
      state: SCORE_STATE.UNAVAILABLE,
      score: null,
      category: null,
      suggestions: [],
      reason: err?.message || 'Scoring is unavailable right now.',
    };
  }
}

/**
 * Score several destinations at once, one entry per platform.
 *
 * Settles every destination independently — one platform's failure must not
 * remove another's score. `Promise.all` would reject the whole set on the first
 * failure; `scoreDestination` cannot reject, but this uses allSettled anyway so
 * the property survives someone later swapping in a scorer that can.
 */
export async function scoreDestinations(scoreFn, destinations) {
  const list = Array.isArray(destinations) ? destinations : [];
  const results = await Promise.allSettled(list.map((d) => scoreDestination(scoreFn, d)));

  const out = {};
  list.forEach((d, i) => {
    const r = results[i];
    out[d.platform] = r.status === 'fulfilled' ? r.value : {
      state: SCORE_STATE.UNAVAILABLE,
      score: null,
      category: null,
      suggestions: [],
      reason: r.reason?.message || 'Scoring is unavailable right now.',
    };
  });
  return out;
}

/**
 * Does any of this block publishing?
 *
 * No. Always no — and it is a function rather than a bare constant so the
 * answer is greppable and a guard can assert it. If a future change ever wants
 * a score to gate a send, it has to come through here and fail the test that
 * pins it.
 */
export function blocksPublishing() {
  return false;
}
