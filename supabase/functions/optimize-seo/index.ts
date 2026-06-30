import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAuthClient, requireUser } from "../_shared/supabase.ts";
import { callLlm } from "../_shared/llm.ts";
import { readEnv } from "../_shared/env.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";

type OptimizeSeoRequest = {
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
  const text = String(raw || "").trim();
  if (!text) return "{}";
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

function normalizeImprovementReport(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        const bullet = String(entry || "").trim();
        return bullet ? { type: "info", bullet } : null;
      }

      const typedEntry = entry as Record<string, unknown>;
      const bullet = String(typedEntry.bullet || typedEntry.message || "").trim();
      if (!bullet) return null;

      const type = String(typedEntry.type || "info").trim().toLowerCase();
      return {
        type: ["improvement", "warning", "info"].includes(type) ? type : "info",
        bullet,
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeBreakdown(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const dimensions: Array<[string, number]> = [
    ["readability", 100],
    ["keywordRelevance", 100],
    ["hashtagQuality", 100],
    ["hookStrength", 100],
    ["ctaStrength", 100],
    ["platformFit", 100],
    ["brandConsistency", 100],
    ["visualCaptionAlignment", 100],
    ["recommendationPotential", 100],
  ];

  return dimensions.reduce<Record<string, { score: number; max: number; rationale: string }>>((accumulator, [key, max]) => {
    const entry = input[key];
    const typedEntry = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    accumulator[key] = {
      score: Math.max(0, Math.min(max, Number(typedEntry.score || 0))),
      max,
      rationale: String(typedEntry.rationale || "").trim(),
    };
    return accumulator;
  }, {});
}

function parseScore(value: unknown) {
  const score = Number(value);
  if (Number.isNaN(score)) return null;
  return score;
}

function normalizeSeoScore(value: number | null) {
  if (value === null) return 0;
  const normalized = value > 0 && value <= 10 ? value * 10 : value;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

function normalizeHashtagSuggestions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        const tag = String(entry || "").trim();
        return tag ? { tag: tag.startsWith("#") ? tag : `#${tag}`, relevance: 0, reason: "" } : null;
      }
      const typedEntry = entry as Record<string, unknown>;
      const tag = String(typedEntry.tag || typedEntry.hashtag || "").trim();
      if (!tag) return null;
      return {
        tag: tag.startsWith("#") ? tag : `#${tag}`,
        relevance: Math.max(0, Math.min(100, Math.round(Number(typedEntry.relevance || typedEntry.score || 0)))),
        reason: String(typedEntry.reason || typedEntry.rationale || "").trim(),
      };
    })
    .filter(Boolean)
    .slice(0, 8);
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
    await requireUser(authClient);
    const body = await parseJsonBody<OptimizeSeoRequest>(req);

    if (!readEnv("ANTHROPIC_API_KEY", false)) {
      return jsonResponse({
        error: "ANTHROPIC_API_KEY is required for Claude Social SEO optimization.",
      }, 500);
    }

    const caption = String(body.caption || "").trim();
    if (!caption) {
      return jsonResponse({ error: "caption is required" }, 400);
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
  "discoveryScore": 0,
  "scoreCategory": "Poor|Ok|Good|Great",
  "scoreBreakdown": {
    "readability": { "score": 0, "rationale": "" },
    "keywordRelevance": { "score": 0, "rationale": "" },
    "hashtagQuality": { "score": 0, "rationale": "" },
    "hookStrength": { "score": 0, "rationale": "" },
    "ctaStrength": { "score": 0, "rationale": "" },
    "platformFit": { "score": 0, "rationale": "" },
    "brandConsistency": { "score": 0, "rationale": "" },
    "visualCaptionAlignment": { "score": 0, "rationale": "" },
    "recommendationPotential": { "score": 0, "rationale": "" }
  },
  "recommendations": ["what to improve next"],
  "improvements": ["what changed and why"],
  "benchmarkReport": [{ "benchmark": "First-line hook", "status": "Pass|Needs work", "note": "..." }],
  "hashtagSuggestions": [{ "tag": "#example", "relevance": 90, "reason": "..." }]
}

Scoring output rules:
- discoveryScore must be an integer from 0 to 100
- Do not use 0-10 scale
- Do not inflate the score unless the optimized copy satisfies the rubric`;

    const llmResult = await callLlm({
      preferredProvider: "anthropic",
      systemPrompt,
      maxTokens: 1300,
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
    const seoScore = normalizeSeoScore(parseScore(parsed.discoveryScore ?? parsed.discovery_score ?? parsed.seoScore));
    const improvements = normalizeImprovements(parsed.improvements);
    const scoreBreakdown = normalizeBreakdown(parsed.scoreBreakdown || parsed.score_breakdown);
    const improvementReport = normalizeImprovementReport(parsed.improvementReport || parsed.improvement_report || parsed.benchmarkReport || parsed.benchmark_report || improvements);
    const benchmarkReport = normalizeImprovementReport(parsed.benchmarkReport || parsed.benchmark_report || []);
    const recommendations = normalizeImprovements(parsed.recommendations || improvements);
    const hashtagSuggestions = normalizeHashtagSuggestions(parsed.hashtagSuggestions || parsed.hashtag_suggestions);
    const scoreCategory = String(parsed.scoreCategory || parsed.score_category || (seoScore >= 80 ? "Great" : seoScore >= 60 ? "Good" : seoScore >= 40 ? "Ok" : "Poor")).trim() || "Poor";

    return jsonResponse({
      optimizedTitle,
      optimizedCaption,
      optimizedHashtags,
      seoScore,
      discoveryScore: seoScore,
      discovery_score: seoScore,
      improvements,
      recommendations,
      scoreCategory,
      scoreBreakdown,
      improvementReport,
      benchmarkReport,
      hashtagSuggestions,
      optimized_title: optimizedTitle,
      optimized_caption: optimizedCaption,
      optimized_hashtags: optimizedHashtags,
      seo_score: seoScore,
      score_category: scoreCategory,
      score_breakdown: scoreBreakdown,
      improvement_report: improvementReport,
      benchmark_report: benchmarkReport,
      hashtag_suggestions: hashtagSuggestions,
      provider: llmResult.provider,
      model: llmResult.model,
      provider_warning: null,
    });
  } catch (error) {
    console.error("[optimize-seo] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
