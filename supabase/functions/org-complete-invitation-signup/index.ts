import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { findAuthUserByEmail, inferNameFromEmail } from "../_shared/auth-users.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { createHttpError } from "../_shared/org.ts";
import { createAdminClient } from "../_shared/supabase.ts";

type CompleteInvitationSignupRequest = {
  invitation_token: string;
  password: string;
  password_confirm: string;
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
    const adminClient = createAdminClient();
    const body = await parseJsonBody<CompleteInvitationSignupRequest>(req);
    const invitationToken = String(body.invitation_token || "").trim();
    const password = String(body.password || "");
    const passwordConfirm = String(body.password_confirm || "");

    if (!invitationToken) {
      throw createHttpError("Missing invitation token.", 400);
    }

    if (password.length < 10) {
      throw createHttpError("Choose a password with at least 10 characters.", 400);
    }

    if (password !== passwordConfirm) {
      throw createHttpError("The password confirmation does not match.", 400);
    }

    const { data: invitation, error: invitationError } = await adminClient
      .from("org_invitations")
      .select("id, email, status, expires_at, invited_user_id, requires_password_setup")
      .eq("invitation_token", invitationToken)
      .maybeSingle();

    if (invitationError) throw invitationError;
    if (!invitation) throw createHttpError("Invitation not found.", 404);

    const invitationState = getInvitationState(invitation);
    if (invitationState !== "pending") {
      throw createHttpError(
        invitationState === "expired"
          ? "Invitation has expired."
          : "Invitation is no longer active.",
        400,
      );
    }

    const invitationEmail = String(invitation.email || "").trim().toLowerCase();
    if (!invitationEmail) {
      throw createHttpError("Invitation email is missing.", 400);
    }

    const existingUser = await findAuthUserByEmail(adminClient, invitationEmail);
    if (existingUser?.id) {
      const { error: invitationUpdateError } = await adminClient
        .from("org_invitations")
        .update({
          invited_user_id: existingUser.id,
          requires_password_setup: false,
        })
        .eq("id", invitation.id);

      if (invitationUpdateError) throw invitationUpdateError;

      return jsonResponse({
        email: invitationEmail,
        created_user_id: existingUser.id,
        account_exists: true,
        requires_sign_in: true,
      });
    }

    const createdUserResult = await adminClient.auth.admin.createUser({
      email: invitationEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: inferNameFromEmail(invitationEmail),
      },
    });

    if (createdUserResult.error) throw createdUserResult.error;

    const createdUserId = createdUserResult.data.user?.id || null;
    if (!createdUserId) {
      throw createHttpError("Unable to provision the invited user.", 500);
    }

    const { error: profileError } = await adminClient
      .from("profiles")
      .upsert(
        {
          id: createdUserId,
          full_name: inferNameFromEmail(invitationEmail),
          email: invitationEmail,
          role: "user",
          credits: 100,
          status: "active",
        },
        { onConflict: "id" },
      );

    if (profileError) throw profileError;

    const { error: invitationUpdateError } = await adminClient
      .from("org_invitations")
      .update({
        invited_user_id: createdUserId,
        requires_password_setup: false,
      })
      .eq("id", invitation.id);

    if (invitationUpdateError) throw invitationUpdateError;

    return jsonResponse({
      email: invitationEmail,
      created_user_id: createdUserId,
      account_exists: false,
      requires_sign_in: true,
    });
  } catch (error) {
    console.error("[org-complete-invitation-signup] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
