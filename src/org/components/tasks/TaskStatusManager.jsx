import React, { useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  createOrgTaskStatus,
  deleteOrgTaskStatus,
  updateOrgTaskStatus,
} from '../../services/taskService';

function cloneStatuses(statuses = []) {
  return statuses.map((status) => ({ ...status }));
}

export default function TaskStatusManager({
  organizationId,
  currentUserId = null,
  statuses = [],
  onUpdated,
}) {
  const [draftStatuses, setDraftStatuses] = useState(() => cloneStatuses(statuses));
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    setDraftStatuses(cloneStatuses(statuses));
  }, [statuses]);

  const sortedStatuses = useMemo(
    () => [...draftStatuses].sort((left, right) => Number(left.position || 0) - Number(right.position || 0)),
    [draftStatuses],
  );

  const updateStatusDraft = (statusId, updater) => {
    setDraftStatuses((current) => current.map((status) => {
      if (status.id !== statusId) return status;
      const nextStatus = typeof updater === 'function' ? updater({ ...status }) : updater;
      return nextStatus;
    }));
  };

  const handleAddStatus = () => {
    setDraftStatuses((current) => current.concat({
      id: `draft-${Date.now()}`,
      organization_id: organizationId,
      name: 'New Status',
      key: '',
      color: '#8B5CF6',
      position: current.length,
      is_system: false,
      created_by: currentUserId,
    }));
  };

  const handleSave = async () => {
    if (!organizationId) return;

    setSaving(true);
    try {
      for (const [index, status] of sortedStatuses.entries()) {
        const payload = {
          name: String(status.name || '').trim(),
          key: status.key || null,
          color: status.color || '#64748B',
          position: index,
        };

        if (!payload.name) continue;

        if (String(status.id).startsWith('draft-')) {
          await createOrgTaskStatus({
            organization_id: organizationId,
            created_by: currentUserId,
            is_system: false,
            ...payload,
          });
        } else {
          await updateOrgTaskStatus(status.id, payload);
        }
      }

      toast.success('Task statuses updated.');
      await onUpdated?.();
    } catch (error) {
      toast.error(error?.message || 'Could not save task statuses.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (status) => {
    if (status.is_system) {
      toast.error('System task statuses cannot be deleted.');
      return;
    }

    if (String(status.id).startsWith('draft-')) {
      setDraftStatuses((current) => current.filter((entry) => entry.id !== status.id));
      return;
    }

    if (!window.confirm(`Delete "${status.name}"?`)) return;

    try {
      await deleteOrgTaskStatus(status.id);
      toast.success('Task status deleted.');
      await onUpdated?.();
    } catch (error) {
      toast.error(error?.message || 'Could not delete this task status.');
    }
  };

  return (
    <section className="org-panel org-task-status-manager">
      <div className="org-panel-header">
        <div>
          <h3>Task Statuses</h3>
          <p>System statuses stay locked. Add custom stages if your workflow needs more granularity.</p>
        </div>
        <div className="org-task-status-actions">
          <button type="button" className="org-text-button" onClick={handleAddStatus}>
            <Plus size={14} />
            Add Status
          </button>
          <button type="button" className="org-primary-button" onClick={handleSave} disabled={saving}>
            <Save size={14} />
            {saving ? 'Saving...' : 'Save Statuses'}
          </button>
        </div>
      </div>

      <div className="org-task-status-list">
        {sortedStatuses.map((status, index) => (
          <article key={status.id} className="org-task-status-card">
            <div className="org-task-status-card-head">
              <span className="org-task-status-order">{index + 1}</span>
              <input
                type="text"
                value={status.name || ''}
                onChange={(event) => updateStatusDraft(status.id, (current) => ({ ...current, name: event.target.value }))}
                disabled={Boolean(status.is_system)}
              />
              {status.is_system ? <span className="org-role-badge">System</span> : null}
            </div>

            <div className="org-task-status-card-body">
              <label className="org-field-group compact">
                <span>Color</span>
                <input
                  type="color"
                  value={status.color || '#64748B'}
                  onChange={(event) => updateStatusDraft(status.id, (current) => ({ ...current, color: event.target.value }))}
                  disabled={Boolean(status.is_system)}
                />
              </label>

              <label className="org-field-group compact">
                <span>Key</span>
                <input
                  type="text"
                  value={status.key || ''}
                  onChange={(event) => updateStatusDraft(status.id, (current) => ({ ...current, key: event.target.value }))}
                  disabled={Boolean(status.is_system)}
                  placeholder="custom_key"
                />
              </label>

              {!status.is_system ? (
                <button type="button" className="org-text-button danger" onClick={() => handleDelete(status)}>
                  <Trash2 size={14} />
                  Delete
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
