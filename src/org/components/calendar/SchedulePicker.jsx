import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function pad(value) {
  return String(value).padStart(2, '0');
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function createDefaultDate() {
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + 1);
  nextDate.setHours(10, 0, 0, 0);
  return nextDate;
}

function parseScheduleValue(value) {
  const nextDate = value ? new Date(value) : createDefaultDate();
  const safeDate = Number.isNaN(nextDate.getTime()) ? createDefaultDate() : nextDate;
  const hours = safeDate.getHours();

  return {
    year: safeDate.getFullYear(),
    month: safeDate.getMonth(),
    day: safeDate.getDate(),
    hour: hours % 12 || 12,
    minute: safeDate.getMinutes(),
    ampm: hours >= 12 ? 'PM' : 'AM',
  };
}

function buildScheduleValue(parts) {
  const normalizedHour = parts.ampm === 'PM'
    ? (parts.hour % 12) + 12
    : (parts.hour === 12 ? 0 : parts.hour);

  return `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)}T${pad(normalizedHour)}:${pad(parts.minute)}`;
}

function buildCalendarCells(viewYear, viewMonth, selectedParts) {
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = [];
  const today = startOfToday();

  for (let index = 0; index < firstDay; index += 1) {
    cells.push({
      key: `blank-${index}`,
      label: '',
      disabled: true,
      blank: true,
      selected: false,
      today: false,
    });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const cellDate = new Date(viewYear, viewMonth, day);
    cellDate.setHours(0, 0, 0, 0);
    cells.push({
      key: `${viewYear}-${viewMonth + 1}-${day}`,
      label: day,
      blank: false,
      disabled: cellDate < today,
      today: cellDate.getTime() === today.getTime(),
      selected: (
        selectedParts.year === viewYear
        && selectedParts.month === viewMonth
        && selectedParts.day === day
      ),
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({
      key: `tail-${cells.length}`,
      label: '',
      disabled: true,
      blank: true,
      selected: false,
      today: false,
    });
  }

  return cells;
}

export default function SchedulePicker({
  value,
  disabled = false,
  saving = false,
  onCancel,
  onConfirm,
  confirmLabel = 'Confirm schedule',
}) {
  const [selectedParts, setSelectedParts] = useState(() => parseScheduleValue(value));
  const [viewMonth, setViewMonth] = useState(selectedParts.month);
  const [viewYear, setViewYear] = useState(selectedParts.year);

  useEffect(() => {
    const nextParts = parseScheduleValue(value);
    setSelectedParts(nextParts);
    setViewMonth(nextParts.month);
    setViewYear(nextParts.year);
  }, [value]);

  const calendarCells = buildCalendarCells(viewYear, viewMonth, selectedParts);
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const changeMonth = (delta) => {
    const nextDate = new Date(viewYear, viewMonth + delta, 1);
    setViewMonth(nextDate.getMonth());
    setViewYear(nextDate.getFullYear());
  };

  const handleDaySelect = (day) => {
    setSelectedParts((current) => ({
      ...current,
      year: viewYear,
      month: viewMonth,
      day,
    }));
  };

  const adjustHour = (delta) => {
    setSelectedParts((current) => {
      const nextHour = current.hour + delta;
      if (nextHour < 1) return { ...current, hour: 12 };
      if (nextHour > 12) return { ...current, hour: 1 };
      return { ...current, hour: nextHour };
    });
  };

  const adjustMinute = (delta) => {
    setSelectedParts((current) => {
      let nextMinute = current.minute + delta;
      if (nextMinute < 0) nextMinute = 45;
      if (nextMinute >= 60) nextMinute = 0;
      return { ...current, minute: nextMinute };
    });
  };

  const handleConfirm = () => {
    if (disabled || saving) return;
    onConfirm?.(buildScheduleValue(selectedParts));
  };

  return (
    <section className="org-calendar-detail-section org-calendar-schedule-picker">
      <div className="org-calendar-schedule-head">
        <button type="button" className="org-calendar-picker-nav" onClick={() => changeMonth(-1)} disabled={disabled || saving}>
          <ChevronLeft size={16} />
        </button>
        <strong>{monthLabel}</strong>
        <button type="button" className="org-calendar-picker-nav" onClick={() => changeMonth(1)} disabled={disabled || saving}>
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="org-calendar-day-grid">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="org-calendar-day-label">{label}</span>
        ))}

        {calendarCells.map((cell) => (
          <button
            key={cell.key}
            type="button"
            className={`org-calendar-day-cell ${cell.selected ? 'selected' : ''} ${cell.today ? 'today' : ''} ${cell.blank ? 'blank' : ''}`.trim()}
            onClick={() => handleDaySelect(Number(cell.label))}
            disabled={disabled || saving || cell.disabled || cell.blank}
          >
            {cell.label}
          </button>
        ))}
      </div>

      <div className="org-calendar-time-row">
        <div className="org-calendar-time-control">
          <button type="button" className="org-calendar-time-button" onClick={() => adjustHour(1)} disabled={disabled || saving}>
            <ChevronUp size={14} />
          </button>
          <strong>{pad(selectedParts.hour)}</strong>
          <button type="button" className="org-calendar-time-button" onClick={() => adjustHour(-1)} disabled={disabled || saving}>
            <ChevronDown size={14} />
          </button>
          <span>Hour</span>
        </div>

        <span className="org-calendar-time-separator">:</span>

        <div className="org-calendar-time-control">
          <button type="button" className="org-calendar-time-button" onClick={() => adjustMinute(15)} disabled={disabled || saving}>
            <ChevronUp size={14} />
          </button>
          <strong>{pad(selectedParts.minute)}</strong>
          <button type="button" className="org-calendar-time-button" onClick={() => adjustMinute(-15)} disabled={disabled || saving}>
            <ChevronDown size={14} />
          </button>
          <span>Minute</span>
        </div>

        <div className="org-calendar-ampm-toggle">
          <button
            type="button"
            className={selectedParts.ampm === 'AM' ? 'active' : ''}
            onClick={() => setSelectedParts((current) => ({ ...current, ampm: 'AM' }))}
            disabled={disabled || saving}
          >
            AM
          </button>
          <button
            type="button"
            className={selectedParts.ampm === 'PM' ? 'active' : ''}
            onClick={() => setSelectedParts((current) => ({ ...current, ampm: 'PM' }))}
            disabled={disabled || saving}
          >
            PM
          </button>
        </div>
      </div>

      <div className="org-calendar-schedule-footer">
        <button type="button" className="org-text-button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="org-calendar-detail-button primary" onClick={handleConfirm} disabled={disabled || saving}>
          {saving ? 'Saving...' : confirmLabel}
        </button>
      </div>
    </section>
  );
}
