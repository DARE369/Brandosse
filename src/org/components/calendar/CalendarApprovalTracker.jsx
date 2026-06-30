import React from 'react';

export default function CalendarApprovalTracker({
  rows = [],
  onOpenRecord,
  onOpenPipeline,
}) {
  return (
    <div className="org-calendar-approval-table">
      <div className="org-calendar-approval-head">
        <span>Content</span>
        <span>Platform</span>
        <span>Stage</span>
        <span>Reviewer</span>
        <span>SLA</span>
        <span>Submitter</span>
        <span>Action</span>
      </div>

      {rows.length === 0 ? (
        <div className="org-calendar-empty-inline">No active approvals are waiting for action.</div>
      ) : (
        rows.map((row) => (
          <div key={row.id} className="org-calendar-approval-row">
            <div>
              <strong>{row.title}</strong>
              <small>{row.statusLabel}</small>
            </div>
            <span>{row.platformLabel}</span>
            <span>{row.stageLabel}</span>
            <span>{row.assigneeLabel}</span>
            <span className={`tone-${row.slaTone || 'scheduled'}`}>{row.slaLabel || 'No SLA'}</span>
            <span>{row.submitterLabel}</span>
            <div className="org-calendar-approval-actions">
              <button
                type="button"
                className="org-text-button"
                onClick={() => onOpenRecord(row)}
              >
                Review
              </button>
              <button
                type="button"
                className="org-text-button"
                onClick={() => onOpenPipeline(row.pipelineItemId)}
              >
                Pipeline
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
