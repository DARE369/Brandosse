import React, { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  Download,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  X,
} from "lucide-react";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import PlatformIcon from "../../components/Shared/PlatformIcon";
import { supabase } from "../../services/supabaseClient";
import {
  getConnectedAccountDisplayName,
  getConnectedAccountSemanticStatus,
  normalizeConnectedAccountRow,
} from "../../services/platforms/platformUtils";
import { fetchOrganizationMembers } from "../../org/services/orgService";
import GrantAccessModal from "../../org/components/GrantAccessModal";
import { formatCompactNumber, formatRelativeTime, formatShortDateTime, formatPercent } from "../utils/formatDate";

function getHealthDescription(account) {
  const score = Number(account?.health_score || 0);
  if (score >= 80) return "Healthy — performing normally.";
  if (score >= 50) return "Degraded — some publish attempts have failed.";
  if (score >= 20) return "Unstable — frequent failures detected.";
  return "Critical — immediate reconnection recommended.";
}

function getStatusTone(status) {
  const semantic = getConnectedAccountSemanticStatus(status);
  if (semantic === "connected") return "success";
  if (semantic === "reconnecting") return "warning";
  if (semantic === "expired" || semantic === "error") return "danger";
  return "neutral";
}

function getToneForEvent(event) {
  const severity = String(event?.severity || "").trim().toLowerCase();
  if (severity === "critical" || severity === "error") return "danger";
  if (severity === "warning") return "warning";
  return "info";
}

function formatLabel(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildCsv(rows) {
  const header = ["timestamp", "event_type", "severity", "message", "simulated"];
  const lines = rows.map((row) => [
    row.created_at || "",
    row.event_type || "",
    row.severity || "",
    (row.message || "").replace(/"/g, '""'),
    row.is_simulated_failure ? "yes" : "no",
  ]);

  return [header, ...lines]
    .map((line) => line.map((value) => `"${String(value)}"`).join(","))
    .join("\n");
}

export default function AccountMaintenancePanel({
  open = false,
  account = null,
  alerts = [],
  profileMap = new Map(),
  organizationMap = new Map(),
  onClose,
  onRunAction,
  onRefresh,
}) {
  const { navigate } = useAppNavigation();
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [actionProfiles, setActionProfiles] = useState(new Map());
  const [busyAction, setBusyAction] = useState("");
  const [eventFilters, setEventFilters] = useState({
    severity: "all",
    eventType: "all",
  });
  const [supportNote, setSupportNote] = useState("");
  const [grantAccessOpen, setGrantAccessOpen] = useState(false);
  const [members, setMembers] = useState([]);

  const loadDetail = useCallback(async () => {
    if (!account?.id) {
      setDetail(null);
      setMembers([]);
      return;
    }

    setLoading(true);
    try {
      const [accountResult, eventsResult, actionsResult, membersResult] = await Promise.all([
        supabase
          .from("connected_accounts")
          .select("id, user_id, organization_id, scope, platform, display_name, account_name, username, profile_type, profile_picture_url, avatar_url, connection_status, health_score, consecutive_failure_count, last_failure_at, last_failure_reason, last_successful_publish_at, total_posts_published, total_posts_scheduled, is_mock, token_expires_at, last_token_refresh, last_token_refresh_at, granted_member_ids, follower_count, account_category, created_at")
          .eq("id", account.id)
          .maybeSingle(),
        supabase
          .from("connection_events")
          .select("*")
          .eq("connected_account_id", account.id)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("admin_account_actions")
          .select("*")
          .eq("target_connected_account_id", account.id)
          .order("created_at", { ascending: false })
          .limit(50),
        account.organization_id
          ? fetchOrganizationMembers(account.organization_id)
          : Promise.resolve([]),
      ]);

      if (accountResult.error) throw accountResult.error;
      if (eventsResult.error) throw eventsResult.error;
      if (actionsResult.error) throw actionsResult.error;

      const adminIds = [...new Set((actionsResult.data || []).map((entry) => entry.admin_user_id).filter(Boolean))];
      let nextActionProfiles = new Map();

      if (adminIds.length) {
        const { data: adminProfiles, error: adminProfilesError } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", adminIds);

        if (adminProfilesError) throw adminProfilesError;
        nextActionProfiles = new Map((adminProfiles || []).map((profile) => [profile.id, profile]));
      }

      setActionProfiles(nextActionProfiles);
      setMembers(Array.isArray(membersResult) ? membersResult : []);
      setDetail({
        account: normalizeConnectedAccountRow(accountResult.data || account),
        events: eventsResult.data || [],
        adminActions: actionsResult.data || [],
      });
    } catch (error) {
      console.error("Failed to load account maintenance detail:", error);
      toast.error(error?.message || "Failed to load account maintenance detail.");
      setDetail({
        account,
        events: [],
        adminActions: [],
      });
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    if (!open) return;
    setActiveTab("overview");
    setEventFilters({ severity: "all", eventType: "all" });
    void loadDetail();
  }, [loadDetail, open]);

  const effectiveAccount = detail?.account || account;
  const ownerProfile = effectiveAccount?.user_id ? profileMap.get(effectiveAccount.user_id) || null : null;
  const organization = effectiveAccount?.organization_id
    ? organizationMap.get(effectiveAccount.organization_id) || null
    : null;

  const publishEvents = useMemo(() => (
    (detail?.events || []).filter((event) => ["publish_success", "publish_failure"].includes(event.event_type)).slice(0, 10)
  ), [detail?.events]);

  const publishFailureRate = useMemo(() => {
    if (!publishEvents.length) return null;
    const failureCount = publishEvents.filter((event) => event.event_type === "publish_failure").length;
    return failureCount / publishEvents.length;
  }, [publishEvents]);

  const filteredEvents = useMemo(() => (
    (detail?.events || []).filter((event) => {
      if (eventFilters.severity !== "all" && event.severity !== eventFilters.severity) return false;
      if (eventFilters.eventType !== "all" && event.event_type !== eventFilters.eventType) return false;
      return true;
    })
  ), [detail?.events, eventFilters.eventType, eventFilters.severity]);

  const eventTypeOptions = useMemo(() => {
    const types = [...new Set((detail?.events || []).map((event) => event.event_type).filter(Boolean))];
    return types.sort();
  }, [detail?.events]);

  const executeAction = async (action, body = {}, successMessage = "") => {
    if (!effectiveAccount?.id || typeof onRunAction !== "function") return null;

    setBusyAction(action);
    try {
      const result = await onRunAction(
        {
          action,
          connected_account_id: effectiveAccount.id,
          ...body,
        },
        successMessage ? { successMessage } : {},
      );

      if (action === "support_note") {
        setSupportNote("");
      }

      await loadDetail();
      await onRefresh?.();
      return result;
    } finally {
      setBusyAction("");
    }
  };

  const handleForceDisconnect = async () => {
    const reason = window.prompt("Reason for force disconnect", "Disconnected from the super admin accounts console.");
    if (reason === null) return;
    await executeAction(
      "force_disconnect",
      { reason: reason.trim() || "Disconnected from the super admin accounts console." },
      "Account disconnected.",
    );
  };

  const handleDownloadCsv = () => {
    const csv = buildCsv(filteredEvents);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${effectiveAccount?.platform || "account"}-${effectiveAccount?.id || "events"}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  if (!open || !effectiveAccount) return null;

  return (
    <>
      <button type="button" className="admin-account-drawer-backdrop" onClick={onClose} aria-label="Close account maintenance panel" />
      <aside className="admin-account-drawer" role="dialog" aria-modal="true" aria-label="Connected account maintenance panel">
        <header className="admin-account-drawer-header">
          <div className="admin-account-drawer-title">
            <PlatformIcon platform={effectiveAccount.platform} size="md" />
            <div className="admin-metric-stack">
              <strong>{getConnectedAccountDisplayName(effectiveAccount)}</strong>
              <span>
                {effectiveAccount.username ? `@${effectiveAccount.username}` : effectiveAccount.platform}
                {organization?.name ? ` · ${organization.name}` : ""}
              </span>
            </div>
          </div>

          <div className="admin-row-actions">
            <span className={`admin-pill admin-pill-${getStatusTone(effectiveAccount.connection_status)}`.trim()}>
              <span className="admin-pill-dot" />
              {formatLabel(getConnectedAccountSemanticStatus(effectiveAccount.connection_status))}
            </span>
            <button type="button" className="admin-modal-close" onClick={onClose} aria-label="Close maintenance panel">
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="admin-account-drawer-scroll">
          <div className="admin-account-actions-row">
            <button
              type="button"
              className="admin-secondary-button"
              disabled={busyAction === "force_reconnect"}
              onClick={() => void executeAction("force_reconnect", { reason: "Triggered from the maintenance panel." }, "Account reconnected.")}
            >
              {busyAction === "force_reconnect" ? "Working..." : "Force Reconnect"}
            </button>
            <button
              type="button"
              className="admin-secondary-button"
              disabled={busyAction === "clear_failures"}
              onClick={() => void executeAction("clear_failures", { reason: "Cleared from the maintenance panel." }, "Failure counters cleared.")}
            >
              {busyAction === "clear_failures" ? "Working..." : "Clear Failures"}
            </button>
            <button
              type="button"
              className="admin-secondary-button"
              disabled={busyAction === "reset_health"}
              onClick={() => void executeAction("reset_health", { reason: "Reset from the maintenance panel." }, "Health score reset.")}
            >
              {busyAction === "reset_health" ? "Working..." : "Reset Health"}
            </button>
            <button
              type="button"
              className="admin-danger-button"
              disabled={busyAction === "force_disconnect"}
              onClick={() => void handleForceDisconnect()}
            >
              {busyAction === "force_disconnect" ? "Working..." : "Force Disconnect"}
            </button>
          </div>

          <div className="admin-tabs">
            {[
              ["overview", "Overview"],
              ["events", "Event Log"],
              ["actions", "Admin Actions"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`admin-tab${activeTab === value ? " active" : ""}`}
                onClick={() => setActiveTab(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? <div className="admin-page-loading">Loading account detail...</div> : null}

          {!loading && activeTab === "overview" ? (
            <div className="admin-account-panel-grid">
              <section className="admin-panel admin-account-score-panel">
                <div className="admin-account-score-value">{Number(effectiveAccount.health_score || 0)}</div>
                <strong>Health score</strong>
                <span>{getHealthDescription(effectiveAccount)}</span>
              </section>

              <section className="admin-panel">
                <h3>Publishing stats</h3>
                <div className="admin-metric-grid">
                  <div>
                    <span>Total Published</span>
                    <strong>{formatCompactNumber(effectiveAccount.total_posts_published || 0)}</strong>
                  </div>
                  <div>
                    <span>Total Scheduled</span>
                    <strong>{formatCompactNumber(effectiveAccount.total_posts_scheduled || 0)}</strong>
                  </div>
                  <div>
                    <span>Recent Failure Rate</span>
                    <strong>{publishFailureRate === null ? "—" : formatPercent(publishFailureRate, { maximumFractionDigits: 0 })}</strong>
                  </div>
                  <div>
                    <span>Last Success</span>
                    <strong>{formatRelativeTime(effectiveAccount.last_successful_publish_at)}</strong>
                  </div>
                </div>
              </section>

              <section className="admin-panel">
                <h3>Account metadata</h3>
                <div className="admin-key-value-list">
                  <div>
                    <span>Created</span>
                    <strong>{formatShortDateTime(effectiveAccount.created_at)}</strong>
                  </div>
                  <div>
                    <span>Last token refresh</span>
                    <strong>{formatShortDateTime(effectiveAccount.last_token_refresh_at || effectiveAccount.last_token_refresh)}</strong>
                  </div>
                  <div>
                    <span>Token expires</span>
                    <strong>{formatShortDateTime(effectiveAccount.token_expires_at)}</strong>
                  </div>
                  <div>
                    <span>Mock provider</span>
                    <strong>{effectiveAccount.is_mock ? "Yes" : "No"}</strong>
                  </div>
                  <div>
                    <span>Profile type</span>
                    <strong>{effectiveAccount.profile_type || "—"}</strong>
                  </div>
                  <div>
                    <span>Followers</span>
                    <strong>{formatCompactNumber(effectiveAccount.follower_count || 0)}</strong>
                  </div>
                </div>
              </section>

              <section className="admin-panel">
                <h3>Owner and scope</h3>
                <div className="admin-list-stack">
                  <div className="admin-list-item">
                    <div className="admin-metric-stack">
                      <strong>{ownerProfile?.full_name || ownerProfile?.email || effectiveAccount.user_id}</strong>
                      <span>{ownerProfile?.email || "Account owner"}</span>
                    </div>
                    {effectiveAccount.user_id ? (
                      <button
                        type="button"
                        className="admin-inline-button"
                        onClick={() => navigate(`/app/admin/users/${effectiveAccount.user_id}`)}
                      >
                        View user
                      </button>
                    ) : null}
                  </div>
                  {organization ? (
                    <div className="admin-list-item">
                      <div className="admin-metric-stack">
                        <strong>{organization.name}</strong>
                        <span>Organization scope</span>
                      </div>
                      <button
                        type="button"
                        className="admin-inline-button"
                        onClick={() => navigate(`/app/admin/organizations/${organization.id}`)}
                      >
                        View org
                      </button>
                    </div>
                  ) : null}
                  {effectiveAccount.scope === "organization" ? (
                    <div className="admin-list-item">
                      <div className="admin-metric-stack">
                        <strong>Member access</strong>
                        <span>
                          {Array.isArray(effectiveAccount.granted_member_ids) && effectiveAccount.granted_member_ids.length > 0
                            ? `${effectiveAccount.granted_member_ids.length} granted member${effectiveAccount.granted_member_ids.length === 1 ? "" : "s"}`
                            : "All publish-enabled members"}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="admin-inline-button"
                        onClick={() => setGrantAccessOpen(true)}
                      >
                        Manage access
                      </button>
                    </div>
                  ) : null}
                </div>
              </section>

              {alerts.length ? (
                <section className="admin-panel admin-panel-danger">
                  <div className="admin-panel-header">
                    <div>
                      <span className="admin-section-kicker">Unresolved Alerts</span>
                      <h3>{alerts.length} active alert{alerts.length === 1 ? "" : "s"}</h3>
                    </div>
                  </div>
                  <div className="admin-list-stack">
                    {alerts.map((alert) => (
                      <article key={alert.id} className="admin-note-card">
                        <div className="admin-note-card-top">
                          <div>
                            <strong>{alert.message}</strong>
                            <span>{formatShortDateTime(alert.created_at)}</span>
                          </div>
                        <span className={`admin-pill ${alert.severity === "critical" ? "admin-pill-danger" : "admin-pill-warning"}`}>
                          <AlertTriangle size={12} />
                          {formatLabel(alert.severity)}
                        </span>
                        </div>
                        <div className="admin-header-actions">
                          <button
                            type="button"
                            className="admin-inline-button"
                            onClick={() => setActiveTab("events")}
                          >
                            Inspect events
                          </button>
                          <button
                            type="button"
                            className="admin-secondary-button"
                            disabled={busyAction === "resolve_alert"}
                            onClick={() => void executeAction(
                              "resolve_alert",
                              {
                                alert_id: alert.id,
                                reason: "Resolved from the maintenance panel.",
                              },
                              "Alert resolved.",
                            )}
                          >
                            Resolve alert
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}

          {!loading && activeTab === "events" ? (
            <section className="admin-panel">
              <div className="admin-panel-header">
                <div>
                  <span className="admin-section-kicker">Event Log</span>
                  <h3>{filteredEvents.length} event{filteredEvents.length === 1 ? "" : "s"} in view</h3>
                </div>
                <button type="button" className="admin-inline-button" onClick={handleDownloadCsv}>
                  <Download size={14} />
                  Download CSV
                </button>
              </div>

              <div className="admin-filterbar admin-filterbar-inline">
                <select
                  className="admin-select"
                  value={eventFilters.severity}
                  onChange={(event) => setEventFilters((current) => ({ ...current, severity: event.target.value }))}
                >
                  <option value="all">All severities</option>
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="error">Error</option>
                  <option value="critical">Critical</option>
                </select>
                <select
                  className="admin-select"
                  value={eventFilters.eventType}
                  onChange={(event) => setEventFilters((current) => ({ ...current, eventType: event.target.value }))}
                >
                  <option value="all">All event types</option>
                  {eventTypeOptions.map((eventType) => (
                    <option key={eventType} value={eventType}>
                      {formatLabel(eventType)}
                    </option>
                  ))}
                </select>
                <button type="button" className="admin-secondary-button" onClick={() => void loadDetail()}>
                  <RefreshCw size={14} />
                  Refresh
                </button>
              </div>

              <div className="admin-list-stack">
                {filteredEvents.length ? filteredEvents.map((event) => (
                  <article key={event.id} className="admin-activity-entry">
                    <div className="admin-activity-entry-top">
                      <span className={`admin-activity-tag admin-activity-tag-${getToneForEvent(event)}`.trim()}>
                        {formatLabel(event.event_type)}
                      </span>
                      <div className="admin-header-actions">
                        <span>{formatShortDateTime(event.created_at)}</span>
                        <span className={`admin-pill admin-pill-${getToneForEvent(event)}`.trim()}>
                          {formatLabel(event.severity)}
                        </span>
                        {event.is_simulated_failure ? (
                          <span className="admin-pill admin-pill-warning">Simulated</span>
                        ) : null}
                      </div>
                    </div>
                    <strong>{event.message || "No additional message."}</strong>
                    {event.metadata ? (
                      <pre className="admin-activity-metadata">{JSON.stringify(event.metadata, null, 2)}</pre>
                    ) : null}
                  </article>
                )) : (
                  <div className="admin-empty-inline">No connection events matched the current filters.</div>
                )}
              </div>
            </section>
          ) : null}

          {!loading && activeTab === "actions" ? (
            <div className="admin-account-panel-grid">
              <section className="admin-panel">
                <div className="admin-panel-header">
                  <div>
                    <span className="admin-section-kicker">Admin Actions</span>
                    <h3>Maintenance history</h3>
                  </div>
                </div>

                <div className="admin-list-stack">
                  {detail?.adminActions?.length ? detail.adminActions.map((entry) => {
                    const adminProfile = actionProfiles.get(entry.admin_user_id) || null;
                    return (
                      <article key={entry.id} className="admin-note-card">
                        <div className="admin-note-card-top">
                          <div>
                            <strong>{formatLabel(entry.action)}</strong>
                            <span>
                              {adminProfile?.full_name || adminProfile?.email || entry.admin_user_id} · {formatShortDateTime(entry.created_at)}
                            </span>
                          </div>
                          <span className="admin-pill admin-pill-neutral">{formatLabel(entry.action)}</span>
                        </div>
                        {entry.notes ? <p className="admin-longform">{entry.notes}</p> : null}
                        {entry.metadata ? (
                          <pre className="admin-activity-metadata">{JSON.stringify(entry.metadata, null, 2)}</pre>
                        ) : null}
                      </article>
                    );
                  }) : (
                    <div className="admin-empty-inline">No admin actions have been recorded for this account yet.</div>
                  )}
                </div>
              </section>

              <section className="admin-panel">
                <div className="admin-panel-header">
                  <div>
                    <span className="admin-section-kicker">Support Note</span>
                    <h3>Log a maintenance note</h3>
                  </div>
                </div>
                <textarea
                  className="admin-textarea"
                  rows={6}
                  placeholder="Document the intervention, handoff context, or investigation summary."
                  value={supportNote}
                  onChange={(event) => setSupportNote(event.target.value)}
                />
                <div className="admin-header-actions">
                  <button
                    type="button"
                    className="admin-primary-button"
                    disabled={!supportNote.trim() || busyAction === "support_note"}
                    onClick={() => void executeAction(
                      "support_note",
                      { reason: supportNote.trim() },
                      "Support note saved.",
                    )}
                  >
                    {busyAction === "support_note" ? "Saving..." : "Add Support Note"}
                  </button>
                </div>

                <div className="admin-inline-alert">
                  <ShieldCheck size={16} />
                  <span>
                    Use maintenance notes for operator context. Force reconnect and disconnect actions also generate user-facing notifications.
                  </span>
                </div>

                {effectiveAccount.scope === "organization" ? (
                  <div className="admin-inline-alert admin-inline-alert-warning">
                    <ShieldOff size={16} />
                    <span>
                      Shared organization accounts can also be limited to selected members from this panel.
                    </span>
                    <button type="button" className="admin-inline-button" onClick={() => setGrantAccessOpen(true)}>
                      Manage access
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}
        </div>
      </aside>

      <GrantAccessModal
        open={grantAccessOpen}
        account={effectiveAccount}
        members={members}
        onClose={() => setGrantAccessOpen(false)}
        onSaveAccess={({ grantAll, grantedMemberIds }) => executeAction(
          "set_member_access",
          {
            grant_all: grantAll,
            granted_member_ids: grantedMemberIds,
            reason: "Member access updated from the admin accounts console.",
          },
          "Member access updated.",
        )}
        onSaved={async () => {
          setGrantAccessOpen(false);
          await loadDetail();
          await onRefresh?.();
        }}
      />
    </>
  );
}
