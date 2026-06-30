import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { callLlm } from "../_shared/llm.ts";

type SuggestionsRequest = {
  mode?: string;
  count?: number;
  brandKit?: Record<string, unknown> | null;
};

type SuggestionsResponse = {
  suggestions?: string[];
};

function normalizeCount(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 4;
  return Math.min(6, Math.max(4, Math.round(numeric)));
}

function getMode(value: unknown) {
  const raw = String(value || "").toLowerCase();
  if (raw === "text-to-video" || raw === "frames-to-video") return "video";
  return "image";
}


function buildSystemPrompt(mode: "image" | "video", count: number) {
  const mediaLabel = mode === "video" ? "video generation" : "image generation";
  return `You are an elite social media creative strategist.
Generate ${count} unique ${mediaLabel} prompt suggestions.

Rules:
1. Return ONLY JSON.
2. Keep every suggestion under 26 words.
3. Make each suggestion practically different.
4. Avoid repeating phrases between suggestions.
5. Suggestions should be usable as-is in a generator.

Return format:
{
  "suggestions": ["prompt 1", "prompt 2", "prompt 3", "prompt 4"]
}`;
}

function buildBrandContext(brandKit: Record<string, unknown> | null | undefined) {
  if (!brandKit) return "No brand kit context provided.";

  const raw = (typeof brandKit.raw === "object" && brandKit.raw !== null)
    ? brandKit.raw as Record<string, unknown>
    : brandKit;

  const visual = Array.isArray(raw.visual_style_keywords)
    ? raw.visual_style_keywords.join(", ")
    : "Not specified";

  return [
    `Brand name: ${String(raw.brand_name || "Not specified")}`,
    `Industry: ${String(raw.industry || "Not specified")}`,
    `Audience: ${String(raw.target_audience || "Not specified")}`,
    `Voice: ${String(raw.brand_voice || "Not specified")}`,
    `Visual style: ${visual}`,
  ].join("\n");
}

function normalizeSuggestions(raw: unknown, count: number) {
  if (!Array.isArray(raw)) return [];
  const normalized = raw
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .filter((entry, index, arr) => arr.indexOf(entry) === index);

  return normalized.slice(0, count);
}

function fallbackSuggestions(mode: "image" | "video", count: number, seed: string) {
  const base = mode === "video" ? "Video concept" : "Image concept";
  const prompts = [
    `${base}: product launch highlight with clear hero framing and branded typography variation ${seed}`,
    `${base}: educational how-to scene with structured visual flow and clean composition ${seed}`,
    `${base}: lifestyle narrative featuring authentic moment-driven storytelling and natural light ${seed}`,
    `${base}: campaign teaser with bold contrast and layered design depth ${seed}`,
    `${base}: behind-the-scenes workflow showcase with tactile details and candid perspective ${seed}`,
    `${base}: testimonial-style creative with visual proof points and conversion-focused CTA framing ${seed}`,
  ];
  return prompts.slice(0, count);
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authClient = createAuthClient(req.headers.get("Authorization"));
    await requireUser(authClient);

    const body = await parseJsonBody<SuggestionsRequest>(req);
    const count = normalizeCount(body.count);
    const mode = getMode(body.mode);
    const seed = crypto.randomUUID().slice(0, 8);

    const userPrompt = `Randomization seed: ${seed}\nCurrent date: ${new Date().toISOString()}\n\nBrand context:\n${buildBrandContext(body.brandKit)}\n\nGenerate the suggestions now.`;

    let parsed: SuggestionsResponse | null = null;
    try {
      const result = await callLlm({
        preferredProvider: "groq",
        systemPrompt: buildSystemPrompt(mode, count),
        messages: [{ role: "user", content: userPrompt }],
        maxTokens: 900,
        temperature: 1.0,
        jsonMode: true,
      });
      parsed = JSON.parse(result.content);
    } catch (_error) {
      parsed = null;
    }

    const suggestions = normalizeSuggestions(parsed?.suggestions, count);
    if (!suggestions.length) {
      return jsonResponse({ suggestions: fallbackSuggestions(mode, count, seed) });
    }

    return jsonResponse({ suggestions });
  } catch (error) {
    console.error("[prompt-suggestions] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
