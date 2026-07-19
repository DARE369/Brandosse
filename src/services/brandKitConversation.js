export const CONVERSATION_QUESTIONS = [
  "What is your brand name and what does it do in one sentence?",
  "Who is your target audience? Describe them specifically.",
  "How would you describe your brand's tone? Pick a few words, or describe it in your own.",
  "Any phrases you use often, or ones we should avoid?",
  "What topics, claims, or competitor mentions should your brand never post about?",
  "Describe your visual style — colors, photography style, anything to avoid visually.",
];

// Schema matches the real public.brand_kit columns exactly — see
// docs/brand-kit-rebuild/AS_IS_AUDIT.md §0 (this replaces a prior schema
// that emitted core_values/content_pillars/hashtags/do_list/dont_list,
// none of which are real columns, and mistyped brand_voice as an array).
export const CONVERSATION_SYSTEM_PROMPT = `You are a friendly brand strategist having a short conversation to understand a brand.
Ask 6 focused questions, one at a time.
After all answers are collected, output ONLY a JSON object with:
{
  "brandKit": {
    "brand_name": "",
    "industry": "",
    "tagline": "",
    "target_audience": "",
    "audience_age_range": "",
    "audience_locations": [],
    "brand_voice": "",
    "tone_descriptors": [],
    "writing_style_notes": "",
    "signature_phrases": [],
    "forbidden_phrases": [],
    "emoji_usage": "",
    "call_to_action_style": "",
    "content_restrictions": [],
    "competitor_names": [],
    "legal_disclaimers": "",
    "visual_style_keywords": [],
    "color_palette": [],
    "typography_notes": "",
    "photo_style_notes": "",
    "avoid_visual_elements": []
  },
  "confidenceMap": {},
  "missingTier1Fields": []
}
Field rules:
- brand_voice must be exactly ONE of: professional, playful, authoritative, conversational, inspirational, edgy.
- emoji_usage must be exactly ONE of: none, minimal, moderate, heavy.
- call_to_action_style must be exactly ONE of: question-based, imperative, soft.
- content_restrictions is CONTENT-level (topics/claims to avoid saying). avoid_visual_elements is VISUAL-level (imagery/photo styles to avoid). Keep these separate.
- Only fill fields the conversation actually supports; leave the rest empty rather than guessing.
Do not include explanation outside JSON in the final output.`;

const VALID_BRAND_VOICES = ['professional', 'playful', 'authoritative', 'conversational', 'inspirational', 'edgy'];
const VALID_EMOJI_USAGE = ['none', 'minimal', 'moderate', 'heavy'];
const VALID_CTA_STYLES = ['question-based', 'imperative', 'soft'];

function toArray(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return [];
    return normalized.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function toEnum(value, allowed) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : '';
}

function toColorPalette(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const hex = String(entry.hex || '').trim();
      if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return null;
      return { hex, name: String(entry.name || '').trim(), usage: String(entry.usage || '').trim() };
    })
    .filter(Boolean);
}

function normalizeConfidenceMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value).reduce((acc, [key, score]) => {
    const numeric = Number(score);
    acc[key] = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
    return acc;
  }, {});
}

function mergeBrandKit(base = {}, next = {}) {
  return {
    ...base,
    ...next,
    brand_name: String(next.brand_name ?? base.brand_name ?? '').trim(),
    industry: String(next.industry ?? base.industry ?? '').trim(),
    tagline: String(next.tagline ?? base.tagline ?? '').trim(),
    target_audience: String(next.target_audience ?? base.target_audience ?? '').trim(),
    audience_age_range: String(next.audience_age_range ?? base.audience_age_range ?? '').trim(),
    audience_locations: toArray(next.audience_locations ?? base.audience_locations),
    brand_voice: toEnum(next.brand_voice ?? base.brand_voice, VALID_BRAND_VOICES),
    tone_descriptors: toArray(next.tone_descriptors ?? base.tone_descriptors),
    writing_style_notes: String(next.writing_style_notes ?? base.writing_style_notes ?? '').trim(),
    signature_phrases: toArray(next.signature_phrases ?? base.signature_phrases),
    forbidden_phrases: toArray(next.forbidden_phrases ?? base.forbidden_phrases),
    emoji_usage: toEnum(next.emoji_usage ?? base.emoji_usage, VALID_EMOJI_USAGE),
    call_to_action_style: toEnum(next.call_to_action_style ?? base.call_to_action_style, VALID_CTA_STYLES),
    content_restrictions: toArray(next.content_restrictions ?? base.content_restrictions),
    competitor_names: toArray(next.competitor_names ?? base.competitor_names),
    legal_disclaimers: String(next.legal_disclaimers ?? base.legal_disclaimers ?? '').trim(),
    visual_style_keywords: toArray(next.visual_style_keywords ?? base.visual_style_keywords),
    color_palette: toColorPalette(next.color_palette ?? base.color_palette),
    typography_notes: String(next.typography_notes ?? base.typography_notes ?? '').trim(),
    photo_style_notes: String(next.photo_style_notes ?? base.photo_style_notes ?? '').trim(),
    avoid_visual_elements: toArray(next.avoid_visual_elements ?? base.avoid_visual_elements),
  };
}

export function buildFinalConversationInferencePrompt({ answers = [], prefilled = {} } = {}) {
  const transcript = answers.map((entry, index) => (
    `Q${index + 1}: ${CONVERSATION_QUESTIONS[index]}\nA${index + 1}: ${String(entry || '').trim()}`
  )).join('\n\n');

  return [
    CONVERSATION_SYSTEM_PROMPT,
    '',
    'Collected conversation:',
    transcript,
    '',
    `Existing extracted context (if any): ${JSON.stringify(prefilled || {})}`,
    '',
    'Now output the final brand kit JSON.',
  ].join('\n');
}

export function normalizeConversationResult(rawResult, prefilled = {}) {
  const sourceBrandKit = rawResult?.brandKit && typeof rawResult.brandKit === 'object'
    ? rawResult.brandKit
    : {};
  const mergedBrandKit = mergeBrandKit(prefilled, sourceBrandKit);

  const missingTier1Fields = Array.isArray(rawResult?.missingTier1Fields)
    ? rawResult.missingTier1Fields.map((field) => String(field || '').trim()).filter(Boolean)
    : [];

  return {
    brandKit: mergedBrandKit,
    confidenceMap: normalizeConfidenceMap(rawResult?.confidenceMap),
    missingTier1Fields,
  };
}
