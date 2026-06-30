import React, { useEffect, useMemo, useState } from 'react';
import OrgSelect from '../OrgSelect';
import { UiDrawer } from '../../../components/Shared/ui';
import { TASK_PRIORITY_OPTIONS, formatTaskDateTimeInput } from '../../utils/tasks';

function buildOptionLabel(option, fallback) {
  return option?.label || option?.title || fallback;
}

export default function TaskCreateModal({
  open = false,
  statuses = [],
  members = [],
  postOptions = [],
  pipelineOptions = [],
  defaultBrandProjectId = null,
  currentUserId = null,
  onClose,
  onCreate,
}) {
  const [draft, setDraft] = useState({
    title: '',
    description: '',
    statusId: '',
    assigneeUserId: '',
    dueAt: '',
    priority: 'medium',
    linkedPostId: '',
    linkedPipelineItemId: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft({
      title: '',
      description: '',
      statusId: statuses[0]?.id || '',
      assigneeUserId: '',
      dueAt: '',
      priority: 'medium',
      linkedPostId: '',
      linkedPipelineItemId: '',
    });
    setSaving(false);
  }, [open, statuses]);

  const statusOptions = useMemo(
    () => statuses.map((status) => ({
      value: status.id,
      label: status.name,
      description: status.key,
    })),
    [statuses],
  );

  const memberOptions = useMemo(
    () => [{ value: '', label: 'Unassigned', description: 'No specific owner yet.' }].concat(
      members.map((member) => ({
        value: member.userId,
        label: member.profile?.full_name || member.profile?.email || member.userId,
        description: String(member.role || 'member').replace(/_/g, ' '),
      })),
    ),
    [members],
  );

  const linkedPostOptions = useMemo(
    () => [{ value: '', label: 'None', description: 'No linked post.' }].concat(
      postOptions.map((post) => ({
        value: post.id,
        label: buildOptionLabel(post, 'Post'),
        description: post.status || 'Post',
      })),
    ),
    [postOptions],
  );

  const linkedPipelineOptions = useMemo(
    () => [{ value: '', label: 'None', description: 'No linked pipeline item.' }].concat(
      pipelineOptions.map((item) => ({
        value: item.id,
        label: buildOptionLabel(item, 'Pipeline item'),
        description: item.status || 'Pipeline',
      })),
    ),
    [pipelineOptions],
  );

  if (!open) return null;

  const handleSubmit = async () => {
    if (!draft.title.trim() || !draft.statusId) return;

    setSaving(true);
    try {
      await onCreate?.({
        title: draft.title.trim(),
        description: draft.description.trim(),
        status_id: draft.statusId,
        assignee_user_id: draft.assigneeUserId || null,
        due_at: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
        priority: draft.priority,
        linked_post_id: draft.linkedPostId || null,
        linked_pipeline_item_id: draft.linkedPipelineItemId || null,
        brand_project_id: defaultBrandProjectId || null,
        created_by: currentUserId || null,
      });
      onClose?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <UiDrawer
      open={open}
      onClose={onClose}
      title="Create Task"
      description="Define the owner, timing, and linked content for this workflow item."
      className="org-drawer-panel org-task-drawer"
      footer={(
        <>
          <button type="button" className="org-text-button" onClick={onClose}>Cancel</button>
          <button type="button" className="org-primary-button" onClick={handleSubmit} disabled={saving || !draft.title.trim() || !draft.statusId}>
            {saving ? 'Creating...' : 'Create Task'}
          </button>
        </>
      )}
    >
        <div className="org-member-drawer-body">
          <label className="org-field-group">
            <span>Title</span>
            <input
              type="text"
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder="Launch campaign review"
            />
          </label>

          <label className="org-field-group">
            <span>Description</span>
            <textarea
              rows={4}
              value={draft.description}
              onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              placeholder="Add execution notes, expectations, or dependencies."
            />
          </label>

          <div className="org-task-form-grid">
            <label className="org-field-group">
              <span>Status</span>
              <OrgSelect value={draft.statusId} options={statusOptions} onChange={(value) => setDraft((current) => ({ ...current, statusId: value }))} />
            </label>

            <label className="org-field-group">
              <span>Assignee</span>
              <OrgSelect value={draft.assigneeUserId} options={memberOptions} onChange={(value) => setDraft((current) => ({ ...current, assigneeUserId: value }))} />
            </label>

            <label className="org-field-group">
              <span>Due</span>
              <input
                type="datetime-local"
                value={formatTaskDateTimeInput(draft.dueAt)}
                onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value }))}
              />
            </label>

            <label className="org-field-group">
              <span>Priority</span>
              <OrgSelect
                value={draft.priority}
                options={TASK_PRIORITY_OPTIONS.map((option) => ({ ...option, description: `${option.label} priority` }))}
                onChange={(value) => setDraft((current) => ({ ...current, priority: value }))}
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
                searchable
                searchPlaceholder="Search pipeline items"
              />
            </label>

            <label className="org-field-group">
              <span>Linked Post</span>
              <OrgSelect
                value={draft.linkedPostId}
                options={linkedPostOptions}
                onChange={(value) => setDraft((current) => ({ ...current, linkedPostId: value }))}
                searchable
                searchPlaceholder="Search generated content"
              />
            </label>
          </div>
        </div>
    </UiDrawer>
  );
}
