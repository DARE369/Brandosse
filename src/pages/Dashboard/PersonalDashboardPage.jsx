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
  AppShell,
  creditMeterPct,
  IconButton,
  Card,
  StatCard,
  Skeleton,
  EmptyState,
  Button,
  Badge,
} from "../../ui-v2";
import styles from "./PersonalDashboardPage.module.css";

function DashboardBody() {
  const { navigate } = useAppNavigation();
  const { user, profile } = useAuth();
  const data = useDashboardData(user?.id ?? null, profile);
  const searchRef = useRef(null);

  const {
    loading, error, handleRetry, userName, greeting, todayLabel,
    isFirstTime, hasConnectedAccount, hasGeneration, hasBrandKit,
    searchQuery, setSearchQuery, stats, trends, recentGenerations, hasSearch,
    nextPost, nextCountdown, nextPostIsMock, connectedAccounts, allAccountsMock, credits, creditSegments,
  } = data;

  // Persistent "finish setting up" checklist for RETURNING users (distinct
  // from the isFirstTime 3-card grid below, which only ever shows to a
  // brand-new user with zero generations/accounts). "Hide" is session-scoped
  // per the mockup's own tooltip ("Hide until next visit") — it comes back
  // next time rather than being dismissed forever.
  const [checklistHidden, setChecklistHidden] = useState(false);
  useEffect(() => {
    if (!user?.id) return;
    try {
      setChecklistHidden(sessionStorage.getItem(`dash-checklist-hidden-${user.id}`) === "1");
    } catch {
      /* private mode — just show it every time */
    }
  }, [user?.id]);
  const dismissChecklist = () => {
    setChecklistHidden(true);
    try {
      if (user?.id) sessionStorage.setItem(`dash-checklist-hidden-${user.id}`, "1");
    } catch {
      /* noop */
    }
  };

  const checklistItems = [
    { id: "connect", label: "Connect a social account", done: hasConnectedAccount, path: "/app/settings" },
    { id: "brand-kit", label: "Build your Brand Kit", done: hasBrandKit, path: "/app/settings/brand-kit" },
    { id: "first-post", label: "Schedule your first post", done: stats.scheduledPosts > 0 || stats.publishedPosts > 0, path: "/app/generate" },
  ];
  const checklistDone = checklistItems.filter((c) => c.done).length;
  const showChecklist = !isFirstTime && !loading && !checklistHidden && checklistDone < checklistItems.length;

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

  const onboardSteps = [
    { id: "profile", label: "Create your account", done: true },
    { id: "connect", label: "Connect a social account", done: hasConnectedAccount, cta: "Connect account", path: "/app/settings" },
    { id: "generate", label: "Generate a first post", done: hasGeneration, cta: "Start generating", path: "/app/generate" },
  ];
  const onboardDone = onboardSteps.filter((s) => s.done).length;

  // LOCK L2.5 — every post this user has is in exactly one of these buckets.
  //
  // The panel used to show Drafted → Scheduled → Published → Failed and stop
  // there, which silently dropped anything mid-publish: a user with 110 posts
  // was shown 107. `Publishing` is always visible because it is a real stage of
  // the pipeline, even at zero. Archived and Unrecognised appear only when the
  // user actually has some — they are not stages, they are exceptions, and a
  // permanent zero would imply the app expects them.
  const funnel = [
    { label: "Drafted", value: stats.drafts, tone: "var(--uiv2-text-secondary)" },
    { label: "Scheduled", value: stats.scheduledPosts, tone: "var(--uiv2-info)" },
    { label: "Publishing", value: stats.publishingPosts, tone: "var(--uiv2-warning)" },
    { label: "Published", value: stats.publishedPosts, tone: "var(--uiv2-accent-solid)" },
    { label: "Failed", value: stats.failedPosts, tone: "var(--uiv2-danger)" },
    ...(stats.archivedPosts > 0
      ? [{ label: "Archived", value: stats.archivedPosts, tone: "var(--uiv2-text-tertiary)" }]
      : []),
    ...(stats.unaccountedPosts > 0
      ? [{ label: "Unrecognised", value: stats.unaccountedPosts, tone: "var(--uiv2-warning)",
          title: "These posts have a status this dashboard does not have a bucket for. They are counted here rather than left out of the total." }]
      : []),
  ];
  const funnelMax = Math.max(...funnel.map((f) => f.value), 1);
  const funnelTotal = funnel.reduce((sum, f) => sum + f.value, 0);

  // Real trend arrows: last 30 days vs the 30 days before that (computeTrend
  // in useDashboardData). 0/0 renders as "steady", never a fabricated delta.
  const trendGlyph = (direction) => (direction === "up" ? "▲" : direction === "down" ? "▼" : "•");
  const trendTone = (direction) => (direction === "up" ? "positive" : direction === "down" ? "negative" : "neutral");
  const trendText = (t) => (t.pct === 0 && t.direction === "neutral" ? "steady vs last 30d" : `${trendGlyph(t.direction)} ${Math.abs(t.pct)}% vs last 30d`);

  const statCards = [
    { label: "Posts published", value: formatCount(stats.publishedPosts), trend: trendText(trends.publishedPosts), trendTone: trendTone(trends.publishedPosts.direction), sub: stats.totalGenerated > 0 ? `${Math.round((stats.publishedPosts / Math.max(stats.totalGenerated, 1)) * 100)}% publish ratio` : "Publish your first post" },
    { label: "Scheduled", value: formatCount(stats.scheduledPosts), trend: trendText(trends.scheduledPosts), trendTone: trendTone(trends.scheduledPosts.direction), sub: stats.scheduledPosts > 0 ? "In queue" : "Nothing queued" },
    // A door, not just a number. This tile counted clips and led nowhere — the
    // Dashboard told people their clips existed while offering no route to them,
    // and nothing else on this screen linked to the Videos surface either.
    {
      label: "Clips ready",
      value: formatCount(stats.clipsReady),
      trend: trendText(trends.clipsReady),
      trendTone: trendTone(trends.clipsReady.direction),
      sub: stats.clipsReady > 0 ? "Ready to use" : "No clips yet",
      onClick: () => navigate("/app/video/jobs"),
      actionLabel: "Open Videos",
    },
    { label: "Drafts", value: formatCount(stats.drafts), trend: trendText(trends.drafts), trendTone: trendTone(trends.drafts.direction), sub: stats.drafts > 0 ? "Ready to refine" : "All clear" },
  ];

  const nextPostWhen = nextPost ? formatScheduleTime(nextPost.scheduled_at) : null;

  return (
    <AppShell
      activeKey="dashboard"
      className={styles.shell}
      mainClassName={styles.main}
      leftExtra={(
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
      )}
      rightActions={(
        <IconButton title="Settings" onClick={() => navigate("/app/settings")}>
          <Settings size={15} />
        </IconButton>
      )}
    >
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

        {showChecklist && (
          <Card>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontFamily: "var(--uiv2-font-display)", fontWeight: 600, fontSize: "var(--uiv2-text-md)" }}>
                  Finish setting up
                </span>
                <span style={{ fontFamily: "var(--uiv2-font-mono)", fontSize: "var(--uiv2-text-xs)", color: "var(--uiv2-text-secondary)" }}>
                  {checklistDone} of {checklistItems.length} done
                </span>
              </div>
              <button
                type="button"
                title="Hide until next visit"
                onClick={dismissChecklist}
                style={{ background: "none", border: "none", color: "var(--uiv2-text-tertiary)", cursor: "pointer", fontSize: "var(--uiv2-text-xs)", textDecoration: "underline", fontFamily: "inherit" }}
              >
                Hide
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {checklistItems.map((item) => (
                <a
                  key={item.id}
                  href={item.path}
                  onClick={(e) => { e.preventDefault(); navigate(item.path); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "9px 11px",
                    borderRadius: 7, border: "1px solid var(--uiv2-border)", textDecoration: "none",
                    color: "var(--uiv2-text-primary)", background: "var(--uiv2-bg-inset)",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                      border: `1.5px solid ${item.done ? "var(--uiv2-success, #2a9d5c)" : "var(--uiv2-border-strong)"}`,
                      background: item.done ? "var(--uiv2-success, #2a9d5c)" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    {item.done && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2"><path d="M5 12l5 5 9-11" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    )}
                  </span>
                  <span style={{ flex: 1, fontSize: "var(--uiv2-text-sm)", fontWeight: 500, textDecoration: item.done ? "line-through" : "none", color: item.done ? "var(--uiv2-text-secondary)" : "var(--uiv2-text-primary)" }}>
                    {item.label}
                  </span>
                  {!item.done && <span style={{ fontSize: "var(--uiv2-text-xs)", fontWeight: 600, color: "var(--uiv2-accent-solid)" }}>Do it now</span>}
                </a>
              ))}
            </div>
          </Card>
        )}

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
            : statCards.map((s) => (
              <StatCard
                key={s.label}
                label={s.label}
                value={s.value}
                trend={s.trend}
                trendTone={s.trendTone}
                sub={s.sub}
                onClick={s.onClick}
                actionLabel={s.actionLabel}
              />
            ))}
        </div>

        <div className={styles.mainGrid}>
          <div className={styles.col}>
            <Card>
              <div className={styles.panelHead}>
                <span className={styles.panelKicker}>Next scheduled post</span>
                {nextPost ? (
                  nextPostIsMock ? (
                    <Badge tone="warning" dot>Simulated publish</Badge>
                  ) : (
                    <Badge tone="success" dot>Live publish</Badge>
                  )
                ) : null}
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
                <span className={styles.panelKicker}>
                  Content flow
                  {!loading && !error && funnelTotal > 0 ? (
                    <span className={styles.panelKickerCount}>{formatCount(funnelTotal)} posts</span>
                  ) : null}
                </span>
                <Button variant="ghost" size="sm" onClick={() => navigate("/app/analytics")}>Full report</Button>
              </div>
              {loading ? (
                <Skeleton height="60px" />
              ) : error ? (
                <RetryBlock onRetry={handleRetry} />
              ) : (
                <div className={styles.funnelRow}>
                  {funnel.map((f) => (
                    <div key={f.label} className={styles.funnelItem} title={f.title}>
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
                    actions={hasSearch
                      ? <Button size="sm" variant="subtle" onClick={() => setSearchQuery("")}>Clear search</Button>
                      : <Button size="sm" onClick={() => navigate("/app/generate")}>Generate now</Button>}
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
                    <div className={styles.creditBarFill} style={{ width: `${creditMeterPct(credits)}%` }} />
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
              <Button variant="subtle" size="sm" onClick={() => navigate("/app/billing")} style={{ width: "100%", marginTop: 6 }}>
                View billing
              </Button>
            </Card>

            <Card>
              <div className={styles.panelHead}>
                <span className={styles.panelKicker}>Connected accounts</span>
                {allAccountsMock ? <Badge tone="warning">Simulated</Badge> : null}
              </div>
              {loading ? (
                <Skeleton height="120px" />
              ) : connectedAccounts.length === 0 ? (
                <EmptyState
                  dashed
                  title="No accounts connected"
                  description="You can generate and schedule without one, but nothing can actually publish until an account is connected."
                  actions={<Button size="sm" onClick={() => navigate("/app/settings/connect")}>Connect an account</Button>}
                />
              ) : (
                <div>
                  {connectedAccounts.map((a) => (
                    <div key={a.id} className={styles.accountRow}>
                      <span className={styles.accountMark}>{a.mark}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className={styles.accountName}>
                          {a.name}
                          {a.isMock && !allAccountsMock ? (
                            <span style={{ marginLeft: 6 }}><Badge tone="neutral">Demo</Badge></span>
                          ) : null}
                        </div>
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
    </AppShell>
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
  return <DashboardBody />;
}
