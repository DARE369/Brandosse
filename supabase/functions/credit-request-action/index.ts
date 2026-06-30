import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import {
  createHttpError,
  insertUserNotification,
  requireOrgAdmin,
  resolveMemberCreditLimit,
} from "../_shared/org.ts";

type CreditRequestAction = {
  credit_request_id: string;
  action: "approve" | "deny" | "partial";
  amount_approved?: number;
  admin_note?: string;
};

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
    const body = await parseJsonBody<CreditRequestAction>(req);

    if (!body.credit_request_id || !body.action) {
      throw createHttpError("Missing credit request action details.", 400);
    }

    const { data: creditRequest, error: requestError } = await adminClient
      .from("credit_requests")
      .select("*")
      .eq("id", body.credit_request_id)
      .maybeSingle();

    if (requestError) throw requestError;
    if (!creditRequest) throw createHttpError("credit_request_not_found", 404);

    await requireOrgAdmin(adminClient, creditRequest.organization_id, user.id);

    const action = body.action === "deny" ? "denied" : body.action;
    const amountApproved = body.action === "approve"
      ? Number(body.amount_approved || creditRequest.amount_requested || 0)
      : body.action === "partial"
        ? Number(body.amount_approved || 0)
        : 0;

    if ((body.action === "approve" || body.action === "partial") && amountApproved <= 0) {
      throw createHttpError("A positive approved amount is required.", 400);
    }

    const { error: requestUpdateError } = await adminClient
      .from("credit_requests")
      .update({
        status: action,
        amount_approved: amountApproved || null,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        admin_note: body.admin_note || null,
      })
      .eq("id", creditRequest.id);

    if (requestUpdateError) throw requestUpdateError;

    if (amountApproved > 0) {
      const { data: member, error: memberError } = await adminClient
        .from("organization_members")
        .select("id, organization_id, user_id, role, org_role_key, status, permissions, credits_used_this_period, brand_project_ids")
        .eq("organization_id", creditRequest.organization_id)
        .eq("user_id", creditRequest.requested_by)
        .maybeSingle();

      if (memberError) throw memberError;

      if (member) {
        const currentLimit = await resolveMemberCreditLimit(adminClient, creditRequest.organization_id, member);
        const nextLimit = Number(currentLimit || 0) + amountApproved;
        const nextPermissions = {
          ...(member.permissions && typeof member.permissions === "object" ? member.permissions : {}),
          monthly_credit_limit: nextLimit,
        };

        const { error: memberUpdateError } = await adminClient
          .from("organization_members")
          .update({
            permissions: nextPermissions,
          })
          .eq("id", member.id);

        if (memberUpdateError) throw memberUpdateError;
      }
    }

    try {
      await insertUserNotification(adminClient, {
        userId: creditRequest.requested_by,
        organizationId: creditRequest.organization_id,
        sentByAdminId: user.id,
        type: action === "denied" ? "credit_request_denied" : "credit_request_approved",
        title: action === "denied" ? "Credit request denied" : "Credit request updated",
        body: action === "denied"
          ? "Your credit request was denied."
          : `Your credit request was approved for ${amountApproved} credits.`,
        metadata: {
          credit_request_id: creditRequest.id,
          amount_approved: amountApproved,
          action,
        },
      });
    } catch (notificationError) {
      console.warn("[credit-request-action] notification warning", notificationError);
    }

    return jsonResponse({
      credit_request_id: creditRequest.id,
      status: action,
      amount_approved: amountApproved,
    });
  } catch (error) {
    console.error("[credit-request-action] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
