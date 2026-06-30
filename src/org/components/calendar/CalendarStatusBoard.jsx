import React from 'react';
import CalendarContentCard from './CalendarContentCard';

function getPrimaryLabel(record) {
  switch (record.lifecycleStatus) {
    case 'approved':
      return 'Schedule';
    case 'in_review':
    case 'revision_requested':
      return 'Review';
    case 'draft':
      return 'Open Draft';
    default:
      return 'Open';
  }
}

export default function CalendarStatusBoard({
  columns = [],
  archiveRecords = [],
  onOpenRecord,
  onOpenPipeline,
}) {
  return (
    <div className="org-calendar-board-shell">
      <div className="org-calendar-board-grid">
        {columns.map((column) => (
          <section key={column.id} className="org-calendar-board-column">
            <header className="org-calendar-board-header">
              <div>
                <strong>{column.label}</strong>
                <span>{column.description}</span>
              </div>
              <em>{column.records.length}</em>
            </header>

            <div className="org-calendar-board-stack">
              {column.records.length === 0 ? (
                <div className="org-calendar-empty-inline">No items in this stage.</div>
              ) : (
                column.records.map((record) => (
                  <article key={record.id} className="org-calendar-board-card">
                    <CalendarContentCard
                      record={record}
                      variant="ops"
                      onClick={() => onOpenRecord(record)}
                    />

                    <div className="org-calendar-board-actions">
                      <button
                        type="button"
                        className="org-text-button"
                        onClick={() => onOpenRecord(record)}
                      >
                        {getPrimaryLabel(record)}
                      </button>
                      {record.pipelineItemId ? (
                        <button
                          type="button"
                          className="org-text-button"
                          onClick={() => onOpenPipeline(record.pipelineItemId)}
                        >
                          Pipeline
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        ))}
      </div>

      {archiveRecords.length > 0 ? (
        <section className="org-calendar-board-archive">
          <header className="org-calendar-board-archive-header">
            <strong>Rejected & Archived</strong>
            <span>{archiveRecords.length} items</span>
          </header>
          <div className="org-calendar-board-archive-list">
            {archiveRecords.map((record) => (
              <CalendarContentCard
                key={record.id}
                record={record}
                variant="ops"
                className="archive"
                onClick={() => onOpenRecord(record)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
