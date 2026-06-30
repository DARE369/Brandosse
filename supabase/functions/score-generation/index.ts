/**
 * score-generation edge function — Gemini 2.5 Flash
 *
 * Scores a generated image or video against the original brief and brand kit.
 * Gemini 2.5 Flash is the only major AI that can natively read and understand video,
 * making it uniquely suited for scoring both media types from a single call.
 *
 * Returns a 0-100 score with breakdown: brief match, brand alignment, platform fit.
 * Stores the score on the generation record.
 *
 * Also handles:
 *   - Brand DNA extraction from uploaded files
 *   - SEO + platform-specific caption optimisation
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { scoreGeneration, extractBrandDNA, optimizeForPlatform } from "../_shared/gemini.service.ts";

type ScoreAction = "score" | "brand_dna" | "optimize_seo";

type ScoreGenerationBody = {
  action: ScoreAction;

  // for "score"
  generation_id?: string;
  media_url?: string;
  media_type?: "image" | "video";
  original_brief?: string;
  platform?: string;
  brand_context?: string;
  generated_caption?: string;

  // for "brand_dna"
  file_url?: string;
  text_content?: string;
  existing_brand_context?: string;

  // for "optimize_seo"
  caption?: string;
  hashtags?: string[];
  target_keywords?: string[];
  media_description?: string;
};

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authClient  = createAuthClient(req.headers.get("Authorization"));
    const user        = await requireUser(authClient);
    const adminClient = createAdminClient();

    const body = await parseJsonBody<ScoreGenerationBody>(req);
    const { action } = body;

    if (!action) return jsonResponse({ error: "action is required" }, 400);

    // ── score: rate a generation against its brief ────────────────────────────
    if (action === "score") {
      const { media_url, media_type, original_brief, platform, brand_context } = body;
      if (!media_url || !media_type || !original_brief || !platform) {
        return jsonResponse({ error: "media_url, media_type, original_brief, and platform are required" }, 400);
      }

      const result = await scoreGeneration({
        mediaUrl:          media_url,
        mediaType:         media_type,
        originalBrief:     original_brief,
        platform,
        brandContext:      brand_context ?? "",
        generatedCaption:  body.generated_caption,
      });

      // Write score back to the generation record if generation_id provided
      if (body.generation_id) {
        await adminClient
          .from("generations")
          .update({
            ai_score:    result.score,
            ai_grade:    result.grade,
            ai_feedback: result,
          })
          .eq("id", body.generation_id)
          .eq("user_id", user.id); // scoped to user for safety
      }

      return jsonResponse({ ...result, provider: "gemini-2.5-flash" });
    }

    // ── brand_dna: extract brand identity from a file or text ─────────────────
    if (action === "brand_dna") {
      const result = await extractBrandDNA({
        fileUrl:               body.file_url,
        textContent:           body.text_content,
        existingBrandContext:  body.existing_brand_context,
      });
      return jsonResponse({ ...result, provider: "gemini-2.5-flash" });
    }

    // ── optimize_seo: platform-optimised caption + hashtag rewrite ────────────
    if (action === "optimize_seo") {
      const { caption, hashtags, platform, brand_context } = body;
      if (!caption || !platform) {
        return jsonResponse({ error: "caption and platform are required" }, 400);
      }

      const result = await optimizeForPlatform({
        caption,
        hashtags:        hashtags ?? [],
        platform,
        brandContext:    brand_context ?? "",
        targetKeywords:  body.target_keywords,
        mediaDescription: body.media_description,
      });

      return jsonResponse({ ...result, provider: "gemini-2.5-flash" });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);

  } catch (error) {
    console.error("[score-generation] error:", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
