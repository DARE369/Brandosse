import type { DatabaseClient } from "./supabase.ts";
import { toLegacyMembershipRole } from "./org.ts";

type BootstrapPayload = {
  organizationId: string;
  ownerUserId: string;
  planKey: "organization" | "agency";
  orgName: string;
  activateOwnerMembership?: boolean;
};

function slugify(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "workspace";
}

function defaultRoleTemplates(organizationId: string) {
  return [
    {
      organization_id: organizationId,
      role_key: "org_owner",
      display_name: "Organization Owner",
      permissions: {
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
      is_system: true,
    },
    {
      organization_id: organizationId,
      role_key: "org_admin",
      display_name: "Organization Admin",
      permissions: {
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
      is_system: true,
    },
    {
      organization_id: organizationId,
      role_key: "editor",
      display_name: "Editor",
      permissions: {
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
      is_system: true,
    },
    {
      organization_id: organizationId,
      role_key: "contributor",
      display_name: "Contributor",
      permissions: {
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
      is_system: true,
    },
    {
      organization_id: organizationId,
      role_key: "reviewer",
      display_name: "Reviewer",
      permissions: {
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
      is_system: true,
    },
  ];
}

function buildPipelineTemplates(organizationId: string, createdBy: string) {
  return [
    {
      organization_id: organizationId,
      name: "Standard Review",
      description: "Contributor to editor approval flow.",
      is_default: true,
      template_key: "standard",
      stages: [
        {
          id: crypto.randomUUID(),
          order: 0,
          name: "Editor Review",
          assignee_type: "role",
          assignee_role: "editor",
          sla_hours: 24,
          require_comment_on_rejection: true,
          is_optional: false,
          generates_client_review_link: false,
        },
        {
          id: crypto.randomUUID(),
          order: 1,
          name: "Admin Approval",
          assignee_type: "role",
          assignee_role: "org_admin",
          sla_hours: 24,
          require_comment_on_rejection: true,
          is_optional: false,
          generates_client_review_link: false,
        },
      ],
      created_by: createdBy,
    },
    {
      organization_id: organizationId,
      name: "Agency Client Review",
      description: "Internal review followed by client approval.",
      is_default: false,
      template_key: "agency_client",
      stages: [
        {
          id: crypto.randomUUID(),
          order: 0,
          name: "Editor Review",
          assignee_type: "role",
          assignee_role: "editor",
          sla_hours: 24,
          require_comment_on_rejection: true,
          is_optional: false,
          generates_client_review_link: false,
        },
        {
          id: crypto.randomUUID(),
          order: 1,
          name: "Client Review",
          assignee_type: "role",
          assignee_role: "org_admin",
          sla_hours: 48,
          require_comment_on_rejection: true,
          is_optional: false,
          generates_client_review_link: true,
        },
      ],
      created_by: createdBy,
    },
    {
      organization_id: organizationId,
      name: "Fast Track",
      description: "Single-stage approval for urgent content.",
      is_default: false,
      template_key: "fast_track",
      stages: [
        {
          id: crypto.randomUUID(),
          order: 0,
          name: "Fast Track Approval",
          assignee_type: "role",
          assignee_role: "org_admin",
          sla_hours: 12,
          require_comment_on_rejection: false,
          is_optional: false,
          generates_client_review_link: false,
        },
      ],
      created_by: createdBy,
    },
    {
      organization_id: organizationId,
      name: "Compliance Review",
      description: "Multi-stage review for high-risk campaigns.",
      is_default: false,
      template_key: "compliance",
      stages: [
        {
          id: crypto.randomUUID(),
          order: 0,
          name: "Contributor Review",
          assignee_type: "role",
          assignee_role: "contributor",
          sla_hours: 24,
          require_comment_on_rejection: true,
          is_optional: false,
          generates_client_review_link: false,
        },
        {
          id: crypto.randomUUID(),
          order: 1,
          name: "Editor Review",
          assignee_type: "role",
          assignee_role: "editor",
          sla_hours: 24,
          require_comment_on_rejection: true,
          is_optional: false,
          generates_client_review_link: false,
        },
        {
          id: crypto.randomUUID(),
          order: 2,
          name: "Admin Approval",
          assignee_type: "role",
          assignee_role: "org_admin",
          sla_hours: 24,
          require_comment_on_rejection: true,
          is_optional: false,
          generates_client_review_link: false,
        },
      ],
      created_by: createdBy,
    },
  ];
}

function defaultSystemFolders(organizationId: string, createdBy: string) {
  return [
    {
      organization_id: organizationId,
      brand_project_id: null,
      name: "Brand Assets",
      folder_path: "/Brand Assets",
      visibility: "team",
      created_by: createdBy,
      color: "#6366F1",
      icon: "Bookmark",
      is_system: true,
    },
    {
      organization_id: organizationId,
      brand_project_id: null,
      name: "Campaign Work",
      folder_path: "/Campaign Work",
      visibility: "team",
      created_by: createdBy,
      color: "#10B981",
      icon: "Briefcase",
      is_system: true,
    },
    {
      organization_id: organizationId,
      brand_project_id: null,
      name: "Published Content",
      folder_path: "/Published Content",
      visibility: "team",
      created_by: createdBy,
      color: "#3B82F6",
      icon: "Send",
      is_system: true,
    },
    {
      organization_id: organizationId,
      brand_project_id: null,
      name: "Archived",
      folder_path: "/Archived",
      visibility: "team",
      created_by: createdBy,
      color: "#6B7280",
      icon: "Archive",
      is_system: true,
    },
  ];
}

function defaultTaskStatuses(organizationId: string, createdBy: string) {
  return [
    {
      organization_id: organizationId,
      key: "todo",
      name: "To Do",
      color: "#64748B",
      position: 0,
      is_system: true,
      created_by: createdBy,
    },
    {
      organization_id: organizationId,
      key: "in_progress",
      name: "In Progress",
      color: "#2563EB",
      position: 1,
      is_system: true,
      created_by: createdBy,
    },
    {
      organization_id: organizationId,
      key: "in_review",
      name: "In Review",
      color: "#D97706",
      position: 2,
      is_system: true,
      created_by: createdBy,
    },
    {
      organization_id: organizationId,
      key: "completed",
      name: "Completed",
      color: "#10B981",
      position: 3,
      is_system: true,
      created_by: createdBy,
    },
  ];
}

export async function ensureOrganizationBootstrap(
  adminClient: DatabaseClient,
  payload: BootstrapPayload,
) {
  const activateOwnerMembership = payload.activateOwnerMembership !== false;
  const { data: organization, error: organizationError } = await adminClient
    .from("organizations")
    .select("id, settings")
    .eq("id", payload.organizationId)
    .maybeSingle();

  if (organizationError) throw organizationError;
  if (!organization) {
    throw new Error("organization_not_found");
  }

  const baseSlug = slugify(payload.orgName);
  const { data: existingDefaultProject, error: existingProjectError } = await adminClient
    .from("brand_projects")
    .select("id")
    .eq("organization_id", payload.organizationId)
    .eq("is_default", true)
    .maybeSingle();

  if (existingProjectError) throw existingProjectError;

  let defaultBrandProjectId = existingDefaultProject?.id || null;
  if (!defaultBrandProjectId) {
    const { data: createdProject, error: projectError } = await adminClient
      .from("brand_projects")
      .insert({
        organization_id: payload.organizationId,
        name: payload.orgName,
        slug: baseSlug,
        is_default: true,
        created_by: payload.ownerUserId,
      })
      .select("id")
      .single();

    if (projectError) throw projectError;
    defaultBrandProjectId = createdProject.id;
  }

  if (defaultBrandProjectId) {
    const { error: brandKitError } = await adminClient
      .from("org_brand_kits")
      .upsert(
        {
          organization_id: payload.organizationId,
          brand_project_id: defaultBrandProjectId,
          brand_name: payload.orgName,
          last_edited_by: payload.ownerUserId,
        },
        { onConflict: "brand_project_id" },
      );

    if (brandKitError && !String(brandKitError.message || "").toLowerCase().includes("does not exist")) {
      throw brandKitError;
    }
  }

  for (const folder of defaultSystemFolders(payload.organizationId, payload.ownerUserId)) {
    const { data: existingFolder, error: folderReadError } = await adminClient
      .from("org_asset_folders")
      .select("id")
      .eq("organization_id", payload.organizationId)
      .is("brand_project_id", null)
      .eq("folder_path", folder.folder_path)
      .maybeSingle();

    if (folderReadError && !String(folderReadError.message || "").toLowerCase().includes("does not exist")) {
      throw folderReadError;
    }

    if (!existingFolder) {
      const { error: folderInsertError } = await adminClient
        .from("org_asset_folders")
        .insert(folder);

      if (
        folderInsertError
        && !String(folderInsertError.message || "").toLowerCase().includes("does not exist")
        && !String(folderInsertError.message || "").toLowerCase().includes("duplicate key")
      ) {
        throw folderInsertError;
      }
    }
  }

  for (const status of defaultTaskStatuses(payload.organizationId, payload.ownerUserId)) {
    const { error: taskStatusError } = await adminClient
      .from("org_task_statuses")
      .upsert(status, { onConflict: "organization_id,key" });

    if (
      taskStatusError
      && !String(taskStatusError.message || "").toLowerCase().includes("does not exist")
    ) {
      throw taskStatusError;
    }
  }

  if (activateOwnerMembership) {
    const now = new Date().toISOString();
    const { error: membershipError } = await adminClient
      .from("organization_members")
      .upsert(
        {
          organization_id: payload.organizationId,
          user_id: payload.ownerUserId,
          role: toLegacyMembershipRole("org_owner"),
          org_role_key: "org_owner",
          status: "active",
          joined_at: now,
          invited_by: payload.ownerUserId,
          invited_at: now,
          brand_project_ids: payload.planKey === "agency" && defaultBrandProjectId
            ? [defaultBrandProjectId]
            : null,
        },
        { onConflict: "organization_id,user_id" },
      );

    if (membershipError) throw membershipError;
  }

  const { error: roleTemplateError } = await adminClient
    .from("org_role_templates")
    .upsert(defaultRoleTemplates(payload.organizationId), {
      onConflict: "organization_id,role_key",
    });

  if (roleTemplateError) throw roleTemplateError;

  const { data: existingPipelines, error: pipelineReadError } = await adminClient
    .from("pipeline_configs")
    .select("id, template_key, is_default")
    .eq("organization_id", payload.organizationId);

  if (pipelineReadError) throw pipelineReadError;

  const existingTemplateKeys = new Set((existingPipelines || []).map((row) => row.template_key));
  const pipelineRows = buildPipelineTemplates(payload.organizationId, payload.ownerUserId)
    .filter((row) => !existingTemplateKeys.has(row.template_key));

  let defaultPipelineId = (existingPipelines || []).find((row) => row.is_default)?.id || null;
  if (pipelineRows.length > 0) {
    const { data: insertedPipelines, error: pipelineInsertError } = await adminClient
      .from("pipeline_configs")
      .insert(pipelineRows)
      .select("id, template_key, is_default");

    if (pipelineInsertError) throw pipelineInsertError;
    defaultPipelineId = defaultPipelineId
      || insertedPipelines?.find((row) => row.is_default)?.id
      || null;
  }

  const { data: existingGeneralChannel, error: channelReadError } = await adminClient
    .from("common_room_channels")
    .select("id")
    .eq("organization_id", payload.organizationId)
    .eq("is_default", true)
    .maybeSingle();

  if (channelReadError && !String(channelReadError.message || "").includes("does not exist")) {
    throw channelReadError;
  }

  if (!existingGeneralChannel) {
    const { error: channelInsertError } = await adminClient
      .from("common_room_channels")
      .insert({
        organization_id: payload.organizationId,
        brand_project_id: null,
        name: "General",
        description: "Default team channel",
        channel_type: "group",
        is_default: true,
        member_ids: null,
        created_by: payload.ownerUserId,
      });

    if (channelInsertError) throw channelInsertError;
  }

  const nextSettings = {
    ...(organization.settings && typeof organization.settings === "object" ? organization.settings : {}),
    default_pipeline_id: defaultPipelineId,
  };

  const { error: organizationUpdateError } = await adminClient
    .from("organizations")
    .update({
      plan: payload.planKey,
      plan_key: payload.planKey,
      owner_id: payload.ownerUserId,
      owner_user_id: payload.ownerUserId,
      settings: nextSettings,
    })
    .eq("id", payload.organizationId);

  if (organizationUpdateError) throw organizationUpdateError;

  return {
    organization_id: payload.organizationId,
    default_brand_project_id: defaultBrandProjectId,
    default_pipeline_id: defaultPipelineId,
    initialized: true,
  };
}
