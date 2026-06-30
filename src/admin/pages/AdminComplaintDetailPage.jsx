"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useAdminLayoutContext } from "../AdminLayoutContext";
import { supabase } from "../../services/supabaseClient";
import { addComplaintComment, updateComplaintRecord } from "../utils/adminClient";
import { formatShortDateTime } from "../utils/formatDate";
import {
  COMPLAINT_STATUS,
  COMPLAINT_STATUS_LABEL,
} from "../../constants/statuses";

const CLOSE_REASONS = ["Duplicate", "Won't Fix", "Spam", "Other"];

function normalizeComplaintStatus(status) {
  if (status === null || status === undefined || status === "") return null;
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "submitted" || normalized === "new") return COMPLAINT_STATUS.SUBMITTED;
  if (["triaged", "in_progress", "waiting_on_user", "escalated", "under_review"].includes(normalized)) {
    return COMPLAINT_STATUS.UNDER_REVIEW;
  }
  if (normalized === COMPLAINT_STATUS.RESOLVED) return COMPLAINT_STATUS.RESOLVED;
  if (normalized === COMPLAINT_STATUS.CLOSED) return COMPLAINT_STATUS.CLOSED;
  return COMPLAINT_STATUS.SUBMITTED;
}

async function resolveScreenshotUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;

  const { data, error } = await supabase.storage
    .from("complaint-screenshots")
    .createSignedUrl(path, 60 * 60);

  if (error) return null;
  return data?.signedUrl || null;
}

export default function AdminComplaintDetailPage({ complaintId }) {
  const { navigate } = useAppNavigation();
  const { adminAccess } = useAdminLayoutContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);
  const [adminOptions, setAdminOptions] = useState([]);
  const [commentBody, setCommentBody] = useState("");
  const [nextStatus, setNextStatus] = useState(COMPLAINT_STATUS.SUBMITTED);
  const [resolutionNote, setResolutionNote] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [closeReason, setCloseReason] = useState(CLOSE_REASONS[0]);
  const [assignedAdminId, setAssignedAdminId] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function loadComplaint() {
      if (!adminAccess?.isAdmin || !complaintId) return;

      setLoading(true);
      setError(null);

      try {
        const complaintResult = await supabase
          .from("complaints")
          .select("id, subject, description, complaint_type, priority, status, resolution_note, resolved_at, assigned_admin_id, submitted_by_user_id, linked_post_id, linked_generation_id, organization_id, created_at, updated_at")
          .eq("id", complaintId)
          .maybeSingle();

        if (complaintResult.error) throw complaintResult.error;

        const optionalComplaintFields = await supabase
          .from("complaints")
          .select("title, category, screenshot_url, resolved_by_admin_id")
          .eq("id", complaintId)
          .maybeSingle();

        const commentsResult = await supabase
          .from("complaint_comments")
          .select("id, author_id, author_type, body, is_internal, created_at")
          .eq("complaint_id", complaintId)
          .order("created_at", { ascending: true });

        const historyResult = await supabase
          .from("complaint_status_history")
          .select("id, from_status, to_status, changed_by_admin_id, note, created_at")
          .eq("complaint_id", complaintId)
          .order("created_at", { ascending: false });

        const adminRoleResult = await supabase
          .from("admin_roles")
          .select("user_id, role")
          .order("created_at", { ascending: true });

        const profileIds = [...new Set([
          complaintResult.data?.submitted_by_user_id,
          complaintResult.data?.assigned_admin_id,
          optionalComplaintFields.data?.resolved_by_admin_id,
          ...(commentsResult.data || []).map((comment) => comment.author_id),
          ...(historyResult.error ? [] : (historyResult.data || []).map((entry) => entry.changed_by_admin_id)),
          ...(adminRoleResult.data || []).map((entry) => entry.user_id),
        ].filter(Boolean))];

        const profilesResult = profileIds.length
          ? await supabase
              .from("profiles")
              .select("id, full_name, email")
              .in("id", profileIds)
          : { data: [] };

        const profileMap = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
        const screenshotUrl = await resolveScreenshotUrl(optionalComplaintFields.data?.screenshot_url);
        const complaint = {
          ...complaintResult.data,
          ...(optionalComplaintFields.error ? {} : optionalComplaintFields.data || {}),
        };

        const nextAdmins = (adminRoleResult.data || []).map((admin) => ({
          id: admin.user_id,
          role: admin.role,
          profile: profileMap.get(admin.user_id) || null,
        }));

        if (!mounted) return;

        setDetail({
          complaint: {
            ...complaint,
            status: normalizeComplaintStatus(complaint.status),
            screenshot_signed_url: screenshotUrl,
          },
          comments: (commentsResult.data || []).map((comment) => ({
            ...comment,
            author: profileMap.get(comment.author_id) || null,
          })),
          history: historyResult.error
            ? []
            : (historyResult.data || []).map((entry) => ({
                ...entry,
                changedBy: profileMap.get(entry.changed_by_admin_id) || null,
                to_status: normalizeComplaintStatus(entry.to_status),
                from_status: normalizeComplaintStatus(entry.from_status),
              })),
          submittedBy: profileMap.get(complaint.submitted_by_user_id) || null,
          assignedAdmin: profileMap.get(complaint.assigned_admin_id) || null,
          resolvedBy: profileMap.get(optionalComplaintFields.data?.resolved_by_admin_id) || null,
        });
        setAdminOptions(nextAdmins);
        setNextStatus(normalizeComplaintStatus(complaint.status));
        setAssignedAdminId(complaint.assigned_admin_id || "");
        setResolutionNote(complaint.resolution_note || "");
      } catch (loadError) {
        if (!mounted) return;
        console.error("Failed to load complaint detail:", loadError);
        setDetail(null);
        setError(loadError?.message || "Failed to load complaint detail.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadComplaint();
    return () => {
      mounted = false;
    };
  }, [adminAccess, complaintId]);

  const complaint = detail?.complaint;

  const assignedAdminLabel = useMemo(() => {
    const match = adminOptions.find((admin) => admin.id === assignedAdminId);
    return match?.profile?.full_name || match?.profile?.email || "Unassigned";
  }, [adminOptions, assignedAdminId]);

  if (loading) {
    return <div className="admin-page-loading">Loading complaint...</div>;
  }

  if (!detail?.complaint) {
    return <div className="admin-panel admin-empty-state">{error || "Complaint not found or unavailable."}</div>;
  }

  const handleUpdateStatus = async () => {
    setSaving(true);
    setError(null);

    try {
      const updated = await updateComplaintRecord(adminAccess, complaint.id, {
        status: nextStatus,
        resolution_note: nextStatus === COMPLAINT_STATUS.RESOLVED ? resolutionNote : null,
        assigned_admin_id: assignedAdminId || null,
        status_note: nextStatus === COMPLAINT_STATUS.CLOSED ? closeReason : statusNote,
      });

      setDetail((current) => ({
        ...current,
        complaint: {
          ...current.complaint,
          ...updated,
          status: normalizeComplaintStatus(updated.status || nextStatus),
          resolution_note: updated.resolution_note ?? resolutionNote,
          assigned_admin_id: (updated.assigned_admin_id ?? assignedAdminId) || null,
          resolved_at: updated.resolved_at ?? current.complaint.resolved_at,
        },
        history: [
          {
            id: `${Date.now()}`,
            from_status: current.complaint.status,
            to_status: nextStatus,
            changedBy: adminAccess.profile || null,
            note: nextStatus === COMPLAINT_STATUS.CLOSED ? closeReason : statusNote || resolutionNote,
            created_at: new Date().toISOString(),
          },
          ...current.history,
        ],
      }));
    } catch (updateError) {
      setError(updateError?.message || "Failed to update complaint.");
    } finally {
      setSaving(false);
    }
  };

  const handleAddComment = async () => {
    if (!commentBody.trim()) return;

    try {
      await addComplaintComment(adminAccess, complaint.id, commentBody, true);
      setDetail((current) => ({
        ...current,
        comments: [
          ...current.comments,
          {
            id: `${Date.now()}`,
            author_id: adminAccess.user.id,
            author_type: "admin",
            body: commentBody.trim(),
            is_internal: true,
            created_at: new Date().toISOString(),
            author: adminAccess.profile || null,
          },
        ],
      }));
      setCommentBody("");
    } catch (commentError) {
      setError(commentError?.message || "Failed to add internal comment.");
    }
  };

  return (
    <section className="admin-page">
      <header className="admin-page-header">
        <div>
          <span className="admin-section-kicker">Complaint Detail</span>
          <h2 className="admin-page-title">{complaint.title || complaint.subject || "Untitled complaint"}</h2>
          <p className="admin-page-subtext">
            {complaint.category || complaint.complaint_type} - {complaint.priority || "normal"} - submitted {formatShortDateTime(complaint.created_at)}
          </p>
        </div>
      </header>

      {error ? <div className="admin-panel admin-panel-danger">{error}</div> : null}

      <div className="admin-section-grid admin-section-grid-wide">
        <div className="admin-panel">
          <h3>Complaint summary</h3>
          <div className="admin-key-value-list">
            <div><span>Status</span><strong>{COMPLAINT_STATUS_LABEL[complaint.status] || complaint.status}</strong></div>
            <div><span>Priority</span><strong>{complaint.priority || "normal"}</strong></div>
            <div><span>Submitted by</span><strong>{detail.submittedBy?.full_name || detail.submittedBy?.email || complaint.submitted_by_user_id}</strong></div>
            <div><span>Assigned admin</span><strong>{assignedAdminLabel}</strong></div>
          </div>

          <div className="admin-header-actions">
            {complaint.submitted_by_user_id ? (
              <button type="button" className="admin-inline-button" onClick={() => navigate(`/app/admin/users/${complaint.submitted_by_user_id}`)}>
                View User
              </button>
            ) : null}
            {complaint.linked_post_id ? (
              <button type="button" className="admin-inline-button" onClick={() => navigate(`/app/admin/moderation?post=${complaint.linked_post_id}`)}>
                View Post
              </button>
            ) : null}
            {complaint.linked_generation_id ? (
              <button type="button" className="admin-inline-button" onClick={() => navigate(`/app/admin/moderation?generation=${complaint.linked_generation_id}`)}>
                View Generation
              </button>
            ) : null}
          </div>

          <p className="admin-longform">{complaint.description || "No description provided."}</p>

          {complaint.screenshot_signed_url ? (
            <div className="admin-panel admin-complaint-screenshot-panel">
              <h3>Screenshot</h3>
              <img
                src={complaint.screenshot_signed_url}
                alt="Complaint screenshot"
                className="admin-complaint-screenshot-image"
              />
            </div>
          ) : null}
        </div>

        <div className="admin-panel">
          <h3>Status & Resolution</h3>
          <div className="admin-form-grid">
            <label>
              <span>Status</span>
              <select className="admin-select" value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>
                <option value={COMPLAINT_STATUS.SUBMITTED}>Pending</option>
                <option value={COMPLAINT_STATUS.UNDER_REVIEW}>Under Review</option>
                <option value={COMPLAINT_STATUS.RESOLVED}>Resolved</option>
                <option value={COMPLAINT_STATUS.CLOSED}>Closed</option>
              </select>
            </label>

            <label>
              <span>Assigned admin</span>
              <select className="admin-select" value={assignedAdminId} onChange={(event) => setAssignedAdminId(event.target.value)}>
                <option value="">Unassigned</option>
                {adminOptions.map((admin) => (
                  <option key={admin.id} value={admin.id}>
                    {admin.profile?.full_name || admin.profile?.email || admin.id}
                  </option>
                ))}
              </select>
            </label>

            {nextStatus === COMPLAINT_STATUS.RESOLVED ? (
              <label className="admin-form-grid-span">
                <span>Resolution note</span>
                <textarea
                  className="admin-textarea"
                  rows="5"
                  value={resolutionNote}
                  onChange={(event) => setResolutionNote(event.target.value)}
                />
              </label>
            ) : null}

            {nextStatus === COMPLAINT_STATUS.CLOSED ? (
              <label className="admin-form-grid-span">
                <span>Close reason</span>
                <select className="admin-select" value={closeReason} onChange={(event) => setCloseReason(event.target.value)}>
                  {CLOSE_REASONS.map((reason) => (
                    <option key={reason} value={reason}>{reason}</option>
                  ))}
                </select>
              </label>
            ) : null}

            {nextStatus !== COMPLAINT_STATUS.CLOSED ? (
              <label className="admin-form-grid-span">
                <span>Status note</span>
                <textarea
                  className="admin-textarea"
                  rows="4"
                  value={statusNote}
                  onChange={(event) => setStatusNote(event.target.value)}
                  placeholder="Optional note for the status history timeline"
                />
              </label>
            ) : null}
          </div>

          <div className="admin-header-actions">
            <button type="button" className="admin-primary-button" onClick={handleUpdateStatus} disabled={saving}>
              {saving ? "Updating..." : "Update Status"}
            </button>
          </div>

          <h3 className="admin-complaint-history-title">Status history</h3>
          <div className="admin-list-stack">
            {detail.history.length ? (
              detail.history.map((entry) => (
                <div key={entry.id} className="admin-list-item">
                  <strong>
                    {COMPLAINT_STATUS_LABEL[entry.to_status] || entry.to_status}
                    {entry.from_status ? ` from ${COMPLAINT_STATUS_LABEL[entry.from_status] || entry.from_status}` : ""}
                  </strong>
                  <span>
                    {entry.changedBy?.full_name || entry.changedBy?.email || "Admin"} - {formatShortDateTime(entry.created_at)}
                  </span>
                </div>
              ))
            ) : (
              <div className="admin-empty-inline">No status history yet.</div>
            )}
          </div>
        </div>
      </div>

      <div className="admin-panel">
        <h3>Internal complaint discussion</h3>
        <div className="admin-list-stack">
          {detail.comments.length ? (
            detail.comments.map((comment) => (
              <div key={comment.id} className="admin-list-item">
                <strong>
                  {comment.author?.full_name || comment.author?.email || comment.author_type}
                  {comment.is_internal ? " - internal" : ""}
                </strong>
                <span>{comment.body}</span>
              </div>
            ))
          ) : (
            <div className="admin-empty-inline">No internal comments yet.</div>
          )}
        </div>

        <textarea
          className="admin-textarea"
          rows="5"
          placeholder="Add internal comment"
          value={commentBody}
          onChange={(event) => setCommentBody(event.target.value)}
        />
        <div className="admin-header-actions">
          <button type="button" className="admin-primary-button" onClick={handleAddComment}>
            Add internal comment
          </button>
        </div>
      </div>
    </section>
  );
}
