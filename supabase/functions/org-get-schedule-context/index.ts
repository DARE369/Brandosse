import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, parseJsonBody, toErrorPayload } from "../_shared/http.ts";
import {
  createHttpError,
  ensureBrandProjectAccess,
  fetchBrandProject,
  fetchOrganization,
  fetchOrgBrandKit,
  normalizeOrgRole,
  requireActiveOrgMember,
  resolveMemberPermissions,
} from "../_shared/org.ts";
import { canActorAdvanceCurrentStage, getCurrentStage, loadPipelineContextById } from "../_shared/pipeline.ts";

type ScheduleContextRequest = {
  pipeline_item_id?: string | null;
  post_id?: string | null;
};

function safeArray<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function isPastLocked(value: string | null | undefined) {
  if (!value) return false;
  const nextDate = new Date(value);
  if (Number.isNaN(nextDate.getTime())) return false;
  nextDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return nextDate.getTime() < today.getTime();
}

function deriveLifecycleStatus(post: Record<string, any> | null, item: Record<string, any> | null) {
  if (item?.status === "scheduled") return "scheduled";
  if (item?.status === "published") return "published";
  if (item?.status === "approved") {
    if (post?.status === "scheduled") return "scheduled";
    if (post?.status === "published") return "published";
    return "approved";
  }
  if (item?.status === "revision_requested") return "revision_requested";
  if (item?.status === "rejected") return "rejected";
  if (item?.status === "withdrawn") return "withdrawn";
  if (item?.status === "pending" || item?.status === "in_review") return "in_review";
  if (post?.status === "published") return "published";
  if (post?.status === "scheduled") return "scheduled";
  if (post?.status === "failed") return "failed";
  return "draft";
}

function getTone(status: string) {
  switch (status) {
    case "published":
      return "published";
    case "scheduled":
      return "scheduled";
    case "approved":
      return "approved";
    case "in_review":
      return "review";
    case "revision_requested":
    case "rejected":
    case "withdrawn":
    case "failed":
      return "blocked";
    default:
      return "draft";
  }
}

async function fetchProfile(adminClient: ReturnType<typeof createAdminClient>, userId: string | null | undefined) {
  if (!userId) return null;
  const { data, error } = await adminClient
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function isActiveConnectedAccount(account: Record<string, any> | null | undefined) {
  const status = String(account?.connection_status || "active").trim().toLowerCase();
  return status !== "revoked" && status !== "disconnected";
}

async function canUserPostToAccount(
  adminClient: ReturnType<typeof createAdminClient>,
  accountId: string,
  userId: string,
) {
  const { data, error } = await adminClient.rpc("can_user_post_to_account", {
    p_account_id: accountId,
    p_user_id: userId,
  });

  if (error) throw error;
  return Boolean(data);
}

async function fetchDestinationAccounts(
  adminClient: ReturnType<typeof createAdminClient>,
  {
    ownerUserId,
    organizationId,
    actorUserId,
  }: {
    ownerUserId: string | null | undefined;
    organizationId: string;
    actorUserId: string;
  },
) {
  const personalQuery = ownerUserId
    ? adminClient
      .from("connected_accounts")
      .select("id, platform, account_name, username, avatar_url, profile_picture_url, connection_status, scope, organization_id, granted_member_ids")
      .eq("user_id", ownerUserId)
      .order("created_at", { ascending: true })
    : Promise.resolve({ data: [], error: null });

  const orgQuery = adminClient
    .from("connected_accounts")
    .select("id, platform, account_name, username, avatar_url, profile_picture_url, connection_status, scope, organization_id, granted_member_ids")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  const [personalResult, orgResult] = await Promise.all([personalQuery, orgQuery]);
  if (personalResult.error) throw personalResult.error;
  if (orgResult.error) throw orgResult.error;

  const personalAccounts = safeArray(personalResult.data)
    .filter((account) => isActiveConnectedAccount(account) && String(account.scope || "personal").trim().toLowerCase() !== "organization")
    .map((account) => ({
      ...account,
      scope: "personal",
      can_post: true,
      access_mode: "personal",
    }));

  const orgAccounts = await Promise.all(
    safeArray(orgResult.data)
      .filter((account) => isActiveConnectedAccount(account) && String(account.scope || "").trim().toLowerCase() === "organization")
      .map(async (account) => {
        const grantedMemberIds = safeArray(account.granted_member_ids).filter(Boolean);
        return {
          ...account,
          scope: "organization",
          can_post: await canUserPostToAccount(adminClient, String(account.id), actorUserId),
          access_mode: grantedMemberIds.length > 0 ? "specific_members" : "all_members",
        };
      }),
  );

  const combined = [...orgAccounts, ...personalAccounts];
  const seen = new Set<string>();

  return combined
    .filter((account) => {
      if (!account?.id || seen.has(account.id)) return false;
      seen.add(account.id);
      return true;
    })
    .sort((left, right) => {
      if (left.scope !== right.scope) {
        return left.scope === "organization" ? -1 : 1;
      }
      return String(left.account_name || left.username || left.platform || "").localeCompare(
        String(right.account_name || right.username || right.platform || ""),
      );
    });
}

async function fetchAttachedAssets(
  adminClient: ReturnType<typeof createAdminClient>,
  organizationId: string,
  postId: string | null | undefined,
) {
  if (!organizationId || !postId) return [];

  const { data: links, error: linksError } = await adminClient
    .from("org_post_asset_links")
    .select("asset_id, asset_role, sort_order")
    .eq("organization_id", organizationId)
    .eq("post_id", postId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (linksError) throw linksError;

  const assetIds = [...new Set(safeArray(links).map((link) => link.asset_id).filter(Boolean))];
  if (assetIds.length === 0) return [];

  const { data: assets, error: assetsError } = await adminClient
    .from("org_asset_library")
    .select("id, name, description, file_url, thumbnail_url, file_type, folder_path")
    .in("id", assetIds);

  if (assetsError) throw assetsError;

  const assetMap = new Map(safeArray(assets).map((asset) => [asset.id, asset]));
  return safeArray(links)
    .map((link) => ({
      ...assetMap.get(link.asset_id),
      asset_role: link.asset_role,
      sort_order: link.sort_order,
    }))
    .filter(Boolean);
}

async function fetchTask(adminClient: ReturnType<typeof createAdminClient>, taskId: string | null | undefined) {
  if (!taskId) return null;

  const { data, error } = await adminClient
    .from("org_tasks")
    .select(`
      id,
      title,
      description,
      due_at,
      is_blocked,
      blocked_reason,
      status_id,
      assignee_user_id
    `)
    .eq("id", taskId)
    .maybeSingle();

  if (error) {
    const message = `${error.code || ""} ${error.message || ""}`.toLowerCase();
    if (
      message.includes("does not exist")
      || message.includes("relation")
      || message.includes("column")
      || message.includes("pgrst")
    ) {
      return null;
    }
    throw error;
  }

  if (!data) return null;

  const { data: status, error: statusError } = await adminClient
    .from("org_task_statuses")
    .select("id, key, name, color")
    .eq("id", data.status_id)
    .maybeSingle();

  if (statusError) throw statusError;

  return {
    ...data,
    status,
  };
}

async function loadStandalonePostContext(adminClient: ReturnType<typeof createAdminClient>, postId: string) {
  const { data: post, error: postError } = await adminClient
    .from("posts")
    .select("*")
    .eq("id", postId)
    .maybeSingle();

  if (postError) throw postError;
  if (!post) throw createHttpError("post_not_found", 404);

  if (!post.organization_id) {
    throw createHttpError("post_not_in_org_scope", 400);
  }

  const [generationResult, organization, brandProject] = await Promise.all([
    post.generation_id
      ? adminClient.from("generations").select("*").eq("id", post.generation_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    fetchOrganization(adminClient, post.organization_id),
    post.brand_project_id
      ? fetchBrandProject(adminClient, post.brand_project_id)
      : Promise.resolve(null),
  ]);

  if (generationResult.error) throw generationResult.error;

  return {
    item: null,
    config: null,
    post,
    generation: generationResult.data,
    organization,
    brandProject,
  };
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
    const body = await parseJsonBody<ScheduleContextRequest>(req);

    if (!body.pipeline_item_id && !body.post_id) {
      throw createHttpError("Missing schedule context target.", 400);
    }

    const context = body.pipeline_item_id
      ? await loadPipelineContextById(adminClient, body.pipeline_item_id)
      : await loadStandalonePostContext(adminClient, String(body.post_id));

    const organizationId = String(context.item?.organization_id || context.post?.organization_id || "");
    const brandProjectId = context.item?.brand_project_id || context.post?.brand_project_id || null;

    if (!organizationId) {
      throw createHttpError("schedule_context_missing_org", 400);
    }

    const member = await requireActiveOrgMember(adminClient, organizationId, user.id);
    if (!ensureBrandProjectAccess(member, brandProjectId)) {
      throw createHttpError("forbidden", 403);
    }

    const permissions = await resolveMemberPermissions(adminClient, organizationId, member);
    const role = normalizeOrgRole(member);
    const currentStage = context.item && context.config
      ? getCurrentStage(context.item, context.config)
      : null;

    const linkedTaskId = context.item?.task_id || context.post?.task_id || null;
    const [owner, reviewer, destinations, attachedAssets, brandKit, task] = await Promise.all([
      fetchProfile(adminClient, context.post?.user_id || context.item?.submitted_by),
      fetchProfile(adminClient, context.item?.current_assignee_user_id || null),
      fetchDestinationAccounts(adminClient, {
        ownerUserId: context.post?.user_id || context.item?.submitted_by,
        organizationId,
        actorUserId: user.id,
      }),
      fetchAttachedAssets(adminClient, organizationId, context.post?.id),
      brandProjectId ? fetchOrgBrandKit(adminClient, brandProjectId) : Promise.resolve(null),
      fetchTask(adminClient, linkedTaskId),
    ]);

    const lifecycleStatus = deriveLifecycleStatus(context.post, context.item);
    const scheduledAt = context.post?.scheduled_at || context.item?.scheduled_for || null;
    const pastLocked = isPastLocked(scheduledAt);
    const canSchedule = Boolean(permissions.can_schedule);
    const canPublish = Boolean(permissions.can_publish);
    const canScheduleAction = context.item
      ? Boolean((canSchedule || canPublish) && context.post?.id && ["approved", "scheduled"].includes(lifecycleStatus) && !pastLocked)
      : Boolean(canSchedule && context.post?.id && ["draft", "scheduled"].includes(lifecycleStatus) && !pastLocked);
    const canPublishAction = Boolean(context.item?.id && canPublish && ["approved", "scheduled"].includes(lifecycleStatus) && !pastLocked);
    const canReviewAction = Boolean(
      context.item
      && context.config
      && canActorAdvanceCurrentStage({
        action: "approve",
        actorId: user.id,
        role,
        item: context.item,
        config: context.config,
      }),
    );
    const canGenerateClientReviewLink = Boolean(
      context.item
      && currentStage?.generates_client_review_link
      && canReviewAction,
    );

    return jsonResponse({
      organization: context.organization
        ? {
          id: context.organization.id,
          name: context.organization.name,
        }
        : null,
      brand_project: context.brandProject
        ? {
          id: context.brandProject.id,
          name: context.brandProject.name,
          slug: context.brandProject.slug,
        }
        : null,
      brand_kit: brandKit
        ? {
          id: brandKit.id,
          brand_name: brandKit.brand_name,
          tagline: brandKit.tagline,
          completeness_score: brandKit.completeness_score,
          tone_descriptors: brandKit.tone_descriptors,
          content_pillars: brandKit.content_pillars,
        }
        : null,
      owner,
      reviewer: reviewer
        ? {
          ...reviewer,
          role: context.item?.current_assignee_role || null,
        }
        : null,
      destinations,
      post: context.post
        ? {
          id: context.post.id,
          user_id: context.post.user_id,
          generation_id: context.post.generation_id,
          pipeline_item_id: context.post.pipeline_item_id,
          organization_id: context.post.organization_id,
          brand_project_id: context.post.brand_project_id,
          caption: context.post.caption,
          hashtags: context.post.hashtags,
          status: context.post.status,
          platform: context.post.platform,
          account_id: context.post.account_id,
          scheduled_at: context.post.scheduled_at,
          published_at: context.post.published_at,
          created_at: context.post.created_at,
          updated_at: context.post.updated_at,
          task_id: context.post.task_id || null,
        }
        : null,
      generation: context.generation
        ? {
          id: context.generation.id,
          prompt: context.generation.prompt,
          storage_path: context.generation.storage_path,
          media_type: context.generation.media_type,
        }
        : null,
      pipeline_item: context.item
        ? {
          id: context.item.id,
          status: context.item.status,
          title: context.item.title,
          submission_note: context.item.submission_note,
          scheduled_for: context.item.scheduled_for,
          sla_deadline: context.item.sla_deadline,
          current_stage_order: context.item.current_stage_order,
          current_stage_name: currentStage?.name || null,
          current_stage_generates_client_review_link: Boolean(currentStage?.generates_client_review_link),
          current_assignee_role: context.item.current_assignee_role,
          current_assignee_user_id: context.item.current_assignee_user_id,
          client_review_token: context.item.client_review_token || null,
          client_review_token_expires_at: context.item.client_review_token_expires_at || null,
          task_id: context.item.task_id || null,
        }
        : null,
      task: task
        ? {
          id: task.id,
          title: task.title,
          description: task.description,
          due_at: task.due_at,
          is_blocked: task.is_blocked,
          blocked_reason: task.blocked_reason,
          assignee_user_id: task.assignee_user_id,
          status: task.status,
        }
        : null,
      attached_assets: attachedAssets,
      permissions: {
        can_schedule: canSchedule,
        can_publish: canPublish,
        can_schedule_action: canScheduleAction,
        can_publish_action: canPublishAction,
        can_review_action: canReviewAction,
        can_generate_client_review_link: canGenerateClientReviewLink,
      },
      resolved: {
        lifecycle_status: lifecycleStatus,
        tone: getTone(lifecycleStatus),
        is_past_locked: pastLocked,
      },
    });
  } catch (error) {
    console.error("[org-get-schedule-context] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
