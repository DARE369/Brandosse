import React, { useState } from "react";
import { Calendar, Loader2, Trash2, Video } from "lucide-react";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { JOB_STATUS_LABELS } from "../../lib/video-engine/constants";
import { deleteVideoJob } from "../../services/videoEngineApi";

const activeStatuses = new Set(["queued", "downloading", "transcribing", "analyzing", "rendering"]);

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function JobCard({ job, onDeleted }) {
  const { navigate } = useAppNavigation();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const active = activeStatuses.has(job.status);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteVideoJob(job.id);
      onDeleted(job.id);
    } catch (err) {
      setDeleteError("Could not delete. Try again.");
      setConfirming(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article
      className="ve-job-card"
      onClick={() => navigate(`/app/video/jobs/${job.id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigate(`/app/video/jobs/${job.id}`); }}
      aria-label={`Open job: ${job.source_title || "Video"}`}
    >
      <div className="ve-job-icon">
        {active
          ? <Loader2 size={18} className="ve-spin" aria-hidden="true" />
          : <Video size={18} aria-hidden="true" />}
      </div>

      <div className="ve-job-main">
        <h3>{job.source_title || (active ? "Processing…" : "Untitled video")}</h3>
        <div className="ve-job-meta">
          <span>
            <Calendar size={14} aria-hidden="true" />
            {formatDate(job.created_at)}
          </span>
          {job.clip_count != null ? <span>{job.clip_count} clips</span> : null}
          {job.source_duration_secs ? <span>{Math.round(job.source_duration_secs / 60)} min</span> : null}
        </div>
        {deleteError ? <span className="ve-job-delete-error">{deleteError}</span> : null}
      </div>

      <span className={`ve-status-badge ve-job-${job.status}`}>
        {active ? <span className="ve-live-dot" aria-hidden="true" /> : null}
        {JOB_STATUS_LABELS[job.status] || job.status}
      </span>

      <div className="ve-job-actions" onClick={(e) => e.stopPropagation()}>
        {confirming ? (
          <div className="ve-confirm-row">
            <span>Delete?</span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              aria-label="Confirm delete"
            >
              {deleting ? <Loader2 size={13} className="ve-spin" aria-hidden="true" /> : "Yes"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} aria-label="Cancel delete">
              No
            </button>
          </div>
        ) : (
          <button
            className="ve-icon-btn ve-danger-btn"
            type="button"
            onClick={() => setConfirming(true)}
            aria-label="Delete job"
          >
            <Trash2 size={17} aria-hidden="true" />
          </button>
        )}
      </div>
    </article>
  );
}
