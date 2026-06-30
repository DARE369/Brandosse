import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";

type NotificationSeverity = "low" | "medium" | "high" | "very_high";

type NotifyAdminEventPayload = {
  type: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  target_admin_id?: string | null;
};

const ALLOWED_TYPES = new Set([
  "risk_alert",
  "complaint_submitted",
  "complaint_stale",
  "moderation_backlog",
  "user_signup_spike",
  "deletion_requested",
  "admin_action_failed",
  "publishing_worker_stalled",
  "scope_drift_detected",
  "content_auto_flagged",
  "org_created",
  "system",
]);

const ALLOWED_SEVERITIES = new Set(["low", "medium", "high", "very_high"]);

function normalizeSeverity(value: string | null | undefined): NotificationSeverity {
  const normalized = String(value || "low").trim().toLowerCase();
  if (normalized === "medium" || normalized === "high" || normalized === "very_high") {
    return normalized;
  }
  return "low";
}

function buildDedupeKey(type: string, metadata: Record<string, unknown>, targetAdminId: string | null): string | null {
  const explicit = metadata.dedupe_key;
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.trim();
  }

  const entityId =
    metadata.entity_id ??
    metadata.complaint_id ??
    metadata.user_id ??
    metadata.organization_id ??
    targetAdminId;

  if (typeof entityId === "string" && entityId.trim()) {
    return `${type}:${entityId.trim()}`;
  }

  return null;
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const authClient = createAuthClient(req.headers.get("Authorization"));
    const adminClient = createAdminClient();
    const actor = await requireUser(authClient);
    const payload = await parseJsonBody<NotifyAdminEventPayload>(req);

    const type = String(payload?.type || "").trim();
    const severity = normalizeSeverity(payload?.severity);
    const title = String(payload?.title || "").trim();
    const body = String(payload?.body || "").trim();
    const metadata = payload?.metadata && typeof payload.metadata === "object"
      ? { ...payload.metadata }
      : {};
    const targetAdminId = payload?.target_admin_id ? String(payload.target_admin_id).trim() : null;

    if (!type || !ALLOWED_TYPES.has(type)) {
      throw new Error("Invalid notification type");
    }
    if (!ALLOWED_SEVERITIES.has(severity)) {
      throw new Error("Invalid notification severity");
    }
    if (!title || !body) {
      throw new Error("Missing notification title or body");
    }

    const { data: isAdmin, error: isAdminError } = await authClient.rpc("is_admin_user", {
      p_user_id: actor.id,
    });
    if (isAdminError) throw isAdminError;

    let organizationId: string | null =
      typeof metadata.organization_id === "string" && metadata.organization_id.trim()
        ? metadata.organization_id.trim()
        : null;

    if (type === "complaint_submitted") {
      const complaintId =
        typeof metadata.complaint_id === "string" && metadata.complaint_id.trim()
          ? metadata.complaint_id.trim()
          : null;

      if (!complaintId) {
        throw new Error("Complaint submission notifications require metadata.complaint_id");
      }

      const { data: complaint, error: complaintError } = await adminClient
        .from("complaints")
        .select("id, organization_id, submitted_by_user_id")
        .eq("id", complaintId)
        .maybeSingle();

      if (complaintError) throw complaintError;
      if (!complaint) throw new Error("Complaint not found");
      if (complaint.submitted_by_user_id !== actor.id && !isAdmin) {
        throw new Error("Forbidden");
      }

      organizationId = complaint.organization_id || organizationId;
    } else if (!isAdmin) {
      throw new Error("Forbidden");
    }

    if (isAdmin && organizationId) {
      const { data: canAccessOrg, error: canAccessOrgError } = await authClient.rpc("can_admin_access_organization", {
        p_admin_id: actor.id,
        p_org_id: organizationId,
      });
      if (canAccessOrgError) throw canAccessOrgError;
      if (!canAccessOrg) throw new Error("Forbidden");
    }

    const dedupeKey = buildDedupeKey(type, metadata, targetAdminId);
    if (dedupeKey) {
      let existingQuery = adminClient
        .from("admin_notifications")
        .select("id, created_at")
        .eq("notification_type", type)
        .filter("metadata->>dedupe_key", "eq", dedupeKey)
        .gte("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle();

      existingQuery = targetAdminId
        ? existingQuery.eq("recipient_admin_id", targetAdminId)
        : existingQuery.is("recipient_admin_id", null);

      const { data: existingNotification, error: existingError } = await existingQuery;
      if (existingError) throw existingError;
      if (existingNotification) {
        return jsonResponse({
          success: true,
          inserted: false,
          deduplicated: true,
          notification_id: existingNotification.id,
        });
      }
    }

    const metadataWithDedupe = dedupeKey ? { ...metadata, dedupe_key: dedupeKey } : metadata;

    const { data: notification, error: insertError } = await adminClient
      .from("admin_notifications")
      .insert({
        recipient_admin_id: targetAdminId,
        notification_type: type,
        severity,
        title,
        body,
        metadata: metadataWithDedupe,
        organization_id: organizationId,
        is_read: false,
      })
      .select("id, created_at")
      .single();

    if (insertError) throw insertError;

    const { data: adminRole } = isAdmin
      ? await adminClient.from("admin_roles").select("role").eq("user_id", actor.id).maybeSingle()
      : { data: null };

    await adminClient.rpc("write_audit_log", {
      p_actor_id: actor.id,
      p_actor_type: isAdmin ? "admin" : "user",
      p_actor_role: adminRole?.role || null,
      p_organization_id: organizationId,
      p_event_category: isAdmin ? "admin_action" : "user_action",
      p_event_type: "admin_notification_dispatched",
      p_entity_type: "admin_notification",
      p_entity_id: notification.id,
      p_summary: `Dispatched admin notification: ${type}`,
      p_previous_value: null,
      p_new_value: {
        type,
        severity,
        title,
        target_admin_id: targetAdminId,
      },
      p_metadata: metadataWithDedupe,
      p_risk_level: severity === "very_high" ? "high" : severity === "high" ? "medium" : "low",
      p_correlation_id: null,
      p_ip_address: null,
      p_user_agent: req.headers.get("user-agent"),
    });

    return jsonResponse({
      success: true,
      inserted: true,
      notification_id: notification.id,
    });
  } catch (error) {
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
