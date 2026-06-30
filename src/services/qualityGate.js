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
 * Runs guardrail checks. On violation calls Groq once for a revision.
 * @returns {{ passed: boolean, revisedPlan: object|null, notes: string }}
 */
export async function runQualityGate(plan, brandKit) {
  if (!brandKit?.configured) {
    return { passed: true, revisedPlan: null, notes: 'No brand kit — gate skipped.' };
  }

  const violations = GUARDRAIL_CHECKS
    .map(check => check(plan, brandKit))
    .filter(Boolean);

  if (violations.length === 0) {
    return { passed: true, revisedPlan: null, notes: '' };
  }

  console.warn('[QualityGate] Violations found, requesting revision:', violations);

  try {
    const revised = await callGroqRevision(plan, violations, brandKit);
    return {
      passed: false,
      revisedPlan: revised,
      notes: `Auto-revised. Violations: ${violations.join('; ')}`,
    };
  } catch (err) {
    console.error('[QualityGate] Revision call failed:', err);
    // Return original plan rather than blocking generation
    return {
      passed: false,
      revisedPlan: null,
      notes: `Revision failed (${err.message}). Original plan used. Violations: ${violations.join('; ')}`,
    };
  }
}
