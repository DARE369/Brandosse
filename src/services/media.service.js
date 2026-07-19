// src/services/media.service.js
// Client wrapper for the fal.ai-backed media edge functions
// (generateImage, editImage). generateVideo is submit-and-return as of
// Week 3 Fix 3 — see videoJobsService.js / BackgroundJobsStore.js. Image/
// edit generation still render synchronously server-side, but every call
// carries a request_id/request_slot idempotency key (Week 3 Fix 2) and
// accepts an AbortSignal so Cancel can actually abort an in-flight request
// instead of only hiding it client-side.
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
      if (body?.error) return { message: String(body.error), retryAfterSeconds: body.retry_after_seconds };
      if (body?.message) return { message: String(body.message), retryAfterSeconds: body.retry_after_seconds };
      return { message: JSON.stringify(body) };
    }

    if (typeof context.text === 'function') {
      const text = await context.text();
      if (!text) return null;
      try {
        const parsed = JSON.parse(text);
        if (parsed?.error) return { message: String(parsed.error), retryAfterSeconds: parsed.retry_after_seconds };
        if (parsed?.message) return { message: String(parsed.message), retryAfterSeconds: parsed.retry_after_seconds };
      } catch (_err) {
        // Non-JSON error text.
      }
      return { message: text };
    }
  } catch (_err) {
    // Fall through to fallback below.
  }

  return null;
}

async function toInvokeError(error, fallback = 'Edge Function request failed') {
  if (!error) return new Error(fallback);

  const status = error?.context?.status || error?.response?.status || null;
  const detailed = await parseFunctionErrorContext(error);

  // WEEK 2 FIX 5 (+ ADDENDUM UPGRADE 3): our own rate limiter's 429 must
  // not be re-labeled as a fal.ai provider-quota message —
  // normalizeMediaErrorMessage's "rate limit"/"429" substring check below
  // exists for fal.ai's OWN quota errors and would otherwise wrongly tell
  // the user to "update billing." Checking the real HTTP status first
  // routes our own 429s to their own message + a real retry-after instead.
  if (status === 429) {
    const retryAfterSeconds = Number(detailed?.retryAfterSeconds);
    const normalizedError = new Error(detailed?.message || "You're going a bit fast — try again in a few seconds.");
    normalizedError.retryAfterSeconds = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.ceil(retryAfterSeconds)
      : 5;
    return normalizedError;
  }

  if (detailed?.message) return new Error(normalizeMediaErrorMessage(detailed.message, fallback));

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
    // Reproducibility fields the edge fn writes to metadata AND returns in its
    // response. Captured here so the pipeline's own row update reinforces them
    // instead of overwriting the row's metadata with a copy that dropped them
    // (see normalizeGeneratedAsset in generationPipeline.js).
    seed: data.seed ?? null,
    imageModel: data.image_model || data.imageModel || null,
  };
}

async function invokeFunction(name, body, { signal } = {}) {
  const { data, error } = await supabase.functions.invoke(name, { body, signal });
  if (error) throw await toInvokeError(error, `${name} failed`);
  return data;
}

// Distinguishes "the caller aborted this on purpose" from a real failure so
// batch loops (generationPipeline.js) can skip refund/error bookkeeping for
// requests that were never actually sent to a provider.
export function isAbortError(error) {
  return error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('abort');
}

// `requestId` identifies one user-initiated generation ATTEMPT (a Retry
// click mints a new one via crypto.randomUUID() at the call site; an
// internal/network-level retry of the same attempt reuses it). Each image
// in a batch gets its own request_slot (0-based) under that same requestId
// so the server can idempotently cache/replay each slot independently.
export async function generateImages({
  prompt,
  aspectRatio = '1:1',
  numImages = 1,
  brandKit = null,
  imageModel = 'ideogram',
  sessionId = null,
  providerOptions = {},
  category = 'image',
  requestId = null,
  slotOffset = 0,
  generationId = null,
  // When the prompt has ALREADY been enhanced upstream (the content-plan
  // pipeline builds a full render prompt), pass false to skip the edge fn's
  // own enhancement — otherwise the same text gets rewritten twice (1.3).
  // Raw/direct callers leave this undefined so the edge fn's model-aware
  // single pass still runs.
  enhancePrompt,
  // 4.1: reference images (brand anchors / pinned subject) — when present the
  // edge fn routes to FLUX.2's multi-reference endpoint for brand/subject
  // consistency, regardless of imageModel.
  referenceImageUrls = null,
  signal,
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
      ...(enhancePrompt === false ? { enhance_prompt: false } : {}),
      ...(Array.isArray(referenceImageUrls) && referenceImageUrls.length
        ? { reference_image_urls: referenceImageUrls.filter(Boolean).slice(0, 9) }
        : {}),
      // request_id / slot: see idempotency note above.
      request_id: requestId,
      request_slot: slotOffset + index,
      generation_id: count === 1 ? generationId : null,
      image_model: imageModel || undefined,
      rendering_speed: providerOptions.renderingSpeed || providerOptions.rendering_speed,
      negative_prompt: providerOptions.negativePrompt || providerOptions.negative_prompt,
      recraft_style: providerOptions.recraftStyle || providerOptions.recraft_style,
      category,
    }, { signal });

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
      generationId: data.generation_id || null,
      promptUsed: data.prompt_used || data.promptUsed || null,
      ...normalizeProviderPayload(data),
    });

    if (typeof onProgress === 'function') {
      onProgress(Math.round(((index + 1) / count) * 100));
    }
  }

  return images;
}

// Fire-and-forget visual quality gate (2.1). Called by the pipeline AFTER a
// generation row is marked completed — never awaited in the render path, so it
// can't delay first paint. The edge fn scores the image and writes
// metadata.quality onto the row; the UI picks it up via realtime. Any failure
// is swallowed here: a quality score is a nice-to-have, never a reason to
// surface an error on an image that already rendered and was billed.
export function triggerQualityGate(generationId) {
  if (!generationId) return;
  try {
    // Deliberately not awaited.
    supabase.functions
      .invoke('quality-gate', { body: { generation_id: generationId } })
      .catch((err) => console.warn('[quality-gate] trigger failed (non-fatal):', err?.message || err));
  } catch (err) {
    console.warn('[quality-gate] trigger threw (non-fatal):', err?.message || err);
  }
}

export async function editImage({
  prompt,
  sourceImageUrl,
  brandKit = null,
  aspectRatio = '1:1',
  requestId = null,
  generationId = null,
  signal,
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
    request_id: requestId,
    request_slot: 0,
    generation_id: generationId,
  }, { signal });

  const dimensions = getDimensions(aspectRatio);
  return {
    url: data.publicUrl,
    width: dimensions.width,
    height: dimensions.height,
    storagePath: data.storagePath || null,
    generationCost: data.credits_used ?? 3,
    generationId: data.generation_id || null,
    ...normalizeProviderPayload(data),
  };
}

// Week 3 Fix 3: generateVideo is submit-and-return now — this resolves as
// soon as fal.ai accepts the job (seconds), not after the video finishes
// rendering (minutes). The actual video appears later via
// subscribeToBackgroundJobs/subscribeToSession realtime updates, not this
// call's return value.
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
  requestId = null,
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
    request_id: requestId,
  });

  if (!data.job_id) {
    throw new Error('Video submission did not return a job id');
  }

  return {
    jobId: data.job_id,
    generationId: data.generation_id || null,
    status: data.status || 'running',
    requestedQuality: data.requested_quality || resolvedQuality,
    actualQuality: data.quality || resolvedQuality,
    tierUpgraded: Boolean(data.tier_upgraded),
    tierUpgradeReason: data.tier_upgrade_reason || null,
    generationCost: data.credits_used ?? null,
  };
}
