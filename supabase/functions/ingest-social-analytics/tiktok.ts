// supabase/functions/ingest-social-analytics/tiktok.ts
//
// TikTok analytics ingestion: profile, account totals and per-video counters
// into the snapshot tables (20260909140000, 20260922120000).
//
// ── Every value is an observation, not a history ────────────────────────────
// TikTok exposes no time series. Each run stamps every counter with ONE
// observed_at, so "views on Tuesday" is answered by differencing Tuesday's and
// Monday's observations. Snapshotting has to start the day an account
// connects: history that was never observed cannot be recovered later.
//
// ── Our posts carry a publish_id, not a video id ────────────────────────────
// Direct Post returns a publish_id, and tiktok.service.ts stores that as
// posts.external_post_id because it is all TikTok gives at publish time.
// video.list keys videos by their video id. The two never match, so without
// reconciliation no TikTok post published through us could ever show its
// numbers. TikTok fills publicaly_available_post_id on the status endpoint
// once the post is public and past moderation; each run resolves a few
// outstanding publish_ids, least-recently-checked first, and swaps the real id
// in through merge_post_tiktok_state (atomic compare-and-swap + JSON merge).
//
// ── Which posts are ours ────────────────────────────────────────────────────
// Selected by posts.account_id, never by user_id + platform. This user has
// mock TikTok posts from the old simulated flow whose external_post_ids are
// fabricated; matching them by user would attach real numbers to fake posts.
//
// ── Bounded ─────────────────────────────────────────────────────────────────
// At most MAX_ACCOUNTS_PER_RUN accounts, least-recently-attempted first, and
// no new account is started after TIME_BUDGET_MS — an edge function has a
// wall-clock limit, and an account never reached is picked first next run.

import {
  fetchAccount,
  fetchPublishedVideoId,
  fetchVideos,
  hasScope,
  MAX_VIDEO_PAGES,
  orderByLastAttempt,
  pickReconcileCandidates,
  QUOTA_COST_PER_REQUEST,
  RECONCILE_GAVE_UP,
  SCOPES,
  type SnapshotFact,
  stopsAccount,
  type TikTokError,
  VIDEO_ID_RE,
} from "../_shared/tiktok.analytics.service.ts";
import { decryptToken } from "../_shared/tokenCrypto.ts";
import { type Admin, closeRun, finalStatus, recordSkippedRun } from "./ledger.ts";

export const SOURCE = "tiktok_video_list";
const PLATFORM = "tiktok";
const QUOTA_KEY = "analytics";

/** Accounts processed per invocation, so one run cannot exhaust the budget. */
const MAX_ACCOUNTS_PER_RUN = 25;

/** Stop STARTING accounts after this long; the edge runtime has a wall clock. */
const TIME_BUDGET_MS = 110_000;

/** publish_id → video id lookups per account per run. Each is one request. */
const RECONCILE_PER_RUN = 5;

export type TikTokSummary = {
  accounts_considered: number;
  ingested: number;
  skipped_no_scope: number;
  skipped_rate_limited: number;
  deferred_by_time_budget: number;
  failed: number;
  rows_written: number;
  quota_spent: number;
  posts_reconciled: number;
  truncated_accounts: number;
};

type AccountRow = { id: string; user_id: string };

export async function ingestTikTok(
  admin: Admin,
  { onlyAccountId = null }: { onlyAccountId?: string | null } = {},
): Promise<TikTokSummary> {
  const startedAt = Date.now();
  const summary: TikTokSummary = {
    accounts_considered: 0,
    ingested: 0,
    skipped_no_scope: 0,
    skipped_rate_limited: 0,
    deferred_by_time_budget: 0,
    failed: 0,
    rows_written: 0,
    quota_spent: 0,
    posts_reconciled: 0,
    truncated_accounts: 0,
  };

  // ── The shared budget ──────────────────────────────────────────────────────
  const { data: quotaRow, error: quotaErr } = await admin
    .from("social_api_quota_today")
    .select("remaining")
    .eq("platform", PLATFORM)
    .eq("quota_key", QUOTA_KEY)
    .maybeSingle();
  if (quotaErr) throw quotaErr;
  if (!quotaRow) {
    // Fail closed, same as YouTube: never call an API with no budget to count against.
    const err = new Error(
      `analytics_meter_not_configured: social_api_quota_limits has no row for ${PLATFORM}/${QUOTA_KEY}. `
      + "Apply migration 20260922120000.",
    ) as Error & { statusCode: number };
    err.statusCode = 503;
    throw err;
  }
  let remaining = Number(quotaRow.remaining) || 0;

  // ── Accounts, least-recently-attempted first ──────────────────────────────
  let accountQuery = admin
    .from("connected_accounts")
    .select("id, user_id")
    .eq("platform", PLATFORM)
    .eq("provider", PLATFORM)
    .eq("is_mock", false)
    .in("connection_status", ["active", "connected"]);
  if (onlyAccountId) accountQuery = accountQuery.eq("id", onlyAccountId);
  const { data: allAccounts, error: accErr } = await accountQuery.limit(1000);
  if (accErr) throw accErr;

  const lastAttempt = new Map<string, string>();
  if ((allAccounts || []).length > MAX_ACCOUNTS_PER_RUN) {
    // Rotation input: each account's latest run of this source. A failure here
    // degrades to unordered selection, which is still correct for this run.
    const { data: recentRuns, error: runsErr } = await admin
      .from("social_ingestion_runs")
      .select("connected_account_id, started_at")
      .eq("source", SOURCE)
      .gte("started_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order("started_at", { ascending: false })
      .limit(5000);
    if (runsErr) console.error("[ingest-tiktok] rotation lookup failed; accounts unordered:", runsErr.message);
    for (const r of recentRuns || []) {
      if (!lastAttempt.has(r.connected_account_id)) lastAttempt.set(r.connected_account_id, r.started_at);
    }
  }
  const accounts = orderByLastAttempt((allAccounts || []) as AccountRow[], lastAttempt).slice(0, MAX_ACCOUNTS_PER_RUN);
  summary.accounts_considered = accounts.length;

  for (const account of accounts) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      // Not recorded as a run: nothing was attempted. Rotation puts this
      // account first next time.
      summary.deferred_by_time_budget += 1;
      continue;
    }

    const skip = (status: string, error_code: string, error_detail: string) =>
      recordSkippedRun(admin, {
        connected_account_id: account.id,
        platform: PLATFORM,
        source: SOURCE,
        quota_key: QUOTA_KEY,
        status,
        error_code,
        error_detail,
      });

    const { data: secret, error: secretErr } = await admin
      .from("connected_account_secrets")
      .select("access_token_ciphertext, granted_scopes")
      .eq("connected_account_id", account.id)
      .maybeSingle();

    if (secretErr) {
      // A failed LOOKUP is not a missing credential. Telling the user to
      // reconnect because our query failed would send them to fix our fault.
      await skip("failed", "secret_lookup_failed", `Could not read stored credential: ${secretErr.message}`.slice(0, 300));
      summary.failed += 1;
      continue;
    }

    const scopes = secret?.granted_scopes;
    const canStats = hasScope(scopes, SCOPES.stats) || hasScope(scopes, SCOPES.profile);
    const canList = hasScope(scopes, SCOPES.videoList);
    const canReconcile = hasScope(scopes, SCOPES.publish);

    if (!secret?.access_token_ciphertext) {
      await skip("skipped_no_scope", "credential_missing", "No stored credential for this account; it must be reconnected.");
      summary.skipped_no_scope += 1;
      continue;
    }
    if (!canStats && !canList) {
      // Scopes are fixed at consent, so this account produces no analytics
      // until the user reconnects and allows them.
      await skip("skipped_no_scope", "scope_not_granted",
        "This connection did not grant user.info.stats, user.info.profile or video.list.");
      summary.skipped_no_scope += 1;
      continue;
    }

    // ── Budget gate, before the run row exists ──────────────────────────────
    const estimatedCost = QUOTA_COST_PER_REQUEST
      * (1 + (canList ? MAX_VIDEO_PAGES : 0) + (canReconcile ? RECONCILE_PER_RUN : 0));
    if (remaining < estimatedCost) {
      await skip("skipped_rate_limited", "daily_budget_reached",
        "Today's TikTok analytics budget is used up; the next run after the daily reset collects this account.");
      summary.skipped_rate_limited += 1;
      continue;
    }

    const { data: lastSuccess } = await admin
      .from("social_ingestion_runs")
      .select("id")
      .eq("connected_account_id", account.id)
      .eq("source", SOURCE)
      .eq("status", "succeeded")
      .limit(1)
      .maybeSingle();

    const { data: run, error: runErr } = await admin
      .from("social_ingestion_runs")
      .insert({
        connected_account_id: account.id,
        platform: PLATFORM,
        source: SOURCE,
        // Snapshots have no window: they observe now. "backfill" marks the
        // first observation, which is the start of this account's history.
        mode: lastSuccess ? "incremental" : "backfill",
        quota_key: QUOTA_KEY,
        status: "running",
      })
      .select("id")
      .single();
    if (runErr || !run) {
      console.error("[ingest-tiktok] could not open a run:", runErr?.message);
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

    const observedAt = new Date().toISOString();
    let rowsWritten = 0;
    let httpRequests = 0;
    let quotaSpent = 0;
    let firstError: TikTokError | null = null;
    let halted = false;   // token rejected or rate-limited: stop asking TikTok
    const note = (o: { httpRequests: number; quotaSpent: number; error: TikTokError | null }) => {
      httpRequests += o.httpRequests;
      quotaSpent += o.quotaSpent;
      remaining -= o.quotaSpent;
      if (o.error && !firstError) firstError = o.error;
      if (stopsAccount(o.error)) halted = true;
    };
    const writeFailed = (what: string, message: string) => {
      console.error(`[ingest-tiktok] ${what}: ${message}`);
      if (!firstError) firstError = { code: "write_failed", detail: `${what}: ${message}`.slice(0, 300), retriable: true };
    };

    // ── 1. Profile + account totals ─────────────────────────────────────────
    const acct = await fetchAccount(token, scopes);
    note(acct);
    if (acct.profile) {
      const p = acct.profile;
      const followersFact = acct.facts.find((f) => f.metricKey === "followers_total");

      // JSON merged in SQL, not read-modify-written here: connect writes this
      // column too, and a whole-object write after 30s of network calls would
      // erase anything it wrote meanwhile.
      const { error: metaErr } = await admin.rpc("merge_account_platform_metadata", {
        p_account_id: account.id,
        p_patch: {
          tiktok_profile: {
            username: p.username,
            bio: p.bio,
            is_verified: p.isVerified,
            profile_deep_link: p.profileDeepLink,
            // connected_accounts.follower_count DEFAULTS to 0 and so cannot
            // distinguish "none" from "not reported"; this can (null).
            followers: followersFact ? followersFact.value : null,
            refreshed_at: observedAt,
          },
        },
      });
      if (metaErr) writeFailed("profile merge", metaErr.message);

      const cols: Record<string, unknown> = { updated_at: observedAt };
      if (p.username) cols.username = p.username;
      if (p.displayName) cols.display_name = p.displayName;
      if (p.avatarUrl) {
        cols.avatar_url = p.avatarUrl;
        cols.profile_picture_url = p.avatarUrl;
      }
      if (followersFact) cols.follower_count = followersFact.value;
      const { error } = await admin.from("connected_accounts").update(cols).eq("id", account.id);
      if (error) writeFailed("profile columns", error.message);
    }
    if (acct.facts.length > 0) {
      const payload = acct.facts.map((f: SnapshotFact) => ({
        connected_account_id: account.id,
        metric_key: f.metricKey,
        observed_at: observedAt,
        value: f.value,
        ingestion_run_id: run.id,
        // Tenancy is OVERWRITTEN by trigger; supplied only because NOT NULL.
        user_id: account.user_id,
        scope: "personal",
        platform: PLATFORM,
      }));
      const { error } = await admin
        .from("social_account_metrics_snapshot")
        .upsert(payload, { onConflict: "connected_account_id,metric_key,observed_at" });
      if (error) writeFailed("account snapshot upsert", error.message);
      else rowsWritten += payload.length;
    }

    // ── 2. Our posts, and resolving publish_ids to video ids ────────────────
    const { data: ourPosts, error: postsErr } = await admin
      .from("posts")
      .select("id, external_post_id, workflow_state, published_at")
      .eq("account_id", account.id)
      .eq("platform", PLATFORM)
      .eq("status", "published")
      .not("external_post_id", "is", null)
      .order("published_at", { ascending: false })
      .limit(500);

    // Without the lookup we cannot know which videos are ours. The rows below
    // then OMIT post_id entirely, so the upsert leaves existing links intact
    // instead of overwriting every one of them with NULL.
    const postsKnown = !postsErr;
    if (postsErr) writeFailed("posts lookup", postsErr.message);

    const postIdByVideo = new Map<string, string>();
    for (const p of ourPosts || []) {
      const ext = String(p.external_post_id);
      if (VIDEO_ID_RE.test(ext)) postIdByVideo.set(ext, p.id as string);
    }

    if (canReconcile && postsKnown && !halted) {
      for (const cand of pickReconcileCandidates(ourPosts || [], RECONCILE_PER_RUN)) {
        if (halted) break;
        const publishId = String(cand.external_post_id);
        const r = await fetchPublishedVideoId(token, publishId);
        // Count the request, but a one-post failure (an expired publish_id)
        // belongs on THAT post, not on the run — otherwise one bad id marks
        // every future run "partial" and the page reports a broken collector.
        httpRequests += r.httpRequests;
        quotaSpent += r.quotaSpent;
        remaining -= r.quotaSpent;
        if (stopsAccount(r.error)) {
          halted = true;
          if (!firstError) firstError = r.error;
          break;
        }

        const tkState = ((cand.workflow_state || {}).tiktok || {}) as Record<string, unknown>;
        const attempts = (Number(tkState.reconcile_attempts) || 0) + 1;
        const status = r.videoId ? "resolved"
          : r.status === "FAILED" ? RECONCILE_GAVE_UP
          : "pending";

        const { data: changed, error } = await admin.rpc("merge_post_tiktok_state", {
          p_post_id: cand.id,
          p_expected_external_id: publishId,
          p_new_external_id: r.videoId,
          p_patch: {
            publish_id: publishId,
            reconcile_status: status,
            reconcile_attempts: attempts,
            reconcile_checked_at: observedAt,
            reconcile_last_error: r.error ? `${r.error.code}: ${r.error.detail}`.slice(0, 200) : null,
          },
        });
        if (error) writeFailed("publish_id reconciliation", error.message);
        else if (changed && r.videoId) {
          postIdByVideo.set(r.videoId, cand.id);
          summary.posts_reconciled += 1;
        }
      }
    }

    // ── 3. Public videos: catalogue + per-video counters ────────────────────
    let truncated = false;
    if (canList && !halted) {
      const vids = await fetchVideos(token);
      note(vids);
      truncated = vids.truncated;

      const link = (id: string) => (postsKnown ? { post_id: postIdByVideo.get(id) ?? null } : {});

      if (vids.videos.length > 0) {
        const catalogue = vids.videos.map((v) => ({
          connected_account_id: account.id,
          platform_post_id: v.id,
          title: v.title,
          description: v.description,
          share_url: v.shareUrl,
          published_at: v.createTime ? new Date(v.createTime * 1000).toISOString() : null,
          duration_seconds: v.durationSeconds,
          ...link(v.id),
          last_seen_at: observedAt,
          ingestion_run_id: run.id,
          user_id: account.user_id,
          scope: "personal",
          platform: PLATFORM,
        }));
        const { error } = await admin
          .from("social_platform_posts")
          .upsert(catalogue, { onConflict: "connected_account_id,platform_post_id" });
        if (error) writeFailed("catalogue upsert", error.message);
        else rowsWritten += catalogue.length;
      }

      if (vids.facts.length > 0) {
        const payload = vids.facts.map((f) => ({
          connected_account_id: account.id,
          platform_post_id: f.platformPostId as string,
          metric_key: f.metricKey,
          observed_at: observedAt,
          value: f.value,
          ...link(f.platformPostId as string),
          ingestion_run_id: run.id,
          user_id: account.user_id,
          scope: "personal",
          platform: PLATFORM,
        }));
        const { error } = await admin
          .from("social_post_metrics_snapshot")
          .upsert(payload, { onConflict: "connected_account_id,platform_post_id,metric_key,observed_at" });
        if (error) writeFailed("video snapshot upsert", error.message);
        else rowsWritten += payload.length;
      }
    }

    const status = finalStatus(firstError, rowsWritten);
    const fe = firstError as TikTokError | null;
    await closeRun(admin, run.id, {
      status,
      rows_written: rowsWritten,
      http_requests: httpRequests,
      quota_units_spent: quotaSpent,
      // The only resume state a snapshot source has: whether the page budget
      // cut the catalogue short. Kept visible rather than implied.
      cursor: truncated ? `truncated_at_${MAX_VIDEO_PAGES}_pages` : null,
      error_code: fe ? fe.code : null,
      error_detail: fe ? fe.detail : null,
    });

    summary.rows_written += rowsWritten;
    summary.quota_spent += quotaSpent;
    if (truncated) summary.truncated_accounts += 1;
    if (status === "succeeded") summary.ingested += 1;
    else summary.failed += 1;
  }

  return summary;
}
