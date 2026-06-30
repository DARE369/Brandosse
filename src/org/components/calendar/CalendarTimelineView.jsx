import React, { useMemo } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import OrgSelect from '../OrgSelect';

const DAY_COUNT = 28;
const TIMELINE_ROW_HEIGHT = 84;

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function addDays(date, value) {
  const next = new Date(date);
  next.setDate(next.getDate() + value);
  return next;
}

function startOfWeek(date) {
  const next = startOfDay(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return next;
}

function formatDayKey(date) {
  return startOfDay(date).toISOString().slice(0, 10);
}

function formatTimelineDay(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTimelineWeekday(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getHistoryEntries(record) {
  const history = Array.isArray(record?.rawPipelineItem?.history) ? record.rawPipelineItem.history : [];
  return history
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      event: String(entry.event || '').toLowerCase(),
      timestamp: entry.timestamp || null,
      stageOrder: Number(entry.stage_order || 0),
    }))
    .filter((entry) => entry.timestamp)
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}

function getTimelineMilestones(record) {
  const createdAt = record.createdAt || record.rawPipelineItem?.created_at || record.rawPost?.created_at || null;
  const history = getHistoryEntries(record);
  const firstReviewAt = history[0]?.timestamp || null;
  const approvedAt = [...history].reverse().find((entry) => entry.event === 'approve')?.timestamp
    || [...history].reverse().find((entry) => entry.event === 'advanced')?.timestamp
    || null;
  const scheduledAt = record.scheduledAt || record.rawPipelineItem?.scheduled_for || null;
  const publishedAt = record.publishedAt || null;
  const lastUpdatedAt = record.updatedAt || record.rawPipelineItem?.updated_at || record.rawPost?.updated_at || createdAt;

  return {
    createdAt,
    firstReviewAt,
    approvedAt,
    scheduledAt,
    publishedAt,
    endAt: publishedAt || scheduledAt || approvedAt || lastUpdatedAt || createdAt,
  };
}

function buildLaneGroups(records = [], laneMode = 'member') {
  const grouped = new Map();

  records.forEach((record) => {
    let laneKey = record.ownerId || 'unassigned';
    let label = record.ownerName || 'Unassigned';

    if (laneMode === 'platform') {
      laneKey = record.platform || 'unknown';
      label = record.platformLabel || 'Unknown platform';
    }

    if (laneMode === 'brand') {
      laneKey = record.brandProjectId || 'unscoped';
      label = record.brandProjectLabel || 'Unscoped';
    }

    const current = grouped.get(laneKey) || {
      laneKey,
      label,
      records: [],
    };

    current.records.push(record);
    grouped.set(laneKey, current);
  });

  return [...grouped.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function buildMonthGroups(days = []) {
  const groups = [];

  days.forEach((day) => {
    const label = day.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const current = groups[groups.length - 1];
    if (current && current.label === label) {
      current.span += 1;
    } else {
      groups.push({ label, span: 1 });
    }
  });

  return groups;
}

function getRecordRange(record) {
  const milestones = getTimelineMilestones(record);
  const start = milestones.createdAt ? startOfDay(milestones.createdAt) : startOfDay(record.createdAt || new Date());
  const end = milestones.endAt ? endOfDay(milestones.endAt) : endOfDay(milestones.createdAt || record.updatedAt || new Date());

  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

function buildLaneBarLayout(records = []) {
  const sorted = [...records]
    .map((record) => ({ record, ...getRecordRange(record) }))
    .sort((left, right) => {
      if (left.startMs !== right.startMs) return left.startMs - right.startMs;
      return left.endMs - right.endMs;
    });

  const rowEndTimes = [];

  const bars = sorted.map((entry) => {
    let rowIndex = rowEndTimes.findIndex((endMs) => entry.startMs > endMs);
    if (rowIndex === -1) {
      rowIndex = rowEndTimes.length;
      rowEndTimes.push(entry.endMs);
    } else {
      rowEndTimes[rowIndex] = entry.endMs;
    }

    return {
      record: entry.record,
      rowIndex,
    };
  });

  return {
    bars,
    rowCount: Math.max(rowEndTimes.length, 1),
  };
}

function TimelineDropCell({ laneKey, day, isPast }) {
  const dayKey = formatDayKey(day);
  const { setNodeRef, isOver } = useDroppable({
    id: `timeline:${laneKey}:${dayKey}`,
    disabled: isPast,
    data: { dayKey, laneKey },
  });

  return (
    <div
      ref={setNodeRef}
      className={`org-calendar-timeline-cell ${isOver ? 'over' : ''} ${isPast ? 'locked' : ''}`.trim()}
    />
  );
}

function TimelineBar({ record, laneStart, laneEnd, rowIndex = 0, onOpenRecord }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `calendar-record:${record.id}`,
    disabled: !record.dragEnabled,
    data: { record },
  });

  const milestones = getTimelineMilestones(record);
  const windowStart = startOfDay(laneStart).getTime();
  const windowEnd = endOfDay(laneEnd).getTime();
  const rangeMs = Math.max(windowEnd - windowStart, 1);

  const createdAt = new Date(milestones.createdAt || record.createdAt || laneStart);
  const endAt = new Date(milestones.endAt || milestones.createdAt || laneEnd);
  const reviewAt = milestones.firstReviewAt ? new Date(milestones.firstReviewAt) : null;
  const approvedAt = milestones.approvedAt ? new Date(milestones.approvedAt) : null;
  const scheduledAt = milestones.scheduledAt ? new Date(milestones.scheduledAt) : null;
  const publishedAt = milestones.publishedAt ? new Date(milestones.publishedAt) : null;

  const barStart = clamp((startOfDay(createdAt).getTime() - windowStart) / rangeMs, 0, 1);
  const barEnd = clamp((endOfDay(endAt).getTime() - windowStart) / rangeMs, 0.05, 1);
  const widthPct = Math.max((barEnd - barStart) * 100, 5);
  const leftPct = barStart * 100;

  const rel = (value) => {
    if (!value) return null;
    const pct = clamp((new Date(value).getTime() - windowStart) / rangeMs, 0, 1);
    return ((pct - barStart) / Math.max(barEnd - barStart, 0.01)) * 100;
  };

  const draftingEnd = rel(reviewAt || approvedAt || scheduledAt || publishedAt || endAt);
  const reviewEnd = rel(approvedAt || scheduledAt || publishedAt || endAt);
  const scheduleEnd = rel(publishedAt || scheduledAt || endAt);

  const style = {
    left: `${leftPct}%`,
    width: `${widthPct}%`,
    top: `${8 + (rowIndex * TIMELINE_ROW_HEIGHT)}px`,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`org-calendar-timeline-bar tone-${record.tone || 'draft'} ${isDragging ? 'dragging' : ''}`.trim()}
      style={style}
      onClick={() => onOpenRecord(record)}
      {...attributes}
      {...listeners}
    >
      <div className="org-calendar-timeline-bar-track">
        <span className="segment drafting" style={{ width: `${draftingEnd || 100}%` }} />
        {draftingEnd !== null && reviewEnd !== null && reviewEnd > draftingEnd ? (
          <span className="segment review" style={{ left: `${draftingEnd}%`, width: `${reviewEnd - draftingEnd}%` }} />
        ) : null}
        {reviewEnd !== null && scheduleEnd !== null && scheduleEnd > reviewEnd ? (
          <span className="segment schedule" style={{ left: `${reviewEnd}%`, width: `${scheduleEnd - reviewEnd}%` }} />
        ) : null}
        {publishedAt ? <span className="published-marker" style={{ left: `${rel(publishedAt)}%` }} /> : null}
      </div>
      <div className="org-calendar-timeline-bar-copy">
        <strong title={record.title}>{record.title}</strong>
        <span title={`${record.platformLabel} ${record.statusLabel}`}>{record.platformLabel} | {record.statusLabel}</span>
      </div>
    </button>
  );
}

export default function CalendarTimelineView({
  records = [],
  anchorDate,
  laneMode = 'member',
  onLaneModeChange,
  onOpenRecord,
  onJumpToday,
}) {
  const windowStart = useMemo(() => startOfWeek(anchorDate), [anchorDate]);
  const days = useMemo(() => Array.from({ length: DAY_COUNT }, (_, index) => addDays(windowStart, index)), [windowStart]);
  const monthGroups = useMemo(() => buildMonthGroups(days), [days]);
  const windowEnd = days[days.length - 1];
  const today = startOfDay(new Date());

  const laneOptions = useMemo(() => ([
    { value: 'member', label: 'By Member', description: 'Default content-owner lanes.' },
    { value: 'platform', label: 'By Platform', description: 'Group work by destination platform.' },
    { value: 'brand', label: 'By Brand Project', description: 'Split the view by brand project scope.' },
  ]), []);

  const visibleRecords = useMemo(() => records.filter((record) => {
    const milestones = getTimelineMilestones(record);
    const start = milestones.createdAt ? new Date(milestones.createdAt) : null;
    const end = milestones.endAt ? new Date(milestones.endAt) : null;
    if (!start && !end) return false;
    const effectiveStart = start || end;
    const effectiveEnd = end || start;
    return effectiveStart <= endOfDay(windowEnd) && effectiveEnd >= startOfDay(windowStart);
  }), [records, windowEnd, windowStart]);

  const lanes = useMemo(() => (
    buildLaneGroups(visibleRecords, laneMode).map((lane) => ({
      ...lane,
      ...buildLaneBarLayout(lane.records),
    }))
  ), [laneMode, visibleRecords]);

  if (records.length === 0) {
    return <div className="org-calendar-empty-inline">No timeline records match the current filters.</div>;
  }

  if (visibleRecords.length === 0) {
    return (
      <div className="org-calendar-empty-inline org-calendar-timeline-empty">
        <div>
          <strong>No items sit inside this timeline range.</strong>
          <p>Move the range or jump back to the current period to see active work.</p>
        </div>
        <button type="button" className="org-text-button" onClick={onJumpToday}>
          Jump to Today
        </button>
      </div>
    );
  }

  return (
    <div className="org-calendar-timeline-shell">
      <div className="org-calendar-timeline-toolbar">
        <div>
          <h3>Timeline</h3>
          <p>Bluefion-style content execution lanes across drafting, review, scheduling, and publish.</p>
        </div>

        <OrgSelect
          value={laneMode}
          options={laneOptions}
          onChange={onLaneModeChange}
          className="org-calendar-filter-select compact"
        />
      </div>

      <div className="org-calendar-timeline-frame">
        <div className="org-calendar-timeline-scroll">
          <div className="org-calendar-timeline-month-row" style={{ '--timeline-day-count': days.length }}>
            <div className="org-calendar-timeline-lane-spacer" />
            <div className="org-calendar-timeline-months">
              {monthGroups.map((group) => (
                <div key={`${group.label}-${group.span}`} className="org-calendar-timeline-month" style={{ gridColumn: `span ${group.span}` }}>
                  {group.label}
                </div>
              ))}
            </div>
          </div>

          <div className="org-calendar-timeline-day-row" style={{ '--timeline-day-count': days.length }}>
            <div className="org-calendar-timeline-lane-spacer" />
            <div className="org-calendar-timeline-days">
              {days.map((day) => (
                <div key={formatDayKey(day)} className={`org-calendar-timeline-day-head ${formatDayKey(day) === formatDayKey(today) ? 'today' : ''}`.trim()}>
                  <small>{formatTimelineWeekday(day)}</small>
                  <strong>{formatTimelineDay(day)}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="org-calendar-timeline-lanes">
            {lanes.map((lane) => (
              <section key={lane.laneKey} className="org-calendar-timeline-lane" style={{ '--timeline-day-count': days.length }}>
                <div className="org-calendar-timeline-lane-title">
                  <strong>{lane.label}</strong>
                  <span>{lane.records.length} items</span>
                </div>

                <div className="org-calendar-timeline-track">
                  <div
                    className="org-calendar-timeline-grid"
                    style={{ minHeight: `${Math.max(lane.rowCount, 1) * TIMELINE_ROW_HEIGHT}px` }}
                  >
                    {days.map((day) => (
                      <TimelineDropCell
                        key={`${lane.laneKey}-${formatDayKey(day)}`}
                        laneKey={lane.laneKey}
                        day={day}
                        isPast={startOfDay(day) < today}
                      />
                    ))}
                  </div>

                  <div className="org-calendar-timeline-bars">
                    {lane.bars.map(({ record, rowIndex }) => (
                      <TimelineBar
                        key={record.id}
                        record={record}
                        laneStart={windowStart}
                        laneEnd={windowEnd}
                        rowIndex={rowIndex}
                        onOpenRecord={onOpenRecord}
                      />
                    ))}
                  </div>
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
