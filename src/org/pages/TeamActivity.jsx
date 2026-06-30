"use client";

import React from 'react';
import OrgEmptyState from '../components/OrgEmptyState';
import usePipelineItems from '../hooks/usePipelineItems';

export default function TeamActivity() {
  const { items, loading } = usePipelineItems();

  return (
    <section className="org-page">
      <div className="org-page-header">
        <div>
          <h1>Team Activity</h1>
          <p>Recent review movement and shared workspace activity.</p>
        </div>
      </div>

      {loading ? (
        <div className="org-panel-loading">Loading activity...</div>
      ) : items.length === 0 ? (
        <OrgEmptyState
          eyebrow="Activity"
          title="No recent activity"
          description="As the team reviews and approves content, this feed will populate."
        />
      ) : (
        <div className="org-note-list">
          {items.slice(0, 16).map((item) => (
            <article key={item.id} className="org-note-card">
              <strong>{item.title || 'Untitled item'}</strong>
              <p>{item.status.replace(/_/g, ' ')} • {new Date(item.updated_at).toLocaleString()}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
