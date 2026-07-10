import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callLlm } from "../_shared/llm.ts";
import { createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";

type GenerateContentPlanBody = {
  mode?: "plan" | "revision";
  brief?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  violations?: string[];
  brandKit?: Record<string, unknown>;
};

const CONTENT_PLAN_SCHEMA_SKELETON = {
  schema_version: "1.0",
  generated_at: "<ISO timestamp>",
  intent_summary: "<string>",
  content_goal: "<brand_awareness|product_promotion|education|entertainment|lead_generation|community_engagement>",
  platforms: ["<instagram|tiktok|linkedin|x|youtube>"],
  primary_platform: "<string>",
  content_type: "<single|carousel|video>",
  carousel: {
    slide_count: "<number >= 2>",
    theme: "<string>",
    slides: [{
      slide_index: "<number>",
      slide_purpose: "<hook|problem|solution|proof|feature|cta|tip|transition>",
      headline: "<string>",
      body_text: "<string optional>",
      image_prompt: "<string, min 40 words>",
    }],
  },
  visual_prompt: {
    global_style: "<string>",
    aspect_ratio: "<1:1|16:9|9:16|4:5>",
    slides: [{
      slide_index: "<number>",
      full_prompt: "<string, min 40 words>",
      negative_prompt: "<string optional>",
    }],
  },
  caption: {
    primary: "<string>",
    hook: "<string>",
    cta: "<string>",
    platform_overrides: { instagram: "<string>", tiktok: "<string>", linkedin: "<string>", x: "<string>" },
  },
  title: {
    generic: "<string>",
    platform_overrides: { youtube: "<string>", linkedin: "<string>" },
  },
  hashtags: {
    primary: ["<string>"],
    niche: ["<string>"],
    trending: ["<string>"],
    brand: ["<string>"],
    platform_sets: { instagram: ["<string>"], tiktok: ["<string>"], linkedin: ["<string>"] },
  },
  seo: {
    optimized_title: "<string>",
    optimized_caption: "<string>",
    optimized_hashtags: ["<string>"],
    score: "<number 0-100>",
    score_category: "<Poor|Ok|Good|Great>",
    score_breakdown: {
      platform_alignment: { score: "<number>", max: 20, rationale: "<string>" },
      keyword_density: { score: "<number>", max: 20, rationale: "<string>" },
      caption_structure: { score: "<number>", max: 20, rationale: "<string>" },
      hashtag_relevance: { score: "<number>", max: 20, rationale: "<string>" },
      cta_presence: { score: "<number>", max: 10, rationale: "<string>" },
      brand_consistency: { score: "<number>", max: 10, rationale: "<string>" },
    },
    improvement_report: [{ type: "<improvement|warning|info>", bullet: "<string>" }],
  },
  guardrails_check: {
    pass: "<boolean>",
    violations: ["<string>"],
    notes: "<string>",
  },
};

const CONTENT_PLAN_SYSTEM_PROMPT = `
You are an expert social media content strategist and creative director.
Your job is to analyze a user's input and produce a comprehensive, brand-consistent ContentPlan JSON object.

RULES:
1. Return ONLY valid JSON. No markdown, no backticks, no preamble.
2. Every required field must be present. Use empty arrays [] or empty strings "" if no content, never null.
3. Outputs must be internally consistent across caption, hashtags, title, and visual prompts.
4. Platform overrides must respect platform constraints:
   - x.com: caption <= 280 chars
   - Instagram: ideal caption 125-150 words; up to 30 hashtags
   - LinkedIn: formal tone; max 5-7 hashtags
   - TikTok: short hook; 3-5 hashtags
   - YouTube: title <= 70 chars
5. For carousels: first slide is always the hook. Respect requested_slide_count:
   - If requested_slide_count is a number, use exactly that number.
   - If requested_slide_count is "auto", choose based on complexity with a maximum of 8 slides.
6. Image prompts must be detailed, vivid, technically specific (lighting, style, composition, mood), min 40 words.
7. Hashtags should be relevant and non-spammy.
8. SEO scores should be honest and include improvement_report rationale.
9. If brand kit exists, follow brand voice, visual style, and forbidden phrases.
10. guardrails_check must actively check content_restrictions.

JSON schema to follow:
${JSON.stringify(CONTENT_PLAN_SCHEMA_SKELETON, null, 2)}
`.trim();

const REVISION_SYSTEM_PROMPT = `
You are a content compliance editor. You will receive a ContentPlan JSON and a list of guardrail violations.
Fix ONLY the violations. Do not change unrelated fields.
Return the corrected ContentPlan as valid JSON only. No markdown, no backticks, no preamble.
`.trim();

function pickJson(value: string): string {
  const text = String(value || "").trim();
  if (!text) throw new Error("LLM returned an empty response");

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);

  return text;
}

function buildPlanUserMessage(brief: Record<string, unknown>): string {
  const intentHints = brief.intent_hints && typeof brief.intent_hints === "object"
    ? Object.entries(brief.intent_hints as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join("\n")
    : "";
  const platforms = Array.isArray(brief.platform_targets) ? brief.platform_targets.join(", ") : "";

  return `
Create a ContentPlan for the following request.

USER INPUT: "${String(brief.raw_input || "")}"

INTENT HINTS (from user clarification):
${intentHints || "None provided; infer from input and history."}

BRAND KIT:
${String(brief.brand_summary || "No brand kit configured. Use neutral defaults.")}

BRAND ASSETS:
${String(brief.asset_context || "None.")}

RECENT USER HISTORY (for context/consistency):
${String(brief.history_summary || "No prior generations.")}

GENERATION SETTINGS:
- Media type: ${String(brief.media_type || "image")}
- Content type: ${String(brief.content_type || "single")}
- Requested slide count: ${String(brief.requested_slide_count ?? "n/a")}
- Aspect ratio: ${String(brief.aspect_ratio || "1:1")}
- Target platforms: ${platforms || "Not specified"}

Produce the ContentPlan JSON now.
`.trim();
}

function buildRevisionUserMessage(
  plan: Record<string, unknown>,
  violations: string[],
  brandKit?: Record<string, unknown>,
): string {
  const brandSummary = typeof brandKit?.summary === "string" ? brandKit.summary : "none";

  return `
ContentPlan (JSON):
${JSON.stringify(plan)}

Violations to fix:
${violations.map((item, index) => `${index + 1}. ${item}`).join("\n")}

Brand kit context:
${brandSummary}

Return the corrected ContentPlan JSON.
`.trim();
}

async function generatePlan(brief: Record<string, unknown>) {
  const llmResult = await callLlm({
    systemPrompt: CONTENT_PLAN_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildPlanUserMessage(brief) }],
    preferredProvider: "groq",
    maxTokens: 3500,
    temperature: 0.7,
    jsonMode: true,
  });

  const parsed = JSON.parse(pickJson(llmResult.content)) as Record<string, unknown>;
  return {
    plan: parsed,
    provider: llmResult.provider,
    model: llmResult.model,
    totalTokens: llmResult.totalTokens,
  };
}

async function revisePlan(
  plan: Record<string, unknown>,
  violations: string[],
  brandKit?: Record<string, unknown>,
) {
  const llmResult = await callLlm({
    systemPrompt: REVISION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildRevisionUserMessage(plan, violations, brandKit) }],
    preferredProvider: "groq",
    maxTokens: 3500,
    temperature: 0.4,
    jsonMode: true,
  });

  const parsed = JSON.parse(pickJson(llmResult.content)) as Record<string, unknown>;
  return {
    plan: parsed,
    provider: llmResult.provider,
    model: llmResult.model,
    totalTokens: llmResult.totalTokens,
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
    await requireUser(authClient);

    const body = await parseJsonBody<GenerateContentPlanBody>(req);
    const mode = body.mode === "revision" ? "revision" : "plan";

    if (mode === "revision") {
      if (!body.plan || typeof body.plan !== "object") {
        return jsonResponse({ error: "Missing plan" }, 400);
      }
      const violations = Array.isArray(body.violations) ? body.violations.map(String).filter(Boolean) : [];
      if (!violations.length) {
        return jsonResponse({ error: "Missing violations" }, 400);
      }
      return jsonResponse(await revisePlan(body.plan, violations, body.brandKit));
    }

    if (!body.brief || typeof body.brief !== "object") {
      return jsonResponse({ error: "Missing brief" }, 400);
    }

    return jsonResponse(await generatePlan(body.brief));
  } catch (error) {
    console.error("[generate-content-plan] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
