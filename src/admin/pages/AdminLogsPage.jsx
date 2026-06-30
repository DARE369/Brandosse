"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useAdminLayoutContext } from "../AdminLayoutContext";
import { useMutableSearchParams } from "../../next/useMutableSearchParams";
import AdminRiskBadge from "../components/AdminRiskBadge";
import { formatShortDateTime } from "../utils/formatDate";
import { supabase } from "../../services/supabaseClient";
import PlatformIcon from "../../components/Shared/PlatformIcon";
function buildUserLabel(profile, fallbackId = "") {
  if (!profile) return fallbackId || "Unknown user";
  return profile.full_name || profile.email || profile.id || fallbackId || "Unknown user";
}

function buildAccountLabel(account, fallbackPlatform = "") {
  if (!account) {
    return {
      title: fallbackPlatform ? `${formatEventLabel(fallbackPlatform)} account` : "Connected account",
      subtitle: fallbackPlatform ? formatEventLabel(fallbackPlatform) : "Account unavailable",
    };
  }

  const title = account.display_name || account.account_name || account.username || "Connected account";
  const handle = account.username ? `@${account.username}` : "No username";
  const platform = formatEventLabel(account.platform || fallbackPlatform || "platform");

  return {
    title,
    subtitle: `${handle} | ${platform}`,
  };
}

function resolveDerivedUser(log, profileMap) {
  if (log.entity_type === "user" || log.entity_type === "profile") {
    return profileMap.get(log.entity_id) || profileMap.get(log.actor_id) || null;
  }
  if (log.actor_type === "user") {
    return profileMap.get(log.actor_id) || null;
  }
  return profileMap.get(log.actor_id) || null;
}

function formatEventLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "Unknown";
  return text
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getLogTone(level) {
  const normalized = String(level || "").trim().toLowerCase();
  if (normalized === "warning" || normalized === "medium" || normalized === "high") return "warning";
  if (normalized === "error" || normalized === "critical") return "error";
  return "info";
}

function getConnectionEventTone(eventType) {
  const normalized = String(eventType || "").trim().toLowerCase();
  if (
    normalized.includes("failure")
    || normalized.includes("error")
    || normalized.includes("disconnect")
    || normalized.includes("expired")
  ) {
    return "error";
  }
  if (normalized.includes("health_check_fail") || normalized.includes("warning")) {
    return "warning";
  }
  return "info";
}

const DOMAIN_PATTERNS = {
  content_generation: ["generation_failed", "generation_error", "generation_timeout"],
  post_publishing: ["publish_failed", "publish_error", "publish_timeout", "post_failed"],
  post_scheduling: ["schedule_failed", "schedule_write_error", "post_scheduled"],
  oauth_connection: ["oauth_failed", "oauth_error", "connection_failed"],
  profile_provisioning: ["profile_creation_failed", "signup_profile_error"],
  moderation_action: ["force_publish_failed", "force_schedule_failed", "moderation_error"],
  admin_auth: ["admin_login_failed", "admin_access_denied"],
  edge_function: ["edge_function_error", "edge_function_timeout"],
  realtime_subscription: ["realtime_error", "subscription_dropped"],
  file_upload: ["upload_failed", "storage_write_error"],
};

const AUDIT_CATEGORY_OPTIONS = [
  { value: "all", label: "All categories" },
  { value: "admin_action", label: "Admin Actions" },
  { value: "content_pipeline", label: "Content Pipeline" },
  { value: "authentication", label: "Authentication" },
  { value: "ai_generation", label: "AI Generations" },
  { value: "scheduling_publishing", label: "Publishing" },
  { value: "security", label: "Security" },
  { value: "platform_sync", label: "Platform Sync" },
];

const CONNECTION_EVENT_OPTIONS = [
  { value: "all", label: "All event types" },
  { value: "connected", label: "Connected" },
  { value: "reconnected", label: "Reconnected" },
  { value: "disconnected", label: "Disconnected" },
  { value: "publish_success", label: "Publish Success" },
  { value: "publish_failure", label: "Publish Failure" },
  { value: "token_expired", label: "Token Expired" },
  { value: "health_check_pass", label: "Health Check Pass" },
  { value: "health_check_fail", label: "Health Check Fail" },
  { value: "admin_force_reconnect", label: "Admin Force Reconnect" },
  { value: "admin_force_disconnect", label: "Admin Force Disconnect" },
];

const AUDIT_LEVEL_OPTIONS = [
  { value: "all", label: "All risk levels" },
  { value: "none", label: "None" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const CONNECTION_LEVEL_OPTIONS = [
  { value: "all", label: "All severities" },
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "error", label: "Error" },
  { value: "critical", label: "Critical" },
];

export default function AdminLogsPage() {
  const { navigate } = useAppNavigation();
  const { adminAccess } = useAdminLayoutContext();
  const [searchParams] = useMutableSearchParams();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [connectedAccounts, setConnectedAccounts] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [groupBy, setGroupBy] = useState("none");
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [filters, setFilters] = useState({
    source: searchParams.get("source") === "connection_events" ? "connection_events" : "audit_logs",
    eventCategory: "all",
    level: "all",
    userId: "all",
    search: "",
  });

  const sourceParam = searchParams.get("source");
  const scopedAccountId = searchParams.get("accountId");
  const domainFilter = searchParams.get("domain");
  const serverSearch = filters.source === "audit_logs" ? filters.search : "";

  useEffect(() => {
    if (sourceParam !== "audit_logs" && sourceParam !== "connection_events") return;
    setFilters((current) =>
      current.source === sourceParam
        ? current
        : {
            ...current,
            source: sourceParam,
            eventCategory: "all",
            level: "all",
          },
    );
  }, [sourceParam]);

  useEffect(() => {
    let mounted = true;

    async function loadAuditLogs() {
      let query = supabase
        .from("audit_logs")
        .select("id, actor_id, actor_type, actor_role, event_category, event_type, entity_type, entity_id, summary, metadata, risk_level, correlation_id, created_at")
        .order("created_at", { ascending: false })
        .limit(200);

      if (filters.eventCategory !== "all") query = query.eq("event_category", filters.eventCategory);
      if (filters.level !== "all") {
        query = filters.level === "none"
          ? query.is("risk_level", null)
          : query.eq("risk_level", filters.level);
      }
      if (filters.userId !== "all") query = query.or(`actor_id.eq.${filters.userId},entity_id.eq.${filters.userId}`);
      if (serverSearch.trim()) {
        const term = serverSearch.trim();
        query = query.or(`summary.ilike.%${term}%,event_type.ilike.%${term}%,entity_id.ilike.%${term}%`);
      }

      const [{ data, error }, profilesResult] = await Promise.all([
        query,
        supabase
          .from("profiles")
          .select("id, full_name, email, avatar_url")
          .order("full_name", { ascending: true })
          .limit(500),
      ]);

      if (error) throw error;

      return {
        rows: data || [],
        profiles: profilesResult.error ? [] : profilesResult.data || [],
        connectedAccounts: [],
        organizations: [],
      };
    }

    async function loadConnectionEvents() {
      let query = supabase
        .from("connection_events")
        .select("id, connected_account_id, user_id, organization_id, event_type, platform, severity, message, metadata, is_simulated_failure, created_at")
        .order("created_at", { ascending: false })
        .limit(200);

      if (filters.eventCategory !== "all") query = query.eq("event_type", filters.eventCategory);
      if (filters.level !== "all") query = query.eq("severity", filters.level);
      if (filters.userId !== "all") query = query.eq("user_id", filters.userId);
      if (scopedAccountId) query = query.eq("connected_account_id", scopedAccountId);

      const [{ data, error }, profilesResult] = await Promise.all([
        query,
        supabase
          .from("profiles")
          .select("id, full_name, email, avatar_url")
          .order("full_name", { ascending: true })
          .limit(500),
      ]);

      if (error) throw error;

      const rows = data || [];
      const accountIds = [...new Set(rows.map((row) => row.connected_account_id).filter(Boolean))];
      const organizationIds = [...new Set(rows.map((row) => row.organization_id).filter(Boolean))];

      const [accountsResult, organizationsResult] = await Promise.all([
        accountIds.length > 0
          ? supabase
              .from("connected_accounts")
              .select("id, user_id, organization_id, platform, display_name, account_name, username, connection_status")
              .in("id", accountIds)
          : Promise.resolve({ data: [], error: null }),
        organizationIds.length > 0
          ? supabase
              .from("organizations")
              .select("id, name")
              .in("id", organizationIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (accountsResult.error) throw accountsResult.error;
      if (organizationsResult.error) throw organizationsResult.error;

      return {
        rows,
        profiles: profilesResult.error ? [] : profilesResult.data || [],
        connectedAccounts: accountsResult.data || [],
        organizations: organizationsResult.data || [],
      };
    }

    async function loadLogs() {
      if (!adminAccess?.isSuperAdmin) return;

      setLoading(true);
      try {
        const next = filters.source === "connection_events"
          ? await loadConnectionEvents()
          : await loadAuditLogs();

        if (!mounted) return;
        setLogs(next.rows);
        setProfiles(next.profiles);
        setConnectedAccounts(next.connectedAccounts);
        setOrganizations(next.organizations);
      } catch (error) {
        if (!mounted) return;
        console.error(`Failed to load ${filters.source}:`, error);
        setLogs([]);
        setConnectedAccounts([]);
        setOrganizations([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadLogs();
    return () => {
      mounted = false;
    };
  }, [adminAccess?.isSuperAdmin, filters.eventCategory, filters.level, filters.source, filters.userId, scopedAccountId, serverSearch]);

  const profileMap = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const accountMap = useMemo(() => new Map(connectedAccounts.map((account) => [account.id, account])), [connectedAccounts]);
  const organizationMap = useMemo(() => new Map(organizations.map((organization) => [organization.id, organization])), [organizations]);

  const enrichedLogs = useMemo(() => {
    if (filters.source === "connection_events") {
      return logs.map((event) => ({
        ...event,
        account: accountMap.get(event.connected_account_id) || null,
        actorProfile: profileMap.get(event.user_id) || null,
        organization: organizationMap.get(event.organization_id) || null,
      }));
    }

    return logs.map((log) => ({
      ...log,
      actorProfile: profileMap.get(log.actor_id) || null,
      derivedUser: resolveDerivedUser(log, profileMap),
    }));
  }, [accountMap, filters.source, logs, organizationMap, profileMap]);

  const filteredLogs = useMemo(() => {
    if (filters.source === "audit_logs") {
      if (!domainFilter || !DOMAIN_PATTERNS[domainFilter]) return enrichedLogs;
      return enrichedLogs.filter((log) => DOMAIN_PATTERNS[domainFilter].includes(log.event_type));
    }

    const term = filters.search.trim().toLowerCase();
    if (!term) return enrichedLogs;

    return enrichedLogs.filter((event) => {
      const account = event.account || null;
      const actor = event.actorProfile || null;
      const org = event.organization || null;
      const searchText = [
        event.event_type,
        event.platform,
        event.message,
        account?.display_name,
        account?.account_name,
        account?.username,
        actor?.full_name,
        actor?.email,
        org?.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchText.includes(term);
    });
  }, [domainFilter, enrichedLogs, filters.search, filters.source]);

  const groupedLogs = useMemo(() => {
    if (groupBy === "none") return [];

    const groups = new Map();
    filteredLogs.forEach((row) => {
      let key = "unknown";
      let label = "Unknown";

      if (filters.source === "connection_events") {
        if (groupBy === "user") {
          key = row.user_id || "unknown";
          label = buildUserLabel(row.actorProfile, row.user_id || "Unknown user");
        } else {
          key = row.connected_account_id || "unknown";
          label = buildAccountLabel(row.account, row.platform).title;
        }
      } else {
        key = groupBy === "user"
          ? (row.derivedUser?.id || row.actor_id || "unknown")
          : `${row.entity_type || "unknown"}:${row.entity_id || "none"}`;
        label = groupBy === "user"
          ? buildUserLabel(row.derivedUser, "Unknown user")
          : `${row.entity_type || "entity"} ${row.entity_id || "unknown"}`;
      }

      if (!groups.has(key)) groups.set(key, { key, label, rows: [] });
      groups.get(key).rows.push(row);
    });

    return [...groups.values()];
  }, [filteredLogs, filters.source, groupBy]);

  if (!adminAccess?.isSuperAdmin) {
    return <div className="admin-panel admin-empty-state">System logs are available to super admins only.</div>;
  }

  const connectionMode = filters.source === "connection_events";
  const categoryOptions = connectionMode ? CONNECTION_EVENT_OPTIONS : AUDIT_CATEGORY_OPTIONS;
  const levelOptions = connectionMode ? CONNECTION_LEVEL_OPTIONS : AUDIT_LEVEL_OPTIONS;
  const groupEntityLabel = connectionMode ? "Group by account" : "Group by content";

  const renderAuditRow = (log) => (
    <tr key={log.id} className={log.risk_level ? `admin-risk-${log.risk_level}` : ""}>
      <td>{formatShortDateTime(log.created_at)}</td>
      <td>{buildUserLabel(log.actorProfile, log.actor_role || "system")}</td>
      <td>{buildUserLabel(log.derivedUser, log.entity_id || "-")}</td>
      <td>{log.event_type}</td>
      <td>{log.entity_type || "-"} {log.entity_id || ""}</td>
      <td>
        <div className="admin-metric-stack">
          <strong>{log.summary}</strong>
          <span>{log.correlation_id || "no correlation id"}</span>
        </div>
      </td>
      <td><AdminRiskBadge level={log.risk_level} /></td>
    </tr>
  );

  const renderConnectionEventRow = (event) => {
    const accountLabel = buildAccountLabel(event.account, event.platform);
    const actorLabel = buildUserLabel(event.actorProfile, event.user_id || "Unknown user");
    const organizationLabel = event.organization?.name ? `Org: ${event.organization.name}` : null;

    return (
      <tr key={event.id}>
        <td>{formatShortDateTime(event.created_at)}</td>
        <td>
          <div className="admin-identity-cell">
            <PlatformIcon platform={event.account?.platform || event.platform} size="sm" />
            <div className="admin-metric-stack">
              <strong>{accountLabel.title}</strong>
              <span>{accountLabel.subtitle}</span>
            </div>
          </div>
        </td>
        <td>
          <span className={`admin-log-badge ${getConnectionEventTone(event.event_type)}`.trim()}>
            {formatEventLabel(event.event_type)}
          </span>
        </td>
        <td>
          <span className={`admin-log-badge ${getLogTone(event.severity)}`.trim()}>
            {formatEventLabel(event.severity)}
          </span>
        </td>
        <td>
          <span className={`admin-log-badge ${event.is_simulated_failure ? "warning" : "info"}`.trim()}>
            {event.is_simulated_failure ? "Simulated" : "Standard"}
          </span>
        </td>
        <td>
          <div className="admin-log-message">
            <strong>{event.message || "No additional details."}</strong>
            <small>
              {actorLabel}
              {organizationLabel ? ` | ${organizationLabel}` : ""}
            </small>
          </div>
        </td>
      </tr>
    );
  };

  const renderTable = (rows) => (
    <table className="admin-data-table">
      <thead>
        {connectionMode ? (
          <tr>
            <th>Timestamp</th>
            <th>Account</th>
            <th>Event Type</th>
            <th>Severity</th>
            <th>Simulated</th>
            <th>Message</th>
          </tr>
        ) : (
          <tr>
            <th>Timestamp</th>
            <th>Actor</th>
            <th>User</th>
            <th>Event</th>
            <th>Entity</th>
            <th>Summary</th>
            <th>Risk</th>
          </tr>
        )}
      </thead>
      <tbody>
        {rows.map((row) => (connectionMode ? renderConnectionEventRow(row) : renderAuditRow(row)))}
      </tbody>
    </table>
  );

  return (
    <section className="admin-page">
      <header className="admin-page-header">
        <div>
          <span className="admin-section-kicker">Immutable Trail</span>
          <h2 className="admin-page-title">System Logs</h2>
          <p className="admin-page-subtext">
            {connectionMode
              ? "Connection lifecycle, publish failures, and simulated platform events across connected accounts."
              : "Filterable audit history across admin actions, user activity, publishing, and security flows."}
          </p>
        </div>
        <div className="admin-header-actions">
          <button
            type="button"
            className={`admin-secondary-button${groupBy === "none" ? " active" : ""}`}
            onClick={() => setGroupBy("none")}
          >
            Flat view
          </button>
          <button
            type="button"
            className={`admin-secondary-button${groupBy === "user" ? " active" : ""}`}
            onClick={() => setGroupBy("user")}
          >
            Group by user
          </button>
          <button
            type="button"
            className={`admin-secondary-button${groupBy === "entity" ? " active" : ""}`}
            onClick={() => setGroupBy("entity")}
          >
            {groupEntityLabel}
          </button>
        </div>
      </header>

      <div className="admin-filterbar">
        <select
          className="admin-select"
          value={filters.source}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              source: event.target.value,
              eventCategory: "all",
              level: "all",
            }))
          }
        >
          <option value="audit_logs">Audit Logs</option>
          <option value="connection_events">Connection Events</option>
        </select>
        <select
          className="admin-select"
          value={filters.eventCategory}
          onChange={(event) => setFilters((current) => ({ ...current, eventCategory: event.target.value }))}
        >
          {categoryOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select
          className="admin-select"
          value={filters.level}
          onChange={(event) => setFilters((current) => ({ ...current, level: event.target.value }))}
        >
          {levelOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select
          className="admin-select"
          value={filters.userId}
          onChange={(event) => setFilters((current) => ({ ...current, userId: event.target.value }))}
        >
          <option value="all">All users</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{buildUserLabel(profile)}</option>
          ))}
        </select>
        <input
          type="search"
          className="admin-input"
          placeholder={connectionMode ? "Search accounts, platforms, or messages" : "Search summary, event type, or entity"}
          value={filters.search}
          onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
        />
      </div>

      {connectionMode && scopedAccountId ? (
        <div className="admin-inline-alert">
          <div>
            <strong>Scoped account</strong>
            <p className="admin-page-subtext">{`Showing connection events for #${scopedAccountId} only.`}</p>
          </div>
          <button
            type="button"
            className="admin-inline-button"
            onClick={() => navigate("/app/admin/logs?source=connection_events")}
          >
            Clear scope
          </button>
        </div>
      ) : null}

      {!connectionMode && domainFilter ? (
        <div className="admin-inline-alert">
          <div>
            <strong>Scoped domain</strong>
            <p className="admin-page-subtext">{`Showing audit events for ${formatEventLabel(domainFilter)}.`}</p>
          </div>
          <button
            type="button"
            className="admin-inline-button"
            onClick={() => navigate("/app/admin/logs")}
          >
            Clear scope
          </button>
        </div>
      ) : null}

      <div className="admin-panel">
        <div className="admin-table-wrap">
          {groupBy === "none" ? (
            loading ? (
              <div className="admin-page-loading">Loading logs...</div>
            ) : filteredLogs.length ? (
              renderTable(filteredLogs)
            ) : (
              <div className="admin-empty-inline">
                {connectionMode
                  ? "No connection events matched the current filters."
                  : "No audit logs matched the current filters."}
              </div>
            )
          ) : (
            <div className="admin-list-stack">
              {loading ? (
                <div className="admin-page-loading">Loading logs...</div>
              ) : groupedLogs.length ? groupedLogs.map((group) => (
                <section key={group.key} className="admin-note-card">
                  <button
                    type="button"
                    className="admin-list-item admin-list-item-button"
                    onClick={() => setCollapsedGroups((current) => ({ ...current, [group.key]: !current[group.key] }))}
                  >
                    <div><strong>{group.label}</strong></div>
                    <span>{group.rows.length} events</span>
                  </button>
                  {!collapsedGroups[group.key] ? (
                    <div className="admin-table-wrap" style={{ marginTop: 12 }}>
                      {renderTable(group.rows)}
                    </div>
                  ) : null}
                </section>
              )) : (
                <div className="admin-empty-inline">
                  {connectionMode
                    ? "No connection events matched the current filters."
                    : "No audit logs matched the current filters."}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
