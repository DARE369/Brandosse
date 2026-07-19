import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Copy, ExternalLink, RefreshCw, X } from 'lucide-react';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import {
  MOCK_PUBLISH_COMPLETE_EVENT,
  buildPublishSummary,
  runMockPublishAttempt,
} from '../../services/platforms/mockPublishWorkflow';
import PostPreviewCard from './PostPreviewCard';
function getFailureCopy(reason) {
  switch (String(reason || '').trim().toLowerCase()) {
    case 'rate_limit_exceeded':
      return 'Too many posts were attempted in a short window. Wait a few minutes and retry.';
    case 'network_timeout':
      return 'A transient connection issue interrupted the publish. Retry should usually work.';
    case 'server_busy':
      return 'The mock provider was busy. Retry should usually work.';
    case 'invalid_media_type':
      return 'The selected media format is not valid for this platform.';
    case 'account_suspended':
      return 'This account is flagged as unavailable. Reconnect or replace the account before trying again.';
    case 'api_unavailable':
      return 'The platform is temporarily unavailable. Retry later.';
    case 'account_not_connected':
      return 'The selected account is no longer connected. Reconnect it before publishing.';
    default:
      return 'The publish attempt did not complete successfully.';
  }
}

function formatAttemptTitle(attempt) {
  const value = attempt?.platformDisplayName || attempt?.platformLabel || attempt?.platform || 'Platform';
  return String(value).trim().replace(/^./, (char) => char.toUpperCase());
}

function formatPostId(attempt) {
  return attempt?.mockPostId || 'Pending';
}

function formatPermalink(attempt) {
  return attempt?.mockPostUrl || '';
}

export default function MockPublishModal() {
  const { navigate } = useAppNavigation();
  const [payload, setPayload] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    function handlePublishComplete(event) {
      const detail = event?.detail;
      if (!detail?.attempts?.length) return;
      setPayload({
        ...detail,
        summary: detail.summary || buildPublishSummary(detail.attempts),
      });
      setActiveIndex(0);
      setRetrying(false);
    }

    window.addEventListener(MOCK_PUBLISH_COMPLETE_EVENT, handlePublishComplete);
    return () => window.removeEventListener(MOCK_PUBLISH_COMPLETE_EVENT, handlePublishComplete);
  }, []);

  const attempts = payload?.attempts || [];
  const activeAttempt = attempts[activeIndex] || null;
  const summary = payload?.summary || buildPublishSummary(attempts);

  const headerTitle = useMemo(() => {
    if (!activeAttempt) return 'Publish Result';
    if (summary.total > 1) return 'Publish Results';
    return activeAttempt.success ? 'Post Published' : 'Publish Failed';
  }, [activeAttempt, summary.total]);

  if (!activeAttempt) return null;

  const handleClose = () => {
    setPayload(null);
    setActiveIndex(0);
    setRetrying(false);
  };

  const handleCopy = async (value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch (_error) {
      // Intentionally silent: clipboard APIs fail in some browser contexts.
    }
  };

  const handleRetry = async () => {
    if (!activeAttempt) return;
    setRetrying(true);
    const nextAttempt = await runMockPublishAttempt(activeAttempt);
    setPayload((current) => {
      if (!current) return current;
      const nextAttempts = [...(current.attempts || [])];
      nextAttempts[activeIndex] = nextAttempt;
      return {
        ...current,
        attempts: nextAttempts,
        summary: buildPublishSummary(nextAttempts),
      };
    });
    window.dispatchEvent(new CustomEvent('socialai:data-sync', {
      detail: { reason: 'publish-retry', at: new Date().toISOString() },
    }));
    setRetrying(false);
  };

  return (
    <div className="mock-publish-modal-shell" role="dialog" aria-modal="true" aria-label={headerTitle}>
      <button type="button" className="mock-publish-modal-backdrop" aria-label="Close publish result" onClick={handleClose} />
      <section className="mock-publish-modal">
        <header className="mock-publish-modal-header">
          <div className="mock-publish-modal-title">
            {activeAttempt.success ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
            <div>
              <h3>{headerTitle}</h3>
              <p>{summary.message}</p>
            </div>
          </div>

          <button type="button" className="mock-publish-icon-button" onClick={handleClose} aria-label="Close publish result">
            <X size={16} />
          </button>
        </header>

        {attempts.length > 1 ? (
          <div className="mock-publish-attempt-tabs" role="tablist" aria-label="Publish attempts">
            {attempts.map((attempt, index) => (
              <button
                key={`${attempt.postId}-${attempt.accountId}`}
                type="button"
                className={index === activeIndex ? 'active' : ''}
                onClick={() => setActiveIndex(index)}
                role="tab"
                aria-selected={index === activeIndex}
              >
                <span>{formatAttemptTitle(attempt)}</span>
                <small>{attempt.success ? 'Success' : 'Failed'}</small>
              </button>
            ))}
          </div>
        ) : null}

        <div className="mock-publish-modal-body">
          <PostPreviewCard attempt={activeAttempt} />

          <section className="mock-publish-modal-details">
            {activeAttempt.success && activeAttempt.note ? (
              <div className="mock-publish-error-card" style={{ background: 'var(--uiv2-warning-wash, inherit)' }}>
                <p style={{ margin: 0 }}>{activeAttempt.note}</p>
              </div>
            ) : null}
            {!activeAttempt.success ? (
              <div className="mock-publish-error-card">
                <code>
                  Error: {activeAttempt.failureReason}
                  {'\n'}Platform: {formatAttemptTitle(activeAttempt)}
                  {'\n'}Account: @{activeAttempt.accountUsername || 'socialai'}
                  {'\n'}Retriable: {activeAttempt.failureIsRetriable ? 'Yes' : 'No'}
                </code>
                <p>{getFailureCopy(activeAttempt.failureReason)}</p>
              </div>
            ) : null}

            <div className="mock-publish-info-grid">
              <article>
                <span>Published to</span>
                <strong>{formatAttemptTitle(activeAttempt)} | @{activeAttempt.accountUsername || 'socialai'}</strong>
              </article>
              <article>
                <span>Post ID</span>
                <strong>{formatPostId(activeAttempt)}</strong>
                {activeAttempt.mockPostId ? (
                  <button type="button" onClick={() => handleCopy(activeAttempt.mockPostId)}>
                    <Copy size={14} />
                    Copy
                  </button>
                ) : null}
              </article>
              <article>
                <span>Permalink</span>
                <strong>{formatPermalink(activeAttempt) || 'Unavailable'}</strong>
                {activeAttempt.mockPostUrl ? (
                  <a href={activeAttempt.mockPostUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} />
                    Open
                  </a>
                ) : null}
              </article>
            </div>
          </section>
        </div>

        <footer className="mock-publish-modal-footer">
          {activeAttempt.success ? (
            <>
              {payload?.viewPath ? (
                <button type="button" className="mock-publish-secondary" onClick={() => navigate(payload.viewPath)}>
                  {payload.viewLabel || 'View Results'}
                </button>
              ) : null}
              <button type="button" className="mock-publish-primary" onClick={handleClose}>
                Done
              </button>
            </>
          ) : (
            <>
              {activeAttempt.failureIsRetriable ? (
                <button type="button" className="mock-publish-primary" disabled={retrying} onClick={handleRetry}>
                  <RefreshCw size={14} />
                  {retrying ? 'Retrying...' : 'Retry Now'}
                </button>
              ) : (
                <button type="button" className="mock-publish-secondary" onClick={handleClose}>
                  Close
                </button>
              )}

              {(activeAttempt.settingsPath || payload?.accountsPath) ? (
                <button
                  type="button"
                  className="mock-publish-secondary"
                  onClick={() => navigate(activeAttempt.settingsPath || payload.accountsPath)}
                >
                  <ArrowUpRight size={14} />
                  {payload?.accountsLabel || 'Open Connected Accounts'}
                </button>
              ) : null}
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
