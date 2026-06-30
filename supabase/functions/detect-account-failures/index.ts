import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, toErrorPayload } from "../_shared/http.ts";
import { insertConnectionEvent, requireServiceRole } from "../_shared/connectionHelpers.ts";

async function hasOpenAlert(adminClient: ReturnType<typeof createAdminClient>, accountId: string, alertType: string) {
  const { data, error } = await adminClient
    .from("account_severity_alerts")
    .select("id")
    .eq("connected_account_id", accountId)
    .eq("alert_type", alertType)
    .eq("is_resolved", false)
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    requireServiceRole(req);

    const adminClient = createAdminClient();
    const now = Date.now();
    const sevenDaysAgoIso = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysFromNowIso = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: scheduledPosts, error: scheduledError } = await adminClient
      .from("posts")
      .select("id, account_id, user_id, organization_id")
      .eq("status", "scheduled")
      .not("account_id", "is", null);

    if (scheduledError) throw scheduledError;

    const accountIdsWithScheduledPosts = [...new Set((scheduledPosts || []).map((row) => row.account_id).filter(Boolean))];

    let silentAccountsProcessed = 0;
    if (accountIdsWithScheduledPosts.length > 0) {
      const { data: accounts, error: accountsError } = await adminClient
        .from("connected_accounts")
        .select("*")
        .in("id", accountIdsWithScheduledPosts)
        .not("connection_status", "in", '("revoked","disconnected")');

      if (accountsError) throw accountsError;

      for (const account of accounts || []) {
        const stalePublish = !account.last_successful_publish_at || account.last_successful_publish_at < sevenDaysAgoIso;
        if (!stalePublish) continue;

        const alertExists = await hasOpenAlert(adminClient, account.id, "health_check_fail");
        if (alertExists) continue;

        const representativePost = (scheduledPosts || []).find((row) => row.account_id === account.id);

        const { error: alertError } = await adminClient
          .from("account_severity_alerts")
          .insert({
            connected_account_id: account.id,
            user_id: account.scope === "personal" ? account.user_id : null,
            organization_id: account.organization_id,
            severity: "warning",
            alert_type: "health_check_fail",
            platform: account.platform,
            account_display_name: account.display_name || account.account_name || account.username || account.platform,
            failure_count: Number(account.consecutive_failure_count || 0),
            message: `${account.display_name || account.account_name || account.username || account.platform} has scheduled posts but no successful publish activity in the last 7 days.`,
          });

        if (alertError) throw alertError;

        await insertConnectionEvent(adminClient, {
          connectedAccountId: account.id,
          userId: representativePost?.user_id || account.user_id,
          organizationId: account.organization_id,
          eventType: "health_check_fail",
          platform: account.platform,
          severity: "warning",
          message: "Detected stale connected account activity while scheduled posts are pending.",
          metadata: {
            check_type: "silent_account",
          },
        });

        silentAccountsProcessed += 1;
      }
    }

    const { data: expiringAccounts, error: expiringError } = await adminClient
      .from("connected_accounts")
      .select("*")
      .not("connection_status", "in", '("revoked","disconnected")')
      .not("token_expires_at", "is", null)
      .lte("token_expires_at", sevenDaysFromNowIso);

    if (expiringError) throw expiringError;

    let expiringAccountsProcessed = 0;
    for (const account of expiringAccounts || []) {
      const alertExists = await hasOpenAlert(adminClient, account.id, "token_expired");
      if (alertExists) continue;

      const { error: alertError } = await adminClient
        .from("account_severity_alerts")
        .insert({
          connected_account_id: account.id,
          user_id: account.scope === "personal" ? account.user_id : null,
          organization_id: account.organization_id,
          severity: "warning",
          alert_type: "token_expired",
          platform: account.platform,
          account_display_name: account.display_name || account.account_name || account.username || account.platform,
          failure_count: Number(account.consecutive_failure_count || 0),
          message: `${account.display_name || account.account_name || account.username || account.platform} token expires soon and should be refreshed.`,
        });

      if (alertError) throw alertError;

      await insertConnectionEvent(adminClient, {
        connectedAccountId: account.id,
        userId: account.user_id,
        organizationId: account.organization_id,
        eventType: "token_expired",
        platform: account.platform,
        severity: "warning",
        message: "Detected an account token that expires within the next 7 days.",
        metadata: {
          token_expires_at: account.token_expires_at,
          check_type: "token_expiry",
        },
      });

      expiringAccountsProcessed += 1;
    }

    return jsonResponse({
      success: true,
      silentAccountsProcessed,
      expiringAccountsProcessed,
    });
  } catch (error) {
    console.error("[detect-account-failures] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
