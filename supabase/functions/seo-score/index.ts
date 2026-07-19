import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { readEnv } from "../_shared/env.ts";
import { createHttpError } from "../_shared/org.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { persistSeoState, scoreContent } from "../_shared/seo.ts";
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

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authClient = createAuthClient(req.headers.get("Authorization"));
    const user = await requireUser(authClient);
    await enforceRateLimit(authClient, user.id, "seo-score");
    const body = await parseJsonBody<SeoScoreRequest>(req);

    if (!readEnv("ANTHROPIC_API_KEY", false)) {
      throw createHttpError("ANTHROPIC_API_KEY is required for Claude Social SEO and Discovery Score analysis.", 500);
    }

    const caption = String(body.caption || "").trim();
    if (!caption) {
      throw createHttpError("caption is required", 400);
    }

    const normalized = await scoreContent({
      title: body.title,
      caption,
      hashtags: body.hashtags,
      platform: body.platform,
      mediaType: body.media_type,
      visualPrompt: body.visual_prompt,
    });

    // WEEK 2 FIX 4: seo-score is now the writer of posts.seo_state /
    // workflow_state.seo_status (previously the client wrote this itself
    // after receiving the response) — server owns its own writes, same
    // philosophy as Fix 3's metadata lifecycle.
    const contentId = body.content_id || body.post_id || null;
    if (contentId) {
      const adminClient = createAdminClient();
      await persistSeoState(adminClient, contentId, normalized);
    }

    return jsonResponse({
      content_id: contentId,
      overall: normalized.overall,
      discoveryScore: normalized.overall,
      discovery_score: normalized.overall,
      breakdown: normalized.breakdown,
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
    console.error("[seo-score] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
