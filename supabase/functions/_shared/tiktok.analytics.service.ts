// supabase/functions/_shared/tiktok.analytics.service.ts
//
// Reads a creator's TikTok profile, account totals and per-video counters, and
// returns rows shaped for the fact tables (20260909140000, 20260922120000).
//
// ── What TikTok gives, and what it does not ─────────────────────────────────
// TikTok exposes NO time series. Every number is a lifetime counter as it
// stands right now: a video's views, the account's followers. A trend exists
// only if we observe on a schedule and difference the observations — so every
// value here becomes a SNAPSHOT row stamped with when it was observed, and
// nothing here is ever summed.
//
// Scopes, and what each one buys (developers.tiktok.com, checked 2026-09-22):
//   user.info.basic    open_id, display_name, avatar_url
//   user.info.profile  username, bio_description, is_verified, profile_deep_link
//   user.info.stats    follower_count, following_count, likes_count, video_count
//   video.list         POST /v2/video/list/ — the creator's PUBLIC videos only,
//                      newest first, 20 per page, with view/like/comment/share
//                      counts. No saves/favourites field exists at all.
//
// ── "Public videos only" is the constraint that shapes the product ──────────
// TikTok's docs: video.list returns "the given user's public TikTok video
// posts". An unaudited app can only publish as SELF_ONLY to a private account,
// so videos WE publish during review will not appear here until they are
// public. That is TikTok's rule, not a defect in this reader, and the UI must
// say so rather than render an empty table as "no performance".
//
// ── HTTP 200 does not mean success ──────────────────────────────────────────
// TikTok reports many failures with status 200 and `error.code` in the body.
// Success is `error.code === "ok"`. Checking res.ok alone would store a scope
// refusal as "this creator has no videos".
//
// ── 19-digit ids ────────────────────────────────────────────────────────────
// Video ids are documented as a string on the Video object, but the publish
// status endpoint returns `publicaly_available_post_id` (TikTok's spelling) as
// a list of int64. A 19-digit id exceeds Number.MAX_SAFE_INTEGER, and
// JSON.parse would silently round it to a DIFFERENT id. Those ids are read from
// the raw response text — see extractPublicPostIds().

const USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";
const VIDEO_LIST_URL = "https://open.tiktokapis.com/v2/video/list/";
const PUBLISH_STATUS_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/";
const TIMEOUT_MS = 30_000;

/** TikTok's documented maximum page size for video/list. */
export const VIDEO_PAGE_SIZE = 20;

/**
 * Pages read per account per run. 10 pages = the newest 200 public videos,
 * which is where every decision a creator is still making lives. Older videos
 * keep their last observation. A constant so raising it is a visible decision.
 */
export const MAX_VIDEO_PAGES = 10;

/** Each request is one unit against the tiktok/analytics meter. */
export const QUOTA_COST_PER_REQUEST = 1;

export const SCOPES = {
  basic: "user.info.basic",
  profile: "user.info.profile",
  stats: "user.info.stats",
  videoList: "video.list",
  publish: "video.publish",
} as const;

const BASIC_FIELDS = ["open_id", "display_name", "avatar_url"];
const PROFILE_FIELDS = ["username", "bio_description", "is_verified", "profile_deep_link"];
const STATS_FIELDS = ["follower_count", "following_count", "likes_count", "video_count"];

export const VIDEO_FIELDS = [
  "id", "create_time", "title", "video_description", "duration",
  "cover_image_url", "share_url",
  "view_count", "like_count", "comment_count", "share_count",
];

// ── Metric mapping ──────────────────────────────────────────────────────────
// TikTok's field on the left, our canonical metric_key on the right. Must match
// social_metric_platform_support for platform 'tiktok' — 20260922120000 §5b
// fails the migration if a mapping names a field TikTok does not document.

export const VIDEO_METRICS: Record<string, string> = {
  view_count: "views",
  like_count: "likes",
  comment_count: "comments",
  share_count: "shares",
};

export const ACCOUNT_METRICS: Record<string, string> = {
  follower_count: "followers_total",
  following_count: "following_total",
  likes_count: "likes_received_total",
  video_count: "video_count",
};

// ── Types ───────────────────────────────────────────────────────────────────

export type TikTokError = { code: string; detail: string; retriable: boolean };

export type SnapshotFact = {
  /** null for account-level facts. */
  platformPostId: string | null;
  metricKey: string;
  value: number;
};

export type TikTokProfile = {
  openId: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** The following are null when user.info.profile was not granted. */
  username: string | null;
  bio: string | null;
  isVerified: boolean | null;
  profileDeepLink: string | null;
};

export type VideoSummary = {
  id: string;
  createTime: number | null;
  title: string | null;
  description: string | null;
  durationSeconds: number | null;
  coverImageUrl: string | null;
  shareUrl: string | null;
};

export type Outcome = {
  httpRequests: number;
  quotaSpent: number;
  error: TikTokError | null;
};

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/**
 * Turn a TikTok failure into something a run row can record.
 *
 * The distinctions matter because the remedies differ: a missing scope never
 * heals without the user reconnecting, a rate limit heals by itself, and an
 * invalid token is the refresh worker's problem, not ingestion's.
 */
export function classifyTikTokError(httpStatus: number, body: unknown): TikTokError {
  const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
  const code = String(err?.code || "");
  const message = String(err?.message || "").slice(0, 200);

  if (code === "scope_not_authorized" || code === "scope_permission_missed") {
    return {
      code: "scope_not_granted",
      detail: "This TikTok connection was authorised without the scope this read needs. "
        + "Scopes are fixed at consent, so the user must reconnect to grant it.",
      retriable: false,
    };
  }
  if (code === "access_token_invalid" || httpStatus === 401) {
    return {
      code: "token_rejected",
      detail: "TikTok rejected the access token. The refresh worker renews it; if this "
        + "persists the account needs reconnecting.",
      retriable: false,
    };
  }
  if (code === "rate_limit_exceeded" || httpStatus === 429) {
    return { code: "rate_limited", detail: "TikTok rate limit reached; the next scheduled run retries.", retriable: true };
  }
  if (httpStatus >= 500) {
    return { code: `http_${httpStatus}`, detail: "TikTok is unavailable.", retriable: true };
  }
  return {
    code: code || `http_${httpStatus}`,
    detail: message || "TikTok rejected the request.",
    retriable: false,
  };
}

/** A finite, non-negative count, or null. NULL IS NOT ZERO (20260909140000 rule 1). */
function count(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Account-level facts from a user object. Only fields TikTok actually returned. */
export function mapAccountFacts(user: Record<string, unknown> | null | undefined): SnapshotFact[] {
  if (!user) return [];
  const facts: SnapshotFact[] = [];
  for (const [field, metricKey] of Object.entries(ACCOUNT_METRICS)) {
    const value = count(user[field]);
    if (value !== null) facts.push({ platformPostId: null, metricKey, value });
  }
  return facts;
}

/** Per-video facts. A video with no id is skipped: a number with no owner is unattributable. */
export function mapVideoFacts(videos: Array<Record<string, unknown>> | null | undefined): SnapshotFact[] {
  const facts: SnapshotFact[] = [];
  for (const v of videos || []) {
    const id = typeof v?.id === "string" && v.id ? v.id : null;
    if (!id) continue;
    for (const [field, metricKey] of Object.entries(VIDEO_METRICS)) {
      const value = count(v[field]);
      if (value !== null) facts.push({ platformPostId: id, metricKey, value });
    }
  }
  return facts;
}

export function mapProfile(user: Record<string, unknown> | null | undefined): TikTokProfile {
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return {
    openId: s(user?.open_id),
    displayName: s(user?.display_name),
    avatarUrl: s(user?.avatar_url),
    username: s(user?.username),
    bio: s(user?.bio_description),
    isVerified: typeof user?.is_verified === "boolean" ? user.is_verified : null,
    profileDeepLink: s(user?.profile_deep_link),
  };
}

export function mapVideoSummary(v: Record<string, unknown>): VideoSummary | null {
  const id = typeof v?.id === "string" && v.id ? v.id : null;
  if (!id) return null;
  const s = (x: unknown) => (typeof x === "string" && x ? x : null);
  return {
    id,
    createTime: count(v.create_time),
    title: s(v.title),
    description: s(v.video_description),
    durationSeconds: count(v.duration),
    coverImageUrl: s(v.cover_image_url),
    shareUrl: s(v.share_url),
  };
}

/**
 * Read `publicaly_available_post_id` from the RAW status response text.
 *
 * TikTok documents it as list<int64>. JSON.parse turns 7300000000000000001
 * into 7300000000000000000 — a real, different, wrong id — so the digits are
 * taken from the text before any parse can round them.
 */
export function extractPublicPostIds(rawText: string): string[] {
  const m = /"publicaly_available_post_id"\s*:\s*\[([^\]]*)\]/.exec(rawText || "");
  if (!m) return [];
  return (m[1].match(/\d{6,}/g) || []);
}

/**
 * Errors after which nothing more should be asked of TikTok for this account
 * in this run: a rejected token fails every call the same way, and a rate
 * limit only gets worse if pushed. Anything else is specific to one request.
 */
export function stopsAccount(error: TikTokError | null): boolean {
  return !!error && (error.code === "token_rejected" || error.code === "rate_limited");
}

/** A video id is all digits; a publish_id ("v_pub_file~v2-…") is not. */
export const VIDEO_ID_RE = /^\d{6,}$/;

/** A publish_id lookup that TikTok answered as terminally failed is not retried. */
export const RECONCILE_GAVE_UP = "failed";

type PostForReconcile = {
  id: string;
  external_post_id: string | null;
  workflow_state: Record<string, unknown> | null;
};

/**
 * Which of our published posts to resolve publish_id → video id for, this run.
 *
 * Least-recently-checked first, never-checked before anything. Always taking
 * the newest N instead would retry the same N forever — during review every
 * post is "Only me", TikTok never assigns them a public id, and posts older
 * than the newest N would never be looked at. Posts TikTok already reported as
 * FAILED are skipped for good.
 */
export function pickReconcileCandidates(posts: PostForReconcile[], limit: number): PostForReconcile[] {
  const tk = (p: PostForReconcile) => ((p.workflow_state || {}).tiktok || {}) as Record<string, unknown>;
  return (posts || [])
    .filter((p) => p.external_post_id && !VIDEO_ID_RE.test(String(p.external_post_id)))
    .filter((p) => tk(p).reconcile_status !== RECONCILE_GAVE_UP)
    .sort((a, b) => String(tk(a).reconcile_checked_at || "").localeCompare(String(tk(b).reconcile_checked_at || "")))
    .slice(0, Math.max(0, limit));
}

/**
 * Accounts ordered least-recently-attempted first, so a cap on accounts per
 * run rotates through everyone instead of starving whoever sorts last.
 * `lastAttempt` maps account id → ISO time of its latest run; absent = never.
 */
export function orderByLastAttempt<T extends { id: string }>(accounts: T[], lastAttempt: Map<string, string>): T[] {
  return [...(accounts || [])].sort((a, b) =>
    String(lastAttempt.get(a.id) || "").localeCompare(String(lastAttempt.get(b.id) || "")));
}

/** The scopes a stored grant carries. TikTok returns them comma-separated. */
export function hasScope(granted: unknown, scope: string): boolean {
  const list = Array.isArray(granted)
    ? granted.map(String)
    : String(granted || "").split(/[,\s]+/);
  return list.map((s) => s.trim()).includes(scope);
}

// ── Request plumbing ────────────────────────────────────────────────────────

async function tiktokRequest(
  token: string,
  url: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<{ json: Record<string, unknown> | null; raw: string; error: TikTokError | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json; charset=UTF-8" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    const raw = await res.text().catch(() => "");
    let json: Record<string, unknown> | null = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }

    const code = (json?.error as { code?: string } | undefined)?.code;
    // Success is BOTH a 2xx and error.code "ok". Either alone is not enough.
    if (!res.ok || (code && code !== "ok")) {
      return { json, raw, error: classifyTikTokError(res.status, json) };
    }
    if (!json) {
      return { json: null, raw, error: { code: "unparseable_response", detail: "TikTok returned a non-JSON body.", retriable: true } };
    }
    return { json, raw, error: null };
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    return {
      json: null,
      raw: "",
      error: {
        code: aborted ? "timeout" : "network_error",
        detail: aborted ? "TikTok did not respond within 30s." : String((err as Error)?.message).slice(0, 200),
        retriable: true,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * Profile + account totals in ONE request. Fields are requested only for
 * scopes the grant actually carries: asking for a field whose scope was not
 * granted fails the whole request, which would cost the basic profile too.
 */
export async function fetchAccount(
  token: string,
  grantedScopes: unknown,
): Promise<Outcome & { profile: TikTokProfile | null; facts: SnapshotFact[] }> {
  const fields = [
    ...BASIC_FIELDS,
    ...(hasScope(grantedScopes, SCOPES.profile) ? PROFILE_FIELDS : []),
    ...(hasScope(grantedScopes, SCOPES.stats) ? STATS_FIELDS : []),
  ];
  const { json, error } = await tiktokRequest(
    token,
    `${USER_INFO_URL}?fields=${fields.join(",")}`,
    { method: "GET" },
  );
  const out = { httpRequests: 1, quotaSpent: QUOTA_COST_PER_REQUEST };
  if (error) return { ...out, error, profile: null, facts: [] };

  const user = ((json?.data as { user?: Record<string, unknown> } | undefined)?.user) || null;
  return { ...out, error: null, profile: mapProfile(user), facts: mapAccountFacts(user) };
}

/**
 * The creator's public videos, newest first, bounded by maxPages.
 *
 * `truncated` is reported rather than hidden: a creator with more videos than
 * the page budget has older videos whose numbers were not refreshed this run.
 */
export async function fetchVideos(
  token: string,
  { maxPages = MAX_VIDEO_PAGES }: { maxPages?: number } = {},
): Promise<Outcome & { videos: VideoSummary[]; facts: SnapshotFact[]; truncated: boolean }> {
  const videos: VideoSummary[] = [];
  const facts: SnapshotFact[] = [];
  // A video can come back on two pages (the list shifts while we page, or a
  // pinned video repeats). One upsert containing the same key twice is
  // rejected WHOLE by Postgres — "cannot affect row a second time" — losing
  // every row in the batch. So each id is taken once, first sighting wins.
  const seen = new Set<string>();
  let httpRequests = 0;
  let cursor: number | undefined;
  let truncated = false;

  for (let page = 0; page < maxPages; page += 1) {
    const body: Record<string, unknown> = { max_count: VIDEO_PAGE_SIZE };
    if (cursor !== undefined) body.cursor = cursor;

    const { json, error } = await tiktokRequest(
      token,
      `${VIDEO_LIST_URL}?fields=${VIDEO_FIELDS.join(",")}`,
      { method: "POST", body },
    );
    httpRequests += 1;
    if (error) {
      // Keep what earlier pages returned; the caller records a partial run.
      return { httpRequests, quotaSpent: httpRequests * QUOTA_COST_PER_REQUEST, error, videos, facts, truncated: false };
    }

    const data = (json?.data || {}) as { videos?: Array<Record<string, unknown>>; cursor?: number; has_more?: boolean };
    const pageVideos = (data.videos || []).filter((v) => {
      const id = typeof v?.id === "string" ? v.id : "";
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    for (const v of pageVideos) {
      const summary = mapVideoSummary(v);
      if (summary) videos.push(summary);
    }
    facts.push(...mapVideoFacts(pageVideos));

    if (!data.has_more || data.cursor === undefined || data.cursor === null) break;
    // A cursor that does not advance would loop until the page budget; stop.
    if (cursor !== undefined && Number(data.cursor) === cursor) break;
    cursor = Number(data.cursor);
    if (page === maxPages - 1) truncated = true;
  }

  return { httpRequests, quotaSpent: httpRequests * QUOTA_COST_PER_REQUEST, error: null, videos, facts, truncated };
}

/**
 * Resolve a publish_id (what Direct Post returns) to the video id video.list
 * uses. TikTok only fills publicaly_available_post_id once the post is public
 * and past moderation; until then this returns null, which is not an error.
 */
export async function fetchPublishedVideoId(
  token: string,
  publishId: string,
): Promise<Outcome & { videoId: string | null; status: string | null }> {
  const { json, raw, error } = await tiktokRequest(token, PUBLISH_STATUS_URL, {
    method: "POST",
    body: { publish_id: publishId },
  });
  const out = { httpRequests: 1, quotaSpent: QUOTA_COST_PER_REQUEST };
  if (error) return { ...out, error, videoId: null, status: null };
  const status = String((json?.data as { status?: string } | undefined)?.status || "") || null;
  return { ...out, error: null, status, videoId: extractPublicPostIds(raw)[0] || null };
}
