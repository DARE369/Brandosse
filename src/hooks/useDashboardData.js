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

function toAccountCard(row) {
  const normalized = normalizeConnectedAccountRow(row) ?? row;
  const semantic = getConnectedAccountSemanticStatus(normalized?.connection_status);
  const statusInfo = ACCOUNT_STATUS_MAP[semantic] ?? { label: "Healthy", tone: "success" };
  const platformKey = normalizePlatformKey(normalized?.platform);
  return {
    id: normalized?.id,
    mark: platformKey.slice(0, 2).toUpperCase(),
    name: getConnectedAccountDisplayName(normalized) ?? formatPlatformName(platformKey),
    handle: normalized?.username ? `@${normalized.username}` : normalized?.account_name ?? "",
    statusLabel: statusInfo.label,
    statusTone: statusInfo.tone,
    isMock: !!normalized?.is_mock,
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
      ] = await Promise.all([
        supabase.from("generations").select("*", { count: "exact", head: true }).eq("user_id", userId).is("organization_id", null),
        postCount(POST_STATUS.SCHEDULED),
        postCount(POST_STATUS.PUBLISHED),
        postCount(POST_STATUS.DRAFT),
        postCount(POST_STATUS.FAILED),
        supabase.from("generations").select("id, session_id, prompt, storage_path, media_type, status, created_at, metadata, sessions(title)").eq("user_id", userId).is("organization_id", null).order("created_at", { ascending: false }).limit(RECENT_GENERATION_LIMIT),
        supabase.from("generations").select("id, session_id, prompt, status, created_at, metadata, sessions(title)").eq("user_id", userId).is("organization_id", null).order("created_at", { ascending: false }).limit(GENERATION_SEARCH_LIMIT),
        supabase.from("posts").select("id, platform, title, caption, scheduled_at, status, generation_id, generations(storage_path, media_type)").eq("user_id", userId).is("organization_id", null).eq("status", POST_STATUS.SCHEDULED).order("scheduled_at", { ascending: true }).limit(UPCOMING_POST_LIMIT),
        supabase.from("video_clips").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("render_status", "complete"),
        supabase.from("connected_accounts_health_summary").select(`
            id, platform, platform_display_name, display_name, account_name, username,
            connection_status, health_score, consecutive_failure_count, last_failure_reason,
            last_successful_publish_at, scope, user_id
          `).eq("scope", "personal").eq("user_id", userId).order("display_name", { ascending: true }),
        postCountInWindow(POST_STATUS.PUBLISHED, "published_at", windowStart),
        postCountInWindow(POST_STATUS.PUBLISHED, "published_at", prevWindowStart, windowStart),
        postCountInWindow(POST_STATUS.SCHEDULED, "created_at", windowStart),
        postCountInWindow(POST_STATUS.SCHEDULED, "created_at", prevWindowStart, windowStart),
        postCountInWindow(POST_STATUS.DRAFT, "created_at", windowStart),
        postCountInWindow(POST_STATUS.DRAFT, "created_at", prevWindowStart, windowStart),
        clipsCountInWindow(windowStart),
        clipsCountInWindow(prevWindowStart, windowStart),
      ]);

      const withSessionTitle = (rows) =>
        (rows ?? []).map((row) => ({ ...row, session_title: row?.sessions?.title ?? "" }));

      const totalGenerations = totalGenerationsResult.count ?? 0;
      const connected = connectedAccountsResult.data ?? [];
      const clipsReady = clipsReadyResult.error ? 0 : clipsReadyResult.count ?? 0;
      const countOf = (r) => (r?.error ? 0 : r?.count ?? 0);

      setStats({
        totalGenerated: totalGenerations,
        scheduledPosts: scheduledPostsResult.count ?? 0,
        publishedPosts: publishedPostsResult.count ?? 0,
        drafts: draftsResult.count ?? 0,
        clipsReady,
        failedPosts: failedPostsResult.count ?? 0,
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
    searchQuery,
    setSearchQuery,
    stats,
    trends,
    recentGenerations: filteredRecentGenerations,
    hasSearch: !!normalizedSearchQuery,
    upcomingPosts,
    nextPost,
    nextCountdown,
    connectedAccounts: accountCards,
    credits,
    creditSegments: creditSpend.segments,
    generationIndex,
  };
}

export { GENERATION_STATUS };
