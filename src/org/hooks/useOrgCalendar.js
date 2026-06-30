import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { useAuth } from '../../Context/AuthContext';
import useOrgContext from './useOrgContext';
import {
  createOrgTask,
  createOrgTaskStatus,
  deleteOrgTask,
  deleteOrgTaskStatus,
  notifyOrgTaskUsers,
  appendOrgTaskNote,
  updateOrgTask,
  updateOrgTaskStatus,
} from '../services/taskService';
import {
  deleteOrgCalendarViewPreset,
  executeOrgCalendarBatchSchedule,
  fetchOrgCalendarViewPresets,
  fetchOrgCalendarSnapshot,
  previewOrgCalendarBatchSchedule,
  publishOrgCalendarRecord,
  saveOrgCalendarViewPreset,
  scheduleOrgCalendarRecord,
  updateOrgCalendarViewPreset,
} from '../services/orgCalendarService';
import { advancePipelineItem } from '../services/pipelineService';

const ADVANCED_CALENDAR_ROLES = new Set(['org_owner', 'org_admin', 'editor']);
const FULL_VIEW_IDS = ['calendar', 'week', 'timeline', 'board', 'queue', 'approval', 'workload', 'tasks'];
const BASIC_VIEW_IDS = ['calendar', 'week', 'tasks'];

export function useOrgCalendar() {
  const { user } = useAuth();
  const {
    organizationId,
    brandProjectId,
    hasPermission,
    role,
  } = useOrgContext();
  const [state, setState] = useState({
    loading: true,
    error: '',
    members: [],
    posts: [],
    pipelineItems: [],
    pipelineConfigs: [],
    taskStatuses: [],
    tasks: [],
    approvedQueue: [],
    assets: [],
    postAssetLinks: [],
    stats: {
      scheduledThisWeek: 0,
      publishedThisMonth: 0,
      approvedQueueCount: 0,
      inReviewCount: 0,
      overdueCount: 0,
      activeMembers: 0,
      recentAssetCount: 0,
      taskOpenCount: 0,
      taskBlockedCount: 0,
      taskDueSoonCount: 0,
      taskCompletedThisWeek: 0,
      pipelineByRole: {},
      bottleneckLanes: [],
    },
  });
  const [presets, setPresets] = useState([]);
  const [presetsLoading, setPresetsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!organizationId) {
      setState((current) => ({ ...current, loading: false, error: '' }));
      return;
    }

    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const nextSnapshot = await fetchOrgCalendarSnapshot({ organizationId, brandProjectId });
      setState({
        loading: false,
        error: '',
        ...nextSnapshot,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error?.message || 'Failed to load the org calendar.',
      }));
    }
  }, [brandProjectId, organizationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshPresets = useCallback(async () => {
    if (!organizationId) {
      setPresets([]);
      setPresetsLoading(false);
      return;
    }

    setPresetsLoading(true);
    try {
      const nextPresets = await fetchOrgCalendarViewPresets({ organizationId });
      setPresets(nextPresets);
    } catch (error) {
      console.error('Failed to load org calendar presets:', error);
      setPresets([]);
    } finally {
      setPresetsLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void refreshPresets();
  }, [refreshPresets]);

  useEffect(() => {
    if (!organizationId) return undefined;

    const channel = supabase
      .channel(`org-calendar-${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'posts',
          filter: `organization_id=eq.${organizationId}`,
        },
        async () => {
          await refresh();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pipeline_items',
          filter: `organization_id=eq.${organizationId}`,
        },
        async () => {
          await refresh();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'org_tasks',
          filter: `organization_id=eq.${organizationId}`,
        },
        async () => {
          await refresh();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'org_task_statuses',
          filter: `organization_id=eq.${organizationId}`,
        },
        async () => {
          await refresh();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, refresh]);

  const canSchedule = hasPermission('can_schedule');
  const canPublish = hasPermission('can_publish');
  const canManageTasks = hasPermission('can_manage_tasks');
  const isAdvancedCalendarUser = ADVANCED_CALENDAR_ROLES.has(String(role || '').trim());
  const visibleViews = useMemo(
    () => (isAdvancedCalendarUser ? FULL_VIEW_IDS : BASIC_VIEW_IDS),
    [isAdvancedCalendarUser],
  );

  const scheduleRecord = useCallback(async ({
    postId,
    pipelineItemId = null,
    scheduledAt,
  }) => {
    await scheduleOrgCalendarRecord({
      postId,
      pipelineItemId,
      scheduledAt,
    });
    await refresh();
  }, [refresh]);

  const publishRecord = useCallback(async ({ pipelineItemId }) => {
    try {
      const result = await publishOrgCalendarRecord(pipelineItemId);
      await refresh();
      return result;
    } catch (error) {
      await refresh();
      throw error;
    }
  }, [refresh]);

  const actOnPipelineItem = useCallback(async ({
    pipelineItemId,
    action,
    comment,
    scheduledFor,
  }) => {
    await advancePipelineItem({
      pipeline_item_id: pipelineItemId,
      action,
      comment,
      scheduled_for: scheduledFor,
    });
    await refresh();
  }, [refresh]);

  const createPreset = useCallback(async (payload) => {
    const saved = await saveOrgCalendarViewPreset(payload);
    await refreshPresets();
    return saved;
  }, [refreshPresets]);

  const updatePreset = useCallback(async (presetId, updates) => {
    const saved = await updateOrgCalendarViewPreset(presetId, updates);
    await refreshPresets();
    return saved;
  }, [refreshPresets]);

  const deletePreset = useCallback(async (presetId) => {
    await deleteOrgCalendarViewPreset(presetId);
    await refreshPresets();
  }, [refreshPresets]);

  const previewBatchSchedule = useCallback((payload) => previewOrgCalendarBatchSchedule(payload), []);

  const executeBatchSchedule = useCallback(async (payload) => {
    const results = await executeOrgCalendarBatchSchedule(payload);
    await refresh();
    return results;
  }, [refresh]);

  const createTask = useCallback(async (payload) => {
    const createdTask = await createOrgTask(payload);
    if (payload.assignee_user_id && payload.assignee_user_id !== user?.id) {
      await notifyOrgTaskUsers({
        organization_id: organizationId,
        task_id: createdTask.id,
        recipients: [payload.assignee_user_id],
        title: 'New task assigned',
        body: `${user?.user_metadata?.full_name || user?.email || 'A teammate'} assigned you a task: ${payload.title}.`,
        action_url: `/app/org/${organizationId}/pipeline/tasks?taskId=${createdTask.id}`,
        metadata: {
          requested_type: 'org_task_assigned',
          task_id: createdTask.id,
        },
      });
    }
    await refresh();
    return createdTask;
  }, [organizationId, refresh, user?.email, user?.id, user?.user_metadata?.full_name]);

  const saveTask = useCallback(async (taskId, updates) => {
    const previousTask = state.tasks.find((task) => task.id === taskId) || null;
    const savedTask = await updateOrgTask(taskId, updates);

    const recipients = new Set();
    if (savedTask.assignee_user_id && savedTask.assignee_user_id !== user?.id) {
      recipients.add(savedTask.assignee_user_id);
    }
    if (previousTask?.assignee_user_id && previousTask.assignee_user_id !== user?.id) {
      recipients.add(previousTask.assignee_user_id);
    }

    if (recipients.size > 0) {
      await notifyOrgTaskUsers({
        organization_id: organizationId,
        task_id: taskId,
        recipients: [...recipients],
        title: 'Task updated',
        body: `${user?.user_metadata?.full_name || user?.email || 'A teammate'} updated task: ${updates.title || previousTask?.title || 'Task'}.`,
        action_url: `/app/org/${organizationId}/pipeline/tasks?taskId=${taskId}`,
        metadata: {
          requested_type: 'org_task_updated',
          task_id: taskId,
        },
      });
    }

    await refresh();
    return savedTask;
  }, [organizationId, refresh, state.tasks, user?.email, user?.id, user?.user_metadata?.full_name]);

  const removeTask = useCallback(async (taskId) => {
    await deleteOrgTask(taskId);
    await refresh();
    return true;
  }, [refresh]);

  const addTaskNote = useCallback(async (payload) => {
    const updatedTask = await appendOrgTaskNote(payload);
    const currentTask = state.tasks.find((task) => task.id === payload.taskId) || null;
    const recipients = [
      currentTask?.assignee_user_id,
      currentTask?.created_by,
    ].filter((recipientId) => recipientId && recipientId !== payload.authorId);

    if (recipients.length > 0) {
      await notifyOrgTaskUsers({
        organization_id: organizationId,
        task_id: payload.taskId,
        recipients,
        title: 'Task note added',
        body: `${user?.user_metadata?.full_name || user?.email || 'A teammate'} added a note on task: ${currentTask?.title || 'Task'}.`,
        action_url: `/app/org/${organizationId}/pipeline/tasks?taskId=${payload.taskId}`,
        metadata: {
          requested_type: 'org_task_note_added',
          task_id: payload.taskId,
        },
      });
    }

    await refresh();
    return updatedTask;
  }, [organizationId, refresh, state.tasks, user?.email, user?.user_metadata?.full_name]);

  const saveTaskStatus = useCallback(async (statusId, updates) => {
    const savedStatus = await updateOrgTaskStatus(statusId, updates);
    await refresh();
    return savedStatus;
  }, [refresh]);

  const createTaskStatus = useCallback(async (payload) => {
    const createdStatus = await createOrgTaskStatus(payload);
    await refresh();
    return createdStatus;
  }, [refresh]);

  const removeTaskStatus = useCallback(async (statusId) => {
    await deleteOrgTaskStatus(statusId);
    await refresh();
    return true;
  }, [refresh]);

  return {
    ...state,
    userId: user?.id || null,
    role: role || null,
    canSchedule,
    canPublish,
    canManageTasks,
    isAdvancedCalendarUser,
    visibleViews,
    presets,
    presetsLoading,
    refresh,
    refreshPresets,
    scheduleRecord,
    publishRecord,
    actOnPipelineItem,
    createPreset,
    updatePreset,
    deletePreset,
    previewBatchSchedule,
    executeBatchSchedule,
    createTask,
    saveTask,
    removeTask,
    addTaskNote,
    createTaskStatus,
    saveTaskStatus,
    removeTaskStatus,
  };
}

export default useOrgCalendar;
