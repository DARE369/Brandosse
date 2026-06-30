import React, { useEffect, useState } from 'react';
import { AlertTriangle, ShieldCheck, X } from 'lucide-react';
import PlatformIcon from '../../../components/Shared/PlatformIcon';
import { getAccountHealth } from '../../../services/platforms/connectionService';

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function getScoreCopy(score) {
  if (score >= 80) return 'Healthy - performing normally.';
  if (score >= 50) return 'Degraded - some publish attempts have failed.';
  if (score >= 20) return 'Unstable - frequent failures detected.';
  return 'Critical - immediate reconnection recommended.';
}

export default function AccountHealthModal({
  accountId,
  open = false,
  onClose,
}) {
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!open || !accountId) return undefined;

    setLoading(true);
    setError('');
    getAccountHealth(accountId)
      .then((result) => {
        if (active) setHealth(result);
      })
      .catch((nextError) => {
        if (active) setError(nextError?.message || 'Could not load account health.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [accountId, open]);

  if (!open) return null;

  const account = health?.account || null;
  const events = Array.isArray(health?.events) ? health.events : [];
  const score = Number(account?.health_score || 0);

  return (
    <div className="connected-account-modal-shell" role="dialog" aria-modal="true" aria-label="Connected account health">
      <button type="button" className="connected-account-modal-backdrop" onClick={onClose} aria-label="Close health details" />
      <section className="connected-account-modal">
        <header className="connected-account-modal-header">
          <div>
            <span className="connected-account-modal-kicker">Account Health</span>
            <h3>{account?.display_name || account?.account_name || 'Connected account'}</h3>
          </div>
          <button type="button" className="connected-account-icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {loading ? <div className="connected-account-modal-empty">Loading health details...</div> : null}
        {!loading && error ? <div className="connected-account-modal-empty error">{error}</div> : null}

        {!loading && !error && account ? (
          <div className="connected-account-health-layout">
            <section className="connected-account-health-overview">
              <div className="connected-account-health-ring" style={{ '--health-score': score }}>
                <div className="connected-account-health-ring-core">
                  <PlatformIcon platform={account.platform} size="sm" />
                  <strong>{score}</strong>
                  <span>Health</span>
                </div>
              </div>

              <div className="connected-account-health-copy">
                <div className="connected-account-health-copy-row">
                  {score >= 50 ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />}
                  <span>{getScoreCopy(score)}</span>
                </div>
                <p>{account.platform_display_name || account.platform} | @{account.username}</p>
              </div>
            </section>

            <section className="connected-account-health-stats">
              <div>
                <span>Total Published</span>
                <strong>{Number(account.total_posts_published || 0)}</strong>
              </div>
              <div>
                <span>Total Scheduled</span>
                <strong>{Number(account.total_posts_scheduled || 0)}</strong>
              </div>
              <div>
                <span>Last Success</span>
                <strong>{formatDateTime(account.last_successful_publish_at)}</strong>
              </div>
              <div>
                <span>Last Failure</span>
                <strong>{formatDateTime(account.last_failure_at)}</strong>
              </div>
            </section>

            <section className="connected-account-health-events">
              <div className="connected-account-section-heading">
                <h4>Recent Events</h4>
              </div>
              {events.length === 0 ? (
                <div className="connected-account-modal-empty">No recent connection events yet.</div>
              ) : (
                <div className="connected-account-event-list">
                  {events.map((event) => (
                    <article key={event.id} className={`connected-account-event tone-${event.severity || 'info'}`.trim()}>
                      <div>
                        <strong>{event.event_type.replace(/_/g, ' ')}</strong>
                        <p>{event.message || 'No additional details.'}</p>
                      </div>
                      <div>
                        <span>{formatDateTime(event.created_at)}</span>
                        {event.is_simulated_failure ? <small>Simulated</small> : null}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </section>
    </div>
  );
}
