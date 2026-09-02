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
import type { DatabaseClient } from "../_shared/supabase.ts";
import { buildBrandSummary, loadBrandKit } from "../_shared/brandKit.ts";
import { recordCost } from "../_shared/costLedger.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { generateImageByModel, aspectToFalImageSize, type FalImageModel } from "../_shared/fal.service.ts";
import { compositeLogo, type LogoPosition } from "../_shared/composite.ts";
import { safeFetch } from "../_shared/safeFetch.ts";
import { readDesignFromKit } from "../_shared/brandDesign.ts";
import {
  compositeDesign,
  CompositorUnavailableError,
  type TextContent,
} from "../_shared/designCompositor.ts";
import {
  backgroundDirectiveFor,
  pickTemplate,
  type DesignTemplate,
} from "../_shared/designTemplates.ts";
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
  /** IGNORED since 2026-08-31 — the kit is loaded server-side by user_id.
   *  Accepting it from the body meant treating attacker-chosen text as the
   *  authenticated user's brand. Kept in the type so older clients that
   *  still send it are not rejected; the value is never read. */
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
  /** Reference images for brand/subject consistency (4.1). When present the
   * request routes to FLUX.2's multi-reference endpoint regardless of
   * image_model (see generateImageByModel). Up to ~9 are used. */
  reference_image_urls?: string[];
  rendering_speed?: "TURBO" | "BALANCED" | "QUALITY";
  negative_prompt?: string;
  recraft_style?: string;
  /**
   * Draw the text DETERMINISTICALLY instead of asking the image model to.
   *
   * When present, the model renders a text-free background with calm space
   * where the layout reserves it, and the words are composited afterwards in
   * the brand's real typeface at its exact colours. This is what removes
   * misspellings, wrong fonts, colour drift and the word-count cap in one move
   * — see _shared/designCompositor.ts.
   */
  compose?: {
    template_id?: string;
    /** Layouts this brand used recently, so the same one is not reused. */
    recent_template_ids?: string[];
    text?: TextContent;
  };
  /** Stamp the user's ACTIVE brand-kit logo onto the result. The logo file is
   * resolved server-side from `brand_assets` (see resolveBrandLogo) because the
   * bucket is private — a client-built public URL 400s. `logo_url` remains
   * supported for callers supplying their own already-reachable image. */
  apply_logo?: boolean;
  logo_url?: string;
  logo_position?: LogoPosition;
  logo_scale?: number;
  /** Which real product surface this image is for — used only to tag the
   * credit ledger row (see credit_transactions.category). Defaults to
   * "image" for the plain single/batch generator; the carousel pipeline
   * passes "carousel" since each slide goes through this same function. */
  category?: "image" | "carousel";
};

/**
 * Fetch the active brand kit's logo bytes for `userId`.
 *
 * Why server-side: `brand_assets` is a PRIVATE bucket. The `public_url` column
 * stored on each row is a public-style URL that returns HTTP 400 — verified
 * 2026-08-24 against the live row for Oriki_Soda_Co_Logo.svg. Only a
 * service-role download can read the file, so the client cannot supply it and
 * must not try.
 *
 * Returns null when the user simply has no logo (not an error). Throws when a
 * logo exists but cannot be read — the caller reports that, never hides it.
 */
async function resolveBrandLogo(
  adminClient: DatabaseClient,
  userId: string,
): Promise<{ bytes: Uint8Array; mimeType: string; name: string } | null> {
  const { data: kit } = await adminClient
    .from("brand_kit")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (!kit?.id) return null;

  const { data: asset } = await adminClient
    .from("brand_assets")
    .select("name, storage_path, mime_type")
    .eq("brand_kit_id", kit.id)
    .eq("asset_type", "logo")
    .eq("status", "ready")
    // updated_at, not created_at: marking an older file as the logo is how a
    // user CHOOSES between several, and that choice must win over upload order.
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!asset?.storage_path) return null;

  const { data: blob, error } = await adminClient
    .storage.from("brand_assets")
    .download(asset.storage_path);
  if (error || !blob) {
    throw new Error(
      `brand logo "${asset.name}" could not be downloaded: ${error?.message ?? "empty body"}`,
    );
  }

  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mimeType: asset.mime_type ?? "",
    name: asset.name ?? "logo",
  };
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
    // ── Compositor path ───────────────────────────────────────────────────────
    // When the caller wants real typography, the model's job changes: it paints
    // a background and nothing else.
    const composeText: TextContent = (body.compose?.text ?? {}) as TextContent;
    const wantsComposite =
      Boolean(body.compose) &&
      Object.values(composeText).some((value) => String(value ?? "").trim());

    let designTemplate: DesignTemplate | null = null;
    if (wantsComposite) {
      designTemplate = pickTemplate(
        Array.isArray(body.compose?.recent_template_ids) ? body.compose!.recent_template_ids! : [],
        body.compose?.template_id,
      );
    }

    // Ideogram exists in this stack for one reason: rendering exact text inside
    // an image. On the compositor path that is precisely what must NOT happen,
    // so it is never selected here — a stray model-drawn word behind real
    // typography is the worst of both approaches.
    let imageModel: FalImageModel = body.image_model ?? "flux";
    if (wantsComposite && imageModel === "ideogram") imageModel = "flux";

    // ── Prompt enhancement — ONE model-aware pass (1.3) ───────────────────────
    // Previously this always assumed FLUX.2 Pro regardless of the model that
    // actually ran (wrong vocabulary for Ideogram/Recraft) AND ran on top of
    // the content-plan's already-enhanced prompt (a second blind rewrite). Now
    // it's a single pass whose instructions match the engine being used.
    let finalPrompt        = rawPrompt;
    const shouldEnhance    = body.enhance_prompt !== false;
    // Loaded by user_id, never from the request body. The logo already
    // resolved server-side (resolveBrandLogo above); the text fields were
    // the half still being trusted from the client.
    const serverKit        = await loadBrandKit(adminClient, user.id);
    const brandContext     = buildBrandSummary(serverKit, { visualOnly: true });

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

    // Appended AFTER the enhancer, never before. The enhancer rewrites its
    // input freely and would happily paraphrase "render no text" into
    // something softer; appending afterwards makes the instruction survive
    // verbatim. It is stated several ways on purpose — image models treat a
    // single negative as a weak preference, and one stray word in the
    // background defeats the entire point of compositing.
    if (wantsComposite && designTemplate) {
      finalPrompt = `${finalPrompt}\n\n${backgroundDirectiveFor(designTemplate)}`;
    }

    // ── Generate via the chosen fal.ai model ──────────────────────────────────
    const startedAt = Date.now();
    const imageSize = aspectToFalImageSize(body.aspect_ratio ?? "1:1");
    const brandColors = extractBrandColors((serverKit ?? {}) as Record<string, unknown>);

    const referenceUrls = Array.isArray(body.reference_image_urls)
      ? body.reference_image_urls.filter((u) => typeof u === "string" && u.trim()).slice(0, 9)
      : [];

    const { result, provider, modelId, costUsd } = await generateImageByModel(imageModel, {
      prompt:          finalPrompt,
      image_size:      imageSize,
      output_format:   body.output_format ?? "jpeg",
      seed:            body.seed,
      rendering_speed: body.rendering_speed,
      negative_prompt: body.negative_prompt,
      recraft_style:   body.recraft_style,
      brand_colors:    imageModel === "recraft" ? brandColors : undefined,
      image_urls:      referenceUrls.length ? referenceUrls : undefined,
    });

    // LOCK L5.14. Recorded before the URL check: the call has completed and
    // been billed by fal whether or not it returned a usable image, and a
    // failed generation we paid for is exactly the kind of cost that would
    // otherwise never appear in COGS.
    await recordCost(adminClient, {
      userId: user.id,
      provider,
      modelId,
      callClass: "planned",
      unitType: "images",
      units: 1,
      estimatedCostUsd: costUsd,
    });

    const sourceUrl = result.images?.[0]?.url;
    if (!sourceUrl) throw new Error(`fal.ai (${modelId}) returned no image URL`);

    // ── Fetch + (optional) brand-logo composite ───────────────────────────────
    const imgRes = await fetch(sourceUrl, {
      // LOCK L5.9 — download generated image / logo; bounded so a hung transfer fails cleanly.
      signal: AbortSignal.timeout(120_000),
    });
    if (!imgRes.ok) throw new Error("Failed to fetch generated image from fal.ai");
    let imgBytes = new Uint8Array(await imgRes.arrayBuffer());
    let ext = body.output_format ?? "jpeg";

    // Resolved before compositing so the compositor can place it with real
    // clear space rather than having it stamped into a corner afterwards.
    let logoApplied = false;
    let brandLogo: { bytes: Uint8Array; mimeType: string } | null = null;
    if (body.apply_logo && !body.logo_url) {
      try {
        const resolved = await resolveBrandLogo(adminClient, user.id);
        if (resolved) brandLogo = { bytes: resolved.bytes, mimeType: resolved.mimeType };
      } catch (error) {
        console.error("[generateImage] logo_resolve_failed", {
          user_id: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // ── Deterministic typography ──────────────────────────────────────────────
    //
    // The model has painted a text-free background. Everything the brand
    // actually promises is drawn here instead: the words, in its real typeface,
    // at its exact hex, wrapped and shrink-to-fit into a real box.
    //
    // Failure is NEVER silent and never fatal. The user has already been billed
    // for the render, so a compositor that cannot run returns the plain
    // background with a stated reason rather than an error or — far worse — a
    // confidently blank graphic. See CompositorUnavailableError.
    let composeApplied = false;
    let composeTemplateId: string | null = null;
    let composeError: string | null = null;
    let composeNotes: string[] = [];
    let composeFonts: { display?: string; body?: string } = {};

    if (wantsComposite && designTemplate) {
      composeTemplateId = designTemplate.id;
      try {
        const composed = await compositeDesign({
          baseImage: imgBytes,
          template: designTemplate,
          text: composeText,
          // readDesignFromKit owns the column names, so this function never has
          // to. One module knows the schema; everything else asks it.
          design: readDesignFromKit(serverKit as Record<string, unknown> | null),
          // The logo goes on inside the compositor so it can honour clear space
          // against the text it just placed, rather than being stamped blind
          // into a corner afterwards.
          logo: brandLogo ? { bytes: brandLogo.bytes, mimeType: brandLogo.mimeType } : null,
        });
        // Copied rather than aliased so the buffer type matches `imgBytes`
        // exactly. The existing logo path assigns across the same mismatch and
        // passes `deno check`; not repeating it keeps this line clean under a
        // stricter checker too, at the cost of one buffer copy.
        imgBytes = new Uint8Array(composed.bytes);
        ext = "jpeg";
        composeApplied = true;
        composeNotes = composed.notes;
        composeFonts = composed.fontsUsed;
        if (composed.logoApplied) logoApplied = true;
      } catch (error) {
        composeError = error instanceof CompositorUnavailableError
          ? error.reason
          : (error instanceof Error ? error.message : String(error));
        console.error("[generateImage] compose_failed", { user_id: user.id, error: composeError });
      }
    }

    // ── Brand logo ────────────────────────────────────────────────────────────
    // Two sources: an explicit `logo_url` (caller-supplied, must be reachable)
    // or `apply_logo`, which resolves the active brand kit's logo server-side.
    //
    // A requested-but-missing logo is REPORTED, never swallowed. The previous
    // console.warn returned an unbranded image that looked completely
    // successful — the exact silent no-op the third law forbids. The image is
    // still delivered (the user paid for it) but `logo_applied: false` plus
    // `logo_error` ride along on the response so the client can say so.
    let logoError: string | null = null;
    const logoRequested = Boolean(body.apply_logo || body.logo_url);

    // Skipped when the compositor already placed the logo with proper clear
    // space — stamping it twice would put two marks on one graphic.
    if (logoRequested && !logoApplied) {
      try {
        let logoBytes: Uint8Array | null = null;
        let logoMimeType = "";

        if (body.logo_url) {
          // Caller-supplied URL, so it goes through safeFetch rather than bare
          // fetch. Unguarded (as it was until 2026-09-01) this fetched any
          // address the runtime could reach and composited the bytes into an
          // image the caller then downloads — an SSRF read primitive with a
          // delivery mechanism attached. See _shared/safeFetch.ts.
          const logoResult = await safeFetch(body.logo_url, {
            maxBytes: 8 * 1024 * 1024,
            timeoutMs: 20_000,
            expectContentType: /image\//i,
            context: "generateImage.logo_url",
          });
          logoBytes = logoResult.bytes;
          logoMimeType = logoResult.contentType;
        } else {
          const resolved = await resolveBrandLogo(adminClient, user.id);
          if (!resolved) {
            throw new Error("no logo uploaded to the active brand kit");
          }
          logoBytes = resolved.bytes;
          logoMimeType = resolved.mimeType;
        }

        imgBytes = await compositeLogo(imgBytes, logoBytes, {
          position: body.logo_position,
          scalePct: body.logo_scale,
          logoMimeType,
        });
        ext = "jpeg"; // compositeLogo always returns JPEG
        logoApplied = true;
      } catch (compositeErr) {
        logoError = compositeErr instanceof Error ? compositeErr.message : String(compositeErr);
        console.error("[generateImage] logo_composite_failed", {
          user_id: user.id,
          error: logoError,
        });
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
        // 4.1: record that/how many references guided this render (for
        // reproducibility receipts; not the URLs themselves to keep the row lean).
        reference_count: referenceUrls.length || undefined,
        // Provenance: whether this image actually carries the brand logo.
        // Recorded even on failure so a run of un-branded output is findable
        // in the data rather than only in a log line that scrolls away.
        logo_requested: logoRequested || undefined,
        logo_applied:   logoRequested ? logoApplied : undefined,
        logo_error:     logoError ?? undefined,
        // Which layout drew this, so pickTemplate can avoid repeating it and a
        // run of identical-looking posts is visible in the data. Recorded on
        // failure too: a compositor that quietly stopped running would
        // otherwise look exactly like one that was never asked to.
        compose_requested:  wantsComposite || undefined,
        compose_applied:    wantsComposite ? composeApplied : undefined,
        compose_template:   composeTemplateId ?? undefined,
        compose_error:      composeError ?? undefined,
        compose_fonts:      composeApplied ? composeFonts : undefined,
        compose_notes:      composeNotes.length ? composeNotes : undefined,
      },
    });

    return jsonResponse({
      url:               publicUrl,
      publicUrl,
      public_url:        publicUrl,
      storagePath:       fileName,
      storage_path:      fileName,
      // Client surfaces these — a silently un-branded image is a defect.
      logo_requested:    logoRequested,
      logo_applied:      logoApplied,
      logo_error:        logoError,
      // The client shows these: text drawn in the wrong face, or not drawn at
      // all, must be visible to the user rather than only in a log line.
      compose_applied:   composeApplied,
      compose_template:  composeTemplateId,
      compose_error:     composeError,
      compose_notes:     composeNotes,
      compose_fonts:     composeFonts,
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
