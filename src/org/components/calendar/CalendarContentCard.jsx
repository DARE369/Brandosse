import React from 'react';

function getPlatformLabel(platform) {
  const normalized = String(platform || '').trim().toLowerCase();
  switch (normalized) {
    case 'instagram':
      return 'IG';
    case 'facebook':
      return 'FB';
    case 'linkedin':
      return 'LI';
    case 'youtube':
      return 'YT';
    case 'tiktok':
      return 'TT';
    case 'twitter':
    case 'x':
      return 'X';
    default:
      return normalized ? normalized.slice(0, 2).toUpperCase() : 'NA';
  }
}

function getInitials(value) {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) return 'NA';
  return parts.map((part) => part[0]).join('').toUpperCase();
}

function getPreviewText(record) {
  return String(record?.previewText || '').trim();
}

function getSafeTitle(record) {
  return String(record?.title || 'Untitled content').trim() || 'Untitled content';
}

export default function CalendarContentCard({
  record,
  variant = 'ops',
  className = '',
  onClick,
  disabled = false,
}) {
  if (!record) return null;

  const previewText = getPreviewText(record);
  const safeTitle = getSafeTitle(record);

  return (
    <button
      type="button"
      className={`org-calendar-card ${variant} tone-${record.tone || 'draft'} ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
    >
      {variant === 'compact' ? (
        <>
          <span className={`org-calendar-card-dot tone-${record.tone || 'draft'}`} />
          <span className="org-calendar-card-title" title={safeTitle}>{safeTitle}</span>
        </>
      ) : variant === 'week' ? (
        <>
          <div className="org-calendar-card-top">
            <span className="org-calendar-card-title" title={safeTitle}>{safeTitle}</span>
            <span className="org-calendar-card-platform">{getPlatformLabel(record.platform)}</span>
          </div>
          <div className="org-calendar-card-bottom week">
            {record.scheduleLabel ? (
              <span className="org-calendar-card-meta">{record.scheduleLabel}</span>
            ) : (
              <span className="org-calendar-card-meta">{record.statusLabel || 'Draft'}</span>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="org-calendar-card-top">
            <span className="org-calendar-card-title">{safeTitle}</span>
            <span className="org-calendar-card-platform">{getPlatformLabel(record.platform)}</span>
          </div>

          <div className="org-calendar-card-body">
            {previewText ? (
              <p className="org-calendar-card-preview">{previewText}</p>
            ) : (
              <div className="org-calendar-card-preview placeholder">No content summary yet.</div>
            )}
          </div>

          <div className="org-calendar-card-bottom">
            {record.contentTypeLabel ? (
              <span className="org-calendar-card-tag">{record.contentTypeLabel}</span>
            ) : null}

            {record.accountScopeLabel ? (
              <span className={`org-calendar-card-tag scope-${String(record.accountScope || '').trim().toLowerCase() || 'default'}`.trim()}>
                {record.accountScopeLabel}
              </span>
            ) : null}

            {record.assigneeLabel ? (
              <span className="org-calendar-card-avatar" title={record.assigneeLabel}>
                {getInitials(record.assigneeLabel)}
              </span>
            ) : null}

            {record.slaLabel ? (
              <span className={`org-calendar-card-sla tone-${record.slaTone || 'scheduled'}`}>
                {record.slaLabel}
              </span>
            ) : null}

            {record.scheduleLabel ? (
              <span className="org-calendar-card-meta">{record.scheduleLabel}</span>
            ) : null}

            {variant === 'queue-preview' && record.ageLabel ? (
              <span className="org-calendar-card-meta">{record.ageLabel}</span>
            ) : null}
          </div>
        </>
      )}
    </button>
  );
}
