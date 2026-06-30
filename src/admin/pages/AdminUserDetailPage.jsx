"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, KeyRound, Shield } from "lucide-react";
import toast from "react-hot-toast";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useAdminLayoutContext } from "../AdminLayoutContext";
import ActivityStatusBadge from "../components/ActivityStatusBadge";
import AdminNotesPanel from "../components/AdminNotesPanel";
import AdminNotifyUserModal from "../components/AdminNotifyUserModal";
import AdminRiskBadge from "../components/AdminRiskBadge";
import AdminUserCalendar from "../components/AdminUserCalendar";
import QualityScoreBadge from "../components/QualityScoreBadge";
import SuspendUserModal from "../components/SuspendUserModal";
import AdminModerationWorkspace from "./AdminModeration/AdminModerationWorkspace";
import {
  addAdminNote,
  addComplaintComment,
  deleteAdminNote,
  fetchAdminNotes,
  fetchOrganizationsByIds,
  fetchUserActivityLog,
  inferActivityStatus,
  requestUserDeletion,
  sendAdminPasswordReset,
  sendAdminUserNotification,
  updateAdminNote,
  updateAdminUserStatus,
  updateComplaintRecord,
} from "../utils/adminClient";
import { formatRelativeTime, formatShortDate, formatShortDateTime } from "../utils/formatDate";
import { supabase } from "../../services/supabaseClient";

const TABS = [
  ["overview", "Overview"],
  ["platforms", "Connected Platforms"],
  ["posts", "Posts & Library"],
  ["calendar", "Calendar"],
  ["activity", "Activity Log"],
  ["complaints", "Complaints / Tickets"],
  ["analytics", "Analytics"],
  ["security", "Security & Actions"],
];

const EVENT_TAGS = {
  login: ["Login", "info"],
  logout: ["Logout", "muted"],
  generation_started: ["Generation", "info"],
  generation_completed: ["Generated", "success"],
  generation_failed: ["Gen Failed", "danger"],
  post_draft_created: ["Draft", "muted"],
  post_edited: ["Edited", "accent"],
  post_scheduled: ["Scheduled", "accent"],
  post_published: ["Published", "success"],
  post_failed: ["Pub Failed", "danger"],
  suspended: ["Suspended", "warning"],
  restriction_lifted: ["Unsuspended", "success"],
  "admin.reset_password": ["Pwd Reset", "warning"],
  "admin.suspend_user": ["Suspended", "warning"],
  "admin.unsuspend_user": ["Unsuspended", "success"],
  admin_note_added: ["Note", "info"],
  admin_note_updated: ["Note", "info"],
  admin_note_deleted: ["Note", "muted"],
  admin_notified_user: ["Notified", "accent"],
};

function eventTag(eventType) {
  const [label, tone] = EVENT_TAGS[eventType] || [eventType || "Activity", "muted"];
  return { label, tone };
}

export default function AdminUserDetailPage({ userId }) {
  const { navigate } = useAppNavigation();
  const { adminAccess } = useAdminLayoutContext();
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityEntries, setActivityEntries] = useState([]);
  const [activityFilters, setActivityFilters] = useState({ eventCategory: "all", dateFrom: "", dateTo: "" });
  const [notes, setNotes] = useState([]);
  const [notesBusy, setNotesBusy] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notificationFeedback, setNotificationFeedback] = useState({ status: "idle" });
  const [commentDraft, setCommentDraft] = useState("");
  const [suspendModalOpen, setSuspendModalOpen] = useState(false);
  const [suspendBusy, setSuspendBusy] = useState(false);
  const [passwordResetState, setPasswordResetState] = useState({ status: "idle" });
  const [securityForm, setSecurityForm] = useState({ deletionReason: "other", deletionNote: "", deletionConfirm: "" });

  useEffect(() => {
    let mounted = true;
    async function loadDetail() {
      if (!adminAccess?.isAdmin || !userId) {
        if (mounted) {
          setDetail(null);
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      try {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id, full_name, email, avatar_url, role, organization_id, created_at, last_active_at, activity_status, credits")
          .eq("id", userId)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!profile) throw new Error("User not found");
        const [orgMap, accountsResult, postsResult, generationsResult, complaintsResult] = await Promise.all([
          fetchOrganizationsByIds([profile.organization_id]),
          supabase.from("connected_accounts").select("id, platform, account_name, username, connection_status, created_at").eq("user_id", userId).order("created_at", { ascending: false }),
          supabase.from("posts").select("id, generation_id, caption, platform, hashtags, status, scheduled_at, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(60),
          supabase.from("generations").select("id, prompt, status, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(60),
          supabase.from("complaints").select("id, subject, status, priority, complaint_type, created_at").eq("submitted_by_user_id", userId).order("created_at", { ascending: false }).limit(20),
        ]);
        const generationIds = [...(generationsResult.data || []).map((item) => item.id), ...(postsResult.data || []).map((item) => item.generation_id).filter(Boolean)];
        const qualityResult = generationIds.length
          ? await supabase.from("content_quality_reviews").select("id, generation_id, post_id, overall_score, created_at").in("generation_id", [...new Set(generationIds)]).order("created_at", { ascending: false }).limit(80)
          : { data: [], error: null };
        if (!mounted) return;
        const qualityReviews = qualityResult.error ? [] : qualityResult.data || [];
        setDetail({
          profile: { ...profile, activity_status: inferActivityStatus(profile) },
          organization: orgMap.get(profile.organization_id) || null,
          connectedAccounts: accountsResult.error ? [] : accountsResult.data || [],
          posts: postsResult.error ? [] : postsResult.data || [],
          generations: generationsResult.error ? [] : generationsResult.data || [],
          complaints: complaintsResult.error ? [] : complaintsResult.data || [],
          qualityReviews,
        });
      } catch (error) {
        if (mounted) {
          console.error("Failed to load user detail:", error);
          setDetail(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadDetail();
    return () => { mounted = false; };
  }, [adminAccess?.isAdmin, userId]);

  useEffect(() => {
    let mounted = true;
    async function loadActivity() {
      if (!adminAccess?.isAdmin || !userId) return;
      setActivityLoading(true);
      try {
        const dateFrom = activityFilters.dateFrom ? new Date(`${activityFilters.dateFrom}T00:00:00.000Z`).toISOString() : null;
        const dateTo = activityFilters.dateTo ? new Date(`${activityFilters.dateTo}T23:59:59.999Z`).toISOString() : null;
        const entries = await fetchUserActivityLog(userId, { eventCategory: activityFilters.eventCategory, dateFrom, dateTo });
        if (mounted) setActivityEntries(entries.map((event) => ({ ...event, tag: eventTag(event.event_type) })));
      } catch (error) {
        if (mounted) {
          console.error("Failed to load activity log:", error);
          setActivityEntries([]);
        }
      } finally {
        if (mounted) setActivityLoading(false);
      }
    }
    loadActivity();
    return () => { mounted = false; };
  }, [adminAccess?.isAdmin, activityFilters.dateFrom, activityFilters.dateTo, activityFilters.eventCategory, userId]);

  useEffect(() => {
    let mounted = true;
    async function loadNotes() {
      if (!adminAccess?.isAdmin || !userId) return;
      try {
        const rows = await fetchAdminNotes(userId);
        if (mounted) setNotes(rows);
      } catch (error) {
        if (mounted) {
          console.error("Failed to load admin notes:", error);
          setNotes([]);
        }
      }
    }
    loadNotes();
    return () => { mounted = false; };
  }, [adminAccess?.isAdmin, userId]);

  const analytics = useMemo(() => {
    if (!detail) return null;
    const scores = detail.qualityReviews.map((item) => Number(item.overall_score)).filter(Number.isFinite);
    return {
      totalGenerations: detail.generations.length,
      totalPosts: detail.posts.length,
      connectedPlatforms: detail.connectedAccounts.length,
      scheduledPosts: detail.posts.filter((post) => post.scheduled_at).length,
      publishedPosts: detail.posts.filter((post) => post.status === "published").length,
      failedPosts: detail.posts.filter((post) => post.status === "failed").length,
      avgQualityScore: scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null,
    };
  }, [detail]);

  if (loading) return <div className="admin-page-loading">Loading user detail...</div>;
  if (!detail || !analytics) return <div className="admin-page-loading">User detail unavailable.</div>;

  const { profile } = detail;
  const displayName = profile.full_name || profile.email || profile.id;

  const handleResetPassword = async () => {
    setPasswordResetState({ status: "loading" });
    try {
      await sendAdminPasswordReset(adminAccess, profile);
      setPasswordResetState({ status: "sent", sentAt: new Date().toISOString() });
      toast.success(`Password reset email sent to ${profile.email}.`);
    } catch (error) {
      console.error("Failed to send password reset:", error);
      setPasswordResetState({ status: "error" });
      toast.error("Failed to send the password reset email.");
    }
  };

  const handleSuspend = async () => {
    if (profile.activity_status !== "suspended") return setSuspendModalOpen(true);
    try {
      await updateAdminUserStatus(adminAccess, profile, { mode: "unsuspend", note: "Restriction lifted from admin user detail." });
      setDetail((current) => ({ ...current, profile: { ...current.profile, activity_status: "active", suspension_type: null, suspension_expires_at: null } }));
      toast.success(`Restrictions lifted for ${displayName}.`);
    } catch (error) {
      console.error("Failed to lift restriction:", error);
      toast.error("Failed to lift the restriction.");
    }
  };

  const handleConfirmSuspend = async (payload) => {
    setSuspendBusy(true);
    try {
      await updateAdminUserStatus(adminAccess, profile, { mode: "suspend", ...payload });
      setDetail((current) => ({ ...current, profile: { ...current.profile, activity_status: "suspended" } }));
      setSuspendModalOpen(false);
      toast.success("User suspended.");
    } catch (error) {
      console.error("Failed to suspend user:", error);
      toast.error("Failed to suspend the user.");
    } finally {
      setSuspendBusy(false);
    }
  };

  const handleDeletionRequest = async () => {
    if (securityForm.deletionConfirm !== `DELETE ${displayName}`) {
      toast.error(`Type DELETE ${displayName} to submit the request.`);
      return;
    }
    try {
      await requestUserDeletion(adminAccess, profile, { reasonCode: securityForm.deletionReason, note: securityForm.deletionNote });
      setDetail((current) => ({ ...current, profile: { ...current.profile, activity_status: "pending_deletion" } }));
      toast.success("Deletion request submitted for approval.");
    } catch (error) {
      console.error("Failed to request deletion:", error);
      toast.error("Failed to submit the deletion request.");
    }
  };

  const handleResolveComplaint = async (complaintId) => {
    try {
      await updateComplaintRecord(adminAccess, complaintId, { status: "resolved" });
      setDetail((current) => ({ ...current, complaints: current.complaints.map((item) => item.id === complaintId ? { ...item, status: "resolved" } : item) }));
      toast.success("Complaint resolved.");
    } catch (error) {
      console.error("Failed to resolve complaint:", error);
      toast.error("Failed to resolve the complaint.");
    }
  };

  const handleAddComplaintComment = async () => {
    if (!detail.complaints.length || !commentDraft.trim()) return;
    try {
      await addComplaintComment(adminAccess, detail.complaints[0].id, commentDraft, true);
      setCommentDraft("");
      toast.success("Internal comment added to the newest complaint.");
    } catch (error) {
      console.error("Failed to add complaint comment:", error);
      toast.error("Failed to add the internal comment.");
    }
  };

  const handleSendNotification = async (payload) => {
    setNotifyBusy(true);
    try {
      await sendAdminUserNotification(adminAccess, profile.id, payload);
      setNotifyOpen(false);
      setNotificationFeedback({ status: "sent", sentAt: new Date().toISOString(), channel: payload.channel });
      toast.success(`Notification sent to ${displayName}.`);
    } catch (error) {
      console.error("Failed to send notification:", error);
      toast.error(error.message || "Failed to send the notification.");
    } finally {
      setNotifyBusy(false);
    }
  };

  const upsertNote = async (action) => {
    setNotesBusy(true);
    try {
      const result = await action();
      return result;
    } catch (error) {
      console.error("Failed to save note:", error);
      toast.error(error.message || "Failed to save the note.");
      return null;
    } finally {
      setNotesBusy(false);
    }
  };

  return (
    <section className="admin-page">
      <button type="button" className="admin-back-btn" onClick={() => navigate("/app/admin/users")}>
        <ArrowLeft size={16} />
        <span>Back to Users</span>
      </button>

      <header className="admin-page-header admin-page-header-tight">
        <div className="admin-identity-hero">
          <div className="admin-avatar admin-avatar-lg">{displayName.slice(0, 2).toUpperCase()}</div>
          <div>
            <span className="admin-section-kicker">Admin User Detail</span>
            <h2 className="admin-page-title">{displayName}</h2>
            <p className="admin-page-subtext">{profile.email} | Joined {formatShortDate(profile.created_at)} | Last active {formatRelativeTime(profile.last_active_at)}</p>
            <div className="admin-tag-row">
              <ActivityStatusBadge status={profile.activity_status} />
              <span className="admin-tag">{detail.organization?.name || "No organization"}</span>
              <span className="admin-tag">{profile.role || "user"}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="admin-tabs">
        {TABS.map(([value, label]) => (
          <button key={value} type="button" className={`admin-tab${activeTab === value ? " active" : ""}`} onClick={() => setActiveTab(value)}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div className="admin-user-overview">
          <section className="admin-panel admin-user-identity-panel">
            <div className="admin-user-identity-row">
              <div className="admin-avatar admin-avatar-xl">{displayName.slice(0, 2).toUpperCase()}</div>
              <div className="admin-user-identity-copy">
                <h3>{displayName}</h3>
                <p>{profile.email}</p>
                <div className="admin-tag-row">
                  <ActivityStatusBadge status={profile.activity_status} />
                  <span className="admin-tag">{profile.role || "user"}</span>
                  <span className="admin-tag">{detail.organization?.name || "No organization"}</span>
                </div>
                <div className="admin-user-meta-line">Joined {formatShortDate(profile.created_at)} | Last active {formatRelativeTime(profile.last_active_at)}</div>
              </div>
            </div>
          </section>
          <section className="admin-stat-card-grid">
            <article className="admin-panel admin-stat-card"><span>Total Generations</span><strong>{analytics.totalGenerations}</strong></article>
            <article className="admin-panel admin-stat-card"><span>Total Posts</span><strong>{analytics.totalPosts}</strong></article>
            <article className="admin-panel admin-stat-card"><span>Credits</span><strong>{profile.credits ?? 0}</strong></article>
            <article className="admin-panel admin-stat-card"><span>Platforms Connected</span><strong>{analytics.connectedPlatforms}</strong></article>
          </section>
          <section className="admin-panel">
            <h3>Usage Summary</h3>
            <div className="admin-metric-grid">
              <div><span>Posts scheduled</span><strong>{analytics.scheduledPosts}</strong></div>
              <div><span>Posts published</span><strong>{analytics.publishedPosts}</strong></div>
              <div><span>Posts failed</span><strong>{analytics.failedPosts}</strong></div>
              <div><span>Avg quality score</span><strong>{analytics.avgQualityScore ?? "-"}</strong></div>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "platforms" ? (
        <div className="admin-card-grid">
          {detail.connectedAccounts.length ? detail.connectedAccounts.map((account) => {
            const platformPosts = detail.posts.filter((post) => (post.platform || "").toLowerCase() === (account.platform || "").toLowerCase());
            return (
              <article key={account.id} className="admin-panel">
                <h3>{account.platform}</h3>
                <div className="admin-key-value-list">
                  <div><span>Account</span><strong>{account.account_name || account.username || "-"}</strong></div>
                  <div><span>Status</span><strong>{account.connection_status || "unknown"}</strong></div>
                  <div><span>Posts published</span><strong>{platformPosts.filter((post) => post.status === "published").length}</strong></div>
                </div>
                <div className="admin-inline-alert"><Shield size={16} /><span>Engagement sync will appear once the platform API is integrated.</span></div>
              </article>
            );
          }) : <div className="admin-panel admin-empty-state">No connected platforms.</div>}
        </div>
      ) : null}

      {activeTab === "posts" ? <div className="admin-panel"><AdminModerationWorkspace scopedUserId={userId} embedded compact showUserColumn={false} /></div> : null}
      {activeTab === "calendar" ? <AdminUserCalendar adminAccess={adminAccess} userId={userId} onViewModeration={(post) => navigate(`/app/admin/moderation?post=${post.id}`)} /> : null}

      {activeTab === "activity" ? (
        <div className="admin-panel">
          <div className="admin-filterbar">
            <select className="admin-select" value={activityFilters.eventCategory} onChange={(event) => setActivityFilters((current) => ({ ...current, eventCategory: event.target.value }))}>
              <option value="all">All</option>
              <option value="authentication">Auth</option>
              <option value="ai_generation">Generation</option>
              <option value="content_pipeline">Post</option>
              <option value="platform_sync">Account</option>
              <option value="security">Security</option>
              <option value="admin_action">Admin</option>
            </select>
            <input type="date" className="admin-input" value={activityFilters.dateFrom} onChange={(event) => setActivityFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
            <input type="date" className="admin-input" value={activityFilters.dateTo} onChange={(event) => setActivityFilters((current) => ({ ...current, dateTo: event.target.value }))} />
          </div>
          <div className="admin-list-stack">
            {activityLoading ? <div className="admin-page-loading">Loading activity log...</div> : activityEntries.length ? activityEntries.map((event) => (
              <article key={event.id} className="admin-activity-entry">
                <div className="admin-activity-entry-top">
                  <span className={`admin-activity-tag admin-activity-tag-${event.tag.tone}`}>{event.tag.label}</span>
                  <div className="admin-header-actions">
                    <span>{formatShortDateTime(event.created_at)}</span>
                    <AdminRiskBadge level={event.risk_level} />
                  </div>
                </div>
                <strong>{event.summary || event.event_type}</strong>
                {(event.metadata || event.previous_value || event.new_value) ? <pre className="admin-activity-metadata">{JSON.stringify({ ...(event.metadata ? { metadata: event.metadata } : {}), ...(event.previous_value ? { previous_value: event.previous_value } : {}), ...(event.new_value ? { new_value: event.new_value } : {}) }, null, 2)}</pre> : null}
              </article>
            )) : <div className="admin-empty-inline">No activity recorded yet.</div>}
          </div>
        </div>
      ) : null}

      {activeTab === "complaints" ? (
        <div className="admin-section-grid admin-section-grid-wide">
          <div className="admin-panel">
            <h3>Complaint Queue</h3>
            <div className="admin-list-stack">
              {detail.complaints.length ? detail.complaints.map((complaint) => (
                <div key={complaint.id} className="admin-list-item">
                  <div><strong>{complaint.subject}</strong><span>{complaint.complaint_type} | {complaint.priority} | {complaint.status}</span></div>
                  <button type="button" className="admin-inline-button" onClick={() => handleResolveComplaint(complaint.id)}>Resolve</button>
                </div>
              )) : <div className="admin-empty-inline">No complaints linked to this user.</div>}
            </div>
          </div>
          <div className="admin-panel">
            <h3>Internal Comment</h3>
            <textarea className="admin-textarea" rows="6" placeholder="Add an internal note to the newest complaint." value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} />
            <div className="admin-header-actions"><button type="button" className="admin-primary-button" onClick={handleAddComplaintComment}>Add comment</button></div>
          </div>
        </div>
      ) : null}

      {activeTab === "analytics" ? (
        <div className="admin-card-grid">
          <div className="admin-panel">
            <h3>Internal performance</h3>
            <div className="admin-metric-grid">
              <div><span>Generation volume</span><strong>{analytics.totalGenerations}</strong></div>
              <div><span>Post throughput</span><strong>{analytics.totalPosts}</strong></div>
              <div><span>Avg quality score</span><strong>{analytics.avgQualityScore ?? "-"}</strong></div>
              <div><span>Upcoming posts</span><strong>{analytics.scheduledPosts}</strong></div>
            </div>
          </div>
          <div className="admin-panel">
            <h3>Recent Quality</h3>
            <div className="admin-list-stack">
              {detail.qualityReviews.length ? detail.qualityReviews.slice(0, 5).map((review) => (
                <div key={review.id} className="admin-list-item"><strong>{formatShortDate(review.created_at)}</strong><QualityScoreBadge score={review.overall_score} size="sm" /></div>
              )) : <div className="admin-empty-inline">No quality reviews yet.</div>}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "security" ? (
        <div className="admin-user-overview">
          <div className="admin-section-grid admin-section-grid-wide">
            <div className="admin-panel">
              <h3><KeyRound size={16} /> Safe Actions</h3>
              <div className="admin-action-list admin-action-list-compact">
                <button type="button" className="admin-secondary-button" onClick={handleResetPassword} disabled={passwordResetState.status === "loading"}>{passwordResetState.status === "loading" ? "Sending..." : "Send password reset"}</button>
                <button type="button" className="admin-secondary-button" onClick={() => setNotifyOpen(true)}>Send notification to user</button>
                <button type="button" className="admin-secondary-button" onClick={() => document.getElementById("admin-internal-notes")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Add internal note</button>
              </div>
              {passwordResetState.status === "sent" ? <div className="admin-action-feedback success">Reset email sent to {profile.email} at {formatShortDateTime(passwordResetState.sentAt)}</div> : null}
              {passwordResetState.status === "error" ? <div className="admin-action-feedback error">Failed to send the reset email. Try again.</div> : null}
              {notificationFeedback.status === "sent" ? <div className="admin-action-feedback success">Notification sent via {notificationFeedback.channel} at {formatShortDateTime(notificationFeedback.sentAt)}</div> : null}
            </div>
            <div className="admin-panel">
              <h3><Shield size={16} /> Controlled Actions</h3>
              <p className="admin-page-subtext">Controlled actions require a reason and an in-app confirmation flow.</p>
              <div className="admin-action-list admin-action-list-compact">
                <button type="button" className="admin-warning-button" onClick={handleSuspend}>{profile.activity_status === "suspended" ? "Lift restriction" : "Suspend user"}</button>
                <button type="button" className="admin-secondary-button" disabled>Revoke publishing access</button>
              </div>
            </div>
            <div className="admin-panel admin-panel-danger">
              <h3><AlertTriangle size={16} /> High-Risk Actions</h3>
              <div className="admin-inline-alert admin-inline-alert-warning"><AlertTriangle size={16} /><span>Deletion requires a typed confirmation and is logged as a high-risk admin action.</span></div>
              <div className="admin-form-grid">
                <label>Reason code<select className="admin-select" value={securityForm.deletionReason} onChange={(event) => setSecurityForm((current) => ({ ...current, deletionReason: event.target.value }))}><option value="other">Other</option><option value="policy_violation">Policy violation</option><option value="user_request">User request</option><option value="duplicate">Duplicate</option></select></label>
                <label className="admin-form-grid-span">Note<textarea className="admin-textarea" rows="4" value={securityForm.deletionNote} onChange={(event) => setSecurityForm((current) => ({ ...current, deletionNote: event.target.value }))} /></label>
                <label className="admin-form-grid-span">Type confirmation<input type="text" className="admin-input" placeholder={`DELETE ${displayName}`} value={securityForm.deletionConfirm} onChange={(event) => setSecurityForm((current) => ({ ...current, deletionConfirm: event.target.value }))} /></label>
              </div>
              <button type="button" className="admin-danger-button" onClick={handleDeletionRequest}>Request Account Deletion</button>
            </div>
          </div>
          <div id="admin-internal-notes">
            <AdminNotesPanel
              notes={notes}
              busy={notesBusy}
              onAdd={(body) => upsertNote(async () => { const created = await addAdminNote(adminAccess, profile, body); setNotes((current) => [created, ...current]); toast.success("Internal note saved."); return created; })}
              onUpdate={(noteId, body) => upsertNote(async () => { const updated = await updateAdminNote(adminAccess, noteId, profile, body); setNotes((current) => current.map((note) => note.id === noteId ? updated : note)); toast.success("Internal note updated."); return updated; })}
              onDelete={async (note) => {
                setNotesBusy(true);
                try {
                  await deleteAdminNote(adminAccess, note, profile);
                  setNotes((current) => current.filter((entry) => entry.id !== note.id));
                  toast.success("Internal note deleted.");
                } catch (error) {
                  console.error("Failed to delete note:", error);
                  toast.error(error.message || "Failed to delete the note.");
                } finally {
                  setNotesBusy(false);
                }
              }}
            />
          </div>
        </div>
      ) : null}

      <AdminNotifyUserModal open={notifyOpen} busy={notifyBusy} user={profile} onClose={() => !notifyBusy && setNotifyOpen(false)} onSend={handleSendNotification} />
      <SuspendUserModal open={suspendModalOpen} targets={[profile]} busy={suspendBusy} onClose={() => !suspendBusy && setSuspendModalOpen(false)} onConfirm={handleConfirmSuspend} />
    </section>
  );
}
