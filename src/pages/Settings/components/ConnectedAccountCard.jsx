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

/**
 * Turn the row into the ONE status the card shows.
 *
 * ── Why this replaces the old health_score check ────────────────────────────
 * This card used to pick its colour from `health_score` alone and its label
 * from `connection_status` alone. Both are blind to whether publishing can
 * actually work, so an account with a perfect score of 100 rendered a green
 * "Connected" even when it could not publish at all.
 *
 * `can_publish` and `publish_block_reason` are computed once in
 * connected_accounts_health_summary precisely so no component has to guess —
 * and this component was not reading either of them. That is the same
 * disconnection defect the view was created to end: the data existed and
 * nothing consumed it.
 *
 * Capability is checked FIRST, because it outranks everything else. An account
 * that cannot publish is not "Connected", whatever its score says.
 */
function getAccountStatus(account) {
  const reason = account?.publish_block_reason || null;

  // An unrecognised block reason must never fall through to "Connected".
  // A fail-open default in UI is what produced the original bug.
  const BLOCKED = {
    provider_missing: {
      label: 'Action needed',
      detail: 'This account has no publishing method. Reconnect it.',
    },
    provider_unknown: {
      label: 'Action needed',
      detail: 'We do not recognise how this account publishes. Reconnect it.',
    },
    provider_unsupported: {
      label: 'Not yet supported',
      detail: 'Publishing for this platform is not switched on yet.',
    },
    credential_missing: {
      label: 'Reconnect needed',
      detail: 'We no longer hold a sign-in for this account.',
    },
    credential_expired: {
      label: 'Reconnect needed',
      detail: 'The sign-in for this account has expired.',
    },
  };

  if (account?.can_publish === false) {
    const known = reason ? BLOCKED[reason] : null;
    return {
      tone: reason === 'provider_unsupported' ? 'warning' : 'danger',
      label: known?.label || 'Action needed',
      // Show the raw reason when we have no copy for it, rather than hiding it.
      detail: known?.detail || (reason ? `Cannot publish (${reason}).` : 'This account cannot publish.'),
      canPublish: false,
    };
  }

  if (account?.semantic_status === 'disconnected') {
    return { tone: 'danger', label: 'Disconnected', detail: null, canPublish: false };
  }

  if (account?.credential_expiring_soon) {
    return {
      tone: 'warning',
      label: 'Expiring soon',
      // LinkedIn issues no refresh token, so this is a genuine deadline rather
      // than a nag: publishing stops on that date until the user reconnects.
      detail: 'Reconnect soon to keep publishing without interruption.',
      canPublish: true,
    };
  }

  if (Number(account?.consecutive_failure_count || 0) >= 3) {
    return {
      tone: 'warning',
      label: 'Publishing paused',
      detail: account?.last_failure_reason || 'Several posts failed in a row.',
      canPublish: true,
    };
  }

  if (account?.is_mock) {
    return { tone: 'warning', label: 'Demo account', detail: 'Posts are simulated, not published.', canPublish: true };
  }

  return { tone: 'success', label: 'Connected', detail: null, canPublish: true };
}

export default function ConnectedAccountCard({ account, platform, onViewHealth, onReconnect, onEdit, onRemove }) {
  const status = getAccountStatus(account);
  const tone = status.tone;
  const statusLabel = status.label;
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
        {/* The cause, in words. A status chip alone tells someone something is
            wrong without telling them what to do about it. */}
        {status.detail ? (
          <p className={styles.statusDetail}>{status.detail}</p>
        ) : null}
      </div>

      {/*
        The health bar is suppressed when the account cannot publish.
        A "100% health" bar sitting beside "Reconnect needed" is a direct
        contradiction, and the score is the less true of the two: health_score
        tracks recent publish failures, so an account that has never managed to
        publish at all still reads 100.
      */}
      {status.canPublish ? (
        <div className={styles.healthCol}>
          <div className={styles.healthTrack}>
            <div className={styles.healthFill} style={{ width: `${health}%`, background: `var(--uiv2-${tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : 'danger'})` }} />
          </div>
          <span className={styles.healthLabel}>{health}% health</span>
        </div>
      ) : (
        <div className={styles.healthCol} aria-hidden="true" />
      )}

      <Badge tone={tone}>
        {tone === 'success'
          ? <ShieldCheck size={12} aria-hidden="true" />
          : <AlertTriangle size={12} aria-hidden="true" />}
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
