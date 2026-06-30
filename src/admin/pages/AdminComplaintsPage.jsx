"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useAdminLayoutContext } from "../AdminLayoutContext";
import { supabase } from "../../services/supabaseClient";
import { updateComplaintRecord } from "../utils/adminClient";
import { formatRelativeTime, formatShortDateTime } from "../utils/formatDate";
import {
  COMPLAINT_STATUS,
  COMPLAINT_STATUS_LABEL,
} from "../../constants/statuses";

const STATUS_TABS = [
  { label: "All", value: "all" },
  { label: "Pending", value: COMPLAINT_STATUS.SUBMITTED },
  { label: "Under Review", value: COMPLAINT_STATUS.UNDER_REVIEW },
  { label: "Resolved", value: COMPLAINT_STATUS.RESOLVED },
  { label: "Closed", value: COMPLAINT_STATUS.CLOSED },
];

const LEGACY_TYPE_LABELS = {
  account_issue: "Account",
  publishing_issue: "Publishing",
  credits_issue: "Billing",
  content_quality: "Generation",
  brand_mismatch: "Generation",
  abuse_report: "Other",
  connection_issue: "Platform Connection",
  other: "Other",
};

function normalizeComplaintStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "submitted" || normalized === "new") return COMPLAINT_STATUS.SUBMITTED;
  if (["triaged", "in_progress", "waiting_on_user", "escalated", "under_review"].includes(normalized)) {
    return COMPLAINT_STATUS.UNDER_REVIEW;
  }
  if (normalized === COMPLAINT_STATUS.RESOLVED) return COMPLAINT_STATUS.RESOLVED;
  if (normalized === COMPLAINT_STATUS.CLOSED) return COMPLAINT_STATUS.CLOSED;
  return COMPLAINT_STATUS.SUBMITTED;
}

function getComplaintCategoryLabel(complaintType) {
  return LEGACY_TYPE_LABELS[complaintType] || "Other";
}

export default function AdminComplaintsPage() {
  const { navigate } = useAppNavigation();
  const { adminAccess } = useAdminLayoutContext();
  const [loading, setLoading] = useState(true);
  const [complaints, setComplaints] = useState([]);
  const [profiles, setProfiles] = useState(new Map());
  const [filters, setFilters] = useState({
    status: "all",
    priority: "all",
    search: "",
  });

  useEffect(() => {
    let mounted = true;

    async function loadComplaints() {
      if (!adminAccess?.isAdmin) {
        if (mounted) {
          setComplaints([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);

      try {
        let query = supabase
          .from("complaints")
          .select("id, subject, complaint_type, priority, status, assigned_admin_id, organization_id, submitted_by_user_id, created_at, updated_at")
          .order("created_at", { ascending: false })
          .limit(100);

        if (adminAccess.isOrgAdmin) {
          query = query.eq("organization_id", adminAccess.organizationId);
        }

        if (filters.priority !== "all") {
          query = query.eq("priority", filters.priority);
        }

        if (filters.search.trim()) {
          query = query.or(`subject.ilike.%${filters.search.trim()}%,description.ilike.%${filters.search.trim()}%`);
        }

        const { data, error } = await query;
        if (error) throw error;

        const normalizedComplaints = (data || []).map((complaint) => ({
          ...complaint,
          displayStatus: normalizeComplaintStatus(complaint.status),
        }));

        const visibleComplaints = filters.status === "all"
          ? normalizedComplaints
          : normalizedComplaints.filter((complaint) => complaint.displayStatus === filters.status);

        const profileIds = [...new Set(
          visibleComplaints.flatMap((complaint) => [complaint.submitted_by_user_id, complaint.assigned_admin_id]).filter(Boolean),
        )];

        let nextProfiles = new Map();
        if (profileIds.length) {
          const profilesResult = await supabase
            .from("profiles")
            .select("id, full_name, email")
            .in("id", profileIds);

          nextProfiles = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
        }

        if (!mounted) return;
        setComplaints(visibleComplaints);
        setProfiles(nextProfiles);
      } catch (error) {
        if (!mounted) return;
        console.error("Failed to load complaints:", error);
        setComplaints([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadComplaints();
    return () => {
      mounted = false;
    };
  }, [adminAccess, filters.priority, filters.search, filters.status]);

  const complaintCounts = useMemo(() => {
    return complaints.reduce((accumulator, complaint) => {
      accumulator[complaint.displayStatus] = (accumulator[complaint.displayStatus] || 0) + 1;
      return accumulator;
    }, {});
  }, [complaints]);

  const handleMarkUnderReview = async (complaintId) => {
    await updateComplaintRecord(adminAccess, complaintId, {
      status: COMPLAINT_STATUS.UNDER_REVIEW,
      status_note: "Moved to under review from list view",
    });

    setComplaints((current) => current.map((complaint) => (
      complaint.id === complaintId
        ? { ...complaint, status: COMPLAINT_STATUS.UNDER_REVIEW, displayStatus: COMPLAINT_STATUS.UNDER_REVIEW }
        : complaint
    )));
  };

  return (
    <section className="admin-page">
      <header className="admin-page-header">
        <div>
          <span className="admin-section-kicker">Support Queue</span>
          <h2 className="admin-page-title">Complaints</h2>
          <p className="admin-page-subtext">
            Status-driven support intake with scoped user context and direct resolution routing.
          </p>
        </div>
      </header>

      <div className="admin-tabs">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={`admin-tab ${filters.status === tab.value ? "active" : ""}`}
            onClick={() => setFilters((current) => ({ ...current, status: tab.value }))}
          >
            {tab.label}
            {tab.value !== "all" ? ` (${complaintCounts[tab.value] || 0})` : ""}
          </button>
        ))}
      </div>

      <div className="admin-filterbar">
        <select
          className="admin-select"
          value={filters.priority}
          onChange={(event) => setFilters((current) => ({ ...current, priority: event.target.value }))}
        >
          <option value="all">All priorities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>

        <input
          type="search"
          className="admin-input"
          placeholder="Search complaints"
          value={filters.search}
          onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
        />
      </div>

      <div className="admin-panel">
        <div className="admin-table-wrap">
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Title</th>
                <th>Submitted By</th>
                <th>Assigned Admin</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="8" className="admin-table-empty">Loading complaints...</td></tr>
              ) : complaints.length ? (
                complaints.map((complaint) => {
                  const submittedBy = profiles.get(complaint.submitted_by_user_id);
                  const assignedAdmin = profiles.get(complaint.assigned_admin_id);

                  return (
                    <tr key={complaint.id}>
                      <td>{getComplaintCategoryLabel(complaint.complaint_type)}</td>
                      <td>{complaint.subject || "Untitled complaint"}</td>
                      <td>{submittedBy?.full_name || submittedBy?.email || complaint.submitted_by_user_id || "-"}</td>
                      <td>{assignedAdmin?.full_name || assignedAdmin?.email || "Unassigned"}</td>
                      <td>{complaint.priority || "normal"}</td>
                      <td>{COMPLAINT_STATUS_LABEL[complaint.displayStatus] || complaint.displayStatus}</td>
                      <td>{formatRelativeTime(complaint.created_at)}</td>
                      <td>
                        <div className="admin-header-actions">
                          {complaint.displayStatus === COMPLAINT_STATUS.SUBMITTED ? (
                            <button
                              type="button"
                              className="admin-inline-button"
                              onClick={() => handleMarkUnderReview(complaint.id)}
                            >
                              Mark as Under Review
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="admin-inline-button"
                            onClick={() => navigate(`/app/admin/complaints/${complaint.id}`)}
                          >
                            Open
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr><td colSpan="8" className="admin-table-empty">No complaints in scope.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
