import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { createHttpError, requireActiveOrgMember } from "../_shared/org.ts";
import {
  requireServiceRole,
} from "../_shared/connectionHelpers.ts";
import { runMockPublish } from "../_shared/mockPublish.ts";

type MockPublishRequest = {
  post_id: string;
  connected_account_id: string;
  user_id?: string | null;
  organization_id?: string | null;
  publish_request_id?: string | null;
};

function isServiceRoleRequest(req: Request) {
  return req.headers.get("Authorization") === `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""}`;
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    let requesterId: string | null = null;
    const adminClient = createAdminClient();

    if (isServiceRoleRequest(req)) {
      requireServiceRole(req);
    } else {
      const authClient = createAuthClient(req.headers.get("Authorization"));
      const user = await requireUser(authClient);
      requesterId = user.id;
    }

    const body = await parseJsonBody<MockPublishRequest>(req);
    const postId = String(body.post_id || "").trim();
    const connectedAccountId = String(body.connected_account_id || "").trim();
    const publishRequestId = String(body.publish_request_id || "").trim() || null;

    if (!postId || !connectedAccountId) {
      throw createHttpError("post_id and connected_account_id are required", 400);
    }

    const { data: account, error: accountError } = await adminClient
      .from("connected_accounts")
      .select("*")
      .eq("id", connectedAccountId)
      .maybeSingle();

    if (accountError) throw accountError;
    if (!account) throw createHttpError("Connected account not found", 404);

    const { data: post, error: postError } = await adminClient
      .from("posts")
      .select(`
        id,
        user_id,
        organization_id,
        pipeline_item_id,
        generation_id,
        caption,
        platform,
        status,
        scheduled_at,
        created_at,
        generations (
          storage_path,
          media_type
        )
      `)
      .eq("id", postId)
      .maybeSingle();

    if (postError) throw postError;
    if (!post) throw createHttpError("Post not found", 404);

    if (requesterId) {
      if (post.organization_id) {
        await requireActiveOrgMember(adminClient, post.organization_id, requesterId);
      } else if (post.user_id !== requesterId || account.user_id !== requesterId) {
        throw createHttpError("Forbidden", 403);
      }
    }

    if (account.scope === "organization" && account.organization_id !== post.organization_id) {
      throw createHttpError("Connected account organization does not match the post organization", 400);
    }

    if (publishRequestId) {
      const { data: existingLog, error: existingLogError } = await adminClient
        .from("mock_publish_logs")
        .select("status, mock_post_id, mock_post_url, simulated_failure_reason, failure_is_retriable")
        .eq("post_id", post.id)
        .eq("connected_account_id", account.id)
        .eq("publish_request_id", publishRequestId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingLogError) throw existingLogError;
      if (existingLog) {
        const success = existingLog.status === "success";
        return jsonResponse({
          success,
          mockPostId: existingLog.mock_post_id || null,
          mockPostUrl: existingLog.mock_post_url || null,
          failureReason: success ? null : (existingLog.simulated_failure_reason || "publish_failed"),
          failureIsRetriable: success ? false : Boolean(existingLog.failure_is_retriable),
        });
      }
    }

    const generationRow = Array.isArray(post.generations) ? post.generations[0] : post.generations;
    const result = await runMockPublish({
      adminClient,
      account,
      post,
      mediaUrl: generationRow?.storage_path || null,
      publishRequestId,
    });

    return jsonResponse(result, 200);
  } catch (error) {
    console.error("[mock-publish] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
