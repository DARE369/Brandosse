import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAuthClient, requireUser } from "../_shared/supabase.ts";
import { callLlm } from "../_shared/llm.ts";
import { readEnv } from "../_shared/env.ts";
import { createHttpError } from "../_shared/org.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";

type GenerateCaptionRequest = {
  imageDescription: string;
  platform?: string;
  brandKit?: Record<string, unknown>;
  previousCaptions?: string[];
  tone?: string | null;
};

const PLATFORM_LIMITS: Record<string, number> = {
  instagram: 2200,
  twitter: 280,
  x: 280,
  linkedin: 3000,
};

function pickJson(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return "{}";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function normalizeHashtags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
    .slice(0, 8);
}

function limitCaption(caption: string, platform: string) {
  const maxLength = PLATFORM_LIMITS[platform] || 2200;
  const normalized = String(caption || "").trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength - 3).trimEnd() + "...";
}

function buildBrandContext(brandKit: Record<string, unknown> | undefined) {
  if (!brandKit || typeof brandKit !== "object") return "No brand context provided.";
  const summary = typeof brandKit.summary === "string" ? brandKit.summary : "";
  const raw = brandKit.raw && typeof brandKit.raw === "object" ? brandKit.raw as Record<string, unknown> : {};
  if (summary.trim()) return summary;

  return [
    raw.brand_name ? `Brand name: ${raw.brand_name}` : "",
    raw.brand_voice ? `Brand voice: ${Array.isArray(raw.brand_voice) ? raw.brand_voice.join(", ") : raw.brand_voice}` : "",
    raw.tone_descriptors ? `Tone: ${Array.isArray(raw.tone_descriptors) ? raw.tone_descriptors.join(", ") : raw.tone_descriptors}` : "",
    raw.target_audience ? `Target audience: ${raw.target_audience}` : "",
    raw.content_pillars ? `Content pillars: ${Array.isArray(raw.content_pillars) ? raw.content_pillars.join(", ") : raw.content_pillars}` : "",
    raw.dont_list ? `Do not include: ${Array.isArray(raw.dont_list) ? raw.dont_list.join(", ") : raw.dont_list}` : "",
  ].filter(Boolean).join("\n") || "No brand context provided.";
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authClient = createAuthClient(req.headers.get("Authorization"));
    const user = await requireUser(authClient);
    await enforceRateLimit(authClient, user.id, "generate-caption");
    const body = await parseJsonBody<GenerateCaptionRequest>(req);

    if (!readEnv("ANTHROPIC_API_KEY", false)) {
      throw createHttpError("ANTHROPIC_API_KEY is required for Claude caption generation.", 500);
    }

    const imageDescription = String(body.imageDescription || "").trim();
    if (!imageDescription) {
      throw createHttpError("imageDescription is required", 400);
    }

    const platform = String(body.platform || "instagram").trim().toLowerCase();
    const brandContext = buildBrandContext(body.brandKit);
    const previousCaptions = Array.isArray(body.previousCaptions)
      ? body.previousCaptions.map((caption) => String(caption || "").trim()).filter(Boolean).slice(0, 5)
      : [];
    const tone = String(body.tone || "").trim();

    const systemPrompt = `You are an expert social media copywriter. Write a caption for the described content.
Rules:
- Match the brand voice and tone descriptors exactly
- Stay within platform character limit (Instagram: 2200, Twitter/X: 280, LinkedIn: 3000)
- Use brand content pillars as themes
- Avoid anything in the brand's dont_list
- Generate 5 relevant hashtags from brand hashtag list plus topic-relevant additions
- Do not make up facts about the brand
Return ONLY valid JSON:
{
  "caption": "...",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "platform": "instagram"
}`;

    const llmResult = await callLlm({
      preferredProvider: "anthropic",
      systemPrompt,
      jsonMode: true,
      maxTokens: 700,
      temperature: 0.4,
      messages: [
        {
          role: "user",
          content: [
            `Platform: ${platform}`,
            tone ? `Tone override: ${tone}` : "",
            `Brand context:\n${brandContext}`,
            previousCaptions.length > 0 ? `Previous captions:\n- ${previousCaptions.join("\n- ")}` : "",
            `Image/content description:\n${imageDescription}`,
          ].filter(Boolean).join("\n\n"),
        },
      ],
    });

    const parsed = JSON.parse(pickJson(llmResult.content));
    const caption = limitCaption(String(parsed.caption || ""), platform);
    const hashtags = normalizeHashtags(parsed.hashtags);

    return jsonResponse({
      caption,
      hashtags,
      platform,
      provider: llmResult.provider,
      model: llmResult.model,
    });
  } catch (error) {
    console.error("[generate-caption] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
