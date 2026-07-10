/**
 * generateImage edge function — fal.ai FLUX.2 Pro
 *
 * Replaces: Magnific + Pollinations
 * Provider: fal.ai (FLUX.2 Pro — $0.03/MP, photorealistic)
 *
 * Flow:
 *   1. Auth + credit check
 *   2. Enhance prompt with Claude Haiku (brand DNA injection)
 *   3. Generate via FLUX.2 Pro on fal.ai
 *   4. Upload result to Supabase Storage
 *   5. Record generation in DB + deduct credits
 *   6. Return public URL + generation metadata
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { generateImageByModel, aspectToFalImageSize, type FalImageModel } from "../_shared/fal.service.ts";
import { compositeLogo, type LogoPosition } from "../_shared/composite.ts";
import { callPromptEngine } from "../_shared/llm.ts";

const GENERATED_BUCKET  = "generated_assets";
const CREDITS_PER_IMAGE = 1;

type GenerateImageBody = {
  prompt: string;
  aspect_ratio?: string;
  output_format?: "jpeg" | "png";
  seed?: number;
  brandKit?: Record<string, unknown>;
  enhance_prompt?: boolean;
  session_id?: string;
  record_generation?: boolean;
  image_model?: FalImageModel;
  rendering_speed?: "TURBO" | "BALANCED" | "QUALITY";
  negative_prompt?: string;
  recraft_style?: string;
  logo_url?: string;
  logo_position?: LogoPosition;
  logo_scale?: number;
  /** Which real product surface this image is for — used only to tag the
   * credit ledger row (see credit_transactions.category). Defaults to
   * "image" for the plain single/batch generator; the carousel pipeline
   * passes "carousel" since each slide goes through this same function. */
  category?: "image" | "carousel";
};

function buildBrandContext(brandKit: Record<string, unknown> | undefined): string {
  if (!brandKit) return "";
  const raw = (typeof brandKit.raw === "object" && brandKit.raw !== null)
    ? brandKit.raw as Record<string, unknown>
    : brandKit;
  return [
    raw.brand_name ? `Brand: ${raw.brand_name}` : "",
    raw.target_audience ? `Audience: ${raw.target_audience}` : "",
    raw.brand_voice ? `Brand voice: ${raw.brand_voice}` : "",
    Array.isArray(raw.tone_descriptors) ? `Tone: ${(raw.tone_descriptors as string[]).join(", ")}` : "",
    Array.isArray(raw.visual_style_keywords) ? `Visual style: ${(raw.visual_style_keywords as string[]).join(", ")}` : "",
    raw.photo_style_notes ? `Photo style: ${raw.photo_style_notes}` : "",
    Array.isArray(raw.avoid_visual_elements) ? `Avoid: ${(raw.avoid_visual_elements as string[]).join(", ")}` : "",
  ].filter(Boolean).join(". ");
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = String(hex || "").trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Best-effort extraction of brand colors (column names vary) → RGB triples for Recraft.
function extractBrandColors(raw: Record<string, unknown>): Array<{ r: number; g: number; b: number }> {
  const out: Array<{ r: number; g: number; b: number }> = [];
  const candidates: unknown[] = [];
  for (const key of ["brand_colors", "color_palette", "colors", "palette"]) {
    if (Array.isArray(raw[key])) candidates.push(...(raw[key] as unknown[]));
  }
  for (const key of ["primary_color", "secondary_color", "accent_color"]) {
    if (raw[key]) candidates.push(raw[key]);
  }
  for (const c of candidates) {
    const hex = typeof c === "string"
      ? c
      : (c && typeof c === "object" ? String((c as Record<string, unknown>).hex || (c as Record<string, unknown>).value || "") : "");
    const rgb = hexToRgb(hex);
    if (rgb) out.push(rgb);
  }
  return out.slice(0, 5);
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authClient  = createAuthClient(req.headers.get("Authorization"));
    const user        = await requireUser(authClient);
    const adminClient = createAdminClient();

    const body      = await parseJsonBody<GenerateImageBody>(req);
    const rawPrompt = (body.prompt ?? "").trim();
    if (!rawPrompt) return jsonResponse({ error: "prompt is required" }, 400);

    // ── Credit check (authoritative source: user_credits) ────────────────────
    const { data: creditRow } = await adminClient
      .from("user_credits").select("balance").eq("user_id", user.id).maybeSingle();

    const currentCredits = creditRow?.balance ?? 0;
    if (currentCredits < CREDITS_PER_IMAGE) {
      return jsonResponse({ error: "Insufficient credits" }, 402);
    }

    // ── Prompt enhancement — Claude Haiku brand injection ─────────────────────
    let finalPrompt        = rawPrompt;
    const shouldEnhance    = body.enhance_prompt !== false;
    const brandContext     = buildBrandContext(body.brandKit);

    if (shouldEnhance) {
      try {
        finalPrompt = await callPromptEngine({
          systemPrompt: `You are an expert AI image generation prompt engineer for FLUX.2 Pro.
Rewrite the user's prompt to produce a photorealistic, brand-consistent image.
Rules:
- Keep the user's core creative intent intact
- Inject brand visual style naturally into the scene description
- Add technical photography terms: lighting quality, lens, composition, mood
- Keep total length under 200 words
- Return ONLY the enhanced prompt, no explanation, no quotes`,
          userPrompt: `User prompt: "${rawPrompt}"${brandContext ? `\n\nBrand context:\n${brandContext}` : ""}`,
          maxTokens: 250,
        });
      } catch (_) {
        finalPrompt = rawPrompt; // non-critical fallback
      }
    }

    // ── Generate via the chosen fal.ai model (default Ideogram for exact text) ──
    const startedAt = Date.now();
    const imageSize = aspectToFalImageSize(body.aspect_ratio ?? "1:1");
    const rawKit = (body.brandKit && typeof body.brandKit.raw === "object" && body.brandKit.raw !== null)
      ? body.brandKit.raw as Record<string, unknown>
      : (body.brandKit ?? {});
    const brandColors = extractBrandColors(rawKit);
    const imageModel: FalImageModel = body.image_model ?? "ideogram";

    const { result, provider, modelId, costUsd } = await generateImageByModel(imageModel, {
      prompt:          finalPrompt,
      image_size:      imageSize,
      output_format:   body.output_format ?? "jpeg",
      seed:            body.seed,
      rendering_speed: body.rendering_speed,
      negative_prompt: body.negative_prompt,
      recraft_style:   body.recraft_style,
      brand_colors:    imageModel === "recraft" ? brandColors : undefined,
    });

    const sourceUrl = result.images?.[0]?.url;
    if (!sourceUrl) throw new Error(`fal.ai (${modelId}) returned no image URL`);

    // ── Fetch + (optional) brand-logo composite ───────────────────────────────
    const imgRes = await fetch(sourceUrl);
    if (!imgRes.ok) throw new Error("Failed to fetch generated image from fal.ai");
    let imgBytes = new Uint8Array(await imgRes.arrayBuffer());
    let ext = body.output_format ?? "jpeg";

    if (body.logo_url) {
      try {
        const logoRes = await fetch(body.logo_url);
        if (logoRes.ok) {
          const logoBytes = new Uint8Array(await logoRes.arrayBuffer());
          imgBytes = await compositeLogo(imgBytes, logoBytes, {
            position: body.logo_position,
            scalePct: body.logo_scale,
          });
          ext = "jpeg"; // compositeLogo always returns JPEG
        }
      } catch (compositeErr) {
        console.warn("[generateImage] logo composite failed; using base image:", compositeErr);
      }
    }

    // ── Upload to Supabase Storage ─────────────────────────────────────────────
    const fileName    = `${user.id}/${Date.now()}_${imageModel}.${ext}`;
    const contentType = ext === "png" ? "image/png" : "image/jpeg";

    const { error: uploadError } = await adminClient.storage
      .from(GENERATED_BUCKET)
      .upload(fileName, imgBytes, { contentType, upsert: true });

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    const { data: { publicUrl } } = adminClient.storage
      .from(GENERATED_BUCKET)
      .getPublicUrl(fileName);

    // ── Record generation + deduct credits ────────────────────────────────────
    let generationId: string | null = null;
    if (body.record_generation !== false) {
      const { data: generation, error: insertError } = await adminClient
        .from("generations")
        .insert({
          user_id:         user.id,
          session_id:      body.session_id ?? null,
          prompt:          rawPrompt,
          enhanced_prompt: finalPrompt !== rawPrompt ? finalPrompt : null,
          media_type:      "image",
          status:          "completed",
          output_url:      publicUrl,
          storage_path:    publicUrl,
          provider:        provider,
          provider_model:  modelId,
          aspect_ratio:    body.aspect_ratio ?? "1:1",
          metadata: {
            seed:        result.seed ?? null,
            image_size:  imageSize,
            image_model: imageModel,
            cost_usd:    costUsd,
          },
        })
        .select("id")
        .single();
      if (insertError) {
        console.error("[generateImage] failed to record generation:", insertError);
        throw new Error(`Failed to record generation: ${insertError.message}`);
      }
      generationId = generation?.id ?? null;
    }

    await adminClient.rpc("deduct_credits", {
      p_user_id:     user.id,
      p_amount:      CREDITS_PER_IMAGE,
      p_category:    body.category === "carousel" ? "carousel" : "image",
      p_description: body.category === "carousel" ? "Carousel slide image" : "Image generation",
    });

    return jsonResponse({
      url:               publicUrl,
      publicUrl,
      public_url:        publicUrl,
      storagePath:       fileName,
      storage_path:      fileName,
      generation_id:     generationId,
      prompt_used:       finalPrompt,
      provider:          provider,
      providerModel:     modelId,
      provider_model:    modelId,
      providerEndpoint:  modelId,
      provider_endpoint: modelId,
      generationTimeMs:  Date.now() - startedAt,
      generation_time_ms: Date.now() - startedAt,
      seed:              result.seed ?? null,
      credits_used:      CREDITS_PER_IMAGE,
      credits_remaining: currentCredits - CREDITS_PER_IMAGE,
    });

  } catch (error) {
    console.error("[generateImage] error:", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
