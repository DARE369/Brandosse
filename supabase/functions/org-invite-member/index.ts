import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { findAuthUserByEmail } from "../_shared/auth-users.ts";
import {
  createHttpError,
  insertUserNotification,
  normalizeOrgRole,
  requireOrgAdminOrSuperAdmin,
} from "../_shared/org.ts";
import { ensureOrganizationBootstrap } from "../_shared/org-bootstrap.ts";
import { readEnv } from "../_shared/env.ts";
import { sendTransactionalEmail } from "../_shared/mail.ts";

type InviteRequest = {
  organization_id: string;
  email: string;
  role: string;
  brand_project_ids?: string[];
  bootstrap_organization?: boolean;
  plan_key?: "organization" | "agency";
  org_name?: string;
  app_url?: string;
  delivery_mode?: "manual_link" | "email" | "hybrid";
};

function buildJoinUrl(appUrl: string, invitationToken: string) {
  const normalizedAppUrl = appUrl.replace(/\/+$/, "");
  return `${normalizedAppUrl}/join?token=${invitationToken}`;
}

function getRequestAppUrl(value: string | undefined) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.origin;
    }
  } catch (_error) {
    return "";
  }

  return "";
}

function getOrganizationSettings(settings: unknown) {
  return settings && typeof settings === "object" && !Array.isArray(settings)
    ? { ...(settings as Record<string, unknown>) }
    : {};
}

function normalizeDeliveryMode(
  value: string | undefined,
  fallback: "manual_link" | "email" | "hybrid",
) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["manual_link", "email", "hybrid"].includes(normalized)) {
    return normalized as "manual_link" | "email" | "hybrid";
  }
  return fallback;
}

async function updateOrganizationInviteState(
  adminClient: ReturnType<typeof createAdminClient>,
  organizationId: string,
  patch: Record<string, unknown>,
) {
  const { data: organizationRow, error: organizationReadError } = await adminClient
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle();

  if (organizationReadError) throw organizationReadError;

  const { error } = await adminClient
    .from("organizations")
    .update({
      settings: {
        ...getOrganizationSettings(organizationRow?.settings),
        ...patch,
      },
    })
    .eq("id", organizationId);

  if (error) throw error;
}

async function writeInvitationAuditLog(
  adminClient: ReturnType<typeof createAdminClient>,
  req: Request,
  payload: {
    actorId: string;
    actorRole: string | null;
    organizationId: string;
    organizationName: string;
    ownerEmail: string;
    eventType: string;
    summary: string;
    invitationId?: string | null;
    invitedUserId?: string | null;
    requiresPasswordSetup?: boolean;
    emailDispatched?: boolean | null;
    errorMessage?: string | null;
    riskLevel?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await adminClient.rpc("write_audit_log", {
    p_actor_id: payload.actorId,
    p_actor_type: "admin",
    p_actor_role: payload.actorRole,
    p_organization_id: payload.organizationId,
    p_event_category: "admin_action",
    p_event_type: payload.eventType,
    p_entity_type: "organization",
    p_entity_id: payload.organizationId,
    p_summary: payload.summary,
    p_previous_value: null,
    p_new_value: null,
    p_metadata: {
      organization_name: payload.organizationName,
      owner_email: payload.ownerEmail,
      invitation_id: payload.invitationId || null,
      invited_user_id: payload.invitedUserId || null,
      requires_password_setup: payload.requiresPasswordSetup ?? null,
      email_dispatched: payload.emailDispatched ?? null,
      delivery_status: payload.metadata?.delivery_status ?? null,
      error_message: payload.errorMessage || null,
      ...(payload.metadata || {}),
    },
    p_risk_level: payload.riskLevel || null,
    p_correlation_id: null,
    p_ip_address: null,
    p_user_agent: req.headers.get("user-agent"),
  });
}

async function sendInvitationEmail({
  to,
  subject,
  headline,
  body,
  ctaLabel,
  ctaUrl,
  mode,
}: {
  to: string;
  subject: string;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  mode: "manual_link" | "email" | "hybrid";
}) {
  const html = `
    <div style="font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;padding:32px;">
      <div style="max-width:560px;margin:0 auto;background:#111827;border:1px solid #334155;border-radius:18px;padding:32px;">
        <p style="margin:0 0 12px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#94a3b8;">SocialAI</p>
        <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;color:#f8fafc;">${headline}</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#cbd5e1;">${body}</p>
        <a href="${ctaUrl}" style="display:inline-block;padding:14px 20px;border-radius:12px;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:700;">${ctaLabel}</a>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#94a3b8;">If the button does not open, use this link:<br /><a href="${ctaUrl}" style="color:#a5b4fc;">${ctaUrl}</a></p>
      </div>
    </div>
  `;

  return sendTransactionalEmail({
    to,
    subject,
    html,
    text: `${headline}\n\n${body}\n\n${ctaLabel}: ${ctaUrl}`,
    mode,
  });
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
    const body = await parseJsonBody<InviteRequest>(req);

    const organizationId = String(body.organization_id || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "contributor").trim().toLowerCase();
    const brandProjectIds = Array.isArray(body.brand_project_ids) ? body.brand_project_ids.filter(Boolean) : null;
    const bootstrapOrganization = Boolean(body.bootstrap_organization);
    const deliveryMode = normalizeDeliveryMode(
      body.delivery_mode,
      "manual_link",
    );
    const trackOwnerInvite = role === "org_owner";

    if (!organizationId || !email) {
      return jsonResponse({ error: "Missing invitation details" }, 400);
    }

    const accessScope = await requireOrgAdminOrSuperAdmin(adminClient, organizationId, user.id);
    const actorRole = String(
      accessScope?.role
        || accessScope?.org_role_key
        || accessScope?.legacyRole
        || "super_admin",
    );

    const { data: organization, error: organizationError } = await adminClient
      .from("organizations")
      .select("id, name, plan, plan_key, settings")
      .eq("id", organizationId)
      .maybeSingle();

    if (organizationError) throw organizationError;
    if (!organization) return jsonResponse({ error: "organization_not_found" }, 404);

    const { data: roleTemplates, error: roleTemplateError } = await adminClient
      .from("org_role_templates")
      .select("role_key")
      .eq("organization_id", organizationId);

    if (roleTemplateError) throw roleTemplateError;

    const validRoles = new Set(
      (roleTemplates || [])
        .map((entry) => String(entry.role_key || "").trim().toLowerCase())
        .filter(Boolean),
    );

    const allowBootstrapOwnerRole = role === "org_owner" && bootstrapOrganization;
    if (!validRoles.has(role) && !allowBootstrapOwnerRole) {
      return jsonResponse({ error: "Invalid organization role" }, 400);
    }

    const appUrl = getRequestAppUrl(body.app_url)
      || readEnv("APP_URL", false)
      || readEnv("SITE_URL", false)
      || readEnv("PUBLIC_APP_URL", false)
      || "";

    if (!appUrl) {
      throw createHttpError("Missing APP_URL for organization invitation flow. Set the APP_URL secret or provide a valid app_url.", 500);
    }

    await writeInvitationAuditLog(adminClient, req, {
      actorId: user.id,
      actorRole,
      organizationId,
      organizationName: organization.name,
      ownerEmail: email,
      eventType: "org_invitation_requested",
      summary: `Organization invitation requested for ${email}`,
      riskLevel: null,
      metadata: {
        role,
        delivery_mode: deliveryMode,
      },
    });

    try {
      const existingUser = await findAuthUserByEmail(adminClient, email);
      const invitedUserId = existingUser?.id || null;
      const requiresPasswordSetup = !invitedUserId;

      const { error: revokePendingError } = await adminClient
        .from("org_invitations")
        .update({ status: "revoked" })
        .eq("organization_id", organizationId)
        .eq("email", email)
        .eq("status", "pending");

      if (revokePendingError) throw revokePendingError;

      const { data: invitation, error: invitationError } = await adminClient
        .from("org_invitations")
        .insert({
          organization_id: organizationId,
          email,
          role,
          brand_project_ids: brandProjectIds,
          invited_by: user.id,
          invited_user_id: invitedUserId,
          requires_password_setup: requiresPasswordSetup,
        })
        .select("id, invitation_token, expires_at, requires_password_setup, invited_user_id")
        .single();

      if (invitationError) throw invitationError;

      const onboardingUrl = buildJoinUrl(appUrl, invitation.invitation_token);

      let organizationBootstrap = null;
      if (bootstrapOrganization && role === "org_owner" && invitedUserId) {
        organizationBootstrap = await ensureOrganizationBootstrap(adminClient, {
          organizationId,
          ownerUserId: invitedUserId,
          planKey: body.plan_key || organization.plan_key || organization.plan || "organization",
          orgName: body.org_name || organization.name,
          activateOwnerMembership: false,
        });
      }

      const subject = requiresPasswordSetup
        ? `Complete your ${organization.name} onboarding`
        : `Accept your invitation to ${organization.name}`;
      const headline = requiresPasswordSetup
        ? `Join ${organization.name}`
        : `You've been invited to join ${organization.name}`;
      const bodyCopy = requiresPasswordSetup
        ? `Use the onboarding link below to create your password and enter ${organization.name} as ${role.replace(/_/g, " ")}.`
        : `Use the onboarding link below to sign in and accept your invitation to ${organization.name} as ${role.replace(/_/g, " ")}.`;

      const emailDelivery = await sendInvitationEmail({
        to: email,
        subject,
        headline,
        body: bodyCopy,
        ctaLabel: requiresPasswordSetup ? "Open onboarding" : "Accept invitation",
        ctaUrl: onboardingUrl,
        mode: deliveryMode,
      });

      const emailDispatched = emailDelivery.delivered;
      const deliveryStatus = emailDelivery.status;
      const deliveryReason = emailDelivery.reason;
      const deliveryFailed = deliveryStatus === "failed_provider_error";
      const auditEventType = emailDispatched
        ? "org_invitation_sent"
        : deliveryFailed
          ? "org_invitation_delivery_failed"
          : "org_invitation_created";
      const auditSummary = emailDispatched
        ? `Organization invitation sent to ${email}`
        : deliveryFailed
          ? `Organization invitation delivery failed for ${email}`
          : `Organization invitation created for ${email}`;

      if (!emailDispatched && deliveryStatus === "failed_provider_error") {
        console.warn("[org-invite-member] email warning", deliveryReason);
      }

      if (trackOwnerInvite) {
        await updateOrganizationInviteState(adminClient, organizationId, {
          pending_owner_email: email,
          owner_invitation_status: "pending",
          owner_invitation_last_error: deliveryFailed ? deliveryReason : null,
          owner_invitation_last_attempt_at: new Date().toISOString(),
        });
      }

      await writeInvitationAuditLog(adminClient, req, {
        actorId: user.id,
        actorRole,
        organizationId,
        organizationName: organization.name,
        ownerEmail: email,
        invitationId: invitation.id,
        invitedUserId,
        requiresPasswordSetup,
        emailDispatched,
        errorMessage: deliveryReason,
        eventType: auditEventType,
        summary: auditSummary,
        riskLevel: deliveryFailed ? "medium" : null,
        metadata: {
          role,
          delivery_mode: deliveryMode,
          delivery_status: deliveryStatus,
          onboarding_url: onboardingUrl,
        },
      });

      if (existingUser?.id) {
        try {
          await insertUserNotification(adminClient, {
            userId: existingUser.id,
            organizationId,
            sentByAdminId: user.id,
            type: "org_invitation_received",
            title: `You've been invited to join ${organization.name}`,
            body: `Use the invitation link to join ${organization.name} as ${role.replace(/_/g, " ")}.`,
            actionUrl: onboardingUrl,
            dedupeKey: `org_invitation_received:${organizationId}:${existingUser.id}:${invitation.id}`,
            metadata: {
              invitation_token: invitation.invitation_token,
              invitation_url: onboardingUrl,
              onboarding_url: onboardingUrl,
              organization_id: organizationId,
              role,
            },
          });
        } catch (notificationError) {
          console.warn("[org-invite-member] notification warning", notificationError);
        }
      }

      return jsonResponse({
        invitation_id: invitation.id,
        invitation_token: invitation.invitation_token,
        onboarding_url: onboardingUrl,
        invitation_url: onboardingUrl,
        password_setup_url: requiresPasswordSetup ? onboardingUrl : null,
        expires_at: invitation.expires_at,
        email_dispatched: emailDispatched,
        delivery_status: deliveryStatus,
        delivery_reason: deliveryReason,
        requires_password_setup: requiresPasswordSetup,
        invited_user_id: invitation.invited_user_id || invitedUserId,
        organization_bootstrap: organizationBootstrap,
        role: normalizeOrgRole({ org_role_key: role } as any),
      });
    } catch (inviteError) {
      try {
        if (trackOwnerInvite) {
          await updateOrganizationInviteState(adminClient, organizationId, {
            pending_owner_email: email,
            owner_invitation_status: "failed",
            owner_invitation_last_error: inviteError instanceof Error ? inviteError.message : String(inviteError),
            owner_invitation_last_attempt_at: new Date().toISOString(),
          });
        }

        await writeInvitationAuditLog(adminClient, req, {
          actorId: user.id,
          actorRole,
          organizationId,
          organizationName: organization.name,
          ownerEmail: email,
          eventType: "org_invitation_failed",
          summary: `Organization invitation failed for ${email}`,
          errorMessage: inviteError instanceof Error ? inviteError.message : String(inviteError),
          riskLevel: "medium",
          metadata: {
            role,
            delivery_mode: deliveryMode,
          },
        });
      } catch (sideEffectError) {
        console.warn("[org-invite-member] failed to persist invite failure state", sideEffectError);
      }

      throw inviteError;
    }
  } catch (error) {
    console.error("[org-invite-member] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
