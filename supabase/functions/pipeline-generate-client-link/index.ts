import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { createHttpError, normalizeOrgRole, requireActiveOrgMember } from "../_shared/org.ts";
import { canActorAdvanceCurrentStage, getCurrentStage, loadPipelineContextById } from "../_shared/pipeline.ts";
import { readEnv } from "../_shared/env.ts";

type ClientLinkRequest = {
  pipeline_item_id: string;
};

const CLIENT_REVIEW_LINK_EXPIRY_HOURS = 72;

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
    const body = await parseJsonBody<ClientLinkRequest>(req);

    if (!body.pipeline_item_id) {
      throw createHttpError("Missing pipeline item id.", 400);
    }

    const context = await loadPipelineContextById(adminClient, body.pipeline_item_id);
    const member = await requireActiveOrgMember(adminClient, context.item.organization_id, user.id);
    const role = normalizeOrgRole(member);

    if (!canActorAdvanceCurrentStage({
      action: "approve",
      actorId: user.id,
      role,
      item: context.item,
      config: context.config,
    })) {
      throw createHttpError("You are not allowed to generate a client review link for this stage.", 403);
    }

    const currentStage = getCurrentStage(context.item, context.config);
    if (!currentStage?.generates_client_review_link) {
      throw createHttpError("The current stage does not support client review links.", 400);
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + CLIENT_REVIEW_LINK_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
    const { error } = await adminClient
      .from("pipeline_items")
      .update({
        client_review_token: token,
        client_review_token_expires_at: expiresAt,
        client_review_token_used_at: null,
      })
      .eq("id", context.item.id);

    if (error) throw error;

    const appUrl = readEnv("APP_URL", false)
      || readEnv("SITE_URL", false)
      || readEnv("PUBLIC_APP_URL", false)
      || "";

    const reviewUrl = appUrl
      ? `${appUrl.replace(/\/+$/, "")}/review/${token}`
      : `/review/${token}`;

    return jsonResponse({
      pipeline_item_id: context.item.id,
      client_review_token: token,
      client_review_token_expires_at: expiresAt,
      expires_in_hours: CLIENT_REVIEW_LINK_EXPIRY_HOURS,
      review_url: reviewUrl,
    });
  } catch (error) {
    console.error("[pipeline-generate-client-link] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
