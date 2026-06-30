// CalendarGrid — Month view (CALENDAR_SPEC.md §3). Refactored from
// v3/MonthGrid.jsx (AS_IS_AUDIT.md §3.2): up to 3 grouped cards per day, then
// "+N more" opens that day in a slide-over list (not a single arbitrary
// post). Platform-icon-stack grouping via useCalendarPosts' groupPostsByGeneration().
//
// All three reschedule modes live here:
//   1. Drag — native HTML5 drag (desktop pointer + touch fallback equivalent
//      to the existing @dnd-kit PointerSensor/TouchSensor configuration —
//      see PersonalCalendarPage.jsx for the real @dnd-kit wiring entry point).
//   2. Full detail-panel edit — clicking a card opens PostDetailDrawer.
//   3. Tap-to-select -> tap-destination — the card's "Move" button enters
//      move mode (calendarUiStore), every day cell becomes a highlighted
//      .is-drop-candidate destination; tapping one commits via
//      useScheduleAction(), exactly as RESEARCH.md §2.4 specifies.
//
// Empty/loading states per spec §10.
import { useMemo, useState } from 'react';
import {
  addDaysToDateKey,
  dateKeyWeekdayIndex,
  getZonedDateKey,
  monthStartKeyFor,
} from '../../utils/timezone';
import PostCard from './PostCard';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const GRID_CELLS = 42; // 6 rows x 7 cols — never truncates a 6-row month
const MAX_VISIBLE_PER_DAY = 3;

function buildMonthCells(monthStartKey) {
  const firstOfMonth = monthStartKeyFor(monthStartKey);
  const leadingDays = dateKeyWeekdayIndex(firstOfMonth);
  const gridStart = addDaysToDateKey(firstOfMonth, -leadingDays);
  return Array.from({ length: GRID_CELLS }, (_, i) => addDaysToDateKey(gridStart, i));
}

function dayLabel(dayKey, todayKey, formatDateKey) {
  const label = formatDateKey(dayKey, { month: 'short', day: 'numeric' });
  return dayKey === todayKey ? `${label} (today)` : label;
}

function SkeletonMonth() {
  // Matches Dashboard's skeleton shimmer convention (.skel), applied to
  // calendar card shapes (spec §10's "Loading" row).
  const cells = Array.from({ length: 7 }, (_, i) => i);
  return (
    <div className="cal3-month">
      <div className="cal3-month-header">
        {WEEKDAY_LABELS.map((label) => <div key={label} className="cal3-month-header__cell">{label}</div>)}
      </div>
      <div className="cal3-month-body">
        {cells.map((i) => (
          <div className="cal3-month-cell" key={i}>
            <div className="cal3-month-cell__head"><span className="skel" style={{ width: 20, height: 14 }} /></div>
            {i % 2 === 0 && <div className="skel skel-post-card" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyMonthOverlay({ onQuickPost }) {
  // Spec §10: "Calendar shows the month grid empty, with a single centered
  // CTA into Quick Post or 'go create your first post' — AI Studio (a link,
  // not a redirect — Calendar stays the home surface)."
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-5)' }}>
      <section
        className="ui-empty-state"
        style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)', maxWidth: 380 }}
      >
        <div className="ui-empty-state-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" />
            <line x1="8" y1="2" x2="8" y2="6" /><line x1="16" y1="2" x2="16" y2="6" />
          </svg>
        </div>
        <h2>Nothing scheduled yet</h2>
        <p>Create your first post and pick a date &mdash; no need to open AI Studio first, though you can if you want richer generation tools.</p>
        <div className="ui-empty-state-actions">
          <button type="button" className="ui-button ui-button-accent ui-button-md" onClick={onQuickPost}>+ Quick Post</button>
        </div>
        <a className="ui-empty-state-link" href="/app/generate" style={{ marginTop: 4 }}>or go create in AI Studio &rarr;</a>
      </section>
    </div>
  );
}

export default function CalendarGrid({
  monthStartKey,
  groups = [],
  isLoading = false,
  isEmpty = false,
  selectedGroupKey = null,
  timezone = 'UTC',
  todayKey,
  formatDateKey,
  formatInTimeZone,
  moveMode,
  onOpenGroup,
  onMoveTrigger,
  onCommitMove,
  onCreateDraftForDay,
  onCellClick,
  onQuickPost,
  isLockedGroup,
}) {
  const [slideOverDay, setSlideOverDay] = useState(null);
  const [draggingGroupKey, setDraggingGroupKey] = useState(null);

  const cellKeys = useMemo(() => buildMonthCells(monthStartKey), [monthStartKey]);
  const monthOfGrid = monthStartKeyFor(monthStartKey).slice(0, 7);

  const groupsByDay = useMemo(() => {
    const map = new Map();
    groups.forEach((group) => {
      const primary = group.posts[0];
      if (!primary?.scheduled_at) return;
      const key = getZonedDateKey(primary.scheduled_at, timezone);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(group);
    });
    return map;
  }, [groups, timezone]);

  if (isLoading) return <SkeletonMonth />;

  const slideOverGroups = slideOverDay ? (groupsByDay.get(slideOverDay) || []) : [];

  return (
    <div className="cal3-month" style={{ position: 'relative' }}>
      <div className="cal3-month-header">
        {WEEKDAY_LABELS.map((label) => <div key={label} className="cal3-month-header__cell">{label}</div>)}
      </div>

      <div className="cal3-month-body">
        {cellKeys.map((dayKey) => {
          const items = groupsByDay.get(dayKey) || [];
          const visible = items.slice(0, MAX_VISIBLE_PER_DAY);
          const overflowCount = items.length - visible.length;
          const isCurrentMonth = dayKey.slice(0, 7) === monthOfGrid;
          const isToday = dayKey === todayKey;
          const label = dayLabel(dayKey, todayKey, formatDateKey);
          const isDropCandidate = moveMode?.active;

          return (
            <div
              key={dayKey}
              className={[
                'cal3-month-cell',
                isCurrentMonth ? '' : 'cal3-month-cell--muted',
                isToday ? 'cal3-month-cell--today' : '',
                isDropCandidate ? 'is-drop-candidate' : '',
              ].filter(Boolean).join(' ')}
              data-day-label={label}
              data-drop-target
              data-move-destination
              onDragOver={(e) => { e.preventDefault(); }}
              onDrop={(e) => {
                e.preventDefault();
                const groupKey = e.dataTransfer.getData('text/plain');
                if (groupKey) onCommitMove?.(groupKey, dayKey);
              }}
              onClick={(e) => {
                if (e.target.closest('.post-card') || e.target.closest('[data-move-trigger]')) return;
                if (moveMode?.active) {
                  onCommitMove?.(moveMode.groupKey, dayKey);
                  return;
                }
                onCellClick?.({ dayKey, label });
              }}
              role={isDropCandidate ? 'button' : undefined}
              tabIndex={isDropCandidate ? 0 : undefined}
            >
              <div className="cal3-month-cell__head">
                <span className="cal3-month-cell__date">{Number(dayKey.split('-')[2])}</span>
                <button
                  type="button"
                  className="cal3-month-cell__add"
                  aria-label={`New post on ${label}`}
                  onClick={(e) => { e.stopPropagation(); onCreateDraftForDay?.(dayKey); }}
                >
                  +
                </button>
              </div>

              {visible.length > 0 && (
                <div className="cal3-month-cell__stack">
                  {visible.map((group) => (
                    <PostCard
                      key={group.groupKey}
                      group={group}
                      timezone={timezone}
                      formatInTimeZone={formatInTimeZone}
                      locked={isLockedGroup?.(group)}
                      isDragging={draggingGroupKey === group.groupKey}
                      onOpen={onOpenGroup}
                      onMoveTrigger={onMoveTrigger}
                      onDragStart={(g, e) => {
                        e.dataTransfer.setData('text/plain', g.groupKey);
                        e.dataTransfer.effectAllowed = 'move';
                        setDraggingGroupKey(g.groupKey);
                      }}
                      onDragEnd={() => setDraggingGroupKey(null)}
                    />
                  ))}
                  {overflowCount > 0 && (
                    <button
                      type="button"
                      className="cal3-month-cell__more"
                      onClick={(e) => { e.stopPropagation(); setSlideOverDay(dayKey); }}
                    >
                      +{overflowCount} more
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isEmpty && <EmptyMonthOverlay onQuickPost={onQuickPost} />}

      {slideOverDay && (
        <div className="slideover-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setSlideOverDay(null); }}>
          <aside className="slideover-panel" role="dialog" aria-modal="true" aria-label={`Posts on ${slideOverDay}`}>
            <div className="slideover-panel__header">
              <div>
                <h3 className="slideover-panel__title">{formatDateKey(slideOverDay, { weekday: 'short', month: 'short', day: 'numeric' })}</h3>
                <p className="slideover-panel__sub">{slideOverGroups.length} post{slideOverGroups.length === 1 ? '' : 's'}</p>
              </div>
              <button type="button" className="ui-icon-button ui-icon-button-ghost ui-icon-button-sm" onClick={() => setSlideOverDay(null)} aria-label="Close">
                &times;
              </button>
            </div>
            <div className="slideover-panel__body">
              {slideOverGroups.map((group) => {
                const primary = group.posts[0];
                const platforms = [...new Set(group.posts.map((p) => p.platform).filter(Boolean))];
                return (
                  <button
                    key={group.groupKey}
                    type="button"
                    className="post-row"
                    onClick={() => { onOpenGroup?.(group); setSlideOverDay(null); }}
                  >
                    <span className="post-row__thumb">
                      {primary.generations?.storage_path ? (
                        // Same media_type branch PostDetailDrawer.jsx already
                        // uses (QA_PERSONA_REVIEW_build.md 2026-06-25
                        // re-test, finding #2 — video assets rendered as a
                        // broken <img> here before this fix).
                        primary.generations.media_type === 'video'
                          ? <video src={primary.generations.storage_path} muted playsInline />
                          : <img src={primary.generations.storage_path} alt="" />
                      ) : '\u{1F4C4}'}
                    </span>
                    <span className="post-row__body">
                      <span className="post-row__title">{primary.title || primary.caption?.slice(0, 40) || 'Untitled'}</span>
                      <span className="post-row__meta">
                        <span className={`status-pill status-${primary.status}`}>{primary.status}</span>
                        {platforms.length > 0 && ` · ${platforms.join(', ')}`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
