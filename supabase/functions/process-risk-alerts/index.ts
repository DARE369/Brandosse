import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import { readEnv } from "../_shared/env.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, toErrorPayload } from "../_shared/http.ts";

type RiskLevel = "none" | "low" | "medium" | "high" | "very_high";

type AuditLogRow = {
  id: string;
  event_type: string;
  organization_id: string | null;
  created_at: string;
  risk_level: string | null;
};

type ComplaintRow = {
  id: string;
  title: string | null;
  subject: string | null;
  organization_id: string | null;
  created_at: string;
};

const DOMAIN_PATTERNS: Record<string, string[]> = {
  content_generation: ["generation_failed", "generation_error", "generation_timeout"],
  post_publishing: ["post_failed", "publish_failed", "publish_error", "publish_timeout"],
  post_scheduling: ["schedule_failed", "schedule_write_error"],
  oauth_connection: ["oauth_failed", "oauth_error", "connection_failed", "platform_connection_broken"],
  profile_provisioning: ["profile_creation_failed", "signup_profile_error"],
  moderation_action: ["force_publish_failed", "force_schedule_failed", "moderation_error"],
  admin_auth: ["admin_login_failed", "admin_access_denied"],
  edge_function: ["edge_function_error", "edge_function_timeout"],
  realtime_subscription: ["realtime_error", "subscription_dropped"],
  file_upload: ["upload_failed", "storage_write_error"],
};

const DOMAIN_LABELS: Record<string, string> = {
  content_generation: "Content Generation",
  post_publishing: "Post Publishing",
  post_scheduling: "Post Scheduling",
  oauth_connection: "Platform Connections",
  profile_provisioning: "User Onboarding",
  moderation_action: "Moderation Actions",
  admin_auth: "Admin Authentication",
  edge_function: "Backend Functions",
  realtime_subscription: "Real-time Updates",
  file_upload: "File Uploads",
};

const RISK_LEVEL_RANK: Record<string, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  very_high: 4,
};

function requireServiceRole(req: Request) {
  const expected = `Bearer ${readEnv("SUPABASE_SERVICE_ROLE_KEY")}`;
  if (req.headers.get("Authorization") !== expected) {
    throw new Error("Unauthorized");
  }
}

function localRiskLevel(failureCount: number): RiskLevel {
  if (failureCount >= 12) return "very_high";
  if (failureCount >= 10) return "high";
  if (failureCount >= 6) return "medium";
  if (failureCount >= 3) return "low";
  return "none";
}

function resolveDomain(eventType: string | null | undefined): string | null {
  const normalized = String(eventType || "").trim().toLowerCase();
  if (!normalized) return null;

  for (const [domain, patterns] of Object.entries(DOMAIN_PATTERNS)) {
    if (patterns.includes(normalized)) {
      return domain;
    }
  }

  return null;
}

function severityRank(level: string | null | undefined): number {
  return RISK_LEVEL_RANK[String(level || "none").toLowerCase()] || 0;
}

async function computeRiskLevel(adminClient: ReturnType<typeof createAdminClient>, count: number): Promise<RiskLevel> {
  const fallback = localRiskLevel(count);
  const { data, error } = await adminClient.rpc("get_risk_level", { failure_count: count });

  if (error || !data) {
    return fallback;
  }

  const normalized = String(data).trim().toLowerCase();
  if (normalized === "none" || normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "very_high") {
    return normalized as RiskLevel;
  }

  return fallback;
}

async function upsertRiskSignal(params: {
  adminClient: ReturnType<typeof createAdminClient>;
  domain: string;
  organizationId: string | null;
  failureCount: number;
  sampleLogIds: string[];
  windowStartIso: string;
}) {
  const {
    adminClient,
    domain,
    organizationId,
    failureCount,
    sampleLogIds,
    windowStartIso,
  } = params;

  const riskLevel = await computeRiskLevel(adminClient, failureCount);

  await adminClient.from("risk_event_counts").insert({
    organization_id: organizationId,
    domain,
    window_start: windowStartIso,
    failure_count: failureCount,
    risk_level: riskLevel,
    notification_sent: riskLevel !== "none",
  });

  if (riskLevel === "none") {
    return { insertedNotification: false, riskLevel };
  }

  const dedupeKey = `risk_alert:${organizationId || "platform"}:${domain}`;
  let existingQuery = adminClient
    .from("admin_notifications")
    .select("id, severity, created_at")
    .eq("notification_type", "risk_alert")
    .filter("metadata->>dedupe_key", "eq", dedupeKey)
    .gte("created_at", windowStartIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  existingQuery = organizationId
    ? existingQuery.eq("organization_id", organizationId)
    : existingQuery.is("organization_id", null);

  const { data: existingNotification, error: existingError } = await existingQuery;
  if (existingError) {
    throw existingError;
  }

  if (existingNotification && severityRank(existingNotification.severity) >= severityRank(riskLevel)) {
    return { insertedNotification: false, riskLevel };
  }

  await adminClient.from("admin_notifications").insert({
    recipient_admin_id: null,
    notification_type: "risk_alert",
    severity: riskLevel,
    domain,
    title: `Risk Alert: ${DOMAIN_LABELS[domain] || domain} failures detected`,
    body: `${failureCount} failures in the last 2 hours`,
    metadata: {
      dedupe_key: dedupeKey,
      domain,
      count: failureCount,
      window_start: windowStartIso,
      risk_level: riskLevel,
      sample_log_ids: sampleLogIds.slice(0, 5),
    },
    organization_id: organizationId,
    is_read: false,
  });

  return { insertedNotification: true, riskLevel };
}

async function processStaleComplaints(adminClient: ReturnType<typeof createAdminClient>) {
  const staleBeforeIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const dedupeSinceIso = staleBeforeIso;

  const { data: complaints, error } = await adminClient
    .from("complaints")
    .select("id, title, subject, organization_id, created_at")
    .eq("status", "submitted")
    .lt("created_at", staleBeforeIso)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  const complaintGroups = new Map<string, ComplaintRow[]>();

  (complaints || []).forEach((complaint) => {
    const groupKey = complaint.organization_id || "platform";
    const current = complaintGroups.get(groupKey) || [];
    current.push(complaint);
    complaintGroups.set(groupKey, current);
  });

  let inserted = 0;

  for (const [groupKey, rows] of complaintGroups.entries()) {
    const organizationId = groupKey === "platform" ? null : groupKey;
    const dedupeKey = `complaint_stale:${groupKey}`;

    let existingQuery = adminClient
      .from("admin_notifications")
      .select("id")
      .eq("notification_type", "complaint_stale")
      .filter("metadata->>dedupe_key", "eq", dedupeKey)
      .gte("created_at", dedupeSinceIso)
      .limit(1)
      .maybeSingle();

    existingQuery = organizationId
      ? existingQuery.eq("organization_id", organizationId)
      : existingQuery.is("organization_id", null);

    const { data: existingNotification, error: existingError } = await existingQuery;
    if (existingError) {
      throw existingError;
    }

    if (existingNotification) {
      continue;
    }

    await adminClient.from("admin_notifications").insert({
      recipient_admin_id: null,
      notification_type: "complaint_stale",
      severity: "medium",
      title: "Support tickets need review",
      body: `${rows.length} complaint${rows.length === 1 ? "" : "s"} have been waiting for more than 24 hours`,
      metadata: {
        dedupe_key: dedupeKey,
        count: rows.length,
        complaint_ids: rows.map((row) => row.id),
      },
      organization_id: organizationId,
      is_read: false,
    });

    inserted += 1;
  }

  return inserted;
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    requireServiceRole(req);

    const adminClient = createAdminClient();
    const windowStartIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const allPatterns = [...new Set(Object.values(DOMAIN_PATTERNS).flat())];

    const { data: logs, error: logsError } = await adminClient
      .from("audit_logs")
      .select("id, event_type, organization_id, created_at, risk_level")
      .gte("created_at", windowStartIso)
      .in("event_type", allPatterns)
      .order("created_at", { ascending: false });

    if (logsError) {
      throw logsError;
    }

    const groupedLogs = new Map<string, { domain: string; organizationId: string | null; count: number; sampleLogIds: string[] }>();

    (logs || []).forEach((log: AuditLogRow) => {
      const domain = resolveDomain(log.event_type);
      if (!domain) return;

      const key = `${domain}::${log.organization_id || "platform"}`;
      const current = groupedLogs.get(key) || {
        domain,
        organizationId: log.organization_id,
        count: 0,
        sampleLogIds: [],
      };

      current.count += 1;
      if (current.sampleLogIds.length < 5) {
        current.sampleLogIds.push(log.id);
      }

      groupedLogs.set(key, current);
    });

    let insertedRiskNotifications = 0;
    const riskSummaries: Array<{ domain: string; organization_id: string | null; risk_level: RiskLevel; failure_count: number }> = [];

    for (const group of groupedLogs.values()) {
      const result = await upsertRiskSignal({
        adminClient,
        domain: group.domain,
        organizationId: group.organizationId,
        failureCount: group.count,
        sampleLogIds: group.sampleLogIds,
        windowStartIso,
      });

      if (result.insertedNotification) {
        insertedRiskNotifications += 1;
      }

      riskSummaries.push({
        domain: group.domain,
        organization_id: group.organizationId,
        risk_level: result.riskLevel,
        failure_count: group.count,
      });
    }

    const insertedStaleNotifications = await processStaleComplaints(adminClient);

    return jsonResponse({
      success: true,
      processed_log_count: (logs || []).length,
      risk_groups: riskSummaries,
      inserted_risk_notifications: insertedRiskNotifications,
      inserted_stale_complaint_notifications: insertedStaleNotifications,
    });
  } catch (error) {
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
