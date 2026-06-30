import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import {
  createHttpError,
  insertUserNotification,
  normalizeOrgRole,
  requireActiveOrgMember,
} from "../_shared/org.ts";
import {
  canActorAdvanceCurrentStage,
  getCurrentStage,
  loadPipelineContextById,
  performPipelineAction,
} from "../_shared/pipeline.ts";

type PipelineAdvanceRequest = {
  pipeline_item_id: string;
  action: "approve" | "reject" | "request_revision" | "withdraw";
  comment?: string;
  scheduled_for?: string;
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
    const body = await parseJsonBody<PipelineAdvanceRequest>(req);

    if (!body.pipeline_item_id || !body.action) {
      throw createHttpError("Missing pipeline action details.", 400);
    }

    const context = await loadPipelineContextById(adminClient, body.pipeline_item_id);
    const member = await requireActiveOrgMember(adminClient, context.item.organization_id, user.id);
    const role = normalizeOrgRole(member);

    if (!canActorAdvanceCurrentStage({
      action: body.action,
      actorId: user.id,
      role,
      item: context.item,
      config: context.config,
    })) {
      throw createHttpError("You are not allowed to act on this pipeline stage.", 403);
    }

    const currentStage = getCurrentStage(context.item, context.config);
    if (
      body.action === "request_revision"
      && currentStage?.require_comment_on_rejection
      && !String(body.comment || "").trim()
    ) {
      throw createHttpError("A comment is required to request revision on this stage.", 400);
    }

    const updatedItem = await performPipelineAction({
      adminClient,
      context,
      action: body.action,
      actorId: user.id,
      actorName: user.user_metadata?.full_name || user.email || "Member",
      comment: body.comment || null,
      scheduledFor: body.scheduled_for || null,
    });

    try {
      if (body.action === "request_revision" && context.item.submitted_by) {
        await insertUserNotification(adminClient, {
          userId: context.item.submitted_by,
          organizationId: context.item.organization_id,
          sentByAdminId: user.id,
          type: "pipeline_revision_requested",
          title: "Revision requested",
          body: `${user.user_metadata?.full_name || user.email || "A reviewer"} requested changes on your submission.`,
          actionUrl: `/app/org/${context.item.organization_id}/pipeline`,
          dedupeKey: `pipeline_revision_requested:${context.item.id}:${updatedItem?.updated_at || new Date().toISOString()}`,
          metadata: {
            pipeline_item_id: context.item.id,
            action: body.action,
          },
        });
      }

      if (body.action === "approve" && !updatedItem?.current_assignee_user_id && context.item.submitted_by) {
        await insertUserNotification(adminClient, {
          userId: context.item.submitted_by,
          organizationId: context.item.organization_id,
          sentByAdminId: user.id,
          type: "pipeline_approved",
          title: "Content approved",
          body: `${user.user_metadata?.full_name || user.email || "A reviewer"} approved your content.`,
          actionUrl: `/app/org/${context.item.organization_id}/calendar`,
          dedupeKey: `pipeline_approved:${context.item.id}:${updatedItem?.updated_at || new Date().toISOString()}`,
          metadata: {
            pipeline_item_id: context.item.id,
          },
        });
      }
    } catch (notificationError) {
      console.warn("[pipeline-advance] notification warning", notificationError);
    }

    try {
      await adminClient.rpc("write_audit_log", {
        p_actor_id: user.id,
        p_actor_type: "user",
        p_actor_role: role,
        p_organization_id: context.item.organization_id,
        p_event_category: "pipeline",
        p_event_type: body.action,
        p_entity_type: "pipeline_item",
        p_entity_id: context.item.id,
        p_summary: `Pipeline item ${body.action}`,
        p_previous_value: null,
        p_new_value: updatedItem,
        p_metadata: {
          pipeline_item_id: context.item.id,
          comment: body.comment || null,
        },
        p_risk_level: null,
        p_correlation_id: null,
        p_ip_address: null,
        p_user_agent: req.headers.get("user-agent"),
      });
    } catch (auditError) {
      console.warn("[pipeline-advance] audit warning", auditError);
    }

    return jsonResponse({
      pipeline_item: updatedItem,
    });
  } catch (error) {
    console.error("[pipeline-advance] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
