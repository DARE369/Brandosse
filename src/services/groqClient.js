// src/services/groqClient.js
// Unified JSON/text LLM client with provider failover.
// Browser-exposed provider keys are intentionally disabled. Production LLM
// calls should go through Supabase Edge Functions or trusted Next API routes.
import { supabase } from './supabaseClient';

const BROWSER_GROQ_TOKEN = '';
const GROQ_TOKEN = BROWSER_GROQ_TOKEN;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const disabledProviders = new Set();

async function parseFunctionErrorContext(error) {
  try {
    const context = error?.context;
    if (!context) return null;

    if (typeof context.json === 'function') {
      const body = await context.json();
      if (body?.error) return String(body.error);
      if (body?.message) return String(body.message);
      return JSON.stringify(body);
    }

    if (typeof context.text === 'function') {
      const text = await context.text();
      if (!text) return null;
      try {
        const parsed = JSON.parse(text);
        if (parsed?.error) return String(parsed.error);
        if (parsed?.message) return String(parsed.message);
      } catch (_err) {
        // Non-JSON error text.
      }
      return text;
    }
  } catch (_err) {
    // Use fallback below.
  }

  return null;
}

async function invokeContentPlanFunction(body) {
  const { data, error } = await supabase.functions.invoke('generate-content-plan', { body });
  if (error) {
    const detail = await parseFunctionErrorContext(error);
    throw new Error(detail || error.message || 'Content plan edge function failed');
  }
  return data;
}

const CONTENT_PLAN_SCHEMA_SKELETON = {
  schema_version: '1.0',
  generated_at: '<ISO timestamp>',
  intent_summary: '<string>',
  content_goal: '<brand_awareness|product_promotion|education|entertainment|lead_generation|community_engagement>',
  platforms: ['<instagram|tiktok|linkedin|x|youtube>'],
  primary_platform: '<string>',
  content_type: '<single|carousel|video>',
  carousel: {
    slide_count: '<number >= 2>',
    theme: '<string>',
    slides: [{
      slide_index: '<number>',
      slide_purpose: '<hook|problem|solution|proof|feature|cta|tip|transition>',
      headline: '<string>',
      body_text: '<string optional>',
      image_prompt: '<string, min 40 words>',
    }],
  },
  visual_prompt: {
    global_style: '<string>',
    aspect_ratio: '<1:1|16:9|9:16|4:5>',
    slides: [{
      slide_index: '<number>',
      full_prompt: '<string, min 40 words>',
      negative_prompt: '<string optional>',
    }],
  },
  caption: {
    primary: '<string>',
    hook: '<string>',
    cta: '<string>',
    platform_overrides: { instagram: '<string>', tiktok: '<string>', linkedin: '<string>', x: '<string>' },
  },
  title: {
    generic: '<string>',
    platform_overrides: { youtube: '<string>', linkedin: '<string>' },
  },
  hashtags: {
    primary: ['<string>'],
    niche: ['<string>'],
    trending: ['<string>'],
    brand: ['<string>'],
    platform_sets: { instagram: ['<string>'], tiktok: ['<string>'], linkedin: ['<string>'] },
  },
  seo: {
    optimized_title: '<string>',
    optimized_caption: '<string>',
    optimized_hashtags: ['<string>'],
    score: '<number 0-100>',
    score_category: '<Poor|Ok|Good|Great>',
    score_breakdown: {
      platform_alignment: { score: '<number>', max: 20, rationale: '<string>' },
      keyword_density: { score: '<number>', max: 20, rationale: '<string>' },
      caption_structure: { score: '<number>', max: 20, rationale: '<string>' },
      hashtag_relevance: { score: '<number>', max: 20, rationale: '<string>' },
      cta_presence: { score: '<number>', max: 10, rationale: '<string>' },
      brand_consistency: { score: '<number>', max: 10, rationale: '<string>' },
    },
    improvement_report: [{ type: '<improvement|warning|info>', bullet: '<string>' }],
  },
  guardrails_check: {
    pass: '<boolean>',
    violations: ['<string>'],
    notes: '<string>',
  },
};

const CONTENT_PLAN_SYSTEM_PROMPT = `
You are an expert social media content strategist and creative director.
Your job is to analyze a user's input and produce a comprehensive, brand-consistent ContentPlan JSON object.

RULES:
1. Return ONLY valid JSON. No markdown, no backticks, no preamble.
2. Every required field must be present. Use empty arrays [] or empty strings "" if no content, never null.
3. Outputs must be internally consistent across caption, hashtags, title, and visual prompts.
4. Platform overrides must respect platform constraints:
   - x.com: caption <= 280 chars
   - Instagram: ideal caption 125-150 words; up to 30 hashtags
   - LinkedIn: formal tone; max 5-7 hashtags
   - TikTok: short hook; 3-5 hashtags
   - YouTube: title <= 70 chars
5. For carousels: first slide is always the hook. Respect requested_slide_count:
   - If requested_slide_count is a number, use exactly that number.
   - If requested_slide_count is "auto", choose based on complexity with a maximum of 8 slides.
6. Image prompts must be detailed, vivid, technically specific (lighting, style, composition, mood), min 40 words.
7. Hashtags should be relevant and non-spammy.
8. SEO scores should be honest and include improvement_report rationale.
9. If brand kit exists, follow brand voice, visual style, and forbidden phrases.
10. guardrails_check must actively check content_restrictions.

JSON schema to follow:
${JSON.stringify(CONTENT_PLAN_SCHEMA_SKELETON, null, 2)}
`.trim();

const REVISION_SYSTEM = `
You are a content compliance editor. You will receive a ContentPlan JSON and a list of guardrail violations.
Fix ONLY the violations. Do not change unrelated fields.
Return the corrected ContentPlan as valid JSON only. No preamble.
`.trim();

const ENHANCE_SYSTEM = `
You are an expert prompt engineer for AI image generation.
Enhance the user's prompt to produce cinematic, photorealistic, brand-consistent results.
Return ONLY the enhanced prompt string. No explanation. No JSON. No preamble.
`.trim();

function hasGroq() {
  return Boolean(GROQ_TOKEN);
}

function providerOrder() {
  const providers = [];
  if (hasGroq() && !disabledProviders.has('groq')) providers.push('groq');
  // Allow one retry if disabled due to transient auth failure.
  if (!providers.length && hasGroq()) providers.push('groq');
  return providers;
}

async function callProvider({
  provider,
  messages,
  temperature,
  maxTokens,
  jsonMode,
  modelOverride = null,
}) {
  const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  const apiKey = GROQ_TOKEN;
  const model = modelOverride || GROQ_MODEL;

  const body = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const parsed = await response.json();
      detail = parsed?.error?.message || parsed?.message || '';
    } catch (_err) {
      detail = await response.text();
    }
    throw new Error(`${provider.toUpperCase()} ${response.status}: ${detail || response.statusText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`${provider.toUpperCase()} returned an empty response`);
  }
  return content;
}

async function callWithFailover({
  messages,
  temperature = 0.35,
  maxTokens = 1200,
  jsonMode = false,
  modelOverride = null,
}) {
  const providers = providerOrder();
  if (!providers.length) {
    throw new Error('No browser LLM provider is configured. Use the Supabase Edge Function path for LLM calls.');
  }

  let lastError = null;
  for (const provider of providers) {
    try {
      return await callProvider({
        provider,
        messages,
        temperature,
        maxTokens,
        jsonMode,
        modelOverride,
      });
    } catch (err) {
      lastError = err;
      const isAuthFailure = String(err?.message || '').includes('401');
      if (isAuthFailure) {
        disabledProviders.add(provider);
      }
      if (!isAuthFailure && providers.length === 1) {
        throw err;
      }
    }
  }

  throw lastError || new Error('No provider could complete this request.');
}

function buildUserMessage(brief) {
  return `
Create a ContentPlan for the following request.

USER INPUT: "${brief.raw_input}"

INTENT HINTS (from user clarification):
${Object.entries(brief.intent_hints ?? {}).map(([key, value]) => `${key}: ${value}`).join('\n') || 'None provided; infer from input and history.'}

BRAND KIT:
${brief.brand_summary || 'No brand kit configured. Use neutral defaults.'}

BRAND ASSETS:
${brief.asset_context || 'None.'}

RECENT USER HISTORY (for context/consistency):
${brief.history_summary || 'No prior generations.'}

GENERATION SETTINGS:
- Media type: ${brief.media_type}
- Content type: ${brief.content_type}
- Requested slide count: ${brief.requested_slide_count ?? 'n/a'}
- Aspect ratio: ${brief.aspect_ratio}
- Target platforms: ${(brief.platform_targets ?? []).join(', ') || 'Not specified'}

Produce the ContentPlan JSON now.
`.trim();
}

export async function callGroqContentPlan(brief) {
  const data = await invokeContentPlanFunction({
    mode: 'plan',
    brief,
  });

  if (!data?.plan || typeof data.plan !== 'object') {
    throw new Error('Content plan edge function returned no plan');
  }

  return data.plan;
}

export async function callGroqRevision(plan, violations, brandKit) {
  const data = await invokeContentPlanFunction({
    mode: 'revision',
    plan,
    violations,
    brandKit,
  });

  if (!data?.plan || typeof data.plan !== 'object') {
    throw new Error('Content plan revision edge function returned no plan');
  }

  return data.plan;
}

export async function enhancePromptWithBrand(rawPrompt, brandKit) {
  const brandContext = brandKit?.configured
    ? [
        brandKit.raw?.visual_style_keywords?.length
          ? `Brand visual style: ${brandKit.raw.visual_style_keywords.join(', ')}.` : '',
        brandKit.raw?.photo_style_notes
          ? `Photo style: ${brandKit.raw.photo_style_notes}.` : '',
        brandKit.raw?.avoid_visual_elements?.length
          ? `Avoid: ${brandKit.raw.avoid_visual_elements.join(', ')}.` : '',
      ].filter(Boolean).join(' ')
    : '';

  const prompt = `
Enhance this prompt for AI image generation.
Original: "${rawPrompt}"
${brandContext ? `\nBrand context:\n${brandContext}` : ''}

Return only the enhanced prompt.
`.trim();

  const output = await callWithFailover({
    messages: [
      { role: 'system', content: ENHANCE_SYSTEM },
      { role: 'user', content: prompt },
    ],
    temperature: 0.8,
    maxTokens: 300,
    jsonMode: false,
    preferredProvider: 'groq',
  });

  return String(output).trim();
}

export async function callGroqJSON(
  prompt,
  {
    model = null,
    temperature = 0.35,
    max_tokens = 1200,
    system = 'Return only valid JSON that matches the requested shape.',
  } = {},
) {
  const messages = [
    { role: 'system', content: String(system || '') },
    { role: 'user', content: String(prompt || '') },
  ];

  const raw = await callWithFailover({
    messages,
    temperature,
    maxTokens: max_tokens,
    jsonMode: true,
    modelOverride: model || null,
  });

  try {
    return JSON.parse(raw);
  } catch (_err) {
    throw new Error('LLM returned invalid JSON');
  }
}

export async function callGroqVisionJSON(
  prompt,
  imageUrl,
  {
    model = GROQ_VISION_MODEL,
    temperature = 0.35,
    max_tokens = 900,
    system = 'Analyze the image and return only valid JSON in the requested shape.',
  } = {},
) {
  if (!imageUrl) {
    throw new Error('imageUrl is required');
  }

  const messages = [
    { role: 'system', content: String(system || '') },
    {
      role: 'user',
      content: [
        { type: 'text', text: String(prompt || '') },
        { type: 'image_url', image_url: { url: String(imageUrl) } },
      ],
    },
  ];

  const raw = await callWithFailover({
    messages,
    temperature,
    maxTokens: max_tokens,
    jsonMode: true,
    modelOverride: model || GROQ_VISION_MODEL,
    preferredProvider: 'groq',
  });

  try {
    return JSON.parse(raw);
  } catch (_err) {
    throw new Error('LLM returned invalid vision JSON');
  }
}
