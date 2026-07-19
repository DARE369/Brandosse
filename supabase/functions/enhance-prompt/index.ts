import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callLlm } from "../_shared/llm.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { createHttpError } from "../_shared/org.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { createAuthClient, requireUser } from "../_shared/supabase.ts";

type EnhancePromptRequest = {
  prompt: string;
  variantCount?: number;
  brandKit?: Record<string, unknown> | null;
  previousPrompts?: string[] | null;
};

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

function parseSuggestions(content: string, fallbackPrompt: string, count: number) {
  const trimmed = String(content || "").trim();
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
    const brandContext = normalizeBrandContext(body.brandKit);

    if (!prompt) {
      throw createHttpError("Prompt is required.", 400);
    }

    const llmUserPayload = {
      prompt,
      variant_count: variantCount,
      previous_prompts: previousPrompts,
      brand_context: brandContext,
    };

    let suggestions: string[] = [];
    let provider = null;
    let model = null;

    try {
      const response = await callLlm({
        systemPrompt: [
          "You improve short visual generation prompts for social media content.",
          "Respect the provided brand context and keep output concise and vivid.",
          "Return strict JSON with shape: {\"suggestions\":[\"...\"]}.",
          "Each suggestion must be a single prompt string, no hashtags, no markdown.",
          "Do not repeat the same wording across suggestions.",
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
