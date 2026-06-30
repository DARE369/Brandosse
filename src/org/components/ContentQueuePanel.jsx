import React from 'react';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import usePipelineItems from '../hooks/usePipelineItems';
import { useOrgContext } from '../hooks/useOrgContext';
import OrgEmptyState from './OrgEmptyState';
import { buildDeepLink } from '../../utils/buildDeepLink';

export default function ContentQueuePanel() {
  const { navigate } = useAppNavigation();
  const { organizationId } = useOrgContext();
  const { items, loading } = usePipelineItems();

  const approved = items.filter((item) => item.status === 'approved').slice(0, 8);

  return (
    <aside className="org-queue-panel">
      <div className="org-panel-header">
        <div>
          <h3>Queue</h3>
          <p>Ready to schedule</p>
        </div>
        <button
          type="button"
          className="org-text-button"
          onClick={() => {
            const target = buildDeepLink({
              path: `/app/org/${organizationId}/pipeline`,
              source: 'org_content_queue',
              target: 'org_pipeline',
            });
            navigate(target.path, { state: target.state });
          }}
        >
          View All
        </button>
      </div>

      {loading ? (
        <div className="org-panel-loading">Loading queue...</div>
      ) : approved.length === 0 ? (
        <OrgEmptyState
          eyebrow="Queue"
          title="Nothing approved yet"
          description="Approved pipeline items will appear here when they are ready for scheduling."
        />
      ) : (
        <div className="org-queue-list">
          {approved.map((item) => (
            <button
              key={item.id}
              type="button"
              className="org-queue-item"
              onClick={() => {
                const target = buildDeepLink({
                  path: `/app/org/${organizationId}/pipeline`,
                  source: 'org_content_queue',
                  target: 'org_pipeline_item',
                  params: { pipelineItemId: item.id },
                });
                navigate(target.path, { state: target.state });
              }}
            >
              <strong>{item.title || 'Untitled content'}</strong>
              <span>{item.platform || 'Platform not set'}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
