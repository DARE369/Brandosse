import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callLlm } from "../_shared/llm.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { createHttpError } from "../_shared/org.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { createAuthClient, requireUser } from "../_shared/supabase.ts";
import { loadBrandKit } from "../_shared/brandKit.ts";

type EnhancePromptRequest = {
  prompt: string;
  variantCount?: number;
  brandKit?: Record<string, unknown> | null;
  previousPrompts?: string[] | null;
  // Stable-at-type-time generation context (NOT aspect ratio / platform —
  // those change after enhancing and would bake stale assumptions into the
  // text). contentType/mediaType tell the model whether this is a single
  // image, carousel slide, video first-frame, or edit instruction; imageModel
  // is only present when the user explicitly overrode the engine away from
  // "auto", which is a stronger signal than asking the model to guess intent.
  contentType?: string;
  mediaType?: string;
  imageModel?: string;
};

// Mirrors generationPipeline.js's INTENT_TO_MODEL — an explicit imageModel
// override tells us which visual vocabulary to steer toward even before the
// content-plan step runs its own render_intent classification.
const MODEL_TO_VOCABULARY: Record<string, string> = {
  flux: "a photorealistic image (real scene, lighting, camera framing) — favor photography vocabulary: lighting direction/quality, lens/camera angle, depth of field, realistic materials and textures.",
  ideogram: "a graphic with legible text baked into the image (flyer, poster, quote card, promo) — favor layout vocabulary: exact headline wording in quotes, typography style, hierarchy, background/backdrop, color contrast for readability.",
  recraft: "a vector/flat design (logo, icon, badge, illustration) — favor design vocabulary: flat color palette, line weight, iconography style, composition/symmetry, negative space.",
};

function mediaTypeLabel(mediaType?: string, contentType?: string) {
  if (contentType === "carousel") return "one slide in a multi-slide carousel — keep it visually consistent with a cohesive series, not a one-off image";
  if (mediaType === "video" || mediaType === "image-to-video") return "the first frame of a short video — describe a scene with a clear focal subject that has obvious room to move/animate";
  if (mediaType === "edit") return "an edit instruction applied to an existing image — describe the CHANGE, not a whole new scene";
  return "a single standalone image";
}

function clampVariantCount(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(5, Math.round(parsed)));
}

function normalizePromptList(values: unknown) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeBrandContext(brandKit: unknown) {
  if (!brandKit || typeof brandKit !== "object") return null;
  const source = brandKit as Record<string, unknown>;

  const text = (key: string) => {
    const value = source[key];
    return typeof value === "string" ? value.trim() : "";
  };

  const list = (key: string) => {
    const value = source[key];
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .slice(0, 10);
  };

  const preferredTags = list("preferred_hashtags");
  const messagingPillars = list("messaging_pillars");
  const doNotUse = list("do_not_use");
  const brandName = text("brand_name");
  const brandVoice = text("brand_voice");
  const tone = text("tone");

  if (!brandName && !brandVoice && !tone && preferredTags.length === 0 && messagingPillars.length === 0 && doNotUse.length === 0) {
    return null;
  }

  return {
    brand_name: brandName || null,
    brand_voice: brandVoice || null,
    tone: tone || null,
    preferred_hashtags: preferredTags,
    messaging_pillars: messagingPillars,
    do_not_use: doNotUse,
  };
}

// Claude (unlike Groq's response_format: json_object) has no enforced JSON
// mode through callLlm, so it commonly wraps its reply in a ```json ... ```
// markdown fence even when explicitly asked for raw JSON. Strip that before
// parsing so a fenced response doesn't fall through to the line-splitter
// below and leak the fence marker itself as a "suggestion".
function stripCodeFence(content: string) {
  const match = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(content.trim());
  return match ? match[1].trim() : content;
}

function parseSuggestions(content: string, fallbackPrompt: string, count: number) {
  const trimmed = stripCodeFence(String(content || "").trim());
  if (!trimmed) return [fallbackPrompt];

  try {
    const parsed = JSON.parse(trimmed);
    const suggestions = Array.isArray(parsed?.suggestions)
      ? parsed.suggestions
      : Array.isArray(parsed?.variants)
        ? parsed.variants
        : [];

    const normalized = suggestions
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .slice(0, count);

    if (normalized.length > 0) return normalized;
  } catch (_error) {
    // The model may return plain text. Continue with relaxed parsing.
  }

  const lineSuggestions = trimmed
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, "").trim())
    .filter(Boolean)
    .filter((line) => !/^```/.test(line))
    .slice(0, count);

  return lineSuggestions.length > 0 ? lineSuggestions : [fallbackPrompt];
}

function buildFallbackSuggestions(
  prompt: string,
  variantCount: number,
  brandContext: ReturnType<typeof normalizeBrandContext>,
  previousPrompts: string[],
) {
  const flavor = [
    "high detail",
    "clean composition",
    "strong focal point",
  ];

  const voice = brandContext?.brand_voice || brandContext?.tone || null;
  const tags = brandContext?.preferred_hashtags?.slice(0, 3).join(" ") || "";
  const avoid = brandContext?.do_not_use?.[0] || "";
  const previous = previousPrompts[0] || "";

  const variants = [];
  for (let index = 0; index < variantCount; index += 1) {
    const parts = [
      prompt,
      flavor[index % flavor.length],
      voice ? `brand voice: ${voice}` : "",
      tags ? `suggested tags: ${tags}` : "",
      avoid ? `avoid: ${avoid}` : "",
      previous ? `different from: ${previous}` : "",
    ].filter(Boolean);
    variants.push(parts.join(", ").trim());
  }

  return variants;
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
    await enforceRateLimit(authClient, user.id, "enhance-prompt");

    const body = await parseJsonBody<EnhancePromptRequest>(req);
    const prompt = String(body.prompt || "").trim();
    const variantCount = clampVariantCount(body.variantCount);
    const previousPrompts = normalizePromptList(body.previousPrompts);
    const brandContext = normalizeBrandContext(await loadBrandKit(authClient, user.id));
    const contentType = typeof body.contentType === "string" ? body.contentType : undefined;
    const mediaType = typeof body.mediaType === "string" ? body.mediaType : undefined;
    const imageModel = typeof body.imageModel === "string" ? body.imageModel : undefined;

    if (!prompt) {
      throw createHttpError("Prompt is required.", 400);
    }

    const targetDescription = mediaTypeLabel(mediaType, contentType);
    const vocabularyHint = imageModel ? MODEL_TO_VOCABULARY[imageModel] : null;

    const llmUserPayload = {
      prompt,
      variant_count: variantCount,
      previous_prompts: previousPrompts,
      brand_context: brandContext,
      target: targetDescription,
      ...(vocabularyHint ? { engine_hint: vocabularyHint } : {}),
    };

    let suggestions: string[] = [];
    let provider = null;
    let model = null;

    try {
      const response = await callLlm({
        systemPrompt: [
          "You improve short, often vague, visual generation prompts for social media content so the resulting image is specific rather than generic.",
          "The user's `prompt` is the starting point. `target` tells you what kind of visual this is for. `engine_hint`, when present, tells you which visual vocabulary to favor because the rendering engine is already fixed — use it.",
          "For each suggestion, check the ORIGINAL prompt against these dimensions, and add concrete, specific detail ONLY for dimensions it leaves vague — never invent a subject, setting, or detail that contradicts what the user actually wrote:",
          "1. Subject — is WHO/WHAT specific? (e.g. \"a woman\" -> \"a woman in her 30s wearing a linen apron\")",
          "2. Setting/environment — where is this happening? (backdrop, location, time of day)",
          "3. Lighting — what kind, and from where? (soft window light, golden hour, studio softbox, neon)",
          "4. Composition/framing — camera angle, distance, focal point (close-up, wide shot, eye-level, overhead)",
          "5. Style/medium — photographic vs illustrated vs flat design, and any texture/finish",
          "6. Mood/color — the emotional tone and dominant palette",
          "If `target` says this needs legible in-image text (a graphic/flyer), the exact words that must appear go in quotes inside the suggestion.",
          "Respect the provided brand context (voice, tone, preferred hashtags are NOT restated in the prompt itself, only the visual style should reflect brand voice) and keep every suggestion concise — one or two sentences, not a paragraph.",
          "Return strict JSON with shape: {\"suggestions\":[\"...\"]}.",
          "Each suggestion must be a single prompt string, no hashtags, no markdown, no meta-commentary about what you changed.",
          "Do not repeat the same wording across suggestions — vary which specific angle (setting vs lighting vs composition) each one leans into.",
        ].join(" "),
        messages: [
          {
            role: "user",
            content: JSON.stringify(llmUserPayload),
          },
        ],
        jsonMode: true,
        temperature: 0.5,
        maxTokens: 900,
      });

      suggestions = parseSuggestions(response.content, prompt, variantCount);
      provider = response.provider;
      model = response.model;
    } catch (llmError) {
      console.warn("[enhance-prompt] falling back to deterministic enhancement:", llmError);
      suggestions = buildFallbackSuggestions(prompt, variantCount, brandContext, previousPrompts);
    }

    const normalized = suggestions
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);

    return jsonResponse({
      enhancedPrompt: normalized[0] || prompt,
      suggestions: normalized.length > 0 ? normalized : [prompt],
      provider,
      model,
      context_used: {
        has_brand_context: Boolean(brandContext),
        previous_prompt_count: previousPrompts.length,
      },
    });
  } catch (error) {
    console.error("[enhance-prompt] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
