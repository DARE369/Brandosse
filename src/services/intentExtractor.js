// src/services/intentExtractor.js

/**
 * Fast local heuristic — determines if the user prompt is ambiguous enough
 * to warrant clarification questions before generation.
 *
 * Returns: { ambiguous: boolean, questions: string[] }
 * questions items: 'content_goal' | 'primary_platform'
 */
export function checkIntentAmbiguity(prompt, brandKit) {
  const cleaned    = (prompt ?? '').trim();
  const wordCount  = cleaned.split(/\s+/).filter(Boolean).length;
  const hasPlatform = /instagram|tiktok|linkedin|youtube|twitter|x\.com/i.test(cleaned);
  const hasGoal     = /sell|promot|educat|announc|shar|campaign|awareness|launch|inspir/i.test(cleaned);

  // Clear enough: long prompt + (platform or brand kit) + goal
  if (wordCount >= 12 && (hasPlatform || brandKit?.configured) && hasGoal) {
    return { ambiguous: false, questions: [] };
  }

  // Very long prompt → trust it
  if (wordCount >= 20) {
    return { ambiguous: false, questions: [] };
  }

  // Ambiguous — determine which questions would help most
  const questions = [];
  if (!hasGoal)     questions.push('content_goal');
  if (!hasPlatform) questions.push('primary_platform');

  return { ambiguous: questions.length > 0, questions: questions.slice(0, 2) };
}
