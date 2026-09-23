/**
 * socialAnalyticsService.js — the read side of the social_* analytics tables.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * The analytics schema shipped 2026-09-09 and has had no client reader since.
 * PersonalAnalyticsPage says so in its own source: "no engagement data exists
 * anywhere in the system: platform_analytics has 0 rows". That is no longer
 * true — `ingest-social-analytics` writes real facts into
 * social_post_metrics_daily and social_account_metrics_daily — so this is the
 * reader that turns a built pipeline into something a person can see.
 *
 * ── Two rules this file exists to enforce ───────────────────────────────────
 *
 * 1. NEVER SUM A NON-ADDITIVE METRIC. social_metric_definitions carries
 *    `is_additive` for exactly this reason. Views per day sum to views; average
 *    view percentage per day does not sum to anything at all, and adding seven
 *    days of "48%" to make "336%" is the kind of confidently wrong number this
 *    codebase has shipped before. Additive metrics are summed; the rest report
 *    their most recent day, with that date, so the reader knows what they are
 *    looking at.
 *
 * 2. AN EMPTY RESULT MUST EXPLAIN ITSELF. Zero rows has at least four causes
 *    needing four different responses from the user: nothing collected yet,
 *    collection failing, collected fine but the video is private, or collected
 *    fine and there was genuinely no activity. `describeEmptiness`
 *    distinguishes them. A dashboard rendering "0" for all four is the
 *    fabrication this repo's third law forbids.
 *
 * RLS does the tenancy: every social_* fact table carries a policy scoping rows
 * to the account owner (or active org members), so these queries are written as
 * if the user could see everything and the database disagrees.
 */

import { supabase } from "./supabaseClient";
import {
  aggregateMetrics,
  describeEmptiness,
  formatMetricValue,
  snapshotMetrics,
} from "./socialAnalyticsAggregate";

// Re-exported so consumers have one import site for the analytics read layer,
// while the arithmetic stays in a file with no I/O that a guard can execute.
export { describeEmptiness, formatMetricValue };

/**
 * Tables or functions that may legitimately not exist yet on an un-migrated
 * database. PGRST202 is "function not found" — social_snapshot_summary arrives
 * with 20260922120000.
 */
const OPTIONAL_ERROR_CODES = new Set(["42P01", "42703", "42883", "PGRST200", "PGRST202", "PGRST205"]);

/**
 * PostgREST returns at most max_rows per response (1000 by default on
 * Supabase) and truncates WITHOUT an error. A month of per-video daily facts
 * passes that at four videos. Every fact read therefore pages until a short
 * page comes back, over a deterministic order — paging an unordered result can
 * skip or repeat rows between pages.
 */
const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // a ceiling, so a runaway read cannot hang the page

/**
 * @param {() => any} buildQuery  a fresh query per page (builders are single-use)
 * @param {string} label
 * @param {string[]} incomplete   collects labels whose figures are NOT complete,
 *                                so the page can say so instead of a console line
 */
async function selectAllPages(buildQuery, label, incomplete) {
  const rows = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let batch;
    try {
      batch = await selectOptional(buildQuery().range(from, from + PAGE_SIZE - 1), label);
    } catch (error) {
      // 57014: statement timeout. Keep what arrived and SAY the figures are
      // partial — failing the whole page would cost the user every other number.
      if (error?.code === "57014") {
        console.error(`[socialAnalytics] ${label}: timed out after ${rows.length} rows`);
        incomplete?.push(label);
        return rows;
      }
      throw error;
    }
    if (batch.length === 0) return rows;
    rows.push(...batch);
    // Advance by what CAME BACK, and stop only on an empty page. If the server's
    // max_rows is below PAGE_SIZE, a short page is not the last page — treating
    // it as one would drop everything after it without a trace.
    from += batch.length;
  }
  console.error(`[socialAnalytics] ${label}: stopped after ${MAX_PAGES} pages; figures may be incomplete`);
  incomplete?.push(label);
  return rows;
}

function isOptionalDataError(error) {
  return Boolean(error) && OPTIONAL_ERROR_CODES.has(error.code);
}

/** `select` that tolerates a missing table rather than failing the whole page. */
async function selectOptional(builder, label) {
  const { data, error } = await builder;
  if (error) {
    if (isOptionalDataError(error)) {
      console.warn(`[socialAnalytics] ${label} unavailable:`, error.code);
      return [];
    }
    throw error;
  }
  return data || [];
}

/**
 * Everything the analytics surface needs, for one user, over one window.
 *
 * @param {object}  params
 * @param {string}  params.userId
 * @param {number}  params.rangeDays   how far back to read
 * @returns {Promise<{accounts: Array, definitions: Array, windowStart: string|null}>}
 */
export async function fetchSocialPerformance({ userId, rangeDays = 30 }) {
  if (!userId) return { accounts: [], definitions: [], windowStart: null, freshnessAvailable: true };

  // Dates, not timestamps: the fact tables are keyed by the PLATFORM's calendar
  // day in its own reporting timezone, so comparing them against an instant
  // would silently drop or include an edge day depending on the viewer's clock.
  const windowStart = new Date(Date.now() - rangeDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // Labels of reads that came back partial (timeout, page ceiling). Returned so
  // the page can say "these figures are incomplete" out loud.
  const incomplete = [];

  const [definitions, accountRows, postRows, snapshotRows, catalogueRows, tiktokGrants, freshnessRows] = await Promise.all([
    selectOptional(
      supabase
        .from("social_metric_definitions")
        .select("metric_key, display_name, unit, is_additive"),
      "social_metric_definitions",
    ),
    selectAllPages(
      () => supabase
        .from("social_account_metrics_daily")
        .select("connected_account_id, platform, metric_key, metric_date, value")
        .gte("metric_date", windowStart)
        .order("connected_account_id")
        .order("metric_key")
        .order("metric_date"),
      "social_account_metrics_daily", incomplete,
    ),
    selectAllPages(
      () => supabase
        .from("social_post_metrics_daily")
        .select("connected_account_id, platform, platform_post_id, post_id, metric_key, metric_date, value")
        .gte("metric_date", windowStart)
        .order("connected_account_id")
        .order("platform_post_id")
        .order("metric_key")
        .order("metric_date"),
      "social_post_metrics_daily", incomplete,
    ),
    // Snapshot platforms (TikTok): reduced to latest/earliest per metric by the
    // database, because the raw rows grow by videos x metrics every run.
    selectAllPages(
      () => supabase.rpc("social_snapshot_summary", { p_since: `${windowStart}T00:00:00Z` }),
      "social_snapshot_summary", incomplete,
    ),
    // What each platform post IS — title, link — including the creator's own
    // uploads that never passed through Brandosse.
    selectAllPages(
      () => supabase
        .from("social_platform_posts")
        .select("connected_account_id, platform_post_id, title, description, share_url, published_at, post_id")
        .order("connected_account_id")
        .order("platform_post_id"),
      "social_platform_posts", incomplete,
    ),
    // What each TikTok connection was ALLOWED to read, as granted at consent.
    // Without it, an account that never granted video.list would be told
    // "TikTok returned no public videos" — a claim about their videos that is
    // really a fact about their permissions.
    selectOptional(
      supabase
        .from("connected_accounts")
        .select("id, scopes")
        .eq("platform", "tiktok")
        .eq("is_mock", false),
      "connected_accounts (tiktok scopes)",
    ),
    // Freshness is CONTEXT, not content. It answers "when was this last
    // checked", and losing it must never cost the figures themselves.
    //
    // It did exactly that on 2026-09-18: the view returned 403 to every
    // signed-in user (a security_invoker view over a table users cannot read —
    // repaired by 20260918130000), the whole fetch rejected, and the page told
    // a user with a connected YouTube channel to "connect a social account".
    // Wrong, and pointing at the wrong thing to fix.
    supabase
      .from("social_analytics_freshness")
      .select("connected_account_id, platform, source, last_success_at, last_attempt_at, last_status, last_error_code, failures_24h")
      .then(({ data, error }) => {
        if (error) {
          console.warn("[socialAnalytics] freshness unavailable:", error.code, error.message);
          return null; // null means "unknown", which the UI says out loud
        }
        return data || [];
      }),
  ]);

  // Distinguished deliberately: [] means "collected nothing", null means "we
  // could not find out". The UI must not render the first when it means the
  // second.
  const freshnessAvailable = freshnessRows !== null;
  const freshness = freshnessRows || [];

  const definitionsByKey = new Map(definitions.map((d) => [d.metric_key, d]));

  // Titles and privacy for the posts that actually have metrics — fetched by id
  // rather than reused from the page's list, which is limited to the same
  // window and would leave older posts nameless.
  const postIds = [...new Set(
    [...postRows, ...snapshotRows, ...catalogueRows].map((r) => r.post_id).filter(Boolean),
  )];
  let postsById = new Map();
  if (postIds.length) {
    const posts = await selectOptional(
      supabase
        .from("posts")
        .select("id, title, caption, external_post_id, published_at, workflow_state")
        .in("id", postIds),
      "posts",
    );
    postsById = new Map(posts.map((p) => [p.id, p]));
  }

  // Freshness has one row per (account, source); keep the most recent attempt.
  const freshnessByAccount = new Map();
  for (const row of freshness) {
    const existing = freshnessByAccount.get(row.connected_account_id);
    if (!existing || (row.last_attempt_at || "") > (existing.last_attempt_at || "")) {
      freshnessByAccount.set(row.connected_account_id, row);
    }
  }

  const scopesByAccount = new Map(tiktokGrants.map((a) => [a.id, a.scopes]));
  /** true / false when known; null when the grant could not be read. */
  const videoListGrantedFor = (accountId) => {
    if (!scopesByAccount.has(accountId)) return null;
    const scopes = scopesByAccount.get(accountId);
    const list = Array.isArray(scopes) ? scopes : String(scopes || "").split(/[,\s]+/);
    return list.includes("video.list");
  };

  const catalogueByKey = new Map(
    catalogueRows.map((c) => [`${c.connected_account_id}:${c.platform_post_id}`, c]),
  );

  const accountIds = new Set([
    ...accountRows.map((r) => r.connected_account_id),
    ...postRows.map((r) => r.connected_account_id),
    ...snapshotRows.map((r) => r.connected_account_id),
    ...freshness.map((r) => r.connected_account_id),
  ]);

  const accounts = [...accountIds].map((accountId) => {
    const ownAccountRows = accountRows.filter((r) => r.connected_account_id === accountId);
    const ownPostRows = postRows.filter((r) => r.connected_account_id === accountId);
    const ownSnapshots = snapshotRows.filter((r) => r.connected_account_id === accountId);
    const accountFreshness = freshnessByAccount.get(accountId) || null;

    const platform =
      ownAccountRows[0]?.platform || ownPostRows[0]?.platform || ownSnapshots[0]?.platform
      || accountFreshness?.platform || null;

    const byPost = new Map();
    for (const row of ownPostRows) {
      const key = row.platform_post_id;
      if (!byPost.has(key)) byPost.set(key, []);
      byPost.get(key).push(row);
    }

    const posts = [...byPost.entries()].map(([platformPostId, rows]) => {
      const post = rows[0].post_id ? postsById.get(rows[0].post_id) : null;
      const workflow = post?.workflow_state || {};
      const youtube = workflow.youtube || {};
      return {
        platformPostId,
        postId: rows[0].post_id || null,
        title: post?.title || post?.caption || platformPostId,
        publishedAt: post?.published_at || null,
        // Recorded at publish (privacy_status) or at restore
        // (privacy_status_at_restore). Either tells the reader why a video with
        // no numbers has no numbers.
        privacyStatus: youtube.privacy_status || youtube.privacy_status_at_restore || null,
        metrics: aggregateMetrics(rows, definitionsByKey),
      };
    });

    // Snapshot-shaped posts (TikTok): one summary row per (post, metric).
    const snapshotByPost = new Map();
    for (const row of ownSnapshots) {
      if (!row.platform_post_id) continue;   // account-level; handled below
      if (!snapshotByPost.has(row.platform_post_id)) snapshotByPost.set(row.platform_post_id, []);
      snapshotByPost.get(row.platform_post_id).push(row);
    }
    for (const [platformPostId, rows] of snapshotByPost.entries()) {
      const cat = catalogueByKey.get(`${accountId}:${platformPostId}`) || null;
      const ourPostId = rows[0].post_id || cat?.post_id || null;
      const post = ourPostId ? postsById.get(ourPostId) : null;
      posts.push({
        platformPostId,
        postId: ourPostId,
        // The platform's own title first: it is what the creator sees on TikTok.
        title: cat?.title || cat?.description || post?.title || post?.caption || "Untitled TikTok video",
        publishedAt: cat?.published_at || post?.published_at || null,
        shareUrl: cat?.share_url || null,
        // video.list returns public videos only, so anything here is public.
        privacyStatus: null,
        snapshot: true,
        metrics: snapshotMetrics(rows, definitionsByKey),
      });
    }

    return {
      accountId,
      platform,
      freshness: accountFreshness,
      videoListGranted: platform === "tiktok" ? videoListGrantedFor(accountId) : null,
      metrics: [
        ...aggregateMetrics(ownAccountRows, definitionsByKey),
        ...snapshotMetrics(ownSnapshots.filter((r) => !r.platform_post_id), definitionsByKey),
      ],
      posts: posts.sort((a, b) =>
        String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")),
      ),
    };
  });

  return { accounts, definitions, windowStart, freshnessAvailable, incomplete };
}

export default { fetchSocialPerformance, describeEmptiness, formatMetricValue };
