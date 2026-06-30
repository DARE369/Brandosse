import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  PencilLine,
} from 'lucide-react';
import PostPreview from './PostPreview';
import SchedulePicker from './SchedulePicker';

function getInitials(value) {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) return '?';
  return parts.map((part) => part[0]).join('').toUpperCase();
}

function formatDateTime(value) {
  if (!value) return 'Not scheduled';
  const nextDate = new Date(value);
  if (Number.isNaN(nextDate.getTime())) return 'Invalid date';
  return nextDate.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildProgressModel(record) {
  if (record?.pipelineItemId) {
    const steps = ['Draft', 'Review', 'Approved', 'Published'];
    const status = String(record?.lifecycleStatus || '').trim();

    if (status === 'published') {
      return { label: 'Pipeline', steps, activeIndex: 3, tone: 'published' };
    }
    if (status === 'scheduled') {
      return { label: 'Pipeline', steps, activeIndex: 3, tone: 'scheduled' };
    }
    if (status === 'approved') {
      return { label: 'Pipeline', steps, activeIndex: 2, tone: 'approved' };
    }
    if (status === 'in_review' || status === 'revision_requested') {
      return { label: 'Pipeline', steps, activeIndex: 1, tone: status === 'revision_requested' ? 'blocked' : 'review' };
    }
    return { label: 'Pipeline', steps, activeIndex: 0, tone: 'draft' };
  }

  const steps = ['Draft', 'Scheduled', 'Published'];
  const status = String(record?.lifecycleStatus || '').trim();

  if (status === 'published') {
    return { label: 'Lifecycle', steps, activeIndex: 2, tone: 'published' };
  }
  if (status === 'scheduled') {
    return { label: 'Lifecycle', steps, activeIndex: 1, tone: 'scheduled' };
  }
  return { label: 'Lifecycle', steps, activeIndex: 0, tone: 'draft' };
}

function ProgressTrack({ record }) {
  const progress = buildProgressModel(record);

  return (
    <section className="org-calendar-detail-section">
      <div className="org-calendar-section-head">
        <div>
          <span className="org-calendar-section-eyebrow">{progress.label}</span>
          <h4>{record.pipelineItemId ? 'Current approval path' : 'Post state'}</h4>
        </div>
        {record.lifecycleStatus === 'scheduled' && record.scheduledAt ? (
          <span className="org-calendar-detail-chip scheduled">{formatDateTime(record.scheduledAt)}</span>
        ) : null}
      </div>

      <div className={`org-calendar-progress ${progress.steps.length === 3 ? 'compact' : ''}`.trim()}>
        {progress.steps.map((step, index) => {
          const done = index < progress.activeIndex;
          const active = index === progress.activeIndex;

          return (
            <React.Fragment key={step}>
              <div className="org-calendar-progress-step">
                <span className={`org-calendar-progress-dot ${done ? 'done' : ''} ${active ? `active tone-${progress.tone}` : ''}`.trim()} />
                <span className={`org-calendar-progress-label ${done ? 'done' : ''} ${active ? `active tone-${progress.tone}` : ''}`.trim()}>
                  {step}
                </span>
              </div>
              {index < progress.steps.length - 1 ? (
                <span className={`org-calendar-progress-line ${index < progress.activeIndex ? 'done' : ''}`.trim()} />
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    </section>
  );
}

export default function CalendarDetailDrawer({
  record,
  onClose,
  scheduleValue,
  onScheduleValueChange,
  reviewComment,
  onReviewCommentChange,
  onSaveSchedule,
  onApprove,
  onRequestChanges,
  onPublishNow,
  onOpenPipeline,
  saving,
  canPublish,
}) {
  const [schedulePickerOpen, setSchedulePickerOpen] = useState(false);

  useEffect(() => {
    setSchedulePickerOpen(false);
  }, [record?.id]);

  if (!record) return null;

  const canEditSchedule = Boolean(record.canScheduleAction && !record.isPastLocked);
  const canTriggerPublish = Boolean(canPublish && record.canPublishAction);
  const showPlatformWarning = !record.platform || record.platform === 'unknown';
  const scheduleLabel = record.scheduleLabel || 'Not scheduled';
  const reviewerLabel = record.assigneeLabel || 'Unassigned';
  const reviewSectionVisible = Boolean(
    record.pipelineItemId
    && record.canReviewAction
    && ['draft', 'in_review', 'revision_requested'].includes(record.lifecycleStatus),
  );
  const actionSectionVisible = canEditSchedule || canTriggerPublish;
  const confirmLabel = record.scheduledAt ? 'Update schedule' : 'Confirm schedule';

  const handleScheduleConfirm = async (nextValue) => {
    onScheduleValueChange(nextValue);
    const success = await onSaveSchedule?.(nextValue);
    if (success) {
      setSchedulePickerOpen(false);
    }
  };

  return (
    <aside className="org-calendar-drawer">
      <div className="org-calendar-drawer-header">
        <div className="org-calendar-detail-hero">
          <span className={`org-calendar-status-chip tone-${record.tone || 'draft'}`.trim()}>
            {record.statusLabel}
          </span>
          <h3>{record.title}</h3>
          <p>{record.platformLabel} | {record.ownerName}</p>
        </div>
        <button type="button" className="org-text-button" onClick={onClose}>Close</button>
      </div>

      <div className="org-calendar-drawer-body">
        {showPlatformWarning ? (
          <div className="org-calendar-warning-bar">
            <div className="org-calendar-warning-copy">
              <span className="org-calendar-warning-icon">
                <AlertTriangle size={14} />
              </span>
              <div>
                <strong>No platform detected</strong>
                <p>This post may not publish until a destination platform is set.</p>
              </div>
            </div>
            {record.pipelineItemId ? (
              <button type="button" className="org-text-button" onClick={() => onOpenPipeline(record.pipelineItemId)}>
                Fix
              </button>
            ) : null}
          </div>
        ) : null}

        <PostPreview record={record} />

        <ProgressTrack record={record} />

        <section className="org-calendar-detail-section">
          <div className="org-calendar-detail-grid">
            <div className="org-calendar-detail-block">
              <span>Owner</span>
              <strong>{record.ownerName}</strong>
            </div>
            <div className="org-calendar-detail-block">
              <span>Platform</span>
              <strong>{record.platformLabel}</strong>
            </div>
            <div className="org-calendar-detail-block">
              <span>Stage</span>
              <strong>{record.stageLabel || 'No active stage'}</strong>
            </div>
            <div className="org-calendar-detail-block">
              <span>Schedule</span>
              {canEditSchedule ? (
                <button
                  type="button"
                  className="org-calendar-inline-edit"
                  onClick={() => setSchedulePickerOpen((current) => !current)}
                  disabled={saving}
                >
                  <span>{scheduleLabel}</span>
                  <span className="org-calendar-inline-edit-hint">
                    <PencilLine size={12} />
                    Edit
                  </span>
                </button>
              ) : (
                <strong>{scheduleLabel}</strong>
              )}
            </div>
            <div className="org-calendar-detail-block">
              <span>Created</span>
              <strong>{formatDateTime(record.createdAt)}</strong>
            </div>
            <div className="org-calendar-detail-block">
              <span>Reviewer</span>
              <div className="org-calendar-reviewer-chip">
                <span className="org-calendar-reviewer-avatar">{getInitials(reviewerLabel)}</span>
                <strong>{reviewerLabel}</strong>
              </div>
            </div>
          </div>

          {record.isPastLocked ? (
            <div className="org-calendar-inline-hint locked">
              <Clock3 size={14} />
              Past dates are locked for this record.
            </div>
          ) : null}
        </section>

        {schedulePickerOpen && canEditSchedule ? (
          <SchedulePicker
            value={scheduleValue}
            saving={saving}
            onCancel={() => setSchedulePickerOpen(false)}
            onConfirm={handleScheduleConfirm}
            confirmLabel={confirmLabel}
          />
        ) : null}

        {record.rawPipelineItem?.submission_note ? (
          <div className="org-calendar-detail-note">{record.rawPipelineItem.submission_note}</div>
        ) : null}

        {record.attachedAssets?.length ? (
          <section className="org-calendar-detail-section">
            <div className="org-calendar-section-head">
              <div>
                <span className="org-calendar-section-eyebrow">Linked Assets</span>
                <h4>{record.attachedAssets.length} saved asset{record.attachedAssets.length === 1 ? '' : 's'}</h4>
              </div>
            </div>

            <div className="org-calendar-linked-assets">
              {record.attachedAssets.map((asset) => (
                <article key={asset.id} className="org-calendar-linked-asset">
                  <strong>{asset.name}</strong>
                  <span>{asset.file_type || 'asset'} | {asset.folder_path || '/'}</span>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {reviewSectionVisible ? (
          <section className="org-calendar-detail-section">
            <div className="org-calendar-section-head">
              <div>
                <span className="org-calendar-section-eyebrow">Review Actions</span>
                <h4>Advance or return this item</h4>
              </div>
            </div>

            <label className="org-calendar-input-block">
              <span>Comment</span>
              <textarea
                rows={3}
                value={reviewComment}
                onChange={(event) => onReviewCommentChange(event.target.value)}
                placeholder="Add optional reviewer context."
                disabled={saving}
              />
            </label>

            <div className="org-calendar-detail-actions">
              <button type="button" className="org-calendar-detail-button danger" disabled={saving} onClick={onRequestChanges}>
                Request changes
              </button>
              <button type="button" className="org-calendar-detail-button primary" disabled={saving} onClick={onApprove}>
                <CheckCircle2 size={14} />
                Approve
              </button>
            </div>
          </section>
        ) : null}

        {actionSectionVisible ? (
          <section className="org-calendar-detail-section">
            <div className="org-calendar-section-head">
              <div>
                <span className="org-calendar-section-eyebrow">Actions</span>
                <h4>Move this record forward</h4>
              </div>
            </div>

            <div className="org-calendar-detail-actions">
              {canEditSchedule ? (
                <button
                  type="button"
                  className="org-calendar-detail-button primary"
                  disabled={saving}
                  onClick={() => setSchedulePickerOpen(true)}
                >
                  <CalendarDays size={14} />
                  {record.scheduledAt ? 'Update schedule' : 'Schedule'}
                </button>
              ) : null}

              {canTriggerPublish ? (
                <button type="button" className="org-calendar-detail-button success" disabled={saving} onClick={onPublishNow}>
                  <ArrowUpRight size={14} />
                  Publish now
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        {record.pipelineItemId ? (
          <div className="org-calendar-drawer-actions">
            <button type="button" className="org-text-button" onClick={() => onOpenPipeline(record.pipelineItemId)}>
              Open in Pipeline
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
