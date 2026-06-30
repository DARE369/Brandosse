import type { DatabaseClient } from "./supabase.ts";
import { createHttpError } from "./org.ts";

export type PipelineStage = {
  id?: string;
  order?: number;
  name?: string;
  description?: string;
  assignee_type?: "role" | "specific_user";
  assignee_role?: string | null;
  assignee_user_id?: string | null;
  sla_hours?: number | null;
  escalation_user_id?: string | null;
  require_comment_on_rejection?: boolean;
  is_optional?: boolean;
  generates_client_review_link?: boolean;
};

export type PipelineContext = {
  item: Record<string, any>;
  config: Record<string, any>;
  post: Record<string, any> | null;
  generation: Record<string, any> | null;
  organization: Record<string, any> | null;
  brandProject: Record<string, any> | null;
};

export function resolveStages(stages: unknown) {
  return Array.isArray(stages)
    ? [...stages].sort((left, right) => Number(left?.order || 0) - Number(right?.order || 0)) as PipelineStage[]
    : [];
}

export function getCurrentStage(item: Record<string, any>, config: Record<string, any>) {
  const stages = resolveStages(config?.stages);
  return stages.find((stage) => Number(stage.order || 0) === Number(item?.current_stage_order || 0))
    || stages[0]
    || null;
}

export async function loadPipelineContextById(adminClient: DatabaseClient, pipelineItemId: string) {
  const { data: item, error: itemError } = await adminClient
    .from("pipeline_items")
    .select("*")
    .eq("id", pipelineItemId)
    .maybeSingle();

  if (itemError) throw itemError;
  if (!item) throw createHttpError("pipeline_item_not_found", 404);

  const [configResult, postResult, generationResult, organizationResult, brandProjectResult] = await Promise.all([
    adminClient.from("pipeline_configs").select("*").eq("id", item.pipeline_config_id).maybeSingle(),
    item.post_id
      ? adminClient.from("posts").select("*").eq("id", item.post_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    item.generation_id
      ? adminClient.from("generations").select("*").eq("id", item.generation_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    adminClient.from("organizations").select("*").eq("id", item.organization_id).maybeSingle(),
    item.brand_project_id
      ? adminClient.from("brand_projects").select("*").eq("id", item.brand_project_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (configResult.error) throw configResult.error;
  if (postResult.error) throw postResult.error;
  if (generationResult.error) throw generationResult.error;
  if (organizationResult.error) throw organizationResult.error;
  if (brandProjectResult.error) throw brandProjectResult.error;

  if (!configResult.data) throw createHttpError("pipeline_config_not_found", 404);

  return {
    item,
    config: configResult.data,
    post: postResult.data,
    generation: generationResult.data,
    organization: organizationResult.data,
    brandProject: brandProjectResult.data,
  } as PipelineContext;
}

export async function loadPipelineContextByToken(adminClient: DatabaseClient, token: string) {
  const { data: item, error } = await adminClient
    .from("pipeline_items")
    .select("*")
    .eq("client_review_token", token)
    .maybeSingle();

  if (error) throw error;
  if (!item) throw createHttpError("client_review_not_found", 404);
  return loadPipelineContextById(adminClient, item.id);
}

export function canActorAdvanceCurrentStage(options: {
  action: string;
  actorId: string;
  role: string;
  item: Record<string, any>;
  config: Record<string, any>;
}) {
  const { action, actorId, role, item, config } = options;
  const adminLike = ["org_owner", "org_admin", "editor"].includes(role);

  if (action === "withdraw") {
    return item.submitted_by === actorId || adminLike;
  }

  if (adminLike) return true;

  const currentStage = getCurrentStage(item, config);
  if (!currentStage) return item.submitted_by === actorId;

  if (currentStage.assignee_type === "specific_user") {
    return currentStage.assignee_user_id === actorId;
  }

  const stageRole = String(currentStage.assignee_role || item.current_assignee_role || "").trim();
  if (!stageRole) return false;
  return stageRole === role;
}

function buildSlaDeadline(stage: PipelineStage | null) {
  if (!stage?.sla_hours) return null;
  return new Date(Date.now() + Number(stage.sla_hours) * 60 * 60 * 1000).toISOString();
}

export async function performPipelineAction(options: {
  adminClient: DatabaseClient;
  context: PipelineContext;
  action: "approve" | "reject" | "request_revision" | "withdraw";
  actorId: string;
  actorName: string;
  comment?: string | null;
  scheduledFor?: string | null;
}) {
  const { adminClient, context, action, actorId, actorName, comment, scheduledFor } = options;
  const { item, config, post } = context;
  const stages = resolveStages(config.stages);
  const currentStage = getCurrentStage(item, config);
  const currentStageIndex = currentStage
    ? stages.findIndex((stage) => Number(stage.order || 0) === Number(currentStage.order || 0))
    : -1;
  const nextStage = currentStageIndex >= 0 ? stages[currentStageIndex + 1] || null : null;
  const history = Array.isArray(item.history) ? [...item.history] : [];
  const timestamp = new Date().toISOString();

  const updatePayload: Record<string, unknown> = {
    updated_at: timestamp,
  };

  let eventName = action;
  if (action === "approve") {
    if (nextStage) {
      eventName = "advanced";
      updatePayload.current_stage_order = Number(nextStage.order || 0);
      updatePayload.status = "in_review";
      updatePayload.current_assignee_role = nextStage.assignee_role || null;
      updatePayload.current_assignee_user_id = nextStage.assignee_user_id || null;
      updatePayload.sla_deadline = buildSlaDeadline(nextStage);
    } else {
      updatePayload.status = "approved";
      updatePayload.current_assignee_role = null;
      updatePayload.current_assignee_user_id = null;
      updatePayload.sla_deadline = null;
    }
  }

  if (action === "request_revision") {
    updatePayload.status = "revision_requested";
    updatePayload.current_assignee_role = null;
    updatePayload.current_assignee_user_id = null;
    updatePayload.sla_deadline = null;
  }

  if (action === "reject") {
    updatePayload.status = "rejected";
    updatePayload.current_assignee_role = null;
    updatePayload.current_assignee_user_id = null;
    updatePayload.sla_deadline = null;
  }

  if (action === "withdraw") {
    updatePayload.status = "withdrawn";
    updatePayload.current_assignee_role = null;
    updatePayload.current_assignee_user_id = null;
    updatePayload.sla_deadline = null;
  }

  history.push({
    event: eventName,
    stage_order: Number(currentStage?.order || item.current_stage_order || 0),
    stage_name: currentStage?.name || "Stage",
    actor_id: actorId,
    actor_name: actorName,
    comment: comment || null,
    timestamp,
  });
  updatePayload.history = history;

  const { data: updatedItem, error: updateError } = await adminClient
    .from("pipeline_items")
    .update(updatePayload)
    .eq("id", item.id)
    .select("*")
    .maybeSingle();

  if (updateError) throw updateError;

  if (action === "approve" && !nextStage && post?.id && scheduledFor) {
    const { error: postError } = await adminClient
      .from("posts")
      .update({
        scheduled_at: scheduledFor,
      })
      .eq("id", post.id);

    if (postError) throw postError;
  }

  return updatedItem;
}
