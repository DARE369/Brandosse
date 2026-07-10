/**
 * generateVideo edge function — fal.ai Hailuo 2.3 (standard) + Kling 2.5 Pro (premium)
 *
 * Replaces: Magnific video placeholder
 *
 * Tier selection (via `quality` param):
 *   "standard" → Hailuo 2.3  — $0.50/clip, 5-6s, 768p, fast, strong consistency
 *                Image-to-video only. A "standard" request with no `image_url`
 *                cannot run on Hailuo, so it is billed and recorded as
 *                "premium" (Kling) instead — never silently billed as standard.
 *                See `tierUpgraded`/`tier_upgrade_reason` in the response.
 *   "premium"  → Kling 2.5 Pro — $0.07/sec, up to 30s, near-cinematic, image-to-video
 *
 * Both support text-to-video and image-to-video (pass `image_url` for i2v).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import {
  generateVideoHailuo, generateVideoKling, generateVideoKlingI2V,
  FAL_COST_USD, type FalVideoAspect, type FalVideoDuration,
} from "../_shared/fal.service.ts";
import { callPromptEngine } from "../_shared/llm.ts";

const GENERATED_BUCKET   = "generated_assets";
const CREDITS_STD_VIDEO  = 5;
const CREDITS_PRO_VIDEO  = 15;

type GenerateVideoBody = {
  prompt: string;
  quality?: "standard" | "premium";
  image_url?: string;          // for image-to-video mode
  duration?: FalVideoDuration; // "5" or "10"
  aspect_ratio?: FalVideoAspect;
  brandKit?: Record<string, unknown>;
  enhance_prompt?: boolean;
  session_id?: string;
  record_generation?: boolean;
};

function buildBrandContext(brandKit: Record<string, unknown> | undefined): string {
  if (!brandKit) return "";
  const raw = (typeof brandKit.raw === "object" && brandKit.raw !== null)
    ? brandKit.raw as Record<string, unknown> : brandKit;
  return [
    raw.brand_name ? `Brand: ${raw.brand_name}` : "",
    Array.isArray(raw.visual_style_keywords)
      ? `Visual style: ${(raw.visual_style_keywords as string[]).join(", ")}` : "",
  ].filter(Boolean).join(". ");
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authClient  = createAuthClient(req.headers.get("Authorization"));
    const user        = await requireUser(authClient);
    const adminClient = createAdminClient();

    const body      = await parseJsonBody<GenerateVideoBody>(req);
    const rawPrompt = (body.prompt ?? "").trim();
    if (!rawPrompt) return jsonResponse({ error: "prompt is required" }, 400);

    const startedAt = Date.now();
    const requestedQuality = body.quality === "premium" ? "premium" : "standard";
    const isI2V        = Boolean(body.image_url);

    // Hailuo 2.3 (the "standard" tier engine) is image-to-video only. A
    // "standard" request with no source image cannot run on Hailuo, so it
    // renders on Kling 2.5 Pro (premium) instead. That is a real tier/engine
    // substitution — it must be billed and recorded as premium, not silently
    // passed through as standard. See generateVideo header comment.
    const tierUpgraded = requestedQuality === "standard" && !isI2V;
    const quality = tierUpgraded ? "premium" : requestedQuality;
    const creditsNeeded = quality === "premium" ? CREDITS_PRO_VIDEO : CREDITS_STD_VIDEO;

    // ── Credit check (authoritative source: user_credits) ─────────────────────
    // Checked against the tier that will actually render/bill, not the one requested.
    const { data: creditRow } = await adminClient
      .from("user_credits").select("balance").eq("user_id", user.id).maybeSingle();

    const currentCredits = creditRow?.balance ?? 0;
    if (currentCredits < creditsNeeded) {
      return jsonResponse({
        error: tierUpgraded
          ? `Insufficient credits. Standard-tier text-to-video requires a source image; without one this renders at premium quality (${CREDITS_PRO_VIDEO} credits).`
          : "Insufficient credits",
      }, 402);
    }

    // ── Prompt enhancement — Claude Haiku ─────────────────────────────────────
    let finalPrompt = rawPrompt;
    if (body.enhance_prompt !== false) {
      try {
        const brandCtx = buildBrandContext(body.brandKit);
        finalPrompt = await callPromptEngine({
          systemPrompt: `You are an expert AI video generation prompt engineer.
Rewrite the prompt for ${quality === "premium" ? "Kling 2.5 Pro (cinematic quality)" : "Hailuo 2.3 (fluid 1080p)"}.
Rules:
- Describe motion, camera movement, and scene progression clearly
- Keep brand aesthetic consistent${isI2V ? "\n- The video starts from a reference image — describe how the scene should evolve" : ""}
- Add cinematography language: shot type, camera movement, lighting, pacing
- Max 150 words
- Return ONLY the enhanced prompt`,
          userPrompt: `Prompt: "${rawPrompt}"${brandCtx ? `\nBrand: ${brandCtx}` : ""}`,
          maxTokens: 200,
        });
      } catch (_) {
        finalPrompt = rawPrompt;
      }
    }

    // ── Generate ──────────────────────────────────────────────────────────────
    const duration     = body.duration     ?? "5";
    const aspect_ratio = body.aspect_ratio ?? "16:9";
    let videoUrl: string;
    let providerModel: string;
    let costUsd: number;

    if (quality === "premium") {
      const result = isI2V
        ? await generateVideoKlingI2V({ prompt: finalPrompt, image_url: body.image_url!, duration, aspect_ratio })
        : await generateVideoKling({ prompt: finalPrompt, duration, aspect_ratio });
      videoUrl     = result.video.url;
      providerModel = isI2V ? "kling-video/v2.5-pro/i2v" : "kling-video/v2.5-pro";
      costUsd      = FAL_COST_USD.videoKlingPerSec * Number(duration);
    } else {
      // quality === "standard" is only reachable here when isI2V is true —
      // a standard request with no image is upgraded to premium/Kling above.
      const result = await generateVideoHailuo({ prompt: finalPrompt, image_url: body.image_url!, duration, aspect_ratio });
      videoUrl      = result.video.url;
      providerModel = "hailuo-2.3";
      costUsd       = FAL_COST_USD.videoHailouPerClip;
    }

    // ── Upload to Supabase Storage ─────────────────────────────────────────────
    const fileName = `${user.id}/${Date.now()}_${providerModel.replace(/\//g, "-")}.mp4`;
    const vidRes   = await fetch(videoUrl);
    if (!vidRes.ok) throw new Error("Failed to fetch generated video from fal.ai");
    const vidBlob  = await vidRes.blob();

    const { error: uploadError } = await adminClient.storage
      .from(GENERATED_BUCKET)
      .upload(fileName, vidBlob, { contentType: "video/mp4", upsert: true });

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    const { data: { publicUrl } } = adminClient.storage
      .from(GENERATED_BUCKET)
      .getPublicUrl(fileName);

    // ── Record + deduct credits ────────────────────────────────────────────────
    let generationId: string | null = null;
    if (body.record_generation !== false) {
      const { data: generation, error: insertError } = await adminClient
        .from("generations")
        .insert({
          user_id:         user.id,
          session_id:      body.session_id ?? null,
          prompt:          rawPrompt,
          enhanced_prompt: finalPrompt !== rawPrompt ? finalPrompt : null,
          media_type:      "video",
          status:          "completed",
          output_url:      publicUrl,
          storage_path:    publicUrl,
          provider:        "fal-ai",
          provider_model:  providerModel,
          aspect_ratio:    aspect_ratio,
          metadata: {
            quality, requested_quality: requestedQuality, tier_upgraded: tierUpgraded,
            duration, is_image_to_video: isI2V, cost_usd: costUsd,
          },
        })
        .select("id")
        .single();
      if (insertError) {
        console.error("[generateVideo] failed to record generation:", insertError);
        throw new Error(`Failed to record generation: ${insertError.message}`);
      }
      generationId = generation?.id ?? null;
    }

    await adminClient.rpc("deduct_credits", {
      p_user_id:     user.id,
      p_amount:      creditsNeeded,
      p_category:    "video",
      p_description: `Video generation (${quality})`,
    });

    return jsonResponse({
      url:               publicUrl,
      publicUrl,
      public_url:        publicUrl,
      storagePath:       fileName,
      storage_path:      fileName,
      generation_id:     generationId,
      status:            "completed",
      prompt_used:       finalPrompt,
      quality,
      requested_quality: requestedQuality,
      tier_upgraded:     tierUpgraded,
      tier_upgrade_reason: tierUpgraded
        ? "Standard tier requires a source image for image-to-video; this request had none, so it rendered (and is billed) at premium quality instead."
        : null,
      provider:          "fal-ai",
      providerModel,
      provider_model:    providerModel,
      providerEndpoint:  `fal-ai/${providerModel}`,
      provider_endpoint: `fal-ai/${providerModel}`,
      generationTimeMs:  Date.now() - startedAt,
      generation_time_ms: Date.now() - startedAt,
      credits_used:      creditsNeeded,
      credits_remaining: currentCredits - creditsNeeded,
    });

  } catch (error) {
    console.error("[generateVideo] error:", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
