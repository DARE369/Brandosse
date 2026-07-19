/**
 * publish-post — unified publish endpoint (real + mock)
 *
 * Routes automatically:
 *   account.is_mock = true  → mock flow (mockPublish.ts)
 *   account.is_mock = false → real platform API via Zernio (zernio.service.ts)
 *
 * Called by:
 *   - The scheduled-publish SQL worker (service-role, via pg_net)
 *   - Manual publish actions in the UI (user JWT)
 *
 * On success:  post.status → "published", external_post_id saved (platform post
 *              URL saved under workflow_state.publish.platform_post_url — posts
 *              has no dedicated column for it)
 * On failure:  post.status → "failed", error_message saved, retry count
 *              tracked under workflow_state.publish.retry_count
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { requireServiceRole } from "../_shared/connectionHelpers.ts";
import { createHttpError, requireActiveOrgMember } from "../_shared/org.ts";
import { runMockPublish } from "../_shared/mockPublish.ts";
import { publishToZernio } from "../_shared/zernio.service.ts";

type PublishRequest = {
  post_id: string;
  connected_account_id: string;
  user_id?: string | null;
  organization_id?: string | null;
  publish_request_id?: string | null;
};

const MAX_RETRIES = 3;

function isServiceRole(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  return auth === `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""}`;
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const adminClient = createAdminClient();
    let requesterId: string | null = null;

    if (isServiceRole(req)) {
      requireServiceRole(req);
    } else {
      const authClient = createAuthClient(req.headers.get("Authorization"));
      const user = await requireUser(authClient);
      requesterId = user.id;
    }

    const body = await parseJsonBody<PublishRequest>(req);
    const postId = String(body.post_id || "").trim();
    const connectedAccountId = String(body.connected_account_id || "").trim();
    const publishRequestId = body.publish_request_id ?? null;

    if (!postId || !connectedAccountId) {
      return jsonResponse({ error: "post_id and connected_account_id are required" }, 400);
    }

    // ── Fetch account + post ──────────────────────────────────────────────────

    const { data: account, error: acctErr } = await adminClient
      .from("connected_accounts")
      .select("*")
      .eq("id", connectedAccountId)
      .maybeSingle();

    if (acctErr) throw acctErr;
    if (!account) throw createHttpError("Connected account not found", 404);

    const { data: post, error: postErr } = await adminClient
      .from("posts")
      .select(`
        id, user_id, organization_id, caption, platform, status,
        scheduled_at, hashtags, workflow_state,
        generations ( storage_path, media_type, output_url )
      `)
      .eq("id", postId)
      .maybeSingle();

    if (postErr) throw postErr;
    if (!post) throw createHttpError("Post not found", 404);

    const postOrgId = post.organization_id ?? null;
    const accountOrgId = account.organization_id ?? null;
    const accountScope = String(account.scope || "personal").trim().toLowerCase();
    const accountIsOrgScoped = accountScope === "organization" || Boolean(accountOrgId);
    const postPlatform = String(post.platform || "").trim().toLowerCase();
    const accountPlatform = String(account.platform || "").trim().toLowerCase();

    if (requesterId) {
      if (postOrgId) {
        await requireActiveOrgMember(adminClient, postOrgId, requesterId);
      } else if (post.user_id !== requesterId || account.user_id !== requesterId) {
        throw createHttpError("Forbidden", 403);
      }
    }

    if (!postOrgId && account.user_id !== post.user_id) {
      throw createHttpError("Personal connected account does not belong to the post owner", 400);
    }
    if (postOrgId && (!accountIsOrgScoped || accountOrgId !== postOrgId)) {
      throw createHttpError("Connected account organization does not match the post organization", 400);
    }
    if (!postOrgId && accountIsOrgScoped) {
      throw createHttpError("Organization connected accounts cannot publish personal posts", 400);
    }
    if (postPlatform && accountPlatform && postPlatform !== accountPlatform) {
      throw createHttpError("Connected account platform does not match the post platform", 400);
    }

    // Guard: don't double-publish
    if (post.status === "published") {
      return jsonResponse({ success: true, message: "Post already published", postId });
    }

    // ── Mark as publishing ────────────────────────────────────────────────────

    await adminClient
      .from("posts")
      .update({ status: "publishing", updated_at: new Date().toISOString() })
      .eq("id", postId);

    // ── Resolve media URL ─────────────────────────────────────────────────────

    const gen = Array.isArray(post.generations) ? post.generations[0] : post.generations;
    const mediaUrl: string | null = (gen as Record<string, unknown>)?.output_url as string
      ?? (gen as Record<string, unknown>)?.storage_path as string
      ?? null;

    // ── Route: mock or real ───────────────────────────────────────────────────

    let result;

    if (account.is_mock) {
      // Mock publish flow — runMockPublish() already writes posts.status/
      // published_at/platform/account_id (and mock_publish_logs, and
      // connected_accounts) itself; do not update posts again here. An
      // earlier version of this function did a second, redundant posts
      // update referencing platform_post_id/platform_post_url/
      // failure_reason, none of which exist on posts (confirmed via live
      // schema introspection 2026-07-10) — that update was silently failing
      // on every mock-routed call through this endpoint.
      result = await runMockPublish({
        adminClient,
        account,
        post,
        mediaUrl,
        publishRequestId: publishRequestId as string | null,
      });

    } else {
      // Real platform publish — Zernio is the only real-publish provider.
      // (The earlier direct-per-platform-OAuth path, publisher.service.ts,
      // was removed: no platform ever had app credentials configured for it,
      // so it could never actually publish anything.)
      if (account.provider && account.provider !== "zernio") {
        result = {
          success: false,
          platformPostId: null,
          platformPostUrl: null,
          failureReason: `Unsupported publishing provider "${account.provider}". Reconnect this account through Zernio.`,
          retriable: false,
        };
      } else {
        result = await publishToZernio({ post, account, mediaUrl });
      }

      // posts has no consecutive_failure_count/last_failure_at/
      // platform_post_url columns (confirmed via live schema introspection
      // 2026-07-10 — an earlier version of this function assumed columns
      // from a migration that never actually ran against the live DB).
      // external_post_id and error_message are the real equivalents of
      // platform_post_id/failure_reason. Retry count and the platform post
      // URL have no dedicated column, so they're tracked inside
      // workflow_state, the same flexible jsonb column posts already uses
      // for other workflow bookkeeping.
      const existingWorkflowState = (post.workflow_state && typeof post.workflow_state === "object")
        ? post.workflow_state as Record<string, unknown>
        : {};
      const existingPublish = (existingWorkflowState.publish && typeof existingWorkflowState.publish === "object")
        ? existingWorkflowState.publish as Record<string, unknown>
        : {};

      if (!result.success && result.retriable) {
        // Increment retry counter; caller (cron) will retry later
        const retries = Number(existingPublish.retry_count ?? 0) + 1;
        await adminClient
          .from("posts")
          .update({
            status: retries >= MAX_RETRIES ? "failed" : "scheduled",
            error_message: result.failureReason,
            workflow_state: {
              ...existingWorkflowState,
              publish: { ...existingPublish, retry_count: retries, last_failure_at: new Date().toISOString() },
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", postId);
      } else {
        await adminClient
          .from("posts")
          .update({
            status: result.success ? "published" : "failed",
            external_post_id: result.platformPostId,
            error_message: result.failureReason,
            published_at: result.success ? new Date().toISOString() : null,
            failed_at: result.success ? null : new Date().toISOString(),
            workflow_state: {
              ...existingWorkflowState,
              publish: { ...existingPublish, platform_post_url: result.platformPostUrl },
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", postId);

        // Update account health + token
        if (result.success) {
          await adminClient
            .from("connected_accounts")
            .update({
              last_successful_publish_at: new Date().toISOString(),
              consecutive_failure_count: 0,
              total_posts_published: (account.total_posts_published || 0) + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", connectedAccountId);
        } else {
          const failures = (account.consecutive_failure_count || 0) + 1;
          await adminClient
            .from("connected_accounts")
            .update({
              consecutive_failure_count: failures,
              last_failure_at: new Date().toISOString(),
              last_failure_reason: result.failureReason,
              health_score: Math.max(0, (account.health_score || 100) - 15),
              updated_at: new Date().toISOString(),
            })
            .eq("id", connectedAccountId);
        }
      }
    }

    return jsonResponse({
      success: result.success,
      postId,
      platformPostId: result.success
        ? (account.is_mock ? result.mockPostId : result.platformPostId)
        : null,
      platformPostUrl: result.success
        ? (account.is_mock ? result.mockPostUrl : result.platformPostUrl)
        : null,
      failureReason: result.failureReason,
      mode: account.is_mock ? "mock" : "real",
      note: account.is_mock ? null : (result.note ?? null),
    });

  } catch (error) {
    console.error("[publish-post] error:", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
