import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertCircle, CheckCircle2, Clock3, ListFilter, Loader2, Plus } from 'lucide-react';
import { useAppNavigation } from '../../../Context/AppNavigationContext';
import { buildDeepLink } from '../../../utils/buildDeepLink';
import TaskCreateModal from './TaskCreateModal';

const FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'blocked', label: 'Blocked' },
];

const STATUS_OPTIONS = [
  { key: 'pending', label: 'Pending' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'blocked', label: 'Blocked' },
];

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStatusKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function resolveTaskState(task) {
  if (task?.is_blocked) return 'blocked';
  const statusKey = normalizeStatusKey(task?.status?.key || task?.status_key || '');
  if (statusKey === 'completed' || statusKey === 'done') return 'completed';
  if (statusKey === 'in_progress' || statusKey === 'in_review' || statusKey === 'review') return 'in_progress';
  return 'pending';
}

function getTaskStatusLabel(value) {
  return STATUS_OPTIONS.find((option) => option.key === value)?.label || 'Pending';
}

function formatDueLabel(dueAt, taskState) {
  if (!dueAt) {
    return { text: 'No due date', tone: 'neutral' };
  }

  const nextDate = new Date(dueAt);
  if (Number.isNaN(nextDate.getTime())) {
    return { text: 'Invalid due date', tone: 'neutral' };
  }

  const dateLabel = nextDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  if (taskState !== 'completed' && nextDate.getTime() < Date.now()) {
    return { text: `Overdue - ${dateLabel}`, tone: 'danger' };
  }

  return { text: `Due ${dateLabel}`, tone: 'normal' };
}

function buildTaskSearchText(task) {
  return [
    task.title,
    task.description,
    task.creator_profile?.full_name,
    task.creator_profile?.email,
    task.assignee_profile?.full_name,
    task.assignee_profile?.email,
    task.linked_post?.title,
    task.linked_post?.caption,
    task.linked_pipeline_item?.title,
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
}

function createStatusLookup(statuses = []) {
  const byKey = new Map(
    safeArray(statuses).map((status) => [normalizeStatusKey(status.key), status.id]),
  );

  const pending = byKey.get('todo') || byKey.get('pending') || byKey.get('open') || null;
  const inProgress = byKey.get('in_progress') || byKey.get('in_review') || byKey.get('review') || pending;
  const completed = byKey.get('completed') || byKey.get('done') || null;

  return {
    pending,
    in_progress: inProgress,
    completed,
  };
}

function getLinkedThumbnail(task) {
  const generation = Array.isArray(task?.linked_post?.generations)
    ? task.linked_post.generations[0]
    : task?.linked_post?.generations;
  return generation?.storage_path || null;
}

function getLinkedTitle(task) {
  return (
    task?.linked_pipeline_item?.title
    || task?.linked_post?.title
    || task?.linked_post?.caption
    || 'Linked content'
  );
}

function getCreatorLabel(task, currentUserId) {
  if (!task?.created_by) return 'System';
  if (task.created_by === currentUserId) return 'You';
  return task?.creator_profile?.full_name || task?.creator_profile?.email || 'Admin';
}

function TaskSection({
  title,
  rows = [],
  currentUserId,
  canEditStatus,
  statusSavingId,
  onStatusChange,
  onOpenLinkedContent,
  requestedTaskId,
}) {
  return (
    <section className="pipeline-task-section">
      <header className="pipeline-task-section-head">
        <h3>{title}</h3>
        <span>{rows.length}</span>
      </header>

      {rows.length === 0 ? (
        <div className="pipeline-task-empty-inline">No tasks in this section.</div>
      ) : (
        <div className="pipeline-task-card-grid">
          {rows.map((task) => {
            const taskState = resolveTaskState(task);
            const dueLabel = formatDueLabel(task.due_at, taskState);
            const linkedTitle = getLinkedTitle(task);
            const thumbnailUrl = getLinkedThumbnail(task);
            const canChangeStatus = canEditStatus(task);
            const isFocused = requestedTaskId && task.id === requestedTaskId;

            return (
              <article
                key={task.id}
                data-task-id={task.id}
                className={`pipeline-task-card tone-${taskState} ${isFocused ? 'focused' : ''}`.trim()}
              >
                <div className="pipeline-task-card-top">
                  <strong>{task.title || 'Untitled task'}</strong>
                  <span className={`pipeline-task-status-badge tone-${taskState}`.trim()}>
                    {getTaskStatusLabel(taskState)}
                  </span>
                </div>

                <div className={`pipeline-task-due ${dueLabel.tone}`.trim()}>
                  {taskState === 'completed' ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}
                  <span>{dueLabel.text}</span>
                </div>

                <p className="pipeline-task-assigned-by">
                  Assigned by: <strong>{getCreatorLabel(task, currentUserId)}</strong>
                </p>

                {task.description ? (
                  <p className="pipeline-task-description">{task.description}</p>
                ) : null}

                {(task.linked_pipeline_item_id || task.linked_post_id) ? (
                  <button
                    type="button"
                    className="pipeline-task-linked-content"
                    onClick={() => onOpenLinkedContent(task)}
                  >
                    {thumbnailUrl ? (
                      <img src={thumbnailUrl} alt="" />
                    ) : (
                      <span className="pipeline-task-thumb-fallback">Content</span>
                    )}
                    <span>
                      <strong>{linkedTitle}</strong>
                      <small>{task.linked_pipeline_item_id ? 'Pipeline item' : 'Generated content'}</small>
                    </span>
                  </button>
                ) : null}

                <label className="pipeline-task-status-control">
                  <span>Update status</span>
                  <select
                    value={taskState}
                    disabled={!canChangeStatus || statusSavingId === task.id}
                    onChange={(event) => onStatusChange(task, event.target.value)}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function PipelineTasksPanel({
  organizationId,
  currentUserId,
  isOrgAdmin = false,
  loading = false,
  tasks = [],
  taskStatuses = [],
  members = [],
  pipelineItems = [],
  posts = [],
  requestedTaskId = null,
  onCreateTask,
  onSaveTask,
}) {
  const { navigate } = useAppNavigation();
  const [filterKey, setFilterKey] = useState('all');
  const [searchValue, setSearchValue] = useState('');
  const [statusSavingId, setStatusSavingId] = useState('');
  const [createTaskOpen, setCreateTaskOpen] = useState(false);

  const statusLookup = useMemo(() => createStatusLookup(taskStatuses), [taskStatuses]);

  const relevantTasks = useMemo(() => (
    safeArray(tasks)
      .filter((task) => task.assignee_user_id === currentUserId || task.created_by === currentUserId)
      .map((task) => ({ ...task, _state: resolveTaskState(task) }))
      .filter((task) => {
        if (filterKey !== 'all' && task._state !== filterKey) return false;
        if (!searchValue.trim()) return true;
        return buildTaskSearchText(task).includes(searchValue.trim().toLowerCase());
      })
      .sort((left, right) => {
        const leftTime = new Date(left.due_at || left.created_at || 0).getTime();
        const rightTime = new Date(right.due_at || right.created_at || 0).getTime();
        return leftTime - rightTime;
      })
  ), [currentUserId, filterKey, searchValue, tasks]);

  const assignedToMe = useMemo(
    () => relevantTasks.filter((task) => task.assignee_user_id === currentUserId && task._state !== 'completed'),
    [currentUserId, relevantTasks],
  );
  const createdByMe = useMemo(
    () => relevantTasks.filter((task) => task.created_by === currentUserId && task._state !== 'completed'),
    [currentUserId, relevantTasks],
  );
  const completedTasks = useMemo(
    () => relevantTasks.filter((task) => task._state === 'completed'),
    [relevantTasks],
  );

  useEffect(() => {
    if (!requestedTaskId) return;
    const node = document.querySelector(`[data-task-id="${requestedTaskId}"]`);
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [requestedTaskId, assignedToMe.length, completedTasks.length, createdByMe.length]);

  const postOptions = useMemo(
    () => safeArray(posts).map((post) => ({
      id: post.id,
      title: post.title || post.caption || post.media?.prompt || 'Generated content',
      status: post.status,
    })),
    [posts],
  );

  const pipelineOptions = useMemo(
    () => safeArray(pipelineItems).map((item) => ({
      id: item.id,
      title: item.title || item.linkedPost?.title || item.linkedPost?.caption || 'Pipeline item',
      status: item.status,
    })),
    [pipelineItems],
  );

  const canEditStatus = (task) => {
    if (!task) return false;
    if (isOrgAdmin) return true;
    return task.assignee_user_id === currentUserId;
  };

  const handleCreateTask = useCallback(async (payload) => {
    try {
      await onCreateTask?.({
        organization_id: organizationId,
        ...payload,
      });
      toast.success('Task created.');
    } catch (error) {
      toast.error(error?.message || 'Could not create this task.');
      throw error;
    }
  }, [onCreateTask, organizationId]);

  const handleStatusChange = async (task, nextState) => {
    if (!task?.id) return;
    if (!canEditStatus(task)) return;

    const updates = {
      is_blocked: nextState === 'blocked',
      completed_at: nextState === 'completed' ? new Date().toISOString() : null,
    };

    if (nextState === 'blocked') {
      updates.status_id = statusLookup.in_progress || task.status_id;
    } else if (nextState === 'completed') {
      updates.status_id = statusLookup.completed || task.status_id;
    } else if (nextState === 'in_progress') {
      updates.status_id = statusLookup.in_progress || task.status_id;
    } else if (nextState === 'pending') {
      updates.status_id = statusLookup.pending || task.status_id;
    }

    setStatusSavingId(task.id);
    try {
      await onSaveTask?.(task.id, updates);
      toast.success('Task status updated.');
    } catch (error) {
      toast.error(error?.message || 'Could not update this task status.');
    } finally {
      setStatusSavingId('');
    }
  };

  const handleOpenLinkedContent = (task) => {
    if (task?.linked_pipeline_item_id) {
      const target = buildDeepLink({
        path: `/app/org/${organizationId}/pipeline`,
        source: 'pipeline_tasks',
        target: 'pipeline_item',
        params: { pipelineItemId: task.linked_pipeline_item_id },
      });
      navigate(target.path, { state: target.state });
      return;
    }

    if (task?.linked_post_id) {
      navigate(`/app/org/${organizationId}/office`);
    }
  };

  return (
    <div className="pipeline-task-panel">
      <div className="pipeline-task-toolbar">
        <div className="pipeline-task-filter-strip">
          <span className="pipeline-task-filter-label">
            <ListFilter size={14} />
            Filters
          </span>
          <div className="pipeline-task-filter-pills">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={filterKey === option.key ? 'active' : ''}
                onClick={() => setFilterKey(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pipeline-task-toolbar-actions">
          <input
            type="search"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Search tasks, assignee, or linked content"
          />
          {isOrgAdmin ? (
            <button type="button" className="org-primary-button" onClick={() => setCreateTaskOpen(true)}>
              <Plus size={14} />
              New Task
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="pipeline-task-loading">
          <Loader2 size={16} className="org-spin" />
          <span>Loading tasks...</span>
        </div>
      ) : relevantTasks.length === 0 ? (
        <div className="pipeline-task-empty">
          <AlertCircle size={16} />
          <span>No tasks match this filter yet.</span>
        </div>
      ) : (
        <div className="pipeline-task-section-stack">
          <TaskSection
            title="Assigned to Me"
            rows={assignedToMe}
            currentUserId={currentUserId}
            canEditStatus={canEditStatus}
            statusSavingId={statusSavingId}
            onStatusChange={handleStatusChange}
            onOpenLinkedContent={handleOpenLinkedContent}
            requestedTaskId={requestedTaskId}
          />

          <TaskSection
            title="Created by Me"
            rows={createdByMe}
            currentUserId={currentUserId}
            canEditStatus={canEditStatus}
            statusSavingId={statusSavingId}
            onStatusChange={handleStatusChange}
            onOpenLinkedContent={handleOpenLinkedContent}
            requestedTaskId={requestedTaskId}
          />

          <TaskSection
            title="Completed"
            rows={completedTasks}
            currentUserId={currentUserId}
            canEditStatus={canEditStatus}
            statusSavingId={statusSavingId}
            onStatusChange={handleStatusChange}
            onOpenLinkedContent={handleOpenLinkedContent}
            requestedTaskId={requestedTaskId}
          />
        </div>
      )}

      <TaskCreateModal
        open={createTaskOpen}
        statuses={taskStatuses}
        members={members}
        postOptions={postOptions}
        pipelineOptions={pipelineOptions}
        defaultBrandProjectId={null}
        currentUserId={currentUserId}
        onClose={() => setCreateTaskOpen(false)}
        onCreate={handleCreateTask}
      />
    </div>
  );
}
