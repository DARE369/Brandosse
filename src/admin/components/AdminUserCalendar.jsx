import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { formatShortDateTime } from "../utils/formatDate";
import PlatformIcon from "../../components/Shared/PlatformIcon";
import {
  fetchUserCalendarPosts,
  updateAdminPostSchedule,
} from "../utils/adminClient";

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value, amount) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function formatMonthYear(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(value);
}

function formatDayLabel(value) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    day: "numeric",
  }).format(value);
}

function toDateTimeInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function buildMonthGrid(currentDate) {
  const firstOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const gridStart = addDays(firstOfMonth, -(firstOfMonth.getDay() === 0 ? 6 : firstOfMonth.getDay() - 1));
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function getWeekDays(currentDate) {
  const day = currentDate.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  const start = addDays(startOfDay(currentDate), offset);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function matchesSameDay(left, right) {
  return startOfDay(left).getTime() === startOfDay(right).getTime();
}

function statusClass(status) {
  switch (String(status || "").toLowerCase()) {
    case "published":
      return "admin-calendar-pill-published";
    case "failed":
      return "admin-calendar-pill-failed";
    case "draft":
      return "admin-calendar-pill-draft";
    default:
      return "admin-calendar-pill-scheduled";
  }
}

function CalendarEventCard({ post, editMode, onOpen, onEdit }) {
  return (
    <div className={`admin-calendar-pill ${statusClass(post.status)}`}>
      <button type="button" className="admin-calendar-pill-main" onClick={() => onOpen(post)}>
        <PlatformIcon platform={post.platform} size="xs" />
        <span>{post.scheduled_at ? formatShortDateTime(post.scheduled_at) : "Unscheduled"}</span>
        <strong>{post.caption || "Untitled post"}</strong>
      </button>
      {editMode ? (
        <button type="button" className="admin-inline-button" onClick={() => onEdit(post)}>
          Edit
        </button>
      ) : null}
    </div>
  );
}

function ScheduleEditModal({ post, busy, onClose, onSave }) {
  const [scheduledAt, setScheduledAt] = useState(toDateTimeInputValue(post?.scheduled_at || new Date().toISOString()));

  if (!post) return null;

  return (
    <div className="admin-modal-overlay" role="presentation">
      <div className="admin-modal-card" role="dialog" aria-modal="true" aria-label="Edit post schedule">
        <div className="admin-modal-header">
          <div>
            <h3>Edit Schedule</h3>
            <p className="admin-page-subtext">{post.caption || "Untitled post"}</p>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose} aria-label="Close schedule editor">
            x
          </button>
        </div>
        <div className="admin-modal-body">
          <label className="admin-form-grid-span">
            Schedule time
            <input
              type="datetime-local"
              className="admin-input admin-input-full"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
            />
          </label>
          <div className="admin-inline-alert">
            <span>Changes here update the user's live calendar and are written to the audit log.</span>
          </div>
        </div>
        <div className="admin-modal-footer">
          <button type="button" className="admin-secondary-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="admin-primary-button"
            disabled={busy || !scheduledAt}
            onClick={() => onSave(scheduledAt)}
          >
            {busy ? "Saving..." : "Save Schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminUserCalendar({ adminAccess, userId, onViewModeration }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState("month");
  const [editMode, setEditMode] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [platformFilter, setPlatformFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingPost, setEditingPost] = useState(null);
  const [saving, setSaving] = useState(false);

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["admin-user-calendar", userId],
    queryFn: () => fetchUserCalendarPosts(userId),
    enabled: Boolean(userId),
  });

  const filteredPosts = useMemo(
    () =>
      posts.filter((post) => {
        if (platformFilter !== "all" && String(post.platform || "").toLowerCase() !== platformFilter) {
          return false;
        }
        if (statusFilter !== "all" && String(post.status || "").toLowerCase() !== statusFilter) {
          return false;
        }
        return true;
      }),
    [platformFilter, posts, statusFilter],
  );

  const groupedPlatforms = useMemo(
    () => [...new Set(posts.map((post) => String(post.platform || "").toLowerCase()).filter(Boolean))],
    [posts],
  );

  const monthDays = buildMonthGrid(currentDate);
  const weekDays = getWeekDays(currentDate);

  const getPostsForDay = (day) =>
    filteredPosts.filter((post) => {
      const dateValue = post.scheduled_at || post.created_at;
      if (!dateValue) return false;
      return matchesSameDay(new Date(dateValue), day);
    });

  const navigateDate = (direction) => {
    setCurrentDate((current) => {
      const next = new Date(current);
      if (view === "week") {
        next.setDate(next.getDate() + direction * 7);
        return next;
      }
      next.setMonth(next.getMonth() + direction);
      return next;
    });
  };

  const handleSaveSchedule = async (scheduledAt) => {
    if (!editingPost) return;
    setSaving(true);
    try {
      await updateAdminPostSchedule(adminAccess, editingPost, scheduledAt);
      toast.success("Schedule updated.");
      setEditingPost(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-user-calendar", userId] });
      await queryClient.invalidateQueries({ queryKey: ["admin-posts"] });
    } catch (error) {
      console.error("Failed to update schedule:", error);
      toast.error(error.message || "Failed to update the schedule.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-panel admin-user-calendar">
      <div className="admin-calendar-toolbar">
        <div className="admin-calendar-nav">
          <button type="button" className="admin-secondary-button" onClick={() => navigateDate(-1)}>Prev</button>
          <strong>{formatMonthYear(currentDate)}</strong>
          <button type="button" className="admin-secondary-button" onClick={() => navigateDate(1)}>Next</button>
          <button type="button" className="admin-secondary-button" onClick={() => setCurrentDate(new Date())}>Today</button>
        </div>

        <div className="admin-header-actions">
          {["month", "week", "list"].map((mode) => (
            <button
              key={mode}
              type="button"
              className={`admin-secondary-button${view === mode ? " active" : ""}`}
              onClick={() => setView(mode)}
            >
              {mode[0].toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        <div className="admin-header-actions">
          <select className="admin-select" value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)}>
            <option value="all">All platforms</option>
            {groupedPlatforms.map((platform) => (
              <option key={platform} value={platform}>{platform}</option>
            ))}
          </select>
          <select className="admin-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="published">Published</option>
            <option value="failed">Failed</option>
            <option value="draft">Draft</option>
          </select>
          <button
            type="button"
            className={editMode ? "admin-warning-button" : "admin-secondary-button"}
            onClick={() => setEditMode((current) => !current)}
          >
            {editMode ? "Exit Edit Mode" : "Edit Schedule"}
          </button>
        </div>
      </div>

      {editMode ? (
        <div className="admin-inline-alert admin-inline-alert-warning">
          <span>Edit mode active. Schedule changes affect the user's live publishing calendar and are logged.</span>
        </div>
      ) : null}

      {isLoading ? (
        <div className="admin-page-loading">Loading calendar...</div>
      ) : view === "list" ? (
        <div className="admin-list-stack">
          {filteredPosts.length ? filteredPosts.map((post) => (
            <div key={post.id} className="admin-list-item">
              <div>
                <strong>{post.caption || "Untitled post"}</strong>
                <span>{formatShortDateTime(post.scheduled_at || post.created_at)} | {post.platform || "pending"} | {post.status}</span>
              </div>
              <div className="admin-header-actions">
                <button type="button" className="admin-inline-button" onClick={() => onViewModeration(post)}>
                  View
                </button>
                {editMode ? (
                  <button type="button" className="admin-inline-button" onClick={() => setEditingPost(post)}>
                    Edit
                  </button>
                ) : null}
              </div>
            </div>
          )) : <div className="admin-empty-inline">No calendar items matched the current filters.</div>}
        </div>
      ) : (
        <div className={`admin-calendar-grid admin-calendar-grid-${view}`}>
          {(view === "week" ? weekDays : monthDays).map((day) => {
            const postsForDay = getPostsForDay(day);
            const outsideMonth = view === "month" && day.getMonth() !== currentDate.getMonth();
            return (
              <div key={day.toISOString()} className={`admin-calendar-day${outsideMonth ? " outside-month" : ""}`}>
                <div className="admin-calendar-day-head">
                  <strong>{formatDayLabel(day)}</strong>
                  <span>{postsForDay.length}</span>
                </div>
                <div className="admin-calendar-day-body">
                  {postsForDay.length ? postsForDay.map((post) => (
                    <CalendarEventCard
                      key={post.id}
                      post={post}
                      editMode={editMode}
                      onOpen={onViewModeration}
                      onEdit={setEditingPost}
                    />
                  )) : <div className="admin-calendar-empty">No posts</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ScheduleEditModal
        post={editingPost}
        busy={saving}
        onClose={() => !saving && setEditingPost(null)}
        onSave={handleSaveSchedule}
      />
    </section>
  );
}
