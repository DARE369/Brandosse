"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  FolderKanban,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../Context/AuthContext';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import OrgEmptyState from '../components/OrgEmptyState';
import OrgStatCard from '../components/OrgStatCard';
import OrgGenerateComposer from '../components/OrgGenerateComposer';
import OrgScheduleModal from '../components/calendar/OrgScheduleModal';
import useOrgCalendar from '../hooks/useOrgCalendar';
import useOrgContext from '../hooks/useOrgContext';
import {
  fetchOrgMemberDashboardState,
  saveOrgMemberDashboardState,
} from '../services/memberWorkspaceService';
import { buildDeepLink } from '../../utils/buildDeepLink';
const ACTIVE_PIPELINE_STATUSES = new Set(['pending', 'in_review', 'revision_requested']);
const COMPLETED_TASK_KEY = 'completed';

function formatDateTime(value) {
  if (!value) return 'No date';
  const nextDate = new Date(value);
  if (Number.isNaN(nextDate.getTime())) return 'No date';
  return nextDate.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatShortDate(value) {
  if (!value) return 'No due date';
  const nextDate = new Date(value);
  if (Number.isNaN(nextDate.getTime())) return 'No due date';
  return nextDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function formatRoleLabel(value) {
  return String(value || 'member')
    .trim()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function truncateText(value, maxLength = 120) {
  const normalized = String(value || '').trim();
  if (!normalized) return 'Untitled item';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function getDraftTitle(draft) {
  return truncateText(
    draft?.caption
      || draft?.media?.prompt
      || draft?.generations?.prompt
      || 'Untitled draft',
    92,
  );
}

function getPipelineTitle(item) {
  return truncateText(
    item?.title
      || item?.linkedPost?.caption
      || item?.posts?.caption
      || item?.generations?.prompt
      || 'Untitled pipeline item',
    100,
  );
}

function getTaskTitle(task) {
  return truncateText(task?.title || 'Untitled task', 100);
}

function getLatestRevisionComment(item) {
  const history = Array.isArray(item?.history) ? item.history : [];
  const revisionEntry = [...history]
    .reverse()
    .find((entry) => String(entry?.event || '').trim().toLowerCase() === 'request_revision');

  return String(revisionEntry?.comment || '').trim();
}

function isFutureDate(value) {
  if (!value) return false;
  const nextDate = new Date(value);
  return !Number.isNaN(nextDate.getTime()) && nextDate >= new Date();
}

function isDueSoon(value, hours = 72) {
  if (!value) return false;
  const dueTime = new Date(value).getTime();
  if (Number.isNaN(dueTime)) return false;
  const diffHours = (dueTime - Date.now()) / (1000 * 60 * 60);
  return diffHours >= 0 && diffHours <= hours;
}

function buildScheduleTarget(item) {
  const linkedPost = item?.linkedPost || item?.posts || null;

  return {
    postId: linkedPost?.id || item?.post_id || null,
    pipelineItemId: item?.id || null,
    record: {
      id: item?.id ? `pipeline:${item.id}` : (linkedPost?.id ? `post:${linkedPost.id}` : 'schedule-target'),
      postId: linkedPost?.id || item?.post_id || null,
      pipelineItemId: item?.id || null,
      title: getPipelineTitle(item),
      scheduledAt: linkedPost?.scheduled_at || item?.scheduled_for || null,
      lifecycleStatus: item?.status || linkedPost?.status || 'approved',
      canScheduleAction: true,
      rawPost: linkedPost || null,
      rawPipelineItem: item || null,
    },
  };
}

export default function MyWorkspace() {
  const { navigate } = useAppNavigation();
  const { user } = useAuth();
  const {
    organizationId,
    organization,
    activeBrandProject,
    role,
    isOrgAdmin,
  } = useOrgContext();
  const {
    loading,
    posts,
    pipelineItems,
    tasks,
    stats,
    refresh,
    canSchedule,
    canManageTasks,
  } = useOrgCalendar();

  const [dashboardState, setDashboardState] = useState({
    dismissed_action_keys: [],
    team_pulse_collapsed: false,
  });
  const [stateLoading, setStateLoading] = useState(true);
  const [savingState, setSavingState] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerIntent, setComposerIntent] = useState(null);
  const [scheduleTarget, setScheduleTarget] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboardState() {
      if (!organizationId || !user?.id) {
        if (!cancelled) {
          setDashboardState({
            dismissed_action_keys: [],
            team_pulse_collapsed: false,
          });
          setStateLoading(false);
        }
        return;
      }

      setStateLoading(true);
      try {
        const nextState = await fetchOrgMemberDashboardState({
          organizationId,
          userId: user.id,
        });

        if (!cancelled) {
          setDashboardState(nextState);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load member workspace state:', error);
          setDashboardState({
            dismissed_action_keys: [],
            team_pulse_collapsed: false,
          });
        }
      } finally {
        if (!cancelled) {
          setStateLoading(false);
        }
      }
    }

    void loadDashboardState();
    return () => {
      cancelled = true;
    };
  }, [organizationId, user?.id]);

  const persistDashboardState = useCallback(async (updates = {}) => {
    if (!organizationId || !user?.id) return;

    const nextState = {
      dismissed_action_keys: updates.dismissed_action_keys ?? dashboardState.dismissed_action_keys ?? [],
      team_pulse_collapsed: updates.team_pulse_collapsed ?? dashboardState.team_pulse_collapsed ?? false,
    };

    setDashboardState((current) => ({
      ...current,
      ...nextState,
    }));
    setSavingState(true);

    try {
      const saved = await saveOrgMemberDashboardState({
        organizationId,
        userId: user.id,
        dismissedActionKeys: nextState.dismissed_action_keys,
        teamPulseCollapsed: nextState.team_pulse_collapsed,
      });
      setDashboardState(saved);
    } catch (error) {
      toast.error(error?.message || 'Could not save dashboard preferences.');
    } finally {
      setSavingState(false);
    }
  }, [dashboardState.dismissed_action_keys, dashboardState.team_pulse_collapsed, organizationId, user?.id]);

  const openComposer = useCallback((intent) => {
    setComposerIntent({
      ...intent,
      nonce: Date.now(),
    });
    setComposerOpen(true);
  }, []);

  const openTaskWorkspace = useCallback((taskId = null) => {
    navigate(
      taskId
        ? `/app/org/${organizationId}/pipeline/tasks?taskId=${taskId}`
        : `/app/org/${organizationId}/pipeline/tasks`,
    );
  }, [navigate, organizationId]);

  const openPipelineWorkspace = useCallback((pipelineItemId = null) => {
    const target = buildDeepLink({
      path: `/app/org/${organizationId}/pipeline`,
      source: 'my_workspace',
      target: 'org_pipeline_item',
      params: pipelineItemId ? { pipelineItemId } : {},
    });
    navigate(target.path, { state: target.state });
  }, [navigate, organizationId]);

  const myDrafts = useMemo(() => (
    posts
      .filter((post) => post.user_id === user?.id && post.status === 'draft')
      .sort((left, right) => new Date(right.updated_at || right.created_at || 0) - new Date(left.updated_at || left.created_at || 0))
  ), [posts, user?.id]);

  const mySubmittedItems = useMemo(() => (
    pipelineItems
      .filter((item) => item.submitted_by === user?.id)
      .sort((left, right) => new Date(right.updated_at || right.created_at || 0) - new Date(left.updated_at || left.created_at || 0))
  ), [pipelineItems, user?.id]);

  const myReviewLoad = useMemo(() => (
    pipelineItems.filter((item) => (
      item.current_assignee_user_id === user?.id
      && ACTIVE_PIPELINE_STATUSES.has(item.status)
    ))
  ), [pipelineItems, user?.id]);

  const myRevisionItems = useMemo(() => (
    mySubmittedItems.filter((item) => item.status === 'revision_requested' && (item.linkedPost?.id || item.post_id))
  ), [mySubmittedItems]);

  const myReadyToSchedule = useMemo(() => (
    mySubmittedItems.filter((item) => (
      item.status === 'approved'
      && (item.linkedPost?.id || item.post_id)
      && !item.linkedPost?.scheduled_at
    ))
  ), [mySubmittedItems]);

  const myUpcomingPosts = useMemo(() => (
    posts
      .filter((post) => post.user_id === user?.id && post.status === 'scheduled' && isFutureDate(post.scheduled_at))
      .sort((left, right) => new Date(left.scheduled_at) - new Date(right.scheduled_at))
  ), [posts, user?.id]);

  const myTasks = useMemo(() => (
    tasks
      .filter((task) => task.assignee_user_id === user?.id)
      .sort((left, right) => {
        const leftTime = new Date(left.due_at || left.created_at || 0).getTime();
        const rightTime = new Date(right.due_at || right.created_at || 0).getTime();
        return leftTime - rightTime;
      })
  ), [tasks, user?.id]);

  const myOpenTasks = useMemo(() => (
    myTasks.filter((task) => String(task.status?.key || '').trim().toLowerCase() !== COMPLETED_TASK_KEY)
  ), [myTasks]);

  const myDueSoonTasks = useMemo(() => (
    myOpenTasks.filter((task) => isDueSoon(task.due_at, 72))
  ), [myOpenTasks]);

  const myBlockedTasks = useMemo(() => (
    myOpenTasks.filter((task) => Boolean(task.is_blocked))
  ), [myOpenTasks]);

  const workspaceCards = useMemo(() => ([
    {
      title: 'My Drafts',
      value: myDrafts.length,
      subtitle: 'Draft posts still in progress',
      onClick: () => navigate(`/app/org/${organizationId}/office`),
    },
    {
      title: 'My Pipeline',
      value: mySubmittedItems.filter((item) => ACTIVE_PIPELINE_STATUSES.has(item.status)).length,
      subtitle: `${myReviewLoad.length} assigned to you / ${myRevisionItems.length} revisions`,
      tone: 'warning',
      onClick: () => openPipelineWorkspace(
        mySubmittedItems.find((item) => ACTIVE_PIPELINE_STATUSES.has(item.status))?.id || null,
      ),
    },
    {
      title: 'Assigned Tasks',
      value: myOpenTasks.length,
      subtitle: `${myDueSoonTasks.length} due soon / ${myBlockedTasks.length} blocked`,
      tone: myBlockedTasks.length > 0 ? 'danger' : 'default',
      onClick: () => openTaskWorkspace(myOpenTasks[0]?.id || null),
    },
    {
      title: 'Upcoming Schedule',
      value: myUpcomingPosts.length,
      subtitle: 'Scheduled content on the org calendar',
      tone: 'success',
      onClick: () => navigate(`/app/org/${organizationId}/calendar`),
    },
  ]), [
    myBlockedTasks.length,
    myDrafts.length,
    myDueSoonTasks.length,
    myOpenTasks,
    myReviewLoad.length,
    myRevisionItems.length,
    mySubmittedItems,
    myUpcomingPosts.length,
    openPipelineWorkspace,
    openTaskWorkspace,
    organizationId,
  ]);

  const actionItems = useMemo(() => {
    const items = [];

    myRevisionItems.slice(0, 2).forEach((item) => {
      const revisionComment = getLatestRevisionComment(item);
      items.push({
        key: `revision:${item.id}`,
        eyebrow: 'Changes Requested',
        title: getPipelineTitle(item),
        description: revisionComment
          ? revisionComment
          : 'A reviewer requested changes. Re-open the draft, update it, and resubmit.',
        tone: 'warning',
        actionLabel: 'Open Revision',
        onAction: () => openComposer({
          mode: 'revision',
          editPostId: item.linkedPost?.id || item.post_id,
          contextNote: revisionComment || '',
        }),
      });
    });

    if (canSchedule) {
      myReadyToSchedule.slice(0, 2).forEach((item) => {
        items.push({
          key: `schedule:${item.id}`,
          eyebrow: 'Ready to Schedule',
          title: getPipelineTitle(item),
          description: 'Approved content is ready for placement on the org calendar.',
          tone: 'success',
          actionLabel: 'Open Schedule',
          onAction: () => setScheduleTarget(buildScheduleTarget(item)),
        });
      });
    }

    myDueSoonTasks.slice(0, 2).forEach((task) => {
      items.push({
        key: `task:${task.id}`,
        eyebrow: 'Task Due Soon',
        title: getTaskTitle(task),
        description: task.due_at
          ? `Due ${formatDateTime(task.due_at)}`
          : 'This task needs attention soon.',
        tone: 'danger',
        actionLabel: 'Open Task',
        onAction: () => openTaskWorkspace(task.id),
      });
    });

    myBlockedTasks
      .filter((task) => !myDueSoonTasks.some((candidate) => candidate.id === task.id))
      .slice(0, 2)
      .forEach((task) => {
      items.push({
        key: `blocked:${task.id}`,
        eyebrow: 'Blocked Task',
        title: getTaskTitle(task),
        description: task.blocked_reason || 'This task is blocked and needs a decision or unblocker.',
        tone: 'warning',
        actionLabel: 'Review Task',
        onAction: () => openTaskWorkspace(task.id),
      });
    });

    return items;
  }, [canSchedule, myBlockedTasks, myDueSoonTasks, myReadyToSchedule, myRevisionItems, openComposer, openTaskWorkspace]);

  const visibleActionItems = useMemo(() => {
    const dismissed = new Set(dashboardState.dismissed_action_keys || []);
    return actionItems.filter((item) => !dismissed.has(item.key));
  }, [actionItems, dashboardState.dismissed_action_keys]);

  const dismissAction = useCallback(async (actionKey) => {
    const nextKeys = [...new Set([...(dashboardState.dismissed_action_keys || []), actionKey])];
    await persistDashboardState({
      dismissed_action_keys: nextKeys,
    });
  }, [dashboardState.dismissed_action_keys, persistDashboardState]);

  const resetDismissedActions = useCallback(async () => {
    await persistDashboardState({
      dismissed_action_keys: [],
    });
  }, [persistDashboardState]);

  const toggleTeamPulse = useCallback(async () => {
    await persistDashboardState({
      team_pulse_collapsed: !dashboardState.team_pulse_collapsed,
    });
  }, [dashboardState.team_pulse_collapsed, persistDashboardState]);

  const teamPulseCards = useMemo(() => ([
    {
      label: 'Approved Queue',
      value: stats.approvedQueueCount,
      note: 'Ready for scheduling',
    },
    {
      label: 'Items In Review',
      value: stats.inReviewCount,
      note: 'Currently in approval',
    },
    {
      label: 'Open Tasks',
      value: stats.taskOpenCount,
      note: `${stats.taskBlockedCount} blocked across the team`,
    },
  ]), [stats.approvedQueueCount, stats.inReviewCount, stats.taskBlockedCount, stats.taskOpenCount]);

  const heroTitle = isOrgAdmin
    ? 'Member workspace home'
    : 'Your org workspace home';

  const heroNote = isOrgAdmin
    ? 'Use this page for personal execution. Org-wide monitoring remains on Overview.'
    : 'Pick up revisions, schedule approved work, and keep your assigned tasks moving.';

  return (
    <section className="org-page my-workspace-page">
      <div className="my-workspace-hero">
        <div className="my-workspace-hero-copy">
          <span className="my-workspace-kicker">My Workspace</span>
          <h1>{heroTitle}</h1>
          <p>
            {organization?.name || 'Organization'}
            {activeBrandProject?.name ? ` / ${activeBrandProject.name}` : ''}
          </p>
          <span className="my-workspace-hero-note">
            {formatRoleLabel(role)} / {heroNote}
          </span>
        </div>

        <div className="my-workspace-hero-actions">
          <button
            type="button"
            className="my-workspace-primary-button"
            onClick={() => openComposer({ mode: 'new' })}
          >
            <Sparkles size={15} />
            Generate Content
          </button>
          <button
            type="button"
            className="my-workspace-secondary-button"
            onClick={() => navigate(`/app/org/${organizationId}/office`)}
          >
            <FolderKanban size={15} />
            Open My Office
          </button>
          {isOrgAdmin ? (
            <button
              type="button"
              className="my-workspace-secondary-button"
              onClick={() => navigate(`/app/org/${organizationId}/overview`)}
            >
              <Workflow size={15} />
              Go to Overview
            </button>
          ) : null}
        </div>
      </div>

      <div className="org-stat-grid">
        {workspaceCards.map((card) => (
          <OrgStatCard key={card.title} {...card} />
        ))}
      </div>

      <div className="org-two-column wide-left">
        <div className="my-workspace-stack">
          <section className="org-panel">
            <div className="org-panel-header">
              <div>
                <h3>Action Required</h3>
                <p>Dismissed actions stay hidden for this member until you reset them.</p>
              </div>

              {dashboardState.dismissed_action_keys?.length > 0 ? (
                <button
                  type="button"
                  className="org-text-button"
                  onClick={() => void resetDismissedActions()}
                  disabled={savingState}
                >
                  Reset hidden
                </button>
              ) : null}
            </div>

            {loading || stateLoading ? (
              <div className="org-panel-loading">Loading actions...</div>
            ) : visibleActionItems.length === 0 ? (
              <OrgEmptyState
                eyebrow="Action Required"
                title="Nothing urgent right now"
                description="When revisions, due-soon tasks, or ready-to-schedule items appear, they will show up here."
              />
            ) : (
              <div className="my-workspace-action-list">
                {visibleActionItems.map((item) => (
                  <article key={item.key} className={`my-workspace-action-card tone-${item.tone}`}>
                    <div className="my-workspace-action-copy">
                      <span className="my-workspace-action-eyebrow">{item.eyebrow}</span>
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                    </div>

                    <div className="my-workspace-action-actions">
                      <button
                        type="button"
                        className="my-workspace-inline-button"
                        onClick={item.onAction}
                      >
                        {item.actionLabel}
                      </button>
                      <button
                        type="button"
                        className="my-workspace-icon-button"
                        onClick={() => void dismissAction(item.key)}
                        aria-label={`Dismiss ${item.title}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="org-panel">
            <div className="org-panel-header">
              <div>
                <h3>My Pipeline</h3>
                <p>Recent submissions, revisions, and approvals tied to your work.</p>
              </div>

              <button
                type="button"
                className="org-text-button"
                onClick={() => openPipelineWorkspace()}
              >
                View Pipeline
              </button>
            </div>

            {loading ? (
              <div className="org-panel-loading">Loading pipeline activity...</div>
            ) : mySubmittedItems.length === 0 ? (
              <OrgEmptyState
                eyebrow="Pipeline"
                title="No submitted items yet"
                description="Send a draft from My Office to start review and scheduling inside the org workspace."
              />
            ) : (
              <div className="my-workspace-list">
                {mySubmittedItems.slice(0, 6).map((item) => {
                  const revisionComment = getLatestRevisionComment(item);
                  const canRevise = item.status === 'revision_requested' && (item.linkedPost?.id || item.post_id);
                  const canOpenSchedule = canSchedule
                    && item.status === 'approved'
                    && (item.linkedPost?.id || item.post_id)
                    && !item.linkedPost?.scheduled_at;

                  return (
                    <article key={item.id} className="my-workspace-item-card">
                      <div className="my-workspace-item-copy">
                        <strong>{getPipelineTitle(item)}</strong>
                        <span>
                          {item.currentStageName || 'Awaiting review'} / {formatDateTime(item.updated_at || item.created_at)}
                        </span>
                        {revisionComment ? <p>{revisionComment}</p> : null}
                      </div>

                      <div className="my-workspace-item-actions">
                        <span className={`my-workspace-status-pill tone-${item.status === 'revision_requested' ? 'warning' : (item.status === 'approved' ? 'success' : 'default')}`}>
                          {String(item.status || 'pending').replace(/_/g, ' ')}
                        </span>
                        {canRevise ? (
                          <button
                            type="button"
                            className="my-workspace-inline-button"
                            onClick={() => openComposer({
                              mode: 'revision',
                              editPostId: item.linkedPost?.id || item.post_id,
                              contextNote: revisionComment || '',
                            })}
                          >
                            Revise
                          </button>
                        ) : null}
                        {canOpenSchedule ? (
                          <button
                            type="button"
                            className="my-workspace-inline-button"
                            onClick={() => setScheduleTarget(buildScheduleTarget(item))}
                          >
                            Schedule
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="my-workspace-inline-button"
                          onClick={() => openPipelineWorkspace(item.id)}
                        >
                          Open
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="my-workspace-stack">
          <section className="org-panel">
            <div className="org-panel-header">
              <div>
                <h3>Assigned Tasks</h3>
                <p>Your current workload across calendar, tasks, and approvals.</p>
              </div>

              {myOpenTasks.length > 0 || canManageTasks ? (
                <button
                  type="button"
                  className="org-text-button"
                  onClick={() => openTaskWorkspace(myOpenTasks[0]?.id || null)}
                >
                  Open Tasks
                </button>
              ) : null}
            </div>

            {loading ? (
              <div className="org-panel-loading">Loading tasks...</div>
            ) : myOpenTasks.length === 0 ? (
              <OrgEmptyState
                eyebrow="Tasks"
                title="No assigned tasks"
                description="Assigned work will appear here once tasks are linked or created for you."
              />
            ) : (
              <div className="my-workspace-task-list">
                {myOpenTasks.slice(0, 5).map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className={`my-workspace-task-card ${task.is_blocked ? 'blocked' : ''}`}
                    onClick={() => openTaskWorkspace(task.id)}
                  >
                    <div className="my-workspace-task-main">
                      <div className="my-workspace-task-top">
                        <strong>{getTaskTitle(task)}</strong>
                        <span className={`my-workspace-status-pill tone-${task.is_blocked ? 'danger' : (isDueSoon(task.due_at, 72) ? 'warning' : 'default')}`}>
                          {task.status?.name || 'Task'}
                        </span>
                      </div>
                      <span>
                        {task.due_at ? `Due ${formatShortDate(task.due_at)}` : 'No due date'}
                        {task.linked_pipeline_item?.title ? ` / ${truncateText(task.linked_pipeline_item.title, 48)}` : ''}
                      </span>
                      {task.is_blocked && task.blocked_reason ? (
                        <p>{task.blocked_reason}</p>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="org-panel">
            <div className="org-panel-header">
              <div>
                <h3>Team Pulse</h3>
                <p>Shared pressure, queue health, and workspace movement.</p>
              </div>

              <button
                type="button"
                className="my-workspace-collapse-button"
                onClick={() => void toggleTeamPulse()}
                disabled={savingState}
                aria-expanded={!dashboardState.team_pulse_collapsed}
              >
                {dashboardState.team_pulse_collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
                {dashboardState.team_pulse_collapsed ? 'Show' : 'Hide'}
              </button>
            </div>

            {dashboardState.team_pulse_collapsed ? (
              <div className="my-workspace-collapsed-note">
                Team Pulse is collapsed for this member.
              </div>
            ) : loading ? (
              <div className="org-panel-loading">Loading team pulse...</div>
            ) : (
              <div className="my-workspace-pulse">
                <div className="my-workspace-pulse-grid">
                  {teamPulseCards.map((card) => (
                    <article key={card.label} className="my-workspace-pulse-card">
                      <span>{card.label}</span>
                      <strong>{card.value}</strong>
                      <p>{card.note}</p>
                    </article>
                  ))}
                </div>

                <div className="my-workspace-pulse-notes">
                  <article className="org-note-card">
                    <strong>{stats.activeMembers} active members</strong>
                    <p>The workspace is live across approvals, tasks, and shared scheduling.</p>
                  </article>

                  <article className="org-note-card">
                    <strong>{stats.taskDueSoonCount} tasks due within 48 hours</strong>
                    <p>Use the task board to rebalance workload before items slip or block reviewers.</p>
                  </article>

                  {stats.bottleneckLanes?.length ? (
                    <article className="org-note-card">
                      <strong>Top bottleneck</strong>
                      <p>
                        {stats.bottleneckLanes[0].label} / pressure score {stats.bottleneckLanes[0].pressureScore}
                      </p>
                    </article>
                  ) : (
                    <article className="org-note-card">
                      <strong>No major bottlenecks</strong>
                      <p>Queue pressure is currently balanced across the active workflow lanes.</p>
                    </article>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="org-panel">
            <div className="org-panel-header">
              <div>
                <h3>Upcoming Schedule</h3>
                <p>What is already lined up on the org calendar for your content.</p>
              </div>

              <button
                type="button"
                className="org-text-button"
                onClick={() => navigate(`/app/org/${organizationId}/calendar`)}
              >
                Open Calendar
              </button>
            </div>

            {loading ? (
              <div className="org-panel-loading">Loading schedule...</div>
            ) : myUpcomingPosts.length === 0 ? (
              <OrgEmptyState
                eyebrow="Schedule"
                title="Nothing scheduled yet"
                description="Approved content that gets placed on the calendar will appear here."
              />
            ) : (
              <div className="my-workspace-list">
                {myUpcomingPosts.slice(0, 4).map((post) => (
                  <article key={post.id} className="my-workspace-item-card">
                    <div className="my-workspace-item-copy">
                      <strong>{getDraftTitle(post)}</strong>
                      <span>{formatDateTime(post.scheduled_at)}</span>
                    </div>

                    <div className="my-workspace-item-actions">
                      <span className="my-workspace-status-pill tone-success">
                        Scheduled
                      </span>
                      <button
                        type="button"
                        className="my-workspace-inline-button"
                        onClick={() => setScheduleTarget({
                          postId: post.id,
                          pipelineItemId: post.pipeline_item_id || null,
                          record: {
                            postId: post.id,
                            pipelineItemId: post.pipeline_item_id || null,
                            title: getDraftTitle(post),
                            scheduledAt: post.scheduled_at,
                            lifecycleStatus: post.status,
                            canScheduleAction: canSchedule,
                            rawPost: post,
                          },
                        })}
                      >
                        {canSchedule ? 'Open Schedule' : 'Details'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <OrgGenerateComposer
        open={composerOpen}
        intent={composerIntent}
        onClose={() => {
          setComposerOpen(false);
          setComposerIntent(null);
          void refresh();
        }}
      />

      <OrgScheduleModal
        open={Boolean(scheduleTarget)}
        record={scheduleTarget?.record || null}
        postId={scheduleTarget?.postId || null}
        pipelineItemId={scheduleTarget?.pipelineItemId || null}
        onClose={() => setScheduleTarget(null)}
        onScheduled={async () => {
          await refresh();
        }}
      />
    </section>
  );
}
