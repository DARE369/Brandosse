import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import {
  createHttpError,
  insertUserNotification,
  normalizeOrgRole,
  requireActiveOrgMember,
  resolveMemberPermissions,
} from "../_shared/org.ts";
import { loadPipelineContextById } from "../_shared/pipeline.ts";
import { runMockPublish } from "../_shared/mockPublish.ts";

type CalendarPublishRequest = {
  pipeline_item_id: string;
  action: "schedule" | "publish_now";
  scheduled_for?: string;
  account_id?: string | null;
};

async function resolvePublishingAccount(
  adminClient: ReturnType<typeof createAdminClient>,
  accountId: string,
  postOwnerId: string,
  organizationId: string,
  actorUserId: string,
) {
  const { data: account, error } = await adminClient
    .from("connected_accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();

  if (error) throw error;
  if (!account) {
    throw createHttpError("Selected account is not available for this post.", 400);
  }

  const belongsToOwner = account.user_id === postOwnerId;
  const belongsToOrg = account.scope === "organization" && account.organization_id === organizationId;

  if (!belongsToOwner && !belongsToOrg) {
    throw createHttpError("Selected account is not available for this post.", 400);
  }

  if (belongsToOrg) {
    const { data: canPost, error: accessError } = await adminClient.rpc("can_user_post_to_account", {
      p_account_id: account.id,
      p_user_id: actorUserId,
    });

    if (accessError) throw accessError;
    if (!canPost) {
      throw createHttpError("You do not have posting access to this shared organization account.", 403);
    }
  }

  return account;
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
    const adminClient = createAdminClient();
    const body = await parseJsonBody<CalendarPublishRequest>(req);

    if (!body.pipeline_item_id || !body.action) {
      throw createHttpError("Missing calendar publish details.", 400);
    }

    const context = await loadPipelineContextById(adminClient, body.pipeline_item_id);
    const member = await requireActiveOrgMember(adminClient, context.item.organization_id, user.id);
    const permissions = await resolveMemberPermissions(adminClient, context.item.organization_id, member);
    const canPublish = Boolean(permissions.can_publish);
    const canSchedule = Boolean(permissions.can_schedule);
    const requiresFinalApproval = Boolean(permissions.publish_requires_final_approval);

    if (!context.post?.id) {
      throw createHttpError("This pipeline item is not linked to a post.", 400);
    }

    if (!["approved", "scheduled"].includes(context.item.status)) {
      throw createHttpError("Only approved or scheduled pipeline items can be changed from the calendar.", 400);
    }

    if (body.action === "schedule" && !canSchedule && !canPublish) {
      throw createHttpError("You do not have permission to schedule content.", 403);
    }

    if (body.action === "publish_now" && !canPublish) {
      throw createHttpError("You do not have permission to publish content.", 403);
    }

    if (requiresFinalApproval && !["approved", "scheduled"].includes(context.item.status)) {
      throw createHttpError("This content requires final approval before publishing.", 400);
    }

    const pipelineStatus = body.action === "schedule" ? "scheduled" : "published";
    let resolvedAccountId: string | null = context.post.account_id || null;
    let resolvedPlatform: string | null = context.post.platform || null;

    if (body.action === "schedule" && body.account_id) {
      const account = await resolvePublishingAccount(
        adminClient,
        body.account_id,
        context.post.user_id,
        context.item.organization_id,
        user.id,
      );
      resolvedAccountId = account.id;
      resolvedPlatform = account.platform || resolvedPlatform;
    }

    let result: {
      success: boolean;
      mockPostId: string | null;
      mockPostUrl: string | null;
      failureReason: string | null;
      failureIsRetriable: boolean;
    } | null = null;

    if (body.action === "schedule") {
      const { error: postUpdateError } = await adminClient
        .from("posts")
        .update({
          status: "scheduled",
          account_id: resolvedAccountId,
          platform: resolvedPlatform,
          scheduled_at: body.scheduled_for || context.post.scheduled_at || new Date().toISOString(),
        })
        .eq("id", context.post.id);

      if (postUpdateError) throw postUpdateError;

      const { error: itemUpdateError } = await adminClient
        .from("pipeline_items")
        .update({
          status: "scheduled",
          scheduled_for: body.scheduled_for || context.item.scheduled_for || new Date().toISOString(),
        })
        .eq("id", context.item.id);

      if (itemUpdateError) throw itemUpdateError;
    } else {
      const publishAccount = await resolvePublishingAccount(
        adminClient,
        context.post.account_id || body.account_id || "",
        context.post.user_id,
        context.item.organization_id,
        user.id,
      );

      resolvedAccountId = publishAccount.id;
      resolvedPlatform = publishAccount.platform || context.post.platform || null;

      const { error: markPublishingError } = await adminClient
        .from("posts")
        .update({
          status: "publishing",
          account_id: resolvedAccountId,
          platform: resolvedPlatform,
        })
        .eq("id", context.post.id);

      if (markPublishingError) throw markPublishingError;

      result = await runMockPublish({
        adminClient,
        account: publishAccount,
        post: {
          ...context.post,
          account_id: resolvedAccountId,
          platform: resolvedPlatform,
        },
        mediaUrl: context.generation?.storage_path || null,
      });
    }

    try {
      const notificationRecipients = [...new Set([
        context.post.user_id || null,
        context.item.submitted_by || null,
      ].filter((recipientId) => recipientId && recipientId !== user.id))];

      for (const recipientId of notificationRecipients) {
        await insertUserNotification(adminClient, {
          userId: recipientId,
          organizationId: context.item.organization_id,
          sentByAdminId: user.id,
          type: body.action === "schedule"
            ? "org_content_scheduled"
            : result?.success
              ? "org_content_published"
              : "system",
          title: body.action === "schedule"
            ? "Content scheduled"
            : result?.success
              ? "Content published"
              : "Publish failed",
          body: body.action === "schedule"
            ? `${user.user_metadata?.full_name || user.email || "A teammate"} scheduled your content.`
            : result?.success
              ? `${user.user_metadata?.full_name || user.email || "A teammate"} sent your content to publish.`
              : `${user.user_metadata?.full_name || user.email || "A teammate"} attempted to publish your content, but the publish failed (${result?.failureReason || "provider error"}).`,
          actionUrl: `/app/org/${context.item.organization_id}/calendar`,
          dedupeKey: body.action === "schedule"
            ? `org_content_scheduled:${context.post.id}:${body.scheduled_for || context.post.scheduled_at || context.item.scheduled_for || new Date().toISOString()}:${recipientId}`
            : result?.success
              ? `org_content_published:${context.post.id}:${new Date().toISOString()}:${recipientId}`
              : `org_content_publish_failed:${context.post.id}:${result?.failureReason || "provider_error"}:${recipientId}`,
          metadata: {
            post_id: context.post.id,
            pipeline_item_id: context.item.id,
            scheduled_for: body.action === "schedule"
              ? (body.scheduled_for || context.post.scheduled_at || context.item.scheduled_for || null)
              : context.post.scheduled_at || context.item.scheduled_for || null,
            publish_success: result?.success ?? null,
            failure_reason: result?.failureReason || null,
          },
        });
      }
    } catch (notificationError) {
      console.warn("[org-calendar-publish] notification warning", notificationError);
    }

    try {
      await adminClient.rpc("write_audit_log", {
        p_actor_id: user.id,
        p_actor_type: "user",
        p_actor_role: normalizeOrgRole(member),
        p_organization_id: context.item.organization_id,
        p_event_category: "calendar",
        p_event_type: body.action === "publish_now" && result && !result.success
          ? "publish_now_failed"
          : body.action,
        p_entity_type: "pipeline_item",
        p_entity_id: context.item.id,
        p_summary: body.action === "schedule"
          ? "Pipeline item scheduled"
          : result?.success
            ? "Pipeline item published"
            : "Pipeline item publish failed",
        p_previous_value: null,
        p_new_value: {
          pipeline_item_id: context.item.id,
          post_id: context.post.id,
          action: body.action,
          account_id: resolvedAccountId,
          success: result?.success ?? null,
          failure_reason: result?.failureReason || null,
        },
        p_metadata: null,
        p_risk_level: null,
        p_correlation_id: null,
        p_ip_address: null,
        p_user_agent: req.headers.get("user-agent"),
      });
    } catch (auditError) {
      console.warn("[org-calendar-publish] audit warning", auditError);
    }

    return jsonResponse({
      pipeline_item_id: context.item.id,
      post_id: context.post.id,
      status: body.action === "schedule"
        ? pipelineStatus
        : result?.success
          ? "published"
          : "revision_requested",
      success: result?.success ?? true,
      mockPostId: result?.mockPostId || null,
      mockPostUrl: result?.mockPostUrl || null,
      failureReason: result?.failureReason || null,
      failureIsRetriable: result?.failureIsRetriable || false,
    });
  } catch (error) {
    console.error("[org-calendar-publish] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
