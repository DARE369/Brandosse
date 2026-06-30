import { callGroqJSON, callGroqVisionJSON } from './groqClient';

const DEFAULT_SUGGESTION_COUNT = 2;
const DEFAULT_MAX_HASHTAGS = 7;

function normalizeHashtag(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/^#+/, '')
    .replace(/[^\w]/g, '')
    .toLowerCase();
  return cleaned ? `#${cleaned}` : '';
}

function normalizeHashtagList(input, maxHashtags = DEFAULT_MAX_HASHTAGS) {
  const source = Array.isArray(input)
    ? input
    : String(input || '')
      .split(/[\s,]+/)
      .filter(Boolean);

  const unique = [];
  for (const item of source) {
    const normalized = normalizeHashtag(item);
    if (!normalized || unique.includes(normalized)) continue;
    unique.push(normalized);
    if (unique.length >= maxHashtags) break;
  }

  return unique;
}

function normalizeSuggestion(raw, maxHashtags) {
  const caption = String(raw?.caption || '').trim();
  const hashtags = normalizeHashtagList(raw?.hashtags || [], maxHashtags);
  if (!caption) return null;
  return { caption, hashtags };
}

function normalizeSuggestions(rawSuggestions, count, maxHashtags) {
  if (!Array.isArray(rawSuggestions)) return [];

  const normalized = [];
  for (const suggestion of rawSuggestions) {
    const parsed = normalizeSuggestion(suggestion, maxHashtags);
    if (!parsed) continue;
    normalized.push(parsed);
    if (normalized.length >= count) break;
  }
  return normalized;
}

function buildPrompt({ platforms, count, maxHashtags }) {
  const platformText = platforms.length ? platforms.join(', ') : 'social media';

  return `
You are a senior social media strategist and visual analyst.
Analyze the uploaded image and write ${count} distinct caption suggestions tailored for: ${platformText}.

Requirements:
- Each suggestion must have a different angle and hook.
- Keep each caption concise, practical, and publish-ready.
- Return up to ${maxHashtags} relevant hashtags per suggestion.
- Hashtags should be lowercase, no spaces, and include "#" prefix.

Return ONLY JSON in this exact shape:
{
  "suggestions": [
    { "caption": "string", "hashtags": ["#tag1", "#tag2"] }
  ]
}
`.trim();
}

function buildTextFallbackPrompt({ prompt, imageUrl }) {
  return `
${prompt}

If you cannot directly inspect the image, infer from this image URL:
${imageUrl}
`.trim();
}

function buildStaticFallback(platforms, maxHashtags) {
  const context = platforms.length ? platforms[0] : 'social';
  return [
    {
      caption: `Fresh visual from our ${context} content stack. What stands out to you the most?`,
      hashtags: normalizeHashtagList(['content', context, 'creator', 'marketing', 'brand'], maxHashtags),
    },
    {
      caption: `Behind this post is a simple goal: clearer storytelling and stronger engagement.`,
      hashtags: normalizeHashtagList(['socialmedia', 'growth', 'strategy', 'creative', 'audience'], maxHashtags),
    },
  ];
}

export async function generateImageCaptionSuggestions({
  imageUrl,
  platforms = [],
  count = DEFAULT_SUGGESTION_COUNT,
  maxHashtags = DEFAULT_MAX_HASHTAGS,
} = {}) {
  if (!imageUrl) throw new Error('imageUrl is required');

  const safeCount = Math.max(1, Math.min(4, Number(count) || DEFAULT_SUGGESTION_COUNT));
  const safeMaxHashtags = Math.max(1, Math.min(15, Number(maxHashtags) || DEFAULT_MAX_HASHTAGS));
  const normalizedPlatforms = Array.from(
    new Set(
      (Array.isArray(platforms) ? platforms : [])
        .map((platform) => String(platform || '').trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  const prompt = buildPrompt({
    platforms: normalizedPlatforms,
    count: safeCount,
    maxHashtags: safeMaxHashtags,
  });

  try {
    const visionResult = await callGroqVisionJSON(prompt, imageUrl, {
      temperature: 0.6,
      max_tokens: 1000,
    });

    const fromVision = normalizeSuggestions(
      visionResult?.suggestions,
      safeCount,
      safeMaxHashtags,
    );
    if (fromVision.length > 0) return fromVision;
  } catch (error) {
    console.warn('[generateImageCaptionSuggestions] Vision analysis failed:', error);
  }

  try {
    const textResult = await callGroqJSON(
      buildTextFallbackPrompt({ prompt, imageUrl }),
      {
        temperature: 0.5,
        max_tokens: 800,
      },
    );

    const fromText = normalizeSuggestions(
      textResult?.suggestions,
      safeCount,
      safeMaxHashtags,
    );
    if (fromText.length > 0) return fromText;
  } catch (error) {
    console.warn('[generateImageCaptionSuggestions] Text fallback failed:', error);
  }

  return buildStaticFallback(normalizedPlatforms, safeMaxHashtags).slice(0, safeCount);
}

export function normalizeHashtagInput(rawValues, maxHashtags = DEFAULT_MAX_HASHTAGS) {
  return normalizeHashtagList(rawValues, maxHashtags);
}
