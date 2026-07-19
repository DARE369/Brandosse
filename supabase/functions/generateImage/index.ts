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
import { createHttpError } from "../_shared/org.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { completeGeneration, findCachedGeneration, reserveCredits } from "../_shared/generationIdempotency.ts";

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
  /** Client-generated attempt id (see _shared/generationIdempotency.ts). A
   * Retry click mints a new one; a network-level double-invoke of the same
   * attempt reuses it, so a duplicate call replays the cached result instead
   * of rendering/billing twice. */
  request_id?: string;
  /** Disambiguates multiple images under the same request_id (variant index
   * for image batches). Defaults to 0. */
  request_slot?: number;
  /** id of the PROCESSING placeholder row generationPipeline.js already
   * inserted for this attempt — when present, this function writes the
   * COMPLETED transition onto that exact row (see _shared/generationIdempotency.ts
   * completeGeneration) instead of leaving completion solely to the client. */
  generation_id?: string;
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

// Model-aware enhancer instructions (1.3). Each fal image model responds to
// different prompt vocabulary — using FLUX's photographic language on Ideogram
// (or vice-versa) wastes the model's strengths. One pass, matched to the
// engine actually being used.
function buildEnhancerSystemPrompt(model: FalImageModel): string {
  const common = `Keep the user's core creative intent intact.
Inject brand visual style naturally where it doesn't fight the request.
Keep total length under 200 words.
Return ONLY the enhanced prompt — no explanation, no quotes, no preamble.`;

  switch (model) {
    case "ideogram":
      return `You are an expert prompt engineer for Ideogram v3, whose strength is rendering exact, legible TEXT inside the image (flyers, posters, quote cards).
Rewrite the user's prompt for a clean, brand-consistent graphic.
- If the image should contain words, state the EXACT text in double quotes and where it sits (e.g. headline "50% OFF" centered, small print "Valid till Friday" at the bottom).
- Describe layout, typography feel, and color, not camera/lens terms.
${common}`;
    case "recraft":
      return `You are an expert prompt engineer for Recraft v3, whose strength is design language — logos, icons, vector art, flat illustration, typographic layouts.
Rewrite the user's prompt for a crisp, on-brand design.
- Use design vocabulary: vector, flat, line-art, geometric, negative space, grid, palette.
- Avoid photographic terms (lens, depth of field, bokeh) — this is not a photo.
${common}`;
    case "flux":
    default:
      return `You are an expert prompt engineer for FLUX.2 Pro, whose strength is PHOTOREALISM — people, products, food, real environments.
Rewrite the user's prompt to produce a photorealistic, brand-consistent image.
- Add photographic terms: lighting quality, lens/focal length, composition, depth of field, mood.
- Do not ask for text baked into the image — FLUX renders text poorly.
${common}`;
  }
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

  // Declared here (not inside the try below) so the outer catch can still
  // call it after a mid-flight failure — try/catch blocks in JS do not share
  // let/const scope with each other.
  let refundCreditsIfReserved: () => Promise<void> = async () => {};

  try {
    const authClient  = createAuthClient(req.headers.get("Authorization"));
    const user        = await requireUser(authClient);
    const adminClient = createAdminClient();
    await enforceRateLimit(adminClient, user.id, "generateImage");

    const body      = await parseJsonBody<GenerateImageBody>(req);
    const rawPrompt = (body.prompt ?? "").trim();
    if (!rawPrompt) throw createHttpError("prompt is required", 400);

    const requestId   = body.request_id || null;
    const requestSlot = Number.isFinite(body.request_slot) ? Number(body.request_slot) : 0;

    // ── Idempotency: replay a cached result instead of re-rendering/re-billing ──
    const cached = await findCachedGeneration(adminClient, user.id, requestId, requestSlot);
    if (cached) {
      const meta = (cached.metadata && typeof cached.metadata === "object") ? cached.metadata as Record<string, unknown> : {};
      return jsonResponse({
        url: cached.output_url, publicUrl: cached.output_url, public_url: cached.output_url,
        storagePath: cached.storage_path, storage_path: cached.storage_path,
        generation_id: cached.id,
        prompt_used: cached.enhanced_prompt || cached.prompt,
        provider: cached.provider, providerModel: cached.provider_model, provider_model: cached.provider_model,
        providerEndpoint: cached.provider_model, provider_endpoint: cached.provider_model,
        generationTimeMs: 0, generation_time_ms: 0,
        seed: meta.seed ?? null,
        credits_used: 0,
        replayed: true,
      });
    }

    // ── Credit check (authoritative source: user_credits) ────────────────────
    const { data: creditRow } = await adminClient
      .from("user_credits").select("balance").eq("user_id", user.id).maybeSingle();

    const currentCredits = creditRow?.balance ?? 0;
    if (currentCredits < CREDITS_PER_IMAGE) {
      throw createHttpError("Insufficient credits", 402);
    }

    // ── Reserve credits BEFORE any provider work (atomic; see
    // _shared/generationIdempotency.ts) — closes the race where two
    // concurrent requests both pass the advisory check above and both
    // render/bill. Refunded automatically if generation fails below.
    await reserveCredits(adminClient, user.id, CREDITS_PER_IMAGE, body.category === "carousel" ? "carousel" : "image", body.category === "carousel" ? "Carousel slide image" : "Image generation");
    let creditsReserved = true;
    refundCreditsIfReserved = async () => {
      if (!creditsReserved) return;
      creditsReserved = false;
      try {
        await adminClient.rpc("refund_credits", {
          p_user_id: user.id, p_amount: CREDITS_PER_IMAGE,
          p_category: body.category === "carousel" ? "carousel" : "image",
          p_description: "Refund: generation failed after credit reservation",
        });
      } catch (refundErr) {
        console.error("[generateImage] refund after failure also failed:", refundErr);
      }
    };

    // Resolve the target model FIRST — the prompt enhancement below is
    // model-aware (1.3), so it has to know which engine it's writing for.
    // Default 'flux' (the safe photorealistic generalist) rather than the old
    // 'ideogram' (which sent every image through the text-rendering engine).
    // In practice the pipeline always passes an explicit body.image_model
    // resolved from render_intent (1.1).
    const imageModel: FalImageModel = body.image_model ?? "flux";

    // ── Prompt enhancement — ONE model-aware pass (1.3) ───────────────────────
    // Previously this always assumed FLUX.2 Pro regardless of the model that
    // actually ran (wrong vocabulary for Ideogram/Recraft) AND ran on top of
    // the content-plan's already-enhanced prompt (a second blind rewrite). Now
    // it's a single pass whose instructions match the engine being used.
    let finalPrompt        = rawPrompt;
    const shouldEnhance    = body.enhance_prompt !== false;
    const brandContext     = buildBrandContext(body.brandKit);

    if (shouldEnhance) {
      try {
        finalPrompt = await callPromptEngine({
          systemPrompt: buildEnhancerSystemPrompt(imageModel),
          userPrompt: `User prompt: "${rawPrompt}"${brandContext ? `\n\nBrand context:\n${brandContext}` : ""}`,
          maxTokens: 250,
        });
      } catch (_) {
        finalPrompt = rawPrompt; // non-critical fallback
      }
    }

    // ── Generate via the chosen fal.ai model ──────────────────────────────────
    const startedAt = Date.now();
    const imageSize = aspectToFalImageSize(body.aspect_ratio ?? "1:1");
    const rawKit = (body.brandKit && typeof body.brandKit.raw === "object" && body.brandKit.raw !== null)
      ? body.brandKit.raw as Record<string, unknown>
      : (body.brandKit ?? {});
    const brandColors = extractBrandColors(rawKit);

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

    // ── Generation row ownership ──────────────────────────────────────────────
    // This function never INSERTS a `generations` row — generationPipeline.js
    // (client) owns creating the PROCESSING placeholder and marking FAILED
    // (the only place that can observe a request that never reached this
    // function at all). This function owns writing the COMPLETED transition
    // onto that same row (via generation_id) BEFORE returning, so idempotency
    // holds even if the response never reaches the client (see
    // _shared/generationIdempotency.ts completeGeneration). The old
    // `record_generation` flag guarded a second, independent insert here that
    // every caller always disabled (confirmed zero callers ever passed
    // anything but `false` — audit-brief/07-structural-findings.md 0.5);
    // deleted rather than left as dead code, per Week 3 Fix 2.
    const generationId = await completeGeneration(adminClient, body.generation_id, user.id, {
      request_id:      requestId,
      request_slot:    requestSlot,
      prompt:          rawPrompt,
      enhanced_prompt: finalPrompt !== rawPrompt ? finalPrompt : null,
      output_url:      publicUrl,
      storage_path:    publicUrl,
      provider,
      provider_model:  modelId,
      aspect_ratio:    body.aspect_ratio ?? "1:1",
      metadata: {
        seed:        result.seed ?? null,
        image_size:  imageSize,
        image_model: imageModel,
        cost_usd:    costUsd,
      },
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
      image_model:       imageModel,
      credits_used:      CREDITS_PER_IMAGE,
      credits_remaining: currentCredits - CREDITS_PER_IMAGE,
    });

  } catch (error) {
    await refundCreditsIfReserved();
    console.error("[generateImage] error:", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
