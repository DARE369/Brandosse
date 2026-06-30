import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, ExternalLink, Link2, MessageSquarePlus, Trash2 } from 'lucide-react';
import OrgSelect from '../OrgSelect';
import { TASK_PRIORITY_OPTIONS, formatTaskDateTime, formatTaskDateTimeInput, getTaskPriorityLabel, shortCode } from '../../utils/tasks';

function buildMemberOptions(members = []) {
  return [{ value: '', label: 'Unassigned', description: 'No specific owner yet.' }].concat(
    members.map((member) => ({
      value: member.userId,
      label: member.profile?.full_name || member.profile?.email || member.userId,
      description: String(member.role || 'member').replace(/_/g, ' '),
    })),
  );
}

function buildLinkedOptions(rows = [], emptyLabel, typeLabel) {
  return [{ value: '', label: 'None', description: emptyLabel }].concat(
    rows.map((row) => ({
      value: row.id,
      label: row.title || row.caption || `${typeLabel} ${shortCode(row.id)}`,
      description: row.status || typeLabel,
    })),
  );
}

export default function TaskDetailDrawer({
  open = false,
  task = null,
  statuses = [],
  members = [],
  postOptions = [],
  pipelineOptions = [],
  canManageTasks = false,
  currentUserId = null,
  onClose,
  onSave,
  onDelete,
  onAddNote,
  onOpenSchedule,
  onOpenPipeline,
}) {
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  useEffect(() => {
    if (!open || !task) {
      setDraft(null);
      setSaving(false);
      setNoteBody('');
      setAddingNote(false);
      return;
    }

    setDraft({
      title: task.title || '',
      description: task.description || '',
      statusId: task.status_id || '',
      assigneeUserId: task.assignee_user_id || '',
      dueAt: task.due_at || '',
      priority: task.priority || 'medium',
      linkedPostId: task.linked_post_id || '',
      linkedPipelineItemId: task.linked_pipeline_item_id || '',
      isBlocked: Boolean(task.is_blocked),
      blockedReason: task.blocked_reason || '',
    });
    setSaving(false);
    setNoteBody('');
    setAddingNote(false);
  }, [open, task]);

  const statusOptions = useMemo(
    () => statuses.map((status) => ({
      value: status.id,
      label: status.name,
      description: status.key,
    })),
    [statuses],
  );
  const memberOptions = useMemo(() => buildMemberOptions(members), [members]);
  const linkedPostOptions = useMemo(() => buildLinkedOptions(postOptions, 'No linked post.', 'Post'), [postOptions]);
  const linkedPipelineOptions = useMemo(() => buildLinkedOptions(pipelineOptions, 'No linked pipeline item.', 'Pipeline'), [pipelineOptions]);
  const statusMap = useMemo(() => new Map(statuses.map((status) => [status.id, status])), [statuses]);

  if (!open || !task || !draft) return null;

  const taskStatus = statusMap.get(task.status_id) || null;

  const handleSave = async () => {
    if (!canManageTasks || !draft.title.trim() || !draft.statusId) return;

    setSaving(true);
    try {
      await onSave?.(task.id, {
        title: draft.title.trim(),
        description: draft.description.trim(),
        status_id: draft.statusId,
        assignee_user_id: draft.assigneeUserId || null,
        due_at: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
        priority: draft.priority,
        linked_post_id: draft.linkedPostId || null,
        linked_pipeline_item_id: draft.linkedPipelineItemId || null,
        is_blocked: draft.isBlocked,
        blocked_reason: draft.isBlocked ? draft.blockedReason : null,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAddNote = async () => {
    if (!canManageTasks || !noteBody.trim()) return;

    setAddingNote(true);
    try {
      await onAddNote?.({
        taskId: task.id,
        authorId: currentUserId,
        body: noteBody.trim(),
      });
      setNoteBody('');
    } finally {
      setAddingNote(false);
    }
  };

  return (
    <>
      <button type="button" className="org-drawer-backdrop" onClick={onClose} aria-label="Close task details" />
      <aside className="org-drawer-panel org-task-drawer">
        <div className="org-drawer-header">
          <div>
            <h3>{task.title}</h3>
            <p>Review ownership, linked content, timing, and execution notes for this task.</p>
          </div>
          <button type="button" className="org-text-button" onClick={onClose}>Close</button>
        </div>

        <div className="org-member-drawer-body">
          <div className="org-summary-grid compact">
            <article className="org-summary-card">
              <span className="org-modal-kicker">Status</span>
              <strong>{taskStatus?.name || 'Unknown'}</strong>
              <p>{task.is_blocked ? 'This task is currently blocked.' : 'Status changes drive board placement.'}</p>
            </article>
            <article className="org-summary-card">
              <span className="org-modal-kicker">Priority</span>
              <strong>{getTaskPriorityLabel(task.priority)}</strong>
              <p>{task.assignee_profile?.full_name || task.assignee_profile?.email || 'No assignee selected yet.'}</p>
            </article>
            <article className="org-summary-card">
              <span className="org-modal-kicker">Due</span>
              <strong>{formatTaskDateTime(task.due_at)}</strong>
              <p>{task.creator_profile?.full_name || task.creator_profile?.email || 'Unknown creator'}</p>
            </article>
          </div>

          <label className="org-field-group">
            <span>Title</span>
            <input
              type="text"
              value={draft.title}
              disabled={!canManageTasks}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            />
          </label>

          <label className="org-field-group">
            <span>Description</span>
            <textarea
              rows={4}
              value={draft.description}
              disabled={!canManageTasks}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            />
          </label>

          <div className="org-task-form-grid">
            <label className="org-field-group">
              <span>Status</span>
              <OrgSelect
                value={draft.statusId}
                options={statusOptions}
                onChange={(value) => setDraft((current) => ({ ...current, statusId: value }))}
                disabled={!canManageTasks}
              />
            </label>

            <label className="org-field-group">
              <span>Assignee</span>
              <OrgSelect
                value={draft.assigneeUserId}
                options={memberOptions}
                onChange={(value) => setDraft((current) => ({ ...current, assigneeUserId: value }))}
                disabled={!canManageTasks}
              />
            </label>

            <label className="org-field-group">
              <span>Due</span>
              <input
                type="datetime-local"
                value={formatTaskDateTimeInput(draft.dueAt)}
                disabled={!canManageTasks}
                onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value }))}
              />
            </label>

            <label className="org-field-group">
              <span>Priority</span>
              <OrgSelect
                value={draft.priority}
                options={TASK_PRIORITY_OPTIONS.map((option) => ({ ...option, description: `${option.label} priority` }))}
                onChange={(value) => setDraft((current) => ({ ...current, priority: value }))}
                disabled={!canManageTasks}
              />
            </label>
          </div>

          <div className="org-task-form-grid">
            <label className="org-field-group">
              <span>Linked Pipeline Item</span>
              <OrgSelect
                value={draft.linkedPipelineItemId}
                options={linkedPipelineOptions}
                onChange={(value) => setDraft((current) => ({ ...current, linkedPipelineItemId: value }))}
                disabled={!canManageTasks}
              />
            </label>

            <label className="org-field-group">
              <span>Linked Post</span>
              <OrgSelect
                value={draft.linkedPostId}
                options={linkedPostOptions}
                onChange={(value) => setDraft((current) => ({ ...current, linkedPostId: value }))}
                disabled={!canManageTasks}
              />
            </label>
          </div>

          <section className="org-member-section">
            <header className="org-member-section-header">
              <div>
                <h4>Execution State</h4>
                <p>Use blocking when the task cannot proceed because of an external dependency.</p>
              </div>
            </header>

            <label className="org-checkbox-row">
              <input
                type="checkbox"
                checked={draft.isBlocked}
                disabled={!canManageTasks}
                onChange={(event) => setDraft((current) => ({ ...current, isBlocked: event.target.checked }))}
              />
              <span>Blocked</span>
            </label>

            <label className="org-field-group">
              <span>Blocked Reason</span>
              <textarea
                rows={3}
                value={draft.blockedReason}
                disabled={!canManageTasks || !draft.isBlocked}
                onChange={(event) => setDraft((current) => ({ ...current, blockedReason: event.target.value }))}
                placeholder="Waiting on client approval, assets, compliance, or account access."
              />
            </label>
          </section>

          <section className="org-member-section">
            <header className="org-member-section-header">
              <div>
                <h4>Linked Content</h4>
                <p>Open the related schedule or pipeline context without leaving the calendar workspace.</p>
              </div>
            </header>

            <div className="org-task-link-actions">
              {task.linked_pipeline_item_id ? (
                <button type="button" className="org-text-button" onClick={() => onOpenPipeline?.(task.linked_pipeline_item_id)}>
                  <Link2 size={14} />
                  Pipeline {shortCode(task.linked_pipeline_item_id)}
                </button>
              ) : null}
              {(task.linked_pipeline_item_id || task.linked_post_id) ? (
                <button
                  type="button"
                  className="org-text-button"
                  onClick={() => onOpenSchedule?.({
                    postId: task.linked_post_id || null,
                    pipelineItemId: task.linked_pipeline_item_id || null,
                  })}
                >
                  <ExternalLink size={14} />
                  Open Schedule Context
                </button>
              ) : (
                <div className="org-empty-inline">No linked post or pipeline item has been attached yet.</div>
              )}
            </div>
          </section>

          <section className="org-member-section">
            <header className="org-member-section-header">
              <div>
                <h4>Notes</h4>
                <p>Capture task-specific handoff comments and execution updates.</p>
              </div>
            </header>

            <div className="org-task-notes-list">
              {task.notes?.length ? task.notes.map((note) => (
                <article key={note.id} className="org-task-note">
                  <div className="org-task-note-top">
                    <strong>{note.author_profile?.full_name || note.author_profile?.email || 'Unknown member'}</strong>
                    <span>{formatTaskDateTime(note.created_at)}</span>
                  </div>
                  <p>{note.body}</p>
                </article>
              )) : (
                <div className="org-empty-inline">No task notes have been added yet.</div>
              )}
            </div>

            {canManageTasks ? (
              <div className="org-task-note-composer">
                <textarea
                  rows={3}
                  value={noteBody}
                  onChange={(event) => setNoteBody(event.target.value)}
                  placeholder="Add a status update or dependency note."
                />
                <button type="button" className="org-text-button" onClick={handleAddNote} disabled={addingNote || !noteBody.trim()}>
                  <MessageSquarePlus size={14} />
                  {addingNote ? 'Saving note...' : 'Add Note'}
                </button>
              </div>
            ) : null}
          </section>
        </div>

        <div className="org-drawer-footer">
          <button type="button" className="org-text-button" onClick={onClose}>Close</button>
          {canManageTasks ? (
            <>
              <button type="button" className="org-text-button danger" onClick={() => onDelete?.(task.id)} disabled={saving}>
                <Trash2 size={14} />
                Delete
              </button>
              <button type="button" className="org-primary-button" onClick={handleSave} disabled={saving || !draft.title.trim() || !draft.statusId}>
                <CalendarClock size={14} />
                {saving ? 'Saving...' : 'Save Task'}
              </button>
            </>
          ) : null}
        </div>
      </aside>
    </>
  );
}
