import { supabase } from '../supabaseClient';

function toErrorMessage(error, fallback) {
  const message = error?.context?.json?.error
    || error?.message
    || error?.error_description
    || fallback;
  return String(message || fallback);
}

/**
 * Despite the file name, this calls the unified `publish-post` edge function,
 * not `mock-publish` directly — `publish-post` routes internally to the mock
 * flow or the real Zernio flow based on connected_accounts.is_mock, which is
 * what every manual "Post now"/"Retry now" UI action needs (previously this
 * called `mock-publish` directly, so those buttons always simulated even for
 * real connected accounts — the real path was only reachable from the
 * scheduled-publish cron).
 */
export async function publishPost(postId, connectedAccountId, options = {}) {
  if (!postId) throw new Error('Post id is required');
  if (!connectedAccountId) throw new Error('Connected account id is required');

  const payload = {
    post_id: postId,
    connected_account_id: connectedAccountId,
    user_id: options.userId || null,
    organization_id: options.organizationId || null,
    publish_request_id: options.publishRequestId || null,
  };

  const { data, error } = await supabase.functions.invoke('publish-post', {
    body: payload,
  });

  if (error) {
    throw new Error(toErrorMessage(error, 'Could not publish this post.'));
  }

  return {
    success: Boolean(data?.success),
    mockPostId: data?.platformPostId || null,
    mockPostUrl: data?.platformPostUrl || null,
    failureReason: data?.success ? null : (data?.failureReason || 'publish_failed'),
    failureIsRetriable: false,
    // Set when something was silently adjusted to fit a platform constraint
    // (e.g. a caption auto-shortened for TikTok's photo-post title limit).
    note: data?.note || null,
  };
}
