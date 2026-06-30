import { supabase } from '../supabaseClient';

function toErrorMessage(error, fallback) {
  const message = error?.context?.json?.error
    || error?.message
    || error?.error_description
    || fallback;
  return String(message || fallback);
}

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

  const { data, error } = await supabase.functions.invoke('mock-publish', {
    body: payload,
  });

  if (error) {
    throw new Error(toErrorMessage(error, 'Could not publish through the mock provider.'));
  }

  return data;
}
