"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCopy, FolderKanban, Loader2, RefreshCcw, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../Context/AuthContext';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import { useMutableSearchParams } from '../../next/useMutableSearchParams';
import OrgEmptyState from '../components/OrgEmptyState';
import PipelineTasksPanel from '../components/tasks/PipelineTasksPanel';
import { UiTabs } from '../../components/Shared/ui';
import useOrgCalendar from '../hooks/useOrgCalendar';
import useOrgContext from '../hooks/useOrgContext';
import { generateClientReviewLink } from '../services/pipelineService';
import { buildDeepLink, extractDeepLinkParams } from '../../utils/buildDeepLink';
const REVIEW_READY_STATUSES = new Set(['pending', 'in_review']);
const REVIEWER_ROLES = new Set(['reviewer', 'editor', 'org_admin', 'org_owner']);
const STATUS_LABELS = {
  pending: 'Pending',
  in_review: 'In Review',
  revision_requested: 'Changes Requested',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Failed',
};

function formatRoleLabel(value) {
  return String(value || 'role')
    .trim()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getMemberLabel(member) {
  return member?.profile?.full_name || member?.profile?.email || member?.userId || 'Member';
}

function getApprovedHistoryEntries(item) {
  const history = Array.isArray(item?.history) ? item.history : [];
  return history.filter((entry) => {
    const eventName = String(entry?.event || '').trim().toLowerCase();
    return eventName === 'approve' || eventName === 'advanced' || eventName === 'auto_approved';
  });
}

function getLatestRevisionComment(item) {
  const history = Array.isArray(item?.history) ? [...item.history] : [];
  const entry = history.reverse().find((itemEntry) => {
    const eventName = String(itemEntry?.event || '').trim().toLowerCase();
    return eventName === 'request_revision' || eventName === 'reject';
  });
  return String(entry?.comment || '').trim();
}

function getStageProgressLabel(item) {
  const stages = Array.isArray(item?.config?.stages) ? item.config.stages : [];
  const total = stages.length;
  if (!total) return 'Stage information unavailable';
  const current = Number(item?.current_stage_order || 0);
  if (!current) return `Stage 1 of ${total}`;
  return `Stage ${Math.min(current, total)} of ${total}`;
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

function toDateTimeInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function getDefaultScheduleValue() {
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + 1);
  nextDate.setHours(10, 0, 0, 0);
  return toDateTimeInputValue(nextDate.toISOString());
}

function getStatusLabel(status) {
  return STATUS_LABELS[status] || 'Unknown';
}

function getStatusTone(status) {
  if (status === 'approved' || status === 'published') return 'success';
  if (status === 'pending' || status === 'in_review') return 'review';
  if (status === 'scheduled') return 'scheduled';
  if (status === 'rejected' || status === 'failed') return 'danger';
  if (status === 'revision_requested') return 'warning';
  return 'neutral';
}

function canUserReviewItem(item, role, userId) {
  if (!item || !REVIEW_READY_STATUSES.has(String(item.status || '').toLowerCase())) {
    return false;
  }

  const normalizedRole = String(role || '').trim().toLowerCase();
  const currentAssigneeRole = String(item.current_assignee_role || '').trim().toLowerCase();
  const currentAssigneeUserId = item.current_assignee_user_id || null;
  const elevated = normalizedRole === 'org_owner' || normalizedRole === 'org_admin' || normalizedRole === 'editor';

  if (elevated) return true;
  if (currentAssigneeUserId) return currentAssigneeUserId === userId;
  if (currentAssigneeRole) return currentAssigneeRole === normalizedRole;
  return REVIEWER_ROLES.has(normalizedRole);
}

async function copyText(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

export default function PipelineBoard() {
  const { navigate, location } = useAppNavigation();
  const [searchParams] = useMutableSearchParams();
  const { user } = useAuth();
  const { organizationId, role, hasPermission, isOrgAdmin } = useOrgContext();
  const {
    loading,
    error,
    pipelineItems,
    taskStatuses,
    tasks,
    members,
    posts,
    refresh,
    actOnPipelineItem,
    scheduleRecord,
    createTask,
    saveTask,
  } = useOrgCalendar();
  const [activeTab, setActiveTab] = useState(
    location.pathname.includes('/pipeline/tasks') ? 'tasks' : 'content',
  );

  const [selectedItemId, setSelectedItemId] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [scheduleValue, setScheduleValue] = useState(getDefaultScheduleValue());
  const [actionBusy, setActionBusy] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [clientLink, setClientLink] = useState(null);
  const [contentLane, setContentLane] = useState('all');

  const requestedPipelineItemId = useMemo(() => {
    const stateParams = extractDeepLinkParams(location.state);
    return stateParams.pipelineItemId || searchParams.get('pipelineItemId') || null;
  }, [location.state, searchParams]);
  const requestedTaskId = searchParams.get('taskId') || null;

  useEffect(() => {
    setActiveTab(location.pathname.includes('/pipeline/tasks') ? 'tasks' : 'content');
  }, [location.pathname]);

  useEffect(() => {
    if (activeTab !== 'content') return;
    setContentLane((current) => (
      current === 'all' || current === 'submitted' || current === 'review'
        ? current
        : 'all'
    ));
  }, [activeTab]);

  const sortedItems = useMemo(() => (
    [...pipelineItems].sort((left, right) => (
      new Date(right.updated_at || right.created_at || 0).getTime()
      - new Date(left.updated_at || left.created_at || 0).getTime()
    ))
  ), [pipelineItems]);

  const visibleItems = useMemo(() => {
    if (contentLane === 'submitted') {
      return sortedItems.filter((item) => item.submitted_by === user?.id);
    }

    if (contentLane === 'review') {
      return sortedItems.filter((item) => canUserReviewItem(item, role, user?.id));
    }

    return sortedItems;
  }, [contentLane, role, sortedItems, user?.id]);

  useEffect(() => {
    if (!requestedPipelineItemId) return;
    const existsInAll = sortedItems.some((item) => item.id === requestedPipelineItemId);
    const existsInVisible = visibleItems.some((item) => item.id === requestedPipelineItemId);
    if (existsInAll && !existsInVisible) {
      setContentLane('all');
    }
  }, [requestedPipelineItemId, sortedItems, visibleItems]);

  useEffect(() => {
    if (!visibleItems.length) {
      setSelectedItemId('');
      return;
    }

    if (requestedPipelineItemId) {
      const match = visibleItems.find((item) => item.id === requestedPipelineItemId);
      if (match) {
        setSelectedItemId(match.id);
        return;
      }
    }

    setSelectedItemId((current) => (
      visibleItems.some((item) => item.id === current)
        ? current
        : visibleItems[0].id
    ));
  }, [requestedPipelineItemId, visibleItems]);

  useEffect(() => {
    if (!selectedItemId) return;
    const node = document.querySelector(`[data-pipeline-item-id="${selectedItemId}"]`);
    node?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedItemId]);

  const selectedItem = useMemo(
    () => visibleItems.find((item) => item.id === selectedItemId) || null,
    [selectedItemId, visibleItems],
  );

  useEffect(() => {
    if (!selectedItem) {
      setClientLink(null);
      setReviewComment('');
      setScheduleValue(getDefaultScheduleValue());
      return;
    }

    setReviewComment('');
    setClientLink(null);
    setScheduleValue(toDateTimeInputValue(selectedItem.linkedPost?.scheduled_at) || getDefaultScheduleValue());
  }, [selectedItem?.id]);

  const memberById = useMemo(
    () => new Map((members || []).map((member) => [member.userId, member])),
    [members],
  );
  const selectedApprovedHistory = useMemo(
    () => getApprovedHistoryEntries(selectedItem),
    [selectedItem],
  );
  const selectedRevisionComment = useMemo(
    () => getLatestRevisionComment(selectedItem),
    [selectedItem],
  );
  const selectedSubmitterLabel = useMemo(
    () => getMemberLabel(memberById.get(selectedItem?.submitted_by) || selectedItem?.submitter || null),
    [memberById, selectedItem?.submitted_by, selectedItem?.submitter],
  );

  const canSchedule = Boolean(hasPermission('can_schedule') || hasPermission('can_publish'));
  const canReview = canUserReviewItem(selectedItem, role, user?.id);
  const canReject = canReview;
  const canRequestRevision = canReview;
  const canApprove = canReview;
  const canScheduleSelected = Boolean(selectedItem && selectedItem.status === 'approved' && canSchedule);
  const canGenerateClientLink = Boolean(
    selectedItem
    && canReview
    && selectedItem.currentStage?.generates_client_review_link,
  );
  const canReviseAndResubmit = Boolean(
    selectedItem
    && (selectedItem.linkedPost?.id || selectedItem.post_id)
    && selectedItem.submitted_by === user?.id
    && ['revision_requested', 'rejected'].includes(String(selectedItem.status || '').trim().toLowerCase()),
  );

  const runPipelineAction = async (action) => {
    if (!selectedItem?.id) return;
    const trimmedComment = reviewComment.trim();
    if ((action === 'reject' || action === 'request_revision') && !trimmedComment) {
      toast.error('Add a reviewer comment before rejecting or requesting revision.');
      return;
    }
    setActionBusy(action);
    try {
      await actOnPipelineItem({
        pipelineItemId: selectedItem.id,
        action,
        comment: trimmedComment || undefined,
      });
      toast.success(
        action === 'approve'
          ? 'Pipeline item approved.'
          : action === 'request_revision'
            ? 'Revision requested.'
            : 'Pipeline item rejected.',
      );
      await refresh();
      setReviewComment('');
      setClientLink(null);
    } catch (actionError) {
      toast.error(actionError?.message || 'Could not complete this action.');
    } finally {
      setActionBusy('');
    }
  };

  const handleSchedule = async () => {
    if (!selectedItem?.id) return;
    const nextDate = new Date(scheduleValue);
    if (Number.isNaN(nextDate.getTime())) {
      toast.error('Choose a valid schedule date and time.');
      return;
    }

    setActionBusy('schedule');
    try {
      await scheduleRecord({
        postId: selectedItem?.linkedPost?.id || selectedItem?.post_id || null,
        pipelineItemId: selectedItem.id,
        scheduledAt: nextDate.toISOString(),
      });
      toast.success('Pipeline item scheduled.');
      await refresh();
    } catch (scheduleError) {
      toast.error(scheduleError?.message || 'Could not schedule this pipeline item.');
    } finally {
      setActionBusy('');
    }
  };

  const handleGenerateClientLink = async () => {
    if (!selectedItem?.id) return;
    setLinkBusy(true);
    try {
      const data = await generateClientReviewLink(selectedItem.id);
      setClientLink({
        reviewUrl: data?.review_url || '',
        token: data?.client_review_token || '',
        expiresAt: data?.client_review_token_expires_at || null,
      });
      toast.success('Client review link generated.');
      await refresh();
    } catch (linkError) {
      toast.error(linkError?.message || 'Could not generate the client review link.');
    } finally {
      setLinkBusy(false);
    }
  };

  const handleReviseAndResubmit = () => {
    if (!selectedItem?.id || !organizationId) return;
    const linkedPostId = selectedItem?.linkedPost?.id || selectedItem?.post_id || null;
    if (!linkedPostId) return;

    const nextParams = new URLSearchParams({
      draftId: linkedPostId,
      pipelineItemId: selectedItem.id,
      source: 'pipeline_board',
    });

    navigate(`/app/org/${organizationId}/office?${nextParams.toString()}`);
  };

  const handleSwitchTab = (nextTab) => {
    if (!organizationId) return;
    const nextPath = nextTab === 'tasks'
      ? `/app/org/${organizationId}/pipeline/tasks`
      : `/app/org/${organizationId}/pipeline`;
    setActiveTab(nextTab);
    navigate(nextPath);
  };

  return (
    <section className="org-page pipeline-board-page">
      <div className="org-page-header">
        <div>
          <h1>Pipeline Board</h1>
          <p>
            {activeTab === 'tasks'
              ? 'Track assigned work and update task progress from a dedicated pipeline tasks surface.'
              : 'Review, approve, and schedule content from one queue with role-aware controls.'}
          </p>
        </div>
        <div className="pipeline-board-header-actions">
          <button
            type="button"
            className="org-secondary-button"
            onClick={() => {
              const target = buildDeepLink({
                path: `/app/org/${organizationId}/calendar`,
                source: 'pipeline_board',
                target: 'org_calendar',
                params: selectedItem?.id ? { pipelineItemId: selectedItem.id } : {},
              });
              navigate(target.path, { state: target.state });
            }}
          >
            <FolderKanban size={14} />
            Open Calendar
          </button>
          <button type="button" className="org-secondary-button" onClick={() => void refresh()}>
            {loading ? <Loader2 size={14} className="org-spin" /> : <RefreshCcw size={14} />}
            Refresh
          </button>
        </div>
      </div>

      <UiTabs
        className="pipeline-board-tab-strip"
        tabs={[
          { value: 'content', label: 'Content Pipeline' },
          { value: 'tasks', label: 'Tasks' },
        ]}
        value={activeTab}
        onChange={handleSwitchTab}
        ariaLabel="Pipeline views"
      />

      {activeTab === 'content' ? (
        <UiTabs
          className="pipeline-board-subtabs"
          tabs={[
            { value: 'all', label: 'All' },
            { value: 'submitted', label: 'Submitted' },
            { value: 'review', label: 'Needs My Review' },
          ]}
          value={contentLane}
          onChange={setContentLane}
          ariaLabel="Pipeline lanes"
        />
      ) : null}

      {error ? (
        <div className="org-calendar-warning-bar">
          <div className="org-calendar-warning-copy">
            <span className="org-calendar-warning-icon">
              <XCircle size={14} />
            </span>
            <div>
              <strong>Pipeline loading issue</strong>
              <p>{error}</p>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'tasks' ? (
        <PipelineTasksPanel
          organizationId={organizationId}
          currentUserId={user?.id || null}
          isOrgAdmin={Boolean(isOrgAdmin)}
          loading={loading}
          tasks={tasks}
          taskStatuses={taskStatuses}
          members={members}
          pipelineItems={pipelineItems}
          posts={posts}
          requestedTaskId={requestedTaskId}
          onCreateTask={createTask}
          onSaveTask={saveTask}
        />
      ) : !loading && visibleItems.length === 0 ? (
        <OrgEmptyState
          eyebrow="Pipeline"
          title={
            contentLane === 'submitted'
              ? 'No submitted items yet'
              : contentLane === 'review'
                ? 'No items need your review'
                : 'No pipeline items yet'
          }
          description={
            contentLane === 'submitted'
              ? 'Items you submit for approval will appear here.'
              : contentLane === 'review'
                ? 'Review-eligible items will appear here based on your current role.'
                : 'Submitted drafts will appear here once they enter the review flow.'
          }
        />
      ) : (
        <div className="pipeline-board-layout">
          <aside className="pipeline-board-list">
            {visibleItems.map((item) => {
              const tone = getStatusTone(item.status);
              const isSelected = item.id === selectedItem?.id;
              const mediaUrl = (Array.isArray(item?.generations)
                ? item.generations[0]?.storage_path
                : item?.generations?.storage_path)
                || item?.linkedPost?.media?.storage_path
                || null;
              const submitterLabel = getMemberLabel(memberById.get(item.submitted_by));
              return (
                <button
                  key={item.id}
                  type="button"
                  data-pipeline-item-id={item.id}
                  className={`pipeline-board-card ${isSelected ? 'active' : ''}`}
                  onClick={() => setSelectedItemId(item.id)}
                >
                  <div className="pipeline-board-card-row">
                    {mediaUrl ? (
                      <img src={mediaUrl} alt="" className="pipeline-board-thumb" />
                    ) : (
                      <span className="pipeline-board-thumb placeholder" aria-hidden="true" />
                    )}
                    <div className="pipeline-board-card-main">
                      <div className="pipeline-board-card-head">
                        <strong>{item.title || 'Untitled item'}</strong>
                        <span className={`pipeline-board-status ${tone}`}>{getStatusLabel(item.status)}</span>
                      </div>
                      <p>{item.config?.name || 'Workflow'} / {getStageProgressLabel(item)}</p>
                    </div>
                  </div>
                  <div className="pipeline-board-card-meta">
                    <span>Submitted by {submitterLabel}</span>
                    <span>{formatDateTime(item.updated_at || item.created_at)}</span>
                  </div>
                </button>
              );
            })}
          </aside>

          <section className="pipeline-board-drawer">
            {!selectedItem ? (
              <OrgEmptyState
                eyebrow="Pipeline"
                title="Select an item"
                description="Choose any pipeline item to review details and run actions."
              />
            ) : (
              <>
                <div className="pipeline-board-drawer-head">
                  <div>
                    <h3>{selectedItem.title || 'Untitled item'}</h3>
                    <p>
                      {selectedItem.config?.name || 'Workflow'} / {getStageProgressLabel(selectedItem)}
                    </p>
                  </div>
                  <span className={`pipeline-board-status ${getStatusTone(selectedItem.status)}`}>
                    {getStatusLabel(selectedItem.status)}
                  </span>
                </div>

                <div className="pipeline-board-detail-grid">
                  <div><span>Submitted</span><strong>{formatDateTime(selectedItem.created_at)}</strong></div>
                  <div><span>Submitter</span><strong>{selectedSubmitterLabel}</strong></div>
                  <div><span>Workflow</span><strong>{selectedItem.config?.name || 'Not assigned'}</strong></div>
                  <div><span>Current Stage</span><strong>{getStageProgressLabel(selectedItem)}</strong></div>
                  <div><span>Updated</span><strong>{formatDateTime(selectedItem.updated_at)}</strong></div>
                  <div><span>Platform</span><strong>{selectedItem.platform || 'Platform TBD'}</strong></div>
                  <div><span>Scheduled</span><strong>{formatDateTime(selectedItem.linkedPost?.scheduled_at || selectedItem.scheduled_for)}</strong></div>
                </div>

                {selectedApprovedHistory.length > 0 ? (
                  <div className="pipeline-board-approved-history">
                    <strong>Approved stages</strong>
                    {selectedApprovedHistory.map((entry, index) => {
                      const actorLabel = getMemberLabel(memberById.get(entry?.actor_id) || null);
                      return (
                        <span key={`${entry?.timestamp || entry?.stage_name || 'approved'}-${index}`}>
                          {entry?.stage_name || 'Stage'} / {actorLabel} / {formatDateTime(entry?.timestamp)}
                        </span>
                      );
                    })}
                  </div>
                ) : null}

                {selectedRevisionComment ? (
                  <div className="pipeline-board-revision-note">
                    <strong>Latest reviewer comment</strong>
                    <p>{selectedRevisionComment}</p>
                  </div>
                ) : null}

                <label className="pipeline-board-comment">
                  <span>Review Comment</span>
                  <textarea
                    rows={3}
                    value={reviewComment}
                    onChange={(event) => setReviewComment(event.target.value)}
                    placeholder="Optional reviewer context."
                    disabled={Boolean(actionBusy)}
                  />
                </label>

                <div className="pipeline-board-action-row">
                  <button
                    type="button"
                    className="org-secondary-button"
                    disabled={!canRequestRevision || Boolean(actionBusy)}
                    onClick={() => void runPipelineAction('request_revision')}
                    title={canRequestRevision ? '' : 'Only the assigned stage actor can request revisions.'}
                  >
                    {actionBusy === 'request_revision' ? 'Saving...' : 'Request Changes'}
                  </button>
                  <button
                    type="button"
                    className="org-secondary-button danger"
                    disabled={!canReject || Boolean(actionBusy)}
                    onClick={() => void runPipelineAction('reject')}
                    title={canReject ? '' : 'Only the assigned stage actor can reject this item.'}
                  >
                    {actionBusy === 'reject' ? 'Saving...' : 'Reject'}
                  </button>
                  <button
                    type="button"
                    className="org-primary-button"
                    disabled={!canApprove || Boolean(actionBusy)}
                    onClick={() => void runPipelineAction('approve')}
                    title={canApprove ? '' : 'Only the assigned stage actor can approve this item.'}
                  >
                    <CheckCircle2 size={14} />
                    {actionBusy === 'approve' ? 'Saving...' : 'Approve'}
                  </button>
                </div>

                {canReviseAndResubmit ? (
                  <div className="pipeline-board-resubmit-box">
                    <button
                      type="button"
                      className="org-secondary-button"
                      onClick={handleReviseAndResubmit}
                    >
                      Revise and Resubmit
                    </button>
                  </div>
                ) : null}

                <div className="pipeline-board-schedule-box">
                  <label>
                    <span>Schedule (approved items only)</span>
                    <input
                      type="datetime-local"
                      value={scheduleValue}
                      onChange={(event) => setScheduleValue(event.target.value)}
                      disabled={!canScheduleSelected || Boolean(actionBusy)}
                    />
                  </label>
                  <button
                    type="button"
                    className="org-secondary-button"
                    disabled={!canScheduleSelected || Boolean(actionBusy)}
                    onClick={() => void handleSchedule()}
                    title={canScheduleSelected ? '' : 'Scheduling is only available for approved items with schedule permission.'}
                  >
                    {actionBusy === 'schedule' ? 'Scheduling...' : 'Schedule'}
                  </button>
                </div>

                {selectedItem.currentStage?.generates_client_review_link ? (
                  <div className="pipeline-board-client-review">
                    <div>
                      <strong>Client Review Link</strong>
                      <p>Generate a 72-hour link for external review from this stage.</p>
                    </div>
                    <button
                      type="button"
                      className="org-secondary-button"
                      disabled={!canGenerateClientLink || linkBusy}
                      onClick={() => void handleGenerateClientLink()}
                      title={canGenerateClientLink ? '' : 'This action requires stage review permission.'}
                    >
                      {linkBusy ? 'Generating...' : 'Generate Link'}
                    </button>

                    {clientLink?.reviewUrl ? (
                      <div className="pipeline-board-link-box">
                        <a href={clientLink.reviewUrl} target="_blank" rel="noreferrer">{clientLink.reviewUrl}</a>
                        <button
                          type="button"
                          className="org-text-button"
                          onClick={async () => {
                            const copied = await copyText(clientLink.reviewUrl);
                            if (copied) toast.success('Link copied.');
                          }}
                        >
                          <ClipboardCopy size={13} />
                          Copy
                        </button>
                        <small>
                          Expires {formatDateTime(clientLink.expiresAt)}
                        </small>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
