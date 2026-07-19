"use client";

// src/pages/AnalyticsPage/PersonalAnalyticsPage.jsx
// ui-v2 rebuild of Personal Analytics (see memory design-system-v2 / docs
// mockup "Analytics.dc.html"), following the same pattern as the Studio/
// Dashboard/Library/Calendar rebuilds: real AppHeader/MobileNavDrawer/
// UiV2ThemeProvider shell + ui-v2 primitives, CSS Modules for anything
// page-specific. The data layer (buildAnalyticsModel, fetchPersonalPosts/
// Accounts, platform-row aggregation) is carried over from the previous
// implementation — only now scoped by a real 30/90-day range instead of an
// unconditional 500-row fetch, plus two new sections the mockup has that
// this page didn't: a weekly posts-published trend chart and a real failed-
// posts table for the period.
//
// NOT built: the mockup's "discovery readiness by dimension" bars. No
// per-post readiness/SEO score is persisted anywhere in this schema (Studio's
// scoreSeo/optimizeSeo and Calendar's caption audit scores are both
// ephemeral, session-only) — rather than fabricate an aggregate, the 4th
// stat card uses real connected-account health instead, and the dimension
// bars are left out entirely until a real per-post score is stored.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles, RefreshCw, AlertCircle, ArrowUpRight,
} from "lucide-react";
import { supabase } from "../../services/supabaseClient";
import { useAuth } from "../../Context/AuthContext";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useCreditBalance } from "../../hooks/useCreditBalance";
import { POST_STATUS } from "../../constants/statuses";
import {
  UiV2ThemeProvider, useUiV2Theme, AppHeader, CreditPill, IconButton,
  Card, Badge, Skeleton, EmptyState, Button, MobileNavDrawer,
  NotificationBell, AvatarMenu,
} from "../../ui-v2";
import styles from "./PersonalAnalyticsPage.module.css";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", href: "/app/dashboard" },
  { key: "studio", label: "Studio", href: "/app/generate" },
  { key: "library", label: "Library", href: "/app/library" },
  { key: "calendar", label: "Calendar", href: "/app/calendar" },
  { key: "analytics", label: "Analytics", href: "/app/analytics" },
  { key: "brand-kit", label: "Brand Kit", href: "/app/settings/brand-kit" },
];

const KNOWN_OPTIONAL_ERROR_CODES = new Set(["42P01", "42703", "PGRST200"]);

const PLATFORM_LABELS = {
  facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn",
  tiktok: "TikTok", twitter: "X", x: "X", youtube: "YouTube", unknown: "Unassigned",
};

function isOptionalDataError(error) {
  if (!error) return false;
  const message = `${error.message || ""} ${error.details || ""}`.toLowerCase();
  return KNOWN_OPTIONAL_ERROR_CODES.has(error.code) || /does not exist|relationship|permission denied/.test(message);
}

function normalizePlatform(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized === "twitter") return "x";
  return normalized;
}
function formatPlatformName(platform) {
  const normalized = normalizePlatform(platform);
  return PLATFORM_LABELS[normalized] || normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
function getPostPlatform(post) {
  const connectedAccount = Array.isArray(post?.connected_accounts) ? post.connected_accounts[0] : post?.connected_accounts;
  return normalizePlatform(connectedAccount?.platform || post?.platform || post?.metadata?.platform);
}
function getAccountPlatform(account) {
  return normalizePlatform(account?.platform || account?.platform_display_name);
}
function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
function formatNumber(value) {
  return toNumber(value).toLocaleString();
}
function formatDate(value) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function getPostTitle(post) {
  const caption = String(post?.caption || "").trim();
  if (caption) {
    const words = caption.split(/\s+/).filter(Boolean);
    const title = words.slice(0, 8).join(" ");
    return words.length > 8 ? `${title}...` : title;
  }
  const generation = Array.isArray(post?.generations) ? post.generations[0] : post?.generations;
  const prompt = String(generation?.prompt || "").trim();
  if (prompt) {
    const words = prompt.split(/\s+/).filter(Boolean);
    const title = words.slice(0, 8).join(" ");
    return words.length > 8 ? `${title}...` : title;
  }
  return "Untitled post";
}
function isAccountHealthy(account) {
  const status = String(account?.connection_status || account?.status || "").toLowerCase();
  if (["healthy", "active", "connected"].includes(status)) return true;
  return toNumber(account?.health_score) >= 70;
}

function buildPlatformRows(posts, accounts) {
  const rows = new Map();
  const ensureRow = (platform) => {
    const key = normalizePlatform(platform);
    if (!rows.has(key)) {
      rows.set(key, {
        platform: key, label: formatPlatformName(key), accounts: 0, healthyAccounts: 0,
        totalPosts: 0, drafts: 0, scheduled: 0, published: 0, failed: 0, healthScores: [],
      });
    }
    return rows.get(key);
  };
  accounts.forEach((account) => {
    const row = ensureRow(getAccountPlatform(account));
    row.accounts += 1;
    if (isAccountHealthy(account)) row.healthyAccounts += 1;
    if (account?.health_score !== null && account?.health_score !== undefined) row.healthScores.push(toNumber(account.health_score));
  });
  posts.forEach((post) => {
    const row = ensureRow(getPostPlatform(post));
    const status = String(post?.status || POST_STATUS.DRAFT).toLowerCase();
    row.totalPosts += 1;
    if (status === POST_STATUS.DRAFT) row.drafts += 1;
    if (status === POST_STATUS.SCHEDULED) row.scheduled += 1;
    if (status === POST_STATUS.PUBLISHED) row.published += 1;
    if (status === POST_STATUS.FAILED) row.failed += 1;
  });
  const totalActivity = Array.from(rows.values()).reduce((sum, row) => sum + row.totalPosts, 0);
  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      averageHealth: row.healthScores.length ? Math.round(row.healthScores.reduce((s, v) => s + v, 0) / row.healthScores.length) : null,
      activityShare: totalActivity > 0 ? (row.totalPosts / totalActivity) * 100 : 0,
    }))
    .sort((a, b) => (b.totalPosts + b.accounts) - (a.totalPosts + a.accounts));
}

// Weekly buckets of PUBLISHED posts within the selected range, most-recent
// week last (chart reads left-to-right, oldest to newest).
function buildWeeklySeries(posts, rangeDays) {
  const weekCount = rangeDays === 90 ? 12 : 4;
  const now = Date.now();
  const buckets = Array.from({ length: weekCount }, (_, i) => {
    const end = now - i * 7 * 86_400_000;
    const start = end - 7 * 86_400_000;
    return { start, end, count: 0 };
  }).reverse();
  posts.forEach((post) => {
    if (String(post?.status).toLowerCase() !== POST_STATUS.PUBLISHED) return;
    const t = new Date(post.published_at || post.updated_at || post.created_at).getTime();
    if (Number.isNaN(t)) return;
    const bucket = buckets.find((b) => t >= b.start && t < b.end);
    if (bucket) bucket.count += 1;
  });
  return buckets.map((b, i) => ({
    label: rangeDays === 90 ? `W${i + 1}` : new Date(b.end).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    count: b.count,
  }));
}

async function fetchPersonalPosts(userId, sinceISO) {
  const base = () => supabase
    .from("posts")
    .select(`
      *,
      connected_accounts ( id, platform, account_name, avatar_url ),
      generations ( id, prompt, storage_path, media_type )
    `)
    .eq("user_id", userId)
    .is("organization_id", null)
    .gte("created_at", sinceISO)
    .order("created_at", { ascending: false })
    .limit(500);

  const result = await base();
  if (result.error) throw result.error;
  return result.data || [];
}

async function fetchPersonalAccounts(userId) {
  const healthSummary = await supabase
    .from("connected_accounts_health_summary")
    .select("id, platform, platform_display_name, display_name, account_name, username, connection_status, health_score, scope, user_id")
    .eq("scope", "personal")
    .eq("user_id", userId)
    .order("display_name", { ascending: true });
  if (!healthSummary.error) return healthSummary.data || [];
  if (!isOptionalDataError(healthSummary.error)) throw healthSummary.error;

  const fallback = await supabase
    .from("connected_accounts")
    .select("id, platform, account_name, username, status, user_id")
    .eq("user_id", userId)
    .order("platform", { ascending: true });
  if (fallback.error) throw fallback.error;
  return fallback.data || [];
}

function ThemeToggleButton() {
  const { isDark, toggleTheme } = useUiV2Theme();
  return (
    <IconButton title={isDark ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleTheme}>
      {isDark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" strokeLinecap="round" />
          <circle cx="12" cy="12" r="4.5" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 14.5A8.5 8.5 0 119.5 4a7 7 0 0010.5 10.5z" />
        </svg>
      )}
    </IconButton>
  );
}

// Single-series line+area trend (dataviz skill: magnitude-over-time, one
// series needs no legend — the panel title already names it). Thin 2px
// line, rounded data-end, low-opacity area fill, both drawn from the same
// accent token already validated across this app's light/dark themes.
function WeeklyChart({ series }) {
  const max = Math.max(...series.map((s) => s.count), 1);
  const w = 560;
  const h = 130;
  const stepX = series.length > 1 ? w / (series.length - 1) : w / 2;
  const points = series.map((s, i) => {
    const x = series.length > 1 ? i * stepX : w / 2;
    const y = Math.round(h - 8 - (s.count / max) * (h - 20));
    return { x, y };
  });
  const linePts = points.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPts = `0,${h - 1} ${linePts} ${w},${h - 1}`;

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={styles.chartSvg}>
        <line x1="0" y1={h - 1} x2={w} y2={h - 1} stroke="var(--uiv2-border)" strokeWidth="1" />
        <polygon points={areaPts} fill="var(--uiv2-accent-wash)" />
        <polyline points={linePts} fill="none" stroke="var(--uiv2-accent-solid)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className={styles.chartLabels}>
        {series.map((s, i) => (
          <span key={i} className={styles.chartLabel}>
            <span className={styles.chartLabelCount}>{s.count}</span>
            <span>{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function PlatformRow({ row }) {
  const healthLabel = row.averageHealth === null ? "Not scored" : `${row.averageHealth}%`;
  return (
    <div className={styles.platformRow}>
      <div className={styles.platformName}>{row.label}</div>
      <div className={styles.platformStat}>{formatNumber(row.published)}</div>
      <div className={styles.platformStat}>{formatNumber(row.scheduled)}</div>
      <div className={[styles.platformStat, row.failed > 0 ? styles.platformStatDanger : ""].join(" ")}>{formatNumber(row.failed)}</div>
      <div className={styles.platformStat}>
        <Badge tone={row.averageHealth === null ? "neutral" : row.averageHealth >= 80 ? "success" : row.averageHealth >= 60 ? "warning" : "danger"}>
          {healthLabel}
        </Badge>
      </div>
    </div>
  );
}

function AnalyticsBody() {
  const { navigate } = useAppNavigation();
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;
  const credits = useCreditBalance(userId);

  const [range, setRange] = useState(30);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [data, setData] = useState({ posts: [], accounts: [] });

  const fetchAnalytics = useCallback(async ({ silent = false } = {}) => {
    if (!userId) { setLoading(false); return; }
    if (silent) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const sinceISO = new Date(Date.now() - range * 86_400_000).toISOString();
      const [posts, accounts] = await Promise.all([
        fetchPersonalPosts(userId, sinceISO),
        fetchPersonalAccounts(userId),
      ]);
      setData({ posts, accounts });
    } catch (err) {
      console.error("[PersonalAnalyticsPage] fetch failed:", err);
      setError(err?.message || "Analytics could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, range]);

  useEffect(() => {
    fetchAnalytics();
    if (!userId) return undefined;
    const channel = supabase
      .channel(`personal-analytics-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "posts", filter: `user_id=eq.${userId}` }, () => fetchAnalytics({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "connected_accounts", filter: `user_id=eq.${userId}` }, () => fetchAnalytics({ silent: true }))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchAnalytics, userId]);

  const model = useMemo(() => {
    const { posts, accounts } = data;
    const statusCounts = posts.reduce((counts, post) => {
      const status = String(post?.status || POST_STATUS.DRAFT).toLowerCase();
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {});
    const healthScores = accounts.map((a) => a?.health_score).filter((v) => v !== null && v !== undefined).map(toNumber);
    const averageHealth = healthScores.length ? Math.round(healthScores.reduce((s, v) => s + v, 0) / healthScores.length) : null;
    const failedPosts = posts
      .filter((p) => String(p?.status).toLowerCase() === POST_STATUS.FAILED)
      .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

    return {
      published: statusCounts[POST_STATUS.PUBLISHED] || 0,
      scheduled: statusCounts[POST_STATUS.SCHEDULED] || 0,
      failed: statusCounts[POST_STATUS.FAILED] || 0,
      averageHealth,
      connectedAccounts: accounts.length,
      platformRows: buildPlatformRows(posts, accounts),
      weeklySeries: buildWeeklySeries(posts, range),
      failedPosts,
      recentPosts: posts.slice(0, 8),
    };
  }, [data, range]);

  const creditPct = credits.lifetimePurchased > 0
    ? Math.max(0, Math.min(100, Math.round((credits.balance / credits.lifetimePurchased) * 100)))
    : 100;
  const userInitials = ((profile?.full_name ? profile.full_name[0] : "U") + (profile?.full_name?.split(" ")[1]?.[0] ?? "")).toUpperCase();

  return (
    <>
      <AppHeader
        navItems={NAV_ITEMS}
        activeKey="analytics"
        onNavClick={(item) => navigate(item.href)}
        onBurgerClick={() => setMobileNavOpen(true)}
        right={(
          <>
            {credits.ready ? (
              <CreditPill pct={`${creditPct}%`} label={`${credits.balance.toLocaleString()} cr`} />
            ) : (
              <Skeleton width="76px" height="26px" radius="999px" />
            )}
            <ThemeToggleButton />
            <NotificationBell userId={userId} onNavigate={navigate} />
            <AvatarMenu initials={userInitials || "U"} name={profile?.full_name} email={user?.email} onNavigate={navigate} />
          </>
        )}
      />

      <MobileNavDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} navItems={NAV_ITEMS} activeKey="analytics" onNavClick={(item) => navigate(item.href)} />

      <main className={styles.main}>
        <div className={styles.canvas}>
          <div className={styles.headRow}>
            <div>
              <div className={styles.title}>Analytics</div>
              <div className={styles.sub}>Publishing here is simulated, so engagement figures are illustrative — counts and statuses are real.</div>
            </div>
            <div className={styles.rangeToggle}>
              <button type="button" className={[styles.rangeBtn, range === 30 ? styles.rangeBtnActive : ""].join(" ")} onClick={() => setRange(30)}>Last 30 days</button>
              <button type="button" className={[styles.rangeBtn, range === 90 ? styles.rangeBtnActive : ""].join(" ")} onClick={() => setRange(90)}>Last 90 days</button>
            </div>
          </div>

          {error && (
            <div className={styles.errorBox} role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <div style={{ flex: 1 }}>
                <div className={styles.errorTitle}>Analytics could not be loaded</div>
                <div className={styles.errorText}>{error}</div>
              </div>
              <Button variant="dangerSolid" size="sm" onClick={() => fetchAnalytics()}>Retry</Button>
            </div>
          )}

          {loading ? (
            <div className={styles.statGrid}>
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} height="86px" radius="var(--uiv2-radius-lg)" />)}
            </div>
          ) : (
            <>
              <div className={styles.statGrid}>
                <div className={styles.statCard}>
                  <div className={styles.statLabel}>Published</div>
                  <div className={styles.statValue}>{formatNumber(model.published)}</div>
                  <div className={styles.statSub}>in the last {range} days</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statLabel}>Scheduled</div>
                  <div className={styles.statValue}>{formatNumber(model.scheduled)}</div>
                  <div className={styles.statSub}>waiting on the calendar</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statLabel}>Failed</div>
                  <div className={styles.statValue} style={{ color: model.failed > 0 ? "var(--uiv2-danger)" : undefined }}>{formatNumber(model.failed)}</div>
                  <div className={styles.statSub}>{model.failed > 0 ? "review below" : "none this period"}</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statLabel}>Avg account health</div>
                  <div className={styles.statValue}>{model.averageHealth === null ? "—" : `${model.averageHealth}%`}</div>
                  <div className={styles.statSub}>{model.connectedAccounts} connected account{model.connectedAccounts === 1 ? "" : "s"}</div>
                </div>
              </div>

              <Card>
                <div className={styles.panelHead}>
                  <span className={styles.sectionLabel}>Posts published per week</span>
                  <span className={styles.rangeLabel}>{range === 90 ? "Last 12 weeks" : "Last 4 weeks"}</span>
                </div>
                {model.weeklySeries.every((s) => s.count === 0) ? (
                  <EmptyState dashed title="Nothing published yet" description="Publish a post to start filling this chart." />
                ) : (
                  <WeeklyChart series={model.weeklySeries} />
                )}
              </Card>

              <div className={styles.twoCol}>
                <Card>
                  <div className={styles.panelHead}>
                    <span className={styles.sectionLabel}>By platform</span>
                  </div>
                  {model.platformRows.length === 0 ? (
                    <EmptyState dashed title="No platform activity yet" description="Create or schedule content for a platform to start filling this in." />
                  ) : (
                    <div className={styles.platformTable}>
                      <div className={[styles.platformRow, styles.platformHeadRow].join(" ")}>
                        <div className={styles.platformName}>Platform</div>
                        <div className={styles.platformStat}>Published</div>
                        <div className={styles.platformStat}>Scheduled</div>
                        <div className={styles.platformStat}>Failed</div>
                        <div className={styles.platformStat}>Health</div>
                      </div>
                      {model.platformRows.map((row) => <PlatformRow key={row.platform} row={row} />)}
                    </div>
                  )}
                </Card>

                <Card>
                  <div className={styles.panelHead}>
                    <span className={styles.sectionLabel}>Failed posts in this period</span>
                  </div>
                  {model.failedPosts.length === 0 ? (
                    <EmptyState dashed title="No failures" description="Nothing failed to publish in this period." />
                  ) : (
                    <div className={styles.failedList}>
                      {model.failedPosts.slice(0, 8).map((post) => (
                        <button
                          key={post.id}
                          type="button"
                          className={styles.failedRow}
                          onClick={() => navigate(`/app/calendar?postId=${encodeURIComponent(post.id)}`)}
                        >
                          <div className={styles.failedMain}>
                            <span className={styles.failedTitle}>{getPostTitle(post)}</span>
                            <span className={styles.failedMeta}>{formatPlatformName(getPostPlatform(post))} · {formatDate(post.updated_at || post.created_at)}</span>
                          </div>
                          <span className={styles.failedReason}>{post.failure_reason || "Failed to publish"}</span>
                          <ArrowUpRight size={14} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              <Card>
                <div className={styles.panelHead}>
                  <span className={styles.sectionLabel}>Recent content</span>
                  <Button variant="ghost" size="sm" onClick={() => fetchAnalytics({ silent: true })} disabled={refreshing}>
                    <RefreshCw size={13} aria-hidden="true" /> {refreshing ? "Refreshing…" : "Refresh"}
                  </Button>
                </div>
                {model.recentPosts.length === 0 ? (
                  <EmptyState dashed title="Nothing tracked yet" description="Generate something in Studio to see it here." actions={<Button onClick={() => navigate("/app/generate")}><Sparkles size={14} aria-hidden="true" /> Create content</Button>} />
                ) : (
                  <div className={styles.recentList}>
                    {model.recentPosts.map((post) => (
                      <div key={post.id} className={styles.recentRow}>
                        <div className={styles.recentMain}>
                          <span className={styles.recentTitle}>{getPostTitle(post)}</span>
                          <span className={styles.recentMeta}>{formatDate(post.created_at)}</span>
                        </div>
                        <Badge tone="neutral">{formatPlatformName(getPostPlatform(post))}</Badge>
                        <Badge tone={post.status === "published" ? "success" : post.status === "failed" ? "danger" : post.status === "scheduled" ? "info" : "neutral"}>
                          {post.status || "draft"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </main>
    </>
  );
}

export default function PersonalAnalyticsPage() {
  return (
    <UiV2ThemeProvider className={styles.shell}>
      <AnalyticsBody />
    </UiV2ThemeProvider>
  );
}
