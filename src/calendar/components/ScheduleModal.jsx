// ScheduleModal — THE single shared scheduling UI (CALENDAR_SPEC.md §6).
// NEW file, separate from src/pages/CalendarPage/components/ScheduleModal.jsx
// (Library's modal — untouched, still load-bearing for LibraryPageV2.jsx per
// AS_IS_AUDIT.md §3.8 / Master Brief's explicit "do not touch" instruction).
//
// Fixes the timezone bug the old modal has (naive browser-local Date objects,
// no timezone parameter at all) by using src/utils/timezone.js exclusively —
// every date/time surface here shows the account timezone explicitly, never
// an implicit browser-local time (spec §6, AS_IS_AUDIT.md §3.8/§3.12).
//
// Date/time picker (account timezone, explicit), target account
// confirmation, and the conflict check from spec §5 (non-blocking — never a
// hard block). Invoked from Calendar's own flows: drag/move-mode commit
// surfaces its own inline confirmation, and this modal serves the explicit
// "Reschedule…" / "Schedule this post" entry points.
//
// This header used to claim it was also invoked "from QuickPostComposer's
// 'pick a date/time' step". It was not, and had not been: the composer has its
// own date and time inputs. Corrected 2026-09-15 per Law 2 — a doc that
// disagrees with the code is a bug, not a note. What the two surfaces DO share,
// as of Phase 3, is the thing that actually matters: scheduleSeed.js decides
// what both open on and what both refuse, so a reschedule and a new post cannot
// disagree about when "too soon" begins.
import { useEffect, useMemo, useState } from 'react';
import {
  addMonthsToDateKey,
  formatDateKey,
  getZonedTodayKey,
  monthStartKeyFor,
  zonedDateTimeToUTC,
} from '../../utils/timezone';
import { checkScheduleFloor, seedFromPost } from '../scheduleSeed';

function buildMiniCalendarDays(monthStartKey) {
  const first = monthStartKeyFor(monthStartKey);
  const [y, m] = first.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0=Sun
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return cells;
}

export default function ScheduleModal({
  open,
  post,
  timezone = 'UTC',
  accountLabel = '',
  accountAvatarUrl = null,
  conflict = null,
  isSubmitting = false,
  onClose,
  onConfirm, // (dateKey, timeStr) => void
}) {
  const todayKey = useMemo(() => getZonedTodayKey(timezone), [timezone]);

  // Seeded through scheduleSeed.js, the ONE place that decides what a picker
  // opens on.
  //
  // This used to take the date from `.toISOString().slice(0,10)` and the time
  // from `getUTCHours()` — UTC parts — while the banner a few lines below
  // promised the account timezone and CalendarPage read the values back with
  // zonedDateTimeToUTC(..., timezone). For any account off UTC, opening
  // "Reschedule…" and pressing Confirm WITHOUT TOUCHING ANYTHING moved the post
  // by the zone's offset, and moved it again on every reopen.
  const seeded = useMemo(
    () => seedFromPost(post, timezone),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [post?.scheduled_at, post?.id, timezone],
  );

  const [monthStartKey, setMonthStartKey] = useState(() => monthStartKeyFor(seeded.dateKey));
  const [selectedDateKey, setSelectedDateKey] = useState(seeded.dateKey);
  const [timeStr, setTimeStr] = useState(seeded.timeStr);

  useEffect(() => {
    if (!open) return;
    setMonthStartKey(monthStartKeyFor(seeded.dateKey));
    setSelectedDateKey(seeded.dateKey);
    setTimeStr(seeded.timeStr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, post?.id]);

  if (!open) return null;

  const days = buildMiniCalendarDays(monthStartKey);
  const monthLabel = formatDateKey(monthStartKey, { month: 'long', year: 'numeric' });

  // The floor, evaluated on the resolved INSTANT rather than the wall clock —
  // see scheduleSeed.js. Recomputed each render so the message tracks the clock
  // while the modal sits open: a time that was valid when it opened can fall
  // below the floor while the user is still deciding.
  const floor = checkScheduleFloor(selectedDateKey, timeStr, timezone);

  const handleConfirm = () => {
    if (!floor.ok) return;
    onConfirm?.(selectedDateKey, timeStr);
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="schedule-modal" role="dialog" aria-modal="true" aria-label="Schedule post">
        <div className="schedule-modal__header">
          <h3 className="schedule-modal__title">Schedule post</h3>
          <button type="button" className="ui-icon-button ui-icon-button-ghost ui-icon-button-sm" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="schedule-modal__body">
          <div className="tz-banner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            All times below are in your <strong>account timezone: {timezone}</strong>, not your browser&apos;s local timezone.
          </div>

          <div>
            <div className="mini-calendar__nav">
              <span className="mini-calendar__label">{monthLabel}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" className="ui-icon-button ui-icon-button-secondary ui-icon-button-sm" aria-label="Previous month" onClick={() => setMonthStartKey((k) => addMonthsToDateKey(k, -1))}>&lsaquo;</button>
                <button type="button" className="ui-icon-button ui-icon-button-secondary ui-icon-button-sm" aria-label="Next month" onClick={() => setMonthStartKey((k) => addMonthsToDateKey(k, 1))}>&rsaquo;</button>
              </div>
            </div>
            <div className="mini-calendar">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <div key={d} className="mini-calendar__weekday">{d}</div>)}
              {days.map((dayKey, i) => {
                if (!dayKey) return <div key={`empty-${i}`} className="mini-calendar__day is-empty" />;
                const isToday = dayKey === todayKey;
                const isSelected = dayKey === selectedDateKey;
                return (
                  <button
                    key={dayKey}
                    type="button"
                    className={`mini-calendar__day${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}`}
                    onClick={() => setSelectedDateKey(dayKey)}
                  >
                    {Number(dayKey.split('-')[2])}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="time-row">
            <input
              className="ui-input"
              type="time"
              value={timeStr}
              onChange={(e) => setTimeStr(e.target.value)}
              aria-label="Scheduled time"
            />
            <span className="ui-field-hint">
              {selectedDateKey ? formatDateKey(selectedDateKey, { weekday: 'short', month: 'short', day: 'numeric' }) : ''}
            </span>
            <span className="ui-field-hint">{timezone}</span>
          </div>

          {accountLabel && (
            <div className="target-account-card">
              <span className="target-account-card__avatar">
                {accountAvatarUrl ? <img src={accountAvatarUrl} alt="" /> : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="5" /></svg>
                )}
              </span>
              <div className="target-account-card__body">
                <div className="target-account-card__name">{accountLabel}</div>
                <div className="target-account-card__meta">Connected &middot; this is where the post will publish</div>
              </div>
              <span className="ui-badge ui-badge-tone-success">Active</span>
            </div>
          )}

          {conflict && (
            <div className="conflict-banner">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>Another post is already scheduled to this account at this exact time. You can still schedule this one — it will not overwrite the other.</span>
            </div>
          )}
        </div>

        {/* Says WHY, and names the alternative. A bare disabled button here
            reads as the product being broken — the user picked a real time and
            nothing explains the refusal. */}
        {!floor.ok && floor.reason && (
          <div className="ui-field-error" role="alert">{floor.reason}</div>
        )}

        <div className="schedule-modal__footer">
          <button type="button" className="ui-button ui-button-secondary ui-button-md" onClick={onClose}>Cancel</button>
          <button type="button" className="ui-button ui-button-primary ui-button-md" onClick={handleConfirm} disabled={isSubmitting || !floor.ok}>
            {isSubmitting ? 'Scheduling…' : 'Confirm schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

export { zonedDateTimeToUTC };
