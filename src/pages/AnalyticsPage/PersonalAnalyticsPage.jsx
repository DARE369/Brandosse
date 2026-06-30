"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Eye,
  Heart,
  Lock,
  MessageCircle,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { useAuth } from '../../Context/AuthContext';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import UserNavbar from '../../components/User/UserNavbar';
import UserSidebar from '../../components/User/UserSidebar';
import {
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiPageHeader,
  UiStatCard,
  UiStatusBadge,
  UiTable,
} from '../../components/Shared/ui';
import { POST_STATUS } from '../../constants/statuses';
const MAX_ANALYTICS_ROWS = 500;
const KNOWN_OPTIONAL_ERROR_CODES = new Set(['42P01', '42703', 'PGRST200']);

const PLATFORM_LABELS = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  twitter: 'X',
  x: 'X',
  youtube: 'YouTube',
  unknown: 'Unassigned',
};

const EMPTY_MODEL = {
  stats: {
    generated: 0,
    posts: 0,
    drafts: 0,
    scheduled: 0,
    published: 0,
    failed: 0,
    connectedAccounts: 0,
    healthyAccounts: 0,
    contentThisWeek: 0,
    contentTrend: 0,
    publishingRate: 0,
    averageHealth: null,
  },
  platformRows: [],
  funnelStages: [],
  recentPosts: [],
  externalTotals: {
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
  },
  hasExternalMetrics: false,
  nextActions: [],
};

function isOptionalDataError(error) {
  if (!error) return false;
  const message = `${error.message || ''} ${error.details || ''}`.toLowerCase();
  return KNOWN_OPTIONAL_ERROR_CODES.has(error.code) || /does not exist|relationship|permission denied/.test(message);
}

function normalizePlatform(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized === 'twitter') return 'x';
  return normalized;
}

function formatPlatformName(platform) {
  const normalized = normalizePlatform(platform);
  return PLATFORM_LABELS[normalized] || normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getPostPlatform(post) {
  const connectedAccount = Array.isArray(post?.connected_accounts)
    ? post.connected_accounts[0]
    : post?.connected_accounts;
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

function formatPercent(value) {
  if (!Number.isFinite(value)) return '0%';
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function formatDate(value) {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No date';

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getPostTitle(post) {
  const caption = String(post?.caption || '').trim();
  if (caption) {
    const words = caption.split(/\s+/).filter(Boolean);
    const title = words.slice(0, 8).join(' ');
    return words.length > 8 ? `${title}...` : title;
  }

  const generation = Array.isArray(post?.generations)
    ? post.generations[0]
    : post?.generations;
  const prompt = String(generation?.prompt || '').trim();
  if (prompt) {
    const words = prompt.split(/\s+/).filter(Boolean);
    const title = words.slice(0, 8).join(' ');
    return words.length > 8 ? `${title}...` : title;
  }

  return 'Untitled post';
}

function isAccountHealthy(account) {
  const status = String(account?.connection_status || account?.status || '').toLowerCase();
  if (['healthy', 'active', 'connected'].includes(status)) return true;
  return toNumber(account?.health_score) >= 70;
}

function buildPlatformRows(posts, accounts) {
  const rows = new Map();

  const ensureRow = (platform) => {
    const key = normalizePlatform(platform);
    if (!rows.has(key)) {
      rows.set(key, {
        platform: key,
        label: formatPlatformName(key),
        accounts: 0,
        healthyAccounts: 0,
        totalPosts: 0,
        drafts: 0,
        scheduled: 0,
        published: 0,
        failed: 0,
        healthScores: [],
      });
    }
    return rows.get(key);
  };

  accounts.forEach((account) => {
    const row = ensureRow(getAccountPlatform(account));
    row.accounts += 1;
    if (isAccountHealthy(account)) row.healthyAccounts += 1;
    if (account?.health_score !== null && account?.health_score !== undefined) {
      row.healthScores.push(toNumber(account.health_score));
    }
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
    .map((row) => {
      const averageHealth = row.healthScores.length
        ? Math.round(row.healthScores.reduce((sum, score) => sum + score, 0) / row.healthScores.length)
        : null;

      return {
        ...row,
        averageHealth,
        activityShare: totalActivity > 0 ? (row.totalPosts / totalActivity) * 100 : 0,
        publishRate: row.totalPosts > 0 ? (row.published / row.totalPosts) * 100 : 0,
      };
    })
    .sort((a, b) => (b.totalPosts + b.accounts) - (a.totalPosts + a.accounts));
}

function buildExternalTotals(posts) {
  return posts.reduce((totals, post) => {
    const analyticsRows = Array.isArray(post?.platform_analytics)
      ? post.platform_analytics
      : post?.platform_analytics
        ? [post.platform_analytics]
        : [];

    analyticsRows.forEach((row) => {
      totals.views += toNumber(row?.views);
      totals.likes += toNumber(row?.likes);
      totals.comments += toNumber(row?.comments);
      totals.shares += toNumber(row?.shares);
    });

    return totals;
  }, {
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
  });
}

function buildAnalyticsModel({ posts, generations, accounts }) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const previousWeekStart = new Date(now);
  previousWeekStart.setDate(now.getDate() - 14);

  const statusCounts = posts.reduce((counts, post) => {
    const status = String(post?.status || POST_STATUS.DRAFT).toLowerCase();
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});

  const contentThisWeek = [...posts, ...generations].filter((item) => {
    const createdAt = new Date(item?.created_at);
    return !Number.isNaN(createdAt.getTime()) && createdAt >= weekStart;
  }).length;

  const contentLastWeek = [...posts, ...generations].filter((item) => {
    const createdAt = new Date(item?.created_at);
    return !Number.isNaN(createdAt.getTime()) && createdAt >= previousWeekStart && createdAt < weekStart;
  }).length;

  const connectedAccounts = accounts.length;
  const healthyAccounts = accounts.filter(isAccountHealthy).length;
  const healthScores = accounts
    .map((account) => account?.health_score)
    .filter((score) => score !== null && score !== undefined)
    .map(toNumber);

  const averageHealth = healthScores.length
    ? Math.round(healthScores.reduce((sum, score) => sum + score, 0) / healthScores.length)
    : null;

  const generated = generations.length;
  const drafts = statusCounts[POST_STATUS.DRAFT] || 0;
  const scheduled = statusCounts[POST_STATUS.SCHEDULED] || 0;
  const published = statusCounts[POST_STATUS.PUBLISHED] || 0;
  const failed = statusCounts[POST_STATUS.FAILED] || 0;
  const publishingRate = posts.length ? (published / posts.length) * 100 : 0;
  const platformRows = buildPlatformRows(posts, accounts);
  const externalTotals = buildExternalTotals(posts);
  const hasExternalMetrics = Object.values(externalTotals).some((value) => value > 0);

  const funnelStages = [
    {
      id: 'generated',
      label: 'Generated',
      value: generated,
      description: 'AI outputs created',
      icon: Sparkles,
    },
    {
      id: 'drafts',
      label: 'Drafted',
      value: drafts,
      description: 'Saved post drafts',
      icon: Activity,
    },
    {
      id: 'scheduled',
      label: 'Scheduled',
      value: scheduled,
      description: 'Ready on calendar',
      icon: CalendarClock,
    },
    {
      id: 'published',
      label: 'Published',
      value: published,
      description: 'Completed lifecycle',
      icon: CheckCircle2,
    },
  ];

  const maxFunnelValue = Math.max(...funnelStages.map((stage) => stage.value), 1);

  const nextActions = [
    connectedAccounts === 0
      ? {
          id: 'connect',
          tone: 'warning',
          label: 'Setup',
          title: 'Connect your first platform',
          description: 'Platform breakdowns become more useful when every draft has a target account.',
        }
      : null,
    drafts > scheduled
      ? {
          id: 'schedule',
          tone: 'brand',
          label: 'Action',
          title: 'Schedule high-potential drafts',
          description: `${formatNumber(drafts)} draft${drafts === 1 ? '' : 's'} can still move into your calendar.`,
        }
      : null,
    scheduled === 0 && generated > 0
      ? {
          id: 'calendar',
          tone: 'info',
          label: 'Plan',
          title: 'Create your first publishing slot',
          description: 'Use Calendar to turn generated content into a visible plan.',
        }
      : null,
    failed > 0
      ? {
          id: 'failed',
          tone: 'danger',
          label: 'Review',
          title: 'Review failed posts',
          description: `${formatNumber(failed)} post${failed === 1 ? '' : 's'} need attention before publishing.`,
        }
      : null,
    {
      id: 'native',
      tone: 'neutral',
      label: 'Next',
      title: 'Native social metrics are next',
      description: 'Views, likes, comments, shares, and audience growth will appear when platform analytics sync is live.',
    },
  ].filter(Boolean).slice(0, 4);

  return {
    stats: {
      generated,
      posts: posts.length,
      drafts,
      scheduled,
      published,
      failed,
      connectedAccounts,
      healthyAccounts,
      contentThisWeek,
      contentTrend: contentThisWeek - contentLastWeek,
      publishingRate,
      averageHealth,
    },
    platformRows,
    funnelStages: funnelStages.map((stage) => ({
      ...stage,
      percent: (stage.value / maxFunnelValue) * 100,
    })),
    recentPosts: posts.slice(0, 8),
    externalTotals,
    hasExternalMetrics,
    nextActions,
  };
}

async function fetchPersonalPosts(userId) {
  const withAnalytics = await supabase
    .from('posts')
    .select(`
      *,
      connected_accounts ( id, platform, account_name, avatar_url ),
      generations ( id, prompt, storage_path, media_type ),
      platform_analytics (*)
    `)
    .eq('user_id', userId)
    .is('organization_id', null)
    .order('created_at', { ascending: false })
    .limit(MAX_ANALYTICS_ROWS);

  if (!withAnalytics.error) {
    return withAnalytics.data || [];
  }

  if (!isOptionalDataError(withAnalytics.error)) {
    throw withAnalytics.error;
  }

  const fallback = await supabase
    .from('posts')
    .select(`
      *,
      connected_accounts ( id, platform, account_name, avatar_url ),
      generations ( id, prompt, storage_path, media_type )
    `)
    .eq('user_id', userId)
    .is('organization_id', null)
    .order('created_at', { ascending: false })
    .limit(MAX_ANALYTICS_ROWS);

  if (fallback.error) throw fallback.error;
  return fallback.data || [];
}

async function fetchPersonalAccounts(userId) {
  const healthSummary = await supabase
    .from('connected_accounts_health_summary')
    .select(`
      id,
      platform,
      platform_display_name,
      display_name,
      account_name,
      username,
      connection_status,
      health_score,
      scope,
      user_id
    `)
    .eq('scope', 'personal')
    .eq('user_id', userId)
    .order('display_name', { ascending: true });

  if (!healthSummary.error) {
    return healthSummary.data || [];
  }

  if (!isOptionalDataError(healthSummary.error)) {
    throw healthSummary.error;
  }

  const fallback = await supabase
    .from('connected_accounts')
    .select('id, platform, account_name, username, status, user_id')
    .eq('user_id', userId)
    .order('platform', { ascending: true });

  if (fallback.error) throw fallback.error;
  return fallback.data || [];
}

function PlatformRow({ row }) {
  const healthLabel = row.averageHealth === null ? 'Not scored' : `${row.averageHealth}% health`;

  return (
    <article className="analytics-platform-row">
      <div className="analytics-platform-main">
        <span className="analytics-platform-dot" data-platform={row.platform} aria-hidden="true" />
        <div>
          <h3>{row.label}</h3>
          <p>
            {formatNumber(row.totalPosts)} post{row.totalPosts === 1 ? '' : 's'} · {formatNumber(row.accounts)} account{row.accounts === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <div className="analytics-platform-meter" aria-label={`${row.label} activity share ${formatPercent(row.activityShare)}`}>
        <span style={{ inlineSize: formatPercent(row.activityShare) }} />
      </div>

      <div className="analytics-platform-stats">
        <span>{formatNumber(row.published)} published</span>
        <span>{formatNumber(row.scheduled)} scheduled</span>
        <span>{healthLabel}</span>
      </div>
    </article>
  );
}

function FunnelStage({ stage }) {
  const Icon = stage.icon;

  return (
    <article className="analytics-funnel-stage">
      <div className="analytics-funnel-icon">
        <Icon size={17} aria-hidden="true" />
      </div>
      <div className="analytics-funnel-copy">
        <div>
          <h3>{stage.label}</h3>
          <strong>{formatNumber(stage.value)}</strong>
        </div>
        <p>{stage.description}</p>
        <div className="analytics-funnel-meter" aria-hidden="true">
          <span style={{ inlineSize: formatPercent(stage.percent) }} />
        </div>
      </div>
    </article>
  );
}

export default function PersonalAnalyticsPage() {
  const { navigate } = useAppNavigation();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [analyticsData, setAnalyticsData] = useState({
    posts: [],
    generations: [],
    accounts: [],
  });

  const fetchAnalytics = useCallback(async ({ silent = false } = {}) => {
    if (!userId) {
      setLoading(false);
      return;
    }

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError('');

    try {
      const [posts, generationsResult, accounts] = await Promise.all([
        fetchPersonalPosts(userId),
        supabase
          .from('generations')
          .select('id, status, created_at, metadata')
          .eq('user_id', userId)
          .is('organization_id', null)
          .order('created_at', { ascending: false })
          .limit(MAX_ANALYTICS_ROWS),
        fetchPersonalAccounts(userId),
      ]);

      if (generationsResult.error) throw generationsResult.error;

      setAnalyticsData({
        posts,
        generations: generationsResult.data || [],
        accounts,
      });
    } catch (fetchError) {
      console.error('[PersonalAnalyticsPage] fetch failed:', fetchError);
      setError(fetchError?.message || 'Analytics could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchAnalytics();

    if (!userId) return undefined;

    const channel = supabase
      .channel(`personal-analytics-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts', filter: `user_id=eq.${userId}` }, () => {
        fetchAnalytics({ silent: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'generations', filter: `user_id=eq.${userId}` }, () => {
        fetchAnalytics({ silent: true });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'connected_accounts', filter: `user_id=eq.${userId}` }, () => {
        fetchAnalytics({ silent: true });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAnalytics, userId]);

  const model = useMemo(() => {
    if (!analyticsData) return EMPTY_MODEL;
    return buildAnalyticsModel(analyticsData);
  }, [analyticsData]);

  const tableColumns = useMemo(() => [
    {
      key: 'caption',
      header: 'Content',
      render: (post) => (
        <div className="analytics-table-title">
          <strong>{getPostTitle(post)}</strong>
          <span>{formatDate(post.created_at)}</span>
        </div>
      ),
    },
    {
      key: 'platform',
      header: 'Platform',
      render: (post) => (
        <UiBadge tone="neutral" size="sm">
          {formatPlatformName(getPostPlatform(post))}
        </UiBadge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (post) => <UiStatusBadge status={post.status || POST_STATUS.DRAFT} size="sm" />,
    },
    {
      key: 'scheduled_at',
      header: 'Timeline',
      render: (post) => formatDate(post.published_at || post.scheduled_at || post.created_at),
    },
  ], []);

  const nativeMetricCards = [
    { label: 'Native views', value: model.hasExternalMetrics ? model.externalTotals.views : 'Soon', icon: Eye },
    { label: 'Native likes', value: model.hasExternalMetrics ? model.externalTotals.likes : 'Soon', icon: Heart },
    { label: 'Comments', value: model.hasExternalMetrics ? model.externalTotals.comments : 'Soon', icon: MessageCircle },
    { label: 'Shares', value: model.hasExternalMetrics ? model.externalTotals.shares : 'Soon', icon: Share2 },
  ];

  return (
    <div className="dashboard-shell analytics-shell">
      <UserNavbar />
      <UserSidebar />

      <main className="dashboard-content analytics-content" id="main-content">
        <div className="analytics-page">
          <UiPageHeader
            className="analytics-page-header"
            eyebrow="Personal analytics"
            title="Platform performance basics"
            description="Track your app-side content activity by platform. Native social media engagement metrics are marked for the next analytics sync release."
            meta={(
              <>
                <UiBadge tone="brand">Phase 1</UiBadge>
                <UiBadge tone="info">Native metrics coming soon</UiBadge>
              </>
            )}
            actions={(
              <>
                <UiButton variant="secondary" onClick={() => fetchAnalytics({ silent: true })} loading={refreshing}>
                  <RefreshCw size={16} aria-hidden="true" />
                  Refresh
                </UiButton>
                <UiButton variant="primary" onClick={() => navigate('/app/generate')}>
                  <Sparkles size={16} aria-hidden="true" />
                  Create content
                </UiButton>
              </>
            )}
          />

          <section className="analytics-theme-strip" aria-label="Selected product color theme">
            <div>
              <span className="analytics-theme-swatch theme-indigo" aria-hidden="true" />
              <strong>Deep Indigo</strong>
              <span>Primary action and brand trust</span>
            </div>
            <div>
              <span className="analytics-theme-swatch theme-teal" aria-hidden="true" />
              <strong>Signal Teal</strong>
              <span>Insights, health, and progress</span>
            </div>
            <div>
              <span className="analytics-theme-swatch theme-amber" aria-hidden="true" />
              <strong>Momentum Amber</strong>
              <span>Scheduling, attention, and timing</span>
            </div>
          </section>

          {error ? (
            <UiCard className="analytics-error-card" padding="md">
              <AlertCircle size={18} aria-hidden="true" />
              <div>
                <strong>Analytics could not be loaded</strong>
                <p>{error}</p>
              </div>
              <UiButton variant="secondary" size="sm" onClick={() => fetchAnalytics()}>
                Try again
              </UiButton>
            </UiCard>
          ) : null}

          {loading ? (
            <section className="analytics-loading-grid" aria-label="Loading analytics">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="analytics-skeleton-card" />
              ))}
            </section>
          ) : (
            <>
              <section className="analytics-kpi-grid" aria-label="Analytics summary">
                <UiStatCard
                  label="Generated"
                  value={formatNumber(model.stats.generated)}
                  description={`${formatNumber(model.stats.contentThisWeek)} created this week`}
                  trend={{
                    tone: model.stats.contentTrend >= 0 ? 'success' : 'warning',
                    label: `${model.stats.contentTrend >= 0 ? '+' : ''}${formatNumber(model.stats.contentTrend)} vs last week`,
                  }}
                  icon={<Sparkles size={18} />}
                />
                <UiStatCard
                  label="Scheduled"
                  value={formatNumber(model.stats.scheduled)}
                  description="Posts waiting on the calendar"
                  icon={<CalendarClock size={18} />}
                />
                <UiStatCard
                  label="Published"
                  value={formatNumber(model.stats.published)}
                  description={`${formatPercent(model.stats.publishingRate)} of tracked posts`}
                  icon={<Send size={18} />}
                />
                <UiStatCard
                  label="Connected"
                  value={formatNumber(model.stats.connectedAccounts)}
                  description={
                    model.stats.averageHealth === null
                      ? 'No health score yet'
                      : `${model.stats.healthyAccounts}/${model.stats.connectedAccounts} healthy · ${model.stats.averageHealth}% avg`
                  }
                  icon={<TrendingUp size={18} />}
                />
              </section>

              <section className="analytics-overview-grid">
                <UiCard className="analytics-panel" padding="md">
                  <div className="analytics-panel-header">
                    <div>
                      <h2>Publishing funnel</h2>
                      <p>How your work moves from generation to published content.</p>
                    </div>
                    <UiBadge tone="brand">App data</UiBadge>
                  </div>
                  <div className="analytics-funnel-list">
                    {model.funnelStages.map((stage) => (
                      <FunnelStage key={stage.id} stage={stage} />
                    ))}
                  </div>
                </UiCard>

                <UiCard className="analytics-panel" padding="md">
                  <div className="analytics-panel-header">
                    <div>
                      <h2>Next best actions</h2>
                      <p>Priority signals based on your current workspace data.</p>
                    </div>
                  </div>
                  <div className="analytics-action-list">
                    {model.nextActions.map((action) => (
                      <article key={action.id} className="analytics-action-item">
                        <UiBadge tone={action.tone} size="sm">{action.label}</UiBadge>
                        <div>
                          <h3>{action.title}</h3>
                          <p>{action.description}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </UiCard>
              </section>

              <section className="analytics-overview-grid analytics-overview-grid-wide">
                <UiCard className="analytics-panel" padding="md">
                  <div className="analytics-panel-header">
                    <div>
                      <h2>Platform analytics</h2>
                      <p>Basic platform activity from drafts, scheduled posts, published posts, and account health.</p>
                    </div>
                    <UiBadge tone="success">Live basics</UiBadge>
                  </div>

                  {model.platformRows.length === 0 ? (
                    <UiEmptyState
                      icon={<BarChart3 size={28} />}
                      title="No platform activity yet"
                      description="Create or schedule content for a platform to start filling this dashboard."
                      actions={(
                        <UiButton variant="primary" size="sm" onClick={() => navigate('/app/generate')}>
                          <Sparkles size={15} aria-hidden="true" />
                          Generate now
                        </UiButton>
                      )}
                    />
                  ) : (
                    <div className="analytics-platform-list">
                      {model.platformRows.map((row) => (
                        <PlatformRow key={row.platform} row={row} />
                      ))}
                    </div>
                  )}
                </UiCard>

                <UiCard className="analytics-panel analytics-coming-soon-panel" padding="md">
                  <div className="analytics-panel-header">
                    <div>
                      <h2>Social media metrics</h2>
                      <p>Native engagement analytics from each social network will land here when sync is enabled.</p>
                    </div>
                    <UiBadge tone="warning">Coming soon</UiBadge>
                  </div>

                  <div className="analytics-native-grid">
                    {nativeMetricCards.map(({ label, value, icon: Icon }) => (
                      <article key={label} className="analytics-native-card">
                        <span>
                          <Icon size={16} aria-hidden="true" />
                        </span>
                        <div>
                          <strong>{typeof value === 'number' ? formatNumber(value) : value}</strong>
                          <p>{label}</p>
                        </div>
                        {!model.hasExternalMetrics ? <Lock size={14} aria-hidden="true" /> : null}
                      </article>
                    ))}
                  </div>

                  <div className="analytics-sync-note">
                    <Clock3 size={16} aria-hidden="true" />
                    <span>Instagram, TikTok, YouTube, Facebook, LinkedIn, and X native metrics are planned for the next analytics pipeline.</span>
                  </div>
                </UiCard>
              </section>

              <UiCard className="analytics-panel" padding="md">
                <div className="analytics-panel-header">
                  <div>
                    <h2>Recent content timeline</h2>
                    <p>The latest tracked posts across drafts, scheduled items, and published history.</p>
                  </div>
                </div>

                <UiTable
                  caption="Recent personal content analytics rows"
                  columns={tableColumns}
                  rows={model.recentPosts}
                  rowKey={(post) => post.id}
                  emptyText="No tracked posts yet."
                />
              </UiCard>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
