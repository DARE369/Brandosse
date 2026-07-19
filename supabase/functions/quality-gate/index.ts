/**
 * quality-gate edge function — visual quality gate (Stage 2.1)
 *
 * Runs AFTER an image is generated and marked completed. The client pipeline
 * fires this fire-and-forget (never awaited in the render path) so it never
 * delays first paint — the image shows immediately, then this scores it a few
 * seconds later and writes the result onto generations.metadata.quality, which
 * the UI picks up via the existing realtime subscription.
 *
 * Scores against a rubric tuned by render_intent (a text_graphic is judged
 * hardest on legibility; a photo on anatomy/artifacts). Returns:
 *   { quality_score: 0-100, verdict: "pass"|"warn"|"fail", flags: string[] }
 *
 * Cost: one Claude Haiku vision call (~$0.002-0.003). Per the credit model this
 * is BUNDLED into the image price (it is part of what "generate an image"
 * means here), so this function does NOT reserve/deduct credits of its own.
 *
 * Fail-open: any error (no ANTHROPIC key, fetch fail, unparseable response)
 * leaves the generation untouched and returns a soft result. A quality gate
 * must never turn a successful, already-billed generation into a failure.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { createHttpError } from "../_shared/org.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { callVisionJudge } from "../_shared/llm.ts";

type QualityGateBody = { generation_id?: string };

type QualityResult = {
  quality_score: number;
  verdict: "pass" | "warn" | "fail";
  flags: string[];
};

async function fetchAsBase64(url: string): Promise<{ base64: string; mediaType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch generated image (${response.status})`);
  const mediaType = response.headers.get("content-type") || "image/jpeg";
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return { base64: btoa(binary), mediaType };
}

function extractJson(text: string): Record<string, unknown> | null {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function buildRubric(renderIntent: string, aspectRatio: string, prompt: string): { system: string; user: string } {
  const intentLine =
    renderIntent === "text_graphic"
      ? "This image is a TEXT GRAPHIC (flyer / quote card / poster). Judge legibility of any text HARDEST — misspelled, garbled, warped, or nonsense letters are a hard fail."
      : renderIntent === "vector_design"
        ? "This image is a VECTOR / DESIGN piece (logo, icon, flat illustration). Judge for clean shapes, correct symbol/letterforms, no photographic artifacts."
        : "This image is a PHOTO. Judge for realistic anatomy (correct number of fingers/limbs/eyes), natural lighting, and absence of AI artifacts.";

  const system = [
    "You are a strict art director doing QA on an AI-generated social media image.",
    "You NEVER pass an image you would be embarrassed to publish for a paying client.",
    "Return ONLY a JSON object, no prose:",
    '{"quality_score": <0-100>, "verdict": "pass"|"warn"|"fail", "flags": ["short issue", ...]}',
    "Scoring: 80-100 pass, 55-79 warn (usable but flawed), 0-54 fail (do not publish).",
    "flags: short, specific defects a human would name (e.g. \"garbled text on badge\", \"six fingers on left hand\", \"visible watermark\", \"wrong aspect - subject cropped\"). Empty array if clean.",
  ].join("\n");

  const user = [
    intentLine,
    `Intended aspect ratio: ${aspectRatio}. Flag if the composition is clearly the wrong shape or the subject is badly cropped.`,
    "Check specifically for: garbled/misspelled text, extra or malformed fingers/limbs/teeth/eyes, visible watermarks or logos that shouldn't be there, duplicated/melted objects, and obvious 'this is AI' artifacts.",
    prompt ? `The image was meant to depict: "${String(prompt).slice(0, 400)}". Flag if it clearly does not.` : "",
    "Now score the attached image.",
  ].filter(Boolean).join("\n");

  return { system, user };
}

function normalizeResult(parsed: Record<string, unknown> | null): QualityResult {
  const scoreRaw = Number(parsed?.quality_score);
  const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, Math.round(scoreRaw))) : 70;
  const flags = Array.isArray(parsed?.flags)
    ? (parsed!.flags as unknown[]).map((f) => String(f || "").trim()).filter(Boolean).slice(0, 6)
    : [];
  // Derive verdict from score if the model didn't give a clean one — keeps
  // thresholds authoritative on our side, not the model's.
  const verdict: QualityResult["verdict"] = score >= 80 ? "pass" : score >= 55 ? "warn" : "fail";
  return { quality_score: score, verdict, flags };
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authClient = createAuthClient(req.headers.get("Authorization"));
    const user = await requireUser(authClient);
    const adminClient = createAdminClient();
    await enforceRateLimit(adminClient, user.id, "quality-gate");

    const body = await parseJsonBody<QualityGateBody>(req);
    const generationId = String(body.generation_id || "").trim();
    if (!generationId) throw createHttpError("generation_id is required", 400);

    // Load the row (must belong to the caller).
    const { data: gen, error: genErr } = await adminClient
      .from("generations")
      .select("id, user_id, storage_path, prompt, media_type, metadata")
      .eq("id", generationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (genErr) throw new Error(`Failed to load generation: ${genErr.message}`);
    if (!gen) throw createHttpError("Generation not found", 404);
    if (gen.media_type && gen.media_type !== "image") {
      // Video/other: nothing to score here.
      return jsonResponse({ skipped: true, reason: "not an image" });
    }

    const imageUrl = gen.storage_path;
    if (!imageUrl) throw createHttpError("Generation has no image to score", 422);

    const meta = (gen.metadata && typeof gen.metadata === "object") ? gen.metadata as Record<string, unknown> : {};
    const renderIntent = String(meta.render_intent || meta.image_model || "photo");
    const aspectRatio = String(meta.aspect_ratio || "1:1");

    // Fetch + score. Fail-open on any provider error.
    let result: QualityResult;
    try {
      const { base64, mediaType } = await fetchAsBase64(imageUrl);
      const { system, user: userPrompt } = buildRubric(renderIntent, aspectRatio, gen.prompt || "");
      const raw = await callVisionJudge({
        systemPrompt: system,
        userPrompt,
        imageBase64: base64,
        imageMediaType: mediaType,
        maxTokens: 400,
      });
      result = normalizeResult(extractJson(raw));
    } catch (visionErr) {
      console.warn("[quality-gate] scoring unavailable, leaving generation unscored:", visionErr);
      return jsonResponse({ skipped: true, reason: "scoring unavailable" });
    }

    // Write onto metadata.quality (additive — never touches other fields).
    const { error: updateErr } = await adminClient
      .from("generations")
      .update({
        metadata: {
          ...meta,
          quality: { ...result, scored_at: new Date().toISOString() },
        },
      })
      .eq("id", generationId)
      .eq("user_id", user.id);

    if (updateErr) throw new Error(`Failed to persist quality result: ${updateErr.message}`);

    return jsonResponse({ generation_id: generationId, ...result });
  } catch (error) {
    console.error("[quality-gate] error:", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
