import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import {
  buildBrandKitSystemPrompt,
  createHttpError,
  ensureBrandProjectAccess,
  ensureCreditsAvailable,
  fetchBrandProject,
  fetchDefaultBrandProject,
  fetchOrganization,
  getBrandKitSystemPrompt,
  recordCreditUsage,
  requireActiveOrgMember,
} from "../_shared/org.ts";
import { callLlm } from "../_shared/llm.ts";

type ChatRequest = {
  organization_id: string;
  channel_id: string;
  brand_project_id?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  session_key?: string;
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
    const body = await parseJsonBody<ChatRequest>(req);

    if (!body.organization_id || !body.channel_id || !Array.isArray(body.messages) || body.messages.length === 0) {
      throw createHttpError("Missing chat request details.", 400);
    }

    const member = await requireActiveOrgMember(adminClient, body.organization_id, user.id);

    const { data: channel, error: channelError } = await adminClient
      .from("common_room_channels")
      .select("id, organization_id, brand_project_id, member_ids, channel_type, is_ai_enabled")
      .eq("id", body.channel_id)
      .maybeSingle();

    if (channelError) throw channelError;
    if (!channel || channel.organization_id !== body.organization_id) {
      throw createHttpError("Channel not found.", 404);
    }

    if (Array.isArray(channel.member_ids) && !channel.member_ids.includes(user.id)) {
      throw createHttpError("You do not have access to this channel.", 403);
    }

    if (channel.is_ai_enabled === false) {
      throw createHttpError("AI replies are disabled for this channel.", 403);
    }

    const brandProjectId = body.brand_project_id || channel.brand_project_id || null;
    if (!ensureBrandProjectAccess(member, brandProjectId)) {
      throw createHttpError("You do not have access to this brand project.", 403);
    }

    await ensureCreditsAvailable(adminClient, body.organization_id, member, 1);

    const organization = await fetchOrganization(adminClient, body.organization_id);
    const brandProject = brandProjectId
      ? await fetchBrandProject(adminClient, brandProjectId)
      : await fetchDefaultBrandProject(adminClient, body.organization_id);
    const preferredProvider = String(organization.settings?.ai_model || "anthropic");
    const brandPrompt = await getBrandKitSystemPrompt(adminClient, brandProject?.id || null);
    const fallbackBrandPrompt = buildBrandKitSystemPrompt({
      brandName: String(brandProject?.name || "Brand"),
      promptPrefix: "",
      voiceDescription: String((brandProject?.brand_settings as Record<string, unknown> | undefined)?.voice_description || ""),
      toneDescriptors: (brandProject?.brand_settings as Record<string, unknown> | undefined)?.tone_descriptors,
      contentPillars: (brandProject?.brand_settings as Record<string, unknown> | undefined)?.content_pillars,
      targetAudience: String((brandProject?.brand_settings as Record<string, unknown> | undefined)?.target_audience || ""),
      promptGuidelines: String((brandProject?.brand_settings as Record<string, unknown> | undefined)?.prompt_guidelines || ""),
      bannedPhrases: (brandProject?.brand_settings as Record<string, unknown> | undefined)?.banned_phrases,
    });

    const llmResult = await callLlm({
      systemPrompt: `${brandPrompt || fallbackBrandPrompt}
You are an AI collaborator inside ${String(organization.name || "Organization")}'s content team workspace.
Your role is to help the team ideate, develop briefs, refine content concepts, and answer creative questions.
Be concise, practical, and collaborative. Speak as a creative team member, not as an assistant.`,
      messages: body.messages,
      preferredProvider,
      maxTokens: 1200,
      temperature: 0.4,
    });

    const creditsConsumed = Math.max(1, Math.ceil(Number(llmResult.totalTokens || 0) / 100));

    await ensureCreditsAvailable(adminClient, body.organization_id, member, creditsConsumed);

    const { data: insertedMessage, error: messageError } = await adminClient
      .from("common_room_messages")
      .insert({
        channel_id: body.channel_id,
        organization_id: body.organization_id,
        sender_id: null,
        sender_type: "ai",
        content: llmResult.content,
        content_type: "ai_response",
        metadata: {
          model: llmResult.model,
          provider: llmResult.provider,
          credits_used: creditsConsumed,
        },
      })
      .select("*")
      .single();

    if (messageError) throw messageError;

    let sessionKey = String(body.session_key || "").trim();
    if (!sessionKey) {
      const keyResponse = await adminClient.rpc("generate_ai_session_key", {
        p_org_id: body.organization_id,
        p_user_id: user.id,
      });

      sessionKey = String(keyResponse.data || "").trim()
        || `org_${body.organization_id.replace(/-/g, "").slice(0, 4)}_${user.id.replace(/-/g, "").slice(0, 4)}_${Date.now()}`;
    }

    const { data: existingLog } = await adminClient
      .from("ai_session_logs")
      .select("id, message_count, credits_consumed")
      .eq("session_key", sessionKey)
      .maybeSingle();

    if (existingLog?.id) {
      const { error: logUpdateError } = await adminClient
        .from("ai_session_logs")
        .update({
          message_count: Number(existingLog.message_count || 0) + 1,
          credits_consumed: Number(existingLog.credits_consumed || 0) + creditsConsumed,
          ended_at: new Date().toISOString(),
        })
        .eq("id", existingLog.id);

      if (logUpdateError) throw logUpdateError;
    } else {
      const { error: logInsertError } = await adminClient
        .from("ai_session_logs")
        .insert({
          session_key: sessionKey,
          organization_id: body.organization_id,
          brand_project_id: brandProject?.id || null,
          channel_id: body.channel_id,
          initiated_by: user.id,
          session_type: "group",
          model_used: llmResult.model,
          credits_consumed: creditsConsumed,
          message_count: 1,
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
        });

      if (logInsertError) throw logInsertError;
    }

    await recordCreditUsage(adminClient, {
      organizationId: body.organization_id,
      brandProjectId: brandProject?.id || null,
      channelId: body.channel_id,
      memberId: user.id,
      eventType: "ai_chat",
      creditsConsumed,
      modelUsed: llmResult.model,
      referenceId: insertedMessage.id,
      referenceType: "ai_session",
    });

    return jsonResponse({
      content: llmResult.content,
      session_key: sessionKey,
      credits_consumed: creditsConsumed,
      model: llmResult.model,
      message_id: insertedMessage.id,
    });
  } catch (error) {
    console.error("[ai-org-chat] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
