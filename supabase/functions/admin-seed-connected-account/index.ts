import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { createHttpError, isSuperAdminUser } from "../_shared/org.ts";
import { insertConnectionEvent, requireServiceRole } from "../_shared/connectionHelpers.ts";

type SeedConnectedAccountRequest = {
  target_user_id: string;
  scope?: "personal" | "organization";
  platform: string;
  organization_id?: string | null;
  brand_project_id?: string | null;
  display_name?: string | null;
  username?: string | null;
  profile_type?: string | null;
  follower_count?: number | null;
  account_category?: string | null;
  profile_picture_url?: string | null;
  connection_status?: string | null;
  health_score?: number | null;
  consecutive_failure_count?: number | null;
  last_failure_reason?: string | null;
};

function normalizeUsername(value: string | null | undefined, platform: string) {
  const cleaned = String(value || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .toLowerCase();

  return cleaned || `${platform}_${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
}

function normalizeConnectionStatus(value: string | null | undefined) {
  const normalized = String(value || "active").trim().toLowerCase();
  if (["active", "mock", "expired", "error", "reconnecting", "revoked", "disconnected"].includes(normalized)) {
    return normalized;
  }
  return "active";
}

function buildAvatarUrl(platform: string, username: string) {
  return `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(`${platform}-${username}`)}`;
}

function isServiceRoleRequest(req: Request) {
  return req.headers.get("Authorization") === `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""}`;
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    let actorId = "service-role";
    let actorType = "service_role";

    if (isServiceRoleRequest(req)) {
      requireServiceRole(req);
    } else {
      const authClient = createAuthClient(req.headers.get("Authorization"));
      const user = await requireUser(authClient);
      const adminClient = createAdminClient();
      const superAdmin = await isSuperAdminUser(adminClient, user.id);
      if (!superAdmin) {
        throw createHttpError("Unauthorized", 401);
      }
      actorId = user.id;
      actorType = "user";
    }

    const adminClient = createAdminClient();
    const body = await parseJsonBody<SeedConnectedAccountRequest>(req);

    const targetUserId = String(body.target_user_id || "").trim();
    const scope = body.scope === "organization" ? "organization" : "personal";
    const platform = String(body.platform || "").trim().toLowerCase();
    const organizationId = body.organization_id || null;
    const brandProjectId = body.brand_project_id || null;

    if (!targetUserId) throw createHttpError("target_user_id is required", 400);
    if (!platform) throw createHttpError("platform is required", 400);
    if (scope === "organization" && !organizationId) {
      throw createHttpError("organization_id is required for organization accounts", 400);
    }

    const { data: platformRow, error: platformError } = await adminClient
      .from("platform_registry")
      .select("*")
      .eq("platform_key", platform)
      .maybeSingle();

    if (platformError) throw platformError;
    if (!platformRow) throw createHttpError("Unsupported platform", 400);

    if (scope === "organization") {
      const { data: member, error: memberError } = await adminClient
        .from("organization_members")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("user_id", targetUserId)
        .eq("status", "active")
        .maybeSingle();

      if (memberError) throw memberError;
      if (!member) {
        throw createHttpError("Target user is not an active member of the organization", 400);
      }
    }

    const username = normalizeUsername(body.username, platform);
    const displayName = String(body.display_name || username).trim() || username;
    const token = `mock_${platform}_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const tokenExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const connectionStatus = normalizeConnectionStatus(body.connection_status);
    const profilePictureUrl = String(body.profile_picture_url || "").trim() || buildAvatarUrl(platform, username);
    const followerCount = Number(body.follower_count ?? Math.floor(Math.random() * 50000) + 1000);
    const healthScore = Number(body.health_score ?? 100);
    const consecutiveFailureCount = Number(body.consecutive_failure_count ?? 0);

    const { data: inserted, error: insertError } = await adminClient
      .from("connected_accounts")
      .insert({
        user_id: targetUserId,
        platform,
        scope,
        organization_id: scope === "organization" ? organizationId : null,
        brand_project_id: brandProjectId,
        account_name: displayName,
        display_name: displayName,
        account_id: `${platform}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
        username,
        avatar_url: profilePictureUrl,
        profile_picture_url: profilePictureUrl,
        access_token: connectionStatus === "revoked" || connectionStatus === "disconnected" ? null : token,
        token_expires_at: tokenExpiresAt,
        scopes: platformRow.supported_content_types || [],
        connection_status: connectionStatus,
        profile_type: body.profile_type || (platformRow.supported_profile_types?.[0] ?? "Business"),
        follower_count: Number.isFinite(followerCount) ? followerCount : 0,
        account_category: body.account_category || null,
        is_mock: true,
        mock_token: connectionStatus === "revoked" || connectionStatus === "disconnected" ? null : token,
        last_token_refresh: new Date().toISOString(),
        last_token_refresh_at: new Date().toISOString(),
        health_score: Number.isFinite(healthScore) ? healthScore : 100,
        consecutive_failure_count: Number.isFinite(consecutiveFailureCount) ? consecutiveFailureCount : 0,
        last_failure_reason: body.last_failure_reason || null,
        last_failure_at: body.last_failure_reason ? new Date().toISOString() : null,
        platform_metadata: {
          mock: true,
          seeded_by: actorId,
          seeded_by_type: actorType,
          supported_content_types: platformRow.supported_content_types || [],
        },
      })
      .select("*")
      .single();

    if (insertError) throw insertError;

    await insertConnectionEvent(adminClient, {
      connectedAccountId: inserted.id,
      userId: targetUserId,
      organizationId: inserted.organization_id,
      eventType: "connected",
      platform,
      severity: "info",
      message: `${displayName} seeded as a mock ${platformRow.display_name} account`,
      metadata: {
        seeded: true,
        seeded_by: actorId,
        scope,
      },
    });

    return jsonResponse({
      success: true,
      connected_account: inserted,
    });
  } catch (error) {
    console.error("[admin-seed-connected-account] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
