"use client";

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useOrgContext } from '../hooks/useOrgContext';
import useOrgCalendar from '../hooks/useOrgCalendar';
import { useAuth } from '../../Context/AuthContext';
import { UiIconButton } from '../../components/Shared/ui';
import ConnectedAccountsAdmin from './ConnectedAccountsAdmin';
import TaskStatusManager from '../components/tasks/TaskStatusManager';
export default function OrgSettingsPage() {
  const { user } = useAuth();
  const { organization, organizationId } = useOrgContext();
  const { taskStatuses, refresh, userId } = useOrgCalendar();
  const [toast, setToast] = useState(null);

  return (
    <section className="org-page org-admin-page org-admin-settings-page">
      <div className="org-page-header">
        <div>
          <h1>Organization Settings</h1>
          <p>Current workspace settings and defaults.</p>
        </div>
      </div>

      <div className="org-note-list">
        <article className="org-note-card">
          <strong>Organization</strong>
          <p>{organization?.name || 'Organization'}</p>
        </article>
        <article className="org-note-card">
          <strong>Plan</strong>
          <p>{organization?.planKey || 'organization'}</p>
        </article>
        <article className="org-note-card">
          <strong>Default Pipeline</strong>
          <p>{organization?.settings?.default_pipeline_id || 'Not configured yet'}</p>
        </article>
        <article className="org-note-card">
          <strong>Task Statuses</strong>
          <p>{taskStatuses.length || 0} configured</p>
        </article>
      </div>

      {toast ? (
        <div className={`toast toast-${toast.type || 'info'}`}>
          {toast.message}
          <UiIconButton
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setToast(null)}
            ariaLabel="Dismiss notification"
          >
            <X size={14} aria-hidden="true" />
          </UiIconButton>
        </div>
      ) : null}

      <ConnectedAccountsAdmin
        organizationId={organizationId}
        currentUserId={user?.id || userId || null}
        onToast={(message, type = 'info') => setToast({ message, type })}
      />

      <TaskStatusManager
        organizationId={organizationId}
        currentUserId={userId}
        statuses={taskStatuses}
        onUpdated={refresh}
      />
    </section>
  );
}
