import { readEnv } from "./env.ts";
import type { DatabaseClient } from "./supabase.ts";

export type ConnectionEventPayload = {
  connectedAccountId: string;
  userId: string;
  organizationId?: string | null;
  eventType: string;
  platform: string;
  severity?: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
  isSimulatedFailure?: boolean;
};

export function requireServiceRole(req: Request) {
  const expected = `Bearer ${readEnv("SUPABASE_SERVICE_ROLE_KEY")}`;
  if (req.headers.get("Authorization") !== expected) {
    throw new Error("Unauthorized");
  }
}

export function normalizeConnectionStatus(status: string | null | undefined) {
  return String(status || "active").trim().toLowerCase() || "active";
}

export function isConnectedStatus(status: string | null | undefined) {
  const normalized = normalizeConnectionStatus(status);
  return normalized === "active" || normalized === "mock" || normalized === "connected";
}

export function buildMockPostId(platform: string) {
  const prefixMap: Record<string, string> = {
    instagram: "IG_POST",
    tiktok: "TT_POST",
    youtube: "YT_POST",
    facebook: "FB_POST",
    linkedin: "LI_POST",
    twitter: "X_POST",
    pinterest: "PIN_POST",
    threads: "THR_POST",
  };

  return `${prefixMap[String(platform || "").toLowerCase()] || "POST"}_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export function buildMockPostUrl(platform: string, mockPostId: string, username?: string | null) {
  const key = String(platform || "").trim().toLowerCase();
  const account = String(username || "socialai").replace(/^@+/, "");

  switch (key) {
    case "instagram":
      return `https://instagram.com/${account}/p/${mockPostId.toLowerCase()}`;
    case "tiktok":
      return `https://www.tiktok.com/@${account}/video/${mockPostId.toLowerCase()}`;
    case "youtube":
      return `https://www.youtube.com/watch?v=${mockPostId.toLowerCase()}`;
    case "facebook":
      return `https://facebook.com/${account}/posts/${mockPostId.toLowerCase()}`;
    case "linkedin":
      return `https://www.linkedin.com/feed/update/${mockPostId.toLowerCase()}`;
    case "twitter":
      return `https://x.com/${account}/status/${mockPostId.toLowerCase()}`;
    case "pinterest":
      return `https://www.pinterest.com/pin/${mockPostId.toLowerCase()}`;
    case "threads":
      return `https://www.threads.net/@${account}/post/${mockPostId.toLowerCase()}`;
    default:
      return `https://socialai.mock/${key || "platform"}/${mockPostId.toLowerCase()}`;
  }
}

export async function insertConnectionEvent(
  adminClient: DatabaseClient,
  payload: ConnectionEventPayload,
) {
  const { error } = await adminClient
    .from("connection_events")
    .insert({
      connected_account_id: payload.connectedAccountId,
      user_id: payload.userId,
      organization_id: payload.organizationId || null,
      event_type: payload.eventType,
      platform: payload.platform,
      severity: payload.severity || "info",
      message: payload.message || null,
      metadata: payload.metadata || {},
      is_simulated_failure: Boolean(payload.isSimulatedFailure),
    });

  if (error) {
    throw error;
  }
}

export function pickFailureReason(consecutiveFailureCount = 0) {
  const thresholdBoost = consecutiveFailureCount >= 3 ? 20 : 0;
  const roll = Math.floor(Math.random() * 100);
  const adjusted = Math.min(99, roll + thresholdBoost);

  if (adjusted < 70) {
    return {
      success: true,
      retriable: false,
      reason: null,
      severity: "info",
      nextStatus: "active",
    };
  }

  if (adjusted < 85) {
    return {
      success: false,
      retriable: true,
      reason: adjusted % 2 === 0 ? "network_timeout" : "server_busy",
      severity: "warning",
      nextStatus: "active",
    };
  }

  if (adjusted < 95) {
    return {
      success: false,
      retriable: false,
      reason: adjusted % 2 === 0 ? "invalid_media_type" : "rate_limit_exceeded",
      severity: "error",
      nextStatus: "error",
    };
  }

  return {
    success: false,
    retriable: false,
    reason: adjusted % 2 === 0 ? "account_suspended" : "api_unavailable",
    severity: "critical",
    nextStatus: "error",
  };
}
