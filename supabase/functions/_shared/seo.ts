// WEEK 2 FIX 4 — single source of truth for Social SEO/discovery scoring.
//
// Previously seo-score and optimize-seo each ran their own LLM scoring pass
// AND each had their own independent normalization math (seo-score:
// weighted-breakdown recompute; optimize-seo: a simpler top-level-field
// scale correction) — meaning the same content, scored moments apart by
// each function, could produce two different numbers. SessionStore.js also
// had a third, line-for-line copy of this same normalization logic for
// re-reading persisted seo_state. This module is now the only place the
// scoring prompt, the LLM call, and the normalization math exist.
import type { DatabaseClient } from "./supabase.ts";
import { callLlm } from "./llm.ts";
import { createHttpError } from "./org.ts";

export type SeoScoreInput = {
  title?: string | null;
  caption: string;
  hashtags?: string[] | null;
  platform?: string | null;
  mediaType?: string | null;
  visualPrompt?: string | null;
};

export type NormalizedSeoPayload = {
  overall: number;
  breakdown: Record<string, number>;
  suggestions: string[];
  benchmarkReport: string[];
  hashtagSuggestions: Array<{ tag: string; relevance: number; reason: string }>;
  category: string;
  provider: string | null;
  model: string | null;
};

const BREAKDOWN_WEIGHTS: Record<string, number> = {
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

export function pickJson(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return "{}";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

export function normalizeSeoHashtags(value: unknown) {
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

export function shouldNormalizeTenPointScale(scores: Array<number | null>) {
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
    .slice(0, 8) as Array<{ tag: string; relevance: number; reason: string }>;
}

function buildScoringSystemPrompt() {
  return `You are Claude acting as a senior Social SEO and content-discovery strategist.
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
}

/**
 * The single, canonical scoring implementation — one LLM call, one
 * normalization pass. Used by BOTH seo-score (standalone re-scoring) and
 * optimize-seo (scores the just-optimized content server-side instead of
 * making the client chain a second, separately-normalized round trip).
 */
/**
 * Claude occasionally returns malformed/truncated JSON for this prompt (a
 * real, observed LLM non-determinism issue — confirmed live 2026-07-12: a
 * genuine "Expected ',' or ']' after array element" parse failure reaching
 * the user as a raw 500 with no retry). This schema is the most complex one
 * in the app (nested breakdown + benchmarkReport + hashtagSuggestions
 * arrays with free-text fields), making it the most exposed to truncation
 * at the token limit and to occasional escaping mistakes. One retry with an
 * explicit "your last response was invalid" correction, plus a higher
 * token ceiling to reduce truncation in the first place, closes most of
 * this without silently swallowing a genuine, persistent failure — if the
 * retry ALSO fails to parse, this still throws (callers already handle a
 * thrown error from scoreContent by surfacing seoStatus:'failed', which the
 * UI already renders as "unscored, retry" rather than a fake 0 — see Week 2
 * Fix 3/4 — so throwing here is the correct, existing contract, not new
 * behavior).
 */
async function callScoringLlm(
  userContent: string,
  retryNote?: string,
): Promise<{ parsed: Record<string, unknown>; provider: string; model: string }> {
  const llmResult = await callLlm({
    preferredProvider: "anthropic",
    systemPrompt: buildScoringSystemPrompt(),
    maxTokens: 2000,
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: retryNote ? `${retryNote}\n\n${userContent}` : userContent,
      },
    ],
  });

  const parsed = JSON.parse(pickJson(llmResult.content || "{}")) as Record<string, unknown>;
  return { parsed, provider: llmResult.provider, model: llmResult.model };
}

export async function scoreContent(input: SeoScoreInput): Promise<NormalizedSeoPayload> {
  const title = String(input.title || "").trim();
  const caption = String(input.caption || "").trim();
  const hashtags = normalizeSeoHashtags(input.hashtags || []);
  const platform = String(input.platform || "instagram").trim().toLowerCase();
  const mediaType = String(input.mediaType || "image").trim().toLowerCase();
  const visualPrompt = String(input.visualPrompt || "").trim();

  const userContent = [
    `Platform: ${platform}`,
    `Title: ${title || "(none)"}`,
    `Caption: ${caption}`,
    `Hashtags: ${hashtags.join(", ") || "(none)"}`,
    `Media type: ${mediaType}`,
    visualPrompt ? `Visual prompt/context: ${visualPrompt}` : "",
  ].join("\n\n");

  let parsed: Record<string, unknown>;
  let provider: string;
  let model: string;
  try {
    const result = await callScoringLlm(userContent);
    parsed = result.parsed;
    provider = result.provider;
    model = result.model;
  } catch (firstError) {
    console.warn("[seo.ts] first scoring response was not valid JSON, retrying once:", firstError);
    try {
      const retryResult = await callScoringLlm(
        userContent,
        "Your previous response was not valid, complete JSON. Return ONLY a single valid JSON object exactly matching the requested shape — no trailing commas, no truncation, no text outside the JSON.",
      );
      parsed = retryResult.parsed;
      provider = retryResult.provider;
      model = retryResult.model;
    } catch (secondError) {
      console.error("[seo.ts] retry also failed to produce valid JSON:", secondError);
      throw createHttpError("AI scoring returned invalid output — please try again.", 502);
    }
  }
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
  const useTenPointScaleForBreakdown = shouldNormalizeTenPointScale([...Object.values(rawBreakdown)]);
  const normalizedBreakdown = Object.fromEntries(
    Object.entries(rawBreakdown).map(([key, value]) => [key, normalizeScaleScore(value, useTenPointScaleForBreakdown)]),
  );

  const computedOverall = Math.round(
    Object.entries(BREAKDOWN_WEIGHTS).reduce((sum, [key, weight]) => (
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
  const category = String(
    parsed.scoreCategory || parsed.score_category
    || (overall >= 80 ? "Great" : overall >= 60 ? "Good" : overall >= 40 ? "Ok" : "Poor"),
  ).trim();

  return {
    overall,
    breakdown: normalizedBreakdown,
    suggestions: recommendations,
    benchmarkReport,
    hashtagSuggestions,
    category,
    provider,
    model,
  };
}

/**
 * Single writer of posts.seo_state / workflow_state.seo_status — combined
 * into one UPDATE (same transactional principle as Fix 3's metadata
 * lifecycle: never split "the data" and "the status" across two
 * statements). Called by both seo-score and optimize-seo whenever a
 * content_id is supplied, so the client no longer needs to write seo_state
 * itself for either path.
 */
export async function persistSeoState(
  adminClient: DatabaseClient,
  postId: string,
  normalized: NormalizedSeoPayload,
) {
  const { data: currentPost } = await adminClient
    .from("posts")
    .select("seo_state, workflow_state")
    .eq("id", postId)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  const currentSeoState = currentPost?.seo_state && typeof currentPost.seo_state === "object"
    ? currentPost.seo_state as Record<string, unknown>
    : {};
  const currentWorkflowState = currentPost?.workflow_state && typeof currentPost.workflow_state === "object"
    ? currentPost.workflow_state as Record<string, unknown>
    : {};

  const { error } = await adminClient
    .from("posts")
    .update({
      seo_state: {
        ...currentSeoState,
        seo_score: normalized.overall,
        discovery_score: normalized.overall,
        score_category: normalized.category,
        score_breakdown: normalized.breakdown,
        suggestions: normalized.suggestions,
        recommendations: normalized.suggestions,
        benchmark_report: normalized.benchmarkReport,
        hashtag_suggestions: normalized.hashtagSuggestions,
        provider: normalized.provider,
        model: normalized.model,
        provider_warning: null,
        updated_at: nowIso,
      },
      workflow_state: {
        ...currentWorkflowState,
        seo_status: "scored",
        seo_updated_at: nowIso,
      },
      updated_at: nowIso,
    })
    .eq("id", postId);

  if (error) throw error;
}
