"use client";

// src/pages/Dashboard/PersonalDashboardPage.jsx
// Design-system-v2 rebuild of the Personal Dashboard (see memory
// design-system-v2 / docs mockup "Personal Dashboard.dc.html"). Presentation
// only — all data comes from useDashboardData, which wraps the exact same
// Supabase queries/realtime the old UserDashboard.jsx used.
import { useEffect, useRef, useState } from "react";
import { Search, Settings, Sparkles, RefreshCw } from "lucide-react";
import { useAuth } from "../../Context/AuthContext";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useDashboardData, formatCount, formatScheduleTime, getGenerationTitle } from "../../hooks/useDashboardData";
import {
  UiV2ThemeProvider,
  useUiV2Theme,
  AppHeader,
  CreditPill,
  Avatar,
  IconButton,
  Card,
  StatCard,
  Skeleton,
  EmptyState,
  Button,
  Badge,
  MobileNavDrawer,
} from "../../ui-v2";
import styles from "./PersonalDashboardPage.module.css";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", href: "/app/dashboard" },
  { key: "studio", label: "Studio", href: "/app/generate" },
  { key: "library", label: "Library", href: "/app/library" },
  { key: "calendar", label: "Calendar", href: "/app/calendar" },
  { key: "brand-kit", label: "Brand Kit", href: "/app/settings/brand-kit" },
];

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

function DashboardBody() {
  const { navigate } = useAppNavigation();
  const { user, profile } = useAuth();
  const data = useDashboardData(user?.id ?? null, profile);
  const searchRef = useRef(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const {
    loading, error, handleRetry, userName, greeting, todayLabel,
    isFirstTime, hasConnectedAccount, hasGeneration,
    searchQuery, setSearchQuery, stats, trends, recentGenerations, hasSearch,
    nextPost, nextCountdown, connectedAccounts, credits, creditSegments,
  } = data;

  // "/" focuses search, "g" opens Studio — matches the v2 spec's kbd hints.
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea";
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if ((e.key === "g" || e.key === "G") && !typing) {
        e.preventDefault();
        navigate("/app/generate");
      } else if (e.key === "Escape" && typing) {
        setSearchQuery("");
        e.target.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, setSearchQuery]);

  const creditPct = credits.lifetimePurchased > 0
    ? Math.max(0, Math.min(100, Math.round((credits.balance / credits.lifetimePurchased) * 100)))
    : 100;

  const onboardSteps = [
    { id: "profile", label: "Create your account", done: true },
    { id: "connect", label: "Connect a social account", done: hasConnectedAccount, cta: "Connect account", path: "/app/settings" },
    { id: "generate", label: "Generate a first post", done: hasGeneration, cta: "Start generating", path: "/app/generate" },
  ];
  const onboardDone = onboardSteps.filter((s) => s.done).length;

  // Matches the mockup's Drafted → Scheduled → Published → Failed pipeline —
  // all four are real counts now that posts.failed_at/published_at back them.
  const funnel = [
    { label: "Drafted", value: stats.drafts, tone: "var(--uiv2-text-secondary)" },
    { label: "Scheduled", value: stats.scheduledPosts, tone: "var(--uiv2-info)" },
    { label: "Published", value: stats.publishedPosts, tone: "var(--uiv2-accent-solid)" },
    { label: "Failed", value: stats.failedPosts, tone: "var(--uiv2-danger)" },
  ];
  const funnelMax = Math.max(...funnel.map((f) => f.value), 1);

  // Real trend arrows: last 30 days vs the 30 days before that (computeTrend
  // in useDashboardData). 0/0 renders as "steady", never a fabricated delta.
  const trendGlyph = (direction) => (direction === "up" ? "▲" : direction === "down" ? "▼" : "•");
  const trendTone = (direction) => (direction === "up" ? "positive" : direction === "down" ? "negative" : "neutral");
  const trendText = (t) => (t.pct === 0 && t.direction === "neutral" ? "steady vs last 30d" : `${trendGlyph(t.direction)} ${Math.abs(t.pct)}% vs last 30d`);

  const statCards = [
    { label: "Posts published", value: formatCount(stats.publishedPosts), trend: trendText(trends.publishedPosts), trendTone: trendTone(trends.publishedPosts.direction), sub: stats.totalGenerated > 0 ? `${Math.round((stats.publishedPosts / Math.max(stats.totalGenerated, 1)) * 100)}% publish ratio` : "Publish your first post" },
    { label: "Scheduled", value: formatCount(stats.scheduledPosts), trend: trendText(trends.scheduledPosts), trendTone: trendTone(trends.scheduledPosts.direction), sub: stats.scheduledPosts > 0 ? "In queue" : "Nothing queued" },
    { label: "Clips ready", value: formatCount(stats.clipsReady), trend: trendText(trends.clipsReady), trendTone: trendTone(trends.clipsReady.direction), sub: stats.clipsReady > 0 ? "Ready to use" : "No clips yet" },
    { label: "Drafts", value: formatCount(stats.drafts), trend: trendText(trends.drafts), trendTone: trendTone(trends.drafts.direction), sub: stats.drafts > 0 ? "Ready to refine" : "All clear" },
  ];

  const nextPostWhen = nextPost ? formatScheduleTime(nextPost.scheduled_at) : null;
  const userInitials = ((profile?.full_name ? profile.full_name[0] : "U") + (profile?.full_name?.split(" ")[1]?.[0] ?? "")).toUpperCase();

  return (
    <>
      <AppHeader
        navItems={NAV_ITEMS}
        activeKey="dashboard"
        onNavClick={(item) => navigate(item.href)}
        onBurgerClick={() => setMobileNavOpen(true)}
        leftExtra={
          <label className={styles.searchBox}>
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search generations"
            />
            <kbd className={styles.searchKbd}>/</kbd>
          </label>
        }
        right={
          <>
            {credits.ready ? (
              <CreditPill pct={`${creditPct}%`} label={`${formatCount(credits.balance)} cr`} />
            ) : (
              <Skeleton width="76px" height="26px" radius="999px" />
            )}
            <ThemeToggleButton />
            <IconButton title="Settings" onClick={() => navigate("/app/settings")}>
              <Settings size={15} />
            </IconButton>
            <Avatar initials={userInitials || "U"} onClick={() => navigate("/app/profile")} />
          </>
        }
      />

      <MobileNavDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        navItems={NAV_ITEMS}
        activeKey="dashboard"
        onNavClick={(item) => navigate(item.href)}
      />

      <main className={styles.main}>
        <div className={styles.canvas}>
          <div className={styles.greetingRow}>
            <div>
              <div className={styles.greetingTitle}>{greeting}, {userName}</div>
              <div className={styles.greetingSub}>{todayLabel}</div>
            </div>
            <Button onClick={() => navigate("/app/generate")}>
              <Sparkles size={14} aria-hidden="true" />
              New generation
              <kbd className={styles.kbdChip}>G</kbd>
            </Button>
          </div>

          {isFirstTime && !loading && (
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontFamily: "var(--uiv2-font-display)", fontWeight: 600, fontSize: "var(--uiv2-text-lg)", marginBottom: 4 }}>
                    Get your first post out the door
                  </div>
                  <div style={{ color: "var(--uiv2-text-secondary)", fontSize: "var(--uiv2-text-sm)" }}>
                    Three steps to build your publishing loop.
                  </div>
                </div>
                <Badge tone="accent">{onboardDone} / {onboardSteps.length} done</Badge>
              </div>
              <div className={styles.onboardGrid}>
                {onboardSteps.map((step) => (
                  <div key={step.id} className={[styles.onboardStep, !step.done ? styles.onboardStepActive : ""].join(" ")}>
                    {step.done ? (
                      <span className={styles.onboardDone}>DONE</span>
                    ) : (
                      <span className={styles.onboardRing} />
                    )}
                    <div style={{ fontWeight: 600, fontSize: "var(--uiv2-text-md)" }}>{step.label}</div>
                    {!step.done && (
                      <Button size="sm" variant={step.id === "connect" ? "solid" : "subtle"} onClick={() => navigate(step.path)} style={{ alignSelf: "flex-start", marginTop: "auto" }}>
                        {step.cta}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className={styles.statGrid}>
            {loading
              ? [0, 1, 2, 3].map((i) => <Skeleton key={i} height="86px" radius="var(--uiv2-radius-lg)" />)
              : statCards.map((s) => <StatCard key={s.label} label={s.label} value={s.value} trend={s.trend} trendTone={s.trendTone} sub={s.sub} />)}
          </div>

          <div className={styles.mainGrid}>
            <div className={styles.col}>
              <Card>
                <div className={styles.panelHead}>
                  <span className={styles.panelKicker}>Next scheduled post</span>
                  <Badge tone="warning" dot>Simulated publish</Badge>
                </div>
                {loading ? (
                  <Skeleton height="120px" />
                ) : error ? (
                  <RetryBlock onRetry={handleRetry} />
                ) : nextPost ? (
                  <>
                    <div className={styles.nextPostRow}>
                      <div className={styles.nextPostThumb}>{(nextPost.generations?.media_type ?? "img").slice(0, 3).toUpperCase()}</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className={styles.nextPostTitle}>{nextPost.title || nextPost.caption || "Untitled post"}</div>
                        <div className={styles.nextPostMeta}>{nextPost.platform ?? "—"}</div>
                      </div>
                    </div>
                    <div className={styles.nextPostFoot}>
                      <div>
                        <div className={styles.countdown}>{nextCountdown ?? "—"}</div>
                        <div className={styles.countdownWhen}>{nextPostWhen?.label?.toUpperCase() ?? ""}</div>
                      </div>
                      <div className={styles.nextPostActions}>
                        <Button onClick={() => navigate("/app/calendar")}>Review post</Button>
                        <Button variant="subtle" onClick={() => navigate("/app/calendar")}>Open calendar</Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <EmptyState
                    title="Nothing scheduled"
                    description="Schedule a post to see it here."
                    actions={<Button size="sm" onClick={() => navigate("/app/calendar")}>Schedule a post</Button>}
                  />
                )}
              </Card>

              <Card>
                <div className={styles.panelHead}>
                  <span className={styles.panelKicker}>Content flow</span>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/app/analytics")}>Full report</Button>
                </div>
                {loading ? (
                  <Skeleton height="60px" />
                ) : error ? (
                  <RetryBlock onRetry={handleRetry} />
                ) : (
                  <div className={styles.funnelRow}>
                    {funnel.map((f) => (
                      <div key={f.label} className={styles.funnelItem}>
                        <span className={styles.funnelCount}>{formatCount(f.value)}</span>
                        <span className={styles.funnelLabel}>{f.label}</span>
                        <div className={styles.funnelBar}>
                          <div className={styles.funnelBarFill} style={{ width: `${Math.round((f.value / funnelMax) * 100)}%`, background: f.tone }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card>
                <div className={styles.panelHead}>
                  <span className={styles.panelKicker}>Recent generations</span>
                  <button className={styles.panelLink} onClick={() => navigate("/app/generate")}>View all</button>
                </div>
                {loading ? (
                  <div className={styles.rowList}>
                    {[0, 1, 2].map((i) => <Skeleton key={i} height="52px" style={{ marginBottom: 8 }} />)}
                  </div>
                ) : error ? (
                  <RetryBlock onRetry={handleRetry} />
                ) : recentGenerations.length === 0 ? (
                  <div className={styles.emptyPad}>
                    <EmptyState
                      title={hasSearch ? `No generations match "${searchQuery}"` : "No generations yet"}
                      description={hasSearch ? "Try a different keyword, or clear the search." : "Generate your first post to start building your library."}
                      actions={!hasSearch && <Button size="sm" onClick={() => navigate("/app/generate")}>Generate now</Button>}
                    />
                  </div>
                ) : (
                  <div className={styles.rowList}>
                    {recentGenerations.map((g) => (
                      <button key={g.id} type="button" className={styles.rowItem} onClick={() => navigate(g.session_id ? `/app/generate/${g.session_id}` : "/app/generate")}>
                        <span className={styles.rowThumb}>
                          {g.storage_path ? (
                            g.media_type === "video" ? <video src={g.storage_path} muted /> : <img src={g.storage_path} alt="" />
                          ) : (
                            (g.media_type ?? "img").slice(0, 3).toUpperCase()
                          )}
                        </span>
                        <span className={styles.rowInfo}>
                          <div className={styles.rowTitle}>{getGenerationTitle(g)}</div>
                          <div className={styles.rowMeta}>{new Date(g.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                        </span>
                        <span className={styles.rowStatus}>{g.status ?? "processing"}</span>
                      </button>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            <div className={styles.col}>
              <Card>
                <div className={styles.panelHead}>
                  <span className={styles.panelKicker}>Credit balance</span>
                </div>
                {!credits.ready ? (
                  <>
                    <Skeleton height="34px" style={{ marginBottom: 12 }} />
                    <Skeleton height="5px" style={{ marginBottom: 14 }} />
                    <Skeleton height="52px" />
                  </>
                ) : (
                  <>
                    <div className={styles.creditRow}>
                      <span className={styles.creditValue}>{formatCount(credits.balance)}</span>
                      <span className={styles.creditSub}>
                        {credits.lifetimePurchased > 0 ? `of ${formatCount(credits.lifetimePurchased)} purchased` : "free credits"}
                      </span>
                    </div>
                    <div className={styles.creditBar}>
                      <div className={styles.creditBarFill} style={{ width: `${creditPct}%` }} />
                    </div>
                    {creditSegments.length > 0 && (
                      <div style={{ marginBottom: 4 }}>
                        {creditSegments.map((seg) => (
                          <div key={seg.key} className={styles.creditLine}>
                            <span style={{ color: "var(--uiv2-text-secondary)" }}>{seg.label}</span>
                            <span style={{ fontFamily: "var(--uiv2-font-mono)" }}>{formatCount(seg.value)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className={styles.creditLine}>
                      <span style={{ color: "var(--uiv2-text-secondary)", fontWeight: 500 }}>Spent all-time</span>
                      <span style={{ fontFamily: "var(--uiv2-font-mono)", fontWeight: 600 }}>{formatCount(credits.lifetimeConsumed)}</span>
                    </div>
                  </>
                )}
                <Button variant="subtle" size="sm" onClick={() => navigate("/app/billing/credits")} style={{ width: "100%", marginTop: 6 }}>
                  View billing
                </Button>
              </Card>

              <Card>
                <div className={styles.panelHead}>
                  <span className={styles.panelKicker}>Connected accounts</span>
                  <Badge tone="warning">Simulated</Badge>
                </div>
                {loading ? (
                  <Skeleton height="120px" />
                ) : connectedAccounts.length === 0 ? (
                  <EmptyState title="No accounts connected" description="Connect a social account to start publishing." dashed />
                ) : (
                  <div>
                    {connectedAccounts.map((a) => (
                      <div key={a.id} className={styles.accountRow}>
                        <span className={styles.accountMark}>{a.mark}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className={styles.accountName}>{a.name}</div>
                          <div className={styles.accountHandle}>{a.handle}</div>
                        </div>
                        <span className={styles.accountStatus}>
                          <span className={styles.statusDot} style={{ background: `var(--uiv2-${a.statusTone})` }} />
                          {a.statusLabel}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <Button variant="subtle" size="sm" onClick={() => navigate("/app/settings")} style={{ width: "100%", marginTop: 14 }}>
                  Manage accounts
                </Button>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

function RetryBlock({ onRetry }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--uiv2-text-secondary)", fontSize: "var(--uiv2-text-sm)" }}>
      Couldn't load this.
      <Button size="sm" variant="subtle" onClick={onRetry}>
        <RefreshCw size={13} aria-hidden="true" /> Retry
      </Button>
    </div>
  );
}

export default function PersonalDashboardPage() {
  return (
    <UiV2ThemeProvider className={styles.shell}>
      <DashboardBody />
    </UiV2ThemeProvider>
  );
}
