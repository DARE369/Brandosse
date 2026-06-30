import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ClipboardCopy,
  FolderKanban,
  Sparkles,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import OrgSelect from '../OrgSelect';
import { scheduleOrgCalendarRecord } from '../../services/orgCalendarService';
import { buildScheduleModalRecord, fetchOrgScheduleContext } from '../../services/orgScheduleService';
import { generateClientReviewLink } from '../../services/pipelineService';
import PostPreview from './PostPreview';
import SchedulePicker from './SchedulePicker';

function safeArray(value) {
  return Array.isArray(value) ? value : [];
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

function getInitials(value) {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) return '?';
  return parts.map((part) => part[0]).join('').toUpperCase();
}

function formatScheduleInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
}

function getDefaultScheduleValue() {
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + 1);
  nextDate.setHours(10, 0, 0, 0);
  return formatScheduleInputValue(nextDate.toISOString());
}

function buildClientReviewUrlFromToken(token) {
  const normalized = String(token || '').trim();
  if (!normalized) return '';
  if (typeof window === 'undefined') return `/review/${normalized}`;
  return `${window.location.origin.replace(/\/+$/, '')}/review/${normalized}`;
}

function buildDestinationOptions(destinations = []) {
  return [
    { value: '', label: 'Keep current destination', description: 'Use the existing account or platform on the post.' },
    ...safeArray(destinations).map((account) => ({
      value: account.id,
      label: account.account_name || account.username || account.platform || 'Destination',
      description: [account.platform, account.connection_status].filter(Boolean).join(' • ') || 'Connected account',
    })),
  ];
}

function buildDestinationOptionsWithAccess(destinations = []) {
  return [
    { value: '', label: 'Keep current destination', description: 'Use the existing account or platform on the post.' },
    ...safeArray(destinations).map((account) => ({
      value: account.id,
      label: account.account_name || account.username || account.platform || 'Destination',
      description: [
        account.platform,
        account.scope === 'organization' ? 'Shared org account' : 'Personal account',
        account.connection_status,
      ].filter(Boolean).join(' • ') || 'Connected account',
      meta: account.scope === 'organization'
        ? (account.can_post === false
          ? 'No Access'
          : account.access_mode === 'specific_members'
            ? 'Specific members only'
            : 'Available to publish-enabled members')
        : 'Personal destination',
      badge: account.scope === 'organization' ? 'Org' : 'Personal',
      badgeTone: account.scope === 'organization' ? 'org' : 'personal',
      disabled: account.scope === 'organization' && account.can_post === false,
      title: account.scope === 'organization' && account.can_post === false
        ? 'Contact your admin to request posting access.'
        : '',
    })),
  ];
}

export default function OrgScheduleModal({
  open = false,
  record = null,
  postId = null,
  pipelineItemId = null,
  onClose,
  onScheduled,
  onApprove,
  onRequestChanges,
  onPublishNow,
  onOpenPipeline,
}) {
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState('details');
  const [scheduleValue, setScheduleValue] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState('');
  const [clientReviewBusy, setClientReviewBusy] = useState(false);
  const [clientReviewLink, setClientReviewLink] = useState('');
  const [clientReviewExpiresAt, setClientReviewExpiresAt] = useState('');

  const loadContext = useCallback(async () => {
    if (!open || (!pipelineItemId && !postId)) {
      setContext(null);
      setLoadError('');
      return;
    }

    setLoading(true);
    setLoadError('');
    try {
      const data = await fetchOrgScheduleContext({
        pipelineItemId,
        postId,
      });
      setContext(data);
    } catch (error) {
      setLoadError(error?.message || 'Could not load schedule context.');
    } finally {
      setLoading(false);
    }
  }, [open, pipelineItemId, postId]);

  useEffect(() => {
    if (!open) return;
    void loadContext();
  }, [loadContext, open]);

  useEffect(() => {
    if (!open) {
      setActiveTab('details');
      setReviewComment('');
      setLoadError('');
      setClientReviewLink('');
      setClientReviewExpiresAt('');
      return;
    }

    const nextRecord = buildScheduleModalRecord({
      initialRecord: record,
      context,
    });

    setScheduleValue(nextRecord?.scheduledAt ? formatScheduleInputValue(nextRecord.scheduledAt) : getDefaultScheduleValue());
    setSelectedAccountId(nextRecord?.currentAccount?.id || context?.post?.account_id || '');
    setReviewComment('');
    if (!nextRecord?.canScheduleAction) {
      setActiveTab('details');
    }
  }, [context, open, record]);

  useEffect(() => {
    if (!open) return undefined;

    function handleEscape(event) {
      if (event.key === 'Escape') {
        onClose?.();
      }
    }

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, open]);

  const modalRecord = useMemo(() => buildScheduleModalRecord({
    initialRecord: record,
    context,
  }), [context, record]);

  const destinations = safeArray(context?.destinations);
  const destinationOptions = useMemo(() => buildDestinationOptionsWithAccess(destinations), [destinations]);
  const currentDestination = destinations.find((account) => account.id === (selectedAccountId || context?.post?.account_id)) || modalRecord.currentAccount || null;
  const canScheduleTab = Boolean(modalRecord?.canScheduleAction);
  const canReviewAction = Boolean(modalRecord?.canReviewAction && typeof onApprove === 'function' && typeof onRequestChanges === 'function');
  const canPublishAction = Boolean(modalRecord?.canPublishAction && typeof onPublishNow === 'function');
  const canGenerateClientReviewLink = Boolean(
    modalRecord?.pipelineItemId
    && modalRecord?.stageGeneratesClientReviewLink
    && modalRecord?.canGenerateClientReviewLink,
  );
  const tabs = canScheduleTab
    ? [
      { id: 'details', label: 'Details' },
      { id: 'schedule', label: 'Schedule' },
    ]
    : [{ id: 'details', label: 'Details' }];
  const brandKit = context?.brand_kit || null;

  const handleScheduleConfirm = async (nextValue) => {
    const nextDate = new Date(nextValue);
    if (Number.isNaN(nextDate.getTime())) {
      toast.error('Choose a valid date first.');
      return;
    }

    const scheduleDay = new Date(nextDate);
    scheduleDay.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (scheduleDay < today) {
      toast.error('Past dates are locked.');
      return;
    }

    const selectedDestination = destinations.find((account) => account.id === selectedAccountId) || null;
    if (selectedDestination?.scope === 'organization' && selectedDestination?.can_post === false) {
      toast.error('You do not have posting access to this shared organization account.');
      return;
    }

    setScheduleSaving(true);
    try {
      await scheduleOrgCalendarRecord({
        postId: modalRecord.postId,
        pipelineItemId: modalRecord.pipelineItemId,
        scheduledAt: nextDate.toISOString(),
        accountId: selectedAccountId || null,
      });
      toast.success(modalRecord.scheduledAt ? 'Schedule updated.' : 'Content scheduled.');
      await loadContext();
      await onScheduled?.();
      setActiveTab('details');
    } catch (error) {
      toast.error(error?.message || 'Could not save this schedule.');
    } finally {
      setScheduleSaving(false);
    }
  };

  const runAction = async (key, successMessage, handler, argument) => {
    if (typeof handler !== 'function') return;
    setActionBusy(key);
    try {
      await handler(argument);
      toast.success(successMessage);
      await loadContext();
      setReviewComment('');
    } catch (error) {
      toast.error(error?.message || 'Could not complete this action.');
    } finally {
      setActionBusy('');
    }
  };

  useEffect(() => {
    if (!modalRecord?.pipelineItemId || !modalRecord?.clientReviewToken) {
      setClientReviewLink('');
      setClientReviewExpiresAt('');
      return;
    }

    setClientReviewLink(buildClientReviewUrlFromToken(modalRecord.clientReviewToken));
    setClientReviewExpiresAt(modalRecord.clientReviewTokenExpiresAt || '');
  }, [modalRecord?.clientReviewToken, modalRecord?.clientReviewTokenExpiresAt, modalRecord?.pipelineItemId]);

  const handleGenerateClientReviewLink = async () => {
    if (!modalRecord?.pipelineItemId) return;

    setClientReviewBusy(true);
    try {
      const data = await generateClientReviewLink(modalRecord.pipelineItemId);
      const reviewUrl = String(data?.review_url || '').trim() || buildClientReviewUrlFromToken(data?.client_review_token);
      setClientReviewLink(reviewUrl);
      setClientReviewExpiresAt(data?.client_review_token_expires_at || '');
      toast.success('Client review link generated.');
      await loadContext();
    } catch (error) {
      toast.error(error?.message || 'Could not generate a client review link.');
    } finally {
      setClientReviewBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="org-calendar-modal-shell" role="dialog" aria-modal="true" aria-label="Schedule content">
      <button type="button" className="org-calendar-modal-backdrop" onClick={onClose} aria-label="Close schedule modal" />

      <section className="org-calendar-modal-surface schedule-modal">
        <header className="org-calendar-modal-header schedule-modal">
          <div>
            <span className="org-calendar-saved-kicker">Schedule Context</span>
            <h3>{modalRecord.title}</h3>
            <p>
              {context?.organization?.name || 'Organization'}
              {context?.brand_project?.name ? ` • ${context.brand_project.name}` : ''}
            </p>
          </div>

          <div className="org-calendar-schedule-header-actions">
            <div className="org-calendar-schedule-tabs" role="tablist" aria-label="Schedule tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={activeTab === tab.id ? 'active' : ''}
                  onClick={() => setActiveTab(tab.id)}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button type="button" className="org-icon-button" onClick={onClose} aria-label="Close schedule modal">
              <X size={16} />
            </button>
          </div>
        </header>

        {loading && !context ? (
          <div className="org-panel-loading">Loading schedule context...</div>
        ) : (
          <div className="org-calendar-modal-grid schedule-modal">
            <div className="org-calendar-modal-panel schedule-main">
              {loadError ? (
                <div className="org-calendar-warning-bar">
                  <div className="org-calendar-warning-copy">
                    <span className="org-calendar-warning-icon">
                      <AlertTriangle size={14} />
                    </span>
                    <div>
                      <strong>Live schedule context is unavailable</strong>
                      <p>{loadError}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              <PostPreview record={modalRecord} />

              <section className="org-calendar-detail-section">
                <div className="org-calendar-section-head">
                  <div>
                    <span className="org-calendar-section-eyebrow">Placement Summary</span>
                    <h4>Current lifecycle and ownership</h4>
                  </div>
                  <span className={`org-calendar-status-chip tone-${modalRecord.tone || 'draft'}`.trim()}>
                    {modalRecord.statusLabel}
                  </span>
                </div>

                <div className="org-calendar-schedule-summary-grid">
                  <div className="org-calendar-detail-block">
                    <span>Owner</span>
                    <strong>{modalRecord.ownerName}</strong>
                  </div>
                  <div className="org-calendar-detail-block">
                    <span>Platform</span>
                    <strong>{modalRecord.platformLabel}</strong>
                  </div>
                  <div className="org-calendar-detail-block">
                    <span>Stage</span>
                    <strong>{modalRecord.stageLabel || 'No active stage'}</strong>
                  </div>
                  <div className="org-calendar-detail-block">
                    <span>Schedule</span>
                    <strong>{modalRecord.scheduleLabel || 'Not scheduled'}</strong>
                  </div>
                  <div className="org-calendar-detail-block">
                    <span>Created</span>
                    <strong>{formatDateTime(modalRecord.createdAt)}</strong>
                  </div>
                  <div className="org-calendar-detail-block">
                    <span>Destination</span>
                    <strong>{currentDestination?.account_name || currentDestination?.username || currentDestination?.platform || 'No account selected'}</strong>
                  </div>
                </div>

                {modalRecord.taskId ? (
                  <div className="org-calendar-inline-hint task-link">
                    <Sparkles size={14} />
                    <span>
                      Linked task: <strong>{modalRecord.taskTitle || `Task ${String(modalRecord.taskId).slice(0, 8).toUpperCase()}`}</strong>
                      {modalRecord.taskStatusLabel ? ` | ${modalRecord.taskStatusLabel}` : ''}
                      {modalRecord.taskDueLabel ? ` | due ${modalRecord.taskDueLabel}` : ''}
                      {modalRecord.isTaskBlocked ? ' | blocked' : ''}
                    </span>
                  </div>
                ) : null}

                {modalRecord.isPastLocked ? (
                  <div className="org-calendar-inline-hint locked">
                    <CalendarClock size={14} />
                    Past dates are locked for this record.
                  </div>
                ) : null}
              </section>

              {brandKit ? (
                <section className="org-calendar-detail-section">
                  <div className="org-calendar-section-head">
                    <div>
                      <span className="org-calendar-section-eyebrow">Brand Context</span>
                      <h4>{brandKit.brand_name || context?.brand_project?.name || 'Brand Kit'}</h4>
                    </div>
                    <span className="org-calendar-detail-chip neutral">
                      {brandKit.completeness_score || 0}% complete
                    </span>
                  </div>

                  <div className="org-calendar-brand-strip">
                    {brandKit.tagline ? <p>{brandKit.tagline}</p> : <p>Brand kit context is available for scheduling and downstream publishing decisions.</p>}
                    <div className="org-calendar-brand-tags">
                      {safeArray(brandKit.tone_descriptors).slice(0, 4).map((entry) => <span key={entry}>{entry}</span>)}
                      {safeArray(brandKit.content_pillars).slice(0, 3).map((entry) => <span key={entry}>{entry}</span>)}
                    </div>
                  </div>
                </section>
              ) : null}

              {modalRecord.rawPipelineItem?.submission_note ? (
                <section className="org-calendar-detail-section">
                  <div className="org-calendar-section-head">
                    <div>
                      <span className="org-calendar-section-eyebrow">Origin Note</span>
                      <h4>Pipeline submission context</h4>
                    </div>
                  </div>
                  <div className="org-calendar-detail-note">{modalRecord.rawPipelineItem.submission_note}</div>
                </section>
              ) : null}

              {modalRecord.attachedAssets?.length ? (
                <section className="org-calendar-detail-section">
                  <div className="org-calendar-section-head">
                    <div>
                      <span className="org-calendar-section-eyebrow">Linked Assets</span>
                      <h4>{modalRecord.attachedAssets.length} linked asset{modalRecord.attachedAssets.length === 1 ? '' : 's'}</h4>
                    </div>
                  </div>

                  <div className="org-calendar-linked-assets">
                    {modalRecord.attachedAssets.map((asset) => (
                      <article key={asset.id} className="org-calendar-linked-asset">
                        <strong>{asset.name}</strong>
                        <span>{asset.file_type || 'asset'} • {asset.folder_path || '/'}</span>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>

            <div className="org-calendar-modal-panel schedule-side">
              {activeTab === 'schedule' && canScheduleTab ? (
                <>
                  <section className="org-calendar-detail-section">
                    <div className="org-calendar-section-head">
                      <div>
                        <span className="org-calendar-section-eyebrow">Schedule</span>
                        <h4>Choose timing and destination</h4>
                      </div>
                    </div>

                    <label className="org-calendar-input-block">
                      <span>Destination Account</span>
                      <OrgSelect
                        value={selectedAccountId}
                        options={destinationOptions}
                        onChange={setSelectedAccountId}
                      />
                    </label>

                    {currentDestination ? (
                      <div className="org-calendar-destination-summary">
                        <strong>{currentDestination.account_name || currentDestination.username || currentDestination.platform}</strong>
                        <span className={`org-calendar-account-badge tone-${currentDestination.scope === 'organization' ? 'org' : 'personal'}`.trim()}>
                          {currentDestination.scope === 'organization' ? 'Org' : 'Personal'}
                        </span>
                        <small className={currentDestination.scope === 'organization' && currentDestination.can_post === false ? 'no-access' : ''}>
                          {currentDestination.scope === 'organization'
                            ? (currentDestination.can_post === false
                              ? 'No Access - Contact your admin to request posting access.'
                              : currentDestination.access_mode === 'specific_members'
                                ? 'Shared org account - Specific members only.'
                                : 'Shared org account - Available to publish-enabled members.')
                            : 'Personal destination for the content owner.'}
                        </small>
                        <span>{[currentDestination.platform, currentDestination.connection_status].filter(Boolean).join(' • ')}</span>
                      </div>
                    ) : (
                      <div className="org-calendar-inline-hint">
                        <AlertTriangle size={14} />
                        Keep the current post destination, or pick a connected account before confirming.
                      </div>
                    )}
                  </section>

                  <SchedulePicker
                    value={scheduleValue}
                    saving={scheduleSaving}
                    onCancel={() => setActiveTab('details')}
                    onConfirm={handleScheduleConfirm}
                    confirmLabel={modalRecord.scheduledAt ? 'Update schedule' : 'Confirm schedule'}
                  />
                </>
              ) : (
                <>
                  {!modalRecord.platform || modalRecord.platform === 'unknown' ? (
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
                    </div>
                  ) : null}

                  <section className="org-calendar-detail-section">
                    <div className="org-calendar-section-head">
                      <div>
                        <span className="org-calendar-section-eyebrow">Details</span>
                        <h4>Operational context</h4>
                      </div>
                    </div>

                    <div className="org-calendar-schedule-facts">
                      <div>
                        <span>Reviewer</span>
                        <strong>{context?.reviewer?.full_name || context?.reviewer?.email || modalRecord.assigneeLabel || 'Unassigned'}</strong>
                      </div>
                      <div>
                        <span>Pipeline</span>
                        <strong>{modalRecord.pipelineItemId ? `#${String(modalRecord.pipelineItemId).slice(0, 8).toUpperCase()}` : 'Standalone post'}</strong>
                      </div>
                      <div>
                        <span>Connected Accounts</span>
                        <strong>{destinations.length}</strong>
                      </div>
                      <div>
                        <span>Current Time</span>
                        <strong>{modalRecord.scheduleLabel || 'Not scheduled'}</strong>
                      </div>
                    </div>
                  </section>

                  {canReviewAction ? (
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
                          onChange={(event) => setReviewComment(event.target.value)}
                          placeholder="Add optional reviewer context."
                          disabled={Boolean(actionBusy)}
                        />
                      </label>

                      <div className="org-calendar-detail-actions">
                        <button
                          type="button"
                          className="org-calendar-detail-button danger"
                          disabled={Boolean(actionBusy)}
                          onClick={() => runAction('request_changes', 'Revision requested.', onRequestChanges, reviewComment.trim() || undefined)}
                        >
                          {actionBusy === 'request_changes' ? 'Saving...' : 'Request changes'}
                        </button>
                        <button
                          type="button"
                          className="org-calendar-detail-button primary"
                          disabled={Boolean(actionBusy)}
                          onClick={() => runAction('approve', 'Content approved.', onApprove, reviewComment.trim() || undefined)}
                        >
                          <CheckCircle2 size={14} />
                          {actionBusy === 'approve' ? 'Saving...' : 'Approve'}
                        </button>
                      </div>
                    </section>
                  ) : null}

                  <section className="org-calendar-detail-section">
                    <div className="org-calendar-section-head">
                      <div>
                        <span className="org-calendar-section-eyebrow">Actions</span>
                        <h4>Next available moves</h4>
                      </div>
                    </div>

                    <div className="org-calendar-detail-actions">
                      {canScheduleTab ? (
                        <button
                          type="button"
                          className="org-calendar-detail-button primary"
                          onClick={() => setActiveTab('schedule')}
                          disabled={scheduleSaving || Boolean(actionBusy)}
                        >
                          <CalendarClock size={14} />
                          {modalRecord.scheduledAt ? 'Update schedule' : 'Schedule'}
                        </button>
                      ) : null}

                      {canPublishAction ? (
                        <button
                          type="button"
                          className="org-calendar-detail-button success"
                          disabled={scheduleSaving || Boolean(actionBusy)}
                          onClick={() => runAction('publish', 'Publish triggered.', onPublishNow)}
                        >
                          <ArrowUpRight size={14} />
                          {actionBusy === 'publish' ? 'Publishing...' : 'Publish now'}
                        </button>
                      ) : null}

                      {modalRecord.pipelineItemId ? (
                        <button
                          type="button"
                          className="org-calendar-detail-button ghost"
                          onClick={() => onOpenPipeline?.(modalRecord.pipelineItemId)}
                        >
                          <FolderKanban size={14} />
                          Open in Pipeline
                        </button>
                      ) : null}
                    </div>

                    {!canScheduleTab && !canPublishAction && !canReviewAction ? (
                      <div className="org-calendar-inline-hint">
                        <Sparkles size={14} />
                        This member can review the schedule context but cannot change it from this modal.
                      </div>
                    ) : null}
                  </section>

                  {modalRecord.stageGeneratesClientReviewLink ? (
                    <section className="org-calendar-detail-section">
                      <div className="org-calendar-section-head">
                        <div>
                          <span className="org-calendar-section-eyebrow">Client Review</span>
                          <h4>Share external review link</h4>
                        </div>
                      </div>

                      <div className="org-calendar-detail-actions">
                        <button
                          type="button"
                          className="org-calendar-detail-button ghost"
                          disabled={!canGenerateClientReviewLink || clientReviewBusy}
                          onClick={() => void handleGenerateClientReviewLink()}
                        >
                          {clientReviewBusy ? 'Generating...' : 'Generate Client Link'}
                        </button>
                      </div>

                      {clientReviewLink ? (
                        <div className="org-calendar-inline-hint">
                          <span>{clientReviewLink}</span>
                          <button
                            type="button"
                            className="org-text-button"
                            onClick={async () => {
                              if (navigator?.clipboard?.writeText) {
                                await navigator.clipboard.writeText(clientReviewLink);
                                toast.success('Link copied.');
                              }
                            }}
                          >
                            <ClipboardCopy size={14} />
                            Copy
                          </button>
                        </div>
                      ) : null}

                      {clientReviewExpiresAt ? (
                        <div className="org-calendar-inline-hint">
                          Expires: {formatDateTime(clientReviewExpiresAt)}
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
