/**
 * editImage edge function — fal.ai FLUX.1 Kontext Pro
 *
 * Replaces: Magnific (seedream-v4-5-edit)
 * Provider: fal.ai (FLUX.1 Kontext Pro — prompt-driven edit of an existing image)
 *
 * Flow:
 *   1. Auth + credit check
 *   2. Enhance prompt with Claude Haiku (brand DNA injection)
 *   3. Edit via FLUX.1 Kontext Pro on fal.ai
 *   4. Upload result to Supabase Storage
 *   5. Record generation in DB + deduct credits
 *   6. Return public URL + generation metadata
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { generateImageEdit, FAL_COST_USD, FAL_MODELS } from "../_shared/fal.service.ts";
import { callPromptEngine } from "../_shared/llm.ts";
import { createHttpError } from "../_shared/org.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { completeGeneration, findCachedGeneration, reserveCredits } from "../_shared/generationIdempotency.ts";

const GENERATED_BUCKET = "generated_assets";
const CREDITS_PER_EDIT = 3;

type EditImageBody = {
  prompt?: string;
  brandKit?: Record<string, unknown>;
  sourceImageUrl?: string;
  aspectRatio?: string;
  enhance_prompt?: boolean;
  session_id?: string;
  request_id?: string;
  request_slot?: number;
  generation_id?: string;
};

function buildBrandContext(brandKit: Record<string, unknown> | undefined): string {
  if (!brandKit) return "";
  const raw = (typeof brandKit.raw === "object" && brandKit.raw !== null)
    ? brandKit.raw as Record<string, unknown> : brandKit;
  return [
    raw.brand_name ? `Brand: ${raw.brand_name}` : "",
    raw.brand_voice ? `Brand voice: ${raw.brand_voice}` : "",
    Array.isArray(raw.visual_style_keywords) ? `Visual style: ${(raw.visual_style_keywords as string[]).join(", ")}` : "",
    Array.isArray(raw.avoid_visual_elements) ? `Avoid: ${(raw.avoid_visual_elements as string[]).join(", ")}` : "",
  ].filter(Boolean).join(". ");
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let refundCreditsIfReserved: () => Promise<void> = async () => {};

  try {
    const authClient = createAuthClient(req.headers.get("Authorization"));
    const user = await requireUser(authClient);
    const adminClient = createAdminClient();
    await enforceRateLimit(adminClient, user.id, "editImage");

    const body = await parseJsonBody<EditImageBody>(req);
    const rawPrompt = (body.prompt || "").trim();
    const sourceImageUrl = (body.sourceImageUrl || "").trim();

    if (!rawPrompt) {
      throw createHttpError("Missing prompt", 400);
    }
    if (!sourceImageUrl) {
      throw createHttpError("Missing sourceImageUrl for edit mode", 400);
    }

    const requestId   = body.request_id || null;
    const requestSlot = Number.isFinite(body.request_slot) ? Number(body.request_slot) : 0;

    const cached = await findCachedGeneration(adminClient, user.id, requestId, requestSlot);
    if (cached) {
      const meta = (cached.metadata && typeof cached.metadata === "object") ? cached.metadata as Record<string, unknown> : {};
      return jsonResponse({
        publicUrl: cached.output_url, storagePath: cached.storage_path,
        generation_id: cached.id, status: "completed",
        provider: cached.provider, providerModel: cached.provider_model, providerEndpoint: cached.provider_model,
        generationTimeMs: 0, prompt: cached.enhanced_prompt || cached.prompt,
        seed: meta.seed ?? null,
        credits_used: 0,
        replayed: true,
      });
    }

    // ── Credit check (authoritative source: user_credits) ────────────────────
    const { data: creditRow } = await adminClient
      .from("user_credits").select("balance").eq("user_id", user.id).maybeSingle();
    const currentCredits = creditRow?.balance ?? 0;
    if (currentCredits < CREDITS_PER_EDIT) {
      throw createHttpError("Insufficient credits", 402);
    }

    // ── Reserve credits BEFORE any provider work (atomic, refunded on failure) ──
    await reserveCredits(adminClient, user.id, CREDITS_PER_EDIT, "edit", "Image edit");
    let creditsReserved = true;
    refundCreditsIfReserved = async () => {
      if (!creditsReserved) return;
      creditsReserved = false;
      try {
        await adminClient.rpc("refund_credits", {
          p_user_id: user.id, p_amount: CREDITS_PER_EDIT, p_category: "edit",
          p_description: "Refund: edit failed after credit reservation",
        });
      } catch (refundErr) {
        console.error("[editImage] refund after failure also failed:", refundErr);
      }
    };

    // ── Prompt enhancement — Claude Haiku brand injection ─────────────────────
    let finalPrompt = rawPrompt;
    if (body.enhance_prompt !== false) {
      try {
        const brandContext = buildBrandContext(body.brandKit);
        finalPrompt = await callPromptEngine({
          systemPrompt: `You are an expert AI image-editing prompt engineer for FLUX.1 Kontext Pro.
Rewrite the user's edit instruction to be precise and unambiguous about what should change in the source image.
Rules:
- Keep the user's core edit intent intact
- Reference brand visual style only where it doesn't conflict with the requested edit
- Keep total length under 120 words
- Return ONLY the enhanced instruction, no explanation, no quotes`,
          userPrompt: `Edit instruction: "${rawPrompt}"${brandContext ? `\n\nBrand context:\n${brandContext}` : ""}`,
          maxTokens: 200,
        });
      } catch (_) {
        finalPrompt = rawPrompt; // non-critical fallback
      }
    }

    // ── Edit via fal.ai FLUX.1 Kontext Pro ─────────────────────────────────────
    const startedAt = Date.now();
    const result = await generateImageEdit({
      prompt:        finalPrompt,
      image_url:     sourceImageUrl,
      aspect_ratio:  body.aspectRatio,
    });

    const providerUrl = result.images?.[0]?.url;
    if (!providerUrl) throw new Error(`fal.ai (${FAL_MODELS.imageEditKontext}) returned no image URL`);

    // ── Upload to Supabase Storage ─────────────────────────────────────────────
    const imgRes = await fetch(providerUrl);
    if (!imgRes.ok) throw new Error("Failed to fetch edited image from fal.ai");
    const imgBytes = new Uint8Array(await imgRes.arrayBuffer());

    const fileName = `${user.id}/${Date.now()}_edit.jpeg`;
    const { error: uploadError } = await adminClient.storage
      .from(GENERATED_BUCKET)
      .upload(fileName, imgBytes, { contentType: "image/jpeg", upsert: true });

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    const { data: { publicUrl } } = adminClient.storage
      .from(GENERATED_BUCKET)
      .getPublicUrl(fileName);

    // ── Generation row ownership (see generateImage/index.ts for the full
    // rationale) — generationPipeline.js owns creation/FAILED; this function
    // owns writing COMPLETED onto the same row via generation_id. ─────────
    const generationId = await completeGeneration(adminClient, body.generation_id, user.id, {
      request_id:      requestId,
      request_slot:    requestSlot,
      prompt:          rawPrompt,
      enhanced_prompt: finalPrompt !== rawPrompt ? finalPrompt : null,
      output_url:      publicUrl,
      storage_path:    publicUrl,
      provider:        "fal-ai",
      provider_model:  FAL_MODELS.imageEditKontext,
      aspect_ratio:    body.aspectRatio ?? null,
      metadata: {
        seed:              result.seed ?? null,
        source_image_url:  sourceImageUrl,
        cost_usd:          FAL_COST_USD.imageEditKontext,
      },
    });

    return jsonResponse({
      publicUrl,
      storagePath: fileName,
      generation_id: generationId,
      status: "completed",
      provider: "fal-ai",
      providerModel: FAL_MODELS.imageEditKontext,
      providerEndpoint: FAL_MODELS.imageEditKontext,
      generationTimeMs: Date.now() - startedAt,
      prompt: finalPrompt,
      credits_used: CREDITS_PER_EDIT,
      credits_remaining: currentCredits - CREDITS_PER_EDIT,
    });
  } catch (error) {
    await refundCreditsIfReserved();
    console.error("[editImage] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
