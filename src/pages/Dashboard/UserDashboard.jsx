"use client";

// src/pages/Dashboard/UserDashboard.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileImage,
  FileText,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { supabase } from "../../services/supabaseClient";
import { useAuth } from "../../Context/AuthContext";
import UserNavbar from "../../components/User/UserNavbar";
import UserSidebar from "../../components/User/UserSidebar";
import AccountHealthCard from "../../components/Dashboard/AccountHealthCard";
import { UiButton, UiEmptyState } from "../../components/Shared/ui";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { GENERATION_STATUS, POST_STATUS } from "../../constants/statuses";

const RECENT_GENERATION_LIMIT = 5;
const GENERATION_SEARCH_LIMIT = 120;
const UPCOMING_POST_LIMIT = 5;
const REALTIME_REFRESH_DEBOUNCE_MS = 800;

/* ───────────────────────────── helpers ───────────────────────────── */

function getTitleFromPrompt(prompt) {
  if (!prompt || typeof prompt !== "string") return "Untitled Generation";
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "Untitled Generation";
  const base = words.slice(0, 7).join(" ");
  return words.length > 7 ? `${base}...` : base;
}

function getGenerationTitle(generation) {
  const metadataTitle = generation?.metadata?.title;
  const sessionTitle = generation?.session_title;

  if (typeof metadataTitle === "string" && metadataTitle.trim()) {
    return metadataTitle.trim();
  }
  if (typeof sessionTitle === "string" && sessionTitle.trim()) {
    return sessionTitle.trim();
  }
  return getTitleFromPrompt(generation?.prompt);
}

function getGenerationSearchText(generation) {
  const title = getGenerationTitle(generation);
  const prompt = generation?.prompt ?? "";
  return `${title} ${prompt}`.toLowerCase();
}

function buildGenerationRoute(generation) {
  const sessionPath = generation?.session_id
    ? `/app/generate/${generation.session_id}`
    : "/app/generate";
  return generation?.id ? `${sessionPath}#${generation.id}` : sessionPath;
}

function formatPlatformName(platform) {
  if (!platform || typeof platform !== "string") return "Platform";
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

function formatCount(value) {
  return Number(value ?? 0).toLocaleString();
}

function getPostTitle(post) {
  if (typeof post?.title === "string" && post.title.trim()) return post.title.trim();
  if (typeof post?.caption === "string" && post.caption.trim()) {
    return post.caption.trim().slice(0, 60);
  }
  return "Untitled post";
}

// Format an upcoming scheduled time as "Today · 4:30 PM" / "Tomorrow · …" / "Jun 21 · …".
function formatScheduleTime(value) {
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

// Compact "in 3h 20m" countdown for the greeting quick-stat pill.
function formatCountdown(value) {
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

function normalizePlatformKey(platform) {
  const key = String(platform ?? "other").toLowerCase();
  return key === "twitter" ? "x" : key;
}

/* ───────────────────────────── small components ───────────────────────────── */

// Thumbnail of what the scheduled post is built from: the linked generation's
// image/video preview, or a text glyph for text-only posts. A small platform
// dot keeps the channel readable.
function PostThumb({ post }) {
  const gen = Array.isArray(post?.generations) ? post.generations[0] : post?.generations;
  const src = gen?.storage_path ?? null;
  const isVideo = gen?.media_type === "video";
  const platformKey = normalizePlatformKey(post?.platform);
  return (
    <span className="bd-post-thumb" aria-hidden="true">
      {src ? (
        isVideo ? (
          <video src={src} muted aria-hidden="true" />
        ) : (
          <img src={src} alt="" aria-hidden="true" />
        )
      ) : (
        <FileText size={16} aria-hidden="true" />
      )}
      <span className="bd-post-thumb-platform" data-platform={platformKey} aria-hidden="true" />
    </span>
  );
}

function OnboardingChecklist({ hasConnectedAccount, hasGeneration, onNavigate }) {
  const steps = [
    { id: "profile", label: "Create your account", done: true, path: "/app/settings" },
    { id: "connect", label: "Connect a social account", done: hasConnectedAccount, path: "/app/settings" },
    { id: "generate", label: "Generate your first post", done: hasGeneration, path: "/app/generate" },
  ];
  const completed = steps.filter((step) => step.done).length;
  const setupPercentage = Math.round((completed / steps.length) * 100);

  return (
    <section className="bd-onboarding" aria-labelledby="onboarding-title">
      <div className="bd-onboarding-icon" aria-hidden="true">
        <Sparkles size={22} />
      </div>
      <div className="bd-onboarding-copy">
        <span className="bd-kicker">Setup flow</span>
        <h2 id="onboarding-title">Build your first publishing loop</h2>
        <p>
          Your workspace is {setupPercentage}% ready. Finish the essentials and start moving
          ideas into scheduled content.
        </p>
      </div>
      <div className="bd-onboarding-steps">
        {steps.map((step) => (
          <button
            key={step.id}
            className={`bd-onboarding-step ${step.done ? "done" : ""}`}
            onClick={() => !step.done && onNavigate(step.path)}
            disabled={step.done}
            type="button"
          >
            <span className="bd-step-check">{step.done && <CheckCircle2 size={13} />}</span>
            <span className="bd-step-text">{step.label}</span>
            {!step.done && <ArrowUpRight size={15} className="bd-step-arrow" aria-hidden="true" />}
          </button>
        ))}
      </div>
      <UiButton variant="accent" onClick={() => onNavigate("/app/generate")}>
        <Sparkles size={16} aria-hidden="true" />
        Generate content
      </UiButton>
    </section>
  );
}

// Lightweight, static, token-driven sparkline (decorative — no fabricated metrics).
const SPARK_PATHS = {
  up: "M2 22 L10 18 L18 20 L26 14 L34 16 L42 10 L50 8 L58 4",
  accent: "M2 20 L10 20 L18 16 L26 18 L34 14 L42 14 L50 12 L58 10",
  neutral: "M2 18 L10 16 L18 18 L26 14 L34 16 L42 12 L50 14 L58 12",
};

function KpiSparkline({ tone }) {
  const path = SPARK_PATHS[tone] ?? SPARK_PATHS.neutral;
  const gradientId = `bd-spark-${tone}`;
  return (
    <svg className="bd-kpi-spark" viewBox="0 0 60 28" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={path} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d={`${path} L58 28 L2 28 Z`} fill={`url(#${gradientId})`} />
    </svg>
  );
}

// Direction glyph for the KPI footer: ▲ for up, ▼ for down, • for neutral.
function trendGlyph(direction) {
  if (direction === "up") return "▲";
  if (direction === "down") return "▼";
  return "•";
}

function KpiCard({ label, value, trend, trendTone = "neutral", trendDir = "neutral", index }) {
  return (
    <article className="bd-kpi-card" style={{ "--bd-kpi-index": index }}>
      <span className="bd-kpi-label">{label}</span>
      <span className="bd-kpi-number">{value}</span>
      <span className="bd-kpi-footer">
        <span className={`bd-kpi-trend tone-${trendTone}`}>
          <span className="bd-kpi-trend-glyph" aria-hidden="true">{trendGlyph(trendDir)}</span>
          {trend}
        </span>
        <span className={`bd-kpi-spark-wrap tone-${trendTone}`}>
          <KpiSparkline tone={trendTone} />
        </span>
      </span>
    </article>
  );
}

function KpiSkeleton() {
  return (
    <article className="bd-kpi-card bd-kpi-card--skeleton" aria-hidden="true">
      <span className="bd-skel bd-skel-line bd-skel-label" />
      <span className="bd-skel bd-skel-number" />
      <span className="bd-skel bd-skel-line bd-skel-trend" />
    </article>
  );
}

// Row-shaped skeleton matching list items (thumb + two lines).
function RowSkeleton() {
  return (
    <div className="bd-row-skeleton" aria-hidden="true">
      <span className="bd-skel bd-skel-thumb" />
      <span className="bd-row-skeleton-lines">
        <span className="bd-skel bd-skel-line bd-skel-line-1" />
        <span className="bd-skel bd-skel-line bd-skel-line-2" />
      </span>
    </div>
  );
}

// Inline error affordance for a data module that failed to load.
function ModuleError({ onRetry }) {
  return (
    <div className="bd-module-error" role="alert">
      <p className="bd-module-error-text">Couldn't load this. Check your connection and try again.</p>
      <button type="button" className="bd-module-retry" onClick={onRetry}>
        <RefreshCw size={13} aria-hidden="true" />
        Retry
      </button>
    </div>
  );
}

function UpcomingPanel({ loading, error, posts, onViewAll, onSchedule, onRetry }) {
  return (
    <section className="bd-panel bd-upcoming" aria-labelledby="upcoming-title">
      <header className="bd-panel-head">
        <h2 id="upcoming-title">Upcoming</h2>
        <button className="bd-panel-link" onClick={onViewAll} type="button">
          View all <ArrowUpRight size={13} aria-hidden="true" />
        </button>
      </header>

      <div className="bd-post-list">
        {loading ? (
          [1, 2, 3].map((item) => <RowSkeleton key={item} />)
        ) : error ? (
          <ModuleError onRetry={onRetry} />
        ) : posts.length === 0 ? (
          <UiEmptyState
            className="bd-inline-empty"
            icon={<CalendarDays size={26} />}
            title="Nothing scheduled"
            description="Schedule a post to see your upcoming queue here."
            actions={
              <UiButton variant="primary" size="sm" onClick={onSchedule}>
                <Send size={14} aria-hidden="true" />
                Schedule a post
              </UiButton>
            }
          />
        ) : (
          posts.map((post) => {
            const time = formatScheduleTime(post.scheduled_at);
            return (
              <button
                key={post.id}
                type="button"
                className="bd-post-item"
                onClick={onViewAll}
              >
                <PostThumb post={post} />
                <span className="bd-post-info">
                  <span className="bd-post-title">{getPostTitle(post)}</span>
                  <span className={`bd-post-time ${time.today ? "is-today" : ""}`}>
                    <Clock size={11} aria-hidden="true" />
                    {time.label}
                  </span>
                </span>
                <span className="bd-post-platform">{formatPlatformName(normalizePlatformKey(post.platform))}</span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

function CreateNextPanel({ onNavigate, suggestion }) {
  const [quickPrompt, setQuickPrompt] = useState("");

  const goGenerate = useCallback(
    (prompt) => {
      const trimmed = String(prompt ?? "").trim();
      onNavigate("/app/generate", trimmed ? { state: { quickPrompt: trimmed } } : undefined);
    },
    [onNavigate]
  );

  return (
    <section className="bd-panel bd-create" aria-labelledby="create-title">
      <header className="bd-panel-head">
        <h2 id="create-title">Create next</h2>
      </header>

      <div className="bd-create-body">
        <div className="bd-ai-card">
          <span className="bd-ai-badge">
            <Sparkles size={11} aria-hidden="true" />
            AI Insight
          </span>
          <p className="bd-ai-text">{suggestion}</p>
        </div>

        <UiButton variant="accent" className="bd-create-cta" onClick={() => goGenerate(quickPrompt)}>
          <Sparkles size={15} aria-hidden="true" />
          Generate
        </UiButton>

        <div className="bd-quick-gen">
          <label className="bd-quick-label" htmlFor="bd-quick-input">
            Or describe what you need
          </label>
          <textarea
            id="bd-quick-input"
            className="bd-quick-input"
            rows={2}
            placeholder="e.g. A LinkedIn post about launching my new service…"
            value={quickPrompt}
            onChange={(event) => setQuickPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                goGenerate(quickPrompt);
              }
            }}
          />
        </div>
      </div>
    </section>
  );
}

// Build a smooth (Catmull-Rom → cubic Bézier) SVG path from value points.
function buildSmoothPath(points) {
  if (points.length < 2) return "";
  const d = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`);
  }
  return d.join(" ");
}

// Honest, token-driven area chart built from real content-flow counts.
function EngagementChart({ loading, error, stats, onNavigate, onRetry }) {
  const series = [
    { label: "Generated", value: stats.totalGenerated },
    { label: "Scheduled", value: stats.scheduledPosts },
    { label: "Published", value: stats.publishedPosts },
    { label: "Drafts", value: stats.drafts },
  ];
  const totalFlow = series.reduce((sum, item) => sum + item.value, 0);
  const max = Math.max(...series.map((item) => item.value), 1);

  const W = 700;
  const H = 120;
  const padY = 12;
  const points = series.map((item, i) => ({
    x: (i / (series.length - 1)) * W,
    y: H - padY - (item.value / max) * (H - padY * 2),
    ...item,
  }));
  const linePath = buildSmoothPath(points);
  const areaPath = linePath ? `${linePath} L ${W} ${H} L 0 ${H} Z` : "";
  const hasData = totalFlow > 0;
  const gridLines = [0, H / 3, (H / 3) * 2, H];

  return (
    <section className="bd-panel bd-chart" aria-labelledby="chart-title">
      <header className="bd-panel-head">
        <h2 id="chart-title">Content flow this week</h2>
        <button className="bd-panel-link" onClick={() => onNavigate("/app/analytics")} type="button">
          Full report <ArrowUpRight size={13} aria-hidden="true" />
        </button>
      </header>

      <div className="bd-chart-body">
        {loading ? (
          <div className="bd-skel bd-chart-skeleton" aria-hidden="true" />
        ) : error ? (
          <ModuleError onRetry={onRetry} />
        ) : (
          <>
            <div className="bd-chart-meta">
              <span className="bd-chart-stat-num">{formatCount(totalFlow)}</span>
              <span className="bd-chart-stat-label">items in your pipeline</span>
            </div>

            {/* Mobile: SVG chart is demoted to a compact summary line.
                Always in DOM; shown ≤768px, hidden on desktop via CSS. */}
            <button
              type="button"
              className="bd-chart-mobile-summary"
              onClick={() => onNavigate("/app/analytics")}
            >
              <span className="bd-chart-mobile-summary-text">
                <strong>{formatCount(totalFlow)}</strong>{" "}
                {totalFlow === 1 ? "item" : "items"} in your pipeline
              </span>
              <span className="bd-chart-mobile-summary-link">
                View report <ArrowUpRight size={13} aria-hidden="true" />
              </span>
            </button>

            {hasData ? (
              <>
                <div className="bd-area-wrap">
                  <svg
                    className="bd-area-svg"
                    viewBox={`0 0 ${W} ${H}`}
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={`Content flow: ${series
                      .map((item) => `${item.label} ${item.value}`)
                      .join(", ")}`}
                  >
                    <defs>
                      <linearGradient id="bd-area-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="currentColor" stopOpacity="0.30" />
                        <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {gridLines.map((y) => (
                      <line
                        key={y}
                        x1="0"
                        y1={y}
                        x2={W}
                        y2={y}
                        className="bd-area-grid"
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    <path className="bd-area-fill" d={areaPath} fill="url(#bd-area-fill)" />
                    <path
                      className="bd-area-line"
                      d={linePath}
                      fill="none"
                      vectorEffect="non-scaling-stroke"
                    />
                    {points.map((p, i) => (
                      <circle
                        key={p.label}
                        className="bd-area-dot"
                        cx={p.x}
                        cy={p.y}
                        r={i === points.length - 1 ? 4 : 3}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                  </svg>
                </div>
                <div className="bd-area-labels">
                  {series.map((item, i) => (
                    <span
                      key={item.label}
                      className={`bd-area-label ${i === series.length - 1 ? "is-current" : ""}`}
                    >
                      {item.label}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <UiEmptyState
                className="bd-inline-empty"
                icon={<Sparkles size={26} />}
                title="No content flow yet"
                description="Generate and schedule content to see your weekly pipeline take shape."
                actions={
                  <UiButton variant="primary" size="sm" onClick={() => onNavigate("/app/generate")}>
                    <Sparkles size={14} aria-hidden="true" />
                    Generate now
                  </UiButton>
                }
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────────── page ───────────────────────────── */

export default function UserDashboard() {
  const { navigate } = useAppNavigation();
  const { user, profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [userName, setUserName] = useState("Creator");
  const [searchQuery, setSearchQuery] = useState("");
  const [generationIndex, setGenerationIndex] = useState([]);

  const [stats, setStats] = useState({
    totalGenerated: 0,
    scheduledPosts: 0,
    publishedPosts: 0,
    drafts: 0,
    clipsReady: 0,
  });

  const [recentGenerations, setRecentGenerations] = useState([]);
  const [upcomingPosts, setUpcomingPosts] = useState([]);
  const [connectedAccounts, setConnectedAccounts] = useState([]);
  const [isFirstTime, setIsFirstTime] = useState(false);

  const userId = user?.id ?? null;

  // Fetch all dashboard data in a single coordinated pass.
  const fetchDashboardData = useCallback(async () => {
    if (!userId) return;

    setError(false);
    try {
      const [
        totalGenerationsResult,
        scheduledPostsResult,
        publishedPostsResult,
        draftsResult,
        recentGenerationsResult,
        generationIndexResult,
        upcomingPostsResult,
        clipsReadyResult,
        connectedAccountsResult,
      ] = await Promise.all([
        supabase
          .from("generations")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId)
          .is("organization_id", null),
        supabase
          .from("posts")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId)
          .is("organization_id", null)
          .eq("status", POST_STATUS.SCHEDULED),
        supabase
          .from("posts")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId)
          .is("organization_id", null)
          .eq("status", POST_STATUS.PUBLISHED),
        supabase
          .from("posts")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId)
          .is("organization_id", null)
          .eq("status", POST_STATUS.DRAFT),
        // Recent generations with session titles in ONE round-trip via nested select.
        supabase
          .from("generations")
          .select(
            "id, session_id, prompt, storage_path, media_type, status, created_at, metadata, sessions(title)"
          )
          .eq("user_id", userId)
          .is("organization_id", null)
          .order("created_at", { ascending: false })
          .limit(RECENT_GENERATION_LIMIT),
        supabase
          .from("generations")
          .select("id, session_id, prompt, status, created_at, metadata, sessions(title)")
          .eq("user_id", userId)
          .is("organization_id", null)
          .order("created_at", { ascending: false })
          .limit(GENERATION_SEARCH_LIMIT),
        // Upcoming scheduled posts.
        supabase
          .from("posts")
          .select(
            "id, platform, title, caption, scheduled_at, status, generation_id, generations(storage_path, media_type)"
          )
          .eq("user_id", userId)
          .is("organization_id", null)
          .eq("status", POST_STATUS.SCHEDULED)
          .order("scheduled_at", { ascending: true })
          .limit(UPCOMING_POST_LIMIT),
        // Clips ready (video_clips). Tolerate a missing table/columns gracefully.
        supabase
          .from("video_clips")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("render_status", "complete"),
        supabase
          .from("connected_accounts_health_summary")
          .select(
            `
            id,
            platform,
            platform_display_name,
            display_name,
            account_name,
            username,
            connection_status,
            health_score,
            consecutive_failure_count,
            last_failure_reason,
            last_successful_publish_at,
            scope,
            user_id
          `
          )
          .eq("scope", "personal")
          .eq("user_id", userId)
          .order("display_name", { ascending: true }),
      ]);

      // Nested sessions(title) arrives as `sessions: { title }`; flatten to session_title.
      const withSessionTitle = (rows) =>
        (rows ?? []).map((row) => ({
          ...row,
          session_title: row?.sessions?.title ?? "",
        }));

      const totalGenerations = totalGenerationsResult.count ?? 0;
      const connected = connectedAccountsResult.data ?? [];
      const clipsReady = clipsReadyResult.error ? 0 : clipsReadyResult.count ?? 0;

      setStats({
        totalGenerated: totalGenerations,
        scheduledPosts: scheduledPostsResult.count ?? 0,
        publishedPosts: publishedPostsResult.count ?? 0,
        drafts: draftsResult.count ?? 0,
        clipsReady,
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

  // Initial load + debounced realtime refresh.
  const refreshTimerRef = useRef(null);

  useEffect(() => {
    if (!userId) return undefined;

    fetchDashboardData();

    const scheduleRefresh = () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        fetchDashboardData();
      }, REALTIME_REFRESH_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel("dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "generations" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "connected_accounts" }, scheduleRefresh)
      .subscribe();

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [fetchDashboardData, userId]);

  useEffect(() => {
    if (!profile?.full_name) return;
    setUserName(profile.full_name.trim().split(" ")[0]);
  }, [profile?.full_name]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    []
  );

  const hasConnectedAccount = connectedAccounts.length > 0;
  const hasGeneration = stats.totalGenerated > 0;
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  // Soonest upcoming post drives the greeting quick-stat pill.
  const nextPost = upcomingPosts[0] ?? null;
  const nextCountdown = nextPost ? formatCountdown(nextPost.scheduled_at) : null;

  // Tasteful, real-data-aware AI suggestion copy (no fabricated metrics).
  const suggestion = useMemo(() => {
    if (stats.drafts > 0) {
      return `You have ${formatCount(stats.drafts)} draft${stats.drafts === 1 ? "" : "s"} ready to refine — want help turning one into a finished post?`;
    }
    if (stats.scheduledPosts === 0) {
      return "Your queue is empty. Generate a fresh idea and schedule it to keep momentum going.";
    }
    return "Keep your streak alive — spin up a new carousel or short to stay ahead of your calendar.";
  }, [stats.drafts, stats.scheduledPosts]);

  const searchResults = useMemo(() => {
    if (!normalizedSearchQuery) return [];
    return generationIndex
      .filter((generation) => getGenerationSearchText(generation).includes(normalizedSearchQuery))
      .slice(0, 8)
      .map((generation) => ({ ...generation, title: getGenerationTitle(generation) }));
  }, [generationIndex, normalizedSearchQuery]);

  const filteredRecentGenerations = useMemo(() => {
    if (!normalizedSearchQuery) return recentGenerations;
    return recentGenerations.filter((generation) =>
      getGenerationSearchText(generation).includes(normalizedSearchQuery)
    );
  }, [recentGenerations, normalizedSearchQuery]);

  const handleViewAllRecent = useCallback(() => {
    navigate("/app/generate");
  }, [navigate]);

  const handleSelectGeneration = useCallback(
    (generation) => {
      navigate(buildGenerationRoute(generation));
    },
    [navigate]
  );

  const kpiCards = [
    {
      label: "Posts Published",
      value: formatCount(stats.publishedPosts),
      trend: stats.totalGenerated > 0
        ? `${Math.round((stats.publishedPosts / Math.max(stats.totalGenerated, 1)) * 100)}% publish ratio`
        : "Publish your first post",
      trendTone: "up",
      trendDir: stats.publishedPosts > 0 ? "up" : "neutral",
    },
    {
      label: "Scheduled",
      value: formatCount(stats.scheduledPosts),
      trend: stats.scheduledPosts > 0 ? "In queue" : "Nothing queued",
      trendTone: "accent",
      trendDir: "neutral",
    },
    {
      label: "Clips Ready",
      value: formatCount(stats.clipsReady),
      trend: stats.clipsReady > 0 ? "To review" : "No clips yet",
      trendTone: "neutral",
      trendDir: "neutral",
    },
    {
      label: "Drafts",
      value: formatCount(stats.drafts),
      trend: stats.drafts > 0 ? "Ready to refine" : "All clear",
      trendTone: "neutral",
      trendDir: "neutral",
    },
  ];

  return (
    <div className="dashboard-shell">
      <UserNavbar
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchResults={searchResults}
        searchLoading={loading && normalizedSearchQuery.length > 0}
        onSearchSelect={handleSelectGeneration}
      />

      <UserSidebar />

      <main className="dashboard-content personal-dashboard bd-dashboard" id="main-content">
        <div className="bd-canvas">
          {/* Greeting row */}
          <section className="bd-greeting" aria-labelledby="dashboard-title">
            <div className="bd-greeting-copy">
              <h1 className="bd-greeting-title" id="dashboard-title">
                {greeting}, {userName}
              </h1>
              <p className="bd-greeting-sub">
                {todayLabel}
                <span className="bd-dot-sep" aria-hidden="true">·</span>
                {isFirstTime
                  ? "Let's set up your creative pipeline."
                  : "Your content pipeline is on track."}
              </p>
            </div>

            <span className="bd-stat-pill">
              <span className="bd-stat-pill-dot" aria-hidden="true" />
              {nextCountdown
                ? <>Next scheduled post in&nbsp;<strong>{nextCountdown}</strong></>
                : "No posts scheduled yet"}
            </span>
          </section>

          {isFirstTime && !loading && (
            <OnboardingChecklist
              hasConnectedAccount={hasConnectedAccount}
              hasGeneration={hasGeneration}
              onNavigate={navigate}
            />
          )}

          {/* KPI row */}
          <section className="bd-kpi-row" aria-label="Key metrics">
            {loading
              ? [0, 1, 2, 3].map((i) => <KpiSkeleton key={i} />)
              : kpiCards.map((card, index) => (
                  <KpiCard key={card.label} index={index} {...card} />
                ))}
          </section>

          {/* Dual column */}
          <section className="bd-dual" aria-label="Upcoming and create">
            <UpcomingPanel
              loading={loading}
              error={error}
              posts={upcomingPosts}
              onViewAll={() => navigate("/app/calendar")}
              onSchedule={() => navigate("/app/calendar")}
              onRetry={handleRetry}
            />
            <CreateNextPanel onNavigate={navigate} suggestion={suggestion} />
          </section>

          {/* Engagement / content-flow chart */}
          <EngagementChart
            loading={loading}
            error={error}
            stats={stats}
            onNavigate={navigate}
            onRetry={handleRetry}
          />

          {/* Secondary: recent work + account health */}
          <section className="bd-secondary" aria-label="Recent work and account health">
            <section className="bd-panel bd-recent" aria-labelledby="recent-title">
              <header className="bd-panel-head">
                <h2 id="recent-title">Latest generations</h2>
                <button className="bd-panel-link" onClick={handleViewAllRecent} type="button">
                  View all <ArrowUpRight size={13} aria-hidden="true" />
                </button>
              </header>

              <div className="bd-recent-list">
                {loading ? (
                  [1, 2, 3].map((item) => <RowSkeleton key={item} />)
                ) : error ? (
                  <ModuleError onRetry={handleRetry} />
                ) : filteredRecentGenerations.length === 0 ? (
                  <UiEmptyState
                    className="bd-inline-empty"
                    icon={<Sparkles size={26} />}
                    title={normalizedSearchQuery ? "No matching generations" : "No content yet"}
                    description={
                      normalizedSearchQuery
                        ? "No generations match your search."
                        : "Generate your first post to start building your library."
                    }
                    actions={
                      <UiButton variant="primary" size="sm" onClick={() => navigate("/app/generate")}>
                        <Sparkles size={14} aria-hidden="true" />
                        Generate now
                      </UiButton>
                    }
                  />
                ) : (
                  filteredRecentGenerations.map((generation) => (
                    <button
                      key={generation.id}
                      type="button"
                      className="bd-recent-item"
                      onClick={() => handleSelectGeneration(generation)}
                    >
                      <span className="bd-recent-thumb" aria-hidden="true">
                        {generation.storage_path ? (
                          generation.media_type === "video" ? (
                            <video src={generation.storage_path} muted aria-hidden="true" />
                          ) : (
                            <img src={generation.storage_path} alt="" aria-hidden="true" />
                          )
                        ) : (
                          <FileImage size={18} aria-hidden="true" />
                        )}
                      </span>
                      <span className="bd-recent-info">
                        <span className="bd-recent-title">{getGenerationTitle(generation)}</span>
                        <span className="bd-recent-meta">
                          <Clock size={11} aria-hidden="true" />
                          {new Date(generation.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </span>
                      <span className={`bd-status-chip ${generation.status ?? GENERATION_STATUS.PROCESSING}`}>
                        {generation.status ?? GENERATION_STATUS.PROCESSING}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </section>

            <AccountHealthCard
              accounts={connectedAccounts}
              loading={loading}
              onManage={() => navigate("/app/settings")}
            />
          </section>
        </div>
      </main>
    </div>
  );
}
