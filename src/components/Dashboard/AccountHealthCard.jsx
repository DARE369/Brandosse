import React, { useMemo } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Link2, WifiOff } from 'lucide-react';
import { getConnectedAccountSemanticStatus, normalizeConnectedAccountRow } from '../../services/platforms/platformUtils';
function formatRelativeDate(value) {
  if (!value) return 'No successful publishes yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No successful publishes yet';
  return `Last publish ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function getIssueLabel(account) {
  const semanticStatus = getConnectedAccountSemanticStatus(account.connection_status);
  if (semanticStatus === 'expired') return 'Expired';
  if (semanticStatus === 'error') return account.last_failure_reason || 'Publish failures';
  if (Number(account.consecutive_failure_count || 0) > 0) {
    return `${Number(account.consecutive_failure_count)} failure${Number(account.consecutive_failure_count) === 1 ? '' : 's'}`;
  }
  return 'Needs attention';
}

export default function AccountHealthCard({
  accounts = [],
  loading = false,
  onManage,
}) {
  const normalizedAccounts = useMemo(
    () => accounts.map(normalizeConnectedAccountRow).filter((account) => account && account.semantic_status !== 'disconnected'),
    [accounts],
  );

  const summary = useMemo(() => {
    const issues = normalizedAccounts.filter((account) => {
      const semanticStatus = getConnectedAccountSemanticStatus(account.connection_status);
      return semanticStatus !== 'connected' || Number(account.consecutive_failure_count || 0) > 0;
    });
    const lastPublishAt = normalizedAccounts.reduce((latest, account) => {
      if (!account.last_successful_publish_at) return latest;
      if (!latest) return account.last_successful_publish_at;
      return new Date(account.last_successful_publish_at) > new Date(latest)
        ? account.last_successful_publish_at
        : latest;
    }, null);
    const hasCritical = issues.some((account) => {
      const semanticStatus = getConnectedAccountSemanticStatus(account.connection_status);
      return semanticStatus === 'error'
        || semanticStatus === 'expired'
        || Number(account.consecutive_failure_count || 0) >= 3
        || Number(account.health_score || 100) < 30;
    });

    return {
      issues,
      lastPublishAt,
      hasCritical,
    };
  }, [normalizedAccounts]);

  return (
    <article className={`health-widget-card ${summary.hasCritical ? 'is-critical' : summary.issues.length > 0 ? 'is-warning' : 'is-healthy'}`.trim()}>
      <div className="health-widget-header">
        <div>
          <span className="health-widget-kicker">Account Health</span>
          <h3>Connected account status</h3>
        </div>
        <button type="button" className="health-widget-action" onClick={onManage}>
          Manage
          <ArrowUpRight size={14} />
        </button>
      </div>

      {loading ? (
        <div className="health-widget-empty">Loading account health…</div>
      ) : normalizedAccounts.length === 0 ? (
        <div className="health-widget-empty">
          <WifiOff size={18} />
          <div>
            <strong>No accounts connected</strong>
            <p>Connect a mock account to test scheduling and publish workflows.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="health-widget-summary">
            <div className={`health-widget-pill ${summary.issues.length > 0 ? 'issue' : 'healthy'}`.trim()}>
              {summary.issues.length > 0 ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
              <span>
                {summary.issues.length > 0
                  ? `${summary.issues.length} account${summary.issues.length === 1 ? '' : 's'} need attention`
                  : 'All accounts healthy'}
              </span>
            </div>
            <small>{formatRelativeDate(summary.lastPublishAt)}</small>
          </div>

          <div className="health-widget-meta-row">
            <div>
              <span>Total connected</span>
              <strong>{normalizedAccounts.length}</strong>
            </div>
            <div>
              <span>Healthy</span>
              <strong>{normalizedAccounts.length - summary.issues.length}</strong>
            </div>
            <div>
              <span>Attention</span>
              <strong>{summary.issues.length}</strong>
            </div>
          </div>

          {summary.issues.length > 0 ? (
            <div className="health-widget-issues">
              {summary.issues.slice(0, 2).map((account) => (
                <div key={account.id} className="health-widget-issue-row">
                  <div>
                    <strong>{account.display_name || account.account_name || account.username || account.platform}</strong>
                    <span>{account.platform}</span>
                  </div>
                  <div className="health-widget-issue-copy">
                    <Link2 size={12} />
                    <span>{getIssueLabel(account)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}
