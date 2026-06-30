// personal-asset-ai-tag — async Claude vision tagging for a single
// personal_assets row (LIBRARY_SPEC.md §5 step 3 / §8). Invoked
// fire-and-forget by the client immediately after personal-asset-upload
// returns successfully — never blocks the upload itself; the mockup's
// shimmer state (asset-card__ai-shimmer-row) is what covers the gap while
// this runs.
//
// Deliberately calls Anthropic's vision endpoint directly with its own
// fetch() rather than routing through supabase/functions/_shared/llm.ts.
// _shared/llm.ts's LlmMessage type is text-only (no image content-block
// support) — confirmed by reading the file directly. Extending that shared
// contract would affect every other edge function importing it, which is
// out of this packet's scope ("build exactly what the mockup requires").
// See DECISIONS_LOG.md 2026-06-25T10:25:00 for the full reasoning and the
// flag that shared-infra extension should be its own, separately-reviewed
// change if/when other features also need vision calls.
//
// Additive metadata only (LIBRARY_SPEC.md §8 table): never overwrites a
// human-entered title/description/alt_text/tags — only fills ai_tags, and
// only fills description/alt_text if the human hasn't already set them.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, toErrorPayload, parseJsonBody } from "../_shared/http.ts";
import { createHttpError } from "../_shared/org.ts";
import { readEnv } from "../_shared/env.ts";

// Phase 4 QA fix (QA_PERSONA_REVIEW_build.md, finding #1 / DECISIONS_LOG.md
// 2026-06-25T18:xx): "claude-3-5-sonnet-latest" does not exist on this
// account and 404s on every call. claude-haiku-4-5-20251001 was confirmed
// live, with this exact ANTHROPIC_API_KEY, to have real vision access and
// return correct tags/description/alt-text — it's also already the model
// _shared/llm.ts forces for its own cheap/fast classification-style calls
// (see llm.ts:205's "Force claude-haiku-4-5 — never route this to
// Sonnet/Opus (cost control)" comment), so this is consistent with how the
// rest of this codebase already prices a single-image tagging call.
const VISION_MODEL = "claude-haiku-4-5-20251001";

function extractJsonBlock(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (_err) {
    return null;
  }
}

async function fetchAsBase64(url: string): Promise<{ base64: string; mediaType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch asset file for tagging (${response.status})`);
  }
  const mediaType = response.headers.get("content-type") || "image/jpeg";
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return { base64: btoa(binary), mediaType };
}

async function callClaudeVision(imageUrl: string): Promise<{ ai_tags: string[]; description: string; alt_text: string }> {
  const apiKey = readEnv("ANTHROPIC_API_KEY", false);
  if (!apiKey) {
    throw createHttpError("ANTHROPIC_API_KEY is not configured.", 500);
  }

  const { base64, mediaType } = await fetchAsBase64(imageUrl);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: 400,
      temperature: 0.3,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: 'Describe this image for a social-media content library. Respond with ONLY a JSON object: {"ai_tags": ["up to 5 short lowercase tags"], "description": "one sentence describing the image", "alt_text": "a concise accessibility alt-text description"}.',
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic vision request failed (${response.status}): ${text || response.statusText}`);
  }

  const payload = await response.json();
  const content = Array.isArray(payload?.content)
    ? payload.content.map((entry: { text?: string }) => entry.text || "").join("\n").trim()
    : "";

  const parsed = extractJsonBlock(content);
  if (!parsed) {
    throw new Error("Vision response did not contain a parseable JSON block.");
  }

  return {
    ai_tags: Array.isArray(parsed.ai_tags)
      ? parsed.ai_tags.map((tag) => String(tag || "").trim().toLowerCase()).filter(Boolean).slice(0, 5)
      : [],
    description: String(parsed.description || "").trim(),
    alt_text: String(parsed.alt_text || "").trim(),
  };
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authClient = createAuthClient(req.headers.get("Authorization"));
    const user = await requireUser(authClient);
    const adminClient = createAdminClient();

    const body = await parseJsonBody<{ asset_id?: string }>(req);
    const assetId = String(body?.asset_id || "").trim();
    if (!assetId) {
      throw createHttpError("Missing asset_id.", 400);
    }

    const { data: asset, error: fetchError } = await adminClient
      .from("personal_assets")
      .select("id, user_id, file_url, media_type, description, alt_text, ai_tagging_status")
      .eq("id", assetId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!asset) throw createHttpError("Asset not found.", 404);
    if (asset.user_id !== user.id) throw createHttpError("Forbidden.", 403);

    if (asset.media_type !== "image" || !asset.file_url) {
      // Video/document — no vision tagging in v1 (RESEARCH.md scopes
      // perceptual/AI analysis to images for now). Mark not_applicable so
      // the client's shimmer never spins forever.
      await adminClient
        .from("personal_assets")
        .update({ ai_tagging_status: "not_applicable" })
        .eq("id", assetId);
      return jsonResponse({ ai_tagging_status: "not_applicable" });
    }

    try {
      const result = await callClaudeVision(asset.file_url);

      const updates: Record<string, unknown> = {
        ai_tags: result.ai_tags,
        ai_tagging_status: "done",
      };
      // Additive only — never overwrite a human-entered description/alt_text.
      if (!asset.description && result.description) updates.description = result.description;
      if (!asset.alt_text && result.alt_text) updates.alt_text = result.alt_text;

      const { data: updated, error: updateError } = await adminClient
        .from("personal_assets")
        .update(updates)
        .eq("id", assetId)
        .select("*")
        .single();

      if (updateError) throw updateError;

      return jsonResponse({ asset: updated, ai_tagging_status: "done" });
    } catch (visionError) {
      console.error("[personal-asset-ai-tag] vision call failed", visionError);
      await adminClient
        .from("personal_assets")
        .update({ ai_tagging_status: "failed" })
        .eq("id", assetId);
      return jsonResponse({ ai_tagging_status: "failed" });
    }
  } catch (error) {
    console.error("[personal-asset-ai-tag] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
