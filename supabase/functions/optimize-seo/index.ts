import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { callLlm } from "../_shared/llm.ts";
import { readEnv } from "../_shared/env.ts";
import { createHttpError } from "../_shared/org.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { persistSeoState, scoreContent } from "../_shared/seo.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";

// WEEK 2 FIX 4: this function used to self-score its own optimized output
// inline (its own copy of the discovery-score prompt + its own,
// differently-normalized math) and the client would THEN make a second,
// separate call to seo-score on the same content — two LLM scoring passes
// for the same content, with two different normalization implementations,
// that could disagree with each other. Now this function only optimizes
// (one LLM call), then calls the shared scoreContent() from _shared/seo.ts
// on the optimized result (one more LLM call, same canonical
// normalization seo-score itself uses) — one client round trip, two
// server-side LLM passes total (down from three: optimize's self-score +
// optimize + the client's separate score call), one normalization.
type OptimizeSeoRequest = {
  content_id?: string | null;
  post_id?: string | null;
  title?: string;
  caption: string;
  hashtags?: string[];
  platform?: string;
  brandKit?: Record<string, unknown>;
  targetKeywords?: string[];
  mediaType?: string;
  visualPrompt?: string;
};

function pickJson(raw: string) {
  let text = String(raw || "").trim();
  if (!text) return "{}";
  // Strip a ``` or ```json fence before brace-scanning — a bare
  // indexOf("{")/lastIndexOf("}") scan can still leave the fence markers in
  // place for a truncated response (cut off by maxTokens before the closing
  // fence/brace ever arrives), which is exactly what reached JSON.parse as
  // "```json\n{..." in production and threw instead of parsing.
  const fenced = text.match(/^```[a-zA-Z]*\n?([\s\S]*?)\n?```\s*$/);
  if (fenced) {
    text = fenced[1].trim();
  } else if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\n?/, "").trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function normalizeHashtags(value: unknown, platform: string) {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));

  if (platform === "twitter" || platform === "x") {
    return normalized.slice(0, 2);
  }
  return normalized.slice(0, 10);
}

function normalizeImprovements(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 8);
}

function buildBrandContext(brandKit: Record<string, unknown> | undefined) {
  if (!brandKit || typeof brandKit !== "object") return "No brand context provided.";
  if (typeof brandKit.summary === "string" && brandKit.summary.trim()) {
    return brandKit.summary;
  }
  const raw = brandKit.raw && typeof brandKit.raw === "object" ? brandKit.raw as Record<string, unknown> : {};
  return [
    raw.brand_name ? `Brand name: ${raw.brand_name}` : "",
    raw.brand_voice ? `Brand voice: ${Array.isArray(raw.brand_voice) ? raw.brand_voice.join(", ") : raw.brand_voice}` : "",
    raw.tone_descriptors ? `Tone: ${Array.isArray(raw.tone_descriptors) ? raw.tone_descriptors.join(", ") : raw.tone_descriptors}` : "",
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
    await enforceRateLimit(authClient, user.id, "optimize-seo");
    const body = await parseJsonBody<OptimizeSeoRequest>(req);

    if (!readEnv("ANTHROPIC_API_KEY", false)) {
      throw createHttpError("ANTHROPIC_API_KEY is required for Claude Social SEO optimization.", 500);
    }

    const caption = String(body.caption || "").trim();
    if (!caption) {
      throw createHttpError("caption is required", 400);
    }

    const platform = String(body.platform || "instagram").trim().toLowerCase();
    const title = String(body.title || "").trim();
    const hashtags = Array.isArray(body.hashtags)
      ? body.hashtags.map((tag) => String(tag || "").trim()).filter(Boolean)
      : [];
    const targetKeywords = Array.isArray(body.targetKeywords)
      ? body.targetKeywords.map((keyword) => String(keyword || "").trim()).filter(Boolean)
      : [];
    const mediaType = String(body.mediaType || "image").trim().toLowerCase();
    const visualPrompt = String(body.visualPrompt || "").trim();

    // Optimization-only system prompt — no scoring fields requested here
    // anymore (cheaper, shorter prompt than before this fix).
    const systemPrompt = `You are Claude acting as a senior Social SEO and algorithmic discovery specialist. Optimize this title, caption, and hashtag set for discovery on the target social platform without making it sound robotic or inauthentic.
Rules:
- Keep the brand voice intact - do not change the personality
- Improve the title for discoverability when one is provided
- Insert high-value keywords naturally into the caption text
- Replace weak or redundant hashtags with higher-reach alternatives
- Ensure the first line of the caption is a hook
- For Instagram: blend niche + broad hashtags in roughly 60/40
- For TikTok: 3-5 search-friendly hashtags and natural search phrase in caption
- For YouTube: searchable title and description-style caption
- For Twitter/X: max 2 hashtags, focus on keywords in text itself
- For LinkedIn: professional tone, industry keywords in first sentence
Return ONLY valid JSON:
{
  "optimizedTitle": "...",
  "optimizedCaption": "...",
  "optimizedHashtags": ["#tag1"],
  "improvements": ["what changed and why"]
}`;

    const llmResult = await callLlm({
      preferredProvider: "anthropic",
      systemPrompt,
      // Was 900 — too tight for a full title+caption+hashtags+improvements
      // rewrite on longer captions, causing the completion to truncate
      // before the closing JSON brace and fail to parse.
      maxTokens: 1400,
      temperature: 0.3,
      messages: [
        {
          role: "user",
          content: [
            `Platform: ${platform}`,
            `Media type: ${mediaType}`,
            `Brand context:\n${buildBrandContext(body.brandKit)}`,
            targetKeywords.length > 0 ? `Target keywords: ${targetKeywords.join(", ")}` : "",
            title ? `Current title:\n${title}` : "",
            `Current caption:\n${caption}`,
            `Current hashtags: ${hashtags.join(", ") || "None"}`,
            visualPrompt ? `Visual prompt/context:\n${visualPrompt}` : "",
          ].filter(Boolean).join("\n\n"),
        },
      ],
    });

    const parsed = JSON.parse(pickJson(llmResult.content));
    const optimizedTitle = String(parsed.optimizedTitle || parsed.optimized_title || title).trim();
    const optimizedCaption = String(parsed.optimizedCaption || caption).trim();
    const optimizedHashtags = normalizeHashtags(parsed.optimizedHashtags || hashtags, platform);
    const improvements = normalizeImprovements(parsed.improvements);

    // Score the OPTIMIZED content server-side via the same canonical
    // scoring implementation seo-score itself uses — one more LLM call,
    // same normalization, no second divergent code path.
    const normalized = await scoreContent({
      title: optimizedTitle,
      caption: optimizedCaption,
      hashtags: optimizedHashtags,
      platform,
      mediaType,
      visualPrompt,
    });

    const contentId = body.content_id || body.post_id || null;
    if (contentId) {
      const adminClient = createAdminClient();
      await persistSeoState(adminClient, contentId, normalized);
    }

    // Preserved for backward compatibility with src/org/services/
    // orgDraftWorkflowService.js (a different, org-workspace consumer of
    // this same function, outside this fix's scope), which reads
    // improvementReport/improvement_report as {type,bullet} objects. No
    // second LLM call involved — just re-shaping the one `improvements`
    // list this function already produces.
    const improvementReport = improvements.map((bullet) => ({ type: "info", bullet }));

    return jsonResponse({
      optimizedTitle,
      optimizedCaption,
      optimizedHashtags,
      optimized_title: optimizedTitle,
      optimized_caption: optimizedCaption,
      optimized_hashtags: optimizedHashtags,
      improvements,
      improvementReport,
      improvement_report: improvementReport,
      // Score fields — identical shape/keys to seo-score's response, so
      // the client can consume either function's response through the
      // same read path.
      overall: normalized.overall,
      seoScore: normalized.overall,
      seo_score: normalized.overall,
      discoveryScore: normalized.overall,
      discovery_score: normalized.overall,
      breakdown: normalized.breakdown,
      scoreBreakdown: normalized.breakdown,
      score_breakdown: normalized.breakdown,
      suggestions: normalized.suggestions,
      recommendations: normalized.suggestions,
      benchmarkReport: normalized.benchmarkReport,
      benchmark_report: normalized.benchmarkReport,
      hashtagSuggestions: normalized.hashtagSuggestions,
      hashtag_suggestions: normalized.hashtagSuggestions,
      scoreCategory: normalized.category,
      score_category: normalized.category,
      provider: normalized.provider,
      model: normalized.model,
      provider_warning: null,
    });
  } catch (error) {
    console.error("[optimize-seo] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
