import React, { useMemo, useState } from "react";
import { X, ChevronLeft, ChevronRight, Clock, Calendar as CalendarIcon } from "lucide-react";
import { POST_STATUS } from "../../../constants/statuses";
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function clampNumber(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export default function ScheduleModal({ post, onClose, onSave }) {
  const initialDate = useMemo(() => {
    if (post?.scheduled_at) {
      const parsed = new Date(post.scheduled_at);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
  }, [post?.scheduled_at]);

  const [currentDate, setCurrentDate] = useState(
    () => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1)
  );
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [time, setTime] = useState({
    hours: String(initialDate.getHours()).padStart(2, "0"),
    minutes: String(initialDate.getMinutes()).padStart(2, "0"),
  });

  const daysInMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth() + 1,
    0
  ).getDate();
  const firstDayOfMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1
  ).getDay();
  const today = new Date();

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handleDayClick = (day) => {
    setSelectedDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), day));
  };

  const handleSave = () => {
    const hours = clampNumber(time.hours, 0, 23, 12);
    const minutes = clampNumber(time.minutes, 0, 59, 0);

    const scheduledDateTime = new Date(selectedDate);
    scheduledDateTime.setHours(hours, minutes, 0, 0);

    onSave({
      ...post,
      caption: post?.caption ?? post?.generations?.prompt ?? "",
      scheduled_at: scheduledDateTime.toISOString(),
      // Canonical publishing lifecycle status for scheduled posts.
      status: POST_STATUS.SCHEDULED,
    });
  };

  const renderCalendarDays = () => {
    const days = [];

    for (let i = 0; i < firstDayOfMonth; i += 1) {
      days.push(<div key={`empty-${i}`} className="calendar-schedule-day empty" />);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const isSelected =
        selectedDate.getDate() === day &&
        selectedDate.getMonth() === currentDate.getMonth() &&
        selectedDate.getFullYear() === currentDate.getFullYear();
      const isToday =
        today.getDate() === day &&
        today.getMonth() === currentDate.getMonth() &&
        today.getFullYear() === currentDate.getFullYear();

      days.push(
        <button
          type="button"
          key={day}
          onClick={() => handleDayClick(day)}
          className={`calendar-schedule-day ${isSelected ? "selected" : ""} ${isToday ? "today" : ""}`}
        >
          {day}
        </button>
      );
    }

    return days;
  };

  return (
    <div className="calendar-schedule-overlay" role="presentation" onClick={onClose}>
      <div
        className="calendar-schedule-container"
        role="dialog"
        aria-modal="true"
        aria-label="Schedule post"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="calendar-schedule-header">
          <h3>Schedule Post</h3>
          <button type="button" onClick={onClose} className="calendar-schedule-close" aria-label="Close schedule modal">
            <X size={18} />
          </button>
        </div>

        <div className="calendar-schedule-body">
          <section className="calendar-schedule-calendar">
            <div className="calendar-schedule-nav">
              <span>
                {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
              </span>
              <div className="calendar-schedule-arrows">
                <button type="button" onClick={handlePrevMonth} aria-label="Previous month">
                  <ChevronLeft size={16} />
                </button>
                <button type="button" onClick={handleNextMonth} aria-label="Next month">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            <div className="calendar-schedule-weekdays">
              <span>Su</span>
              <span>Mo</span>
              <span>Tu</span>
              <span>We</span>
              <span>Th</span>
              <span>Fr</span>
              <span>Sa</span>
            </div>

            <div className="calendar-schedule-days">{renderCalendarDays()}</div>
          </section>

          <section className="calendar-schedule-time">
            <div className="calendar-schedule-label">
              <Clock size={14} />
              <span>Set Time</span>
            </div>

            <div className="calendar-schedule-time-picker">
              <div className="calendar-schedule-time-input-group">
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={time.hours}
                  onChange={(event) => setTime((prev) => ({ ...prev, hours: event.target.value }))}
                  className="calendar-schedule-time-input"
                  aria-label="Hours"
                />
                <span>:</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={time.minutes}
                  onChange={(event) => setTime((prev) => ({ ...prev, minutes: event.target.value }))}
                  className="calendar-schedule-time-input"
                  aria-label="Minutes"
                />
              </div>
            </div>

            <div className="calendar-schedule-summary">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <CalendarIcon size={14} />
                <span>
                  {selectedDate.toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </span>
              </div>
              <strong>
                at{" "}
                {String(clampNumber(time.hours, 0, 23, 12)).padStart(2, "0")}:
                {String(clampNumber(time.minutes, 0, 59, 0)).padStart(2, "0")}
              </strong>
            </div>

            <button type="button" className="calendar-schedule-confirm" onClick={handleSave}>
              Confirm Schedule
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
