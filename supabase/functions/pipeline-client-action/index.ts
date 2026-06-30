import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { createHttpError } from "../_shared/org.ts";
import { loadPipelineContextByToken, performPipelineAction } from "../_shared/pipeline.ts";

type ClientActionRequest = {
  client_review_token: string;
  action: "preview" | "approve" | "request_revision";
  comment?: string;
};

function isExpiredToken(value: string | null | undefined) {
  if (!value) return false;
  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) return false;
  return expiresAt.getTime() <= Date.now();
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const adminClient = createAdminClient();
    const body = await parseJsonBody<ClientActionRequest>(req);
    const token = String(body.client_review_token || "").trim();
    const action = String(body.action || "preview").trim().toLowerCase();

    if (!token) {
      throw createHttpError("Missing client review token.", 400);
    }

    const context = await loadPipelineContextByToken(adminClient, token);
    if (isExpiredToken(context.item.client_review_token_expires_at)) {
      throw createHttpError("This review link has expired. Request a new link.", 410);
    }

    const tokenUsed = Boolean(context.item.client_review_token_used_at);
    const previewPayload = {
      completed: tokenUsed || context.item.status === "approved",
      title: context.item.title || context.post?.caption || "Content review",
      caption: context.post?.caption || context.generation?.prompt || "",
      media_url: context.generation?.storage_path || null,
      platform: context.item.platform || context.post?.platform || null,
      organization_name: context.organization?.name || "Organization",
      expires_at: context.item.client_review_token_expires_at || null,
    };

    if (action === "preview") {
      return jsonResponse(previewPayload);
    }

    if (!["approve", "request_revision"].includes(action)) {
      throw createHttpError("Unsupported client review action.", 400);
    }

    if (tokenUsed) {
      throw createHttpError("This review has already been completed.", 400);
    }

    const updatedItem = await performPipelineAction({
      adminClient,
      context,
      action: action === "approve" ? "approve" : "request_revision",
      actorId: "client-review",
      actorName: "Client Reviewer",
      comment: body.comment || null,
      scheduledFor: null,
    });

    const { error } = await adminClient
      .from("pipeline_items")
      .update({
        client_review_token_used_at: new Date().toISOString(),
      })
      .eq("id", context.item.id);

    if (error) throw error;

    return jsonResponse({
      completed: true,
      action,
      pipeline_item: updatedItem,
    });
  } catch (error) {
    console.error("[pipeline-client-action] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
