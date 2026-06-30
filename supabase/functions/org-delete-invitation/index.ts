import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { createHttpError, requireOrgAdminOrSuperAdmin } from "../_shared/org.ts";

type DeleteInvitationRequest = {
  invitation_id: string;
};

function getInvitationState(invitation: any) {
  if (!invitation) return "missing";
  if (invitation.status !== "pending") return invitation.status;
  if (invitation.expires_at && new Date(invitation.expires_at).getTime() < Date.now()) return "expired";
  return "pending";
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
    const body = await parseJsonBody<DeleteInvitationRequest>(req);
    const invitationId = String(body.invitation_id || "").trim();

    if (!invitationId) {
      throw createHttpError("Missing invitation id.", 400);
    }

    const { data: invitation, error: invitationError } = await adminClient
      .from("org_invitations")
      .select("id, organization_id, email, role, status, expires_at, invitation_token")
      .eq("id", invitationId)
      .maybeSingle();

    if (invitationError) throw invitationError;
    if (!invitation) throw createHttpError("Invitation not found.", 404);

    await requireOrgAdminOrSuperAdmin(adminClient, invitation.organization_id, user.id);

    const invitationState = getInvitationState(invitation);
    if (!["revoked", "expired"].includes(invitationState)) {
      throw createHttpError("Only revoked or expired invitations can be deleted.", 400);
    }

    await adminClient.rpc("write_audit_log", {
      p_actor_id: user.id,
      p_actor_type: "admin",
      p_actor_role: null,
      p_organization_id: invitation.organization_id,
      p_event_category: "admin_action",
      p_event_type: "org_invitation_deleted",
      p_entity_type: "org_invitation",
      p_entity_id: invitation.id,
      p_summary: `Organization invitation deleted for ${invitation.email}`,
      p_previous_value: null,
      p_new_value: null,
      p_metadata: {
        invitation_id: invitation.id,
        invitation_token: invitation.invitation_token,
        email: invitation.email,
        role: invitation.role,
        invitation_state: invitationState,
      },
      p_risk_level: null,
      p_correlation_id: null,
      p_ip_address: null,
      p_user_agent: req.headers.get("user-agent"),
    });

    const { error: deleteError } = await adminClient
      .from("org_invitations")
      .delete()
      .eq("id", invitation.id);

    if (deleteError) throw deleteError;

    return jsonResponse({
      invitation_id: invitation.id,
      deleted: true,
      state: invitationState,
    });
  } catch (error) {
    console.error("[org-delete-invitation] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
