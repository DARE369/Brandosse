// src/services/qualityGate.js
import { callGroqRevision } from './groqClient';

// A brand-wide word MINIMUM cannot mean the same thing on every platform.
// `min_caption_words` defaults to 20 (BrandKitForm.jsx) and applies to every
// kit; X caps a post at 280 characters, so a 20-word floor is most of the
// post. Observed 2026-08-24: a user asked for a short, conversational X post,
// the model correctly produced 7 and 13 words, and the gate rejected BOTH —
// then hard-blocked the generation when the revision call could not be
// reached. The output was right and the rule was wrong.
//
// The brand's minimum still applies; it is only CAPPED per platform. This can
// lower a floor, never raise one, and it does not touch the maximum — a brand
// that wants short captions everywhere still gets them.
const PLATFORM_MIN_WORD_CEILING = {
  x: 5,
  twitter: 5,
  threads: 8,
  tiktok: 8,
  instagram: 12,
  facebook: 12,
  pinterest: 12,
  linkedin: 20,
  youtube: 20,
};

function effectiveMinWords(brandMin, plan) {
  const platform = String(
    plan?.primary_platform || (Array.isArray(plan?.platforms) ? plan.platforms[0] : '') || '',
  ).trim().toLowerCase();
  const ceiling = PLATFORM_MIN_WORD_CEILING[platform];
  return ceiling === undefined ? brandMin : Math.min(brandMin, ceiling);
}

const GUARDRAIL_CHECKS = [
  // 1. Forbidden phrases in caption
  (plan, kit) => {
    const forbidden = kit.raw?.forbidden_phrases ?? [];
    if (!forbidden.length) return null;
    const captionText = (plan.caption?.primary ?? '').toLowerCase();
    const violations = forbidden.filter(p => captionText.includes(p.toLowerCase()));
    return violations.length
      ? `Caption contains forbidden phrases: ${violations.join(', ')}`
      : null;
  },

  // 2. Caption length
  (plan, kit) => {
    const text = plan.caption?.primary ?? '';
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const min = effectiveMinWords(kit.raw?.min_caption_words ?? 0, plan);
    const max = kit.raw?.max_caption_words ?? 9999;
    if (wordCount < min) return `Caption too short: ${wordCount} words (min ${min})`;
    if (wordCount > max) return `Caption too long: ${wordCount} words (max ${max})`;
    return null;
  },

  // 3. Hashtag count
  (plan, kit) => {
    const total = (plan.hashtags?.primary?.length ?? 0) + (plan.hashtags?.niche?.length ?? 0);
    const maxH = kit.raw?.max_hashtags ?? 30;
    return total > maxH ? `Too many hashtags: ${total} (max ${maxH})` : null;
  },

  // 4. Content restrictions
  (plan, kit) => {
    const restrictions = kit.raw?.content_restrictions ?? [];
    if (!restrictions.length) return null;
    const allText = JSON.stringify(plan).toLowerCase();
    const triggered = restrictions.filter(r => allText.includes(r.toLowerCase()));
    return triggered.length
      ? `Content restriction violated: ${triggered.join(', ')}`
      : null;
  },
];

/**
 * Thrown when a brand-guardrail violation cannot be cleared — either the
 * auto-revision call itself failed, or the revised plan still violates one
 * or more guardrails. Callers must let this abort generation (fail closed),
 * not swallow it and proceed with a violating plan.
 */
export class QualityGateBlockedError extends Error {
  constructor(violations, reason) {
    super(`Content blocked by brand guardrails (${reason}): ${violations.join('; ')}`);
    this.name = 'QualityGateBlockedError';
    this.violations = violations;
    this.reason = reason;
  }
}

/**
 * Runs guardrail checks. On violation, calls Groq once for a revision, then
 * re-checks the revised plan against the same guardrails. If the violation
 * cannot be cleared — the revision call fails, or the revised plan still
 * violates — throws QualityGateBlockedError instead of letting the
 * violating plan through.
 * @returns {{ passed: boolean, revisedPlan: object|null, notes: string, revisionProvider: string|null, revisionModel: string|null }}
 */
export async function runQualityGate(plan, brandKit) {
  if (!brandKit?.configured) {
    return { passed: true, revisedPlan: null, notes: 'No brand kit — gate skipped.', revisionProvider: null, revisionModel: null };
  }

  const violations = GUARDRAIL_CHECKS
    .map(check => check(plan, brandKit))
    .filter(Boolean);

  if (violations.length === 0) {
    return { passed: true, revisedPlan: null, notes: '', revisionProvider: null, revisionModel: null };
  }

  console.warn('[QualityGate] Violations found, requesting revision:', violations);

  let revised;
  let provider;
  let model;
  try {
    ({ plan: revised, provider, model } = await callGroqRevision(plan, violations, brandKit));
  } catch (err) {
    console.error('[QualityGate] Revision call failed — blocking generation:', err);
    throw new QualityGateBlockedError(violations, `revision request failed: ${err.message}`);
  }

  const remainingViolations = GUARDRAIL_CHECKS
    .map(check => check(revised, brandKit))
    .filter(Boolean);

  if (remainingViolations.length > 0) {
    console.error('[QualityGate] Revision did not clear violations — blocking generation:', remainingViolations);
    throw new QualityGateBlockedError(remainingViolations, 'revision did not clear the violation(s)');
  }

  return {
    passed: false,
    revisedPlan: revised,
    notes: `Auto-revised. Violations: ${violations.join('; ')}`,
    revisionProvider: provider,
    revisionModel: model,
  };
}
