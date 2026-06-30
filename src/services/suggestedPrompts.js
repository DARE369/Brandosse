import { supabase } from './supabaseClient';
import { callGroqJSON } from './groqClient';
import { computeBrandKitHash } from '../utils/brandKitHash';
import {
  clearEdgeFunctionUnavailable,
  isEdgeFunctionUnavailable,
  markEdgeFunctionUnavailable,
  shouldSkipEdgeFunction,
} from './edgeFunctionClient';
import { getRuntimeEnvValue, isRuntimeDev } from '../utils/runtimeEnv';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SUGGESTIONS_FUNCTION = 'prompt-suggestions';
const inFlightEdgePromptRequests = new Map();
const ENABLE_PROMPT_SUGGESTIONS_EDGE_IN_DEV = String(
  getRuntimeEnvValue('NEXT_PUBLIC_ENABLE_PROMPT_SUGGESTIONS_EDGE_IN_DEV'),
).toLowerCase() === 'true';

function shouldUsePromptSuggestionsEdge() {
  if (!isRuntimeDev()) return true;
  return ENABLE_PROMPT_SUGGESTIONS_EDGE_IN_DEV;
}

export async function getSuggestedPrompts(userId, brandKit = null, options = {}) {
  if (!userId) return [];

  const mode = options.mode || 'create-image';
  const today = new Date().toDateString();
  const cacheKey = `socialai_suggestions_${userId}_${mode}_${today}`;
  const currentHash = computeBrandKitHash(brandKit);

  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (cached) {
      const ageMs = Date.now() - new Date(cached.generatedAt).getTime();
      const isExpired = Number.isNaN(ageMs) || ageMs > CACHE_TTL_MS;
      const isStale = cached.brandKitHash !== currentHash;
      if (!isExpired && !isStale && Array.isArray(cached.prompts) && cached.prompts.length >= 4) {
        return cached.prompts.slice(0, 4);
      }
    }
  } catch (_err) {
    // Ignore cache parse issues.
  }

  const prompts = await generateSuggestedPrompts(brandKit, mode);

  try {
    localStorage.setItem(cacheKey, JSON.stringify({
      prompts,
      generatedAt: new Date().toISOString(),
      brandKitHash: currentHash,
    }));
  } catch (_err) {
    // Ignore quota/storage issues.
  }

  return prompts;
}

async function generateSuggestedPrompts(brandKit, mode) {
  const edgePrompts = await getEdgePrompts(brandKit, mode);
  if (edgePrompts.length >= 4) return edgePrompts.slice(0, 4);

  const groqPrompts = await getGroqFallbackPrompts(brandKit, mode);
  if (groqPrompts.length >= 4) return groqPrompts.slice(0, 4);

  return buildLastResortPrompts(mode);
}

async function getEdgePrompts(brandKit, mode) {
  if (!shouldUsePromptSuggestionsEdge()) {
    return [];
  }

  if (shouldSkipEdgeFunction(SUGGESTIONS_FUNCTION)) {
    return [];
  }

  const requestKey = `${mode}:${computeBrandKitHash(brandKit)}`;
  const existingRequest = inFlightEdgePromptRequests.get(requestKey);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke(SUGGESTIONS_FUNCTION, {
        body: {
          mode,
          count: 4,
          brandKit: brandKit || null,
        },
      });

      if (error) throw error;
      clearEdgeFunctionUnavailable(SUGGESTIONS_FUNCTION);
      return normalizePrompts(data?.suggestions);
    } catch (err) {
      if (isEdgeFunctionUnavailable(err)) {
        markEdgeFunctionUnavailable(SUGGESTIONS_FUNCTION);
      }
      return [];
    } finally {
      inFlightEdgePromptRequests.delete(requestKey);
    }
  })();

  inFlightEdgePromptRequests.set(requestKey, request);
  return request;
}

async function getGroqFallbackPrompts(brandKit, mode) {
  const hasBrandKit = Boolean(brandKit?.setup_completed && brandKit?.brand_name);
  const randomSeed = crypto.randomUUID().slice(0, 8);
  const prompt = hasBrandKit
    ? buildBrandAwarePromptRequest(brandKit, mode, randomSeed)
    : buildGenericPromptRequest(mode, randomSeed);

  try {
    const result = await callGroqJSON(prompt);
    return normalizePrompts(result?.suggestions);
  } catch (_err) {
    return [];
  }
}

function normalizePrompts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .filter((entry, index, arr) => arr.indexOf(entry) === index);
}

function buildBrandAwarePromptRequest(brandKit, mode, randomSeed) {
  return `You are a social media creative strategist.
Generate 4 distinct prompt suggestions for ${mode === 'text-to-video' ? 'video generation' : 'image generation'}.

Randomization seed: ${randomSeed}
Current date: ${new Date().toISOString()}

Brand context:
- Brand name: ${brandKit.brand_name}
- Industry: ${brandKit.industry || 'Not specified'}
- Target audience: ${brandKit.target_audience || 'Not specified'}
- Brand voice: ${brandKit.brand_voice || 'Not specified'}
- Visual style: ${Array.isArray(brandKit.visual_style_keywords) ? brandKit.visual_style_keywords.join(', ') : 'Not specified'}

Rules:
1. Each suggestion must be unique and practical.
2. Each suggestion must be under 26 words.
3. Do not repeat wording between suggestions.
4. Return ONLY valid JSON.

Return format:
{ "suggestions": ["prompt 1", "prompt 2", "prompt 3", "prompt 4"] }`;
}

function buildGenericPromptRequest(mode, randomSeed) {
  return `You are a social media creative strategist.
Generate 4 distinct ${mode === 'text-to-video' ? 'video' : 'image'} prompt suggestions.

Randomization seed: ${randomSeed}
Current date: ${new Date().toISOString()}

Rules:
1. Suggestions must be varied across campaign, product, tutorial, and lifestyle content.
2. Each suggestion must be under 26 words.
3. Avoid cliches and repeated wording.
4. Return ONLY valid JSON.

Return format:
{ "suggestions": ["prompt 1", "prompt 2", "prompt 3", "prompt 4"] }`;
}

function buildLastResortPrompts(mode) {
  const seed = Date.now() % 100000;
  const base = mode === 'text-to-video'
    ? 'Vertical social video concept'
    : 'Social image concept';
  return [
    `${base}: launch teaser with layered motion graphics and clean brand typography ${seed}`,
    `${base}: behind-the-scenes workflow with candid subject framing and realistic lighting ${seed + 1}`,
    `${base}: product storytelling scene with bold composition and high texture detail ${seed + 2}`,
    `${base}: educational tip card visual with clear hierarchy and branded accent color ${seed + 3}`,
  ];
}

export function clearSuggestionsCache(userId, mode = 'create-image') {
  if (!userId) return;
  localStorage.removeItem(`socialai_suggestions_${userId}_${mode}`);
}
