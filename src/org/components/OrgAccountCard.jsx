import React from 'react';
import {
  AlertTriangle,
  LockKeyhole,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import PlatformIcon from '../../components/Shared/PlatformIcon';

const DEFAULT_PLATFORM_ACCENT = 'var(--color-primary)';

function formatRelativeDate(value) {
  if (!value) return 'No publish activity yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No publish activity yet';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getHealthTone(account) {
  const score = Number(account?.health_score || 0);
  if (score <= 40) return 'critical';
  if (score <= 70) return 'warning';
  return 'healthy';
}

function getStatusLabel(account) {
  if (account.semantic_status === 'connected') return 'Connected';
  if (account.semantic_status === 'disconnected') return 'Disconnected';
  return `${account.semantic_status.charAt(0).toUpperCase()}${account.semantic_status.slice(1)}`;
}

export default function OrgAccountCard({
  account,
  platform,
  activity,
  eligiblePublisherCount = 0,
  onManageAccess,
  onViewHealth,
  onReconnect,
  onEdit,
  onRemove,
}) {
  const tone = getHealthTone(account);
  const grantedCount = Array.isArray(account.granted_member_ids) ? account.granted_member_ids.filter(Boolean).length : 0;
  const accessLabel = grantedCount > 0
    ? `${grantedCount} specific member${grantedCount === 1 ? '' : 's'} granted`
    : `${eligiblePublisherCount} publish-enabled member${eligiblePublisherCount === 1 ? '' : 's'} can post`;

  return (
    <article className={`org-connected-account-card tone-${tone}`.trim()}>
      <div className="org-connected-account-accent" style={{ backgroundColor: platform?.brand_color || DEFAULT_PLATFORM_ACCENT }} />

      <div className="org-connected-account-body">
        <div className="org-connected-account-main">
          <div className="org-connected-account-meta">
            <span className="org-connected-account-platform">
              <PlatformIcon platform={account.platform} size="sm" />
            </span>
            <div>
              <div className="org-connected-account-title">
                <strong>{account.display_name || account.account_name || account.username || account.platform}</strong>
                {account.username ? <span>@{account.username}</span> : null}
              </div>
              <div className="org-connected-account-subtitle">
                <span>{platform?.display_name || account.platform}</span>
                <span>{account.profile_type || 'Business'}</span>
                <span>{getStatusLabel(account)}</span>
              </div>
              <p className="org-connected-account-history">
                Last published by <strong>{activity?.lastPublishedBy || 'No publisher yet'}</strong> · {formatRelativeDate(activity?.lastPublishedAt)}
              </p>
            </div>
          </div>

          <div className="org-connected-account-health">
            <div className={`connected-account-healthbar tone-${tone}`.trim()}>
              <span style={{ width: `${Math.max(0, Math.min(100, Number(account.health_score || 0)))}%` }} />
            </div>
            <small>{Number(account.health_score || 0)}% health</small>
          </div>

          <div className={`connected-account-status tone-${tone}`.trim()}>
            {Number(account.consecutive_failure_count || 0) > 0 ? <AlertTriangle size={12} /> : <ShieldCheck size={12} />}
            <span>{getStatusLabel(account)}</span>
          </div>
        </div>

        <div className="org-connected-account-access">
          <div>
            <span>Posting access</span>
            <strong>{accessLabel}</strong>
          </div>
          <button type="button" className="org-secondary-button" onClick={() => onManageAccess?.(account)}>
            <LockKeyhole size={14} />
            Manage Access
          </button>
        </div>

        <div className="org-connected-account-actions">
          <button type="button" onClick={() => onViewHealth?.(account)}>Health</button>
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
      </div>
    </article>
  );
}
