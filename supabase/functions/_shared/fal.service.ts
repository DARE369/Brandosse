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

export type FalImageSize =
  | "square_hd" | "square"
  | "portrait_4_3" | "portrait_16_9"
  | "landscape_4_3" | "landscape_16_9";

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

interface QueueSubmitResult { request_id: string; status: string; queue_position?: number }

async function queueSubmit(modelId: string, input: unknown, apiKey: string): Promise<string> {
  const res = await fetch(`${FAL_QUEUE_BASE}/${modelId}`, {
    method: "POST",
    headers: falHeaders(apiKey),
    body: JSON.stringify({ input }),
  });
  await checkFalError(res, "queue submit");
  const data: QueueSubmitResult = await res.json();
  if (!data.request_id) throw new Error("fal.ai did not return a request_id");
  return data.request_id;
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
    body: JSON.stringify({ input }),
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
 * Map a user-facing aspect ratio string to the fal image_size enum.
 * Accepts "1:1", "16:9", "9:16", "4:5", "4:3", etc.
 */
export function aspectToFalImageSize(aspect: string): FalImageSize {
  const map: Record<string, FalImageSize> = {
    "1:1":  "square_hd",
    "4:3":  "landscape_4_3",
    "16:9": "landscape_16_9",
    "3:4":  "portrait_4_3",
    "9:16": "portrait_16_9",
  };
  return map[aspect] ?? "square_hd";
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
