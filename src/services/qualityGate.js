// src/services/qualityGate.js
import { callGroqRevision } from './groqClient';

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
    const min = kit.raw?.min_caption_words ?? 0;
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
