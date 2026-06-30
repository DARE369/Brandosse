import type { DatabaseClient } from "./supabase.ts";

export type HttpError = Error & { statusCode?: number };

export type OrgMemberRow = {
  id: string;
  organization_id: string;
  user_id: string;
  role: string | null;
  org_role_key: string | null;
  status: string | null;
  permissions: Record<string, unknown> | null;
  credits_used_this_period: number | null;
  brand_project_ids: string[] | null;
};

const DEFAULT_ORG_ROLE_PERMISSIONS: Record<string, Record<string, unknown>> = {
  org_owner: {
    can_publish: true,
    publish_requires_final_approval: false,
    can_manage_library: true,
    can_approve_library_uploads: true,
    can_schedule: true,
    can_manage_tasks: true,
    can_invite_members: true,
    can_create_channels: true,
    monthly_credit_limit: null,
  },
  org_admin: {
    can_publish: true,
    publish_requires_final_approval: false,
    can_manage_library: true,
    can_approve_library_uploads: true,
    can_schedule: true,
    can_manage_tasks: true,
    can_invite_members: true,
    can_create_channels: true,
    monthly_credit_limit: null,
  },
  editor: {
    can_publish: true,
    publish_requires_final_approval: true,
    can_manage_library: true,
    can_approve_library_uploads: false,
    can_schedule: true,
    can_manage_tasks: true,
    can_invite_members: false,
    can_create_channels: true,
    monthly_credit_limit: null,
  },
  contributor: {
    can_publish: false,
    publish_requires_final_approval: false,
    can_manage_library: false,
    can_approve_library_uploads: false,
    can_schedule: false,
    can_manage_tasks: false,
    can_invite_members: false,
    can_create_channels: false,
    monthly_credit_limit: 200,
  },
  reviewer: {
    can_publish: false,
    publish_requires_final_approval: false,
    can_manage_library: false,
    can_approve_library_uploads: false,
    can_schedule: false,
    can_manage_tasks: false,
    can_invite_members: false,
    can_create_channels: false,
    monthly_credit_limit: 0,
  },
};

function isMissingRelationError(error: unknown) {
  const message = `${(error as { code?: string; message?: string })?.code || ""} ${(error as { message?: string })?.message || ""}`.toLowerCase();
  return (
    message.includes("does not exist")
    || message.includes("relation")
    || message.includes("column")
    || message.includes("pgrst")
  );
}

function normalizeBrandKitList(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
}

export function buildBrandKitSystemPrompt(options: {
  brandName?: string | null;
  promptPrefix?: string | null;
  voiceDescription?: string | null;
  toneDescriptors?: unknown;
  contentPillars?: unknown;
  targetAudience?: string | null;
  promptGuidelines?: string | null;
  bannedPhrases?: unknown;
}) {
  const parts = [
    `You are generating content for ${String(options.brandName || "this brand").trim() || "this brand"}.`,
  ];

  if (String(options.promptPrefix || "").trim()) {
    parts.push(String(options.promptPrefix).trim());
  }

  if (String(options.voiceDescription || "").trim()) {
    parts.push(`Brand voice: ${String(options.voiceDescription).trim()}.`);
  }

  const toneDescriptors = normalizeBrandKitList(options.toneDescriptors);
  if (toneDescriptors.length > 0) {
    parts.push(`Tone descriptors: ${toneDescriptors.join(", ")}.`);
  }

  const contentPillars = normalizeBrandKitList(options.contentPillars);
  if (contentPillars.length > 0) {
    parts.push(`Content pillars: ${contentPillars.join(", ")}.`);
  }

  if (String(options.targetAudience || "").trim()) {
    parts.push(`Target audience: ${String(options.targetAudience).trim()}.`);
  }

  if (String(options.promptGuidelines || "").trim()) {
    parts.push(`Generation guidelines: ${String(options.promptGuidelines).trim()}.`);
  }

  const bannedPhrases = normalizeBrandKitList(options.bannedPhrases);
  if (bannedPhrases.length > 0) {
    parts.push(`Avoid these phrases: ${bannedPhrases.join(", ")}.`);
  }

  return parts.join(" ");
}

export function createHttpError(message: string, statusCode: number): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  return error;
}

export function normalizeOrgRole(member: Partial<OrgMemberRow> | null | undefined) {
  const rawRole = String(member?.org_role_key || member?.role || "contributor").trim().toLowerCase();
  if (!rawRole || rawRole === "member") return "contributor";
  return rawRole;
}

function getDefaultRolePermissions(roleKey: string) {
  return DEFAULT_ORG_ROLE_PERMISSIONS[normalizeOrgRole({ org_role_key: roleKey } as Partial<OrgMemberRow>)]
    || DEFAULT_ORG_ROLE_PERMISSIONS.contributor;
}

export function toLegacyMembershipRole(roleKey: string) {
  return ["org_owner", "org_admin"].includes(roleKey) ? "org_admin" : "member";
}

export function ensureBrandProjectAccess(member: OrgMemberRow, brandProjectId: string | null | undefined) {
  if (!brandProjectId) return true;
  if (!Array.isArray(member.brand_project_ids) || member.brand_project_ids.length === 0) return true;
  return member.brand_project_ids.includes(brandProjectId);
}

export async function findOrgMember(
  adminClient: DatabaseClient,
  organizationId: string,
  userId: string,
) {
  const { data, error } = await adminClient
    .from("organization_members")
    .select("id, organization_id, user_id, role, org_role_key, status, permissions, credits_used_this_period, brand_project_ids")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw error;
  return data as OrgMemberRow | null;
}

export async function requireActiveOrgMember(
  adminClient: DatabaseClient,
  organizationId: string,
  userId: string,
) {
  const member = await findOrgMember(adminClient, organizationId, userId);
  if (!member) {
    throw createHttpError("not_a_member", 403);
  }
  return member;
}

export async function requireOrgAdmin(
  adminClient: DatabaseClient,
  organizationId: string,
  userId: string,
) {
  const member = await requireActiveOrgMember(adminClient, organizationId, userId);
  const role = normalizeOrgRole(member);
  if (!["org_owner", "org_admin"].includes(role)) {
    throw createHttpError("forbidden", 403);
  }
  return member;
}

export async function getAdminRole(
  adminClient: DatabaseClient,
  userId: string,
) {
  if (!userId) return null;

  const { data, error } = await adminClient
    .from("admin_roles")
    .select("role, organization_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function isSuperAdminUser(
  adminClient: DatabaseClient,
  userId: string,
) {
  const adminRole = await getAdminRole(adminClient, userId);
  return adminRole?.role === "super_admin";
}

export async function requireOrgAdminOrSuperAdmin(
  adminClient: DatabaseClient,
  organizationId: string,
  userId: string,
) {
  if (await isSuperAdminUser(adminClient, userId)) {
    return { role: "super_admin", organization_id: organizationId, user_id: userId };
  }

  return requireOrgAdmin(adminClient, organizationId, userId);
}

export async function fetchOrganization(adminClient: DatabaseClient, organizationId: string) {
  const { data, error } = await adminClient
    .from("organizations")
    .select("id, name, slug, plan_key, settings, monthly_credit_pool, credits_used_this_period")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw createHttpError("organization_not_found", 404);
  return data;
}

export async function fetchBrandProject(adminClient: DatabaseClient, brandProjectId: string) {
  const { data, error } = await adminClient
    .from("brand_projects")
    .select("id, organization_id, name, slug, brand_settings, is_default")
    .eq("id", brandProjectId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw createHttpError("brand_project_not_found", 404);
  return data;
}

export async function fetchOrgBrandKit(
  adminClient: DatabaseClient,
  brandProjectId: string,
) {
  const { data, error } = await adminClient
    .from("org_brand_kits")
    .select("*")
    .eq("brand_project_id", brandProjectId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) {
      return null;
    }
    throw error;
  }

  return data;
}

export async function fetchDefaultBrandProject(adminClient: DatabaseClient, organizationId: string) {
  const { data, error } = await adminClient
    .from("brand_projects")
    .select("id, organization_id, name, slug, brand_settings, is_default")
    .eq("organization_id", organizationId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getBrandKitSystemPrompt(
  adminClient: DatabaseClient,
  brandProjectId: string | null | undefined,
) {
  if (!brandProjectId) return null;

  const orgBrandKit = await fetchOrgBrandKit(adminClient, brandProjectId);
  if (orgBrandKit?.ai_system_prompt) {
    return String(orgBrandKit.ai_system_prompt);
  }

  const brandProject = await fetchBrandProject(adminClient, brandProjectId);
  const brandSettings = (brandProject?.brand_settings ?? {}) as Record<string, unknown>;

  return buildBrandKitSystemPrompt({
    brandName: String(brandSettings.brand_name || brandProject?.name || "Brand"),
    promptPrefix: String(brandSettings.prompt_prefix || ""),
    voiceDescription: String(brandSettings.voice_description || ""),
    toneDescriptors: brandSettings.tone_descriptors,
    contentPillars: brandSettings.content_pillars,
    targetAudience: String(brandSettings.target_audience || ""),
    promptGuidelines: String(brandSettings.prompt_guidelines || ""),
    bannedPhrases: brandSettings.banned_phrases,
  });
}

export async function fetchRoleTemplatePermissions(
  adminClient: DatabaseClient,
  organizationId: string,
  roleKey: string,
) {
  const { data, error } = await adminClient
    .from("org_role_templates")
    .select("permissions")
    .eq("organization_id", organizationId)
    .eq("role_key", roleKey)
    .maybeSingle();

  if (error) throw error;
  return {
    ...getDefaultRolePermissions(roleKey),
    ...((data?.permissions ?? {}) as Record<string, unknown>),
  } as Record<string, unknown>;
}

export async function resolveMemberCreditLimit(
  adminClient: DatabaseClient,
  organizationId: string,
  member: OrgMemberRow,
) {
  const overrideLimit = member.permissions?.monthly_credit_limit;
  if (overrideLimit !== undefined && overrideLimit !== null && overrideLimit !== "") {
    return Number(overrideLimit);
  }

  const templatePermissions = await fetchRoleTemplatePermissions(
    adminClient,
    organizationId,
    normalizeOrgRole(member),
  );

  const templateLimit = templatePermissions?.monthly_credit_limit;
  if (templateLimit === undefined || templateLimit === null || templateLimit === "") {
    return null;
  }

  return Number(templateLimit);
}

export async function resolveMemberPermissions(
  adminClient: DatabaseClient,
  organizationId: string,
  member: OrgMemberRow,
) {
  const templatePermissions = await fetchRoleTemplatePermissions(
    adminClient,
    organizationId,
    normalizeOrgRole(member),
  );

  return {
    ...templatePermissions,
    ...(member.permissions && typeof member.permissions === "object" ? member.permissions : {}),
  } as Record<string, unknown>;
}

export async function ensureCreditsAvailable(
  adminClient: DatabaseClient,
  organizationId: string,
  member: OrgMemberRow,
  creditCost: number,
) {
  const memberLimit = await resolveMemberCreditLimit(adminClient, organizationId, member);
  const memberUsed = Number(member.credits_used_this_period || 0);

  if (memberLimit !== null && memberUsed + creditCost > memberLimit) {
    throw createHttpError("credit_exhausted", 402);
  }

  const organization = await fetchOrganization(adminClient, organizationId);
  const pool = Number(organization.monthly_credit_pool || 0);
  const used = Number(organization.credits_used_this_period || 0);

  if (pool > 0 && used + creditCost > pool) {
    throw createHttpError("org_credit_exhausted", 402);
  }

  return organization;
}

export async function recordCreditUsage(
  adminClient: DatabaseClient,
  payload: {
    organizationId: string;
    brandProjectId?: string | null;
    channelId?: string | null;
    memberId: string;
    eventType: string;
    creditsConsumed: number;
    modelUsed?: string | null;
    referenceId?: string | null;
    referenceType?: string | null;
  },
) {
  const { error: eventError } = await adminClient
    .from("credit_events")
    .insert({
      organization_id: payload.organizationId,
      brand_project_id: payload.brandProjectId || null,
      channel_id: payload.channelId || null,
      member_id: payload.memberId,
      event_type: payload.eventType,
      credits_consumed: payload.creditsConsumed,
      model_used: payload.modelUsed || null,
      reference_id: payload.referenceId || null,
      reference_type: payload.referenceType || null,
    });

  if (eventError) throw eventError;

  const member = await findOrgMember(adminClient, payload.organizationId, payload.memberId);
  if (member) {
    const { error } = await adminClient
      .from("organization_members")
      .update({
        credits_used_this_period: Number(member.credits_used_this_period || 0) + payload.creditsConsumed,
      })
      .eq("id", member.id);
    if (error) throw error;
  }

  const organization = await fetchOrganization(adminClient, payload.organizationId);
  const { error: orgError } = await adminClient
    .from("organizations")
    .update({
      credits_used_this_period: Number(organization.credits_used_this_period || 0) + payload.creditsConsumed,
    })
    .eq("id", payload.organizationId);

  if (orgError) throw orgError;
}

export async function insertUserNotification(
  adminClient: DatabaseClient,
  payload: {
    userId: string;
    organizationId?: string | null;
    sentByAdminId?: string | null;
    type: string;
    title: string;
    body: string;
    actionUrl?: string | null;
    dedupeKey?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const supportedType = ["admin_message", "complaint_resolved", "system"].includes(payload.type)
    ? payload.type
    : "system";

  const { error } = await adminClient
    .from("user_notifications")
    .insert({
      user_id: payload.userId,
      organization_id: payload.organizationId || null,
      sent_by_admin_id: payload.sentByAdminId || payload.userId,
      channel: "in_app",
      subject: payload.title,
      body: payload.body,
      title: payload.title,
      type: supportedType,
      action_url: payload.actionUrl || null,
      dedupe_key: payload.dedupeKey || null,
      metadata: {
        requested_type: payload.type,
        ...(payload.metadata ?? {}),
      },
      is_read: false,
    });

  if (error) {
    throw error;
  }
}

export async function upsertLastUsedContext(
  adminClient: DatabaseClient,
  userId: string,
  organizationId: string,
  brandProjectId: string | null,
) {
  const { error } = await adminClient
    .from("context_last_used")
    .upsert(
      {
        user_id: userId,
        last_context_type: "organization",
        last_organization_id: organizationId,
        last_brand_project_id: brandProjectId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (error) throw error;
}
