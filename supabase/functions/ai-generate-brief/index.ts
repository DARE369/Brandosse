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
  normalizeOrgRole,
  recordCreditUsage,
  requireActiveOrgMember,
} from "../_shared/org.ts";
import { callLlm } from "../_shared/llm.ts";

type BriefRequest = {
  organization_id: string;
  brand_project_id: string;
  campaign_description: string;
  target_platforms: string[];
  duration_days: number;
  post_frequency: number;
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
    const body = await parseJsonBody<BriefRequest>(req);

    if (!body.organization_id || !body.brand_project_id || !body.campaign_description) {
      throw createHttpError("Missing brief generation details.", 400);
    }

    const member = await requireActiveOrgMember(adminClient, body.organization_id, user.id);
    const role = normalizeOrgRole(member);
    if (!["org_owner", "org_admin", "editor"].includes(role)) {
      throw createHttpError("Only editors and organization admins can generate briefs.", 403);
    }
    if (!ensureBrandProjectAccess(member, body.brand_project_id)) {
      throw createHttpError("You do not have access to this brand project.", 403);
    }

    await ensureCreditsAvailable(adminClient, body.organization_id, member, 15);

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
You are a strategic social media planning assistant for ${organization.name}. Return only valid JSON.`,
      messages: [
        {
          role: "user",
          content: `Generate a content brief for the following campaign.
Brand name: ${brandProject.name}
Voice: ${String(brandSettings.voice_description || "Not specified")}
Tone descriptors: ${Array.isArray(brandSettings.tone_descriptors) ? brandSettings.tone_descriptors.join(", ") : "Not specified"}
Prompt guidelines: ${String(brandSettings.prompt_guidelines || "Not specified")}
Target audience: ${String(brandSettings.target_audience || "Not specified")}
Content pillars: ${Array.isArray(brandSettings.content_pillars) ? brandSettings.content_pillars.join(", ") : "Not specified"}
Campaign: ${body.campaign_description}
Platforms: ${(body.target_platforms || []).join(", ")}
Duration: ${Number(body.duration_days || 0)} days
Frequency: ${Number(body.post_frequency || 0)} posts per week

Return JSON with this exact structure:
{
  "brief_title": "string",
  "campaign_summary": "string",
  "content_pillars": ["string"],
  "post_slots": [
    {
      "week": 1,
      "day_of_week": "Monday",
      "platform": "instagram",
      "content_type": "image",
      "topic_suggestion": "string",
      "caption_direction": "string",
      "assigned_to_role": "editor"
    }
  ]
}`,
        },
      ],
      preferredProvider: String(organization.settings?.ai_model || "anthropic"),
      jsonMode: true,
      maxTokens: 1800,
      temperature: 0.4,
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
      eventType: "brief_gen",
      creditsConsumed: 15,
      modelUsed: result.model,
      referenceType: "ai_session",
    });

    return jsonResponse({
      brief: parsed,
      credits_consumed: 15,
      model: result.model,
    });
  } catch (error) {
    console.error("[ai-generate-brief] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
