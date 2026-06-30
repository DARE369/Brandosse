import { publishPost } from './mockPublishService';

export const MOCK_PUBLISH_COMPLETE_EVENT = 'socialai:publish-complete';
const inFlightPublishRequests = new Set();

function normalizeFailureReason(value) {
  return String(value || '').trim().toLowerCase() || 'publish_failed';
}

export function buildPublishSummary(attempts = []) {
  const total = attempts.length;
  const successCount = attempts.filter((attempt) => attempt.success).length;
  const failureCount = total - successCount;
  const allSucceeded = total > 0 && failureCount === 0;
  const anyFailed = failureCount > 0;

  let message = 'Publish complete.';
  if (total === 1 && allSucceeded) {
    message = 'Post published successfully.';
  } else if (total === 1 && anyFailed) {
    message = 'Post publishing failed.';
  } else if (allSucceeded) {
    message = `Published ${successCount} post${successCount === 1 ? '' : 's'}.`;
  } else if (successCount > 0) {
    message = `Published ${successCount} of ${total} post${total === 1 ? '' : 's'}.`;
  } else if (total > 0) {
    message = `All ${total} publish attempt${total === 1 ? '' : 's'} failed.`;
  }

  return {
    total,
    successCount,
    failureCount,
    allSucceeded,
    anyFailed,
    message,
  };
}

export function emitMockPublishComplete(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(MOCK_PUBLISH_COMPLETE_EVENT, { detail }));
}

function buildPublishRequestId({ sessionId = null, source = 'publish' } = {}) {
  const sessionToken = String(sessionId || source || 'session').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'session';
  return `pub_${sessionToken}_${Date.now()}`;
}

function normalizeAttemptResult(attempt, providerResult, fallbackError = null) {
  const success = providerResult?.success === true;
  return {
    ...attempt,
    success,
    mockPostId: providerResult?.mockPostId || null,
    mockPostUrl: providerResult?.mockPostUrl || null,
    failureReason: success
      ? null
      : normalizeFailureReason(providerResult?.failureReason || fallbackError?.message),
    failureIsRetriable: success ? false : Boolean(providerResult?.failureIsRetriable),
    providerError: !success && Boolean(fallbackError),
  };
}

export async function runMockPublishAttempt(attempt, publishRequestId) {
  try {
    const providerResult = await publishPost(attempt.postId, attempt.accountId, {
      userId: attempt.userId || null,
      organizationId: attempt.organizationId || null,
      publishRequestId,
    });
    return normalizeAttemptResult(attempt, providerResult);
  } catch (error) {
    return normalizeAttemptResult(attempt, null, error);
  }
}

export async function executeMockPublishAttempts({
  attempts = [],
  source = 'publish',
  sessionId = null,
  publishRequestId = null,
  viewPath = null,
  viewLabel = null,
  accountsPath = null,
  accountsLabel = null,
}) {
  const resolvedPublishRequestId = publishRequestId || buildPublishRequestId({ sessionId, source });
  if (inFlightPublishRequests.has(resolvedPublishRequestId)) {
    return {
      attempts: [],
      summary: buildPublishSummary([]),
      publishRequestId: resolvedPublishRequestId,
    };
  }
  inFlightPublishRequests.add(resolvedPublishRequestId);

  const results = [];
  try {
    for (const attempt of attempts) {
      // Sequential attempts keep the UI/event order deterministic and simplify retry semantics.
      // eslint-disable-next-line no-await-in-loop
      results.push(await runMockPublishAttempt(attempt, resolvedPublishRequestId));
    }
  } finally {
    inFlightPublishRequests.delete(resolvedPublishRequestId);
  }

  const summary = buildPublishSummary(results);
  emitMockPublishComplete({
    source,
    publishRequestId: resolvedPublishRequestId,
    occurredAt: new Date().toISOString(),
    viewPath,
    viewLabel,
    accountsPath,
    accountsLabel,
    attempts: results,
    summary,
  });

  return {
    attempts: results,
    summary,
    publishRequestId: resolvedPublishRequestId,
  };
}
