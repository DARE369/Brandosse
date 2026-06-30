import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import {
  buildBrandKitSystemPrompt,
  createHttpError,
  ensureBrandProjectAccess,
  ensureCreditsAvailable,
  fetchBrandProject,
  fetchOrganization,
  getBrandKitSystemPrompt,
  recordCreditUsage,
  requireActiveOrgMember,
} from "../_shared/org.ts";
import { callLlm } from "../_shared/llm.ts";

type ConsistencyRequest = {
  organization_id: string;
  brand_project_id: string;
  caption: string;
  hashtags?: string[];
  platform: string;
};

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
    const body = await parseJsonBody<ConsistencyRequest>(req);

    if (!body.organization_id || !body.brand_project_id || !body.caption || !body.platform) {
      throw createHttpError("Missing consistency check details.", 400);
    }

    const member = await requireActiveOrgMember(adminClient, body.organization_id, user.id);
    if (!ensureBrandProjectAccess(member, body.brand_project_id)) {
      throw createHttpError("You do not have access to this brand project.", 403);
    }

    await ensureCreditsAvailable(adminClient, body.organization_id, member, 1);

    const organization = await fetchOrganization(adminClient, body.organization_id);
    const brandProject = await fetchBrandProject(adminClient, body.brand_project_id);
    const brandSettings = (brandProject.brand_settings ?? {}) as Record<string, unknown>;
    const brandPrompt = await getBrandKitSystemPrompt(adminClient, body.brand_project_id);

    const result = await callLlm({
      systemPrompt: `${brandPrompt || buildBrandKitSystemPrompt({
        brandName: String(brandProject.name || "Brand"),
        promptPrefix: String(brandSettings.prompt_prefix || ""),
        voiceDescription: String(brandSettings.voice_description || ""),
        toneDescriptors: brandSettings.tone_descriptors,
        contentPillars: brandSettings.content_pillars,
        targetAudience: String(brandSettings.target_audience || ""),
        promptGuidelines: String(brandSettings.prompt_guidelines || ""),
        bannedPhrases: brandSettings.banned_phrases,
      })}
You evaluate social media copy for brand consistency. Return only valid JSON.`,
      messages: [
        {
          role: "user",
          content: `Evaluate this social media caption against the brand's voice guidelines.
Brand: ${brandProject.name}
Brand voice: ${String(brandSettings.voice_description || "Not specified")}
Tone descriptors: ${Array.isArray(brandSettings.tone_descriptors) ? brandSettings.tone_descriptors.join(", ") : "Not specified"}
Prompt guidelines: ${String(brandSettings.prompt_guidelines || "Not specified")}
Platform: ${body.platform}
Caption: ${body.caption}
Hashtags: ${Array.isArray(body.hashtags) ? body.hashtags.join(", ") : "None"}

Return JSON:
{
  "overall_score": 0,
  "passes": true,
  "issues": [{ "type": "string", "description": "string", "suggestion": "string" }],
  "positive_notes": ["string"]
}`,
        },
      ],
      preferredProvider: String(organization.settings?.ai_model || "anthropic"),
      jsonMode: true,
      maxTokens: 1000,
      temperature: 0.2,
    });

    let parsed;
    try {
      parsed = JSON.parse(result.content);
    } catch (_error) {
      throw createHttpError("AI response could not be parsed as JSON.", 500);
    }

    await recordCreditUsage(adminClient, {
      organizationId: body.organization_id,
      brandProjectId: body.brand_project_id,
      memberId: user.id,
      eventType: "consistency_check",
      creditsConsumed: 1,
      modelUsed: result.model,
      referenceType: "ai_session",
    });

    return jsonResponse({
      result: parsed,
      credits_consumed: 1,
      model: result.model,
    });
  } catch (error) {
    console.error("[ai-brand-consistency-check] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
