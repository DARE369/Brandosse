import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { findAuthUserByEmail } from "../_shared/auth-users.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { createHttpError, normalizeOrgRole, toLegacyMembershipRole, upsertLastUsedContext } from "../_shared/org.ts";
import { ensureOrganizationBootstrap } from "../_shared/org-bootstrap.ts";

type AcceptInvitationRequest = {
  invitation_token: string;
  preview?: boolean;
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
    const body = await parseJsonBody<AcceptInvitationRequest>(req);
    const invitationToken = String(body.invitation_token || "").trim();
    const preview = Boolean(body.preview);
    const authHeader = req.headers.get("Authorization");
    const authClient = authHeader ? createAuthClient(authHeader) : null;
    const user = authClient ? await requireUser(authClient) : null;

    if (!invitationToken) {
      throw createHttpError("Missing invitation token.", 400);
    }

    const { data: invitation, error: invitationError } = await adminClient
      .from("org_invitations")
      .select("*")
      .eq("invitation_token", invitationToken)
      .maybeSingle();

    if (invitationError) throw invitationError;
    if (!invitation) throw createHttpError("Invitation not found.", 404);

    const { data: organization, error: organizationError } = await adminClient
      .from("organizations")
      .select("id, name, slug, plan, plan_key, settings")
      .eq("id", invitation.organization_id)
      .maybeSingle();

    if (organizationError) throw organizationError;

    const invitationState = getInvitationState(invitation);
    const existingAuthUser = invitation.email
      ? await findAuthUserByEmail(adminClient, invitation.email)
      : null;
    const resolvedInvitedUserId = invitation.invited_user_id || existingAuthUser?.id || null;
    const emailMatches = user
      ? (!invitation.email || !user.email
        ? true
        : invitation.email.toLowerCase() === user.email.toLowerCase())
      : null;
    const requiresPasswordSetup = user && emailMatches
      ? false
      : !resolvedInvitedUserId && Boolean(invitation.requires_password_setup);

    if (preview) {
      return jsonResponse({
        invitation_state: invitationState,
        organization_id: invitation.organization_id,
        organization_name: organization?.name || "Organization",
        organization_slug: organization?.slug || null,
        plan_key: organization?.plan_key || organization?.plan || "organization",
        email: invitation.email,
        role: invitation.role || "contributor",
        requires_password_setup: requiresPasswordSetup,
        email_matches_session: emailMatches,
        can_accept: invitationState === "pending" && Boolean(emailMatches),
        requires_sign_in: invitationState === "pending" && !requiresPasswordSetup && !user,
        onboarding_url: `/join?token=${invitation.invitation_token}`,
      });
    }

    if (!authClient || !user) {
      throw createHttpError("Unauthorized", 401);
    }

    if (invitationState !== "pending") {
      throw createHttpError(
        invitationState === "expired"
          ? "Invitation has expired."
          : "Invitation is no longer active.",
        400,
      );
    }

    if (!emailMatches) {
      throw createHttpError("Invitation email does not match the signed-in account.", 403);
    }

    let bootstrapResult = null;
    if ((invitation.role || "").toLowerCase() === "org_owner") {
      bootstrapResult = await ensureOrganizationBootstrap(adminClient, {
        organizationId: invitation.organization_id,
        ownerUserId: user.id,
        planKey: organization?.plan_key || organization?.plan || "organization",
        orgName: organization?.name || "Organization",
        activateOwnerMembership: true,
      });
    }

    const now = new Date().toISOString();
    const acceptedRole = normalizeOrgRole({ org_role_key: invitation.role || "contributor" } as any);
    const { error: membershipError } = await adminClient
      .from("organization_members")
      .upsert(
        {
          organization_id: invitation.organization_id,
          user_id: user.id,
          role: toLegacyMembershipRole(acceptedRole),
          org_role_key: acceptedRole,
          status: "active",
          invited_by: invitation.invited_by,
          invited_at: invitation.created_at || now,
          joined_at: now,
          brand_project_ids: Array.isArray(invitation.brand_project_ids)
            ? invitation.brand_project_ids
            : null,
        },
        { onConflict: "organization_id,user_id" },
      );

    if (membershipError) throw membershipError;

    if ((invitation.role || "").toLowerCase() === "org_owner") {
      const { data: liveOrganization, error: liveOrganizationError } = await adminClient
        .from("organizations")
        .select("settings")
        .eq("id", invitation.organization_id)
        .maybeSingle();

      if (liveOrganizationError) throw liveOrganizationError;

      const { error: ownerUpdateError } = await adminClient
        .from("organizations")
        .update({
          owner_id: user.id,
          owner_user_id: user.id,
          settings: {
            ...((liveOrganization?.settings && typeof liveOrganization.settings === "object" && !Array.isArray(liveOrganization.settings))
              ? liveOrganization.settings
              : {}),
            pending_owner_email: invitation.email || user.email || null,
            owner_invitation_status: "accepted",
            owner_invitation_last_error: null,
            owner_invitation_last_attempt_at: now,
          },
        })
        .eq("id", invitation.organization_id);

      if (ownerUpdateError) throw ownerUpdateError;
    }

    const { data: defaultBrandProject, error: defaultBrandProjectError } = await adminClient
      .from("brand_projects")
      .select("id")
      .eq("organization_id", invitation.organization_id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (defaultBrandProjectError) throw defaultBrandProjectError;

    const { error: invitationUpdateError } = await adminClient
      .from("org_invitations")
      .update({
        status: "accepted",
        accepted_at: now,
        accepted_by: user.id,
        invited_user_id: user.id,
        requires_password_setup: false,
      })
      .eq("id", invitation.id);

    if (invitationUpdateError) throw invitationUpdateError;

    await upsertLastUsedContext(
      adminClient,
      user.id,
      invitation.organization_id,
      defaultBrandProject?.id || bootstrapResult?.default_brand_project_id || null,
    );

    const redirectTo = `/app/org/${invitation.organization_id}/${["org_owner", "org_admin"].includes(acceptedRole) ? "overview" : "workspace"}`;

    return jsonResponse({
      organization_id: invitation.organization_id,
      brand_project_id: defaultBrandProject?.id || bootstrapResult?.default_brand_project_id || null,
      accepted: true,
      role: acceptedRole,
      redirect_to: redirectTo,
    });
  } catch (error) {
    console.error("[org-accept-invitation] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
