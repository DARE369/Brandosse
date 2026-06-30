import React from 'react';
import { AlertTriangle, Pencil, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import PlatformIcon from '../../../components/Shared/PlatformIcon';

const DEFAULT_PLATFORM_ACCENT = 'var(--color-primary)';

function formatRelativeDate(value) {
  if (!value) return 'Recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getHealthTone(account) {
  const score = Number(account?.health_score || 0);
  if (score <= 40) return 'critical';
  if (score <= 70) return 'warning';
  return 'healthy';
}

export default function ConnectedAccountCard({
  account,
  platform,
  onViewHealth,
  onReconnect,
  onEdit,
  onRemove,
}) {
  const tone = getHealthTone(account);
  const statusLabel = account.semantic_status === 'connected'
    ? 'Connected'
    : account.semantic_status === 'disconnected'
      ? 'Disconnected'
      : account.semantic_status.charAt(0).toUpperCase() + account.semantic_status.slice(1);

  return (
    <article className={`connected-account-card tone-${tone}`.trim()}>
      <div className="connected-account-card-accent" style={{ backgroundColor: platform?.brand_color || DEFAULT_PLATFORM_ACCENT }} />

      <div className="connected-account-card-main">
        <div className="connected-account-card-meta">
          <span className="connected-account-card-platform">
            <PlatformIcon platform={account.platform} size="sm" />
          </span>
          <div>
            <div className="connected-account-card-title">
              <strong>{account.display_name || account.account_name}</strong>
              <span>@{account.username}</span>
            </div>
            <div className="connected-account-card-subtitle">
              <span>{platform?.display_name || account.platform}</span>
              <span>{account.profile_type || 'Business'}</span>
              <span>Connected {formatRelativeDate(account.created_at)}</span>
            </div>
          </div>
        </div>

        <div className="connected-account-card-health">
          <div className={`connected-account-healthbar tone-${tone}`.trim()}>
            <span style={{ width: `${Math.max(0, Math.min(100, Number(account.health_score || 0)))}%` }} />
          </div>
          <small>{Number(account.health_score || 0)}% health</small>
        </div>

        <div className={`connected-account-status tone-${tone}`.trim()}>
          {Number(account.consecutive_failure_count || 0) > 0 ? <AlertTriangle size={12} /> : <ShieldCheck size={12} />}
          <span>{statusLabel}</span>
        </div>
      </div>

      <div className="connected-account-card-actions">
        <button type="button" onClick={() => onViewHealth?.(account)}>
          Health
        </button>
        <button type="button" onClick={() => onReconnect?.(account)}>
          <RefreshCw size={14} />
          Reconnect
        </button>
        <button type="button" onClick={() => onEdit?.(account)}>
          <Pencil size={14} />
          Edit
        </button>
        <button type="button" className="danger" onClick={() => onRemove?.(account)}>
          <Trash2 size={14} />
          Remove
        </button>
      </div>
    </article>
  );
}
