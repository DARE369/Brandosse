// src/services/postProduction.service.js
//
// Workspace-agnostic post-production logic — the "discovery score" system
// (generate-post-metadata / seo-score / optimize-seo) that used to be
// reachable only through Studio's SessionStore.js, which assumes a live
// generation session (activeSession/selectedGeneration) that Library and
// Calendar don't have. Everything here instead takes an EXISTING post_id
// directly, so it can be called from any surface that already has a `posts`
// row in hand.
//
// SessionStore.js itself is intentionally left untouched — Studio's flow is
// proven and this file does not replace it, only gives the same underlying
// edge functions a second, generation-session-free entry point. Field-name
// conventions (snake_case for seo-score, camelCase for optimize-seo) are
// copied exactly from SessionStore's own working calls, not "cleaned up" —
// deviating risks silently breaking what the edge functions actually parse.

import { supabase } from "./supabaseClient";
import {
  normalizeEdgeFunctionError,
  isEdgeFunctionUnavailable,
  markEdgeFunctionUnavailable,
  buildUnavailableEdgeFunctionMessage,
  clearEdgeFunctionUnavailable,
} from "./edgeFunctionClient";

export const DEFAULT_SOCIAL_SEO_BREAKDOWN = {
  readability: 0,
  keywordRelevance: 0,
  hashtagQuality: 0,
  hookStrength: 0,
  ctaStrength: 0,
  platformFit: 0,
  brandConsistency: 0,
  visualCaptionAlignment: 0,
  recommendationPotential: 0,
};

export const DEFAULT_DISCOVERY_SCORE = {
  seoScore: 0,
  seoCategory: "Not scored",
  seoBreakdown: { ...DEFAULT_SOCIAL_SEO_BREAKDOWN },
  seoSuggestions: [],
  seoBenchmarkReport: [],
  seoHashtagSuggestions: [],
  seoProvider: null,
};

function normalizeHashtags(tags = []) {
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
}

// Mirrors SessionStore's private readSeoResponseFields exactly — seo-score
// and optimize-seo both already return server-normalized scores (WEEK 2 FIX
// 4 moved scale-correction/weighting server-side), so this is just field
// selection with safe fallbacks, not a second normalization pass.
function readSeoResponseFields(raw = {}) {
  return {
    overall: Number(raw?.overall ?? raw?.discoveryScore ?? raw?.discovery_score ?? 0) || 0,
    breakdown: raw?.breakdown && typeof raw.breakdown === "object" ? raw.breakdown : { ...DEFAULT_SOCIAL_SEO_BREAKDOWN },
    suggestions: Array.isArray(raw?.suggestions) ? raw.suggestions : [],
    benchmarkReport: Array.isArray(raw?.benchmarkReport) ? raw.benchmarkReport : [],
    hashtagSuggestions: Array.isArray(raw?.hashtagSuggestions) ? raw.hashtagSuggestions : [],
    category: String(raw?.scoreCategory || raw?.score_category || "Poor"),
    provider: raw?.provider || null,
    model: raw?.model || null,
    // `overall` above coerces a MISSING score to 0 (`?? 0` then `|| 0`), which
    // existing Studio screens rely on. These two flags let a caller that must
    // not fabricate — the frozen publish report — tell "scored zero" from "no
    // score came back". Additive: nothing that reads `overall` changes.
    hasOverall: [raw?.overall, raw?.discoveryScore, raw?.discovery_score]
      .some((v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v))),
    // null when talking to a seo-score deployment that predates the field, so a
    // caller can say "coverage unknown" rather than assume every metric counted.
    measured: Array.isArray(raw?.measured) ? raw.measured.map(String) : null,
  };
}

function toDiscoveryScoreShape(normalized) {
  return {
    seoScore: normalized.overall,
    seoCategory: normalized.category,
    seoBreakdown: normalized.breakdown,
    seoSuggestions: normalized.suggestions,
    seoBenchmarkReport: normalized.benchmarkReport,
    seoHashtagSuggestions: normalized.hashtagSuggestions,
    seoProvider: normalized.provider,
    seoModel: normalized.model,
    seoHasOverall: normalized.hasOverall,
    seoMeasured: normalized.measured,
  };
}

/** Same account -> platform resolution SessionStore.resolvePrimaryPlatform uses. */
export async function resolvePlatformForAccount(accountId) {
  if (!accountId) return "instagram";
  const { data: account, error } = await supabase
    .from("connected_accounts")
    .select("platform")
    .eq("id", accountId)
    .maybeSingle();
  if (error || !account?.platform) return "instagram";
  return String(account.platform).trim().toLowerCase() || "instagram";
}

/**
 * Fetch a post (+ its linked generation for media_type/prompt context) for
 * post-production editing. Returns null if not found.
 */
export async function fetchPostForProduction(postId) {
  if (!postId) return null;
  const { data, error } = await supabase
    .from("posts")
    .select(`
      id, user_id, generation_id, organization_id, brand_project_id,
      title, caption, hashtags, platform, account_id, status, scheduled_at,
      seo_state, workflow_state,
      connected_accounts ( id, platform, account_name, avatar_url ),
      generations ( id, prompt, media_type, storage_path )
    `)
    .eq("id", postId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Regenerate title/caption/hashtags for an EXISTING post. generate-post-
 * metadata self-persists to the posts row when given post_id (server owns
 * workflow_state.metadata_status through the whole lifecycle) — the caller
 * should re-fetch the post afterward for the DB-authoritative row, but the
 * response already carries the freshly generated fields for immediate use.
 */
export async function regeneratePostMetadata(postId, fields = ["title", "caption", "hashtags"]) {
  if (!postId) throw new Error("No post to regenerate metadata for.");

  const { data, error } = await supabase.functions.invoke("generate-post-metadata", {
    body: { post_id: postId, fields },
  });

  if (error) {
    if (isEdgeFunctionUnavailable(error)) {
      markEdgeFunctionUnavailable("generate-post-metadata");
      throw new Error(buildUnavailableEdgeFunctionMessage("generate-post-metadata"));
    }
    throw await normalizeEdgeFunctionError(error, "generate-post-metadata");
  }
  clearEdgeFunctionUnavailable("generate-post-metadata");

  return data || {};
}

/**
 * Score an existing (or draft-in-progress) post's discovery readiness.
 * Passing postId lets seo-score persist seo_state/workflow_state itself.
 */
export async function scorePostSeo({ postId, title, caption, hashtags, platform, mediaType, visualPrompt }) {
  const trimmedCaption = String(caption || "").trim();
  if (!trimmedCaption) throw new Error("Caption is required before scoring SEO.");

  const { data, error } = await supabase.functions.invoke("seo-score", {
    body: {
      content_id: postId || null,
      title: String(title || "").trim(),
      caption: trimmedCaption,
      hashtags: normalizeHashtags(hashtags),
      platform: platform || "instagram",
      media_type: mediaType || "image",
      visual_prompt: visualPrompt || "",
    },
  });

  if (error) throw await normalizeEdgeFunctionError(error, "seo-score");

  return toDiscoveryScoreShape(readSeoResponseFields(data || {}));
}

/**
 * Rewrite + score a post's caption for discoverability in one call, and
 * persist the rewritten title/caption/hashtags to the posts row (content
 * persistence is caller-owned here, matching SessionStore.optimizeSeo's own
 * division of responsibility — only seo_state/workflow_state are server-
 * written, via content_id).
 */
export async function optimizePostSeo({ postId, title, caption, hashtags, platform, mediaType, visualPrompt, brandKit }) {
  const { data, error } = await supabase.functions.invoke("optimize-seo", {
    body: {
      content_id: postId || null,
      title: String(title || "").trim(),
      caption,
      hashtags: normalizeHashtags(hashtags),
      platform: platform || "instagram",
      brandKit: brandKit || null,
      targetKeywords: [],
      mediaType: mediaType || "image",
      visualPrompt: visualPrompt || "",
    },
  });

  if (error) throw await normalizeEdgeFunctionError(error, "optimize-seo");

  const result = data || {};
  const optimizedTitle = String(result.optimized_title || result.optimizedTitle || title || "").trim();
  const optimizedCaption = String(result.optimized_caption || result.optimizedCaption || caption || "").trim();
  const optimizedHashtags = normalizeHashtags(result.optimized_hashtags || result.optimizedHashtags || hashtags || []);
  const normalizedScore = readSeoResponseFields(result);

  if (postId) {
    const { error: updateError } = await supabase
      .from("posts")
      .update({
        title: optimizedTitle || null,
        caption: optimizedCaption,
        hashtags: optimizedHashtags,
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId);
    if (updateError) throw updateError;
  }

  return {
    ...toDiscoveryScoreShape(normalizedScore),
    optimizedTitle,
    optimizedCaption,
    optimizedHashtags,
  };
}
