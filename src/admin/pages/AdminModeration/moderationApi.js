import { POST_STATUS } from "../../../constants/statuses";
import { ensureLibraryRowsForPosts } from "../../../services/contentLibraryService";
import { getSupabaseFunctionUrl, isSupabaseConfigured, supabaseAnonKey } from "../../../services/supabaseConfig";
import { supabase } from "../../../services/supabaseClient";
import { fetchOrganizationsByIds, insertAuditLog } from "../../utils/adminClient";

export const MODERATION_PAGE_SIZE = 30;

export const PLATFORM_OPTIONS = [
  { value: "all", label: "All Platforms" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
];

export const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
  { value: "failed", label: "Failed" },
];

export const MODERATION_STATUS_OPTIONS = [
  { value: "all", label: "All Moderation" },
  { value: "none", label: "None" },
  { value: "flagged", label: "Flagged" },
  { value: "under_review", label: "Under Review" },
  { value: "approved", label: "Approved" },
  { value: "archived", label: "Archived" },
  { value: "pending_deletion", label: "Pending Deletion" },
];

export const QUALITY_BAND_OPTIONS = [
  { value: "all", label: "All Quality Bands" },
  { value: "ready", label: "Ready" },
  { value: "minor_review", label: "Minor Review" },
  { value: "needs_revision", label: "Needs Revision" },
  { value: "regenerate_recommended", label: "Regenerate" },
  { value: "not_scored", label: "Not Scored" },
];

export const DELETE_REASON_OPTIONS = [
  { value: "brand_mismatch", label: "Brand Mismatch" },
  { value: "policy_violation", label: "Policy Violation" },
  { value: "duplicate", label: "Duplicate" },
  { value: "user_request", label: "User Request" },
  { value: "broken_media", label: "Broken Media" },
  { value: "other", label: "Other" },
];

export const FORCE_REASON_OPTIONS = [
  { value: "campaign_deadline", label: "Campaign Deadline" },
  { value: "manual_override", label: "Manual Override" },
  { value: "recovery_action", label: "Recovery Action" },
  { value: "customer_request", label: "Customer Request" },
  { value: "other", label: "Other" },
];

export const REGENERATION_MODE_OPTIONS = [
  { value: "caption_only", label: "Caption Only" },
  { value: "media_only", label: "Media Only" },
  { value: "full_post", label: "Full Post" },
  { value: "hashtag_optimization", label: "Hashtag Optimization" },
];

export const QUALITY_BREAKDOWN_FIELDS = [
  { key: "score_prompt_adherence", label: "Prompt Adherence" },
  { key: "score_brand_alignment", label: "Brand Alignment" },
  { key: "score_visual_quality", label: "Visual Quality" },
  { key: "score_caption_relevance", label: "Caption Relevance" },
  { key: "score_platform_fit", label: "Platform Fit" },
  { key: "score_hashtag_quality", label: "Hashtag Quality" },
  { key: "score_publish_readiness", label: "Publish Readiness" },
];

export const PLATFORM_CHAR_LIMITS = {
  instagram: 2200,
  tiktok: 2200,
  youtube: 5000,
  facebook: 63206,
};

export const PLATFORM_HASHTAG_GUIDANCE = {
  instagram: { min: 3, max: 5, label: "3-5 recommended" },
  tiktok: { min: 3, max: 5, label: "3-5 recommended" },
  youtube: { min: 0, max: 15, label: "Up to 15" },
  facebook: { min: 2, max: 3, label: "2-3 recommended" },
};

const DATE_BUCKET_ORDER = {
  today: 0,
  this_week: 1,
  last_week: 2,
};

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizePlatformValue(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized || null;
}

export function normalizeHashtags(input) {
  if (Array.isArray(input)) {
    return input
      .map((entry) => normalizeString(entry))
      .filter(Boolean)
      .map((entry) => (entry.startsWith("#") ? entry : `#${entry.replace(/^#+/, "")}`));
  }

  if (typeof input === "string") {
    return input
      .split(/[,\n\r\s]+/)
      .map((entry) => normalizeString(entry))
      .filter(Boolean)
      .map((entry) => (entry.startsWith("#") ? entry : `#${entry.replace(/^#+/, "")}`));
  }

  return [];
}

export function buildCaptionWithHashtags(caption = "", hashtags = []) {
  const cleanCaption = normalizeString(caption);
  const normalizedTags = normalizeHashtags(hashtags);
  if (!normalizedTags.length) return cleanCaption;
  return [cleanCaption, normalizedTags.join(" ")].filter(Boolean).join("\n\n");
}

export function stripHashtagsFromCaption(caption = "") {
  return String(caption || "")
    .replace(/\s*#[\w_]+/g, "")
    .trim();
}

export function formatCaptionSnippet(caption = "", max = 40) {
  const value = normalizeString(caption);
  if (!value) return "No caption";
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

export function getQualityBandMeta(reviewOrScore) {
  const review = typeof reviewOrScore === "object" && reviewOrScore !== null
    ? reviewOrScore
    : { overall_score: reviewOrScore };
  const rawScore = Number(review?.overall_score);
  const recommended = normalizeString(review?.recommended_action).toLowerCase();

  if (!Number.isFinite(rawScore)) {
    return {
      key: "not_scored",
      tone: "neutral",
      label: "Not Scored",
      shortLabel: "Not Scored",
      scoreText: "-",
    };
  }

  if (recommended === "ready" || rawScore >= 85) {
    return { key: "ready", tone: "success", label: "Ready", shortLabel: "Ready", scoreText: String(Math.round(rawScore)) };
  }
  if (recommended === "minor_review" || rawScore >= 70) {
    return { key: "minor_review", tone: "positive", label: "Minor Review", shortLabel: "Minor", scoreText: String(Math.round(rawScore)) };
  }
  if (recommended === "needs_revision" || rawScore >= 50) {
    return { key: "needs_revision", tone: "warning", label: "Needs Revision", shortLabel: "Revision", scoreText: String(Math.round(rawScore)) };
  }
  return {
    key: "regenerate_recommended",
    tone: "danger",
    label: "Regenerate",
    shortLabel: "Regenerate",
    scoreText: String(Math.round(rawScore)),
  };
}

export function getStatusMeta(status) {
  const normalized = normalizeString(status).toLowerCase() || POST_STATUS.DRAFT;
  switch (normalized) {
    case POST_STATUS.SCHEDULED:
      return { key: normalized, label: "Scheduled", tone: "positive" };
    case POST_STATUS.PUBLISHED:
      return { key: normalized, label: "Published", tone: "success" };
    case POST_STATUS.FAILED:
      return { key: normalized, label: "Failed", tone: "danger" };
    default:
      return { key: POST_STATUS.DRAFT, label: "Draft", tone: "warning" };
  }
}

export function getModerationMeta(status) {
  const normalized = normalizeString(status).toLowerCase() || "none";
  switch (normalized) {
    case "approved":
      return { key: normalized, label: "Approved", tone: "success" };
    case "flagged":
      return { key: normalized, label: "Flagged", tone: "danger" };
    case "under_review":
      return { key: normalized, label: "Under Review", tone: "warning" };
    case "archived":
      return { key: normalized, label: "Archived", tone: "neutral" };
    case "pending_deletion":
      return { key: normalized, label: "Pending Deletion", tone: "danger" };
    default:
      return { key: "none", label: "None", tone: "neutral" };
  }
}

function startOfWeek(date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function getDateBucket(dateValue) {
  const date = new Date(dateValue);
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

function formatBucketLabel(bucket, sampleDate) {
  if (bucket === "today") {
    return `Today - ${new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(sampleDate))}`;
  }
  if (bucket === "this_week") return "This Week";
  if (bucket === "last_week") return "Last Week";
  const date = new Date(sampleDate);
  if (Number.isNaN(date.getTime())) return "Earlier";
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
}

export function groupModerationItems(items = []) {
  const grouped = new Map();

  items.forEach((item) => {
    const key = item.date_bucket || getDateBucket(item.unified_date || item.created_at);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(item);
  });

  return [...grouped.entries()]
    .map(([key, rows]) => ({
      key,
      label: formatBucketLabel(key, rows[0]?.unified_date || rows[0]?.created_at),
      rows,
      sortKey: DATE_BUCKET_ORDER[key] ?? 10,
      timestamp: new Date(rows[0]?.unified_date || rows[0]?.created_at || 0).getTime(),
      expandedByDefault: key === "today" || key === "this_week",
    }))
    .sort((left, right) => {
      if (left.sortKey !== right.sortKey) return left.sortKey - right.sortKey;
      return right.timestamp - left.timestamp;
    });
}

export function resolveItemMediaUrl(item) {
  return item?.media_url || item?.storage_path || item?.selectedLibraryAsset?.public_url || item?.selectedLibraryAsset?.thumbnail_url || null;
}

export function getDisplayPlatforms(item, connectedAccounts = []) {
  if (Array.isArray(connectedAccounts) && connectedAccounts.length > 0) {
    return connectedAccounts.map((account) => account.platform).filter(Boolean);
  }
  if (Array.isArray(item?.platforms) && item.platforms.length > 0) return item.platforms;
  return item?.platform ? [item.platform] : [];
}

function normalizeQueryValue(value) {
  if (value === undefined || value === null) return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "" || normalized === "all") return null;
  return normalized;
}

function sanitizeModerationQuery(filters = {}) {
  return Object.fromEntries(
    Object.entries(filters).flatMap(([key, value]) => {
      const normalized = normalizeQueryValue(value);
      return normalized === null ? [] : [[key, normalized]];
    }),
  );
}

async function getFunctionHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data?.session?.access_token) {
    throw new Error("Missing authenticated session");
  }

  return {
    Authorization: `Bearer ${data.session.access_token}`,
    apikey: supabaseAnonKey,
    "Content-Type": "application/json",
  };
}

function buildQueryParams(filters = {}) {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    const normalized = normalizeQueryValue(value);
    if (normalized === null) return;
    params.set(key, String(normalized));
  });

  return params;
}

function isMissingFunctionError(error) {
  const text = `${error?.status || ""} ${error?.message || ""} ${error?.cause?.message || ""}`.toLowerCase();
  return text.includes("404")
    || text.includes("not found")
    || text.includes("405")
    || text.includes("failed to fetch")
    || text.includes("load failed")
    || text.includes("networkerror")
    || text.includes("err_failed")
    || text.includes("cors");
}

let hasWarnedAboutAdminPostsFallback = false;

function tryParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeErrorMessage(text, fallback) {
  const value = normalizeString(text);
  if (!value) return fallback;
  if (value.startsWith("<")) {
    return fallback;
  }
  return value;
}

export async function requestModerationFunction(functionName, { method = "POST", query, body } = {}) {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase functions are not configured");
  }

  const headers = await getFunctionHeaders();
  const url = new URL(getSupabaseFunctionUrl(functionName));

  if (query) {
    const params = buildQueryParams(query);
    url.search = params.toString();
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  const payload = tryParseJson(text);

  if (!response.ok) {
    const errorMessage = payload?.error
      || payload?.message
      || normalizeErrorMessage(text, `${functionName} failed`);
    const error = new Error(errorMessage);
    error.status = response.status;
    throw error;
  }

  return payload || {};
}

function normalizeFallbackItem(raw) {
  const quality = raw.quality_review || null;
  return {
    ...raw,
    caption: raw.caption || raw.prompt || "Untitled post",
    hashtags: normalizeHashtags(raw.hashtags),
    date_bucket: raw.date_bucket || getDateBucket(raw.unified_date || raw.created_at),
    quality_review: quality,
    moderation_status: raw.moderation_status || "none",
    assigned_moderator_id: raw.assigned_moderator_id || null,
    user: {
      ...raw.user,
      name: raw.user?.name || raw.user?.full_name || raw.user?.email || raw.user?.id || "Unknown User",
      activity_status: raw.user?.activity_status || "inactive",
    },
  };
}

function getMetadataValue(metadata, key) {
  if (!metadata || typeof metadata !== "object") return null;
  return metadata[key] ?? null;
}

function getQualityBandKey(review) {
  return getQualityBandMeta(review).key;
}

function filterNormalizedItems(rows, filters) {
  const from = filters.date_from ? new Date(filters.date_from) : null;
  const to = filters.date_to ? new Date(filters.date_to) : null;

  if (from && !Number.isNaN(from.getTime())) {
    from.setHours(0, 0, 0, 0);
  }
  if (to && !Number.isNaN(to.getTime())) {
    to.setHours(23, 59, 59, 999);
  }

  return rows
    .filter((item) => {
      if (filters.user_id && item.user?.id !== filters.user_id) return false;
      if (filters.organization_id && item.organization?.id !== filters.organization_id) return false;
      if (filters.assigned_moderator_id && item.assigned_moderator_id !== filters.assigned_moderator_id) return false;
      if (filters.status && item.unified_status !== filters.status) return false;
      if (filters.platform && item.platform !== filters.platform) return false;
      if (filters.media_type && item.media_type !== filters.media_type) return false;
      if (filters.moderation_status && item.moderation_status !== filters.moderation_status) return false;
      if (filters.quality_band && getQualityBandKey(item.quality_review) !== filters.quality_band) return false;
      if (filters.search) {
        const term = filters.search.toLowerCase();
        const caption = String(item.caption || "").toLowerCase();
        const generationId = String(item.generation_id || "").toLowerCase();
        if (!caption.startsWith(term) && !generationId.includes(term)) return false;
      }
      if ((from || to) && item.unified_date) {
        const date = new Date(item.unified_date);
        if (Number.isNaN(date.getTime())) return false;
        if (from && date < from) return false;
        if (to && date > to) return false;
      } else if (from || to) {
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

async function fetchAdminPostsFallback({ adminAccess, page, limit, filters }) {
  let profilesQuery = supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url, organization_id, activity_status, last_active_at, created_at");

  if (adminAccess?.isOrgAdmin) {
    profilesQuery = profilesQuery.eq("organization_id", adminAccess.organizationId);
  } else if (filters.organization_id) {
    profilesQuery = profilesQuery.eq("organization_id", filters.organization_id);
  }

  if (filters.user_id) {
    profilesQuery = profilesQuery.eq("id", filters.user_id);
  }

  const profilesResult = await profilesQuery;
  if (profilesResult.error) throw profilesResult.error;

  const profiles = profilesResult.data || [];
  const userIds = profiles.map((profile) => profile.id);
  if (!userIds.length) {
    return { data: [], count: 0, page };
  }

  const [postsResult, generationsResult, organizationMap] = await Promise.all([
    supabase
      .from("posts")
      .select("id, user_id, generation_id, account_id, assigned_moderator_id, caption, platform, status, moderation_status, scheduled_at, created_at, hashtags, delete_reason")
      .in("user_id", userIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("generations")
      .select("id, user_id, prompt, media_type, storage_path, created_at, status, metadata")
      .in("user_id", userIds)
      .order("created_at", { ascending: false }),
    fetchOrganizationsByIds(profiles.map((profile) => profile.organization_id).filter(Boolean)),
  ]);

  if (postsResult.error) throw postsResult.error;
  if (generationsResult.error) throw generationsResult.error;

  const posts = postsResult.data || [];
  const generations = generationsResult.data || [];
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const generationMap = new Map(generations.map((generation) => [generation.id, generation]));
  const generationIds = [...new Set([...generations.map((item) => item.id), ...posts.map((item) => item.generation_id).filter(Boolean)])];

  const qualityResult = generationIds.length
    ? await supabase
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
    : { data: [], error: null };

  if (qualityResult.error) throw qualityResult.error;

  const qualityMap = new Map();
  (qualityResult.data || []).forEach((review) => {
    const key = review.post_id || review.generation_id;
    if (key && !qualityMap.has(key)) {
      qualityMap.set(key, review);
    }
  });

  const rows = [];
  const generationsWithPosts = new Set(posts.map((post) => post.generation_id).filter(Boolean));

  posts.forEach((post) => {
    const profile = profileMap.get(post.user_id);
    if (!profile) return;
    const generation = generationMap.get(post.generation_id) || null;
    const metadata = generation?.metadata || null;
    const quality = qualityMap.get(post.id) || qualityMap.get(post.generation_id) || null;
    const unifiedStatus = post.status || POST_STATUS.DRAFT;
    const unifiedDate = unifiedStatus === POST_STATUS.SCHEDULED ? post.scheduled_at : post.created_at;

    rows.push(normalizeFallbackItem({
      id: `post:${post.id}`,
      data_type: unifiedStatus === POST_STATUS.DRAFT ? "draft" : "post",
      unified_date: unifiedDate,
      unified_status: unifiedStatus,
      media_url: generation?.storage_path || null,
      media_type: generation?.media_type || null,
      caption: post.caption || getMetadataValue(metadata, "caption") || generation?.prompt || "Untitled post",
      hashtags: post.hashtags || getMetadataValue(metadata, "hashtags"),
      platform: normalizePlatformValue(post.platform || getMetadataValue(metadata, "platform")),
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
        name: organizationMap.get(profile.organization_id)?.name || null,
      },
      quality_review: quality,
      moderation_status: post.moderation_status || "none",
      scheduled_at: post.scheduled_at,
      created_at: post.created_at,
      metadata,
      delete_reason: post.delete_reason,
    }));
  });

  generations.forEach((generation) => {
    if (generationsWithPosts.has(generation.id)) return;
    const profile = profileMap.get(generation.user_id);
    if (!profile) return;
    const quality = qualityMap.get(generation.id) || null;
    const metadata = generation.metadata || null;
    const generationStatus = normalizeString(generation.status).toLowerCase();

    rows.push(normalizeFallbackItem({
      id: `generation:${generation.id}`,
      data_type: "generation",
      unified_date: generation.created_at,
      unified_status: generationStatus === "failed" ? "failed" : POST_STATUS.DRAFT,
      media_url: generation.storage_path || null,
      media_type: generation.media_type || null,
      caption: getMetadataValue(metadata, "caption") || generation.prompt || "Untitled draft",
      hashtags: getMetadataValue(metadata, "hashtags"),
      platform: normalizePlatformValue(getMetadataValue(metadata, "platform")),
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
        name: organizationMap.get(profile.organization_id)?.name || null,
      },
      quality_review: quality,
      moderation_status: "none",
      scheduled_at: null,
      created_at: generation.created_at,
      metadata,
      delete_reason: null,
    }));
  });

  const filtered = filterNormalizedItems(rows, filters);
  const from = (page - 1) * limit;
  const data = filtered.slice(from, from + limit);

  return {
    data,
    count: filtered.length,
    page,
  };
}

export async function fetchAdminPostsPage({ adminAccess, page = 1, limit = MODERATION_PAGE_SIZE, filters = {} }) {
  const query = sanitizeModerationQuery({
    page,
    limit,
    user_id: filters.userId,
    organization_id: filters.organizationId,
    status: filters.status,
    platform: filters.platform,
    media_type: filters.mediaType,
    moderation_status: filters.moderationStatus,
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    quality_band: filters.qualityBand,
    search: filters.search,
    assigned_moderator_id: filters.assignedModeratorId,
  });

  try {
    const payload = await requestModerationFunction("admin-list-posts", {
      method: "GET",
      query,
    });

    return {
      ...payload,
      data: (payload?.data || []).map(normalizeFallbackItem),
    };
  } catch (error) {
    if (!isMissingFunctionError(error)) {
      throw error;
    }
    if (!hasWarnedAboutAdminPostsFallback) {
      hasWarnedAboutAdminPostsFallback = true;
      console.warn(
        "[admin-moderation] Falling back to direct Supabase queries because the admin-list-posts edge function is unavailable.",
        error,
      );
    }
    return fetchAdminPostsFallback({ adminAccess, page, limit, filters: query });
  }
}

export async function fetchModerationFilterOptions(adminAccess) {
  if (!adminAccess?.isAdmin) {
    return { users: [], organizations: [], admins: [] };
  }

  let usersQuery = supabase
    .from("profiles")
    .select("id, full_name, email, organization_id, activity_status, avatar_url");

  if (adminAccess.isOrgAdmin) {
    usersQuery = usersQuery.eq("organization_id", adminAccess.organizationId);
  }

  const [usersResult, organizationsResult, adminRolesResult] = await Promise.all([
    usersQuery.order("full_name", { ascending: true }),
    adminAccess.isSuperAdmin
      ? supabase.from("organizations").select("id, name").order("name", { ascending: true })
      : Promise.resolve({ data: [] }),
    supabase.from("admin_roles").select("user_id, role, organization_id"),
  ]);

  if (usersResult.error) throw usersResult.error;
  if (organizationsResult.error) throw organizationsResult.error;
  if (adminRolesResult.error) throw adminRolesResult.error;

  const userMap = new Map((usersResult.data || []).map((row) => [row.id, row]));
  const admins = (adminRolesResult.data || [])
    .map((row) => {
      const profile = userMap.get(row.user_id);
      if (!profile) return null;
      if (adminAccess.isOrgAdmin && row.organization_id && row.organization_id !== adminAccess.organizationId) {
        return null;
      }
      return {
        id: row.user_id,
        name: profile.full_name || profile.email || row.user_id,
        email: profile.email || null,
        role: row.role,
      };
    })
    .filter(Boolean);

  return {
    users: usersResult.data || [],
    organizations: organizationsResult.data || [],
    admins,
  };
}

export async function fetchQualityReviewDetail(item) {
  if (!item?.generation_id && !item?.post_id) return null;

  let query = supabase
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
    .order("created_at", { ascending: false })
    .limit(1);

  if (item.post_id) {
    query = query.eq("post_id", item.post_id);
  } else {
    query = query.eq("generation_id", item.generation_id);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || item.quality_review || null;
}

export async function fetchConnectedAccountsForUser(userId) {
  if (!userId) return [];

  const { data, error } = await supabase
    .from("connected_accounts")
    .select("id, user_id, platform, account_name, username, connection_status, created_at")
    .eq("user_id", userId)
    .in("connection_status", ["active", "mock", "expired"])
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function fetchUserMediaAssets(userId) {
  if (!userId) return [];

  const { data, error } = await supabase
    .from("media_assets")
    .select("id, public_url, thumbnail_url, file_name, file_type, mime_type, platform_targets, created_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(24);

  if (error) {
    if (error.code === "42P01") return [];
    throw error;
  }

  return data || [];
}

async function fetchGenerationPosts(userId, generationId) {
  if (!userId || !generationId) return [];
  const { data, error } = await supabase
    .from("posts")
    .select("id, user_id, generation_id, account_id, assigned_moderator_id, caption, platform, status, moderation_status, scheduled_at, hashtags, created_at")
    .eq("user_id", userId)
    .eq("generation_id", generationId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function ensurePostForItem(item, options = {}) {
  if (item?.post_id) {
    return {
      post: {
        id: item.post_id,
        user_id: item.user?.id,
        generation_id: item.generation_id,
        account_id: item.account_id || null,
        assigned_moderator_id: item.assigned_moderator_id || null,
        caption: item.caption || "",
        platform: item.platform || options.platform || null,
        status: item.unified_status || POST_STATUS.DRAFT,
        moderation_status: item.moderation_status || "none",
        scheduled_at: item.scheduled_at || null,
        hashtags: normalizeHashtags(item.hashtags),
      },
      created: false,
    };
  }

  if (!item?.generation_id || !item?.user?.id) {
    throw new Error("This item does not have a schedulable generation");
  }

  const existing = await fetchGenerationPosts(item.user.id, item.generation_id);
  const reusable = existing.find((row) => row.status === POST_STATUS.DRAFT) || existing[0];
  if (reusable) {
    return { post: reusable, created: false };
  }

  const { data, error } = await supabase
    .from("posts")
    .insert({
      user_id: item.user.id,
      generation_id: item.generation_id,
        account_id: options.accountId || null,
        assigned_moderator_id: item.assigned_moderator_id || null,
        caption: buildCaptionWithHashtags(item.caption || item.prompt || "", item.hashtags),
      platform: options.platform || item.platform || null,
      status: POST_STATUS.DRAFT,
      moderation_status: item.moderation_status || "none",
      scheduled_at: null,
      hashtags: normalizeHashtags(item.hashtags),
    })
    .select("id, user_id, generation_id, account_id, assigned_moderator_id, caption, platform, status, moderation_status, scheduled_at, hashtags, created_at")
    .single();

  if (error) throw error;
  await ensureLibraryRowsForPosts([data]);

  return { post: data, created: true };
}

function buildAuditSnapshot(item, overrides = {}) {
  return {
    caption: item?.caption || "",
    hashtags: normalizeHashtags(item?.hashtags),
    platform: item?.platform || null,
    account_id: item?.account_id || null,
    assigned_moderator_id: item?.assigned_moderator_id || null,
    status: item?.unified_status || item?.status || POST_STATUS.DRAFT,
    moderation_status: item?.moderation_status || "none",
    scheduled_at: item?.scheduled_at || null,
    media_url: resolveItemMediaUrl(item),
    generation_id: item?.generation_id || null,
    post_id: item?.post_id || null,
    ...overrides,
  };
}

function buildAuditBase(adminAccess, item, eventType, riskLevel, previousValue, newValue, summary, metadata = {}) {
  return {
    actor_id: adminAccess.user.id,
    actor_type: "admin",
    actor_role: adminAccess.adminRole,
    organization_id: item?.organization?.id || adminAccess.organizationId || null,
    event_category: eventType.includes("publish") || eventType.includes("schedule")
      ? "scheduling_publishing"
      : "admin_action",
    event_type: eventType,
    entity_type: "post",
    entity_id: item?.post_id || item?.generation_id || item?.id || null,
    summary,
    previous_value: previousValue,
    new_value: newValue,
    metadata,
    risk_level: riskLevel,
    correlation_id: crypto.randomUUID(),
  };
}

export async function saveModerationEdits({ adminAccess, item, values }) {
  const caption = normalizeString(values.caption);
  const hashtags = normalizeHashtags(values.hashtags);
  const scheduledAt = values.scheduledAt || null;
  const selectedTargets = (values.connectedAccounts || [])
    .filter((account) => (values.selectedAccountIds || []).includes(account.id))
    .map((account) => ({
      accountId: account.id,
      platform: normalizePlatformValue(account.platform),
    }));
  const primaryTarget = selectedTargets[0] || null;
  const metadataPlatforms = [...new Set(selectedTargets.map((target) => target.platform).filter(Boolean))];
  const nextPlatform = primaryTarget?.platform || normalizePlatformValue(values.platform) || item.platform || null;
  const nextAccountId = primaryTarget?.accountId || item.account_id || null;
  const previousValue = buildAuditSnapshot(item);
  const mergedMetadata = {
    ...(item.metadata || {}),
    caption,
    hashtags,
    platform: nextPlatform,
    ...(metadataPlatforms.length ? { platforms: metadataPlatforms } : {}),
  };

  if (item.data_type === "generation" && item.generation_id) {
    const { error } = await supabase
      .from("generations")
      .update({ metadata: mergedMetadata })
      .eq("id", item.generation_id);

    if (error) throw error;
  } else {
    const ensured = await ensurePostForItem(item, { platform: nextPlatform });
    const { error } = await supabase
      .from("posts")
      .update({
        caption,
        hashtags,
        scheduled_at: scheduledAt,
        platform: nextPlatform,
        account_id: nextAccountId,
      })
      .eq("id", ensured.post.id);

    if (error) throw error;

    if (item.generation_id && item.data_type === "draft") {
      const { error: generationError } = await supabase
        .from("generations")
        .update({ metadata: mergedMetadata })
        .eq("id", item.generation_id);
      if (generationError) throw generationError;
    }
  }

  await insertAuditLog(
    buildAuditBase(
      adminAccess,
      item,
      "post_edited",
      "low",
      previousValue,
      buildAuditSnapshot(item, {
        caption,
        hashtags,
        scheduled_at: scheduledAt,
        platform: nextPlatform,
        account_id: nextAccountId,
      }),
      `Edited moderation content for ${item.user?.name || item.user?.email || "user"}`,
    ),
  );
}

function getPlatformTargets(selectedAccountIds = [], connectedAccounts = [], fallbackPlatform = null, options = {}) {
  const { allowFallbackPlatform = false } = options;
  const chosenAccounts = connectedAccounts.filter((account) => selectedAccountIds.includes(account.id));
  if (chosenAccounts.length > 0) {
    return chosenAccounts.map((account) => ({
      accountId: account.id,
      platform: normalizePlatformValue(account.platform),
      connectionStatus: account.connection_status,
    }));
  }
  if (allowFallbackPlatform && fallbackPlatform) {
    return [{ accountId: null, platform: normalizePlatformValue(fallbackPlatform), connectionStatus: "active" }];
  }
  return [];
}

export function calculateReadinessChecks({ item, mode, selectedAccountIds = [], connectedAccounts = [], scheduledAt }) {
  const platforms = getPlatformTargets(selectedAccountIds, connectedAccounts, item.platform, { allowFallbackPlatform: false });
  const caption = normalizeString(item.caption);
  const hashtags = normalizeHashtags(item.hashtags);
  const quality = getQualityBandMeta(item.quality_review);
  const moderationStatus = normalizeString(item.moderation_status).toLowerCase();

  const platformConnected = platforms.length > 0 && platforms.every((platform) => ["active", "mock"].includes(platform.connectionStatus || "active"));
  const mediaPresent = Boolean(resolveItemMediaUrl(item));
  const captionOk = platforms.length > 0
    ? platforms.every((platform) => caption.length <= (PLATFORM_CHAR_LIMITS[platform.platform] || 2200))
    : caption.length <= 2200;
  const hashtagsOk = platforms.length > 0
    ? platforms.every((platform) => {
        const guidance = PLATFORM_HASHTAG_GUIDANCE[platform.platform];
        if (!guidance) return true;
        if (guidance.min === 0) return hashtags.length <= guidance.max;
        return hashtags.length >= guidance.min && hashtags.length <= guidance.max;
      })
    : hashtags.length <= 15;
  const moderationApproved = moderationStatus === "approved"
    ? { state: "pass", label: "Content status approved" }
    : moderationStatus === "none"
      ? { state: "warning", label: "Moderation review not completed" }
      : { state: "fail", label: "Content status approved" };
  const scheduleValid = mode === "schedule"
    ? Boolean(scheduledAt) && new Date(scheduledAt).getTime() > Date.now()
    : true;

  return [
    {
      key: "platform",
      state: platformConnected ? "pass" : "fail",
      label: "Platform connected",
      detail: platformConnected ? `${platforms.length} destination${platforms.length === 1 ? "" : "s"} ready` : "Select at least one active connected platform",
    },
    {
      key: "media",
      state: mediaPresent ? "pass" : "fail",
      label: "Media present",
      detail: mediaPresent ? "Media asset available" : "This item does not currently have previewable media",
    },
    {
      key: "caption",
      state: captionOk ? "pass" : "fail",
      label: "Caption length OK for platform",
      detail: `${caption.length} characters`,
    },
    {
      key: "hashtags",
      state: hashtagsOk ? "pass" : "fail",
      label: "Hashtag count within range",
      detail: `${hashtags.length} hashtag${hashtags.length === 1 ? "" : "s"}`,
    },
    {
      key: "moderation",
      state: moderationApproved.state,
      label: moderationApproved.label,
      detail: moderationApproved.state === "pass"
        ? "Cleared for publishing"
        : moderationApproved.state === "warning"
          ? "Proceed carefully or mark safe first"
          : "Content must be approved before publishing",
    },
    {
      key: "schedule",
      state: scheduleValid ? "pass" : "fail",
      label: mode === "publish" ? "Publish timing valid" : "Scheduled time valid",
      detail: mode === "publish" ? "Immediate publish" : (scheduleValid ? "Scheduled in the future" : "Choose a future date and time"),
    },
    {
      key: "quality",
      state: quality.key === "not_scored" ? "warning" : "pass",
      label: "Content scored",
      detail: quality.key === "not_scored" ? "Content not yet scored" : `${quality.scoreText}/100 - ${quality.label}`,
    },
  ];
}

function hasBlockingReadinessFailure(checks) {
  return checks.some((check) => check.state === "fail");
}

function roundScore(value) {
  return Math.round(value * 10) / 10;
}

function clampBandScore(value) {
  return roundScore(Math.max(0, Math.min(5, value)));
}

function getRecommendedActionForOverallScore(score) {
  if (score >= 85) return "ready";
  if (score >= 70) return "minor_review";
  if (score >= 50) return "needs_revision";
  return "regenerate_recommended";
}

function buildRescoreDraft(item) {
  const platform = normalizePlatformValue(item?.platform) || "instagram";
  const caption = normalizeString(item?.caption || item?.prompt || "");
  const captionLength = caption.length;
  const hashtags = normalizeHashtags(item?.hashtags);
  const mediaPresent = Boolean(resolveItemMediaUrl(item));
  const mediaType = normalizeString(item?.media_type).toLowerCase() || "image";
  const moderationStatus = normalizeString(item?.moderation_status).toLowerCase() || "none";
  const charLimit = PLATFORM_CHAR_LIMITS[platform] || 2200;
  const hashtagGuidance = PLATFORM_HASHTAG_GUIDANCE[platform] || { min: 0, max: 15 };
  const hashtagCount = hashtags.length;
  const captionWithinLimit = captionLength > 0 && captionLength <= charLimit;
  const hashtagsWithinGuidance = hashtagGuidance.min === 0
    ? hashtagCount <= hashtagGuidance.max
    : hashtagCount >= hashtagGuidance.min && hashtagCount <= hashtagGuidance.max;

  const scorePromptAdherence = clampBandScore(
    (item?.prompt ? 2.4 : 1.8)
    + (captionLength > 30 ? 1.2 : 0.4)
    + (mediaPresent ? 0.6 : 0),
  );
  const scoreBrandAlignment = clampBandScore(
    2.8
    + (captionLength >= 40 ? 0.7 : 0)
    + (hashtagCount > 0 ? 0.4 : 0)
    + (moderationStatus === "approved" ? 0.5 : 0),
  );
  const scoreVisualQuality = clampBandScore(
    mediaPresent
      ? mediaType === "video" ? 4.2 : 4.0
      : 1.4,
  );
  const scoreCaptionRelevance = clampBandScore(
    1.8
    + (captionLength >= 25 ? 1.2 : 0)
    + (captionLength >= 80 ? 0.9 : 0)
    + (captionWithinLimit ? 0.6 : -0.8),
  );
  const scorePlatformFit = clampBandScore(
    2.2
    + (captionWithinLimit ? 1.3 : -0.8)
    + (hashtagsWithinGuidance ? 1.0 : -0.4),
  );
  const scoreHashtagQuality = clampBandScore(
    1.8
    + (hashtagCount > 0 ? 0.8 : 0)
    + (hashtagsWithinGuidance ? 1.6 : -0.5),
  );
  const scorePublishReadiness = clampBandScore(
    1.6
    + (mediaPresent ? 1.2 : 0)
    + (captionWithinLimit ? 0.9 : 0)
    + (hashtagsWithinGuidance ? 0.6 : 0)
    + (moderationStatus === "approved" ? 0.7 : moderationStatus === "none" ? 0.2 : -0.8),
  );

  const breakdown = [
    scorePromptAdherence,
    scoreBrandAlignment,
    scoreVisualQuality,
    scoreCaptionRelevance,
    scorePlatformFit,
    scoreHashtagQuality,
    scorePublishReadiness,
  ];
  const overallScore = roundScore((breakdown.reduce((sum, value) => sum + value, 0) / breakdown.length) * 20);
  const recommendedAction = getRecommendedActionForOverallScore(overallScore);

  const riskFlags = [];
  if (!mediaPresent) riskFlags.push("Media is missing or not previewable.");
  if (!captionLength) riskFlags.push("Caption is empty.");
  if (captionLength && !captionWithinLimit) riskFlags.push(`Caption exceeds the ${platform} character limit.`);
  if (!hashtagsWithinGuidance) riskFlags.push(`Hashtag count falls outside ${platform} guidance.`);
  if (moderationStatus !== "approved") riskFlags.push("Content is not yet approved for publishing.");

  const confidenceLevel = riskFlags.length <= 1 ? "high" : riskFlags.length <= 3 ? "medium" : "low";

  return {
    score_prompt_adherence: scorePromptAdherence,
    score_brand_alignment: scoreBrandAlignment,
    score_visual_quality: scoreVisualQuality,
    score_caption_relevance: scoreCaptionRelevance,
    score_platform_fit: scorePlatformFit,
    score_hashtag_quality: scoreHashtagQuality,
    score_publish_readiness: scorePublishReadiness,
    overall_score: overallScore,
    confidence_level: confidenceLevel,
    recommended_action: recommendedAction,
    score_explanation: {
      prompt_adherence: item?.prompt
        ? "The caption and prompt are both present, which gives moderation enough context to compare intent against the current draft."
        : "Prompt context is limited, so adherence confidence is reduced.",
      brand_alignment: captionLength >= 40
        ? "The caption has enough structure to evaluate tone and brand consistency."
        : "The caption is too thin to judge strong brand alignment.",
      visual_quality: mediaPresent
        ? "A media asset is attached, so the item is visually reviewable."
        : "No media asset is attached, which lowers visual confidence.",
      caption_relevance: captionWithinLimit
        ? "Caption length is usable for the selected platform."
        : "Caption length needs adjustment for the selected platform.",
      platform_fit: hashtagsWithinGuidance
        ? "The caption and hashtag mix broadly fits the selected platform."
        : "The current content mix needs platform-specific adjustment.",
      hashtag_quality: hashtagCount > 0
        ? "Hashtags are present and can be evaluated against platform guidance."
        : "No hashtags are present, so discoverability is weaker.",
      publish_readiness: moderationStatus === "approved"
        ? "The content is approved and structurally close to publish-ready."
        : "Moderation approval is still pending, so readiness is reduced.",
    },
    risk_flags: riskFlags,
    suggested_rewrite_instructions: riskFlags.length
      ? `Improve the draft by addressing: ${riskFlags.join(" ")}`
      : "Minor polish only. The draft is structurally ready.",
    suggested_regen_direction: recommendedAction === "regenerate_recommended"
      ? "Regenerate with stronger brand direction, clearer platform fit, and a more complete caption."
      : "Keep the concept, but refine the weakest scoring areas before publishing.",
  };
}

export async function rescoreModerationItem({ adminAccess, item }) {
  if (!item?.generation_id) {
    throw new Error("This content cannot be scored because it is missing a generation reference.");
  }

  const draft = buildRescoreDraft(item);
  const { data, error } = await supabase
    .from("content_quality_reviews")
    .insert({
      generation_id: item.generation_id,
      post_id: item.post_id || null,
      triggered_by: "admin",
      triggered_by_admin_id: adminAccess.user.id,
      ...draft,
    })
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
    .single();

  if (error) throw error;

  if (item.post_id) {
    const { error: postError } = await supabase
      .from("posts")
      .update({ quality_review_id: data.id })
      .eq("id", item.post_id);

    if (postError) throw postError;
  }

  await insertAuditLog(
    buildAuditBase(
      adminAccess,
      item,
      "admin_rescored_post",
      "low",
      buildAuditSnapshot(item),
      buildAuditSnapshot(item, {
        quality_review_id: data.id,
        quality_score: data.overall_score,
        quality_action: data.recommended_action,
      }),
      `Re-scored moderation content for ${item.user?.name || item.user?.email || "user"}`,
      {
        quality_review_id: data.id,
        overall_score: data.overall_score,
        recommended_action: data.recommended_action,
      },
    ),
  );

  return data;
}

export async function forceModerationAction({
  adminAccess,
  item,
  mode,
  reasonCode,
  note,
  scheduledAt,
  selectedAccountIds = [],
  connectedAccounts = [],
}) {
  const targets = getPlatformTargets(selectedAccountIds, connectedAccounts, item.platform, { allowFallbackPlatform: false });
  const checks = calculateReadinessChecks({
    item,
    mode,
    selectedAccountIds,
    connectedAccounts,
    scheduledAt,
  });

  if (hasBlockingReadinessFailure(checks)) {
    throw new Error("Readiness checks failed. Resolve the blocked items before confirming.");
  }

  const caption = buildCaptionWithHashtags(item.caption || item.prompt || "", item.hashtags);
  const publishStatus = mode === "publish" ? POST_STATUS.PUBLISHED : POST_STATUS.SCHEDULED;
  const finalScheduledAt = mode === "publish" ? new Date().toISOString() : scheduledAt;
  const previousValue = buildAuditSnapshot(item);
  const inserts = [];
  const updatedIds = [];

  if (!targets.length && !item.post_id) {
    throw new Error("Select at least one connected platform before continuing.");
  }

  if (item.generation_id) {
    const existingPosts = await fetchGenerationPosts(item.user?.id, item.generation_id);
    const remainingTargets = targets.length ? targets : [{ accountId: item.account_id || null, platform: item.platform || null, connectionStatus: "active" }];
    let consumedCurrent = false;

    for (const target of remainingTargets) {
      const reusable = existingPosts.find((row) => row.account_id === target.accountId)
        || (!consumedCurrent && item.post_id ? existingPosts.find((row) => row.id === item.post_id) : null)
        || existingPosts.find((row) => row.status === POST_STATUS.DRAFT && !updatedIds.includes(row.id));

      if (reusable) {
        consumedCurrent = true;
        const { error } = await supabase
          .from("posts")
          .update({
            account_id: target.accountId,
            caption,
            hashtags: normalizeHashtags(item.hashtags),
            scheduled_at: finalScheduledAt,
            status: publishStatus,
            platform: target.platform,
            moderation_status: item.moderation_status || "approved",
            ...(mode === "publish" ? { force_published_by: adminAccess.user.id } : {}),
          })
          .eq("id", reusable.id);

        if (error) throw error;
        updatedIds.push(reusable.id);
        continue;
      }

      const { data, error } = await supabase
        .from("posts")
        .insert({
          user_id: item.user.id,
          generation_id: item.generation_id,
          account_id: target.accountId,
          caption,
          hashtags: normalizeHashtags(item.hashtags),
          scheduled_at: finalScheduledAt,
          status: publishStatus,
          moderation_status: item.moderation_status || "approved",
          platform: target.platform,
          ...(mode === "publish" ? { force_published_by: adminAccess.user.id } : {}),
        })
        .select("id, user_id")
        .single();

      if (error) throw error;
      inserts.push(data);
    }
  } else {
    const ensured = await ensurePostForItem(item, {
      accountId: targets[0]?.accountId || null,
      platform: targets[0]?.platform || item.platform || null,
    });
    const { error } = await supabase
      .from("posts")
      .update({
        account_id: targets[0]?.accountId || ensured.post.account_id || null,
        caption,
        hashtags: normalizeHashtags(item.hashtags),
        scheduled_at: finalScheduledAt,
        status: publishStatus,
        platform: targets[0]?.platform || item.platform || null,
        moderation_status: item.moderation_status || "approved",
        ...(mode === "publish" ? { force_published_by: adminAccess.user.id } : {}),
      })
      .eq("id", ensured.post.id);

    if (error) throw error;
    updatedIds.push(ensured.post.id);
  }

  if (inserts.length > 0) {
    await ensureLibraryRowsForPosts(inserts);
  }

  await insertAuditLog(
    buildAuditBase(
      adminAccess,
      item,
      mode === "publish" ? "post_force_published" : "post_force_scheduled",
      mode === "publish" ? "high" : "medium",
      previousValue,
      {
        ...previousValue,
        status: publishStatus,
        scheduled_at: finalScheduledAt,
        force_published_by: mode === "publish" ? adminAccess.user.id : null,
      },
      mode === "publish"
        ? `Force published content for ${item.user?.name || item.user?.email || "user"}`
        : `Force scheduled content for ${item.user?.name || item.user?.email || "user"}`,
      {
        reason_code: reasonCode,
        note: note || null,
        affected_post_ids: [...updatedIds, ...inserts.map((row) => row.id)],
      },
    ),
  );

  return { checks, affectedPostIds: [...updatedIds, ...inserts.map((row) => row.id)] };
}

export async function ensureModerationPost(item, options = {}) {
  return ensurePostForItem(item, options);
}

async function updateModerationStatus(items, patch, errorContext) {
  const postIds = [];

  for (const item of items) {
    const ensured = await ensurePostForItem(item);
    postIds.push(ensured.post.id);
  }

  if (!postIds.length) return [];

  const { error } = await supabase
    .from("posts")
    .update(patch)
    .in("id", postIds);

  if (error) {
    throw new Error(`${errorContext}: ${error.message}`);
  }

  return postIds;
}

export async function markItemsApproved({ adminAccess, items }) {
  const postIds = await updateModerationStatus(
    items,
    { moderation_status: "approved" },
    "Failed to mark selected items safe",
  );

  await Promise.all(items.map((item) => insertAuditLog(
    buildAuditBase(
      adminAccess,
      item,
      "post_edited",
      "low",
      buildAuditSnapshot(item),
      buildAuditSnapshot(item, { moderation_status: "approved" }),
      `Marked content safe for ${item.user?.name || item.user?.email || "user"}`,
      { bulk: items.length > 1, affected_post_ids: postIds },
    ),
  )));

  return postIds;
}

export async function assignModeratorToItems({ adminAccess, items, moderatorId }) {
  if (!moderatorId) {
    throw new Error("Choose a reviewer before assigning.");
  }

  const postIds = [];

  for (const item of items) {
    const ensured = await ensurePostForItem(item);
    postIds.push(ensured.post.id);
  }

  if (!postIds.length) return [];

  const { error } = await supabase
    .from("posts")
    .update({ assigned_moderator_id: moderatorId })
    .in("id", postIds);

  if (error) {
    throw new Error(`Failed to assign reviewer: ${error.message}`);
  }

  await Promise.all(items.map((item) => insertAuditLog(
    buildAuditBase(
      adminAccess,
      item,
      "moderation_reviewer_assigned",
      "low",
      buildAuditSnapshot(item),
      buildAuditSnapshot(item, { assigned_moderator_id: moderatorId }),
      `Assigned moderation reviewer for ${item.user?.name || item.user?.email || "user"} content`,
      {
        moderator_id: moderatorId,
        bulk: items.length > 1,
        affected_post_ids: postIds,
      },
    ),
  )));

  return postIds;
}

export async function archiveItems({ adminAccess, items, reasonCode, note }) {
  const postIds = await updateModerationStatus(
    items,
    {
      moderation_status: "archived",
      delete_reason: reasonCode,
    },
    "Failed to archive content",
  );

  await Promise.all(items.map((item) => insertAuditLog(
    buildAuditBase(
      adminAccess,
      item,
      "post_archived",
      "medium",
      buildAuditSnapshot(item),
      buildAuditSnapshot(item, { moderation_status: "archived" }),
      `Archived content for ${item.user?.name || item.user?.email || "user"}`,
      {
        reason_code: reasonCode,
        note: note || null,
        bulk: items.length > 1,
        affected_post_ids: postIds,
      },
    ),
  )));

  return postIds;
}

export async function submitDeletionRequests({ adminAccess, items, reasonCode, note }) {
  const postIds = [];

  for (const item of items) {
    const ensured = await ensurePostForItem(item);
    const targetStatus = adminAccess.isSuperAdmin ? "archived" : "pending_deletion";

    const { error } = await supabase
      .from("posts")
      .update({
        moderation_status: targetStatus,
        delete_reason: reasonCode,
      })
      .eq("id", ensured.post.id);

    if (error) throw error;
    postIds.push(ensured.post.id);

    if (adminAccess.isOrgAdmin) {
      const { error: requestError } = await supabase
        .from("admin_action_requests")
        .insert({
          requested_by_admin_id: adminAccess.user.id,
          action_type: "content_deletion",
          target_user_id: item.user?.id || null,
          target_post_id: ensured.post.id,
          target_org_id: item.organization?.id || adminAccess.organizationId || null,
          reason_code: reasonCode,
          note: note || null,
          status: "pending",
          eligibility_checks_passed: true,
          eligibility_check_details: {
            initiated_from: "admin_moderation",
            caption_snippet: formatCaptionSnippet(item.caption, 80),
          },
        });

      if (requestError) throw requestError;
    }

    await insertAuditLog(
      buildAuditBase(
        adminAccess,
        item,
        "post_deletion_requested",
        "high",
        buildAuditSnapshot(item),
        buildAuditSnapshot(item, { moderation_status: targetStatus }),
        `Submitted deletion request for ${item.user?.name || item.user?.email || "user"} content`,
        {
          reason_code: reasonCode,
          note: note || null,
          post_id: ensured.post.id,
          moderation_status: targetStatus,
        },
      ),
    );
  }

  return postIds;
}

export async function runRegenerationRequest(payload) {
  return requestModerationFunction("admin-regenerate-post", {
    method: "POST",
    body: payload,
  });
}

export async function analyzeUploadedMedia(payload) {
  return requestModerationFunction("admin-analyze-media", {
    method: "POST",
    body: payload,
  });
}

export async function promoteGeneratedVersion(payload) {
  return requestModerationFunction("admin-promote-content-version", {
    method: "POST",
    body: payload,
  });
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",").pop() : result);
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
