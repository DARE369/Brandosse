import { readEnv } from "./env.ts";

export class FreepikApiError extends Error {
  statusCode: number;
  details: string;

  constructor(message: string, statusCode: number, details = "") {
    super(message);
    this.name = "FreepikApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

type FreepikGeneratedItem = string | {
  url?: string;
  video_url?: string;
  image_url?: string;
  thumbnail_url?: string;
  [key: string]: unknown;
};

export type FreepikTaskData = {
  task_id?: string;
  status?: string;
  generated?: FreepikGeneratedItem[];
  progress?: number;
  percentage?: number;
  message?: string;
  error?: string;
  [key: string]: unknown;
};

type FreepikEnvelope = {
  data?: FreepikTaskData;
  error?: string;
  message?: string;
};

const FREEPIK_API_BASE = "https://api.freepik.com";

export function readProviderKeys(): { freepikApiKey: string } {
  return {
    freepikApiKey: readEnv("FREEPIK_API_KEY"),
  };
}

async function freepikRequest(path: string, init: RequestInit): Promise<FreepikEnvelope> {
  const { freepikApiKey } = readProviderKeys();
  const url = `${FREEPIK_API_BASE}${path}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      "x-freepik-api-key": freepikApiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  const rawText = await response.text();
  let parsed: FreepikEnvelope | null = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch (_err) {
      // Keep raw body in error details below.
    }
  }

  if (!response.ok) {
    const errorMessage = parsed?.error || parsed?.message || `Freepik request failed (${response.status})`;
    throw new FreepikApiError(errorMessage, response.status, rawText);
  }

  return parsed || {};
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
    // Seedream 4.5 doesn't support 4:5 directly; this is the nearest tall portrait option.
    "4:5": "portrait_2_3",
  };
  return map[normalized] || map["1:1"];
}

export function normalizeVideoRatio(value?: string): string {
  const normalized = (value || "16:9").trim();
  const map: Record<string, string> = {
    "16:9": "1280:720",
    "9:16": "720:1280",
    "1:1": "960:960",
    // Runway 4.5 supports 832:1104 for tall portrait (3:4), used as closest mapping for 4:5 UI option.
    "4:5": "832:1104",
    // Allow already-normalized values through.
    "1280:720": "1280:720",
    "720:1280": "720:1280",
    "1104:832": "1104:832",
    "960:960": "960:960",
    "832:1104": "832:1104",
  };
  return map[normalized] || "1280:720";
}

export function normalizeVideoDuration(value?: number): 5 | 8 | 10 {
  if (value === 8 || value === 10) return value;
  return 5;
}

function taskDataOrThrow(envelope: FreepikEnvelope, endpoint: string): FreepikTaskData {
  if (!envelope?.data) {
    throw new Error(`Freepik ${endpoint} returned no task payload`);
  }
  return envelope.data;
}

export async function createImageTask(args: {
  prompt: string;
  aspectRatio?: string;
}): Promise<FreepikTaskData> {
  const payload = {
    prompt: args.prompt,
    aspect_ratio: normalizeImageAspectRatio(args.aspectRatio),
    enable_safety_checker: true,
  };

  const envelope = await freepikRequest("/v1/ai/text-to-image/seedream-v4-5", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return taskDataOrThrow(envelope, "text-to-image");
}

export async function getImageTaskStatus(taskId: string): Promise<FreepikTaskData> {
  const envelope = await freepikRequest(`/v1/ai/text-to-image/seedream-v4-5/${taskId}`, {
    method: "GET",
  });
  return taskDataOrThrow(envelope, "text-to-image status");
}

export async function createImageEditTask(args: {
  prompt: string;
  sourceImageUrl: string;
  aspectRatio?: string;
}): Promise<FreepikTaskData> {
  const payload = {
    prompt: args.prompt,
    reference_images: [args.sourceImageUrl],
    aspect_ratio: normalizeImageAspectRatio(args.aspectRatio),
    enable_safety_checker: true,
  };

  const envelope = await freepikRequest("/v1/ai/text-to-image/seedream-v4-5-edit", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return taskDataOrThrow(envelope, "edit-image");
}

export async function getImageEditTaskStatus(taskId: string): Promise<FreepikTaskData> {
  const envelope = await freepikRequest(`/v1/ai/text-to-image/seedream-v4-5-edit/${taskId}`, {
    method: "GET",
  });
  return taskDataOrThrow(envelope, "edit-image status");
}

export async function createVideoTask(args: {
  prompt: string;
  ratio?: string;
  duration?: number;
}): Promise<FreepikTaskData> {
  const payload = {
    prompt: args.prompt,
    ratio: normalizeVideoRatio(args.ratio),
    duration: normalizeVideoDuration(args.duration),
  };

  const envelope = await freepikRequest("/v1/ai/text-to-video/runway-4-5", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return taskDataOrThrow(envelope, "text-to-video");
}

export async function getVideoTaskStatus(taskId: string): Promise<FreepikTaskData> {
  const envelope = await freepikRequest(`/v1/ai/text-to-video/runway-4-5/${taskId}`, {
    method: "GET",
  });
  return taskDataOrThrow(envelope, "text-to-video status");
}

export function normalizeTaskStatus(status?: string): string {
  const value = (status || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (!value) return "unknown";
  if (["completed", "succeeded", "done", "finished"].includes(value)) return "completed";
  if (["failed", "error", "cancelled", "canceled"].includes(value)) return "failed";
  if (["queued", "created", "pending", "running", "in_progress", "processing"].includes(value)) {
    return "processing";
  }
  return value;
}

export function extractProgress(task: FreepikTaskData): number | null {
  const candidates = [task.progress, task.percentage]
    .map((value) => typeof value === "number" ? value : null)
    .filter((value): value is number => value !== null);

  if (candidates.length > 0) {
    const pct = Math.max(0, Math.min(100, Math.round(candidates[0])));
    return pct;
  }

  const status = normalizeTaskStatus(task.status);
  if (status === "processing") return 60;
  if (status === "completed") return 100;
  if (status === "failed") return 100;
  return 20;
}

export function extractFirstGeneratedUrl(task: FreepikTaskData): string | null {
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
  poll: (taskId: string) => Promise<FreepikTaskData>;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<FreepikTaskData> {
  const timeoutMs = args.timeoutMs ?? 120_000;
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

  throw new Error("Freepik task polling timed out");
}
