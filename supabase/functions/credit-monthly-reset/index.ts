import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, toErrorPayload } from "../_shared/http.ts";

function nextResetDate() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey) {
      return jsonResponse({ error: "Server misconfigured" }, 500);
    }
    if (!authHeader || authHeader !== `Bearer ${serviceKey}`) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const adminClient = createAdminClient();
    const resetDate = nextResetDate();

    const { error: organizationError } = await adminClient
      .from("organizations")
      .update({
        credits_used_this_period: 0,
        credit_reset_date: resetDate,
      })
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (organizationError) throw organizationError;

    const { error: memberError } = await adminClient
      .from("organization_members")
      .update({
        credits_used_this_period: 0,
      })
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (memberError) throw memberError;

    const { error: auditError } = await adminClient
      .from("audit_logs")
      .insert({
        actor_id: null,
        actor_type: "system",
        actor_role: "service_role",
        organization_id: null,
        event_category: "credit_transaction",
        event_type: "credit_monthly_reset",
        entity_type: "organization",
        entity_id: "all",
        summary: `Monthly org credits reset executed. Next reset date: ${resetDate}.`,
        previous_value: null,
        new_value: {
          credits_used_this_period: 0,
          credit_reset_date: resetDate,
        },
        metadata: {
          source: "credit-monthly-reset",
          reset_date: resetDate,
        },
        risk_level: "medium",
        correlation_id: null,
        ip_address: null,
        user_agent: "supabase-cron",
      });
    if (auditError) throw auditError;

    return jsonResponse({
      reset: true,
      next_reset_date: resetDate,
    });
  } catch (error) {
    console.error("[credit-monthly-reset] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
