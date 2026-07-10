// src/services/media.service.js
// Client wrapper for the fal.ai-backed media edge functions
// (generateImage, editImage, generateVideo). All three edge functions render
// synchronously server-side (fal.ai queue polling happens inside the edge
// function itself), so there is no client-side job-status polling here.
import { supabase } from './supabaseClient';

const ASPECT_DIMENSIONS = {
  '1:1': { width: 2048, height: 2048 },
  '16:9': { width: 2730, height: 1536 },
  '9:16': { width: 1536, height: 2730 },
  '4:5': { width: 2048, height: 2560 },
};

function cleanPrompt(prompt) {
  return String(prompt || '').trim();
}

function normalizeMediaErrorMessage(message, fallback = 'Media generation failed') {
  const text = String(message || '').trim();
  if (!text) return fallback;

  const lower = text.toLowerCase();
  if (
    lower.includes('free trial')
    || lower.includes('trial usage')
    || lower.includes('upgrade to a paid plan')
    || lower.includes('developers/dashboard/billing')
    || lower.includes('quota')
    || lower.includes('rate limit')
    || lower.includes('429')
  ) {
    return 'Media generation quota is exhausted for the connected media account. Update billing or connect a media key with available quota, then try again.';
  }

  if (
    lower.includes('not configured')
    || lower.includes('missing')
    || lower.includes('api key')
  ) {
    return 'Media generation is not configured on the server. Add the FAL_API_KEY secret and redeploy the media functions.';
  }

  return text;
}

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
    // Fall through to fallback below.
  }

  return null;
}

async function toInvokeError(error, fallback = 'Edge Function request failed') {
  if (!error) return new Error(fallback);

  const detailed = await parseFunctionErrorContext(error);
  if (detailed) return new Error(normalizeMediaErrorMessage(detailed, fallback));

  if (error instanceof Error && error.message?.trim()) return new Error(normalizeMediaErrorMessage(error.message, fallback));
  if (typeof error.message === 'string' && error.message.trim()) return new Error(normalizeMediaErrorMessage(error.message, fallback));
  return new Error(fallback);
}

function getDimensions(aspectRatio = '1:1') {
  return ASPECT_DIMENSIONS[aspectRatio] || ASPECT_DIMENSIONS['1:1'];
}

function normalizeProviderPayload(data = {}) {
  return {
    provider: data.provider || 'fal-ai',
    providerModel: data.providerModel || data.provider_model || null,
    providerEndpoint: data.providerEndpoint || data.provider_endpoint || null,
    generationTimeMs: Number(data.generationTimeMs || data.generation_time_ms || 0) || null,
  };
}

async function invokeFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw await toInvokeError(error, `${name} failed`);
  return data;
}

export async function generateImages({
  prompt,
  aspectRatio = '1:1',
  numImages = 1,
  brandKit = null,
  imageModel = 'ideogram',
  sessionId = null,
  providerOptions = {},
  category = 'image',
  onProgress,
}) {
  const cleanedPrompt = cleanPrompt(prompt);
  if (!cleanedPrompt) {
    throw new Error('Prompt is required for image generation');
  }

  const count = Math.max(1, Math.min(Number(numImages) || 1, 4));
  const dimensions = getDimensions(aspectRatio);
  const images = [];

  for (let index = 0; index < count; index += 1) {
    const data = await invokeFunction('generateImage', {
      prompt: cleanedPrompt,
      brandKit,
      aspect_ratio: aspectRatio,
      output_format: providerOptions.outputFormat || providerOptions.output_format || 'jpeg',
      session_id: sessionId || null,
      record_generation: false,
      image_model: imageModel || undefined,
      rendering_speed: providerOptions.renderingSpeed || providerOptions.rendering_speed,
      negative_prompt: providerOptions.negativePrompt || providerOptions.negative_prompt,
      recraft_style: providerOptions.recraftStyle || providerOptions.recraft_style,
      category,
    });

    const publicUrl = data.publicUrl || data.public_url || data.url;
    if (!publicUrl) {
      throw new Error('Image renderer returned no image URL');
    }

    images.push({
      url: publicUrl,
      width: dimensions.width,
      height: dimensions.height,
      storagePath: data.storagePath || data.storage_path || null,
      generationCost: data.credits_used ?? null,
      ...normalizeProviderPayload(data),
    });

    if (typeof onProgress === 'function') {
      onProgress(Math.round(((index + 1) / count) * 100));
    }
  }

  return images;
}

export async function editImage({
  prompt,
  sourceImageUrl,
  brandKit = null,
  aspectRatio = '1:1',
}) {
  const cleanedPrompt = cleanPrompt(prompt);
  const cleanedSource = cleanPrompt(sourceImageUrl);

  if (!cleanedPrompt) throw new Error('Edit instruction is required');
  if (!cleanedSource) throw new Error('Source image is required');

  const data = await invokeFunction('editImage', {
    prompt: cleanedPrompt,
    sourceImageUrl: cleanedSource,
    brandKit,
    aspectRatio,
    record_generation: false,
  });

  const dimensions = getDimensions(aspectRatio);
  return {
    url: data.publicUrl,
    width: dimensions.width,
    height: dimensions.height,
    storagePath: data.storagePath || null,
    generationCost: data.credits_used ?? 3,
    ...normalizeProviderPayload(data),
  };
}

export async function createVideoJob({
  prompt,
  aspectRatio = '16:9',
  duration = 6,
  brandKit = null,
  mode = 'text-to-video',
  imageUrl = null,
  referenceImageUrl = null,
  quality,
  sessionId = null,
}) {
  const cleanedPrompt = cleanPrompt(prompt);
  if (!cleanedPrompt) throw new Error('Prompt is required for video generation');

  const cleanedImageUrl = cleanPrompt(imageUrl || referenceImageUrl);
  if (mode === 'image-to-video' && !cleanedImageUrl) {
    throw new Error('Source image is required for image-to-video generation');
  }

  const normalizedDuration = Number(duration) > 5 ? '10' : '5';
  const resolvedQuality = quality || 'standard';

  const data = await invokeFunction('generateVideo', {
    prompt: cleanedPrompt,
    brandKit,
    aspect_ratio: aspectRatio,
    duration: normalizedDuration,
    quality: resolvedQuality,
    image_url: mode === 'image-to-video' ? cleanedImageUrl : null,
    session_id: sessionId || null,
    record_generation: false,
  });

  const videoUrl = data.videoUrl || data.video_url || data.publicUrl || data.public_url || data.url || null;
  if (!videoUrl) {
    throw new Error('Video renderer returned no video URL');
  }

  return {
    status: 'completed',
    videoUrl,
    storagePath: data.storagePath || data.storage_path || null,
    generationCost: data.credits_used ?? null,
    requestedQuality: data.requested_quality || resolvedQuality,
    actualQuality: data.quality || resolvedQuality,
    tierUpgraded: Boolean(data.tier_upgraded),
    tierUpgradeReason: data.tier_upgrade_reason || null,
    ...normalizeProviderPayload(data),
  };
}
