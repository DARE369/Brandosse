"use client";

import React, { useCallback, useMemo, useState, useEffect } from "react";
import toast from "react-hot-toast";
import { ArrowUpRight, ShieldAlert } from "lucide-react";
import { useAdminLayoutContext } from "../AdminLayoutContext";
import PlatformIcon from "../../components/Shared/PlatformIcon";
import { supabase } from "../../services/supabaseClient";
import {
  getConnectedAccountDisplayName,
  getConnectedAccountSemanticStatus,
  normalizeConnectedAccountRow,
} from "../../services/platforms/platformUtils";
import KpiCard from "../components/KpiCard/KpiCard";
import AccountMaintenancePanel from "../components/AccountMaintenancePanel";
import { formatRelativeTime, formatShortDateTime } from "../utils/formatDate";
function getStatusLabel(status) {
  const semantic = getConnectedAccountSemanticStatus(status);
  return String(semantic || "connected")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

function getStatusTone(status) {
  const semantic = getConnectedAccountSemanticStatus(status);
  if (semantic === "connected") return "success";
  if (semantic === "reconnecting") return "warning";
  if (semantic === "expired" || semantic === "error") return "danger";
  return "neutral";
}

function getHealthTier(account) {
  const failures = Number(account?.consecutive_failure_count || 0);
  const healthScore = Number(account?.health_score || 0);
  const semanticStatus = getConnectedAccountSemanticStatus(account?.connection_status);

  if (healthScore < 30 || failures >= 3 || ["error", "expired", "reconnecting"].includes(semanticStatus)) {
    return "critical";
  }
  if (healthScore <= 70 || failures > 0) {
    return "warning";
  }
  return "healthy";
}

function getHealthTone(account) {
  const tier = getHealthTier(account);
  if (tier === "critical") return "danger";
  if (tier === "warning") return "warning";
  return "success";
}

function getScopeLabel(scope) {
  return scope === "organization" ? "Org" : "Personal";
}

function getLastActivityLabel(account) {
  if (account?.last_failure_at) {
    return `Failure ${formatRelativeTime(account.last_failure_at)}`;
  }
  if (account?.last_successful_publish_at) {
    return `Success ${formatRelativeTime(account.last_successful_publish_at)}`;
  }
  if (account?.token_expires_at) {
    return `Token ${formatRelativeTime(account.token_expires_at)}`;
  }
  return "No activity yet";
}

function getOwnerLabel(account, profileMap, organizationMap) {
  const profile = profileMap.get(account.user_id) || null;
  const organization = organizationMap.get(account.organization_id) || null;

  return {
    primary: profile?.full_name || profile?.email || account.user_id || "Unknown owner",
    secondary: organization?.name
      ? `Org: ${organization.name}`
      : profile?.email || "Personal workspace",
  };
}

function matchesHealthFilter(account, value) {
  if (value === "all") return true;
  return getHealthTier(account) === value;
}

function matchesStatusFilter(account, value) {
  if (value === "all") return true;
  return getConnectedAccountSemanticStatus(account.connection_status) === value;
}

function matchesSearch(account, searchValue, profileMap, organizationMap) {
  const term = String(searchValue || "").trim().toLowerCase();
  if (!term) return true;

  const owner = profileMap.get(account.user_id);
  const organization = organizationMap.get(account.organization_id);
  const haystack = [
    account.display_name,
    account.account_name,
    account.username,
    account.platform,
    account.platform_display_name,
    owner?.full_name,
    owner?.email,
    organization?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(term);
}

export default function AdminAccountsPage() {
  const { adminAccess } = useAdminLayoutContext();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [filters, setFilters] = useState({
    status: "all",
    scope: "all",
    platform: "all",
    health: "all",
    search: "",
  });

  const loadConsole = useCallback(async () => {
    if (!adminAccess?.isSuperAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [overviewResult, accountsResult, alertsResult] = await Promise.all([
        supabase
          .from("platform_account_health_overview")
          .select("*")
          .maybeSingle(),
        supabase
          .from("connected_accounts_health_summary")
          .select("*")
          .order("consecutive_failure_count", { ascending: false })
          .order("health_score", { ascending: true })
          .limit(500),
        supabase
          .from("account_severity_alerts")
          .select("id, connected_account_id, user_id, organization_id, severity, alert_type, platform, account_display_name, failure_count, message, created_at")
          .eq("is_resolved", false)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

      if (overviewResult.error) throw overviewResult.error;
      if (accountsResult.error) throw accountsResult.error;
      if (alertsResult.error) throw alertsResult.error;

      const nextAccounts = (accountsResult.data || []).map(normalizeConnectedAccountRow).filter(Boolean);
      const nextAlerts = alertsResult.data || [];
      const profileIds = [...new Set([
        ...nextAccounts.map((account) => account.user_id),
        ...nextAlerts.map((alert) => alert.user_id),
      ].filter(Boolean))];
      const organizationIds = [...new Set([
        ...nextAccounts.map((account) => account.organization_id),
        ...nextAlerts.map((alert) => alert.organization_id),
      ].filter(Boolean))];

      const [profilesResult, organizationsResult] = await Promise.all([
        profileIds.length
          ? supabase
              .from("profiles")
              .select("id, full_name, email, avatar_url")
              .in("id", profileIds)
          : Promise.resolve({ data: [], error: null }),
        organizationIds.length
          ? supabase
              .from("organizations")
              .select("id, name")
              .in("id", organizationIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (profilesResult.error) throw profilesResult.error;
      if (organizationsResult.error) throw organizationsResult.error;

      setOverview(overviewResult.data || {
        total_connected: 0,
        healthy: 0,
        degraded: 0,
        critical: 0,
      });
      setAccounts(nextAccounts);
      setAlerts(nextAlerts);
      setProfiles(profilesResult.data || []);
      setOrganizations(organizationsResult.data || []);
    } catch (error) {
      console.error("Failed to load connected account console:", error);
      toast.error(error?.message || "Failed to load connected accounts.");
      setOverview(null);
      setAccounts([]);
      setAlerts([]);
      setProfiles([]);
      setOrganizations([]);
    } finally {
      setLoading(false);
    }
  }, [adminAccess?.isSuperAdmin]);

  useEffect(() => {
    void loadConsole();
  }, [loadConsole]);

  const profileMap = useMemo(
    () => new Map((profiles || []).map((profile) => [profile.id, profile])),
    [profiles],
  );
  const organizationMap = useMemo(
    () => new Map((organizations || []).map((organization) => [organization.id, organization])),
    [organizations],
  );
  const accountMap = useMemo(
    () => new Map((accounts || []).map((account) => [account.id, account])),
    [accounts],
  );
  const alertsByAccountId = useMemo(() => {
    const nextMap = new Map();
    alerts.forEach((alert) => {
      if (!alert.connected_account_id) return;
      if (!nextMap.has(alert.connected_account_id)) {
        nextMap.set(alert.connected_account_id, []);
      }
      nextMap.get(alert.connected_account_id).push(alert);
    });
    return nextMap;
  }, [alerts]);

  const platformOptions = useMemo(
    () => [...new Set(accounts.map((account) => account.platform).filter(Boolean))].sort(),
    [accounts],
  );

  const filteredAccounts = useMemo(() => (
    accounts.filter((account) => {
      if (filters.scope !== "all" && account.scope !== filters.scope) return false;
      if (filters.platform !== "all" && account.platform !== filters.platform) return false;
      if (!matchesHealthFilter(account, filters.health)) return false;
      if (!matchesStatusFilter(account, filters.status)) return false;
      return matchesSearch(account, filters.search, profileMap, organizationMap);
    })
  ), [accounts, filters.health, filters.platform, filters.scope, filters.search, filters.status, organizationMap, profileMap]);

  const selectedAccount = selectedAccountId ? accountMap.get(selectedAccountId) || null : null;

  const runAdminAction = useCallback(async (payload, options = {}) => {
    const key = `${payload.action}:${payload.alert_id || payload.connected_account_id || "global"}`;
    setBusyKey(key);
    try {
      const { data, error } = await supabase.functions.invoke("admin-account-action", {
        body: payload,
      });

      if (error) throw error;

      if (options.successMessage) {
        toast.success(options.successMessage);
      }

      await loadConsole();
      return data;
    } catch (error) {
      console.error("Failed to run admin account action:", error);
      toast.error(error?.message || "The admin account action failed.");
      throw error;
    } finally {
      setBusyKey("");
    }
  }, [loadConsole]);

  const handleInvestigateAlert = (alert) => {
    if (!alert?.connected_account_id) return;
    setSelectedAccountId(alert.connected_account_id);
    setPanelOpen(true);

    window.setTimeout(() => {
      document
        .getElementById(`admin-account-row-${alert.connected_account_id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 40);
  };

  if (!adminAccess?.isSuperAdmin) {
    return (
      <div className="admin-panel admin-empty-state">
        Connected account maintenance is restricted to super admins.
      </div>
    );
  }

  if (loading) {
    return <div className="admin-page-loading">Loading connected accounts...</div>;
  }

  return (
    <section className="admin-page admin-accounts-page">
      <header className="admin-page-header">
        <div>
          <span className="admin-section-kicker">Connected Accounts</span>
          <h2 className="admin-page-title">Platform account maintenance</h2>
          <p className="admin-page-subtext">
            Monitor account health, resolve recurring failures, and maintain mock publishing connectivity across the platform.
          </p>
        </div>
        <div className="admin-header-actions">
          <button type="button" className="admin-secondary-button" onClick={() => void loadConsole()}>
            Refresh
          </button>
        </div>
      </header>

      <div className="admin-kpi-grid admin-kpi-grid-compact">
        <KpiCard
          title="Total Connected"
          value={String(overview?.total_connected || 0)}
          trend="Non-disconnected accounts"
          trendUp
          color="var(--admin-accent)"
        />
        <KpiCard
          title="Healthy"
          value={String(overview?.healthy || 0)}
          trend="Connected and stable"
          trendUp
          color="var(--admin-success)"
        />
        <KpiCard
          title="Degraded"
          value={String(overview?.degraded || 0)}
          trend="Needs monitoring"
          trendUp={false}
          color="var(--admin-warning)"
        />
        <KpiCard
          title="Critical"
          value={String(overview?.critical || 0)}
          trend="Needs intervention"
          trendUp={false}
          color="var(--admin-danger)"
        />
      </div>

      {alerts.length ? (
        <section className="admin-panel admin-accounts-alert-panel">
          <div className="admin-panel-header">
            <div>
              <span className="admin-section-kicker">Unresolved Alerts</span>
              <h3>{alerts.length} account alert{alerts.length === 1 ? "" : "s"} require attention</h3>
            </div>
          </div>
          <div className="admin-list-stack">
            {alerts.map((alert) => {
              const actionKey = `resolve_alert:${alert.id}`;
              const account = accountMap.get(alert.connected_account_id) || null;
              const owner = alert.user_id ? profileMap.get(alert.user_id) : null;
              const organization = alert.organization_id ? organizationMap.get(alert.organization_id) : null;

              return (
                <article key={alert.id} className={`admin-accounts-alert-row severity-${alert.severity}`.trim()}>
                  <div className="admin-accounts-alert-main">
                    <span className={`admin-pill ${alert.severity === "critical" ? "admin-pill-danger" : "admin-pill-warning"}`}>
                      <ShieldAlert size={13} />
                      {String(alert.severity || "warning").toUpperCase()}
                    </span>
                    <div className="admin-metric-stack">
                      <strong>{alert.message}</strong>
                      <span>
                        {account ? getConnectedAccountDisplayName(account) : alert.account_display_name || "Connected account"} ·{" "}
                        {owner?.full_name || owner?.email || "Unknown owner"}
                        {organization?.name ? ` · ${organization.name}` : ""}
                        {` · ${formatShortDateTime(alert.created_at)}`}
                      </span>
                    </div>
                  </div>
                  <div className="admin-row-actions">
                    <button
                      type="button"
                      className="admin-inline-button"
                      onClick={() => handleInvestigateAlert(alert)}
                    >
                      Investigate
                      <ArrowUpRight size={14} />
                    </button>
                    <button
                      type="button"
                      className="admin-secondary-button"
                      disabled={busyKey === actionKey}
                      onClick={() => void runAdminAction(
                        {
                          action: "resolve_alert",
                          connected_account_id: alert.connected_account_id,
                          alert_id: alert.id,
                          reason: "Resolved from the connected accounts console.",
                        },
                        { successMessage: "Alert resolved." },
                      )}
                    >
                      {busyKey === actionKey ? "Resolving..." : "Resolve"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="admin-filterbar">
        <select
          className="admin-select"
          value={filters.status}
          onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
        >
          <option value="all">All statuses</option>
          <option value="connected">Connected</option>
          <option value="expired">Expired</option>
          <option value="error">Error</option>
          <option value="reconnecting">Reconnecting</option>
        </select>
        <select
          className="admin-select"
          value={filters.scope}
          onChange={(event) => setFilters((current) => ({ ...current, scope: event.target.value }))}
        >
          <option value="all">All scopes</option>
          <option value="personal">Personal</option>
          <option value="organization">Organization</option>
        </select>
        <select
          className="admin-select"
          value={filters.platform}
          onChange={(event) => setFilters((current) => ({ ...current, platform: event.target.value }))}
        >
          <option value="all">All platforms</option>
          {platformOptions.map((platform) => (
            <option key={platform} value={platform}>
              {platform}
            </option>
          ))}
        </select>
        <select
          className="admin-select"
          value={filters.health}
          onChange={(event) => setFilters((current) => ({ ...current, health: event.target.value }))}
        >
          <option value="all">All health bands</option>
          <option value="healthy">Healthy</option>
          <option value="warning">Degraded</option>
          <option value="critical">Critical</option>
        </select>
        <input
          type="search"
          className="admin-input admin-input-full"
          placeholder="Search display name, username, platform, owner, or org"
          value={filters.search}
          onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
        />
      </div>

      <section className="admin-panel">
        <div className="admin-table-wrap">
          {filteredAccounts.length ? (
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>User / Org</th>
                  <th>Platform</th>
                  <th>Health</th>
                  <th>Status</th>
                  <th>Failures</th>
                  <th>Last Activity</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map((account) => {
                  const owner = getOwnerLabel(account, profileMap, organizationMap);
                  const tone = getHealthTone(account);
                  const alertCount = (alertsByAccountId.get(account.id) || []).length;

                  return (
                    <tr
                      key={account.id}
                      id={`admin-account-row-${account.id}`}
                      className={`admin-account-row admin-account-row-${getHealthTier(account)}`.trim()}
                    >
                      <td>
                        <div className="admin-identity-cell">
                          <PlatformIcon platform={account.platform} size="sm" />
                          <div className="admin-metric-stack">
                            <strong>{getConnectedAccountDisplayName(account)}</strong>
                            <span>{account.username ? `@${account.username}` : account.platform_display_name || account.platform}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="admin-metric-stack">
                          <strong>{owner.primary}</strong>
                          <span>{owner.secondary}</span>
                        </div>
                      </td>
                      <td>
                        <div className="admin-metric-stack">
                          <strong>{account.platform_display_name || account.platform}</strong>
                          <span>{getScopeLabel(account.scope)}</span>
                        </div>
                      </td>
                      <td>
                        <div className="admin-account-health-cell">
                          <div className="admin-account-health-bar">
                            <span
                              className={`tone-${tone}`.trim()}
                              style={{ width: `${Math.max(0, Math.min(100, Number(account.health_score || 0)))}%` }}
                            />
                          </div>
                          <span className="admin-account-health-value">{Number(account.health_score || 0)}%</span>
                        </div>
                      </td>
                      <td>
                        <div className="admin-metric-stack">
                          <span className={`admin-pill admin-pill-${getStatusTone(account.connection_status)}`.trim()}>
                            <span className="admin-pill-dot" />
                            {getStatusLabel(account.connection_status)}
                          </span>
                          {alertCount ? <span>{alertCount} unresolved alert{alertCount === 1 ? "" : "s"}</span> : null}
                        </div>
                      </td>
                      <td>{Number(account.consecutive_failure_count || 0)}</td>
                      <td>{getLastActivityLabel(account)}</td>
                      <td>
                        <div className="admin-row-actions">
                          <button
                            type="button"
                            className="admin-inline-button"
                            onClick={() => {
                              setSelectedAccountId(account.id);
                              setPanelOpen(true);
                            }}
                          >
                            View details
                          </button>
                          <button
                            type="button"
                            className="admin-secondary-button"
                            disabled={busyKey === `force_reconnect:${account.id}`}
                            onClick={() => void runAdminAction(
                              {
                                action: "force_reconnect",
                                connected_account_id: account.id,
                                reason: "Triggered from the accounts table.",
                              },
                              { successMessage: "Account reconnected." },
                            )}
                          >
                            {busyKey === `force_reconnect:${account.id}` ? "Working..." : "Reconnect"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="admin-empty-inline">No connected accounts matched the current filters.</div>
          )}
        </div>
      </section>

      <AccountMaintenancePanel
        open={panelOpen}
        account={selectedAccount}
        alerts={selectedAccount ? alertsByAccountId.get(selectedAccount.id) || [] : []}
        profileMap={profileMap}
        organizationMap={organizationMap}
        onClose={() => setPanelOpen(false)}
        onRunAction={runAdminAction}
        onRefresh={loadConsole}
      />
    </section>
  );
}
