import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { callLlm } from "../_shared/llm.ts";

type CarouselRequestBody = {
  prompt?: string;
  slideCount?: number | "auto";
  brandKit?: Record<string, unknown>;
};

type CarouselSlide = {
  slide_index: number;
  slide_purpose: string;
  headline: string;
  image_prompt: string;
};

type GroqResponse = {
  slides?: Array<Partial<CarouselSlide>>;
};


function normalizeSlideCount(value: unknown): { mode: "auto" | "manual"; count: number } {
  if (value === "auto") return { mode: "auto", count: 8 };

  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 2) {
    return { mode: "manual", count: Math.floor(parsed) };
  }

  return { mode: "auto", count: 8 };
}

function readBrandContext(brandKit: Record<string, unknown> | undefined): string {
  if (!brandKit) return "No brand kit provided.";

  const raw = (typeof brandKit.raw === "object" && brandKit.raw !== null)
    ? brandKit.raw as Record<string, unknown>
    : {};

  const visualKeywords = Array.isArray(raw.visual_style_keywords)
    ? raw.visual_style_keywords.join(", ")
    : "";

  return [
    `Brand name: ${String(raw.brand_name || "Not specified")}`,
    `Industry: ${String(raw.industry || "Not specified")}`,
    `Target audience: ${String(raw.target_audience || "Not specified")}`,
    `Brand voice: ${String(raw.brand_voice || "Not specified")}`,
    `Visual style: ${visualKeywords || "Not specified"}`,
  ].join("\n");
}

function buildSystemPrompt(mode: "auto" | "manual", count: number): string {
  const slideCountRule = mode === "manual"
    ? `You MUST return exactly ${count} slides.`
    : "Choose a sensible number of slides based on prompt complexity, with a strict maximum of 8 slides.";

  return `You are a social media creative director.
Break one user idea into a carousel slide plan for image generation.

RULES:
1. Return ONLY valid JSON. No markdown.
2. ${slideCountRule}
3. slide_index must be 1-based and strictly increasing.
4. Each slide must include slide_purpose, headline, and image_prompt.
5. image_prompt must be vivid and generation-ready (at least 20 words).
6. Ensure each slide is meaningfully different and contributes to a coherent narrative.

Return shape:
{
  "slides": [
    {
      "slide_index": 1,
      "slide_purpose": "hook",
      "headline": "string",
      "image_prompt": "string"
    }
  ]
}`;
}

function sanitizeSlides(slides: Array<Partial<CarouselSlide>>, mode: "auto" | "manual", count: number, fallbackPrompt: string): CarouselSlide[] {
  const cleaned = slides
    .map((slide, index) => ({
      slide_index: Number(slide.slide_index) > 0 ? Number(slide.slide_index) : index + 1,
      slide_purpose: String(slide.slide_purpose || "detail").trim() || "detail",
      headline: String(slide.headline || `Slide ${index + 1}`).trim() || `Slide ${index + 1}`,
      image_prompt: String(slide.image_prompt || "").trim(),
    }))
    .filter((slide) => slide.image_prompt.length > 0);

  const bounded = mode === "auto"
    ? cleaned.slice(0, Math.min(8, cleaned.length || 4))
    : cleaned.slice(0, count);

  if (mode === "manual" && bounded.length < count) {
    const missing = count - bounded.length;
    for (let i = 0; i < missing; i += 1) {
      const nextIndex = bounded.length + 1;
      bounded.push({
        slide_index: nextIndex,
        slide_purpose: "detail",
        headline: `Slide ${nextIndex}`,
        image_prompt: `${fallbackPrompt}. Visual focus for slide ${nextIndex} in a coherent carousel sequence.`,
      });
    }
  }

  return bounded.map((slide, index) => ({
    ...slide,
    slide_index: index + 1,
  }));
}

function buildFallbackSlides(prompt: string, mode: "auto" | "manual", count: number): CarouselSlide[] {
  const total = mode === "manual" ? count : 4;
  const purposes = ["hook", "problem", "solution", "cta", "detail", "proof", "feature", "summary"];
  const slides: CarouselSlide[] = [];

  for (let index = 0; index < total; index += 1) {
    const slideIndex = index + 1;
    slides.push({
      slide_index: slideIndex,
      slide_purpose: purposes[index] || "detail",
      headline: `Slide ${slideIndex}`,
      image_prompt: `${prompt}. Create slide ${slideIndex} with a clear ${purposes[index] || "detail"} narrative focus, cinematic composition, and social-first visual clarity.`,
    });
  }

  return slides;
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

    const body = await parseJsonBody<CarouselRequestBody>(req);
    const prompt = String(body.prompt || "").trim();
    if (!prompt) {
      return jsonResponse({ error: "Missing prompt" }, 400);
    }

    const normalizedCount = normalizeSlideCount(body.slideCount);

    const systemPrompt = buildSystemPrompt(normalizedCount.mode, normalizedCount.count);
    const userPrompt = `USER PROMPT:\n${prompt}\n\nBRAND CONTEXT:\n${readBrandContext(body.brandKit)}`;

    const result = await callLlm({
      preferredProvider: "groq",
      systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 1200,
      temperature: 0.4,
      jsonMode: true,
    });

    let parsed: GroqResponse | null = null;
    try {
      parsed = JSON.parse(result.content);
    } catch (_err) {
      // Fallback below.
    }

    const slides = Array.isArray(parsed?.slides)
      ? sanitizeSlides(parsed.slides, normalizedCount.mode, normalizedCount.count, prompt)
      : buildFallbackSlides(prompt, normalizedCount.mode, normalizedCount.count);

    return jsonResponse({ slides });
  } catch (error) {
    console.error("[generateCarouselPlan] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
