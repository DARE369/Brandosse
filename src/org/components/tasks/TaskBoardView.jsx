import React from 'react';
import { AlertTriangle, CalendarClock, GripVertical, Link2 } from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { formatTaskDateTime, getTaskPriorityLabel, isTaskOverdue, shortCode } from '../../utils/tasks';

function TaskCard({
  task,
  selected = false,
  draggable = false,
  onOpenTask,
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `task:${task.id}`,
    data: { task },
    disabled: !draggable,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`org-task-card ${selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`.trim()}
    >
      <div className="org-task-card-top">
        <div className="org-task-card-title-group">
          <button type="button" className="org-task-card-title" onClick={() => onOpenTask?.(task.id)}>
            {task.title}
          </button>
          <span className={`org-task-priority-pill tone-${task.priority || 'medium'}`.trim()}>
            {getTaskPriorityLabel(task.priority)}
          </span>
        </div>

        {draggable ? (
          <button
            type="button"
            className="org-task-drag-handle"
            aria-label="Drag task"
            {...attributes}
            {...listeners}
          >
            <GripVertical size={14} />
          </button>
        ) : null}
      </div>

      {task.description ? (
        <p className="org-task-card-copy">{task.description}</p>
      ) : null}

      <div className="org-task-card-meta">
        <span>{task.assignee_profile?.full_name || task.assignee_profile?.email || 'Unassigned'}</span>
        {task.due_at ? (
          <span className={isTaskOverdue(task.due_at) ? 'danger' : ''}>
            <CalendarClock size={12} />
            {formatTaskDateTime(task.due_at)}
          </span>
        ) : null}
        {task.is_blocked ? (
          <span className="danger">
            <AlertTriangle size={12} />
            Blocked
          </span>
        ) : null}
      </div>

      {(task.linked_pipeline_item_id || task.linked_post_id) ? (
        <div className="org-task-card-links">
          {task.linked_pipeline_item_id ? (
            <span>
              <Link2 size={12} />
              Pipeline {shortCode(task.linked_pipeline_item_id)}
            </span>
          ) : null}
          {task.linked_post_id ? (
            <span>
              <Link2 size={12} />
              Post {shortCode(task.linked_post_id)}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function TaskColumn({
  status,
  tasks = [],
  selectedTaskId = null,
  canManageTasks = false,
  onOpenTask,
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `task-status:${status.id}`,
    data: { statusId: status.id },
    disabled: !canManageTasks,
  });

  return (
    <section ref={setNodeRef} className={`org-task-column ${isOver ? 'over' : ''}`.trim()}>
      <header className="org-task-column-header">
        <div>
          <strong>{status.name}</strong>
          <span>{tasks.length} task{tasks.length === 1 ? '' : 's'}</span>
        </div>
        <span className="org-task-column-swatch" style={{ '--task-status-color': status.color }} />
      </header>

      <div className="org-task-column-body">
        {tasks.length === 0 ? (
          <div className="org-calendar-empty-inline">No tasks in this status.</div>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              selected={selectedTaskId === task.id}
              draggable={canManageTasks}
              onOpenTask={onOpenTask}
            />
          ))
        )}
      </div>
    </section>
  );
}

export default function TaskBoardView({
  statuses = [],
  tasks = [],
  selectedTaskId = null,
  canManageTasks = false,
  onOpenTask,
}) {
  const tasksByStatus = statuses.map((status) => ({
    status,
    tasks: tasks.filter((task) => task.status_id === status.id),
  }));

  return (
    <div className="org-task-board">
      {tasksByStatus.map(({ status, tasks: statusTasks }) => (
        <TaskColumn
          key={status.id}
          status={status}
          tasks={statusTasks}
          selectedTaskId={selectedTaskId}
          canManageTasks={canManageTasks}
          onOpenTask={onOpenTask}
        />
      ))}
    </div>
  );
}
