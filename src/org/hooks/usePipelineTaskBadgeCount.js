import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../Context/AuthContext';
import { supabase } from '../../services/supabaseClient';
import useOrgContext from './useOrgContext';

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isCompletedTask(task, statusById) {
  if (task?.is_blocked) return false;
  const statusKey = String(statusById.get(task?.status_id) || '').trim().toLowerCase();
  return statusKey === 'completed' || statusKey === 'done';
}

export function usePipelineTaskBadgeCount() {
  const { user } = useAuth();
  const { organizationId } = useOrgContext();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!organizationId || !user?.id) {
      setCount(0);
      return;
    }

    const [{ data: tasks, error: taskError }, { data: statuses, error: statusError }] = await Promise.all([
      supabase
        .from('org_tasks')
        .select('id, status_id, is_blocked')
        .eq('organization_id', organizationId)
        .eq('assignee_user_id', user.id),
      supabase
        .from('org_task_statuses')
        .select('id, key')
        .eq('organization_id', organizationId),
    ]);

    if (taskError || statusError) {
      console.warn('[usePipelineTaskBadgeCount] failed to load task badge count', taskError || statusError);
      setCount(0);
      return;
    }

    const statusById = new Map(
      safeArray(statuses).map((status) => [status.id, status.key]),
    );
    const openTaskCount = safeArray(tasks).filter((task) => !isCompletedTask(task, statusById)).length;
    setCount(openTaskCount);
  }, [organizationId, user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!organizationId) return undefined;

    const channel = supabase
      .channel(`pipeline-task-badge-${organizationId}`)
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

  return count;
}

export default usePipelineTaskBadgeCount;
