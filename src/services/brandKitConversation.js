export const CONVERSATION_QUESTIONS = [
  "What is your brand name and what does it do in one sentence?",
  "Who is your target audience? Describe them specifically.",
  "If your brand were a person, how would you describe their personality in 3-5 words?",
  "What topics or content themes are most important for your brand to post about?",
  "What should your brand NEVER say or do in its content?",
  "List your brand's most important hashtags or keywords.",
];

export const CONVERSATION_SYSTEM_PROMPT = `You are a friendly brand strategist having a short conversation to understand a brand.
Ask 6 focused questions, one at a time.
After all answers are collected, output ONLY a JSON object with:
{
  "brandKit": {
    "brand_name": "",
    "tagline": "",
    "brand_voice": [],
    "tone_descriptors": [],
    "target_audience": "",
    "core_values": [],
    "content_pillars": [],
    "hashtags": [],
    "color_palette": [],
    "do_list": [],
    "dont_list": []
  },
  "confidenceMap": {},
  "missingTier1Fields": []
}
Do not include explanation outside JSON in the final output.`;

function toArray(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return [];
    return normalized.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function normalizeConfidenceMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
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
    brand_name: String(next.brand_name ?? base.brand_name ?? "").trim(),
    tagline: String(next.tagline ?? base.tagline ?? "").trim(),
    target_audience: String(next.target_audience ?? base.target_audience ?? "").trim(),
    brand_voice: toArray(next.brand_voice ?? base.brand_voice),
    tone_descriptors: toArray(next.tone_descriptors ?? base.tone_descriptors),
    core_values: toArray(next.core_values ?? base.core_values),
    content_pillars: toArray(next.content_pillars ?? base.content_pillars),
    hashtags: toArray(next.hashtags ?? base.hashtags).map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)),
    color_palette: toArray(next.color_palette ?? base.color_palette),
    do_list: toArray(next.do_list ?? base.do_list),
    dont_list: toArray(next.dont_list ?? base.dont_list),
  };
}

export function buildFinalConversationInferencePrompt({ answers = [], prefilled = {} } = {}) {
  const transcript = answers.map((entry, index) => (
    `Q${index + 1}: ${CONVERSATION_QUESTIONS[index]}\nA${index + 1}: ${String(entry || "").trim()}`
  )).join("\n\n");

  return [
    CONVERSATION_SYSTEM_PROMPT,
    "",
    "Collected conversation:",
    transcript,
    "",
    `Existing extracted context (if any): ${JSON.stringify(prefilled || {})}`,
    "",
    "Now output the final brand kit JSON.",
  ].join("\n");
}

export function normalizeConversationResult(rawResult, prefilled = {}) {
  const sourceBrandKit = rawResult?.brandKit && typeof rawResult.brandKit === "object"
    ? rawResult.brandKit
    : {};
  const mergedBrandKit = mergeBrandKit(prefilled, sourceBrandKit);

  const missingTier1Fields = Array.isArray(rawResult?.missingTier1Fields)
    ? rawResult.missingTier1Fields.map((field) => String(field || "").trim()).filter(Boolean)
    : [];

  return {
    brandKit: mergedBrandKit,
    confidenceMap: normalizeConfidenceMap(rawResult?.confidenceMap),
    missingTier1Fields,
  };
}

