"use client";

import React, { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, KeyRound, PauseCircle, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useAdminLayoutContext } from "../AdminLayoutContext";
import { supabase } from "../../services/supabaseClient";
import useDebouncedValue from "../hooks/useDebouncedValue";
import ActivityStatusBadge from "../components/ActivityStatusBadge";
import SuspendUserModal from "../components/SuspendUserModal";
import {
  fetchConnectedAccountCountMap,
  fetchGenerationCountMap,
  fetchOrganizationsByIds,
  fetchPostCountMap,
  inferActivityStatus,
  sendAdminPasswordReset,
  updateAdminUserStatus,
} from "../utils/adminClient";
import { formatRelativeTime, formatShortDate, formatShortDateTime } from "../utils/formatDate";

const PAGE_SIZE = 25;

function toCsv(rows) {
  const headers = [
    "Name",
    "Email",
    "Organization",
    "Role",
    "Activity Status",
    "Last Active",
    "Connected Platforms",
    "Generations",
    "Posts",
  ];

  const body = rows.map((row) => [
    row.full_name || "",
    row.email || "",
    row.organization_name || "",
    row.role || "user",
    row.activity_status || "",
    row.last_active_at || "",
    row.connected_platform_count || 0,
    row.generation_count || 0,
    row.post_count || 0,
  ]);

  return [headers, ...body]
    .map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function mergeProfileIntoRow(row, profilePatch) {
  const merged = {
    ...row,
    full_name: profilePatch.full_name ?? row.full_name,
    email: profilePatch.email ?? row.email,
    avatar_url: profilePatch.avatar_url ?? row.avatar_url,
    role: profilePatch.role ?? row.role,
    organization_id:
      profilePatch.organization_id !== undefined ? profilePatch.organization_id : row.organization_id,
    last_active_at: profilePatch.last_active_at ?? row.last_active_at,
    activity_status: profilePatch.activity_status ?? row.activity_status,
    created_at: profilePatch.created_at ?? row.created_at,
  };

  return {
    ...merged,
    activity_status: inferActivityStatus(merged),
  };
}

function getPasswordResetLabel(resetState) {
  if (!resetState) return "Reset";
  if (resetState.status === "loading") return "Sending...";
  if (resetState.status === "sent") return "Sent";
  if (resetState.status === "error") return "Retry";
  return "Reset";
}

function formatSuspensionExpiry(durationHours) {
  if (!durationHours) return "indefinitely";
  return formatShortDateTime(new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString());
}

async function fetchAdminUsersPage({ adminAccess, filters, page }) {
  if (!adminAccess?.isAdmin) {
    return { rows: [], totalCount: 0, organizationOptions: [] };
  }

  let query = supabase
    .from("profiles")
    .select(
      "id, full_name, email, avatar_url, role, organization_id, last_active_at, activity_status, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (adminAccess.isOrgAdmin) {
    query = query.eq("organization_id", adminAccess.organizationId);
  } else if (filters.organizationId !== "all") {
    query = query.eq("organization_id", filters.organizationId);
  }

  if (filters.activityStatus !== "all") {
    query = query.eq("activity_status", filters.activityStatus);
  }

  if (filters.search.trim()) {
    const escapedSearch = filters.search.trim().replace(/,/g, " ");
    query = query.or(`full_name.ilike.%${escapedSearch}%,email.ilike.%${escapedSearch}%`);
  }

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data, error, count } = await query.range(from, to);
  if (error) throw error;

  const userRows = data || [];
  const userIds = userRows.map((row) => row.id);
  const organizationIds = userRows.map((row) => row.organization_id).filter(Boolean);

  const [organizationMap, connectedAccountCounts, generationCounts, postCounts, orgOptionsResult] =
    await Promise.all([
      fetchOrganizationsByIds(organizationIds),
      fetchConnectedAccountCountMap(userIds),
      fetchGenerationCountMap(userIds),
      fetchPostCountMap(userIds),
      adminAccess.isSuperAdmin
        ? supabase.from("organizations").select("id, name").order("name", { ascending: true })
        : Promise.resolve({ data: [] }),
    ]);

  return {
    rows: userRows.map((profile) => ({
      ...profile,
      activity_status: inferActivityStatus(profile),
      organization_name: organizationMap.get(profile.organization_id)?.name || "-",
      connected_platform_count: connectedAccountCounts.get(profile.id) || 0,
      generation_count: generationCounts.get(profile.id) || 0,
      post_count: postCounts.get(profile.id) || 0,
    })),
    totalCount: count || 0,
    organizationOptions: orgOptionsResult.data || [],
  };
}

export default function AdminUsersPage() {
  const { navigate } = useAppNavigation();
  const queryClient = useQueryClient();
  const { adminAccess } = useAdminLayoutContext();
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(1);
  const [passwordResetState, setPasswordResetState] = useState({});
  const [suspendTargets, setSuspendTargets] = useState([]);
  const [suspendBusy, setSuspendBusy] = useState(false);
  const [filters, setFilters] = useState({
    search: "",
    activityStatus: "all",
    organizationId: "all",
  });
  const debouncedSearch = useDebouncedValue(filters.search, 250);

  const queryKey = useMemo(
    () => [
      "admin-users",
      adminAccess?.user?.id || "anon",
      adminAccess?.adminRole || "none",
      adminAccess?.organizationId || "all",
      page,
      debouncedSearch.trim().toLowerCase(),
      filters.activityStatus,
      filters.organizationId,
    ],
    [
      adminAccess?.adminRole,
      adminAccess?.organizationId,
      adminAccess?.user?.id,
      debouncedSearch,
      filters.activityStatus,
      filters.organizationId,
      page,
    ],
  );

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey,
    enabled: Boolean(adminAccess?.isAdmin),
    placeholderData: keepPreviousData,
    queryFn: () =>
      fetchAdminUsersPage({
        adminAccess,
        filters: {
          ...filters,
          search: debouncedSearch,
        },
        page,
      }),
  });

  const rows = data?.rows || [];
  const totalCount = data?.totalCount || 0;
  const organizationOptions = data?.organizationOptions || [];

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => rows.some((row) => row.id === id)));
  }, [rows]);

  useEffect(() => {
    if (!adminAccess?.isAdmin) return undefined;

    const channel = supabase
      .channel(`admin-users-realtime-${adminAccess.user?.id || "anon"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, (payload) => {
        const rowId = payload.new?.id || payload.old?.id;
        if (!rowId) return;

        queryClient.setQueryData(queryKey, (current) => {
          if (!current) return current;
          const belongsToScope = (row) => {
            if (!adminAccess.isOrgAdmin) return true;
            return row?.organization_id === adminAccess.organizationId;
          };

          if (payload.eventType === "DELETE" || !belongsToScope(payload.new)) {
            return {
              ...current,
              rows: current.rows.filter((row) => row.id !== rowId),
              totalCount:
                payload.eventType === "DELETE"
                  ? Math.max(0, current.totalCount - 1)
                  : current.totalCount,
            };
          }

          return {
            ...current,
            rows: current.rows.map((row) =>
              row.id === rowId ? mergeProfileIntoRow(row, payload.new) : row,
            ),
          };
        });

        if (payload.eventType === "DELETE" || payload.new?.organization_id !== adminAccess?.organizationId) {
          setSelectedIds((current) => current.filter((id) => id !== rowId));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    adminAccess?.isAdmin,
    adminAccess?.isOrgAdmin,
    adminAccess?.organizationId,
    adminAccess?.user?.id,
    queryClient,
    queryKey,
  ]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.includes(row.id)),
    [rows, selectedIds],
  );

  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));

  const closeSuspendModal = () => {
    if (suspendBusy) return;
    setSuspendTargets([]);
  };

  const patchCurrentRows = (updater) => {
    queryClient.setQueryData(queryKey, (current) => {
      if (!current) return current;
      return {
        ...current,
        rows: current.rows.map((row) => updater(row)),
      };
    });
  };

  const handleExport = () => {
    const csv = toCsv(selectedRows.length ? selectedRows : rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "admin-users.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin-users", adminAccess?.user?.id || "anon"] });
    refetch();
  };

  const handleResetPassword = async (row) => {
    setPasswordResetState((current) => ({
      ...current,
      [row.id]: { status: "loading" },
    }));

    try {
      await sendAdminPasswordReset(adminAccess, row);
      const sentAt = new Date().toISOString();
      setPasswordResetState((current) => ({
        ...current,
        [row.id]: {
          status: "sent",
          sentAt,
          email: row.email,
        },
      }));
      toast.success(`Password reset email sent to ${row.email}.`);
    } catch (error) {
      console.error("Failed to send password reset:", error);
      setPasswordResetState((current) => ({
        ...current,
        [row.id]: {
          status: "error",
          message: error.message,
        },
      }));
      toast.error("Failed to send password reset.");
    }
  };

  const handleSuspendClick = async (row) => {
    if (row.activity_status === "suspended") {
      try {
        await updateAdminUserStatus(adminAccess, row, {
          mode: "unsuspend",
          note: "Restriction lifted from admin directory.",
        });

        patchCurrentRows((item) =>
          item.id === row.id
            ? {
                ...item,
                activity_status: "active",
                suspension_type: null,
                suspension_expires_at: null,
              }
            : item,
        );

        toast.success(`Restrictions lifted for ${row.full_name || row.email || "user"}.`);
      } catch (error) {
        console.error("Failed to unsuspend user:", error);
        toast.error("Failed to lift the restriction.");
      }
      return;
    }

    setSuspendTargets([row]);
  };

  const handleBulkSuspend = () => {
    const activeTargets = selectedRows.filter((row) => row.activity_status !== "suspended");
    if (!activeTargets.length) {
      toast.error("Select at least one active user to suspend.");
      return;
    }
    setSuspendTargets(activeTargets);
  };

  const handleConfirmSuspend = async (payload) => {
    setSuspendBusy(true);

    try {
      const results = await Promise.allSettled(
        suspendTargets.map((target) =>
          updateAdminUserStatus(adminAccess, target, {
            mode: "suspend",
            ...payload,
          }),
        ),
      );

      const successfulIds = results
        .map((result, index) => (result.status === "fulfilled" ? suspendTargets[index].id : null))
        .filter(Boolean);

      if (successfulIds.length) {
        patchCurrentRows((row) =>
          successfulIds.includes(row.id)
            ? {
                ...row,
                activity_status: "suspended",
                suspension_type: payload.suspensionType,
                suspension_expires_at: payload.durationHours
                  ? new Date(Date.now() + payload.durationHours * 60 * 60 * 1000).toISOString()
                  : null,
              }
            : row,
        );

        setSelectedIds((current) => current.filter((id) => !successfulIds.includes(id)));
      }

      const failureCount = results.length - successfulIds.length;
      if (successfulIds.length) {
        toast.success(
          successfulIds.length === 1
            ? `User suspended. Expires ${formatSuspensionExpiry(payload.durationHours)}.`
            : `${successfulIds.length} users suspended.`,
        );
      }
      if (failureCount) {
        toast.error(`${failureCount} suspension request${failureCount > 1 ? "s" : ""} failed.`);
      }

      closeSuspendModal();
    } catch (error) {
      console.error("Failed to suspend selected users:", error);
      toast.error("Failed to complete the suspension request.");
    } finally {
      setSuspendBusy(false);
    }
  };

  const startRecord = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endRecord = totalCount === 0 ? 0 : Math.min(page * PAGE_SIZE, totalCount);

  return (
    <section className="admin-page">
      <header className="admin-page-header">
        <div>
          <span className="admin-section-kicker">Admin Directory</span>
          <h2 className="admin-page-title">Users</h2>
          <p className="admin-page-subtext">
            Full-width account directory with activity health, platform coverage, and quick operations.
          </p>
        </div>

        <div className="admin-header-actions">
          <button type="button" className="admin-secondary-button" onClick={handleExport}>
            <Download size={16} />
            Export
          </button>
          <button type="button" className="admin-secondary-button" onClick={handleRefresh}>
            <RefreshCw size={16} className={isFetching ? "admin-spin" : ""} />
            {isFetching ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      <div className="admin-filterbar">
        <input
          type="search"
          className="admin-input"
          placeholder="Search by name or email"
          value={filters.search}
          onChange={(event) => {
            setPage(1);
            setFilters((current) => ({ ...current, search: event.target.value }));
          }}
        />

        <select
          className="admin-select"
          value={filters.activityStatus}
          onChange={(event) => {
            setPage(1);
            setFilters((current) => ({ ...current, activityStatus: event.target.value }));
          }}
        >
          <option value="all">All activity bands</option>
          <option value="highly_active">Highly Active</option>
          <option value="active">Active</option>
          <option value="dormant">Dormant</option>
          <option value="inactive">Inactive</option>
          <option value="suspended">Suspended</option>
        </select>

        <select
          className="admin-select"
          value={filters.organizationId}
          disabled={!adminAccess?.isSuperAdmin}
          onChange={(event) => {
            setPage(1);
            setFilters((current) => ({ ...current, organizationId: event.target.value }));
          }}
        >
          <option value="all">All organizations</option>
          {organizationOptions.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </select>
      </div>

      {selectedRows.length ? (
        <div className="admin-bulkbar">
          <span>{selectedRows.length} selected</span>
          <div className="admin-header-actions">
            <button type="button" className="admin-secondary-button" onClick={handleBulkSuspend}>
              <PauseCircle size={16} />
              Bulk Suspend
            </button>
            <button type="button" className="admin-secondary-button" onClick={handleExport}>
              <Download size={16} />
              Export Selected
            </button>
          </div>
        </div>
      ) : null}

      <div className="admin-panel">
        <div className="admin-table-wrap">
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setSelectedIds(rows.map((row) => row.id));
                      } else {
                        setSelectedIds([]);
                      }
                    }}
                  />
                </th>
                <th>Name</th>
                <th>Organization</th>
                <th>Role</th>
                <th>Activity</th>
                <th>Last Active</th>
                <th>Connected</th>
                <th>Generated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan="9" className="admin-table-empty">
                    Loading users...
                  </td>
                </tr>
              ) : rows.length ? (
                rows.map((row) => {
                  const resetState = passwordResetState[row.id];
                  return (
                    <tr key={row.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(row.id)}
                          onChange={(event) => {
                            setSelectedIds((current) =>
                              event.target.checked
                                ? [...new Set([...current, row.id])]
                                : current.filter((id) => id !== row.id),
                            );
                          }}
                        />
                      </td>
                      <td>
                        <div className="admin-identity-cell">
                          <div className="admin-avatar">
                            {(row.full_name || row.email || "?").slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <strong>{row.full_name || "Unnamed user"}</strong>
                            <span>{row.email || "No email"}</span>
                          </div>
                        </div>
                      </td>
                      <td>{row.organization_name}</td>
                      <td>{row.role || "user"}</td>
                      <td>
                        <ActivityStatusBadge status={row.activity_status} />
                      </td>
                      <td>
                        <div className="admin-metric-stack">
                          <strong>{formatRelativeTime(row.last_active_at)}</strong>
                          <span>{formatShortDate(row.last_active_at)}</span>
                        </div>
                      </td>
                      <td>{row.connected_platform_count}</td>
                      <td>{row.generation_count}</td>
                      <td>
                        <div className="admin-row-actions-stack">
                          <div className="admin-row-actions">
                            <button
                              type="button"
                              className="admin-inline-button"
                              onClick={() => navigate(`/app/admin/users/${row.id}`)}
                            >
                              <Eye size={14} />
                              View
                            </button>
                            <button
                              type="button"
                              className="admin-inline-button"
                              onClick={() => handleSuspendClick(row)}
                            >
                              <PauseCircle size={14} />
                              {row.activity_status === "suspended" ? "Unsuspend" : "Suspend"}
                            </button>
                            <button
                              type="button"
                              className="admin-inline-button"
                              disabled={resetState?.status === "loading"}
                              onClick={() => handleResetPassword(row)}
                            >
                              <KeyRound size={14} />
                              {getPasswordResetLabel(resetState)}
                            </button>
                          </div>

                          {resetState?.status === "sent" ? (
                            <span className="admin-action-feedback success">
                              Reset email sent to {resetState.email} at {formatShortDateTime(resetState.sentAt)}
                            </span>
                          ) : null}

                          {resetState?.status === "error" ? (
                            <span className="admin-action-feedback error">
                              Failed to send reset email. Try again.
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="9" className="admin-table-empty">
                    No users match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="admin-pagination">
          <span>
            Showing {startRecord}-{endRecord} of {totalCount}
          </span>
          <div className="admin-header-actions">
            <button
              type="button"
              className="admin-secondary-button"
              disabled={page === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="admin-secondary-button"
              disabled={page * PAGE_SIZE >= totalCount}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <SuspendUserModal
        open={Boolean(suspendTargets.length)}
        targets={suspendTargets}
        busy={suspendBusy}
        onClose={closeSuspendModal}
        onConfirm={handleConfirmSuspend}
      />
    </section>
  );
}
