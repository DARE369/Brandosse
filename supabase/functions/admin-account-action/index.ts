import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { createHttpError, insertUserNotification, isSuperAdminUser } from "../_shared/org.ts";
import { insertConnectionEvent, normalizeConnectionStatus } from "../_shared/connectionHelpers.ts";

type AdminAccountAction =
  | "force_reconnect"
  | "clear_failures"
  | "reset_health"
  | "force_disconnect"
  | "resolve_alert"
  | "support_note"
  | "set_member_access";

type AdminAccountActionRequest = {
  action: AdminAccountAction;
  connected_account_id?: string | null;
  alert_id?: string | null;
  reason?: string | null;
  granted_member_ids?: string[] | null;
  grant_all?: boolean | null;
};

function normalizeMemberIds(memberIds: string[] | null | undefined) {
  return [...new Set(
    (Array.isArray(memberIds) ? memberIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
}

function buildNotificationActionUrl(account: Record<string, unknown>) {
  const organizationId = String(account.organization_id || "").trim();
  if (organizationId) {
    return `/app/org/${organizationId}/admin/settings`;
  }
  return "/app/settings";
}

async function fetchAccount(adminClient: ReturnType<typeof createAdminClient>, accountId: string) {
  const { data, error } = await adminClient
    .from("connected_accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw createHttpError("connected_account_not_found", 404);
  return data;
}

async function fetchAlert(adminClient: ReturnType<typeof createAdminClient>, alertId: string) {
  const { data, error } = await adminClient
    .from("account_severity_alerts")
    .select("*")
    .eq("id", alertId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw createHttpError("account_alert_not_found", 404);
  return data;
}

async function insertAdminAccountAction(
  adminClient: ReturnType<typeof createAdminClient>,
  payload: {
    adminUserId: string;
    targetConnectedAccountId: string;
    targetUserId?: string | null;
    targetOrganizationId?: string | null;
    action: string;
    notes?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const { data, error } = await adminClient
    .from("admin_account_actions")
    .insert({
      admin_user_id: payload.adminUserId,
      target_connected_account_id: payload.targetConnectedAccountId,
      target_user_id: payload.targetUserId || null,
      target_organization_id: payload.targetOrganizationId || null,
      action: payload.action,
      notes: payload.notes || null,
      metadata: payload.metadata || {},
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

async function resolveOpenAlerts(
  adminClient: ReturnType<typeof createAdminClient>,
  connectedAccountId: string,
  resolvedBy: string,
  note: string,
) {
  const now = new Date().toISOString();
  const { data: rows, error } = await adminClient
    .from("account_severity_alerts")
    .update({
      is_resolved: true,
      resolved_at: now,
      resolved_by: resolvedBy,
      resolution_note: note,
    })
    .eq("connected_account_id", connectedAccountId)
    .eq("is_resolved", false)
    .select("id");

  if (error) throw error;
  return Array.isArray(rows) ? rows.length : 0;
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authClient = createAuthClient(req.headers.get("Authorization"));
    const user = await requireUser(authClient);
    const adminClient = createAdminClient();

    if (!await isSuperAdminUser(adminClient, user.id)) {
      throw createHttpError("Unauthorized", 401);
    }

    const body = await parseJsonBody<AdminAccountActionRequest>(req);
    const action = String(body.action || "").trim().toLowerCase() as AdminAccountAction;
    const accountId = String(body.connected_account_id || "").trim();
    const alertId = String(body.alert_id || "").trim();
    const note = String(body.reason || "").trim();

    if (!action) {
      throw createHttpError("action is required", 400);
    }

    let account = accountId ? await fetchAccount(adminClient, accountId) : null;
    let resolvedAlert = null;
    let adminAction = null;
    let alertsResolvedCount = 0;

    if (!account && action !== "resolve_alert") {
      throw createHttpError("connected_account_id is required", 400);
    }

    switch (action) {
      case "force_reconnect": {
        if (!account) throw createHttpError("connected_account_id is required", 400);

        const token = `mock_${String(account.platform || "platform")}_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
        const tokenExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
        const updatedPayload = {
          access_token: token,
          mock_token: token,
          token_expires_at: tokenExpiresAt,
          connection_status: "active",
          health_score: 100,
          consecutive_failure_count: 0,
          last_failure_at: null,
          last_failure_reason: null,
          last_token_refresh: new Date().toISOString(),
          last_token_refresh_at: new Date().toISOString(),
        };

        const { data, error } = await adminClient
          .from("connected_accounts")
          .update(updatedPayload)
          .eq("id", account.id)
          .select("*")
          .single();

        if (error) throw error;
        account = data;

        adminAction = await insertAdminAccountAction(adminClient, {
          adminUserId: user.id,
          targetConnectedAccountId: account.id,
          targetUserId: account.user_id,
          targetOrganizationId: account.organization_id,
          action: "force_reconnect",
          notes: note || "Forced mock reconnect from the super admin accounts console.",
          metadata: {
            token_expires_at: tokenExpiresAt,
          },
        });

        await insertConnectionEvent(adminClient, {
          connectedAccountId: account.id,
          userId: account.user_id,
          organizationId: account.organization_id,
          eventType: "admin_force_reconnect",
          platform: account.platform,
          severity: "info",
          message: `${account.display_name || account.account_name || account.username || account.platform} was refreshed by support`,
          metadata: {
            admin_user_id: user.id,
            reason: note || null,
          },
        });

        alertsResolvedCount = await resolveOpenAlerts(
          adminClient,
          account.id,
          user.id,
          note || "Resolved automatically after a forced reconnect.",
        );

        await insertUserNotification(adminClient, {
          userId: account.user_id,
          organizationId: account.organization_id,
          sentByAdminId: user.id,
          type: "system",
          title: "Connected account refreshed",
          body: `Your ${account.platform} connection was refreshed by support.`,
          actionUrl: buildNotificationActionUrl(account),
          dedupeKey: `admin_account_action:${action}:${account.id}:${Date.now()}`,
          metadata: {
            connected_account_id: account.id,
            action,
          },
        });
        break;
      }

      case "clear_failures": {
        if (!account) throw createHttpError("connected_account_id is required", 400);

        const currentStatus = normalizeConnectionStatus(account.connection_status);
        const nextStatus = ["revoked", "disconnected"].includes(currentStatus) ? currentStatus : "active";

        const { data, error } = await adminClient
          .from("connected_accounts")
          .update({
            connection_status: nextStatus,
            consecutive_failure_count: 0,
            health_score: Math.max(70, Number(account.health_score || 0)),
            last_failure_at: null,
            last_failure_reason: null,
          })
          .eq("id", account.id)
          .select("*")
          .single();

        if (error) throw error;
        account = data;

        adminAction = await insertAdminAccountAction(adminClient, {
          adminUserId: user.id,
          targetConnectedAccountId: account.id,
          targetUserId: account.user_id,
          targetOrganizationId: account.organization_id,
          action: "clear_failures",
          notes: note || "Failure counters cleared by support.",
        });

        await insertConnectionEvent(adminClient, {
          connectedAccountId: account.id,
          userId: account.user_id,
          organizationId: account.organization_id,
          eventType: "admin_clear_failures",
          platform: account.platform,
          severity: "info",
          message: `${account.display_name || account.account_name || account.username || account.platform} failure counters were cleared by support`,
          metadata: {
            admin_user_id: user.id,
            reason: note || null,
          },
        });

        alertsResolvedCount = await resolveOpenAlerts(
          adminClient,
          account.id,
          user.id,
          note || "Resolved after clearing failure counters.",
        );
        break;
      }

      case "reset_health": {
        if (!account) throw createHttpError("connected_account_id is required", 400);

        const { data, error } = await adminClient
          .from("connected_accounts")
          .update({
            health_score: 100,
          })
          .eq("id", account.id)
          .select("*")
          .single();

        if (error) throw error;
        account = data;

        adminAction = await insertAdminAccountAction(adminClient, {
          adminUserId: user.id,
          targetConnectedAccountId: account.id,
          targetUserId: account.user_id,
          targetOrganizationId: account.organization_id,
          action: "reset_health",
          notes: note || "Health score reset by support.",
        });

        await insertConnectionEvent(adminClient, {
          connectedAccountId: account.id,
          userId: account.user_id,
          organizationId: account.organization_id,
          eventType: "admin_reset_health",
          platform: account.platform,
          severity: "info",
          message: `${account.display_name || account.account_name || account.username || account.platform} health score was reset by support`,
          metadata: {
            admin_user_id: user.id,
            reason: note || null,
          },
        });
        break;
      }

      case "force_disconnect": {
        if (!account) throw createHttpError("connected_account_id is required", 400);

        const { data, error } = await adminClient
          .from("connected_accounts")
          .update({
            connection_status: "revoked",
            access_token: null,
            mock_token: null,
            token_expires_at: null,
          })
          .eq("id", account.id)
          .select("*")
          .single();

        if (error) throw error;
        account = data;

        adminAction = await insertAdminAccountAction(adminClient, {
          adminUserId: user.id,
          targetConnectedAccountId: account.id,
          targetUserId: account.user_id,
          targetOrganizationId: account.organization_id,
          action: "force_disconnect",
          notes: note || "Disconnected by support from the accounts console.",
        });

        await insertConnectionEvent(adminClient, {
          connectedAccountId: account.id,
          userId: account.user_id,
          organizationId: account.organization_id,
          eventType: "admin_force_disconnect",
          platform: account.platform,
          severity: "warning",
          message: `${account.display_name || account.account_name || account.username || account.platform} was disconnected by support`,
          metadata: {
            admin_user_id: user.id,
            reason: note || null,
          },
        });

        alertsResolvedCount = await resolveOpenAlerts(
          adminClient,
          account.id,
          user.id,
          note || "Resolved after a support disconnect.",
        );

        await insertUserNotification(adminClient, {
          userId: account.user_id,
          organizationId: account.organization_id,
          sentByAdminId: user.id,
          type: "system",
          title: "Connected account disconnected",
          body: `Your ${account.platform} connection was disconnected by support.`,
          actionUrl: buildNotificationActionUrl(account),
          dedupeKey: `admin_account_action:${action}:${account.id}:${Date.now()}`,
          metadata: {
            connected_account_id: account.id,
            action,
          },
        });
        break;
      }

      case "resolve_alert": {
        if (!alertId) throw createHttpError("alert_id is required", 400);
        const alert = await fetchAlert(adminClient, alertId);
        const now = new Date().toISOString();

        const { data, error } = await adminClient
          .from("account_severity_alerts")
          .update({
            is_resolved: true,
            resolved_at: now,
            resolved_by: user.id,
            resolution_note: note || "Resolved from the super admin accounts console.",
          })
          .eq("id", alert.id)
          .select("*")
          .single();

        if (error) throw error;
        resolvedAlert = data;

        if (!account && alert.connected_account_id) {
          account = await fetchAccount(adminClient, alert.connected_account_id);
        }

        adminAction = await insertAdminAccountAction(adminClient, {
          adminUserId: user.id,
          targetConnectedAccountId: alert.connected_account_id,
          targetUserId: alert.user_id,
          targetOrganizationId: alert.organization_id,
          action: "resolve_alert",
          notes: note || "Resolved from the connected accounts console.",
          metadata: {
            alert_id: alert.id,
            severity: alert.severity,
            alert_type: alert.alert_type,
          },
        });

        if (account) {
          await insertConnectionEvent(adminClient, {
            connectedAccountId: account.id,
            userId: account.user_id,
            organizationId: account.organization_id,
            eventType: "admin_resolve_alert",
            platform: account.platform,
            severity: "info",
            message: `${account.display_name || account.account_name || account.username || account.platform} alert was resolved by support`,
            metadata: {
              admin_user_id: user.id,
              alert_id: alert.id,
              reason: note || null,
            },
          });
        }
        break;
      }

      case "support_note": {
        if (!account) throw createHttpError("connected_account_id is required", 400);
        if (!note) throw createHttpError("reason is required for support_note", 400);

        adminAction = await insertAdminAccountAction(adminClient, {
          adminUserId: user.id,
          targetConnectedAccountId: account.id,
          targetUserId: account.user_id,
          targetOrganizationId: account.organization_id,
          action: "support_note",
          notes: note,
        });
        break;
      }

      case "set_member_access": {
        if (!account) throw createHttpError("connected_account_id is required", 400);
        if (String(account.scope || "") !== "organization") {
          throw createHttpError("member_access_requires_org_account", 400);
        }

        const currentMemberIds = normalizeMemberIds(account.granted_member_ids as string[] | null | undefined);
        const nextMemberIds = body.grant_all ? [] : normalizeMemberIds(body.granted_member_ids);
        const addedMemberIds = nextMemberIds.filter((memberId) => !currentMemberIds.includes(memberId));
        const removedMemberIds = currentMemberIds.filter((memberId) => !nextMemberIds.includes(memberId));
        const adminActionName = addedMemberIds.length > 0 || body.grant_all
          ? "grant_member_access"
          : "revoke_member_access";

        const { data, error } = await adminClient
          .from("connected_accounts")
          .update({
            granted_member_ids: nextMemberIds,
          })
          .eq("id", account.id)
          .select("*")
          .single();

        if (error) throw error;
        account = data;

        adminAction = await insertAdminAccountAction(adminClient, {
          adminUserId: user.id,
          targetConnectedAccountId: account.id,
          targetUserId: account.user_id,
          targetOrganizationId: account.organization_id,
          action: adminActionName,
          notes: note || "Shared account member access updated by support.",
          metadata: {
            grant_all: Boolean(body.grant_all),
            granted_member_ids: nextMemberIds,
            added_member_ids: addedMemberIds,
            removed_member_ids: removedMemberIds,
          },
        });
        break;
      }

      default:
        throw createHttpError("unsupported_admin_account_action", 400);
    }

    return jsonResponse({
      success: true,
      connected_account: account,
      resolved_alert: resolvedAlert,
      admin_action: adminAction,
      alerts_resolved_count: alertsResolvedCount,
    });
  } catch (error) {
    console.error("[admin-account-action] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
