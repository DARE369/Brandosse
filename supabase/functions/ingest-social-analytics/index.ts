// supabase/functions/ingest-social-analytics/index.ts
//
// Pulls YouTube and TikTok analytics into the fact tables from 20260909140000
// and 20260922120000. TikTok lives in ./tiktok.ts; the YouTube pass is below.
//
// ── Platforms are isolated ──────────────────────────────────────────────────
// Each platform runs in its own try. A missing TikTok meter, or a YouTube
// outage, must not stop the other platform's collection — one shared failure
// would silence both, and the freshness view would go stale for everyone.
//
// ── The shape of the problem ────────────────────────────────────────────────
// Quota is per CLOUD PROJECT, shared by every user of the product. So this is
// not "fetch analytics for an account" run in a loop — it is a shared budget
// being allocated across accounts, and the budget must be checked BEFORE each
// account rather than discovered when Google refuses. One user with 400
// videos would otherwise consume the whole allowance and stop analytics for
// everybody, including people who did nothing.
//
// social_api_quota_today answers "what is left today", in the platform's own
// reset timezone. This worker consults it per account and stops cleanly with
// `skipped_rate_limited` rather than failing loudly for a condition that is
// not an error.
//
// ── Every run is recorded, including the ones that do nothing ───────────────
// A row lands in social_ingestion_runs whichever way the run ends. That is the
// whole point of the ledger: ingestion that silently stops is otherwise
// undetectable — the tables just stop gaining rows, every chart keeps
// rendering the last thing it saw, and nothing reports a fault. "Skipped
// because no scope" and "never ran" look identical without it.
//
// ── What this does NOT do, deliberately ────────────────────────────────────
// It fetches metrics only for videos WE published — posts.external_post_id.
// Backfilling a channel's pre-existing catalogue needs the Data API's
// playlistItems.list, which draws on a different quota meter and is a
// separate decision about how much of someone's history we are entitled to
// pull on first connect. Left out rather than done halfway.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import { requireInvokeSecret } from "../_shared/connectionHelpers.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, toErrorPayload } from "../_shared/http.ts";
import { decryptToken } from "../_shared/tokenCrypto.ts";
import {
  fetchAudienceRetention,
  fetchChannelDailyMetrics,
  fetchVideoBreakdowns,
  fetchVideoDailyMetrics,
  QUOTA_COST_PER_REPORT,
  REPORTING_TIMEZONE,
} from "../_shared/youtube.analytics.service.ts";
import { type Admin, closeRun } from "./ledger.ts";
import { ingestTikTok } from "./tiktok.ts";

const SOURCE = "youtube_analytics_reports";
const PLATFORM = "youtube";

/**
 * The Analytics API is metered separately from the Data API's unit pool.
 * Charging report reads against the upload allowance would cost the ability to
 * publish by reading analytics — see social_api_quota_limits.
 */
const QUOTA_KEY = "analytics";

const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";

/**
 * How far back a first run reaches.
 *
 * 90 days, not "everything": YouTube Analytics serves arbitrary history, but a
 * full backfill for a large channel is thousands of rows and a meaningful
 * share of a shared daily budget. 90 days is enough to see trend and
 * seasonality, and the window is a constant precisely so raising it is a
 * deliberate decision with a visible cost.
 */
const BACKFILL_DAYS = 90;

/**
 * How far back an incremental run re-reads.
 *
 * NOT 1. YouTube REVISES recent analytics for several days as it filters spam
 * and reconciles playback. Fetching only yesterday would freeze each day at
 * its first, least accurate value — and because the fact tables are keyed on
 * (account, video, metric, date), re-reading overwrites cleanly. The cost of
 * three days is one request; the cost of never revisiting is permanently
 * wrong history.
 */
const INCREMENTAL_DAYS = 3;

/** Videos whose retention curve and breakdowns are refreshed per run. */
const DEEP_DIVE_VIDEOS_PER_RUN = 5;

/** Accounts processed per invocation, so one run cannot exhaust the budget. */
const MAX_ACCOUNTS_PER_RUN = 25;

type AccountRow = {
  id: string;
  user_id: string;
  platform: string;
  account_id: string;
  connection_status: string | null;
};

/** YYYY-MM-DD in the platform's reporting timezone, offset by `daysAgo`. */
function reportDate(daysAgo: number): string {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: REPORTING_TIMEZONE }));
  local.setDate(local.getDate() - daysAgo);
  return local.toISOString().slice(0, 10);
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    requireInvokeSecret(req);

    const admin = createAdminClient();

    // Optional {account_id}: request_social_ingestion (20260922120000) sends it
    // right after a connect, so a new account is collected now rather than at
    // the next 6-hourly cron. The cron sends {}. Only a UUID is honoured.
    const body = await req.json().catch(() => ({})) as { account_id?: unknown };
    const onlyAccountId = typeof body?.account_id === "string"
        && /^[0-9a-f-]{36}$/i.test(body.account_id)
      ? body.account_id
      : null;

    // In PARALLEL: the passes share no budget and no tables, and run in
    // sequence one slow platform consumed the other's share of the edge
    // runtime's wall clock. allSettled, so one throwing cannot cancel the other.
    const passes: Array<[string, (a: Admin) => Promise<Record<string, unknown>>]> = [
      ["youtube", (a) => ingestYouTube(a, { onlyAccountId })],
      ["tiktok", (a) => ingestTikTok(a, { onlyAccountId })],
    ];
    const settled = await Promise.allSettled(passes.map(([, pass]) => pass(admin)));
    const results: Record<string, Record<string, unknown>> = {};
    settled.forEach((outcome, i) => {
      const platform = passes[i][0];
      if (outcome.status === "fulfilled") {
        results[platform] = { ok: true, ...outcome.value };
      } else {
        console.error(`[ingest-social-analytics] ${platform} pass failed:`, (outcome.reason as Error)?.message);
        results[platform] = { ok: false, ...toErrorPayload(outcome.reason) };
      }
    });

    // Not 200 when any platform failed outright: the edge-function logs and
    // anything watching status codes must see it, even though the other
    // platform's rows landed.
    const ok = Object.values(results).every((r) => r.ok);
    return jsonResponse({ ok, ...results }, ok ? 200 : 500);
  } catch (error) {
    console.error("[ingest-social-analytics] run failed:", (error as Error).message);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});

async function ingestYouTube(
  admin: Admin,
  { onlyAccountId = null }: { onlyAccountId?: string | null } = {},
) {
    const summary = {
      accounts_considered: 0,
      ingested: 0,
      skipped_no_scope: 0,
      skipped_rate_limited: 0,
      failed: 0,
      rows_written: 0,
      quota_spent: 0,
    };

    // ── The shared budget, read once up front ────────────────────────────────
    const { data: quotaRow, error: quotaErr } = await admin
      .from("social_api_quota_today")
      .select("remaining, usable_limit, spent, reset_timezone")
      .eq("platform", PLATFORM)
      .eq("quota_key", QUOTA_KEY)
      .maybeSingle();

    if (quotaErr) throw quotaErr;
    if (!quotaRow) {
      // Fail closed and say why. Proceeding with no budget information would
      // mean spending an allowance nobody is counting, which is the exact
      // failure the ledger exists to prevent.
      // Status set EXPLICITLY, not left to message matching.
      //
      // mapErrorToStatusCode infers the status from substrings, and every
      // phrasing of this error necessarily names social_api_quota_limits —
      // which contains "quota", so it inferred 429. That tells a monitor to
      // back off and retry a misconfiguration that will never fix itself.
      // Same collapsing of distinct failures that had process-jobs reporting
      // auth rejections as crashes. An explicit statusCode takes precedence
      // over the inference, so the meaning cannot drift with the wording.
      const err = new Error(
        `analytics_meter_not_configured: social_api_quota_limits has no row for `
        + `${PLATFORM}/${QUOTA_KEY}. Refusing to call the API with no budget to `
        + "check against. Apply migration 20260911140000.",
      ) as Error & { statusCode: number };
      err.statusCode = 503;   // our dependency is unconfigured, not the caller's fault
      throw err;
    }

    let remaining = Number(quotaRow.remaining) || 0;

    // ── Accounts to consider ─────────────────────────────────────────────────
    let accountQuery = admin
      .from("connected_accounts")
      .select("id, user_id, platform, account_id, connection_status")
      .eq("platform", PLATFORM)
      .eq("provider", PLATFORM)
      .eq("is_mock", false)
      .in("connection_status", ["active", "connected"]);
    if (onlyAccountId) accountQuery = accountQuery.eq("id", onlyAccountId);
    const { data: accounts, error: accErr } = await accountQuery.limit(MAX_ACCOUNTS_PER_RUN);

    if (accErr) throw accErr;
    summary.accounts_considered = (accounts || []).length;

    for (const account of (accounts || []) as AccountRow[]) {
      // ── Budget gate, per account ──────────────────────────────────────────
      //
      // Checked before the run row is created so a rate-limited account is
      // recorded as SKIPPED rather than started-and-abandoned. The reaper
      // would otherwise have to clean up runs that never began.
      const estimatedCost = QUOTA_COST_PER_REPORT * (2 + DEEP_DIVE_VIDEOS_PER_RUN * 6);
      if (remaining < estimatedCost) {
        await admin.from("social_ingestion_runs").insert({
          connected_account_id: account.id,
          platform: PLATFORM,
          source: SOURCE,
          mode: "incremental",
          quota_key: QUOTA_KEY,
          status: "skipped_rate_limited",
          finished_at: new Date().toISOString(),
        });
        summary.skipped_rate_limited += 1;
        continue;
      }

      // ── Credentials and scope ─────────────────────────────────────────────
      const { data: secret } = await admin
        .from("connected_account_secrets")
        .select("access_token_ciphertext, granted_scopes")
        .eq("connected_account_id", account.id)
        .maybeSingle();

      const scopes: string[] = (secret?.granted_scopes as string[]) || [];
      if (!secret?.access_token_ciphertext || !scopes.includes(ANALYTICS_SCOPE)) {
        // Recorded, not silently passed over. Scopes are fixed at consent, so
        // this account can NEVER produce analytics until the user reconnects —
        // and a UI that cannot see this reason would show an empty chart and
        // let the user assume there was simply nothing to report.
        await admin.from("social_ingestion_runs").insert({
          connected_account_id: account.id,
          platform: PLATFORM,
          source: SOURCE,
          mode: "incremental",
          quota_key: QUOTA_KEY,
          status: "skipped_no_scope",
          finished_at: new Date().toISOString(),
        });
        summary.skipped_no_scope += 1;
        continue;
      }

      // ── Backfill or incremental? ──────────────────────────────────────────
      //
      // Decided from the ledger, not from whether fact rows exist. A run that
      // legitimately found nothing would otherwise look like "never ingested"
      // forever, and each pass would re-backfill 90 days.
      const { data: lastSuccess } = await admin
        .from("social_ingestion_runs")
        .select("id, window_end")
        .eq("connected_account_id", account.id)
        .eq("source", SOURCE)
        .eq("status", "succeeded")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const mode: "backfill" | "incremental" = lastSuccess ? "incremental" : "backfill";
      const startDate = reportDate(mode === "backfill" ? BACKFILL_DAYS : INCREMENTAL_DAYS);
      const endDate = reportDate(1);   // yesterday: today is still accumulating

      const { data: run, error: runErr } = await admin
        .from("social_ingestion_runs")
        .insert({
          connected_account_id: account.id,
          platform: PLATFORM,
          source: SOURCE,
          mode,
          quota_key: QUOTA_KEY,
          window_start: startDate,
          window_end: endDate,
          status: "running",
        })
        .select("id")
        .single();

      if (runErr || !run) {
        console.error("[ingest-social-analytics] could not open a run:", runErr?.message);
        summary.failed += 1;
        continue;
      }

      let token: string;
      try {
        token = await decryptToken(secret.access_token_ciphertext as string);
      } catch (err) {
        await closeRun(admin, run.id, {
          status: "failed",
          error_code: "token_undecryptable",
          error_detail: `Stored credential could not be read: ${(err as Error).message}`.slice(0, 300),
        });
        summary.failed += 1;
        continue;
      }

      // ── Which videos ──────────────────────────────────────────────────────
      const { data: posts } = await admin
        .from("posts")
        .select("id, external_post_id, published_at")
        .eq("user_id", account.user_id)
        .eq("platform", PLATFORM)
        .eq("status", "published")
        .not("external_post_id", "is", null)
        .order("published_at", { ascending: false })
        .limit(500);

      const videoIds = [...new Set(
        (posts || []).map((p) => String(p.external_post_id)).filter(Boolean),
      )];
      const postIdByVideo = new Map<string, string>();
      for (const p of posts || []) {
        if (p.external_post_id) postIdByVideo.set(String(p.external_post_id), p.id as string);
      }

      let rowsWritten = 0;
      let httpRequests = 0;
      let quotaSpent = 0;
      let firstError: { code: string; detail: string } | null = null;

      const note = (o: {
        httpRequests: number;
        quotaSpent: number;
        error: { code: string; detail: string } | null;
      }) => {
        httpRequests += o.httpRequests;
        quotaSpent += o.quotaSpent;
        remaining -= o.quotaSpent;
        if (o.error && !firstError) firstError = { code: o.error.code, detail: o.error.detail };
      };

      // ── Channel-level daily ───────────────────────────────────────────────
      const channel = await fetchChannelDailyMetrics(token, startDate, endDate);
      note(channel);
      if (channel.rows.length > 0) {
        const payload = channel.rows.map((r) => ({
          connected_account_id: account.id,
          metric_key: r.metricKey,
          metric_date: r.metricDate,
          value: r.value,
          reporting_timezone: REPORTING_TIMEZONE,
          ingestion_run_id: run.id,
          // Tenancy columns are OVERWRITTEN by the trigger from
          // connected_accounts; supplied only because they are NOT NULL.
          user_id: account.user_id,
          scope: "personal",
          platform: PLATFORM,
        }));
        const { error } = await admin
          .from("social_account_metrics_daily")
          .upsert(payload, { onConflict: "connected_account_id,metric_key,metric_date" });
        if (error) console.error("[ingest] channel upsert:", error.message);
        else rowsWritten += payload.length;
      }

      // ── Per-video daily ───────────────────────────────────────────────────
      if (videoIds.length > 0) {
        const perVideo = await fetchVideoDailyMetrics(token, videoIds, startDate, endDate);
        note(perVideo);
        if (perVideo.rows.length > 0) {
          const payload = perVideo.rows.map((r) => ({
            connected_account_id: account.id,
            platform_post_id: r.platformPostId as string,
            metric_key: r.metricKey,
            metric_date: r.metricDate,
            value: r.value,
            reporting_timezone: REPORTING_TIMEZONE,
            post_id: postIdByVideo.get(r.platformPostId as string) ?? null,
            ingestion_run_id: run.id,
            user_id: account.user_id,
            scope: "personal",
            platform: PLATFORM,
          }));
          // Upsert, not insert: re-reading recent days is the point (YouTube
          // revises them), and the primary key makes the rewrite exact.
          const { error } = await admin
            .from("social_post_metrics_daily")
            .upsert(payload, {
              onConflict: "connected_account_id,platform_post_id,metric_key,metric_date",
            });
          if (error) console.error("[ingest] daily upsert:", error.message);
          else rowsWritten += payload.length;
        }
      }

      // ── Deep dive: breakdowns + retention for the newest few ───────────────
      //
      // Per-video and per-dimension, so cost scales with the number of videos.
      // Restricted to the newest handful per run: those are the ones anyone is
      // still deciding about, and older videos keep whatever was last fetched.
      const observedAt = new Date().toISOString();

      for (const videoId of videoIds.slice(0, DEEP_DIVE_VIDEOS_PER_RUN)) {
        if (remaining < QUOTA_COST_PER_REPORT * 6) break;   // leave the reserve intact

        const breakdowns = await fetchVideoBreakdowns(token, videoId, startDate, endDate);
        note(breakdowns);
        if (breakdowns.rows.length > 0) {
          const payload = breakdowns.rows.map((r) => ({
            connected_account_id: account.id,
            platform_post_id: r.platformPostId,
            metric_key: r.metricKey,
            dimension_key: r.dimensionKey,
            dimension_value: r.dimensionValue,
            period_start: startDate,
            period_end: endDate,
            value: r.value,
            reporting_timezone: REPORTING_TIMEZONE,
            post_id: postIdByVideo.get(r.platformPostId) ?? null,
            ingestion_run_id: run.id,
            user_id: account.user_id,
            scope: "personal",
            platform: PLATFORM,
          }));
          const { error } = await admin
            .from("social_post_breakdowns")
            .upsert(payload, {
              onConflict:
                "connected_account_id,platform_post_id,metric_key,dimension_key,dimension_value,period_start,period_end",
            });
          if (error) console.error("[ingest] breakdown upsert:", error.message);
          else rowsWritten += payload.length;
        }

        const retention = await fetchAudienceRetention(token, videoId, startDate, endDate);
        note(retention);
        if (retention.rows.length > 0) {
          const payload = retention.rows.map((r) => ({
            connected_account_id: account.id,
            platform_post_id: r.platformPostId,
            observed_at: observedAt,
            elapsed_ratio: r.elapsedRatio,
            watch_ratio: r.watchRatio,
            post_id: postIdByVideo.get(r.platformPostId) ?? null,
            ingestion_run_id: run.id,
            user_id: account.user_id,
            scope: "personal",
            platform: PLATFORM,
          }));
          const { error } = await admin
            .from("social_retention_curves")
            .upsert(payload, {
              onConflict: "connected_account_id,platform_post_id,observed_at,elapsed_ratio",
            });
          if (error) console.error("[ingest] retention upsert:", error.message);
          else rowsWritten += payload.length;
        }
      }

      // ── Close the run honestly ────────────────────────────────────────────
      //
      // `partial` is a real outcome, not a rounding of success: rows landed AND
      // something failed. Reporting it as succeeded would let the next run
      // treat an incomplete window as covered and never revisit it.
      const status = firstError ? (rowsWritten > 0 ? "partial" : "failed") : "succeeded";

      await closeRun(admin, run.id, {
        status,
        rows_written: rowsWritten,
        http_requests: httpRequests,
        quota_units_spent: quotaSpent,
        cursor: endDate,
        error_code: firstError ? (firstError as { code: string }).code : null,
        error_detail: firstError ? (firstError as { detail: string }).detail : null,
      });

      summary.rows_written += rowsWritten;
      summary.quota_spent += quotaSpent;
      if (status === "succeeded") summary.ingested += 1;
      else summary.failed += 1;
    }

    return { ...summary, quota_remaining: Math.max(remaining, 0) };
}
