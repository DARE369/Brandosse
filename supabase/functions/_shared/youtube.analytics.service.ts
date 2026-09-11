// supabase/functions/_shared/youtube.analytics.service.ts
//
// Reads the YouTube Analytics API and returns rows shaped for the fact tables
// created by migration 20260909140000.
//
// ── A different API from the publish adapter ────────────────────────────────
// youtube.service.ts talks to the DATA API (googleapis.com/youtube/v3) to
// upload. This talks to the ANALYTICS API
// (youtubeanalytics.googleapis.com/v2/reports), a different host, a different
// scope (yt-analytics.readonly), and — importantly — a separate quota pool
// from the Data API's 10,000 units.
//
// That separation is why social_api_quota_limits has its own row for analytics
// rather than folding it into 'general': charging report reads against the
// upload allowance would cost the ability to publish by reading analytics.
//
// ── The API is one endpoint with a query language ───────────────────────────
// Everything is GET /v2/reports with:
//   ids        channel==MINE          (the authorised user's own channel)
//   startDate  / endDate              YYYY-MM-DD, inclusive
//   metrics    comma-separated
//   dimensions comma-separated        what the rows are broken down BY
//   filters    e.g. video==ID1,ID2
//
// The response is columnar: `columnHeaders` names each column, `rows` is an
// array of arrays. Nothing is keyed, so a row is only interpretable through
// its headers — which is why every parse here goes through headerIndex()
// rather than assuming a column order. YouTube is free to reorder them.
//
// ── Dates are in the CHANNEL's reporting timezone, not UTC ──────────────────
// YouTube aggregates days in Pacific time. A `day` value of "2026-09-10" is a
// Pacific day, and storing it without recording that is a silent multi-hour
// error — the fact tables take reporting_timezone NOT NULL for exactly this
// reason, and REPORTING_TIMEZONE below is what gets written.
//
// ── What YouTube does NOT expose, and must not be faked ─────────────────────
// Thumbnail impressions and click-through rate are YouTube STUDIO metrics.
// They are not available through this API at any scope. They are absent from
// social_metric_platform_support so a consumer renders "not measurable"
// instead of a zero that reads like "nobody saw it".

const REPORTS_URL = "https://youtubeanalytics.googleapis.com/v2/reports";
const TIMEOUT_MS = 30_000;

/**
 * YouTube aggregates analytics days in Pacific time.
 * Written to every fact row so "which day is this?" has an answer.
 */
export const REPORTING_TIMEZONE = "America/Los_Angeles";

/**
 * YouTube caps a `video==` filter at 500 ids. Kept well below so one request
 * stays comfortably inside the response row ceiling too: 200 videos x 30 days
 * is already 6,000 rows.
 */
export const MAX_VIDEOS_PER_FILTER = 200;

/**
 * Every reports.query call is charged the same, and the Analytics API bills
 * per request rather than by YouTube's weighted unit model. Counted so
 * social_api_quota_today can answer "what did today cost?".
 */
export const QUOTA_COST_PER_REPORT = 1;

// ── Metric mapping ──────────────────────────────────────────────────────────
//
// YouTube's name on the left, our canonical metric_key on the right. The keys
// MUST match what 20260909140000 seeded into social_metric_platform_support —
// a fact row referencing an unseeded key is rejected by the foreign key, which
// is the intended failure: a metric nobody defined is a metric nobody can
// interpret.

type MetricMap = {
  /** Our canonical key, as seeded in social_metric_definitions. */
  key: string;
  /** Convert YouTube's unit to ours. Identity unless stated. */
  convert?: (n: number) => number;
};

export const VIDEO_METRICS: Record<string, MetricMap> = {
  views: { key: "views" },
  likes: { key: "likes" },
  comments: { key: "comments" },
  shares: { key: "shares" },
  // YouTube reports MINUTES. The column is seconds, so one unit is stored
  // product-wide and no consumer has to remember which platform meant what.
  estimatedMinutesWatched: { key: "watch_time_seconds", convert: (n) => n * 60 },
  averageViewDuration: { key: "avg_view_duration_seconds" },
  averageViewPercentage: { key: "avg_view_percentage" },
  subscribersGained: { key: "followers_gained" },
  subscribersLost: { key: "followers_lost" },
};

export const CHANNEL_METRICS: Record<string, MetricMap> = {
  views: { key: "views" },
  likes: { key: "likes" },
  comments: { key: "comments" },
  shares: { key: "shares" },
  estimatedMinutesWatched: { key: "watch_time_seconds", convert: (n) => n * 60 },
  averageViewDuration: { key: "avg_view_duration_seconds" },
  subscribersGained: { key: "followers_gained" },
  subscribersLost: { key: "followers_lost" },
};

/**
 * Dimensions worth breaking down by, mapped to the dimension_key stored in
 * social_post_breakdowns.
 *
 * ageGroup/gender is deliberately absent: YouTube returns it only as
 * viewerPercentage (a share, not a count), so it does not belong in the same
 * table as absolute values. It needs its own handling and is left for later
 * rather than stored as something it is not.
 */
export const BREAKDOWN_DIMENSIONS: Record<string, string> = {
  insightTrafficSourceType: "traffic_source",
  country: "country",
  deviceType: "device_type",
  operatingSystem: "operating_system",
  subscribedStatus: "subscribed_status",
};

// ── Types ───────────────────────────────────────────────────────────────────

export type DailyFact = {
  platformPostId: string | null;   // null for channel-level rows
  metricKey: string;
  metricDate: string;              // YYYY-MM-DD, in REPORTING_TIMEZONE
  value: number;
};

export type BreakdownFact = {
  platformPostId: string;
  metricKey: string;
  dimensionKey: string;
  dimensionValue: string;
  value: number;
};

export type RetentionPoint = {
  platformPostId: string;
  elapsedRatio: number;
  watchRatio: number;
};

export type ReportOutcome<T> = {
  rows: T[];
  httpRequests: number;
  quotaSpent: number;
  /**
   * Set when the report could not be fetched. The caller records it on the
   * ingestion run rather than throwing it away — a run that fetched nothing
   * must be distinguishable from a run that found nothing.
   */
  error: { code: string; detail: string; retriable: boolean } | null;
};

// ── Request plumbing ────────────────────────────────────────────────────────

/**
 * Locate a column by name.
 *
 * The response is positional, and column order is YouTube's to choose. Reading
 * `row[2]` because it was views yesterday is how a chart silently starts
 * plotting watch time. Returns -1 so the caller can skip rather than write a
 * wrong number.
 */
export function headerIndex(headers: Array<{ name: string }>, name: string): number {
  return headers.findIndex((h) => h.name === name);
}

/**
 * Turn a Google Analytics API error into something a run row can record.
 *
 * Distinguishing these matters: quotaExceeded means stop for today,
 * insufficientPermissions means this account never granted the scope and will
 * never succeed, and a 5xx means try again shortly. Collapsing them into one
 * "failed" would make the ingestion ledger useless for deciding what to do.
 */
export function classifyAnalyticsError(
  httpStatus: number,
  rawBody: string,
): { code: string; detail: string; retriable: boolean } {
  let reason = "";
  let message = "";
  try {
    const parsed = JSON.parse(rawBody);
    reason = parsed?.error?.errors?.[0]?.reason ?? parsed?.error?.status ?? "";
    message = parsed?.error?.message ?? "";
  } catch { /* non-JSON body; status is all we have */ }

  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded" || httpStatus === 429) {
    return {
      code: "quota_exceeded",
      detail: "YouTube Analytics quota is exhausted for today. Quota is per Cloud "
        + "project and shared by every user, so this is app-wide, not this account.",
      retriable: true,
    };
  }
  // A DISABLED API also returns 403, and its message reads exactly like a
  // permissions failure. Distinguished by reason, because the two have
  // opposite remedies: accessNotConfigured is fixed in the Cloud console in
  // thirty seconds, while a genuine scope failure needs every affected user to
  // reconnect. Observed live 2026-09-11: this was classified as a missing
  // scope and told the operator to reconnect a channel whose token was fine.
  if (reason === "accessNotConfigured" || /has not been used in project|is disabled/i.test(message)) {
    return {
      code: "api_not_enabled",
      detail: "The YouTube Analytics API is not enabled on this Google Cloud project. "
        + "Enable it in the console, wait a few minutes for propagation, then retry. "
        + "This is a project setting — the user's token and scopes are fine.",
      // Retriable: the moment it is enabled, the next scheduled run succeeds
      // with no code change and no user action.
      retriable: true,
    };
  }
  if (reason === "insufficientPermissions" || httpStatus === 403) {
    return {
      code: "scope_not_granted",
      detail: "This channel's token does not carry yt-analytics.readonly. Scopes are "
        + "fixed at consent, so it cannot be added without the user reconnecting.",
      // Not retriable: retrying cannot widen a token that was already issued.
      retriable: false,
    };
  }
  if (httpStatus === 401) {
    return { code: "token_rejected", detail: "Google rejected the access token.", retriable: false };
  }
  if (httpStatus >= 500) {
    return { code: `http_${httpStatus}`, detail: "YouTube Analytics is unavailable.", retriable: true };
  }
  return {
    code: reason || `http_${httpStatus}`,
    // Bounded: this string is persisted to social_ingestion_runs.error_detail,
    // and Google echoes request context into some error shapes.
    detail: message.slice(0, 200) || "YouTube Analytics rejected the request.",
    retriable: false,
  };
}

type ReportResponse = {
  columnHeaders?: Array<{ name: string }>;
  rows?: unknown[][];
};

async function fetchReport(
  token: string,
  params: Record<string, string>,
): Promise<{ body: ReportResponse | null; error: ReturnType<typeof classifyAnalyticsError> | null }> {
  const url = `${REPORTS_URL}?${new URLSearchParams(params).toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { body: null, error: classifyAnalyticsError(res.status, text) };
    }
    return { body: await res.json() as ReportResponse, error: null };
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    return {
      body: null,
      error: {
        code: aborted ? "timeout" : "network_error",
        detail: aborted ? "YouTube Analytics did not respond within 30s." : String((err as Error).message).slice(0, 200),
        retriable: true,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Row parsing (pure — unit-tested) ────────────────────────────────────────

/**
 * Convert a columnar report into daily facts.
 *
 * Rows whose value is null or not finite are DROPPED rather than stored as 0.
 * "YouTube reported nothing for this metric" and "YouTube reported zero" are
 * different statements, and the schema represents the first as an absent row
 * (see 20260909140000, rule 1). Coercing null to 0 would erase that permanently
 * and no chart could tell which it was drawing.
 */
export function parseDailyRows(
  body: ReportResponse,
  metricMap: Record<string, MetricMap>,
  opts: { videoDimension: boolean },
): DailyFact[] {
  const headers = body.columnHeaders ?? [];
  const rows = body.rows ?? [];
  if (headers.length === 0 || rows.length === 0) return [];

  const dayIdx = headerIndex(headers, "day");
  const videoIdx = opts.videoDimension ? headerIndex(headers, "video") : -1;
  if (dayIdx === -1) return [];
  if (opts.videoDimension && videoIdx === -1) return [];

  const metricCols = Object.entries(metricMap)
    .map(([ytName, m]) => ({ idx: headerIndex(headers, ytName), ...m }))
    .filter((c) => c.idx !== -1);

  const out: DailyFact[] = [];
  for (const row of rows) {
    const metricDate = String(row[dayIdx] ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(metricDate)) continue;

    const platformPostId = opts.videoDimension ? String(row[videoIdx] ?? "") : null;
    if (opts.videoDimension && !platformPostId) continue;

    for (const col of metricCols) {
      const raw = row[col.idx];
      if (raw === null || raw === undefined) continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      out.push({
        platformPostId,
        metricKey: col.key,
        metricDate,
        value: col.convert ? col.convert(n) : n,
      });
    }
  }
  return out;
}

/** Convert a dimensional report into breakdown facts. Same null discipline. */
export function parseBreakdownRows(
  body: ReportResponse,
  ytDimension: string,
  dimensionKey: string,
  platformPostId: string,
  metricMap: Record<string, MetricMap>,
): BreakdownFact[] {
  const headers = body.columnHeaders ?? [];
  const rows = body.rows ?? [];
  const dimIdx = headerIndex(headers, ytDimension);
  if (dimIdx === -1 || rows.length === 0) return [];

  const metricCols = Object.entries(metricMap)
    .map(([ytName, m]) => ({ idx: headerIndex(headers, ytName), ...m }))
    .filter((c) => c.idx !== -1);

  const out: BreakdownFact[] = [];
  for (const row of rows) {
    const dimensionValue = String(row[dimIdx] ?? "").trim();
    if (!dimensionValue) continue;

    for (const col of metricCols) {
      const raw = row[col.idx];
      if (raw === null || raw === undefined) continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      out.push({
        platformPostId,
        metricKey: col.key,
        dimensionKey,
        dimensionValue,
        value: col.convert ? col.convert(n) : n,
      });
    }
  }
  return out;
}

/**
 * Convert an audience-retention report into curve points.
 *
 * audienceWatchRatio can exceed 1 where a segment is rewatched, so it is NOT
 * clamped — the column's CHECK allows >= 0 with no upper bound for this
 * reason. elapsedVideoTimeRatio is genuinely 0..1 and anything outside that is
 * dropped rather than stored, because it cannot be plotted.
 */
export function parseRetentionRows(
  body: ReportResponse,
  platformPostId: string,
): RetentionPoint[] {
  const headers = body.columnHeaders ?? [];
  const rows = body.rows ?? [];
  const elapsedIdx = headerIndex(headers, "elapsedVideoTimeRatio");
  const watchIdx = headerIndex(headers, "audienceWatchRatio");
  if (elapsedIdx === -1 || watchIdx === -1) return [];

  const out: RetentionPoint[] = [];
  for (const row of rows) {
    const elapsed = Number(row[elapsedIdx]);
    const watch = Number(row[watchIdx]);
    if (!Number.isFinite(elapsed) || !Number.isFinite(watch)) continue;
    if (elapsed < 0 || elapsed > 1 || watch < 0) continue;
    out.push({ platformPostId, elapsedRatio: elapsed, watchRatio: watch });
  }
  return out;
}

/** Chunk video ids so no request exceeds YouTube's filter ceiling. */
export function chunkVideoIds(ids: string[], size = MAX_VIDEOS_PER_FILTER): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

// ── Public report calls ─────────────────────────────────────────────────────

/** Per-video, per-day metrics for a set of videos over a date window. */
export async function fetchVideoDailyMetrics(
  token: string,
  videoIds: string[],
  startDate: string,
  endDate: string,
): Promise<ReportOutcome<DailyFact>> {
  const out: ReportOutcome<DailyFact> = { rows: [], httpRequests: 0, quotaSpent: 0, error: null };
  if (videoIds.length === 0) return out;

  for (const chunk of chunkVideoIds(videoIds)) {
    const { body, error } = await fetchReport(token, {
      ids: "channel==MINE",
      startDate,
      endDate,
      metrics: Object.keys(VIDEO_METRICS).join(","),
      dimensions: "video,day",
      filters: `video==${chunk.join(",")}`,
      maxResults: "2000",
    });
    out.httpRequests += 1;
    out.quotaSpent += QUOTA_COST_PER_REPORT;

    if (error) {
      out.error = error;
      // Stop on the first failure but KEEP what earlier chunks returned. The
      // run is recorded as 'partial', which is honest: some data landed.
      break;
    }
    if (body) out.rows.push(...parseDailyRows(body, VIDEO_METRICS, { videoDimension: true }));
  }
  return out;
}

/** Channel-level daily metrics — how the page itself is performing. */
export async function fetchChannelDailyMetrics(
  token: string,
  startDate: string,
  endDate: string,
): Promise<ReportOutcome<DailyFact>> {
  const { body, error } = await fetchReport(token, {
    ids: "channel==MINE",
    startDate,
    endDate,
    metrics: Object.keys(CHANNEL_METRICS).join(","),
    dimensions: "day",
    maxResults: "400",
  });

  return {
    rows: body ? parseDailyRows(body, CHANNEL_METRICS, { videoDimension: false }) : [],
    httpRequests: 1,
    quotaSpent: QUOTA_COST_PER_REPORT,
    error,
  };
}

/**
 * Dimensional breakdowns for ONE video.
 *
 * Requested over the whole window rather than per day: the per-day cube
 * multiplies request count by the number of days for a level of detail nothing
 * currently reads, and quota is shared across every user of the app.
 */
export async function fetchVideoBreakdowns(
  token: string,
  videoId: string,
  startDate: string,
  endDate: string,
): Promise<ReportOutcome<BreakdownFact>> {
  const out: ReportOutcome<BreakdownFact> = { rows: [], httpRequests: 0, quotaSpent: 0, error: null };

  for (const [ytDimension, dimensionKey] of Object.entries(BREAKDOWN_DIMENSIONS)) {
    const { body, error } = await fetchReport(token, {
      ids: "channel==MINE",
      startDate,
      endDate,
      metrics: "views,estimatedMinutesWatched",
      dimensions: ytDimension,
      filters: `video==${videoId}`,
      maxResults: "200",
    });
    out.httpRequests += 1;
    out.quotaSpent += QUOTA_COST_PER_REPORT;

    if (error) {
      out.error = error;
      // A quota failure must stop every remaining dimension, not just this one.
      if (error.code === "quota_exceeded" || !error.retriable) break;
      continue;
    }
    if (body) {
      out.rows.push(...parseBreakdownRows(body, ytDimension, dimensionKey, videoId, {
        views: { key: "views" },
        estimatedMinutesWatched: { key: "watch_time_seconds", convert: (n) => n * 60 },
      }));
    }
  }
  return out;
}

/**
 * Audience retention for ONE video — where viewers actually leave.
 *
 * The only report any platform offers that answers "what should I change"
 * rather than "how did it do".
 */
export async function fetchAudienceRetention(
  token: string,
  videoId: string,
  startDate: string,
  endDate: string,
): Promise<ReportOutcome<RetentionPoint>> {
  const { body, error } = await fetchReport(token, {
    ids: "channel==MINE",
    startDate,
    endDate,
    metrics: "audienceWatchRatio,relativeRetentionPerformance",
    dimensions: "elapsedVideoTimeRatio",
    filters: `video==${videoId}`,
    maxResults: "200",
  });

  return {
    rows: body ? parseRetentionRows(body, videoId) : [],
    httpRequests: 1,
    quotaSpent: QUOTA_COST_PER_REPORT,
    error,
  };
}
