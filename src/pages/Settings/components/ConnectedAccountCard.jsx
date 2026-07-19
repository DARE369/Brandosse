import React from 'react';
import { AlertTriangle, Pencil, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import PlatformIcon from '../../../components/Shared/PlatformIcon';
import { Badge, Button, IconButton } from '../../../ui-v2';
import styles from './ConnectedAccountCard.module.css';

function formatRelativeDate(value) {
  if (!value) return 'Recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function getHealthTone(account) {
  const score = Number(account?.health_score || 0);
  if (score <= 40) return 'danger';
  if (score <= 70) return 'warning';
  return 'success';
}

export default function ConnectedAccountCard({ account, platform, onViewHealth, onReconnect, onEdit, onRemove }) {
  const tone = getHealthTone(account);
  const statusLabel = account.semantic_status === 'connected'
    ? 'Connected'
    : account.semantic_status === 'disconnected'
      ? 'Disconnected'
      : account.semantic_status.charAt(0).toUpperCase() + account.semantic_status.slice(1);
  const health = Math.max(0, Math.min(100, Number(account.health_score || 0)));

  return (
    <article className={styles.card}>
      <span className={styles.iconWrap} style={{ '--tile-accent': platform?.brand_color }}>
        <PlatformIcon platform={account.platform} size="md" />
      </span>

      <div className={styles.main}>
        <div className={styles.titleRow}>
          <strong className={styles.name}>{account.display_name || account.account_name}</strong>
          <span className={styles.handle}>@{account.username}</span>
        </div>
        <div className={styles.metaRow}>
          <span>{platform?.display_name || account.platform}</span>
          <span>{account.profile_type || 'Business'}</span>
          <span>Connected {formatRelativeDate(account.created_at)}</span>
        </div>
      </div>

      <div className={styles.healthCol}>
        <div className={styles.healthTrack}>
          <div className={styles.healthFill} style={{ width: `${health}%`, background: `var(--uiv2-${tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : 'danger'})` }} />
        </div>
        <span className={styles.healthLabel}>{health}% health</span>
      </div>

      <Badge tone={tone}>
        {Number(account.consecutive_failure_count || 0) > 0 ? <AlertTriangle size={12} aria-hidden="true" /> : <ShieldCheck size={12} aria-hidden="true" />}
        {statusLabel}
      </Badge>

      <div className={styles.actions}>
        <Button variant="ghost" size="sm" onClick={() => onViewHealth?.(account)}>Health</Button>
        <IconButton title="Reconnect" onClick={() => onReconnect?.(account)}><RefreshCw size={14} /></IconButton>
        <IconButton title="Edit" onClick={() => onEdit?.(account)}><Pencil size={14} /></IconButton>
        <IconButton title="Remove" onClick={() => onRemove?.(account)} className={styles.dangerBtn}><Trash2 size={14} /></IconButton>
      </div>
    </article>
  );
}
