import { readEnv } from "./env.ts";

export class MagnificApiError extends Error {
  statusCode: number;
  details: string;

  constructor(message: string, statusCode: number, details = "") {
    super(message);
    this.name = "MagnificApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

type MagnificGeneratedItem = string | {
  url?: string;
  video_url?: string;
  image_url?: string;
  thumbnail_url?: string;
  [key: string]: unknown;
};

export type MagnificTaskData = {
  task_id?: string;
  status?: string;
  generated?: MagnificGeneratedItem[];
  progress?: number;
  percentage?: number;
  message?: string;
  error?: string;
  has_nsfw?: boolean[];
  [key: string]: unknown;
};

type MagnificEnvelope = {
  data?: MagnificTaskData;
  error?: string;
  message?: string;
};

const MAGNIFIC_API_BASE = "https://api.magnific.com";
export const PROVIDER_NAME = "magnific";

export const MAGNIFIC_ENDPOINTS = {
  mystic: "/v1/ai/mystic",
  flux2Pro: "/v1/ai/text-to-image/flux-2-pro",
  seedreamV45: "/v1/ai/text-to-image/seedream-v4-5",
  seedreamEdit: "/v1/ai/text-to-image/seedream-v4-5-edit",
  ltxTextToVideo: "/v1/ai/text-to-video/ltx-2-pro",
  ltxImageToVideo: "/v1/ai/image-to-video/ltx-2-pro",
  klingImageToVideo: "/v1/ai/image-to-video/kling-v2-6",
  klingImageToVideoCreate: "/v1/ai/image-to-video/kling-v2-6-pro",
} as const;

export function readMagnificApiKey(): string {
  const key = readEnv("MAGNIFIC_API_KEY", false);
  if (!key) {
    const error = new Error("Media generation is not configured on the server.");
    (error as Error & { statusCode?: number }).statusCode = 500;
    throw error;
  }
  return key;
}

async function magnificRequest(path: string, init: RequestInit): Promise<MagnificEnvelope> {
  const url = `${MAGNIFIC_API_BASE}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      "x-magnific-api-key": readMagnificApiKey(),
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  const rawText = await response.text();
  let parsed: MagnificEnvelope | null = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch (_error) {
      // Keep raw body for error details below.
    }
  }

  if (!response.ok) {
    const errorMessage = parsed?.error || parsed?.message || `Media provider request failed (${response.status})`;
    throw new MagnificApiError(errorMessage, response.status, rawText);
  }

  return parsed || {};
}

function taskDataOrThrow(envelope: MagnificEnvelope, endpoint: string): MagnificTaskData {
  if (!envelope?.data) {
    throw new Error(`Media provider ${endpoint} returned no task payload`);
  }
  return envelope.data;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function nonEmptyLine(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeWhitespace(value);
  return normalized ? normalized : null;
}

export function mergeBrandKitIntoPrompt(prompt: string, brandKit?: Record<string, unknown>): string {
  const basePrompt = normalizeWhitespace(prompt || "");
  if (!basePrompt) return "";
  if (!brandKit || Object.keys(brandKit).length === 0) return basePrompt;

  const lines: string[] = [];
  const summary = nonEmptyLine(brandKit.summary);
  if (summary) lines.push(summary);

  const assetContext = nonEmptyLine(brandKit.asset_context);
  if (assetContext) lines.push(assetContext);

  const raw = (typeof brandKit.raw === "object" && brandKit.raw !== null)
    ? (brandKit.raw as Record<string, unknown>)
    : null;

  if (raw) {
    const brandName = nonEmptyLine(raw.brand_name);
    const voice = nonEmptyLine(raw.brand_voice);
    const visualNotes = nonEmptyLine(raw.photo_style_notes);
    const avoid = Array.isArray(raw.avoid_visual_elements)
      ? raw.avoid_visual_elements.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];

    if (brandName) lines.push(`Brand: ${brandName}`);
    if (voice) lines.push(`Voice: ${voice}`);
    if (visualNotes) lines.push(`Style notes: ${visualNotes}`);
    if (avoid.length) lines.push(`Avoid: ${avoid.join(", ")}`);
  }

  if (!lines.length) return basePrompt;

  return `${basePrompt}\n\nBrand guardrails:\n- ${lines.join("\n- ")}`;
}

export function normalizeImageAspectRatio(value?: string): string {
  const normalized = (value || "1:1").trim();
  const map: Record<string, string> = {
    "1:1": "square_1_1",
    "16:9": "widescreen_16_9",
    "9:16": "social_story_9_16",
    "4:5": "social_post_4_5",
    "2:3": "portrait_2_3",
    "3:4": "traditional_3_4",
    "3:2": "standard_3_2",
    "4:3": "classic_4_3",
    square_1_1: "square_1_1",
    widescreen_16_9: "widescreen_16_9",
    social_story_9_16: "social_story_9_16",
    social_post_4_5: "social_post_4_5",
    portrait_2_3: "portrait_2_3",
  };
  return map[normalized] || map["1:1"];
}

export function normalizeVideoAspectRatio(value?: string): string {
  const normalized = (value || "16:9").trim();
  const map: Record<string, string> = {
    "16:9": "widescreen_16_9",
    "9:16": "social_story_9_16",
    "1:1": "square_1_1",
    widescreen_16_9: "widescreen_16_9",
    social_story_9_16: "social_story_9_16",
    square_1_1: "square_1_1",
  };
  return map[normalized] || "widescreen_16_9";
}

export function normalizeMysticModel(value?: string): string {
  const model = String(value || "realism").trim();
  const allowed = new Set(["realism", "fluid", "zen", "flexible", "super_real", "editorial_portraits"]);
  return allowed.has(model) ? model : "realism";
}

function normalizeImageModel(value?: string): string {
  const model = String(value || "realism").trim();
  if (model === "flux-2-pro" || model === "seedream-v4-5") return model;
  return normalizeMysticModel(model);
}

function dimensionsForImageAspectRatio(value?: string): { width: number; height: number } {
  const normalized = (value || "1:1").trim();
  const map: Record<string, { width: number; height: number }> = {
    "1:1": { width: 1024, height: 1024 },
    "4:5": { width: 1152, height: 1440 },
    "9:16": { width: 768, height: 1440 },
    "16:9": { width: 1440, height: 768 },
    square_1_1: { width: 1024, height: 1024 },
    social_post_4_5: { width: 1152, height: 1440 },
    social_story_9_16: { width: 768, height: 1440 },
    widescreen_16_9: { width: 1440, height: 768 },
  };
  return map[normalized] || map["1:1"];
}

export function normalizeResolution(value?: string): string {
  const resolution = String(value || "2k").trim().toLowerCase();
  return ["1k", "2k", "4k"].includes(resolution) ? resolution : "2k";
}

export function normalizeVideoResolution(value?: string): string {
  const resolution = String(value || "1080p").trim().toLowerCase();
  return ["1080p", "1440p", "2160p"].includes(resolution) ? resolution : "1080p";
}

export function normalizeVideoDuration(value?: number): 5 | 6 | 8 | 10 {
  if (value === 5 || value === 6 || value === 8 || value === 10) return value;
  return 6;
}

export function normalizeFps(value?: number): 25 | 50 {
  return value === 50 ? 50 : 25;
}

function cleanProviderOptions(options?: Record<string, unknown>) {
  return options && typeof options === "object" ? options : {};
}

export async function createImageTask(args: {
  prompt: string;
  aspectRatio?: string;
  model?: string;
  resolution?: string;
  providerOptions?: Record<string, unknown>;
}): Promise<MagnificTaskData & { provider_endpoint?: string; provider_model?: string }> {
  const providerOptions = cleanProviderOptions(args.providerOptions);
  const model = normalizeImageModel(args.model);

  if (model === "flux-2-pro") {
    const dimensions = dimensionsForImageAspectRatio(args.aspectRatio);
    const payload = {
      prompt: args.prompt,
      width: dimensions.width,
      height: dimensions.height,
      seed: typeof providerOptions.seed === "number" ? providerOptions.seed : undefined,
      prompt_upsampling: Boolean(providerOptions.prompt_upsampling),
    };

    const envelope = await magnificRequest(MAGNIFIC_ENDPOINTS.flux2Pro, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return {
      ...taskDataOrThrow(envelope, "flux 2 pro"),
      provider_endpoint: MAGNIFIC_ENDPOINTS.flux2Pro,
      provider_model: model,
    };
  }

  if (model === "seedream-v4-5") {
    const payload = {
      prompt: args.prompt,
      aspect_ratio: normalizeImageAspectRatio(args.aspectRatio),
      seed: typeof providerOptions.seed === "number" ? providerOptions.seed : undefined,
      enable_safety_checker: true,
    };

    const envelope = await magnificRequest(MAGNIFIC_ENDPOINTS.seedreamV45, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return {
      ...taskDataOrThrow(envelope, "seedream 4.5"),
      provider_endpoint: MAGNIFIC_ENDPOINTS.seedreamV45,
      provider_model: model,
    };
  }

  const payload = {
    prompt: args.prompt,
    aspect_ratio: normalizeImageAspectRatio(args.aspectRatio),
    resolution: normalizeResolution(args.resolution),
    model,
    creative_detailing: Number(providerOptions.creative_detailing ?? 33),
    engine: String(providerOptions.engine || "automatic"),
    fixed_generation: Boolean(providerOptions.fixed_generation),
    filter_nsfw: true,
  };

  const envelope = await magnificRequest(MAGNIFIC_ENDPOINTS.mystic, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return {
    ...taskDataOrThrow(envelope, "mystic"),
    provider_endpoint: MAGNIFIC_ENDPOINTS.mystic,
    provider_model: model,
  };
}

export async function getImageTaskStatus(taskId: string, endpoint?: string | null): Promise<MagnificTaskData> {
  const normalizedEndpoint = String(endpoint || MAGNIFIC_ENDPOINTS.mystic).trim();
  const envelope = await magnificRequest(`${normalizedEndpoint}/${taskId}`, {
    method: "GET",
  });
  return taskDataOrThrow(envelope, "image status");
}

export async function createImageEditTask(args: {
  prompt: string;
  sourceImageUrl: string;
  aspectRatio?: string;
  providerOptions?: Record<string, unknown>;
}): Promise<MagnificTaskData> {
  const providerOptions = cleanProviderOptions(args.providerOptions);
  const payload = {
    prompt: args.prompt,
    reference_images: [args.sourceImageUrl],
    aspect_ratio: normalizeImageAspectRatio(args.aspectRatio),
    seed: typeof providerOptions.seed === "number" ? providerOptions.seed : undefined,
    enable_safety_checker: true,
  };

  const envelope = await magnificRequest(MAGNIFIC_ENDPOINTS.seedreamEdit, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return taskDataOrThrow(envelope, "seedream edit");
}

export async function getImageEditTaskStatus(taskId: string): Promise<MagnificTaskData> {
  const envelope = await magnificRequest(`${MAGNIFIC_ENDPOINTS.seedreamEdit}/${taskId}`, {
    method: "GET",
  });
  return taskDataOrThrow(envelope, "seedream edit status");
}

export async function createVideoTask(args: {
  prompt: string;
  mode?: "text-to-video" | "image-to-video";
  imageUrl?: string | null;
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  fps?: number;
  generateAudio?: boolean;
  model?: string;
}): Promise<MagnificTaskData & { provider_endpoint?: string; provider_model?: string }> {
  const mode = args.mode === "image-to-video" ? "image-to-video" : "text-to-video";
  const requestedModel = String(args.model || "").trim();
  const isKling = mode === "image-to-video" && requestedModel === "kling-v2-6-pro";
  const endpoint = mode === "image-to-video"
    ? (isKling ? MAGNIFIC_ENDPOINTS.klingImageToVideoCreate : MAGNIFIC_ENDPOINTS.ltxImageToVideo)
    : MAGNIFIC_ENDPOINTS.ltxTextToVideo;

  const payload: Record<string, unknown> = {
    prompt: args.prompt,
    duration: isKling ? String(args.duration === 10 ? 10 : 5) : normalizeVideoDuration(args.duration === 5 ? 6 : args.duration),
  };

  if (!isKling) {
    payload.generate_audio = Boolean(args.generateAudio);
    payload.resolution = normalizeVideoResolution(args.resolution);
    payload.fps = normalizeFps(args.fps);
  }

  if (isKling) {
    payload.aspect_ratio = normalizeVideoAspectRatio(args.aspectRatio);
    payload.cfg_scale = 0.5;
  }

  if (mode === "image-to-video") {
    payload.image_url = String(args.imageUrl || "").trim();
  }

  const envelope = await magnificRequest(endpoint, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return {
    ...taskDataOrThrow(envelope, mode),
    provider_endpoint: endpoint,
    provider_model: isKling ? "kling-v2-6-pro" : (mode === "image-to-video" ? "ltx-2-pro-i2v" : "ltx-2-pro"),
  };
}

export async function getVideoTaskStatus(taskId: string, endpoint?: string | null): Promise<MagnificTaskData> {
  const normalizedEndpoint = String(endpoint || MAGNIFIC_ENDPOINTS.ltxTextToVideo).trim();
  const envelope = await magnificRequest(`${normalizedEndpoint}/${taskId}`, {
    method: "GET",
  });
  return taskDataOrThrow(envelope, "video status");
}

export function normalizeTaskStatus(status?: string): string {
  const value = (status || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (!value) return "unknown";
  if (["completed", "succeeded", "done", "finished"].includes(value)) return "completed";
  if (["failed", "error", "cancelled", "canceled"].includes(value)) return "failed";
  if (["queued", "created", "pending", "running", "in_progress", "processing"].includes(value)) {
    return value === "created" ? "queued" : "processing";
  }
  return value;
}

export function extractProgress(task: MagnificTaskData): number | null {
  const candidates = [task.progress, task.percentage]
    .map((value) => typeof value === "number" ? value : null)
    .filter((value): value is number => value !== null);

  if (candidates.length > 0) {
    return Math.max(0, Math.min(100, Math.round(candidates[0])));
  }

  const status = normalizeTaskStatus(task.status);
  if (status === "queued") return 15;
  if (status === "processing") return 60;
  if (status === "completed") return 100;
  if (status === "failed") return 100;
  return 20;
}

export function extractFirstGeneratedUrl(task: MagnificTaskData): string | null {
  const generated = Array.isArray(task.generated) ? task.generated : [];
  if (!generated.length) return null;

  const first = generated[0];
  if (typeof first === "string") return first;

  if (typeof first === "object" && first) {
    const withUrl = first as Record<string, unknown>;
    const candidate = withUrl.url || withUrl.video_url || withUrl.image_url;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return null;
}

export async function waitForTaskCompletion(args: {
  taskId: string;
  poll: (taskId: string) => Promise<MagnificTaskData>;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<MagnificTaskData> {
  const timeoutMs = args.timeoutMs ?? 300_000;
  const intervalMs = args.intervalMs ?? 3_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const task = await args.poll(args.taskId);
    const status = normalizeTaskStatus(task.status);

    if (status === "completed" || status === "failed") {
      return task;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("Media task polling timed out");
}
