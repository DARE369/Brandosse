import type { DatabaseClient } from "./supabase.ts";
import {
  buildMockPostId,
  buildMockPostUrl,
  insertConnectionEvent,
  isConnectedStatus,
  pickFailureReason,
} from "./connectionHelpers.ts";

type MockPublishParams = {
  adminClient: DatabaseClient;
  account: Record<string, any>;
  post: Record<string, any>;
  mediaUrl?: string | null;
  publishRequestId?: string | null;
};

export type MockPublishResult = {
  success: boolean;
  mockPostId: string | null;
  mockPostUrl: string | null;
  failureReason: string | null;
  failureIsRetriable: boolean;
};

export async function runMockPublish({
  adminClient,
  account,
  post,
  mediaUrl = null,
  publishRequestId = null,
}: MockPublishParams): Promise<MockPublishResult> {
  const publishTimestamp = new Date().toISOString();
  const username = account.username || account.account_name || "socialai";
  const outcome = isConnectedStatus(account.connection_status)
    ? pickFailureReason(Number(account.consecutive_failure_count || 0))
    : {
        success: false,
        retriable: false,
        reason: "account_not_connected",
        severity: "error",
        nextStatus: String(account.connection_status || "error").toLowerCase() || "error",
      };

  if (outcome.success) {
    const mockPostId = buildMockPostId(account.platform);
    const mockPostUrl = buildMockPostUrl(account.platform, mockPostId, username);

    const { error: logError } = await adminClient
      .from("mock_publish_logs")
      .insert({
        post_id: post.id,
        connected_account_id: account.id,
        publish_request_id: publishRequestId,
        user_id: post.user_id,
        organization_id: post.organization_id,
        platform: account.platform,
        status: "success",
        mock_post_id: mockPostId,
        mock_post_url: mockPostUrl,
        caption_snapshot: post.caption || null,
        media_url_snapshot: mediaUrl,
        platform_snapshot: account.platform,
        published_at: publishTimestamp,
      });

    if (logError) throw logError;

    const { error: updatePostError } = await adminClient
      .from("posts")
      .update({
        status: "published",
        published_at: publishTimestamp,
        platform: account.platform,
        account_id: account.id,
        error_message: null,
        failed_at: null,
      })
      .eq("id", post.id);

    if (updatePostError) throw updatePostError;

    if (post.pipeline_item_id) {
      await adminClient
        .from("pipeline_items")
        .update({ status: "published" })
        .eq("id", post.pipeline_item_id);
    }

    const { error: updateAccountError } = await adminClient
      .from("connected_accounts")
      .update({
        connection_status: "active",
        consecutive_failure_count: 0,
        health_score: Math.min(100, Number(account.health_score || 100) + 10),
        last_successful_publish_at: publishTimestamp,
        last_failure_at: null,
        last_failure_reason: null,
        total_posts_published: Number(account.total_posts_published || 0) + 1,
      })
      .eq("id", account.id);

    if (updateAccountError) throw updateAccountError;

    await insertConnectionEvent(adminClient, {
      connectedAccountId: account.id,
      userId: post.user_id,
      organizationId: post.organization_id,
      eventType: "publish_success",
      platform: account.platform,
      severity: "info",
      message: `${account.display_name || account.account_name || account.username || account.platform} published successfully`,
      metadata: {
        post_id: post.id,
        mock_post_id: mockPostId,
        mock_post_url: mockPostUrl,
      },
    });

    return {
      success: true,
      mockPostId,
      mockPostUrl,
      failureReason: null,
      failureIsRetriable: false,
    };
  }

  const nextFailureCount = Number(account.consecutive_failure_count || 0) + 1;
  const nextHealthScore = Math.max(0, Number(account.health_score || 100) - 15);

  const { error: logError } = await adminClient
    .from("mock_publish_logs")
    .insert({
      post_id: post.id,
      connected_account_id: account.id,
      publish_request_id: publishRequestId,
      user_id: post.user_id,
      organization_id: post.organization_id,
      platform: account.platform,
      status: "failed",
      simulated_failure_reason: outcome.reason,
      failure_is_retriable: outcome.retriable,
      caption_snapshot: post.caption || null,
      media_url_snapshot: mediaUrl,
      platform_snapshot: account.platform,
      failed_at: publishTimestamp,
    });

  if (logError) throw logError;

  const { error: postUpdateError } = await adminClient
    .from("posts")
    .update({
      status: "failed",
      platform: account.platform,
      account_id: account.id,
      error_message: outcome.reason,
      failed_at: publishTimestamp,
    })
    .eq("id", post.id);

  if (postUpdateError) throw postUpdateError;

  if (post.pipeline_item_id) {
    await adminClient
      .from("pipeline_items")
      .update({ status: "revision_requested" })
      .eq("id", post.pipeline_item_id);
  }

  const { error: accountUpdateError } = await adminClient
    .from("connected_accounts")
    .update({
      connection_status: outcome.nextStatus,
      consecutive_failure_count: nextFailureCount,
      health_score: nextHealthScore,
      last_failure_at: publishTimestamp,
      last_failure_reason: outcome.reason,
    })
    .eq("id", account.id);

  if (accountUpdateError) throw accountUpdateError;

  await insertConnectionEvent(adminClient, {
    connectedAccountId: account.id,
    userId: post.user_id,
    organizationId: post.organization_id,
    eventType: "publish_failure",
    platform: account.platform,
    severity: outcome.severity,
    message: `${account.display_name || account.account_name || account.username || account.platform} publish failed: ${outcome.reason}`,
    metadata: {
      post_id: post.id,
      failure_reason: outcome.reason,
      retriable: outcome.retriable,
    },
    isSimulatedFailure: outcome.reason !== "account_not_connected",
  });

  return {
    success: false,
    mockPostId: null,
    mockPostUrl: null,
    failureReason: outcome.reason,
    failureIsRetriable: outcome.retriable,
  };
}
