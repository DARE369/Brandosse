/**
 * upscaleImage edge function — upscale / finish pass (Stage 5.3)
 *
 * Takes a generated image, runs it through fal's clarity upscaler (enlarge +
 * sharpen/denoise), uploads the result, and returns the new URL. Charges 2
 * credits (category "upscale") per the credit model — its own line, on the
 * user's explicit "Upscale" click. Reserve-then-refund: credits are reserved
 * before the provider call and refunded on any failure.
 *
 * Idempotent on request_id like the other media functions (a network double-
 * invoke replays instead of re-charging).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { upscaleImage, FAL_MODELS, FAL_COST_USD } from "../_shared/fal.service.ts";
import { createHttpError } from "../_shared/org.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { findCachedGeneration, reserveCredits } from "../_shared/generationIdempotency.ts";

const GENERATED_BUCKET = "generated_assets";
const CREDITS_PER_UPSCALE = 2;

type UpscaleBody = {
  image_url?: string;
  generation_id?: string; // the generation being upscaled (its row gets metadata.upscaled)
  scale?: number;
  request_id?: string;
  request_slot?: number;
};

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let refundIfReserved: () => Promise<void> = async () => {};

  try {
    const authClient = createAuthClient(req.headers.get("Authorization"));
    const user = await requireUser(authClient);
    const adminClient = createAdminClient();
    await enforceRateLimit(adminClient, user.id, "upscaleImage");

    const body = await parseJsonBody<UpscaleBody>(req);
    const imageUrl = String(body.image_url || "").trim();
    if (!imageUrl) throw createHttpError("image_url is required", 400);

    const requestId = body.request_id || null;
    const requestSlot = Number.isFinite(body.request_slot) ? Number(body.request_slot) : 0;

    // Idempotency replay.
    const cached = await findCachedGeneration(adminClient, user.id, requestId, requestSlot);
    if (cached) {
      return jsonResponse({
        url: cached.output_url, publicUrl: cached.output_url,
        storagePath: cached.storage_path, generation_id: cached.id,
        credits_used: 0, replayed: true,
      });
    }

    // Credit check + reserve.
    const { data: creditRow } = await adminClient
      .from("user_credits").select("balance").eq("user_id", user.id).maybeSingle();
    if ((creditRow?.balance ?? 0) < CREDITS_PER_UPSCALE) {
      throw createHttpError("Insufficient credits", 402);
    }
    await reserveCredits(adminClient, user.id, CREDITS_PER_UPSCALE, "upscale", "Image upscale / finish");
    let reserved = true;
    refundIfReserved = async () => {
      if (!reserved) return;
      reserved = false;
      try {
        await adminClient.rpc("refund_credits", {
          p_user_id: user.id, p_amount: CREDITS_PER_UPSCALE, p_category: "upscale",
          p_description: "Refund: upscale failed after reservation",
        });
      } catch (e) { console.error("[upscaleImage] refund failed:", e); }
    };

    // Upscale.
    const startedAt = Date.now();
    const result = await upscaleImage({ image_url: imageUrl, scale: body.scale ?? 2 });
    const providerUrl = result.images?.[0]?.url;
    if (!providerUrl) throw new Error("Upscaler returned no image URL");

    // Upload.
    const imgRes = await fetch(providerUrl);
    if (!imgRes.ok) throw new Error("Failed to fetch upscaled image");
    const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
    const fileName = `${user.id}/${Date.now()}_upscaled.jpeg`;
    const { error: uploadError } = await adminClient.storage
      .from(GENERATED_BUCKET)
      .upload(fileName, imgBytes, { contentType: "image/jpeg", upsert: true });
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);
    const { data: { publicUrl } } = adminClient.storage.from(GENERATED_BUCKET).getPublicUrl(fileName);

    // If a generation_id was supplied, swap its stored image to the upscaled one
    // and flag it (additive metadata; keeps the original prompt/seed/model).
    if (body.generation_id) {
      const { data: gen } = await adminClient
        .from("generations").select("metadata").eq("id", body.generation_id).eq("user_id", user.id).maybeSingle();
      const meta = (gen?.metadata && typeof gen.metadata === "object") ? gen.metadata as Record<string, unknown> : {};
      await adminClient
        .from("generations")
        .update({
          storage_path: publicUrl,
          metadata: { ...meta, upscaled: true, upscaled_at: new Date().toISOString(), original_url: meta.original_url || imageUrl },
        })
        .eq("id", body.generation_id)
        .eq("user_id", user.id);
    }

    return jsonResponse({
      url: publicUrl, publicUrl, storagePath: fileName,
      generation_id: body.generation_id || null,
      provider: "fal-ai", providerModel: FAL_MODELS.imageUpscale,
      cost_usd: FAL_COST_USD.imageUpscale,
      generationTimeMs: Date.now() - startedAt,
      credits_used: CREDITS_PER_UPSCALE,
    });
  } catch (error) {
    await refundIfReserved();
    console.error("[upscaleImage] error:", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
