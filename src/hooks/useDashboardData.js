"use client";

// Data layer for the Personal Dashboard, extracted from the old
// src/pages/Dashboard/UserDashboard.jsx so the new ui-v2 presentation layer
// can consume the exact same fetching/realtime/derived-value logic.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../services/supabaseClient";
import { GENERATION_STATUS, POST_STATUS } from "../constants/statuses";
import { useCreditBalance, useCreditSpendByCategory } from "./useCreditBalance";
import {
  getConnectedAccountSemanticStatus,
  getConnectedAccountDisplayName,
  normalizeConnectedAccountRow,
} from "../services/platforms/platformUtils";

const RECENT_GENERATION_LIMIT = 5;
const GENERATION_SEARCH_LIMIT = 120;
const UPCOMING_POST_LIMIT = 5;
const REALTIME_REFRESH_DEBOUNCE_MS = 800;
const TREND_WINDOW_DAYS = 30;

// Real trend delta: count in the last N days vs the N days before that,
// against whichever timestamp column actually reflects the transition
// (published_at/failed_at when the status has a real "became X at" column,
// created_at otherwise). No fabricated deltas — 0/0 reads as "steady".
function computeTrend(current, previous) {
  if (previous <= 0) {
    if (current <= 0) return { pct: 0, direction: "neutral" };
    return { pct: 100, direction: "up" };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct > 0) return { pct, direction: "up" };
  if (pct < 0) return { pct, direction: "down" };
  return { pct: 0, direction: "neutral" };
}

/* ───────────────────────────── pure helpers (also used by the page) ───────────────────────────── */

export function getTitleFromPrompt(prompt) {
  if (!prompt || typeof prompt !== "string") return "Untitled Generation";
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "Untitled Generation";
  const base = words.slice(0, 7).join(" ");
  return words.length > 7 ? `${base}...` : base;
}

export function getGenerationTitle(generation) {
  const metadataTitle = generation?.metadata?.title;
  const sessionTitle = generation?.session_title;
  if (typeof metadataTitle === "string" && metadataTitle.trim()) return metadataTitle.trim();
  if (typeof sessionTitle === "string" && sessionTitle.trim()) return sessionTitle.trim();
  return getTitleFromPrompt(generation?.prompt);
}

function getGenerationSearchText(generation) {
  const title = getGenerationTitle(generation);
  const prompt = generation?.prompt ?? "";
  return `${title} ${prompt}`.toLowerCase();
}

export function buildGenerationRoute(generation) {
  const sessionPath = generation?.session_id
    ? `/app/generate/${generation.session_id}`
    : "/app/generate";
  return generation?.id ? `${sessionPath}#${generation.id}` : sessionPath;
}

export function formatCount(value) {
  return Number(value ?? 0).toLocaleString();
}

export function getPostTitle(post) {
  if (typeof post?.title === "string" && post.title.trim()) return post.title.trim();
  if (typeof post?.caption === "string" && post.caption.trim()) return post.caption.trim().slice(0, 60);
  return "Untitled post";
}

export function normalizePlatformKey(platform) {
  const key = String(platform ?? "other").toLowerCase();
  return key === "twitter" ? "x" : key;
}

export function formatPlatformName(platform) {
  if (!platform || typeof platform !== "string") return "Platform";
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

// "Today · 4:30 PM" / "Tomorrow · …" / "Jun 21 · …"
export function formatScheduleTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { label: "Unscheduled", today: false };
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (dayDiff === 0) return { label: `Today · ${time}`, today: true };
  if (dayDiff === 1) return { label: `Tomorrow · ${time}`, today: false };
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { label: `${day} · ${time}`, today: false };
}

// Compact "3h 20m" countdown.
export function formatCountdown(value) {
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return null;
  const diffMs = target - Date.now();
  if (diffMs <= 0) return "now";
  const totalMinutes = Math.round(diffMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const ACCOUNT_STATUS_MAP = {
  active: { label: "Healthy", tone: "success" },
  connected: { label: "Healthy", tone: "success" },
  expired: { label: "Reconnect", tone: "warning" },
  reconnecting: { label: "Reconnecting", tone: "warning" },
  error: { label: "Needs attention", tone: "danger" },
  disconnected: { label: "Disconnected", tone: "danger" },
};

/**
 * LOCK L2.1 / L2.2 — an account's badge must reflect what it can actually do.
 *
 * This previously derived status from `connection_status` alone, with a
 * fallback of `{ label: "Healthy", tone: "success" }` for anything
 * unrecognised — a fail-open default expressed in UI. Two live consequences:
 *
 *   1. Four accounts (provider='direct') are structurally unable to publish —
 *      that code path was removed, and publish-post now rejects them outright.
 *      All four rendered as green "Healthy".
 *   2. The one real working account sat at health_score = 20 with a recorded
 *      failure reason and ALSO rendered green, because health_score and
 *      last_failure_reason were fetched and then never read.
 *
 * A user told "Healthy" has no reason to investigate. Precedence below runs
 * hard-blocked -> degraded -> connection state -> unknown, and there is
 * deliberately NO "assume healthy" branch: an unrecognised state reports as
 * unknown, because inventing reassurance is the defect being fixed.
 *
 * `can_publish` and `publish_block_reason` are computed in
 * connected_accounts_health_summary (migration 20260821220000) so every
 * consumer inherits them rather than re-deriving and re-breaking this.
 */
const PUBLISH_BLOCK_LABELS = {
  provider_removed: "Reconnect required",
  provider_missing: "Reconnect required",
  provider_unsupported: "Unsupported provider",
};

// Below this, the account is failing often enough that "Healthy" is a lie.
const DEGRADED_HEALTH_THRESHOLD = 70;

function toAccountCard(row) {
  const normalized = normalizeConnectedAccountRow(row) ?? row;
  const platformKey = normalizePlatformKey(normalized?.platform);

  const base = {
    id: normalized?.id,
    mark: platformKey.slice(0, 2).toUpperCase(),
    name: getConnectedAccountDisplayName(normalized) ?? formatPlatformName(platformKey),
    handle: normalized?.username ? `@${normalized.username}` : normalized?.account_name ?? "",
    isMock: !!normalized?.is_mock,
  };

  // 1. Hard block — cannot publish at all. Outranks everything, including an
  //    "active" connection_status, which is exactly the case that was lying.
  if (normalized?.can_publish === false) {
    const reason = normalized?.publish_block_reason;
    return {
      ...base,
      statusLabel: PUBLISH_BLOCK_LABELS[reason] ?? "Cannot publish",
      statusTone: "danger",
      blockReason: reason ?? "unknown",
      detail: "This account cannot publish. Reconnect it to restore posting.",
    };
  }

  // 2. Degraded — it can publish, but it has been failing.
  const health = Number(normalized?.health_score);
  if (Number.isFinite(health) && health < DEGRADED_HEALTH_THRESHOLD) {
    return {
      ...base,
      statusLabel: "Degraded",
      statusTone: "warning",
      healthScore: health,
      detail: normalized?.last_failure_reason || "Recent publishing attempts have failed.",
    };
  }

  // 3. Connection state, for accounts that are otherwise fine.
  const semantic = getConnectedAccountSemanticStatus(normalized?.connection_status);
  const statusInfo = ACCOUNT_STATUS_MAP[semantic];

  if (statusInfo) {
    return {
      ...base,
      statusLabel: statusInfo.label,
      statusTone: statusInfo.tone,
      healthScore: Number.isFinite(health) ? health : undefined,
      detail: normalized?.last_failure_reason || undefined,
    };
  }

  // 4. Unrecognised — say so. Never assume healthy.
  return {
    ...base,
    statusLabel: "Unknown",
    statusTone: "warning",
    detail: `Unrecognised connection state: ${normalized?.connection_status ?? "none"}`,
  };
}

/* ───────────────────────────── the hook ───────────────────────────── */

export function useDashboardData(userId, profile) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [generationIndex, setGenerationIndex] = useState([]);
  const [stats, setStats] = useState({
    totalGenerated: 0,
    scheduledPosts: 0,
    publishedPosts: 0,
    drafts: 0,
    clipsReady: 0,
    failedPosts: 0,
    publishingPosts: 0,
    archivedPosts: 0,
    totalPosts: 0,
    // Posts whose status is not one of POST_STATUS. Surfaced rather than
    // dropped — see LOCK L2.5 below.
    unaccountedPosts: 0,
  });
  const [trends, setTrends] = useState({
    publishedPosts: { pct: 0, direction: "neutral" },
    scheduledPosts: { pct: 0, direction: "neutral" },
    drafts: { pct: 0, direction: "neutral" },
    clipsReady: { pct: 0, direction: "neutral" },
  });
  const [recentGenerations, setRecentGenerations] = useState([]);
  const [upcomingPosts, setUpcomingPosts] = useState([]);
  const [connectedAccounts, setConnectedAccounts] = useState([]);
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [hasBrandKit, setHasBrandKit] = useState(false);

  const credits = useCreditBalance(userId);
  const creditSpend = useCreditSpendByCategory(userId);

  const fetchDashboardData = useCallback(async () => {
    if (!userId) return;
    setError(false);
    try {
      const now = Date.now();
      const windowStart = new Date(now - TREND_WINDOW_DAYS * 86_400_000).toISOString();
      const prevWindowStart = new Date(now - TREND_WINDOW_DAYS * 2 * 86_400_000).toISOString();

      // Base count query: `posts` filtered by status, scoped to this user/personal scope.
      const postCount = (status) =>
        supabase.from("posts").select("*", { count: "exact", head: true }).eq("user_id", userId).is("organization_id", null).eq("status", status);
      // Every post, regardless of status. The buckets are checked against this
      // rather than trusted to be exhaustive — see LOCK L2.5.
      const allPostsCount = () =>
        supabase.from("posts").select("*", { count: "exact", head: true }).eq("user_id", userId).is("organization_id", null);
      // Windowed count against whichever timestamp really reflects the transition
      // (published_at/failed_at for those statuses, created_at otherwise).
      const postCountInWindow = (status, tsColumn, gte, lt) => {
        let q = supabase.from("posts").select("*", { count: "exact", head: true }).eq("user_id", userId).is("organization_id", null).eq("status", status).gte(tsColumn, gte);
        if (lt) q = q.lt(tsColumn, lt);
        return q;
      };
      const clipsCountInWindow = (gte, lt) => {
        let q = supabase.from("video_clips").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("render_status", "complete").gte("updated_at", gte);
        if (lt) q = q.lt("updated_at", lt);
        return q;
      };

      const [
        totalGenerationsResult,
        scheduledPostsResult,
        publishedPostsResult,
        draftsResult,
        failedPostsResult,
        publishingPostsResult,
        archivedPostsResult,
        totalPostsResult,
        recentGenerationsResult,
        generationIndexResult,
        upcomingPostsResult,
        clipsReadyResult,
        connectedAccountsResult,
        publishedThisResult,
        publishedPrevResult,
        scheduledThisResult,
        scheduledPrevResult,
        draftsThisResult,
        draftsPrevResult,
        clipsThisResult,
        clipsPrevResult,
        brandKitResult,
      ] = await Promise.all([
        supabase.from("generations").select("*", { count: "exact", head: true }).eq("user_id", userId).is("organization_id", null),
        postCount(POST_STATUS.SCHEDULED),
        postCount(POST_STATUS.PUBLISHED),
        postCount(POST_STATUS.DRAFT),
        postCount(POST_STATUS.FAILED),
        postCount(POST_STATUS.PUBLISHING),
        postCount(POST_STATUS.ARCHIVED),
        allPostsCount(),
        supabase.from("generations").select("id, session_id, prompt, storage_path, media_type, status, created_at, metadata, sessions(title)").eq("user_id", userId).is("organization_id", null).order("created_at", { ascending: false }).limit(RECENT_GENERATION_LIMIT),
        supabase.from("generations").select("id, session_id, prompt, status, created_at, metadata, sessions(title)").eq("user_id", userId).is("organization_id", null).order("created_at", { ascending: false }).limit(GENERATION_SEARCH_LIMIT),
        supabase.from("posts").select("id, platform, title, caption, scheduled_at, status, generation_id, account_id, generations(storage_path, media_type)").eq("user_id", userId).is("organization_id", null).eq("status", POST_STATUS.SCHEDULED).order("scheduled_at", { ascending: true }).limit(UPCOMING_POST_LIMIT),
        supabase.from("video_clips").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("render_status", "complete"),
        supabase.from("connected_accounts_health_summary").select(`
            id, platform, platform_display_name, display_name, account_name, username,
            connection_status, health_score, consecutive_failure_count, last_failure_reason,
            last_successful_publish_at, scope, user_id,
            is_mock, provider, can_publish, publish_block_reason
          `).eq("scope", "personal").eq("user_id", userId).order("display_name", { ascending: true }),
        postCountInWindow(POST_STATUS.PUBLISHED, "published_at", windowStart),
        postCountInWindow(POST_STATUS.PUBLISHED, "published_at", prevWindowStart, windowStart),
        postCountInWindow(POST_STATUS.SCHEDULED, "created_at", windowStart),
        postCountInWindow(POST_STATUS.SCHEDULED, "created_at", prevWindowStart, windowStart),
        postCountInWindow(POST_STATUS.DRAFT, "created_at", windowStart),
        postCountInWindow(POST_STATUS.DRAFT, "created_at", prevWindowStart, windowStart),
        clipsCountInWindow(windowStart),
        clipsCountInWindow(prevWindowStart, windowStart),
        supabase.from("brand_kit").select("setup_completed").eq("user_id", userId).eq("is_active", true).maybeSingle(),
      ]);

      const withSessionTitle = (rows) =>
        (rows ?? []).map((row) => ({ ...row, session_title: row?.sessions?.title ?? "" }));

      const totalGenerations = totalGenerationsResult.count ?? 0;
      const connected = connectedAccountsResult.data ?? [];
      const clipsReady = clipsReadyResult.error ? 0 : clipsReadyResult.count ?? 0;
      const countOf = (r) => (r?.error ? 0 : r?.count ?? 0);

      /**
       * LOCK L2.5 — the status summary accounts for every post.
       *
       * This used to count exactly four statuses: draft, scheduled, published,
       * failed. `publishing` is a first-class value in the app's own enum
       * (constants/statuses.js) and publish-post writes it on every attempt,
       * but nothing counted it — so the Content Flow panel reported 107 posts
       * for a user who had 110, with three sitting mid-publish. The audit
       * found them stranded for up to four months (L2.3 now reaps them at 15
       * minutes, but in-flight posts are still real posts).
       *
       * Rather than adding the one missing bucket and hoping the enum never
       * grows again, the buckets are now reconciled against a total count.
       * Anything unaccounted for is reported as its own bucket instead of
       * quietly vanishing — the panel may say "we do not recognise these",
       * but it will not lie about the total.
       */
      const byStatus = {
        drafts: countOf(draftsResult),
        scheduledPosts: countOf(scheduledPostsResult),
        publishingPosts: countOf(publishingPostsResult),
        publishedPosts: countOf(publishedPostsResult),
        failedPosts: countOf(failedPostsResult),
        archivedPosts: countOf(archivedPostsResult),
      };
      const totalPosts = countOf(totalPostsResult);
      const bucketed = Object.values(byStatus).reduce((a, b) => a + b, 0);

      setStats({
        totalGenerated: totalGenerations,
        clipsReady,
        ...byStatus,
        totalPosts,
        unaccountedPosts: Math.max(0, totalPosts - bucketed),
      });
      setTrends({
        publishedPosts: computeTrend(countOf(publishedThisResult), countOf(publishedPrevResult)),
        scheduledPosts: computeTrend(countOf(scheduledThisResult), countOf(scheduledPrevResult)),
        drafts: computeTrend(countOf(draftsThisResult), countOf(draftsPrevResult)),
        clipsReady: computeTrend(countOf(clipsThisResult), countOf(clipsPrevResult)),
      });
      setRecentGenerations(withSessionTitle(recentGenerationsResult.data));
      setGenerationIndex(withSessionTitle(generationIndexResult.data));
      setUpcomingPosts(upcomingPostsResult.data ?? []);
      setConnectedAccounts(connected);
      setIsFirstTime(totalGenerations === 0 && connected.length === 0);
      setHasBrandKit(brandKitResult?.data?.setup_completed === true);
    } catch (err) {
      console.error("Dashboard fetch error:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const handleRetry = useCallback(() => {
    setLoading(true);
    fetchDashboardData();
  }, [fetchDashboardData]);

  const refreshTimerRef = useRef(null);
  useEffect(() => {
    if (!userId) return undefined;
    fetchDashboardData();

    const scheduleRefresh = () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(fetchDashboardData, REALTIME_REFRESH_DEBOUNCE_MS);
    };
    const channel = supabase
      .channel("dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "generations" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "connected_accounts" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "video_clips" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "brand_kit" }, scheduleRefresh)
      .subscribe();

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [fetchDashboardData, userId]);

  const userName = useMemo(() => {
    const full = profile?.full_name;
    if (!full) return "Creator";
    return full.trim().split(" ")[0] || "Creator";
  }, [profile?.full_name]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const todayLabel = useMemo(
    () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    []
  );

  const hasConnectedAccount = connectedAccounts.length > 0;
  const hasGeneration = stats.totalGenerated > 0;
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  const nextPost = upcomingPosts[0] ?? null;
  const nextCountdown = nextPost ? formatCountdown(nextPost.scheduled_at) : null;

  const filteredRecentGenerations = useMemo(() => {
    if (!normalizedSearchQuery) return recentGenerations;
    return recentGenerations.filter((g) => getGenerationSearchText(g).includes(normalizedSearchQuery));
  }, [recentGenerations, normalizedSearchQuery]);

  const accountCards = useMemo(() => connectedAccounts.map(toAccountCard), [connectedAccounts]);
  // Whether publishing is actually simulated, derived from real account data
  // rather than a hardcoded label — a real (Zernio) connected account should
  // never be blanket-labeled "Simulated".
  const allAccountsMock = accountCards.length > 0 && accountCards.every((a) => a.isMock);
  const nextPostAccount = nextPost ? accountCards.find((a) => a.id === nextPost.account_id) ?? null : null;
  // Unknown (no matching account row) reads as mock — never claim "Live"
  // without a confirmed real account behind it.
  const nextPostIsMock = nextPostAccount ? nextPostAccount.isMock : true;

  return {
    loading,
    error,
    handleRetry,
    userName,
    greeting,
    todayLabel,
    isFirstTime,
    hasConnectedAccount,
    hasGeneration,
    hasBrandKit,
    searchQuery,
    setSearchQuery,
    stats,
    trends,
    recentGenerations: filteredRecentGenerations,
    hasSearch: !!normalizedSearchQuery,
    upcomingPosts,
    nextPost,
    nextCountdown,
    nextPostIsMock,
    connectedAccounts: accountCards,
    allAccountsMock,
    credits,
    creditSegments: creditSpend.segments,
    generationIndex,
  };
}

export { GENERATION_STATUS };
