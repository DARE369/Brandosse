import React from 'react';
import { ExternalLink } from 'lucide-react';
import { formatTaskDateTime, getTaskPriorityLabel, shortCode } from '../../utils/tasks';

export default function TaskTableView({
  tasks = [],
  statusMap = new Map(),
  onOpenTask,
}) {
  if (tasks.length === 0) {
    return <div className="org-calendar-empty-inline">No tasks match the current filters.</div>;
  }

  return (
    <div className="org-table-wrap org-task-table-wrap">
      <table className="org-table org-task-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Status</th>
            <th>Assignee</th>
            <th>Due</th>
            <th>Priority</th>
            <th>Linked Content</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const status = statusMap.get(task.status_id) || null;
            return (
              <tr key={task.id}>
                <td>
                  <div className="org-task-table-title">
                    <strong>{task.title}</strong>
                    {task.description ? <p>{task.description}</p> : null}
                  </div>
                </td>
                <td>
                  <span className="org-task-status-inline">
                    <span className="org-task-status-dot" style={{ '--task-status-color': status?.color || 'var(--org-task-status-default)' }} />
                    {status?.name || 'Unknown'}
                  </span>
                </td>
                <td>{task.assignee_profile?.full_name || task.assignee_profile?.email || 'Unassigned'}</td>
                <td>{formatTaskDateTime(task.due_at)}</td>
                <td>{getTaskPriorityLabel(task.priority)}</td>
                <td>
                  <div className="org-task-link-stack">
                    {task.linked_pipeline_item_id ? <span>Pipeline {shortCode(task.linked_pipeline_item_id)}</span> : null}
                    {task.linked_post_id ? <span>Post {shortCode(task.linked_post_id)}</span> : null}
                    {!task.linked_pipeline_item_id && !task.linked_post_id ? <span>None</span> : null}
                  </div>
                </td>
                <td>
                  <button type="button" className="org-text-button" onClick={() => onOpenTask?.(task.id)}>
                    <ExternalLink size={14} />
                    Open
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
