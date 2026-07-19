/**
 * fal.service.ts — shared fal.ai client for Supabase Edge Functions (Deno).
 *
 * Wraps the fal.ai queue REST API directly (no Node SDK — Deno-safe).
 * Docs: https://docs.fal.ai/model-endpoints/queue
 *
 * Provider: fal.ai
 * Auth:     FAL_API_KEY secret (set via: npx supabase secrets set FAL_API_KEY=...)
 *
 * Models used in this app:
 *   Image:        fal-ai/flux-2-pro          ($0.03/MP — photorealistic)
 *   Video std:    fal-ai/minimax/video-01     (~$0.50/clip — Hailuo 2.3 standard)
 *   Video pro:    fal-ai/kling-video/v2.5/pro (~$0.07/sec — Kling 2.5 cinematic)
 */

import { readEnv } from "./env.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

// fal.ai image models accept image_size as EITHER a named preset OR an
// explicit { width, height } object. The presets are coarse (there is no
// portrait_4_5), so for social ratios the enum can't express exactly — 4:5
// (Instagram portrait) being the important one — we pass explicit dimensions
// instead of silently snapping to the nearest preset (which used to drop 4:5
// to square_hd — see aspectToFalImageSize).
export type FalImageDimensions = { width: number; height: number };

export type FalImageSize =
  | "square_hd" | "square"
  | "portrait_4_3" | "portrait_16_9"
  | "landscape_4_3" | "landscape_16_9"
  | FalImageDimensions;

export type FalVideoAspect = "16:9" | "9:16" | "1:1";
export type FalVideoDuration = "5" | "10";

export interface FalImageInput {
  prompt: string;
  image_size?: FalImageSize;
  seed?: number;
  output_format?: "jpeg" | "png";
  enable_safety_checker?: boolean;
  /** Optional reference images using @image1, @image2 in prompt */
  image_urls?: string[];
}

export interface FalTextToVideoInput {
  prompt: string;
  duration?: FalVideoDuration;
  aspect_ratio?: FalVideoAspect;
  negative_prompt?: string;
  cfg_scale?: number;
}

export interface FalImageToVideoInput {
  prompt: string;
  image_url: string;
  duration?: FalVideoDuration;
  aspect_ratio?: FalVideoAspect;
  negative_prompt?: string;
}

export interface FalImageResult {
  images: Array<{ url: string; width?: number; height?: number; content_type?: string }>;
  seed?: number;
  prompt?: string;
  timings?: Record<string, number>;
}

export interface FalVideoResult {
  video: { url: string; content_type?: string; width?: number; height?: number };
}

// ── Constants ────────────────────────────────────────────────────────────────

const FAL_QUEUE_BASE = "https://queue.fal.run";
const FAL_RUN_BASE   = "https://fal.run";

export const FAL_MODELS = {
  imageFlux2Pro:    "fal-ai/flux-2-pro",
  imageFlux2Edit:   "fal-ai/flux-2-pro/edit",             // FLUX.2 multi-reference — up to ~9 image_urls for brand/subject consistency (4.1)
  imageIdeogramV3:  "fal-ai/ideogram/v3",                 // best exact-text rendering (flyers, captions in-image)
  imageRecraftV3:   "fal-ai/recraft/v3/text-to-image",    // typography/vector + brand-color control
  imageEditKontext: "fal-ai/flux-pro/kontext",            // prompt-driven edit of an existing image
  videoHailuo23:    "fal-ai/minimax/video-01",    // Hailuo 2.3 standard — image-to-video
  videoKling25Pro:  "fal-ai/kling-video/v2.5/pro", // Kling 2.5 Pro text-to-video
  videoKling25I2V:  "fal-ai/kling-video/v2.5/pro/image-to-video",
} as const;

export type FalImageModel = "ideogram" | "recraft" | "flux";

// ── Internal helpers ──────────────────────────────────────────────────────────

function getFalKey(): string {
  const key = readEnv("FAL_API_KEY", false);
  if (!key) throw new Error("FAL_API_KEY is not configured in Supabase secrets.");
  return key;
}

function falHeaders(apiKey: string) {
  return {
    "Authorization": `Key ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function checkFalError(res: Response, context: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`fal.ai ${context} failed (${res.status}): ${body}`);
  }
}

// ── Queue-based async generation (for video + large images) ──────────────────

interface QueueSubmitResult {
  request_id: string;
  status: string;
  queue_position?: number;
  status_url?: string;
  response_url?: string;
  cancel_url?: string;
}

/**
 * Returns fal.ai's FULL submit response, not just request_id. This matters:
 * fal.ai's queue status/response/cancel endpoints are keyed on the app's
 * BASE id (e.g. "fal-ai/kling-video"), not the full model endpoint id used
 * at submit time (e.g. "fal-ai/kling-video/v2.5/pro" — the "/v2.5/pro" is a
 * model-variant suffix, submit-only). Reconstructing the status/response
 * URL by guessing how many path segments to keep is fragile and was
 * confirmed WRONG live (2026-07-12): a real Kling video completed
 * successfully on fal.ai's side, but our own status URL (built from the
 * full model id) 405'd on every poll, so the job was never recognized as
 * done and was eventually given up on / refunded despite fal.ai having
 * already rendered it. fal.ai's own submit response already includes the
 * correct status_url/response_url/cancel_url — using those directly avoids
 * ever needing to guess this again for any current or future model.
 */
async function queueSubmit(modelId: string, input: unknown, apiKey: string, webhookUrl?: string): Promise<QueueSubmitResult> {
  const url = webhookUrl
    ? `${FAL_QUEUE_BASE}/${modelId}?fal_webhook=${encodeURIComponent(webhookUrl)}`
    : `${FAL_QUEUE_BASE}/${modelId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: falHeaders(apiKey),
    body: JSON.stringify({ input }),
  });
  await checkFalError(res, "queue submit");
  const data: QueueSubmitResult = await res.json();
  if (!data.request_id) throw new Error("fal.ai did not return a request_id");
  return data;
}

export type QueueStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | string;

/**
 * Submit-and-return for Week 3 Fix 3's async video job mechanism — unlike
 * queueSubmit+queuePoll (which blocks the caller until fal.ai resolves),
 * this returns the fal request id immediately so the edge function can
 * respond to the client right away and let fal.ai's own webhook (preferred)
 * or the process-jobs poller (fallback) observe completion later.
 *
 * Persists statusUrl/responseUrl/cancelUrl (fal.ai's own, authoritative
 * URLs from the submit response) alongside falRequestId/modelId — callers
 * should store all of these and pass the URLs back into
 * getQueueStatus/getQueueResult/cancelQueueJob rather than reconstructing
 * them from modelId.
 */
export async function submitVideoJob(
  modelId: string,
  input: unknown,
  webhookUrl?: string,
): Promise<{ falRequestId: string; modelId: string; statusUrl: string; responseUrl: string; cancelUrl: string }> {
  const apiKey = getFalKey();
  const result = await queueSubmit(modelId, input, apiKey, webhookUrl);
  return {
    falRequestId: result.request_id,
    modelId,
    statusUrl: result.status_url || `${FAL_QUEUE_BASE}/${modelId}/requests/${result.request_id}/status`,
    responseUrl: result.response_url || `${FAL_QUEUE_BASE}/${modelId}/requests/${result.request_id}`,
    cancelUrl: result.cancel_url || `${FAL_QUEUE_BASE}/${modelId}/requests/${result.request_id}/cancel`,
  };
}

/** Used by the process-jobs poller (fallback for dropped webhooks) and the
 * job-webhook function (to fetch the final result once notified). Takes
 * fal.ai's own status_url directly (see submitVideoJob) rather than
 * reconstructing it from a model id. */
export async function getQueueStatus(statusUrl: string): Promise<{ status: QueueStatus; error?: string }> {
  const apiKey = getFalKey();
  const res = await fetch(statusUrl, { headers: falHeaders(apiKey) });
  await checkFalError(res, "queue status");
  return res.json();
}

export async function getQueueResult<T = FalVideoResult>(responseUrl: string): Promise<T> {
  const apiKey = getFalKey();
  const res = await fetch(responseUrl, { headers: falHeaders(apiKey) });
  await checkFalError(res, "queue response");
  return res.json() as Promise<T>;
}

/** Best-effort cancellation — not all fal.ai models support queue cancel;
 * failures here are swallowed by the caller (see cancel-job edge action)
 * since a job already marked cancelled locally should not resurrect on a
 * fal-side error. Takes fal.ai's own cancel_url directly (see submitVideoJob). */
export async function cancelQueueJob(cancelUrl: string): Promise<boolean> {
  try {
    const apiKey = getFalKey();
    const res = await fetch(cancelUrl, { method: "PUT", headers: falHeaders(apiKey) });
    return res.ok;
  } catch {
    return false;
  }
}

async function queuePoll<T>(
  modelId: string,
  requestId: string,
  apiKey: string,
  opts: { maxWaitMs?: number; pollIntervalMs?: number } = {},
): Promise<T> {
  const maxWait   = opts.maxWaitMs      ?? 180_000; // 3 min
  const interval  = opts.pollIntervalMs ?? 3_000;
  const start     = Date.now();

  while (Date.now() - start < maxWait) {
    const statusRes = await fetch(
      `${FAL_QUEUE_BASE}/${modelId}/requests/${requestId}/status`,
      { headers: falHeaders(apiKey) },
    );
    await checkFalError(statusRes, "queue status");
    const status = await statusRes.json();

    if (status.status === "COMPLETED") {
      const resultRes = await fetch(
        `${FAL_QUEUE_BASE}/${modelId}/requests/${requestId}/response`,
        { headers: falHeaders(apiKey) },
      );
      await checkFalError(resultRes, "queue response");
      return resultRes.json() as T;
    }

    if (status.status === "FAILED") {
      throw new Error(`fal.ai generation failed: ${status.error ?? "unknown error"}`);
    }

    // IN_QUEUE or IN_PROGRESS — keep waiting
    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error(`fal.ai generation timed out after ${maxWait / 1000}s`);
}

// ── Synchronous run (for fast images — FLUX.2 Pro typically < 10s) ────────────

async function falRunSync<T>(modelId: string, input: unknown, apiKey: string): Promise<T> {
  const res = await fetch(`${FAL_RUN_BASE}/${modelId}`, {
    method: "POST",
    headers: falHeaders(apiKey),
    // fal.ai's SYNC endpoint (fal.run/{model}) takes the model's parameters
    // directly as the request body — unlike the QUEUE endpoint
    // (queue.fal.run/{model}, see queueSubmit above), which wraps them in an
    // {"input": {...}} envelope. Wrapping here double-nested the payload
    // (fal.ai received {"input": {"input": {prompt: ...}}}), which fal.ai's
    // own validation correctly rejected as a missing "prompt" field — found
    // live 2026-07-12 once a valid FAL_API_KEY let requests actually reach
    // this validation step for the first time.
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(60_000), // 60s hard timeout
  });
  await checkFalError(res, "sync run");
  return res.json() as T;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate an image with FLUX.2 Pro (fal.ai).
 * Uses sync run — typically returns in 3–10 seconds.
 */
export async function generateImageFlux(input: FalImageInput): Promise<FalImageResult> {
  const apiKey = getFalKey();

  // FLUX.2 Pro: aspect ratio maps to image_size
  const normalized: Record<string, unknown> = {
    prompt:                 input.prompt,
    image_size:             input.image_size ?? "square_hd",
    output_format:          input.output_format ?? "jpeg",
    enable_safety_checker:  input.enable_safety_checker ?? true,
  };
  if (input.seed !== undefined) normalized.seed = input.seed;

  // Try sync first; fall back to queue if the model is busy
  try {
    return await falRunSync<FalImageResult>(FAL_MODELS.imageFlux2Pro, normalized, apiKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("503") || msg.includes("timeout")) {
      // Retry via queue
      const reqId = await queueSubmit(FAL_MODELS.imageFlux2Pro, normalized, apiKey);
      return await queuePoll<FalImageResult>(FAL_MODELS.imageFlux2Pro, reqId, apiKey);
    }
    throw err;
  }
}

/**
 * FLUX.2 with REFERENCE images (4.1 — brand/subject consistency). Uses the
 * multi-reference edit endpoint (fal-ai/flux-2-pro/edit), which accepts up to
 * ~9 image_urls and generates a NEW image guided by them (brand style, a
 * recurring product/character), rather than a plain text-to-image. Only used
 * when references are actually present — the plain generateImageFlux path is
 * unchanged for reference-free requests.
 */
export async function generateImageFluxRef(input: FalImageGenInput): Promise<FalImageResult> {
  const apiKey = getFalKey();
  const refs = (input.image_urls || []).filter(Boolean).slice(0, 9);
  const normalized: Record<string, unknown> = {
    prompt:        input.prompt,
    image_urls:    refs,
    image_size:    input.image_size ?? "square_hd",
    output_format: input.output_format ?? "jpeg",
  };
  if (input.seed !== undefined) normalized.seed = input.seed;
  return runImageModel(FAL_MODELS.imageFlux2Edit, normalized, apiKey);
}

// Shared sync-then-queue runner for image models (sync is fast; queue is the busy fallback).
async function runImageModel(
  modelId: string,
  normalized: Record<string, unknown>,
  apiKey: string,
): Promise<FalImageResult> {
  try {
    return await falRunSync<FalImageResult>(modelId, normalized, apiKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("503") || msg.includes("timeout")) {
      const reqId = await queueSubmit(modelId, normalized, apiKey);
      return await queuePoll<FalImageResult>(modelId, reqId, apiKey);
    }
    throw err;
  }
}

export interface FalImageGenInput extends FalImageInput {
  rendering_speed?: "TURBO" | "BALANCED" | "QUALITY";
  negative_prompt?: string;
  recraft_style?: string;
  /** Brand colors for Recraft color steering, as RGB triples. */
  brand_colors?: Array<{ r: number; g: number; b: number }>;
}

/**
 * Ideogram v3 — best at rendering exact, legible text in images (flyers, posters).
 */
export async function generateImageIdeogram(input: FalImageGenInput): Promise<FalImageResult> {
  const apiKey = getFalKey();
  const normalized: Record<string, unknown> = {
    prompt:          input.prompt,
    image_size:      input.image_size ?? "square_hd",
    rendering_speed: input.rendering_speed ?? "BALANCED",
    num_images:      1,
    expand_prompt:   false,
  };
  if (input.seed !== undefined) normalized.seed = input.seed;
  if (input.negative_prompt) normalized.negative_prompt = input.negative_prompt;
  return runImageModel(FAL_MODELS.imageIdeogramV3, normalized, apiKey);
}

/**
 * Recraft V3 — strong typography + vector, with explicit brand-color control.
 */
export async function generateImageRecraft(input: FalImageGenInput): Promise<FalImageResult> {
  const apiKey = getFalKey();
  const normalized: Record<string, unknown> = {
    prompt:     input.prompt,
    image_size: input.image_size ?? "square_hd",
    style:      input.recraft_style ?? "realistic_image",
  };
  if (Array.isArray(input.brand_colors) && input.brand_colors.length) {
    normalized.colors = input.brand_colors.slice(0, 5);
  }
  return runImageModel(FAL_MODELS.imageRecraftV3, normalized, apiKey);
}

export interface FalImageEditInput {
  prompt: string;
  image_url: string;
  aspect_ratio?: string;
  seed?: number;
  output_format?: "jpeg" | "png";
  guidance_scale?: number;
}

/**
 * Edit an existing image with a text prompt using FLUX.1 Kontext Pro (fal.ai).
 * Sync-first, queue fallback — same pattern as the other image models.
 */
export async function generateImageEdit(input: FalImageEditInput): Promise<FalImageResult> {
  const apiKey = getFalKey();
  const normalized: Record<string, unknown> = {
    prompt:         input.prompt,
    image_url:      input.image_url,
    output_format:  input.output_format ?? "jpeg",
    guidance_scale: input.guidance_scale ?? 3.5,
  };
  if (input.seed !== undefined) normalized.seed = input.seed;
  if (input.aspect_ratio) normalized.aspect_ratio = input.aspect_ratio;

  return runImageModel(FAL_MODELS.imageEditKontext, normalized, apiKey);
}

/**
 * Route an image generation to the chosen provider. Default: Ideogram (exact text).
 * Returns the result plus which provider/model/cost was actually used.
 */
export async function generateImageByModel(
  model: FalImageModel | undefined,
  input: FalImageGenInput,
): Promise<{ result: FalImageResult; provider: string; modelId: string; costUsd: number }> {
  const hasRefs = Array.isArray(input.image_urls) && input.image_urls.filter(Boolean).length > 0;

  // 4.1: reference images route to FLUX.2's multi-reference endpoint — the one
  // model here with real, documented reference support. Ideogram/Recraft don't
  // support it reliably, so references there gracefully no-op (plain gen). This
  // means a "match these" request effectively renders on FLUX regardless of the
  // intent-picked model, which is correct: brand/subject fidelity is a photo-
  // consistency job, exactly FLUX's strength.
  if (hasRefs) {
    return { result: await generateImageFluxRef(input), provider: "fal-ai", modelId: FAL_MODELS.imageFlux2Edit, costUsd: FAL_COST_USD.imageFluxPerMP };
  }

  switch (model) {
    case "recraft":
      return { result: await generateImageRecraft(input), provider: "fal-ai", modelId: FAL_MODELS.imageRecraftV3, costUsd: FAL_COST_USD.imageRecraft };
    case "flux":
      return { result: await generateImageFlux(input), provider: "fal-ai", modelId: FAL_MODELS.imageFlux2Pro, costUsd: FAL_COST_USD.imageFluxPerMP };
    case "ideogram":
    default:
      return { result: await generateImageIdeogram(input), provider: "fal-ai", modelId: FAL_MODELS.imageIdeogramV3, costUsd: FAL_COST_USD.imageIdeogramBalanced };
  }
}

/**
 * Generate a standard video with Hailuo 2.3 (image-to-video).
 * Queue-based — takes 30–90 seconds.
 */
export async function generateVideoHailuo(input: FalImageToVideoInput): Promise<FalVideoResult> {
  const apiKey = getFalKey();
  const normalized = {
    prompt:       input.prompt,
    image_url:    input.image_url,
    duration:     input.duration     ?? "5",
    aspect_ratio: input.aspect_ratio ?? "16:9",
  };
  const reqId = await queueSubmit(FAL_MODELS.videoHailuo23, normalized, apiKey);
  return await queuePoll<FalVideoResult>(FAL_MODELS.videoHailuo23, reqId, apiKey, { maxWaitMs: 180_000 });
}

/**
 * Generate a premium video with Kling 2.5 Pro (text-to-video).
 * Queue-based — takes 1–4 minutes for cinematic quality.
 */
export async function generateVideoKling(input: FalTextToVideoInput): Promise<FalVideoResult> {
  const apiKey = getFalKey();
  const normalized = {
    prompt:          input.prompt,
    duration:        input.duration        ?? "5",
    aspect_ratio:    input.aspect_ratio    ?? "16:9",
    negative_prompt: input.negative_prompt ?? "blurry, distorted, low quality, watermark",
    cfg_scale:       input.cfg_scale       ?? 0.5,
  };
  const reqId = await queueSubmit(FAL_MODELS.videoKling25Pro, normalized, apiKey);
  return await queuePoll<FalVideoResult>(FAL_MODELS.videoKling25Pro, reqId, apiKey, { maxWaitMs: 300_000 });
}

/**
 * Image-to-video with Kling 2.5 Pro (best for brand storytelling).
 */
export async function generateVideoKlingI2V(input: FalImageToVideoInput): Promise<FalVideoResult> {
  const apiKey = getFalKey();
  const normalized = {
    prompt:          input.prompt,
    image_url:       input.image_url,
    duration:        input.duration        ?? "5",
    aspect_ratio:    input.aspect_ratio    ?? "16:9",
    negative_prompt: input.negative_prompt ?? "blurry, distorted, low quality, watermark",
  };
  const reqId = await queueSubmit(FAL_MODELS.videoKling25I2V, normalized, apiKey);
  return await queuePoll<FalVideoResult>(FAL_MODELS.videoKling25I2V, reqId, apiKey, { maxWaitMs: 300_000 });
}

/**
 * Submit-and-return variants of the three video generators above, for the
 * async job mechanism (Week 3 Fix 3). Same input normalization as
 * generateVideoHailuo/generateVideoKling/generateVideoKlingI2V; the only
 * difference is these return immediately with a fal request id instead of
 * blocking on queuePoll.
 */
export async function submitVideoHailuo(input: FalImageToVideoInput, webhookUrl?: string) {
  const normalized = {
    prompt:       input.prompt,
    image_url:    input.image_url,
    duration:     input.duration     ?? "5",
    aspect_ratio: input.aspect_ratio ?? "16:9",
  };
  return submitVideoJob(FAL_MODELS.videoHailuo23, normalized, webhookUrl);
}

export async function submitVideoKling(input: FalTextToVideoInput, webhookUrl?: string) {
  const normalized = {
    prompt:          input.prompt,
    duration:        input.duration        ?? "5",
    aspect_ratio:    input.aspect_ratio    ?? "16:9",
    negative_prompt: input.negative_prompt ?? "blurry, distorted, low quality, watermark",
    cfg_scale:       input.cfg_scale       ?? 0.5,
  };
  return submitVideoJob(FAL_MODELS.videoKling25Pro, normalized, webhookUrl);
}

export async function submitVideoKlingI2V(input: FalImageToVideoInput, webhookUrl?: string) {
  const normalized = {
    prompt:          input.prompt,
    image_url:       input.image_url,
    duration:        input.duration        ?? "5",
    aspect_ratio:    input.aspect_ratio    ?? "16:9",
    negative_prompt: input.negative_prompt ?? "blurry, distorted, low quality, watermark",
  };
  return submitVideoJob(FAL_MODELS.videoKling25I2V, normalized, webhookUrl);
}

/**
 * Map a user-facing aspect ratio string to a fal image_size value.
 * Accepts "1:1", "16:9", "9:16", "4:5", "4:3", "3:4", etc.
 *
 * Ratios the coarse preset enum expresses exactly use the preset; ratios it
 * does NOT (notably 4:5 — Instagram portrait, and 5:4) use explicit
 * dimensions so the delivered image is the ratio the user actually asked for.
 * Dimensions target ~1MP so cost (fal bills per megapixel) stays predictable
 * and comparable to the square_hd preset (1024²).
 */
export function aspectToFalImageSize(aspect: string): FalImageSize {
  const presets: Record<string, FalImageSize> = {
    "1:1":  "square_hd",
    "4:3":  "landscape_4_3",
    "16:9": "landscape_16_9",
    "3:4":  "portrait_4_3",
    "9:16": "portrait_16_9",
  };
  if (presets[aspect]) return presets[aspect];

  // Ratios with no exact preset → explicit ~1MP dimensions (multiples of 32,
  // which fal's models require).
  const explicit: Record<string, FalImageDimensions> = {
    "4:5": { width: 896,  height: 1120 }, // Instagram portrait
    "5:4": { width: 1120, height: 896 },
  };
  if (explicit[aspect]) return explicit[aspect];

  return "square_hd";
}

/**
 * Cost estimates (informational — used for credit deduction calculations).
 * fal.ai charges per megapixel for images, per second for video.
 */
export const FAL_COST_USD = {
  imageFluxPerMP:        0.030, // first MP; $0.015 each additional
  imageIdeogramBalanced: 0.060, // fal-ai/ideogram/v3 BALANCED (TURBO $0.03 / QUALITY $0.09)
  imageRecraft:          0.040, // fal-ai/recraft/v3 raster ($0.08 vector)
  imageEditKontext:      0.040, // fal-ai/flux-pro/kontext per edit
  videoHailouPerClip:    0.500, // per 5-6s clip
  videoKlingPerSec:      0.070, // per second of output
} as const;
