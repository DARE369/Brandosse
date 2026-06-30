import { supabase } from "../../services/supabaseClient";
import { ADMIN_ROLES, getAdminScopeLabel, getPermissionGroups, isAdminRole, normalizeAdminRole } from "./rbac";
import {
  ADMIN_NOTIFICATION_TYPE,
  COMPLAINT_STATUS,
  RISK_LEVEL,
} from "../../constants/statuses";

function isMissingRelationError(error) {
  if (!error) return false;
  const text = `${error.code || ""} ${error.message || ""}`.toLowerCase();
  return text.includes("does not exist") || text.includes("could not find") || text.includes("pgrst");
}

function isRecoverableAdminQueryError(error) {
  if (!error) return false;
  const text = `${error.code || ""} ${error.message || ""}`.toLowerCase();
  return (
    isMissingRelationError(error) ||
    text.includes("stack depth") ||
    text.includes("infinite recursion") ||
    text.includes("permission denied")
  );
}

const PROFILE_SELECT_VARIANTS = [
  "id, full_name, email, avatar_url, role, organization_id, credits, created_at, last_active_at",
  "id, full_name, email, avatar_url, role, credits, created_at, last_active_at",
  "id, full_name, email, avatar_url, role, organization_id, created_at",
  "id, full_name, email, avatar_url, role, created_at",
];

async function fetchProfileWithFallback(userId) {
  let lastError = null;

  for (const selectClause of PROFILE_SELECT_VARIANTS) {
    const result = await supabase
      .from("profiles")
      .select(selectClause)
      .eq("id", userId)
      .maybeSingle();

    if (!result.error || result.error.code === "PGRST116") {
      return result;
    }

    lastError = result.error;
    if (!isMissingRelationError(result.error)) {
      return result;
    }
  }

  return { data: null, error: lastError };
}

function arrayUnique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizeAdminNotification(notification) {
  const metadata = notification?.metadata || {};

  return {
    ...notification,
    admin_id: notification?.recipient_admin_id ?? null,
    type: notification?.notification_type ?? ADMIN_NOTIFICATION_TYPE.SYSTEM,
    severity: notification?.severity ?? RISK_LEVEL.LOW,
    read: notification?.is_read ?? false,
    acknowledged_at: notification?.acknowledged_at ?? null,
    metadata,
    entity_type: notification?.entity_type ?? metadata.entity_type ?? null,
    entity_id: notification?.entity_id ?? metadata.entity_id ?? null,
  };
}

function buildAuditLogArgs(payload = {}) {
  return {
    p_actor_id: payload.actor_id ?? null,
    p_actor_type: payload.actor_type ?? "system",
    p_actor_role: payload.actor_role ?? null,
    p_organization_id: payload.organization_id ?? null,
    p_event_category: payload.event_category,
    p_event_type: payload.event_type,
    p_entity_type: payload.entity_type ?? null,
    p_entity_id: payload.entity_id ?? null,
    p_summary: payload.summary,
    p_previous_value: payload.previous_value ?? null,
    p_new_value: payload.new_value ?? null,
    p_metadata: payload.metadata ?? null,
    p_risk_level: payload.risk_level ?? "low",
    p_correlation_id: payload.correlation_id ?? null,
    p_ip_address: payload.ip_address ?? null,
    p_user_agent: payload.user_agent ?? null,
  };
}

export function resolveInitials(name = "", email = "") {
  const source = name || email || "?";
  return source
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function inferActivityStatus(profile) {
  if (profile?.activity_status) return profile.activity_status;
  if (profile?.suspension_type) return "suspended";

  const lastActive = profile?.last_active_at || profile?.created_at;
  if (!lastActive) return "inactive";

  const diffDays = (Date.now() - new Date(lastActive).getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays <= 3) return "highly_active";
  if (diffDays <= 15) return "active";
  if (diffDays <= 30) return "dormant";
  return "inactive";
}

async function getAuthUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw error;
  return user ?? null;
}

export async function fetchAdminAccess() {
  const user = await getAuthUser();
  if (!user) {
    return {
      user: null,
      profile: null,
      isAdmin: false,
      adminRole: null,
      organizationId: null,
      organization: null,
      permissionGroups: [],
      scopeLabel: "No admin scope",
    };
  }

  const { data: profile, error: profileError } = await fetchProfileWithFallback(user.id);

  if (profileError && !isRecoverableAdminQueryError(profileError)) {
    throw profileError;
  }

  let adminRole = normalizeAdminRole(
    user?.app_metadata?.role ||
      user?.user_metadata?.role ||
      profile?.role ||
      null,
  );
  let organizationId = profile?.organization_id ?? null;

  const adminRoleQuery = await supabase
    .from("admin_roles")
    .select("role, organization_id, created_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!adminRoleQuery.error && adminRoleQuery.data) {
    adminRole = normalizeAdminRole(adminRoleQuery.data.role);
    organizationId = adminRoleQuery.data.organization_id ?? organizationId;
  } else if (adminRoleQuery.error) {
    console.warn("Continuing with profile-based admin fallback:", adminRoleQuery.error.message);
  }

  const isAdmin = isAdminRole(adminRole);
  let organization = null;

  if (organizationId) {
    const orgQuery = await supabase
      .from("organizations")
      .select("id, name, slug, plan, status")
      .eq("id", organizationId)
      .maybeSingle();

    if (!orgQuery.error) {
      organization = orgQuery.data ?? null;
    } else if (!isRecoverableAdminQueryError(orgQuery.error)) {
      throw orgQuery.error;
    } else {
      console.warn("Failed to resolve organization scope details:", orgQuery.error.message);
    }
  }

  return {
    user,
    profile,
    isAdmin,
    adminRole,
    organizationId,
    organization,
    permissionGroups: getPermissionGroups(adminRole),
    scopeLabel: getAdminScopeLabel({ adminRole, organization }),
    isSuperAdmin: adminRole === ADMIN_ROLES.SUPER_ADMIN,
    isOrgAdmin: adminRole === ADMIN_ROLES.ORG_ADMIN,
  };
}

export async function fetchScopedUserIds(adminAccess) {
  if (!adminAccess?.isOrgAdmin || !adminAccess.organizationId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("organization_id", adminAccess.organizationId);

  if (error) throw error;
  return (data || []).map((row) => row.id);
}

export async function fetchOrganizationsByIds(ids) {
  const organizationIds = arrayUnique(ids);
  if (!organizationIds.length) return new Map();

  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, slug, plan, status")
    .in("id", organizationIds);

  if (error && !isRecoverableAdminQueryError(error)) throw error;

  return new Map((data || []).map((row) => [row.id, row]));
}

export async function fetchAdminNotifications(options = {}) {
  const limit = typeof options === "number" ? options : options.limit ?? 10;
  const unreadOnly = typeof options === "object" ? Boolean(options.unreadOnly) : false;
  const unacknowledgedOnly = typeof options === "object" ? Boolean(options.unacknowledgedOnly) : false;
  const severity = typeof options === "object" ? options.severity ?? null : null;
  const type = typeof options === "object" ? options.type ?? null : null;
  const user = await getAuthUser();
  if (!user) return [];

  let query = supabase
    .from("admin_notifications")
    .select(
      "id, recipient_admin_id, notification_type, title, body, severity, metadata, domain, organization_id, is_read, acknowledged_at, entity_type, entity_id, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    query = query.eq("is_read", false);
  }

  if (unacknowledgedOnly) {
    query = query.is("acknowledged_at", null);
  }

  if (severity) {
    query = query.eq("severity", severity);
  }

  if (type) {
    query = query.eq("notification_type", type);
  }

  const { data, error } = await query;

  if (error) {
    if (isRecoverableAdminQueryError(error)) return [];
    throw error;
  }

  return (data || []).map(normalizeAdminNotification);
}

export async function markNotificationRead(notificationId) {
  if (!notificationId) return { success: false };

  const { error } = await supabase
    .from("admin_notifications")
    .update({ is_read: true })
    .eq("id", notificationId);

  if (error) {
    if (isRecoverableAdminQueryError(error)) return { success: false };
    throw error;
  }

  return { success: true };
}

export async function acknowledgeNotification(notificationId) {
  if (!notificationId) return { success: false };

  const { error } = await supabase
    .from("admin_notifications")
    .update({
      is_read: true,
      acknowledged_at: new Date().toISOString(),
    })
    .eq("id", notificationId);

  if (error) {
    if (isRecoverableAdminQueryError(error)) return { success: false };
    throw error;
  }

  return { success: true };
}

export async function markAdminNotificationsRead({ notificationIds = [], markAll = false, acknowledge = false } = {}) {
  const user = await getAuthUser();
  if (!user) return { success: false };

  const patch = acknowledge
    ? { is_read: true, acknowledged_at: new Date().toISOString() }
    : { is_read: true };

  let query = supabase
    .from("admin_notifications")
    .update(patch);

  if (!markAll) {
    const ids = arrayUnique(notificationIds);
    if (!ids.length) return { success: true };
    query = query.in("id", ids);
  }

  const { error } = await query;
  if (error) {
    if (isRecoverableAdminQueryError(error)) return { success: false };
    throw error;
  }

  return { success: true };
}

export async function fetchRiskEventCounts(hoursBack = 24) {
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("risk_event_counts")
    .select("id, organization_id, domain, window_start, failure_count, risk_level, notification_sent, created_at, updated_at")
    .gte("window_start", since)
    .order("window_start", { ascending: false });

  if (error) {
    if (isRecoverableAdminQueryError(error)) return [];
    throw error;
  }

  return data || [];
}

export async function searchAdminWorkspace(search, adminAccess) {
  const term = String(search || "").trim();
  if (!term || !adminAccess?.isAdmin) return [];

  const results = [];
  const scopedUserIds = await fetchScopedUserIds(adminAccess);

  let userQuery = supabase
    .from("profiles")
    .select("id, full_name, email, organization_id")
    .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
    .limit(5);

  if (adminAccess.isOrgAdmin) {
    userQuery = userQuery.eq("organization_id", adminAccess.organizationId);
  }

  const usersResult = await userQuery;
  if (!usersResult.error) {
    (usersResult.data || []).forEach((profile) => {
      results.push({
        type: "user",
        id: profile.id,
        title: profile.full_name || profile.email || "Unnamed user",
        subtitle: profile.email || "User profile",
        path: `/app/admin/users/${profile.id}`,
      });
    });
  }

  let postsQuery = supabase
    .from("posts")
    .select("id, caption, user_id, status, moderation_status, created_at")
    .or(`caption.ilike.%${term}%,delete_reason.ilike.%${term}%`)
    .limit(5);

  if (scopedUserIds?.length) {
    postsQuery = postsQuery.in("user_id", scopedUserIds);
  }

  const postsResult = await postsQuery;
  if (!postsResult.error) {
    (postsResult.data || []).forEach((post) => {
      results.push({
        type: "post",
        id: post.id,
        title: post.caption || "Untitled post",
        subtitle: `${post.status || "draft"}${post.moderation_status ? ` · ${post.moderation_status}` : ""}`,
        path: `/app/admin/moderation?post=${post.id}`,
      });
    });
  }

  const complaintsResult = await supabase
    .from("complaints")
    .select("id, title, subject, status, priority, organization_id, submitted_by_user_id")
    .or(`title.ilike.%${term}%,subject.ilike.%${term}%,description.ilike.%${term}%`)
    .limit(5);

  if (!complaintsResult.error) {
    (complaintsResult.data || []).forEach((complaint) => {
      if (
        adminAccess.isSuperAdmin ||
        complaint.organization_id === adminAccess.organizationId ||
        complaint.submitted_by_user_id === adminAccess.user?.id
      ) {
        results.push({
          type: "complaint",
          id: complaint.id,
          title: complaint.title || complaint.subject || "Untitled complaint",
          subtitle: `${complaint.priority || "normal"} · ${complaint.status || "new"}`,
          path: `/app/admin/complaints/${complaint.id}`,
        });
      }
    });
  }

  return results.slice(0, 12);
}

export async function insertAuditLog(payload) {
  const rpcPayload = buildAuditLogArgs(payload);
  const rpcResult = await supabase.rpc("write_audit_log", rpcPayload);

  if (!rpcResult.error) {
    return { success: true, id: rpcResult.data ?? null };
  }

  if (!isRecoverableAdminQueryError(rpcResult.error)) {
    throw rpcResult.error;
  }

  const { error } = await supabase.from("audit_logs").insert(payload);
  if (error) {
    if (isRecoverableAdminQueryError(error)) return { success: false };
    throw error;
  }
  return { success: true };
}

export async function fetchCountMap(table, userIds, options = {}) {
  const ids = arrayUnique(userIds);
  if (!ids.length) return new Map();

  let query = supabase.from(table).select(options.select || "user_id");

  if (options.filterColumn && options.filterValue !== undefined) {
    query = query.eq(options.filterColumn, options.filterValue);
  }

  query = query.in("user_id", ids);

  const { data, error } = await query;
  if (error) {
    if (isRecoverableAdminQueryError(error)) return new Map();
    throw error;
  }

  const counts = new Map();
  (data || []).forEach((row) => {
    const key = row.user_id;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

export async function fetchConnectedAccountCountMap(userIds) {
  return fetchCountMap("connected_accounts", userIds, { select: "user_id" });
}

export async function fetchGenerationCountMap(userIds) {
  return fetchCountMap("generations", userIds, { select: "user_id" });
}

export async function fetchPostCountMap(userIds) {
  return fetchCountMap("posts", userIds, { select: "user_id" });
}

export async function updateAdminUserStatus(adminAccess, targetUser, options = {}) {
  if (!adminAccess?.isAdmin || !targetUser?.id) {
    throw new Error("Missing admin scope or target user");
  }

  const mode = options.mode || "suspend";
  const suspensionType = mode === "unsuspend" ? null : (options.suspensionType || "full");
  const durationHours = Number(options.durationHours || 0) || null;
  const expiresAt = durationHours ? new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString() : null;
  const patch =
    mode === "unsuspend"
      ? {
          activity_status: "active",
          suspension_type: null,
          suspension_expires_at: null,
        }
      : {
          activity_status: "suspended",
          suspension_type: suspensionType,
          suspension_expires_at: expiresAt,
        };

  const { error } = await supabase.from("profiles").update(patch).eq("id", targetUser.id);
  if (error) throw error;

  await supabase.from("user_status_events").insert({
    user_id: targetUser.id,
    actor_admin_id: adminAccess.user.id,
    event_type: mode === "unsuspend" ? "restriction_lifted" : "suspended",
    reason_code: options.reasonCode || null,
    note: options.note || null,
    suspension_type: suspensionType,
    duration_hours: durationHours,
    expires_at: expiresAt,
  });

  await insertAuditLog({
    actor_id: adminAccess.user.id,
    actor_type: "admin",
    actor_role: adminAccess.adminRole,
    organization_id: targetUser.organization_id || adminAccess.organizationId || null,
    event_category: "admin_action",
    event_type: mode === "unsuspend" ? "admin.unsuspend_user" : "admin.suspend_user",
    entity_type: "user",
    entity_id: targetUser.id,
    summary:
      mode === "unsuspend"
        ? `Lifted restrictions for ${targetUser.full_name || targetUser.email || targetUser.id}`
        : `Suspended ${targetUser.full_name || targetUser.email || targetUser.id}`,
    previous_value: null,
    new_value: patch,
    metadata: {
      reason_code: options.reasonCode || null,
      note: options.note || null,
      duration_hours: durationHours,
    },
    risk_level: "medium",
  });

  return { success: true };
}

export async function sendAdminPasswordReset(adminAccess, targetUser) {
  if (!adminAccess?.isAdmin || !targetUser?.email) {
    throw new Error("Missing admin scope or target email");
  }

  const { error } = await supabase.auth.resetPasswordForEmail(targetUser.email, {
    redirectTo: `${window.location.origin}/login`,
  });

  if (error) throw error;

  await insertAuditLog({
    actor_id: adminAccess.user.id,
    actor_type: "admin",
    actor_role: adminAccess.adminRole,
    organization_id: targetUser.organization_id || adminAccess.organizationId || null,
    event_category: "admin_action",
    event_type: "admin.reset_password",
    entity_type: "user",
    entity_id: targetUser.id,
    summary: `Sent password reset to ${targetUser.email}`,
    metadata: { email: targetUser.email },
    risk_level: "medium",
  });

  return { success: true };
}

export async function requestUserDeletion(adminAccess, targetUser, options = {}) {
  if (!adminAccess?.isAdmin || !targetUser?.id) {
    throw new Error("Missing admin scope or target user");
  }

  const payload = {
    requested_by_admin_id: adminAccess.user.id,
    action_type: "user_deletion",
    target_user_id: targetUser.id,
    target_org_id: targetUser.organization_id || adminAccess.organizationId || null,
    reason_code: options.reasonCode || "other",
    note: options.note || null,
    status: "pending",
    eligibility_checks_passed: true,
    eligibility_check_details: {
      initiated_from: "admin_ui",
      requested_at: new Date().toISOString(),
    },
  };

  const { error } = await supabase.from("admin_action_requests").insert(payload);
  if (error) throw error;

  await supabase
    .from("profiles")
    .update({ deletion_requested_at: new Date().toISOString(), activity_status: "pending_deletion" })
    .eq("id", targetUser.id);

  await insertAuditLog({
    actor_id: adminAccess.user.id,
    actor_type: "admin",
    actor_role: adminAccess.adminRole,
    organization_id: targetUser.organization_id || adminAccess.organizationId || null,
    event_category: "admin_action",
    event_type: "admin.request_user_deletion",
    entity_type: "user",
    entity_id: targetUser.id,
    summary: `Requested deletion approval for ${targetUser.full_name || targetUser.email || targetUser.id}`,
    metadata: payload,
    risk_level: "high",
  });

  return { success: true };
}

export async function updateComplaintRecord(adminAccess, complaintId, patch) {
  if (!adminAccess?.isAdmin || !complaintId) {
    throw new Error("Missing admin scope or complaint id");
  }

  const { data, error } = await supabase.rpc("admin_update_complaint_status", {
    p_complaint_id: complaintId,
    p_status: patch?.status ?? null,
    p_resolution_note: patch?.resolution_note ?? null,
    p_assigned_admin_id: patch?.assigned_admin_id ?? null,
    p_status_note: patch?.status_note ?? null,
  });

  if (error) throw error;
  return data || { success: true };
}

export async function addComplaintComment(adminAccess, complaintId, body, isInternal = false) {
  if (!adminAccess?.isAdmin || !complaintId || !body.trim()) {
    throw new Error("Missing complaint comment data");
  }

  const { error } = await supabase.from("complaint_comments").insert({
    complaint_id: complaintId,
    author_id: adminAccess.user.id,
    author_type: "admin",
    body: body.trim(),
    is_internal: Boolean(isInternal),
  });

  if (error) throw error;

  return { success: true };
}

export async function fetchUserActivityLog(userId, filters = {}) {
  if (!userId) return [];

  let query = supabase
    .from("audit_logs")
    .select("id, actor_id, actor_type, actor_role, event_category, event_type, entity_type, entity_id, summary, metadata, previous_value, new_value, risk_level, created_at")
    .or(`actor_id.eq.${userId},entity_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(100);

  if (filters.eventCategory && filters.eventCategory !== "all") {
    query = query.eq("event_category", filters.eventCategory);
  }

  if (filters.dateFrom) {
    query = query.gte("created_at", filters.dateFrom);
  }

  if (filters.dateTo) {
    query = query.lte("created_at", filters.dateTo);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function fetchUserCalendarPosts(userId) {
  if (!userId) return [];

  const { data, error } = await supabase
    .from("posts")
    .select(`
      id,
      caption,
      status,
      scheduled_at,
      platform,
      generation_id,
      moderation_status,
      created_at,
      generations!generation_id (storage_path, metadata)
    `)
    .eq("user_id", userId)
    .in("status", ["scheduled", "published", "failed", "draft"])
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function sendAdminUserNotification(adminAccess, targetUserId, payload) {
  if (!adminAccess?.isAdmin || !targetUserId) {
    throw new Error("Missing admin scope or target user");
  }

  const { data, error } = await supabase.functions.invoke("admin-notify-user", {
    body: {
      target_user_id: targetUserId,
      ...payload,
    },
  });

  if (error) throw error;
  if (data?.error) {
    throw new Error(data.error);
  }

  return data || { success: true };
}

export async function fetchAdminNotes(targetUserId) {
  if (!targetUserId) return [];

  const { data, error } = await supabase
    .from("admin_notes")
    .select("id, target_user_id, author_admin_id, body, created_at, updated_at")
    .eq("target_user_id", targetUserId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const notes = data || [];
  const authorIds = [...new Set(notes.map((note) => note.author_admin_id).filter(Boolean))];
  if (!authorIds.length) return notes;

  const { data: authors } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .in("id", authorIds);

  const authorMap = new Map((authors || []).map((author) => [author.id, author]));
  return notes.map((note) => ({
    ...note,
    author: authorMap.get(note.author_admin_id) || null,
  }));
}

export async function addAdminNote(adminAccess, targetUser, body) {
  if (!adminAccess?.isAdmin || !targetUser?.id || !String(body || "").trim()) {
    throw new Error("Missing note details");
  }

  const noteBody = String(body).trim();
  const { data, error } = await supabase
    .from("admin_notes")
    .insert({
      target_user_id: targetUser.id,
      author_admin_id: adminAccess.user.id,
      body: noteBody,
    })
    .select("id, target_user_id, author_admin_id, body, created_at, updated_at")
    .single();

  if (error) throw error;

  await insertAuditLog({
    actor_id: adminAccess.user.id,
    actor_type: "admin",
    actor_role: adminAccess.adminRole,
    organization_id: targetUser.organization_id || adminAccess.organizationId || null,
    event_category: "admin_action",
    event_type: "admin_note_added",
    entity_type: "user",
    entity_id: targetUser.id,
    summary: `Internal note added to user ${targetUser.full_name || targetUser.email || targetUser.id}`,
    metadata: {
      note_id: data.id,
    },
    risk_level: null,
  });

  return {
    ...data,
    author: {
      id: adminAccess.user.id,
      full_name: adminAccess.profile?.full_name || adminAccess.user.email || "Admin",
      email: adminAccess.profile?.email || adminAccess.user.email || null,
      avatar_url: adminAccess.profile?.avatar_url || null,
    },
  };
}

export async function updateAdminNote(adminAccess, noteId, targetUser, body) {
  if (!adminAccess?.isAdmin || !noteId || !targetUser?.id || !String(body || "").trim()) {
    throw new Error("Missing note update details");
  }

  const noteBody = String(body).trim();
  const { data, error } = await supabase
    .from("admin_notes")
    .update({
      body: noteBody,
    })
    .eq("id", noteId)
    .select("id, target_user_id, author_admin_id, body, created_at, updated_at")
    .single();

  if (error) throw error;

  await insertAuditLog({
    actor_id: adminAccess.user.id,
    actor_type: "admin",
    actor_role: adminAccess.adminRole,
    organization_id: targetUser.organization_id || adminAccess.organizationId || null,
    event_category: "admin_action",
    event_type: "admin_note_updated",
    entity_type: "user",
    entity_id: targetUser.id,
    summary: `Internal note updated for user ${targetUser.full_name || targetUser.email || targetUser.id}`,
    metadata: {
      note_id: data.id,
    },
    risk_level: null,
  });

  return {
    ...data,
    author: {
      id: adminAccess.user.id,
      full_name: adminAccess.profile?.full_name || adminAccess.user.email || "Admin",
      email: adminAccess.profile?.email || adminAccess.user.email || null,
      avatar_url: adminAccess.profile?.avatar_url || null,
    },
  };
}

export async function deleteAdminNote(adminAccess, note, targetUser) {
  if (!adminAccess?.isAdmin || !note?.id || !targetUser?.id) {
    throw new Error("Missing note deletion details");
  }

  const { error } = await supabase
    .from("admin_notes")
    .delete()
    .eq("id", note.id);

  if (error) throw error;

  await insertAuditLog({
    actor_id: adminAccess.user.id,
    actor_type: "admin",
    actor_role: adminAccess.adminRole,
    organization_id: targetUser.organization_id || adminAccess.organizationId || null,
    event_category: "admin_action",
    event_type: "admin_note_deleted",
    entity_type: "user",
    entity_id: targetUser.id,
    summary: `Internal note deleted for user ${targetUser.full_name || targetUser.email || targetUser.id}`,
    metadata: {
      note_id: note.id,
    },
    risk_level: "low",
  });

  return { success: true };
}

export async function updateAdminPostSchedule(adminAccess, post, scheduledAt) {
  if (!adminAccess?.isAdmin || !post?.id || !scheduledAt) {
    throw new Error("Missing scheduling details");
  }

  const nextScheduledAt = new Date(scheduledAt).toISOString();
  const nextStatus = post.status === "published" ? "published" : "scheduled";
  const previousValue = {
    scheduled_at: post.scheduled_at || null,
    status: post.status || null,
  };

  const { data, error } = await supabase
    .from("posts")
    .update({
      scheduled_at: nextScheduledAt,
      status: nextStatus,
    })
    .eq("id", post.id)
    .select("id, scheduled_at, status")
    .single();

  if (error) throw error;

  await insertAuditLog({
    actor_id: adminAccess.user.id,
    actor_type: "admin",
    actor_role: adminAccess.adminRole,
    organization_id: adminAccess.organizationId || null,
    event_category: "admin_action",
    event_type: "post_edited",
    entity_type: "post",
    entity_id: post.id,
    summary: `Updated scheduled time for post ${post.id}`,
    previous_value: previousValue,
    new_value: {
      scheduled_at: data.scheduled_at,
      status: data.status,
    },
    metadata: {
      source: "admin_user_calendar",
    },
    risk_level: "low",
  });

  return data;
}

export { inferActivityStatus, isMissingRelationError, isRecoverableAdminQueryError };
