import React from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { POST_STATUS, POST_STATUS_LABELS } from '../../constants/statuses';

const STATUS_META = {
  [POST_STATUS.DRAFT]: { label: POST_STATUS_LABELS[POST_STATUS.DRAFT], icon: null },
  [POST_STATUS.SCHEDULED]: { label: POST_STATUS_LABELS[POST_STATUS.SCHEDULED], icon: null },
  [POST_STATUS.PUBLISHING]: { label: POST_STATUS_LABELS[POST_STATUS.PUBLISHING], icon: 'spinner' },
  [POST_STATUS.PUBLISHED]: { label: POST_STATUS_LABELS[POST_STATUS.PUBLISHED], icon: 'check' },
  [POST_STATUS.FAILED]: { label: POST_STATUS_LABELS[POST_STATUS.FAILED], icon: 'alert' },
  [POST_STATUS.ARCHIVED]: { label: POST_STATUS_LABELS[POST_STATUS.ARCHIVED], icon: null },
};

function normalizeStatus(status) {
  const key = String(status || POST_STATUS.DRAFT).toLowerCase();
  return STATUS_META[key] ? key : POST_STATUS.DRAFT;
}

export default function StatusBadge({
  status,
  size = 'md',
  dotOnly = false,
  className = '',
  ariaLabel,
}) {
  const normalized = normalizeStatus(status);
  const meta = STATUS_META[normalized];

  if (dotOnly) {
    return (
      <span
        className={`status-dot status-${normalized} ${className}`.trim()}
        role="status"
        aria-label={ariaLabel || `Status: ${meta.label}`}
        title={meta.label}
      />
    );
  }

  let iconNode = null;
  if (meta.icon === 'spinner') iconNode = <Loader2 size={10} className="status-icon-spin" />;
  if (meta.icon === 'check') iconNode = <Check size={10} />;
  if (meta.icon === 'alert') iconNode = <AlertTriangle size={10} />;

  return (
    <span
      className={`status-badge-ui status-${normalized} size-${size} ${className}`.trim()}
      role="status"
      aria-label={ariaLabel || `Status: ${meta.label}`}
    >
      <span className="status-dot-inline" />
      {iconNode}
      <span>{meta.label}</span>
    </span>
  );
}
