import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { ensureBrandProjectAccess, requireActiveOrgMember } from "../_shared/org.ts";
import {
  handleCors,
  jsonResponse,
  mapErrorToStatusCode,
  parseJsonBody,
  toErrorPayload,
} from "../_shared/http.ts";

type SearchRequest = {
  organization_id: string;
  brand_project_id?: string | null;
  query: string;
};

function safeArray<T>(value: T[] | unknown): T[] {
  return Array.isArray(value) ? value : [];
}

function normalizeSearch(value: string) {
  return `%${String(value || "").trim().replace(/\s+/g, "%")}%`;
}

function buildScopedQuery(query: ReturnType<ReturnType<typeof createAdminClient>["from"]>, brandProjectId: string | null) {
  if (!brandProjectId) return query;
  return query.or(`brand_project_id.is.null,brand_project_id.eq.${brandProjectId}`);
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
    const body = await parseJsonBody<SearchRequest>(req);

    const organizationId = String(body.organization_id || "").trim();
    const brandProjectId = String(body.brand_project_id || "").trim() || null;
    const query = String(body.query || "").trim();

    if (!organizationId || query.length < 2) {
      return jsonResponse({
        query,
        groups: {
          pipeline_items: [],
          org_tasks: [],
          drafts: [],
          calendar_posts: [],
          assets: [],
        },
      });
    }

    const member = await requireActiveOrgMember(adminClient, organizationId, user.id);
    if (!ensureBrandProjectAccess(member, brandProjectId)) {
      return jsonResponse({ error: "You do not have access to this brand project." }, 403);
    }

    const searchLike = normalizeSearch(query);

    const [
      pipelineResult,
      taskResult,
      draftResult,
      calendarResult,
      assetResult,
    ] = await Promise.all([
      buildScopedQuery(
        adminClient
          .from("pipeline_items")
          .select("id, title, status, current_stage_order, current_assignee_role, brand_project_id, updated_at")
          .eq("organization_id", organizationId)
          .ilike("title", searchLike)
          .order("updated_at", { ascending: false })
          .limit(8),
        brandProjectId,
      ),
      buildScopedQuery(
        adminClient
          .from("org_tasks")
          .select("id, title, description, priority, due_at, status_id, brand_project_id, updated_at")
          .eq("organization_id", organizationId)
          .or(`title.ilike.${searchLike},description.ilike.${searchLike}`)
          .order("updated_at", { ascending: false })
          .limit(8),
        brandProjectId,
      ),
      buildScopedQuery(
        adminClient
          .from("posts")
          .select("id, title, caption, status, pipeline_item_id, brand_project_id, updated_at")
          .eq("organization_id", organizationId)
          .eq("status", "draft")
          .or(`title.ilike.${searchLike},caption.ilike.${searchLike}`)
          .order("updated_at", { ascending: false })
          .limit(8),
        brandProjectId,
      ),
      buildScopedQuery(
        adminClient
          .from("posts")
          .select("id, title, caption, status, pipeline_item_id, scheduled_at, brand_project_id, updated_at")
          .eq("organization_id", organizationId)
          .neq("status", "draft")
          .or(`title.ilike.${searchLike},caption.ilike.${searchLike}`)
          .order("updated_at", { ascending: false })
          .limit(8),
        brandProjectId,
      ),
      buildScopedQuery(
        adminClient
          .from("org_asset_library")
          .select("id, name, description, tags, approval_status, folder_id, brand_project_id, updated_at")
          .eq("organization_id", organizationId)
          .or(`name.ilike.${searchLike},description.ilike.${searchLike}`)
          .order("updated_at", { ascending: false })
          .limit(8),
        brandProjectId,
      ),
    ]);

    if (pipelineResult.error) throw pipelineResult.error;
    if (taskResult.error) throw taskResult.error;
    if (draftResult.error) throw draftResult.error;
    if (calendarResult.error) throw calendarResult.error;
    if (assetResult.error) throw assetResult.error;

    return jsonResponse({
      query,
      groups: {
        pipeline_items: safeArray(pipelineResult.data).map((item) => ({
          ...item,
          label: item.title || "Pipeline item",
        })),
        org_tasks: safeArray(taskResult.data).map((task) => ({
          ...task,
          label: task.title || "Task",
        })),
        drafts: safeArray(draftResult.data).map((post) => ({
          ...post,
          label: post.title || post.caption || "Draft",
        })),
        calendar_posts: safeArray(calendarResult.data).map((post) => ({
          ...post,
          label: post.title || post.caption || "Scheduled post",
        })),
        assets: safeArray(assetResult.data).map((asset) => ({
          ...asset,
          label: asset.name || "Asset",
        })),
      },
    });
  } catch (error) {
    console.error("[org-global-search] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
