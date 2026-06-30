import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAuthClient, requireUser } from "../_shared/supabase.ts";
import { callLlm } from "../_shared/llm.ts";
import { readEnv } from "../_shared/env.ts";
import {
  handleCors,
  jsonResponse,
  mapErrorToStatusCode,
  parseJsonBody,
  toErrorPayload,
} from "../_shared/http.ts";

type SeoScoreRequest = {
  content_id?: string | null;
  post_id?: string | null;
  title?: string | null;
  caption?: string | null;
  hashtags?: string[] | null;
  platform?: string | null;
  media_type?: string | null;
  visual_prompt?: string | null;
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
    .slice(0, 12);
}

function clampScore(value: unknown) {
  const score = Number(value);
  if (Number.isNaN(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function parseScore(value: unknown) {
  const score = Number(value);
  if (Number.isNaN(score)) return null;
  return score;
}

function shouldNormalizeTenPointScale(scores: Array<number | null>) {
  const numericScores = scores.filter((score): score is number => Number.isFinite(score) && score > 0);
  if (!numericScores.length) return false;

  const maxScore = Math.max(...numericScores);
  const averageScore = numericScores.reduce((sum, score) => sum + score, 0) / numericScores.length;
  return maxScore <= 10 && averageScore <= 8.5;
}

function normalizeScaleScore(value: number | null, useTenPointScale: boolean) {
  if (value === null) return 0;
  const normalized = useTenPointScale ? value * 10 : value;
  return clampScore(normalized);
}

function normalizeSuggestions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

function normalizeReport(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (entry && typeof entry === "object") {
        const typed = entry as Record<string, unknown>;
        const benchmark = String(typed.benchmark || typed.title || "").trim();
        const status = String(typed.status || typed.result || "").trim();
        const note = String(typed.note || typed.description || typed.rationale || "").trim();
        return [benchmark, status, note].filter(Boolean).join(" - ");
      }
      return String(entry || "").trim();
    })
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeHashtagSuggestions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        const tag = String(entry || "").trim();
        return tag ? { tag: tag.startsWith("#") ? tag : `#${tag}`, relevance: 0, reason: "" } : null;
      }
      const typed = entry as Record<string, unknown>;
      const tag = String(typed.tag || typed.hashtag || "").trim();
      if (!tag) return null;
      return {
        tag: tag.startsWith("#") ? tag : `#${tag}`,
        relevance: clampScore(typed.relevance || typed.score || 0),
        reason: String(typed.reason || typed.rationale || "").trim(),
      };
    })
    .filter(Boolean)
    .slice(0, 8);
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
    const body = await parseJsonBody<SeoScoreRequest>(req);

    if (!readEnv("ANTHROPIC_API_KEY", false)) {
      return jsonResponse({
        error: "ANTHROPIC_API_KEY is required for Claude Social SEO and Discovery Score analysis.",
      }, 500);
    }

    const title = String(body.title || "").trim();
    const caption = String(body.caption || "").trim();
    const hashtags = normalizeHashtags(body.hashtags || []);
    const platform = String(body.platform || "instagram").trim().toLowerCase();
    const mediaType = String(body.media_type || "image").trim().toLowerCase();
    const visualPrompt = String(body.visual_prompt || "").trim();

    if (!caption) {
      return jsonResponse({ error: "caption is required" }, 400);
    }

    const systemPrompt = `You are Claude acting as a senior Social SEO and content-discovery strategist.
Score this social post for search, recommendation systems, and platform discovery. This is NOT website SEO.

Use recognizable social content benchmarks:
- first-line hook clarity and scroll-stopping value
- natural keyword/entity placement in title and caption
- hashtag relevance, specificity, and count norms
- platform-native fit, including caption length and discovery surfaces
- CTA clarity without engagement bait
- brand consistency and visual-caption alignment
- recommendation potential based on audience intent and algorithm-readable signals

Platform norms:
- instagram: 5-12 hashtags, mix of niche + broad, strong first line
- tiktok: 3-5 search-friendly hashtags, concise hook, trend/search phrase
- youtube: searchable title and keyword-rich description
- facebook: 2-5 hashtags, conversational caption
- linkedin: professional keywords in the first sentence, minimal hashtags
- x/twitter: concise copy, 0-2 hashtags

Return JSON only:
{
  "discoveryScore": 0,
  "breakdown": {
    "readability": 0,
    "keywordRelevance": 0,
    "hashtagQuality": 0,
    "hookStrength": 0,
    "ctaStrength": 0,
    "platformFit": 0,
    "brandConsistency": 0,
    "visualCaptionAlignment": 0,
    "recommendationPotential": 0
  },
  "scoreCategory": "Poor|Ok|Good|Great",
  "recommendations": ["max 5 concrete improvements"],
  "benchmarkReport": [
    { "benchmark": "First-line hook", "status": "Pass|Needs work", "note": "short rationale" }
  ],
  "hashtagSuggestions": [
    { "tag": "#example", "relevance": 90, "reason": "why it helps discovery" }
  ]
}

Scoring output rules:
- All scores must be integers from 0 to 100
- Do not use 0-10 scale
- Do not inflate the score unless the copy actually satisfies the rubric`;

    const llmResult = await callLlm({
      preferredProvider: "anthropic",
      systemPrompt,
      maxTokens: 1100,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: [
            `Platform: ${platform}`,
            `Title: ${title || "(none)"}`,
            `Caption: ${caption}`,
            `Hashtags: ${hashtags.join(", ") || "(none)"}`,
            `Media type: ${mediaType}`,
            visualPrompt ? `Visual prompt/context: ${visualPrompt}` : "",
          ].join("\n\n"),
        },
      ],
    });

    const parsed = JSON.parse(pickJson(llmResult.content || "{}")) as Record<string, unknown>;
    const breakdown = (parsed.breakdown && typeof parsed.breakdown === "object"
      ? parsed.breakdown
      : {}) as Record<string, unknown>;

    const rawBreakdown = {
      readability: parseScore(breakdown.readability),
      keywordRelevance: parseScore(breakdown.keywordRelevance ?? breakdown.keyword_relevance),
      hashtagQuality: parseScore(breakdown.hashtagQuality ?? breakdown.hashtag_quality),
      hookStrength: parseScore(breakdown.hookStrength ?? breakdown.hook_strength),
      ctaStrength: parseScore(breakdown.ctaStrength ?? breakdown.cta_strength),
      platformFit: parseScore(breakdown.platformFit ?? breakdown.platform_fit),
      brandConsistency: parseScore(breakdown.brandConsistency ?? breakdown.brand_consistency),
      visualCaptionAlignment: parseScore(breakdown.visualCaptionAlignment ?? breakdown.visual_caption_alignment),
      recommendationPotential: parseScore(breakdown.recommendationPotential ?? breakdown.recommendation_potential),
    };
    const useTenPointScaleForBreakdown = shouldNormalizeTenPointScale([
      ...Object.values(rawBreakdown),
    ]);
    const normalizedBreakdown = Object.fromEntries(
      Object.entries(rawBreakdown).map(([key, value]) => [key, normalizeScaleScore(value, useTenPointScaleForBreakdown)]),
    );

    const weights: Record<string, number> = {
      readability: 0.10,
      keywordRelevance: 0.16,
      hashtagQuality: 0.14,
      hookStrength: 0.12,
      ctaStrength: 0.08,
      platformFit: 0.16,
      brandConsistency: 0.10,
      visualCaptionAlignment: 0.08,
      recommendationPotential: 0.06,
    };

    const computedOverall = Math.round(
      Object.entries(weights).reduce((sum, [key, weight]) => (
        sum + (Number(normalizedBreakdown[key] || 0) * weight)
      ), 0),
    );

    const hasBreakdownSignal = Object.values(normalizedBreakdown).some((score) => score > 0);
    const rawOverall = parseScore(parsed.discoveryScore ?? parsed.discovery_score ?? parsed.overall);
    const overall = hasBreakdownSignal
      ? computedOverall
      : rawOverall === null
        ? computedOverall
        : normalizeScaleScore(rawOverall, rawOverall > 0 && rawOverall <= 10);
    const recommendations = normalizeSuggestions(parsed.recommendations || parsed.suggestions);
    const benchmarkReport = normalizeReport(parsed.benchmarkReport || parsed.benchmark_report);
    const hashtagSuggestions = normalizeHashtagSuggestions(parsed.hashtagSuggestions || parsed.hashtag_suggestions);
    const scoreCategory = String(parsed.scoreCategory || parsed.score_category || (overall >= 80 ? "Great" : overall >= 60 ? "Good" : overall >= 40 ? "Ok" : "Poor")).trim();

    return jsonResponse({
      content_id: body.content_id || body.post_id || null,
      overall,
      discoveryScore: overall,
      discovery_score: overall,
      breakdown: normalizedBreakdown,
      suggestions: recommendations,
      recommendations,
      benchmarkReport,
      benchmark_report: benchmarkReport,
      hashtagSuggestions,
      hashtag_suggestions: hashtagSuggestions,
      scoreCategory,
      score_category: scoreCategory,
      provider: llmResult.provider,
      model: llmResult.model,
      provider_warning: null,
    });
  } catch (error) {
    console.error("[seo-score] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
