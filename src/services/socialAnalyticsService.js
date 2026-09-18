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
} from "./socialAnalyticsAggregate";

// Re-exported so consumers have one import site for the analytics read layer,
// while the arithmetic stays in a file with no I/O that a guard can execute.
export { describeEmptiness, formatMetricValue };

/** Tables that may legitimately not exist yet on an un-migrated database. */
const OPTIONAL_ERROR_CODES = new Set(["42P01", "42703", "PGRST200", "PGRST205"]);

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
  if (!userId) return { accounts: [], definitions: [], windowStart: null };

  // Dates, not timestamps: the fact tables are keyed by the PLATFORM's calendar
  // day in its own reporting timezone, so comparing them against an instant
  // would silently drop or include an edge day depending on the viewer's clock.
  const windowStart = new Date(Date.now() - rangeDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [definitions, accountRows, postRows, freshnessRows] = await Promise.all([
    selectOptional(
      supabase
        .from("social_metric_definitions")
        .select("metric_key, display_name, unit, is_additive"),
      "social_metric_definitions",
    ),
    selectOptional(
      supabase
        .from("social_account_metrics_daily")
        .select("connected_account_id, platform, metric_key, metric_date, value")
        .gte("metric_date", windowStart),
      "social_account_metrics_daily",
    ),
    selectOptional(
      supabase
        .from("social_post_metrics_daily")
        .select("connected_account_id, platform, platform_post_id, post_id, metric_key, metric_date, value")
        .gte("metric_date", windowStart),
      "social_post_metrics_daily",
    ),
    selectOptional(
      supabase
        .from("social_analytics_freshness")
        .select("connected_account_id, platform, source, last_success_at, last_attempt_at, last_status, last_error_code, failures_24h"),
      "social_analytics_freshness",
    ),
  ]);

  const definitionsByKey = new Map(definitions.map((d) => [d.metric_key, d]));

  // Titles and privacy for the posts that actually have metrics — fetched by id
  // rather than reused from the page's list, which is limited to the same
  // window and would leave older posts nameless.
  const postIds = [...new Set(postRows.map((r) => r.post_id).filter(Boolean))];
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
  for (const row of freshnessRows) {
    const existing = freshnessByAccount.get(row.connected_account_id);
    if (!existing || (row.last_attempt_at || "") > (existing.last_attempt_at || "")) {
      freshnessByAccount.set(row.connected_account_id, row);
    }
  }

  const accountIds = new Set([
    ...accountRows.map((r) => r.connected_account_id),
    ...postRows.map((r) => r.connected_account_id),
    ...freshnessRows.map((r) => r.connected_account_id),
  ]);

  const accounts = [...accountIds].map((accountId) => {
    const ownAccountRows = accountRows.filter((r) => r.connected_account_id === accountId);
    const ownPostRows = postRows.filter((r) => r.connected_account_id === accountId);
    const freshness = freshnessByAccount.get(accountId) || null;

    const platform =
      ownAccountRows[0]?.platform || ownPostRows[0]?.platform || freshness?.platform || null;

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

    return {
      accountId,
      platform,
      freshness,
      metrics: aggregateMetrics(ownAccountRows, definitionsByKey),
      posts: posts.sort((a, b) =>
        String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")),
      ),
    };
  });

  return { accounts, definitions, windowStart };
}

export default { fetchSocialPerformance, describeEmptiness, formatMetricValue };
