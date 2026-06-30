import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { createHttpError, requireOrgAdminOrSuperAdmin } from "../_shared/org.ts";

type RevokeInvitationRequest = {
  invitation_id: string;
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
    const body = await parseJsonBody<RevokeInvitationRequest>(req);
    const invitationId = String(body.invitation_id || "").trim();

    if (!invitationId) {
      throw createHttpError("Missing invitation id.", 400);
    }

    const { data: invitation, error: invitationError } = await adminClient
      .from("org_invitations")
      .select("id, organization_id, email, role, status, invitation_token")
      .eq("id", invitationId)
      .maybeSingle();

    if (invitationError) throw invitationError;
    if (!invitation) throw createHttpError("Invitation not found.", 404);

    await requireOrgAdminOrSuperAdmin(adminClient, invitation.organization_id, user.id);

    if (invitation.status === "accepted") {
      throw createHttpError("Accepted invitations cannot be revoked.", 400);
    }

    if (invitation.status !== "revoked") {
      const { error: updateError } = await adminClient
        .from("org_invitations")
        .update({ status: "revoked" })
        .eq("id", invitation.id);

      if (updateError) throw updateError;
    }

    await adminClient.rpc("write_audit_log", {
      p_actor_id: user.id,
      p_actor_type: "admin",
      p_actor_role: null,
      p_organization_id: invitation.organization_id,
      p_event_category: "admin_action",
      p_event_type: "org_invitation_revoked",
      p_entity_type: "org_invitation",
      p_entity_id: invitation.id,
      p_summary: `Organization invitation revoked for ${invitation.email}`,
      p_previous_value: null,
      p_new_value: null,
      p_metadata: {
        invitation_id: invitation.id,
        invitation_token: invitation.invitation_token,
        email: invitation.email,
        role: invitation.role,
      },
      p_risk_level: null,
      p_correlation_id: null,
      p_ip_address: null,
      p_user_agent: req.headers.get("user-agent"),
    });

    return jsonResponse({
      invitation_id: invitation.id,
      status: "revoked",
    });
  } catch (error) {
    console.error("[org-revoke-invitation] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
