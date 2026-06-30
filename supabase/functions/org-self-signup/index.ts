import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import { createHttpError, upsertLastUsedContext } from "../_shared/org.ts";
import { ensureOrganizationBootstrap } from "../_shared/org-bootstrap.ts";

type SelfSignupRequest = {
  organization_name: string;
  slug: string;
  plan_key: "organization" | "agency";
  signup_request_id: string;
};

function slugify(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "organization";
}

function getOrganizationSettings(settings: unknown) {
  return settings && typeof settings === "object" && !Array.isArray(settings)
    ? { ...(settings as Record<string, unknown>) }
    : {};
}

async function getPlanAllocation(
  adminClient: ReturnType<typeof createAdminClient>,
  planKey: "organization" | "agency",
) {
  const { data, error } = await adminClient
    .from("organization_plans")
    .select("monthly_credit_allocation")
    .eq("plan_key", planKey)
    .maybeSingle();

  if (error) throw error;
  return Number(data?.monthly_credit_allocation || (planKey === "agency" ? 10000 : 2000));
}

async function ensureUniqueOrgSlug(
  adminClient: ReturnType<typeof createAdminClient>,
  preferredSlug: string,
  currentOrganizationId: string | null = null,
) {
  const baseSlug = slugify(preferredSlug);
  const { data, error } = await adminClient
    .from("organizations")
    .select("id, slug")
    .ilike("slug", `${baseSlug}%`);

  if (error) throw error;

  const existingSlugs = new Set(
    (data || [])
      .filter((row) => row.id !== currentOrganizationId)
      .map((row) => row.slug)
      .filter(Boolean),
  );

  if (!existingSlugs.has(baseSlug)) return baseSlug;

  let attempt = 2;
  while (existingSlugs.has(`${baseSlug}-${attempt}`)) {
    attempt += 1;
  }

  return `${baseSlug}-${attempt}`;
}

async function findExistingSelfSignupOrganization(
  adminClient: ReturnType<typeof createAdminClient>,
  userId: string,
  signupRequestId: string,
) {
  const { data, error } = await adminClient
    .from("organizations")
    .select("id, name, slug, plan, plan_key, owner_id, owner_user_id, settings")
    .contains("settings", {
      provision_source: "self_signup",
      signup_request_id: signupRequestId,
    })
    .limit(5);

  if (error) throw error;

  return (data || []).find((row) =>
    row.owner_id === userId || row.owner_user_id === userId
  ) || null;
}

async function updateProvisioningState(
  adminClient: ReturnType<typeof createAdminClient>,
  organizationId: string,
  patch: Record<string, unknown>,
) {
  const { data: organization, error: readError } = await adminClient
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle();

  if (readError) throw readError;

  const { error: updateError } = await adminClient
    .from("organizations")
    .update({
      settings: {
        ...getOrganizationSettings(organization?.settings),
        ...patch,
      },
    })
    .eq("id", organizationId);

  if (updateError) throw updateError;
}

async function writeProvisioningAuditLog(
  adminClient: ReturnType<typeof createAdminClient>,
  req: Request,
  payload: {
    actorId: string;
    organizationId: string;
    organizationName: string;
    eventType: string;
    summary: string;
    metadata?: Record<string, unknown>;
    riskLevel?: string | null;
  },
) {
  const { error } = await adminClient.rpc("write_audit_log", {
    p_actor_id: payload.actorId,
    p_actor_type: "user",
    p_actor_role: null,
    p_organization_id: payload.organizationId,
    p_event_category: "authentication",
    p_event_type: payload.eventType,
    p_entity_type: "organization",
    p_entity_id: payload.organizationId,
    p_summary: payload.summary,
    p_previous_value: null,
    p_new_value: null,
    p_metadata: payload.metadata || null,
    p_risk_level: payload.riskLevel || null,
    p_correlation_id: null,
    p_ip_address: null,
    p_user_agent: req.headers.get("user-agent"),
  });

  if (error) {
    console.warn("[org-self-signup] audit log warning", error.message);
  }
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
    const body = await parseJsonBody<SelfSignupRequest>(req);

    const organizationName = String(body.organization_name || "").trim();
    const signupRequestId = String(body.signup_request_id || "").trim();
    const planKey = (String(body.plan_key || "").trim().toLowerCase() || "organization") as "organization" | "agency";

    if (!organizationName || !signupRequestId) {
      throw createHttpError("Missing organization signup details.", 400);
    }

    if (!["organization", "agency"].includes(planKey)) {
      throw createHttpError("Invalid organization plan.", 400);
    }

    let organization = await findExistingSelfSignupOrganization(
      adminClient,
      user.id,
      signupRequestId,
    );

    if (!organization) {
      const uniqueSlug = await ensureUniqueOrgSlug(
        adminClient,
        body.slug || organizationName,
      );
      const monthlyCreditPool = await getPlanAllocation(adminClient, planKey);

      const { data: createdOrganization, error: createError } = await adminClient
        .from("organizations")
        .insert({
          name: organizationName,
          slug: uniqueSlug,
          plan: planKey,
          plan_key: planKey,
          status: "active",
          owner_id: user.id,
          owner_user_id: user.id,
          monthly_credit_pool: monthlyCreditPool,
          credits_used_this_period: 0,
          settings: {
            provision_source: "self_signup",
            provisioning_status: "pending",
            provisioning_last_error: null,
            provisioning_last_attempt_at: new Date().toISOString(),
            signup_request_id: signupRequestId,
            pending_owner_email: user.email || null,
          },
        })
        .select("id, name, slug, plan, plan_key, owner_id, owner_user_id, settings")
        .single();

      if (createError) throw createError;
      organization = createdOrganization;
    } else {
      const nextSlug = await ensureUniqueOrgSlug(
        adminClient,
        organization.slug || body.slug || organizationName,
        organization.id,
      );

      const { error: refreshError } = await adminClient
        .from("organizations")
        .update({
          name: organization.name || organizationName,
          slug: nextSlug,
          plan: planKey,
          plan_key: planKey,
          owner_id: user.id,
          owner_user_id: user.id,
          settings: {
            ...getOrganizationSettings(organization.settings),
            provision_source: "self_signup",
            provisioning_status: "pending",
            provisioning_last_error: null,
            provisioning_last_attempt_at: new Date().toISOString(),
            signup_request_id: signupRequestId,
            pending_owner_email: user.email || null,
          },
        })
        .eq("id", organization.id);

      if (refreshError) throw refreshError;
    }

    await writeProvisioningAuditLog(adminClient, req, {
      actorId: user.id,
      organizationId: organization.id,
      organizationName: organization.name || organizationName,
      eventType: "org_self_signup_requested",
      summary: `Self-service organization provisioning requested for ${organization.name || organizationName}`,
      metadata: {
        plan_key: planKey,
        signup_request_id: signupRequestId,
      },
    });

    try {
      const bootstrapResult = await ensureOrganizationBootstrap(adminClient, {
        organizationId: organization.id,
        ownerUserId: user.id,
        planKey,
        orgName: organization.name || organizationName,
        activateOwnerMembership: true,
      });

      await upsertLastUsedContext(
        adminClient,
        user.id,
        organization.id,
        bootstrapResult.default_brand_project_id || null,
      );

      await updateProvisioningState(adminClient, organization.id, {
        provision_source: "self_signup",
        provisioning_status: "completed",
        provisioning_last_error: null,
        provisioning_last_attempt_at: new Date().toISOString(),
        signup_request_id: signupRequestId,
        pending_owner_email: user.email || null,
      });

      await writeProvisioningAuditLog(adminClient, req, {
        actorId: user.id,
        organizationId: organization.id,
        organizationName: organization.name || organizationName,
        eventType: "org_self_signup_completed",
        summary: `Self-service organization provisioning completed for ${organization.name || organizationName}`,
        metadata: {
          plan_key: planKey,
          signup_request_id: signupRequestId,
          default_brand_project_id: bootstrapResult.default_brand_project_id || null,
        },
      });

      return jsonResponse({
        organization_id: organization.id,
        brand_project_id: bootstrapResult.default_brand_project_id || null,
        role: "org_owner",
        redirect_to: `/app/org/${organization.id}/overview`,
      });
    } catch (provisionError) {
      const errorMessage = provisionError instanceof Error
        ? provisionError.message
        : String(provisionError);

      await updateProvisioningState(adminClient, organization.id, {
        provision_source: "self_signup",
        provisioning_status: "failed",
        provisioning_last_error: errorMessage,
        provisioning_last_attempt_at: new Date().toISOString(),
        signup_request_id: signupRequestId,
        pending_owner_email: user.email || null,
      });

      await writeProvisioningAuditLog(adminClient, req, {
        actorId: user.id,
        organizationId: organization.id,
        organizationName: organization.name || organizationName,
        eventType: "org_self_signup_failed",
        summary: `Self-service organization provisioning failed for ${organization.name || organizationName}`,
        metadata: {
          plan_key: planKey,
          signup_request_id: signupRequestId,
          error: errorMessage,
        },
        riskLevel: "medium",
      });

      throw provisionError;
    }
  } catch (error) {
    console.error("[org-self-signup] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
