"use client";

import React, { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useAdminLayoutContext } from "../AdminLayoutContext";
import { supabase } from "../../services/supabaseClient";
import KpiCard from "../components/KpiCard/KpiCard";
import AccountSeverityPanel from "../components/AccountSeverityPanel";
import RiskNotificationModal from "../components/RiskNotificationModal/RiskNotificationModal";
import {
  acknowledgeNotification,
  fetchAdminNotifications,
  fetchRiskEventCounts,
  fetchScopedUserIds,
  inferActivityStatus,
} from "../utils/adminClient";
import { formatRelativeTime, formatShortDate } from "../utils/formatDate";
import {
  COMPLAINT_STATUS,
  POST_STATUS,
  RISK_LEVEL,
  RISK_LEVEL_LABEL,
} from "../../constants/statuses";

const RANGE_OPTIONS = [7, 14, 30, 90];
const EMPTY_SCOPE_ID = "00000000-0000-0000-0000-000000000000";
const RISK_PRIORITY = {
  [RISK_LEVEL.NONE]: 0,
  [RISK_LEVEL.LOW]: 1,
  [RISK_LEVEL.MEDIUM]: 2,
  [RISK_LEVEL.HIGH]: 3,
  [RISK_LEVEL.VERY_HIGH]: 4,
  critical: 4,
};
const RISK_ACCENT = {
  [RISK_LEVEL.LOW]: "var(--admin-accent-light)",
  [RISK_LEVEL.MEDIUM]: "var(--admin-warning)",
  [RISK_LEVEL.HIGH]: "var(--admin-warning)",
  [RISK_LEVEL.VERY_HIGH]: "var(--admin-danger)",
  critical: "var(--admin-danger)",
};

function formatChartLabel(dateString) {
  if (!dateString) return "";
  return new Date(`${dateString}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function getEmptyOverview(days) {
  const trend = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - index);
    trend.push({
      date: date.toISOString().slice(0, 10),
      total: 0,
      completed: 0,
      failed: 0,
    });
  }

  return {
    kpis: [],
    generationTrend: trend,
    generationSummary: {
      total: 0,
      completed: 0,
      failed: 0,
      successRate: 0,
    },
    activityFeed: [],
    atRiskUsers: [],
    complaints: [],
    platformHealth: [],
  };
}

function buildGenerationTrend(rows, days) {
  const buckets = new Map();
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - index);
    buckets.set(date.toISOString().slice(0, 10), {
      date: date.toISOString().slice(0, 10),
      total: 0,
      completed: 0,
      failed: 0,
    });
  }

  (rows || []).forEach((row) => {
    if (!row?.created_at) return;
    const key = row.created_at.slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) return;
    bucket.total += 1;
    if (row.status === "completed") bucket.completed += 1;
    if (row.status === "failed") bucket.failed += 1;
  });

  return [...buckets.values()];
}

function getRiskPriority(level) {
  return RISK_PRIORITY[level] ?? 0;
}

function aggregateRiskRows(rows) {
  const grouped = new Map();

  (rows || []).forEach((row) => {
    const key = row.domain || "unknown";
    const current = grouped.get(key) || {
      domain: key,
      failureCount: 0,
      riskLevel: RISK_LEVEL.NONE,
      windowStart: row.window_start,
    };

    current.failureCount = Math.max(current.failureCount, Number(row.failure_count || 0));
    if (getRiskPriority(row.risk_level) >= getRiskPriority(current.riskLevel)) {
      current.riskLevel = row.risk_level || current.riskLevel;
    }
    if (!current.windowStart || new Date(row.window_start).getTime() > new Date(current.windowStart).getTime()) {
      current.windowStart = row.window_start;
    }

    grouped.set(key, current);
  });

  return [...grouped.values()].sort((left, right) => getRiskPriority(right.riskLevel) - getRiskPriority(left.riskLevel));
}

function getScopedQuery(query, adminAccess, scopedUserIds) {
  if (!adminAccess?.isOrgAdmin) return query;
  return query.in("user_id", scopedUserIds.length ? scopedUserIds : [EMPTY_SCOPE_ID]);
}

async function fetchAdminOverview({ adminAccess, days }) {
  if (!adminAccess?.isAdmin) {
    return getEmptyOverview(days);
  }

  const since = new Date();
  since.setDate(since.getDate() - days);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const activeUsersSince = new Date();
  activeUsersSince.setDate(activeUsersSince.getDate() - 15);
  const scopedUserIds = adminAccess.isOrgAdmin ? (await fetchScopedUserIds(adminAccess)) || [] : [];

  const applyProfileScope = (query) => (
    adminAccess.isOrgAdmin
      ? query.eq("organization_id", adminAccess.organizationId)
      : query
  );

  const applyComplaintScope = (query) => (
    adminAccess.isOrgAdmin
      ? query.eq("organization_id", adminAccess.organizationId)
      : query
  );

  const [
    totalUsersResult,
    scheduledPostsResult,
    publishedTodayResult,
    openComplaintsResult,
    generationsResult,
    generationFailuresResult,
    moderationQueueResult,
    riskRows,
    logsResult,
    atRiskUsersResult,
    complaintsResult,
  ] = await Promise.all([
    applyProfileScope(
      supabase.from("profiles").select("id", { count: "exact", head: true }),
    ),
    getScopedQuery(
      supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("status", POST_STATUS.SCHEDULED),
      adminAccess,
      scopedUserIds,
    ),
    getScopedQuery(
      supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("status", POST_STATUS.PUBLISHED)
        .gte("published_at", startOfToday.toISOString()),
      adminAccess,
      scopedUserIds,
    ),
    applyComplaintScope(
      supabase
        .from("complaints")
        .select("id, status", { count: "exact" })
        .not("status", "in", `(${COMPLAINT_STATUS.RESOLVED},${COMPLAINT_STATUS.CLOSED})`),
    ),
    getScopedQuery(
      supabase
        .from("generations")
        .select("id, status, created_at")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: true }),
      adminAccess,
      scopedUserIds,
    ),
    adminAccess.isOrgAdmin
      ? supabase
          .from("audit_logs")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", adminAccess.organizationId)
          .or("event_type.eq.generation_failed,event_type.eq.generation_error,event_type.eq.generation_timeout")
      : supabase
          .from("audit_logs")
          .select("id", { count: "exact", head: true })
          .or("event_type.eq.generation_failed,event_type.eq.generation_error,event_type.eq.generation_timeout"),
    getScopedQuery(
      supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("moderation_status", "under_review"),
      adminAccess,
      scopedUserIds,
    ),
    fetchRiskEventCounts(24),
    adminAccess.isOrgAdmin
      ? supabase
          .from("audit_logs")
          .select("id, summary, event_category, event_type, created_at")
          .eq("organization_id", adminAccess.organizationId)
          .order("created_at", { ascending: false })
          .limit(8)
      : supabase
          .from("audit_logs")
          .select("id, summary, event_category, event_type, created_at")
          .order("created_at", { ascending: false })
          .limit(8),
    applyProfileScope(
      supabase
        .from("profiles")
        .select("id, full_name, email, activity_status, last_active_at, created_at")
        .in("activity_status", ["dormant", "inactive"])
        .order("last_active_at", { ascending: true, nullsFirst: true })
        .limit(6),
    ),
    applyComplaintScope(
      supabase
        .from("complaints")
        .select("id, title, subject, status, priority, created_at")
        .order("created_at", { ascending: false })
        .limit(6),
    ),
  ]);

  const results = [
    totalUsersResult,
    scheduledPostsResult,
    publishedTodayResult,
    openComplaintsResult,
    generationsResult,
    generationFailuresResult,
    moderationQueueResult,
    logsResult,
    atRiskUsersResult,
    complaintsResult,
  ];

  results.forEach((result) => {
    if (result?.error) {
      throw result.error;
    }
  });

  const generationTrend = buildGenerationTrend(generationsResult.data || [], days);
  const totalGenerated = generationTrend.reduce((sum, item) => sum + item.total, 0);
  const completedGenerated = generationTrend.reduce((sum, item) => sum + item.completed, 0);
  const failedGenerated = generationTrend.reduce((sum, item) => sum + item.failed, 0);
  const successRate = totalGenerated ? Number(((completedGenerated / totalGenerated) * 100).toFixed(1)) : 0;
  const platformHealth = aggregateRiskRows(riskRows);
  const highestRisk = platformHealth[0]?.riskLevel || RISK_LEVEL.NONE;

  return {
    kpis: [
      {
        title: "Total Users",
        value: String(totalUsersResult.count || 0),
        trend: "Accounts in scope",
        trendUp: true,
        color: "var(--admin-accent-light)",
      },
      {
        title: "Scheduled Posts",
        value: String(scheduledPostsResult.count || 0),
        trend: "Queued in calendar",
        trendUp: true,
        color: "var(--admin-success)",
      },
      {
        title: "Published Today",
        value: String(publishedTodayResult.count || 0),
        trend: "Today's completed publishes",
        trendUp: true,
        color: "var(--admin-success)",
      },
      {
        title: "Open Complaints",
        value: String(openComplaintsResult.count || 0),
        trend: "Support queue",
        trendUp: false,
        color: "var(--admin-warning)",
      },
      {
        title: "Generation Failures",
        value: String(generationFailuresResult.count || 0),
        trend: "Audit log failures",
        trendUp: false,
        color: "var(--admin-danger)",
      },
      {
        title: "Moderation Queue",
        value: String(moderationQueueResult.count || 0),
        trend: "Posts under review",
        trendUp: false,
        color: "var(--admin-warning)",
      },
      {
        title: "Platform Risk",
        value: String(platformHealth.length),
        trend: platformHealth.length
          ? `${RISK_LEVEL_LABEL[highestRisk] || highestRisk} active`
          : "No active domains",
        trendUp: platformHealth.length === 0,
        color: RISK_ACCENT[highestRisk] || "var(--admin-success)",
        isRiskCard: true,
      },
    ],
    generationTrend,
    generationSummary: {
      total: totalGenerated,
      completed: completedGenerated,
      failed: failedGenerated,
      successRate,
    },
    activityFeed: logsResult.data || [],
    atRiskUsers: (atRiskUsersResult.data || []).map((profile) => ({
      ...profile,
      activity_status: inferActivityStatus(profile),
    })),
    complaints: complaintsResult.data || [],
    platformHealth,
  };
}

export default function AdminOverview() {
  const { adminAccess } = useAdminLayoutContext();
  const { navigate } = useAppNavigation();
  const [rangeDays, setRangeDays] = useState(30);
  const [pendingRiskModals, setPendingRiskModals] = useState([]);
  const queryKey = useMemo(
    () => ["admin-overview", adminAccess?.user?.id || "anon", adminAccess?.organizationId || "all", rangeDays],
    [adminAccess?.organizationId, adminAccess?.user?.id, rangeDays],
  );

  const { data, isLoading, refetch } = useQuery({
    queryKey,
    enabled: Boolean(adminAccess?.isAdmin),
    placeholderData: keepPreviousData,
    queryFn: () => fetchAdminOverview({ adminAccess, days: rangeDays }),
  });

  useEffect(() => {
    let mounted = true;

    async function loadPendingRiskAlerts() {
      if (!adminAccess?.isAdmin) return;
      const rows = await fetchAdminNotifications({
        limit: 20,
        severity: RISK_LEVEL.VERY_HIGH,
        unacknowledgedOnly: true,
      });

      if (mounted) {
        setPendingRiskModals(rows.filter((notification) => !notification.acknowledged_at));
      }
    }

    loadPendingRiskAlerts();
    return () => {
      mounted = false;
    };
  }, [adminAccess?.isAdmin, adminAccess?.organizationId, adminAccess?.user?.id]);

  useEffect(() => {
    if (!adminAccess?.isAdmin) return undefined;

    const channel = supabase
      .channel("admin-risk-alerts")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "admin_notifications",
          filter: "severity=eq.very_high",
        },
        (payload) => {
          setPendingRiskModals((current) => {
            if (current.some((notification) => notification.id === payload.new.id)) {
              return current;
            }

            return [
              ...current,
              {
                ...payload.new,
                read: payload.new.is_read ?? false,
                type: payload.new.notification_type ?? "risk_alert",
                metadata: payload.new.metadata || {},
              },
            ];
          });
          refetch();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [adminAccess?.isAdmin, refetch]);

  const handleAcknowledgeRiskAlerts = async () => {
    await Promise.all(pendingRiskModals.map((notification) => acknowledgeNotification(notification.id)));
    setPendingRiskModals([]);
  };

  const overview = data || getEmptyOverview(rangeDays);

  if (isLoading) {
    return <div className="admin-page-loading">Loading admin overview...</div>;
  }

  return (
    <section className="admin-page">
      <RiskNotificationModal
        notifications={pendingRiskModals}
        onAcknowledge={handleAcknowledgeRiskAlerts}
      />

      <header className="admin-page-header admin-overview-page-header">
        <div className="admin-overview-heading">
          <span className="admin-section-kicker">Admin Dashboard</span>
          <div className="admin-overview-title-row">
            <h2 className="admin-page-title">Operational overview</h2>
            <div className="admin-header-actions admin-range-actions" role="group" aria-label="Overview date range">
              {RANGE_OPTIONS.map((days) => (
                <button
                  key={days}
                  type="button"
                  className={`admin-secondary-button${rangeDays === days ? " active" : ""}`}
                  onClick={() => setRangeDays(days)}
                >
                  {days}d
                </button>
              ))}
            </div>
          </div>
          <p className="admin-page-subtext">
            KPI alignment, platform risk, queue pressure, and scoped support visibility.
          </p>
        </div>
      </header>

      <div className="admin-kpi-grid">
        {overview.kpis.map((kpi) => (
          <KpiCard
            key={kpi.title}
            {...kpi}
            onClick={kpi.isRiskCard ? () => navigate("/app/admin/logs") : null}
          />
        ))}
      </div>

      <AccountSeverityPanel enabled={Boolean(adminAccess?.isSuperAdmin)} />

      <div className="admin-section-grid admin-section-grid-wide">
        <div className="admin-panel">
          <div className="admin-panel-header">
            <div>
              <span className="admin-chart-kicker">Generation volume</span>
              <h3>{overview.generationSummary.total.toLocaleString()} total this period</h3>
              <p className="admin-page-subtext">
                {overview.generationSummary.successRate}% success rate - {overview.generationSummary.failed.toLocaleString()} failed
              </p>
            </div>
          </div>
          <div className="admin-chart-frame">
            <ResponsiveContainer>
              <LineChart data={overview.generationTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--admin-chart-grid)" />
                <XAxis dataKey="date" stroke="var(--admin-chart-axis)" tickFormatter={formatChartLabel} />
                <YAxis stroke="var(--admin-chart-axis)" allowDecimals={false} />
                <Tooltip
                  labelFormatter={(label) => formatChartLabel(label)}
                  formatter={(value, name) => [value, String(name).replace(/^\w/, (char) => char.toUpperCase())]}
                />
                <Legend />
                <Line type="monotone" dataKey="total" stroke="var(--admin-chart-1)" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="completed" stroke="var(--admin-success)" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="failed" stroke="var(--admin-danger)" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="admin-panel">
          <div className="admin-panel-header">
            <div>
              <span className="admin-chart-kicker">Platform health</span>
              <h3>Active risk domains</h3>
            </div>
            <button type="button" className="admin-inline-button" onClick={() => navigate("/app/admin/logs")}>
              View logs
            </button>
          </div>
          <div className="admin-list-stack">
            {overview.platformHealth.length ? (
              overview.platformHealth.map((item) => (
                <div key={item.domain} className="admin-list-item">
                  <strong>{item.domain.replace(/_/g, " ")}</strong>
                  <span>
                    {item.failureCount} failures - {RISK_LEVEL_LABEL[item.riskLevel] || item.riskLevel}
                  </span>
                </div>
              ))
            ) : (
              <div className="admin-empty-inline">No active risk domains in the last 24 hours.</div>
            )}
          </div>
        </div>
      </div>

      <div className="admin-card-grid">
        <div className="admin-panel">
          <h3>Realtime operational feed</h3>
          <div className="admin-list-stack">
            {overview.activityFeed.length ? (
              overview.activityFeed.map((event) => (
                <div key={event.id} className="admin-list-item">
                  <strong>{event.summary}</strong>
                  <span>
                    {event.event_category} - {formatRelativeTime(event.created_at)}
                  </span>
                </div>
              ))
            ) : (
              <div className="admin-empty-inline">No recent audit events in scope.</div>
            )}
          </div>
        </div>

        <div className="admin-panel">
          <h3>At-risk users</h3>
          <div className="admin-list-stack">
            {overview.atRiskUsers.length ? (
              overview.atRiskUsers.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  className="admin-list-item admin-list-item-button"
                  onClick={() => navigate(`/app/admin/users/${profile.id}`)}
                >
                  <strong>{profile.full_name || profile.email || profile.id}</strong>
                  <span>
                    {profile.activity_status} - last active {formatShortDate(profile.last_active_at)}
                  </span>
                </button>
              ))
            ) : (
              <div className="admin-empty-inline">No dormant or inactive users in scope.</div>
            )}
          </div>
        </div>

        <div className="admin-panel">
          <h3>Latest complaints</h3>
          <div className="admin-list-stack">
            {overview.complaints.length ? (
              overview.complaints.map((complaint) => (
                <button
                  key={complaint.id}
                  type="button"
                  className="admin-list-item admin-list-item-button"
                  onClick={() => navigate(`/app/admin/complaints/${complaint.id}`)}
                >
                  <strong>{complaint.title || complaint.subject || "Untitled complaint"}</strong>
                  <span>
                    {complaint.status} - {complaint.priority || "normal"} - {formatRelativeTime(complaint.created_at)}
                  </span>
                </button>
              ))
            ) : (
              <div className="admin-empty-inline">No complaints in scope.</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
