import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient, createAuthClient, requireUser } from "../_shared/supabase.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, toErrorPayload } from "../_shared/http.ts";

type AdminScope = {
  adminRole: "super_admin" | "org_admin";
  organizationId: string | null;
  isSuperAdmin: boolean;
  isOrgAdmin: boolean;
};

type QueryFilters = {
  page: number;
  limit: number;
  userId: string | null;
  organizationId: string | null;
  assignedModeratorId: string | null;
  platform: string | null;
  status: string | null;
  mediaType: string | null;
  moderationStatus: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  qualityBand: string | null;
  search: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url?: string | null;
  organization_id: string | null;
  activity_status: string | null;
  last_active_at: string | null;
  created_at: string | null;
};

type OrganizationRow = {
  id: string;
  name: string | null;
};

type PostRow = {
  id: string;
  user_id: string;
  generation_id: string | null;
  account_id: string | null;
  assigned_moderator_id: string | null;
  caption: string | null;
  platform: string | null;
  status: string | null;
  moderation_status: string | null;
  scheduled_at: string | null;
  created_at: string | null;
  hashtags: string[] | null;
  delete_reason: string | null;
};

type GenerationRow = {
  id: string;
  user_id: string;
  prompt: string | null;
  media_type: string | null;
  storage_path: string | null;
  created_at: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
};

type QualityReviewRow = {
  id: string;
  generation_id: string | null;
  post_id: string | null;
  overall_score: number | null;
  recommended_action: string | null;
  confidence_level?: string | null;
  score_prompt_adherence?: number | null;
  score_brand_alignment?: number | null;
  score_visual_quality?: number | null;
  score_caption_relevance?: number | null;
  score_platform_fit?: number | null;
  score_hashtag_quality?: number | null;
  score_publish_readiness?: number | null;
  score_explanation?: Record<string, unknown> | null;
  risk_flags?: unknown;
  suggested_rewrite_instructions?: string | null;
  suggested_regen_direction?: string | null;
  created_at?: string | null;
};

type NormalizedContentItem = {
  id: string;
  data_type: "generation" | "draft" | "post";
  unified_date: string | null;
  unified_status: string;
  date_bucket: string;
  media_url: string | null;
  media_type: string | null;
  caption: string;
  hashtags: string[];
  platform: string | null;
  generation_id: string | null;
  post_id: string | null;
  prompt: string | null;
  account_id: string | null;
  assigned_moderator_id: string | null;
  user: {
    id: string;
    name: string;
    email: string | null;
    avatar_url?: string | null;
    activity_status: string;
  };
  organization: {
    id: string | null;
    name: string | null;
  };
  quality_review: QualityReviewRow | null;
  moderation_status: string;
  scheduled_at: string | null;
  created_at: string | null;
  metadata: Record<string, unknown> | null;
  delete_reason: string | null;
};

function parsePositiveInteger(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.round(parsed));
}

function normalizeText(value: string | null) {
  return String(value || "").trim();
}

function normalizeFilters(req: Request): QueryFilters {
  const url = new URL(req.url);
  const params = url.searchParams;

  return {
    page: parsePositiveInteger(params.get("page"), 1, 500),
    limit: parsePositiveInteger(params.get("limit"), 30, 100),
    userId: normalizeText(params.get("user_id")) || null,
    organizationId: normalizeText(params.get("organization_id")) || null,
    assignedModeratorId: normalizeText(params.get("assigned_moderator_id")) || null,
    platform: normalizeText(params.get("platform")).toLowerCase() || null,
    status: normalizeText(params.get("status")).toLowerCase() || null,
    mediaType: normalizeText(params.get("media_type")).toLowerCase() || null,
    moderationStatus: normalizeText(params.get("moderation_status")).toLowerCase() || null,
    dateFrom: normalizeText(params.get("date_from")) || null,
    dateTo: normalizeText(params.get("date_to")) || null,
    qualityBand: normalizeText(params.get("quality_band")).toLowerCase() || null,
    search: normalizeText(params.get("search")).toLowerCase(),
  };
}

function isSuperAdminRole(rawRole: string | null | undefined) {
  const normalized = String(rawRole || "").trim().toLowerCase();
  return normalized === "super_admin" || normalized === "superadmin" || normalized === "admin";
}

function isOrgAdminRole(rawRole: string | null | undefined) {
  return String(rawRole || "").trim().toLowerCase() === "org_admin";
}

async function resolveAdminScope(adminClient: ReturnType<typeof createAdminClient>, userId: string): Promise<AdminScope> {
  const [adminRoleResult, profileResult] = await Promise.all([
    adminClient
      .from("admin_roles")
      .select("role, organization_id")
      .eq("user_id", userId)
      .maybeSingle(),
    adminClient
      .from("profiles")
      .select("role, organization_id")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  if (adminRoleResult.error) throw adminRoleResult.error;
  if (profileResult.error) throw profileResult.error;

  const resolvedRole = adminRoleResult.data?.role || profileResult.data?.role || null;
  const organizationId = adminRoleResult.data?.organization_id ?? profileResult.data?.organization_id ?? null;

  if (isSuperAdminRole(resolvedRole)) {
    return {
      adminRole: "super_admin",
      organizationId,
      isSuperAdmin: true,
      isOrgAdmin: false,
    };
  }

  if (isOrgAdminRole(resolvedRole)) {
    return {
      adminRole: "org_admin",
      organizationId,
      isSuperAdmin: false,
      isOrgAdmin: true,
    };
  }

  throw new Error("Forbidden: admin access required");
}

function getMetadataValue(metadata: Record<string, unknown> | null | undefined, key: string) {
  if (!metadata || typeof metadata !== "object") return null;
  return metadata[key] ?? null;
}

function normalizeHashtags(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .map((entry) => (entry.startsWith("#") ? entry : `#${entry.replace(/^#+/, "")}`));
  }

  if (typeof input === "string") {
    return input
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith("#"))
      .map((entry) => (entry.startsWith("#") ? entry : `#${entry}`));
  }

  return [];
}

function getUnifiedDate(item: {
  unified_status: string;
  scheduled_at: string | null;
  created_at: string | null;
}) {
  if (item.unified_status === "scheduled" && item.scheduled_at) return item.scheduled_at;
  return item.created_at;
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function getDateBucket(value: string | null) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";

  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  const thisWeekStart = startOfWeek(now);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  if (target.getTime() === today.getTime()) return "today";
  if (target >= thisWeekStart) return "this_week";
  if (target >= lastWeekStart) return "last_week";

  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`;
}

function resolvePlatform(post: PostRow | null, generation: GenerationRow | null) {
  if (post?.platform) return post.platform.trim().toLowerCase();
  const metadata = generation?.metadata || null;
  const direct = getMetadataValue(metadata, "platform");
  if (typeof direct === "string" && direct.trim()) return direct.trim().toLowerCase();
  const platforms = getMetadataValue(metadata, "platforms");
  if (Array.isArray(platforms) && platforms.length > 0) {
    const first = String(platforms[0] || "").trim().toLowerCase();
    if (first) return first;
  }
  return null;
}

function getQualityBand(review: QualityReviewRow | null) {
  if (!review) return "not_scored";
  const recommended = String(review.recommended_action || "").trim().toLowerCase();
  if (recommended === "ready") return "ready";
  if (recommended === "minor_review") return "minor_review";
  if (recommended === "needs_revision") return "needs_revision";
  if (recommended === "regenerate_recommended") return "regenerate_recommended";

  const score = Number(review.overall_score);
  if (!Number.isFinite(score)) return "not_scored";
  if (score >= 85) return "ready";
  if (score >= 70) return "minor_review";
  if (score >= 50) return "needs_revision";
  return "regenerate_recommended";
}

function applyFilters(items: NormalizedContentItem[], filters: QueryFilters) {
  const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : null;
  const dateTo = filters.dateTo ? new Date(filters.dateTo) : null;

  if (dateFrom && !Number.isNaN(dateFrom.getTime())) {
    dateFrom.setHours(0, 0, 0, 0);
  }

  if (dateTo && !Number.isNaN(dateTo.getTime())) {
    dateTo.setHours(23, 59, 59, 999);
  }

  return items
    .filter((item) => {
      if (filters.userId && item.user.id !== filters.userId) return false;
      if (filters.organizationId && item.organization.id !== filters.organizationId) return false;
      if (filters.assignedModeratorId && item.assigned_moderator_id !== filters.assignedModeratorId) return false;
      if (filters.platform && String(item.platform || "").toLowerCase() !== filters.platform) return false;
      if (filters.status && item.unified_status !== filters.status) return false;
      if (filters.mediaType && String(item.media_type || "").toLowerCase() !== filters.mediaType) return false;
      if (filters.moderationStatus && item.moderation_status !== filters.moderationStatus) return false;
      if (filters.qualityBand && getQualityBand(item.quality_review) !== filters.qualityBand) return false;

      if (filters.search) {
        const caption = String(item.caption || "").toLowerCase();
        const generationId = String(item.generation_id || "").toLowerCase();
        const matchesSearch = caption.startsWith(filters.search) || generationId.includes(filters.search);
        if (!matchesSearch) return false;
      }

      if ((dateFrom || dateTo) && item.unified_date) {
        const itemDate = new Date(item.unified_date);
        if (Number.isNaN(itemDate.getTime())) return false;
        if (dateFrom && itemDate < dateFrom) return false;
        if (dateTo && itemDate > dateTo) return false;
      } else if (dateFrom || dateTo) {
        return false;
      }

      return true;
    })
    .sort((left, right) => {
      const leftTime = new Date(left.unified_date || left.created_at || 0).getTime();
      const rightTime = new Date(right.unified_date || right.created_at || 0).getTime();
      return rightTime - leftTime;
    });
}

function paginate<T>(rows: T[], page: number, limit: number) {
  const from = (page - 1) * limit;
  return rows.slice(from, from + limit);
}

function groupPageItems(items: NormalizedContentItem[]) {
  return items.reduce<Record<string, number>>((groups, item) => {
    groups[item.date_bucket] = (groups[item.date_bucket] || 0) + 1;
    return groups;
  }, {});
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authClient = createAuthClient(req.headers.get("Authorization"));
    const user = await requireUser(authClient);
    const adminClient = createAdminClient();
    const scope = await resolveAdminScope(adminClient, user.id);
    const filters = normalizeFilters(req);

    if (scope.isOrgAdmin && filters.organizationId && filters.organizationId !== scope.organizationId) {
      return jsonResponse({ data: [], count: 0, page: filters.page, groups: {} });
    }

    let profilesQuery = adminClient
      .from("profiles")
      .select("id, full_name, email, avatar_url, organization_id, activity_status, last_active_at, created_at");

    if (scope.isOrgAdmin && scope.organizationId) {
      profilesQuery = profilesQuery.eq("organization_id", scope.organizationId);
    } else if (filters.organizationId) {
      profilesQuery = profilesQuery.eq("organization_id", filters.organizationId);
    }

    if (filters.userId) {
      profilesQuery = profilesQuery.eq("id", filters.userId);
    }

    const profilesResult = await profilesQuery;
    if (profilesResult.error) throw profilesResult.error;

    const profiles = (profilesResult.data || []) as ProfileRow[];
    const userIds = profiles.map((profile) => profile.id);

    if (!userIds.length) {
      return jsonResponse({ data: [], count: 0, page: filters.page, groups: {} });
    }

    const [postsResult, generationsResult] = await Promise.all([
      adminClient
        .from("posts")
        .select("id, user_id, generation_id, account_id, assigned_moderator_id, caption, platform, status, moderation_status, scheduled_at, created_at, hashtags, delete_reason")
        .in("user_id", userIds)
        .order("created_at", { ascending: false }),
      adminClient
        .from("generations")
        .select("id, user_id, prompt, media_type, storage_path, created_at, status, metadata")
        .in("user_id", userIds)
        .order("created_at", { ascending: false }),
    ]);

    if (postsResult.error) throw postsResult.error;
    if (generationsResult.error) throw generationsResult.error;

    const posts = (postsResult.data || []) as PostRow[];
    const generations = (generationsResult.data || []) as GenerationRow[];
    const generationIds = [
      ...new Set(
        [...posts.map((post) => post.generation_id), ...generations.map((generation) => generation.id)]
          .filter(Boolean),
      ),
    ] as string[];

    const organizationIds = [
      ...new Set(profiles.map((profile) => profile.organization_id).filter(Boolean)),
    ] as string[];

    const [qualityResult, organizationsResult] = await Promise.all([
      generationIds.length
        ? adminClient
            .from("content_quality_reviews")
            .select(`
              id,
              generation_id,
              post_id,
              overall_score,
              recommended_action,
              confidence_level,
              score_prompt_adherence,
              score_brand_alignment,
              score_visual_quality,
              score_caption_relevance,
              score_platform_fit,
              score_hashtag_quality,
              score_publish_readiness,
              score_explanation,
              risk_flags,
              suggested_rewrite_instructions,
              suggested_regen_direction,
              created_at
            `)
            .in("generation_id", generationIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      organizationIds.length
        ? adminClient
            .from("organizations")
            .select("id, name")
            .in("id", organizationIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (qualityResult.error) throw qualityResult.error;
    if (organizationsResult.error) throw organizationsResult.error;

    const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
    const organizationMap = new Map(
      ((organizationsResult.data || []) as OrganizationRow[]).map((organization) => [organization.id, organization]),
    );
    const generationMap = new Map(generations.map((generation) => [generation.id, generation]));

    const qualityMap = new Map<string, QualityReviewRow>();
    ((qualityResult.data || []) as QualityReviewRow[]).forEach((review) => {
      const key = review.post_id || review.generation_id;
      if (key && !qualityMap.has(key)) {
        qualityMap.set(key, review);
      }
    });

    const generationsWithPosts = new Set(posts.map((post) => post.generation_id).filter(Boolean));
    const normalized: NormalizedContentItem[] = [];

    posts.forEach((post) => {
      const generation = post.generation_id ? generationMap.get(post.generation_id) || null : null;
      const metadata = generation?.metadata || null;
      const profile = profileMap.get(post.user_id);
      if (!profile) return;

      const organization = profile.organization_id ? organizationMap.get(profile.organization_id) || null : null;
      const captionFromMetadata = getMetadataValue(metadata, "caption");
      const caption = String(post.caption || captionFromMetadata || generation?.prompt || "Untitled post").trim();
      const hashtags = normalizeHashtags(post.hashtags || getMetadataValue(metadata, "hashtags"));
      const quality = qualityMap.get(post.id) || (post.generation_id ? qualityMap.get(post.generation_id) || null : null);
      const unifiedStatus = String(post.status || "draft").toLowerCase() || "draft";
      const baseItem = {
        unified_status: unifiedStatus,
        scheduled_at: post.scheduled_at,
        created_at: post.created_at,
      };
      const unifiedDate = getUnifiedDate(baseItem);

      normalized.push({
        id: `post:${post.id}`,
        data_type: unifiedStatus === "draft" ? "draft" : "post",
        unified_date: unifiedDate,
        unified_status: unifiedStatus,
        date_bucket: getDateBucket(unifiedDate),
        media_url: generation?.storage_path || null,
        media_type: generation?.media_type || null,
        caption,
        hashtags,
        platform: resolvePlatform(post, generation),
        generation_id: post.generation_id,
        post_id: post.id,
        prompt: generation?.prompt || null,
        account_id: post.account_id,
        assigned_moderator_id: post.assigned_moderator_id || null,
        user: {
          id: profile.id,
          name: profile.full_name || profile.email || profile.id,
          email: profile.email || null,
          avatar_url: profile.avatar_url || null,
          activity_status: profile.activity_status || "inactive",
        },
        organization: {
          id: profile.organization_id || null,
          name: organization?.name || null,
        },
        quality_review: quality,
        moderation_status: String(post.moderation_status || "none").toLowerCase() || "none",
        scheduled_at: post.scheduled_at,
        created_at: post.created_at,
        metadata,
        delete_reason: post.delete_reason,
      });
    });

    generations.forEach((generation) => {
      if (generationsWithPosts.has(generation.id)) return;

      const metadata = generation.metadata || null;
      const profile = profileMap.get(generation.user_id);
      if (!profile) return;
      const organization = profile.organization_id ? organizationMap.get(profile.organization_id) || null : null;
      const caption = String(
        getMetadataValue(metadata, "caption") || generation.prompt || "Untitled draft",
      ).trim();
      const quality = qualityMap.get(generation.id) || null;
      const generationStatus = String(generation.status || "completed").toLowerCase();
      const unifiedStatus = generationStatus === "failed" ? "failed" : "draft";
      const unifiedDate = generation.created_at;

      normalized.push({
        id: `generation:${generation.id}`,
        data_type: "generation",
        unified_date: unifiedDate,
        unified_status: unifiedStatus,
        date_bucket: getDateBucket(unifiedDate),
        media_url: generation.storage_path || null,
        media_type: generation.media_type || null,
        caption,
        hashtags: normalizeHashtags(getMetadataValue(metadata, "hashtags")),
        platform: resolvePlatform(null, generation),
        generation_id: generation.id,
        post_id: null,
        prompt: generation.prompt || null,
        account_id: null,
        assigned_moderator_id: null,
        user: {
          id: profile.id,
          name: profile.full_name || profile.email || profile.id,
          email: profile.email || null,
          avatar_url: profile.avatar_url || null,
          activity_status: profile.activity_status || "inactive",
        },
        organization: {
          id: profile.organization_id || null,
          name: organization?.name || null,
        },
        quality_review: quality,
        moderation_status: "none",
        scheduled_at: null,
        created_at: generation.created_at,
        metadata,
        delete_reason: null,
      });
    });

    const filtered = applyFilters(normalized, filters);
    const pageItems = paginate(filtered, filters.page, filters.limit);

    return jsonResponse({
      data: pageItems,
      count: filtered.length,
      page: filters.page,
      groups: groupPageItems(pageItems),
    });
  } catch (error) {
    console.error("[admin-list-posts] error", error);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
