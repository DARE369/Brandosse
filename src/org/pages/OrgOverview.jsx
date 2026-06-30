"use client";

import React, { useMemo } from 'react';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import OrgStatCard from '../components/OrgStatCard';
import OrgEmptyState from '../components/OrgEmptyState';
import OrgAccountHealthCard from '../components/OrgAccountHealthCard';
import useOrgAssets from '../hooks/useOrgAssets';
import useOrgCalendar from '../hooks/useOrgCalendar';
import useOrgContext from '../hooks/useOrgContext';
import { buildDeepLink } from '../../utils/buildDeepLink';

function formatSchedule(value) {
  if (!value) return 'No schedule';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function OrgOverview() {
  const { navigate } = useAppNavigation();
  const { organizationId, organization, isOrgAdmin, role } = useOrgContext();
  const { posts, approvedQueue, pipelineItems, stats, loading } = useOrgCalendar();
  const { assets, loading: assetsLoading } = useOrgAssets();

  const upcomingSchedule = useMemo(() => {
    const now = new Date();
    return posts
      .filter((post) => post.scheduled_at && new Date(post.scheduled_at) >= now)
      .sort((left, right) => new Date(left.scheduled_at) - new Date(right.scheduled_at))
      .slice(0, 5);
  }, [posts]);

  const bottlenecks = useMemo(() => {
    return Array.isArray(stats.bottleneckLanes)
      ? stats.bottleneckLanes.slice(0, 3)
      : [];
  }, [stats.bottleneckLanes]);

  const adminCards = [
    {
      title: 'Active Members',
      value: stats.activeMembers,
      subtitle: 'Members with org access',
    },
    {
      title: 'Scheduled This Week',
      value: stats.scheduledThisWeek,
      subtitle: 'Calendar-ready content across the team',
      tone: 'warning',
      onClick: () => navigate(`/app/org/${organizationId}/calendar`),
    },
    {
      title: 'Approved Queue',
      value: stats.approvedQueueCount,
      subtitle: 'Approved items waiting for placement',
      tone: 'success',
      onClick: () => navigate(`/app/org/${organizationId}/calendar`),
    },
    {
      title: 'Recent Assets',
      value: stats.recentAssetCount,
      subtitle: 'Assets added in the last 7 days',
      onClick: () => navigate(`/app/org/${organizationId}/library`),
    },
  ];

  const memberCards = [
    {
      title: 'Awaiting Feedback',
      value: pipelineItems.filter((item) => ['pending', 'in_review'].includes(item.status)).length,
      subtitle: 'Items moving through review',
      tone: 'warning',
      onClick: () => {
        const target = buildDeepLink({
          path: `/app/org/${organizationId}/pipeline`,
          source: 'org_overview',
          target: 'org_pipeline',
        });
        navigate(target.path, { state: target.state });
      },
    },
    {
      title: 'Scheduled This Week',
      value: stats.scheduledThisWeek,
      subtitle: 'Upcoming content across the workspace',
      onClick: () => navigate(`/app/org/${organizationId}/calendar`),
    },
    {
      title: 'Ready to Schedule',
      value: stats.approvedQueueCount,
      subtitle: 'Approved items ready for the calendar',
      tone: 'success',
      onClick: () => navigate(`/app/org/${organizationId}/calendar`),
    },
  ];

  return (
    <section className="org-page">
      <div className="org-page-header">
        <div>
          <h1>{organization?.name || 'Organization'} Overview</h1>
          <p>Track the schedule, workload, and collaboration pressure across the workspace.</p>
        </div>
      </div>

      <div className="org-stat-grid">
        {(isOrgAdmin ? adminCards : memberCards).map((card) => (
          <OrgStatCard key={card.title} {...card} />
        ))}
      </div>

      {isOrgAdmin ? (
        <OrgAccountHealthCard
          organizationId={organizationId}
          onManage={() => navigate(`/app/org/${organizationId}/admin/settings`)}
        />
      ) : null}

      <div className="org-two-column">
        <div className="org-panel">
          <div className="org-panel-header">
            <div>
              <h3>Upcoming Schedule</h3>
              <p>The next items already placed on the team calendar.</p>
            </div>
            <button
              type="button"
              className="org-text-button"
              onClick={() => navigate(`/app/org/${organizationId}/calendar`)}
            >
              Open Calendar
            </button>
          </div>

          {loading ? (
            <div className="org-panel-loading">Loading schedule...</div>
          ) : upcomingSchedule.length === 0 ? (
            <OrgEmptyState
              eyebrow="Calendar"
              title="Nothing scheduled yet"
              description="Approved items and scheduled posts will show up here once the team starts placing work on the ops calendar."
            />
          ) : (
            <div className="org-activity-list">
              {upcomingSchedule.map((post) => (
                <div key={post.id} className="org-activity-item">
                  <div>
                    <strong>{post.caption || post.media?.prompt || 'Untitled post'}</strong>
                    <span>
                      {formatSchedule(post.scheduled_at)} | {post.member?.profile?.full_name || post.member?.profile?.email || 'Team member'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="org-text-button"
                    onClick={() => navigate(`/app/org/${organizationId}/calendar`)}
                  >
                    View
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="org-panel">
          <div className="org-panel-header">
            <div>
              <h3>{isOrgAdmin ? 'Ops Pulse' : 'Workspace Pulse'}</h3>
              <p>{isOrgAdmin ? 'Bottlenecks, approvals, and asset activity.' : `Current role: ${String(role || 'member').replace(/_/g, ' ')}`}</p>
            </div>
          </div>

          {loading ? (
            <div className="org-panel-loading">Loading insights...</div>
          ) : (
            <div className="org-note-list">
              <div className="org-note-card">
                <strong>{stats.approvedQueueCount} approved items waiting</strong>
                <p>Use the team calendar to place them into the schedule without leaving the org workspace.</p>
              </div>

              <div className="org-note-card">
                <strong>{stats.inReviewCount} items still in review</strong>
                <p>Pipeline pressure is currently highest in {bottlenecks[0]?.label || 'active stages'}.</p>
              </div>

              <div className="org-note-card">
                <strong>{assetsLoading ? '...' : assets.length} library assets available</strong>
                <p>{stats.recentAssetCount} were added in the last 7 days, keeping the shared library current.</p>
              </div>

              {bottlenecks.length ? (
                <div className="org-note-card">
                  <strong>Top bottlenecks</strong>
                  <p>
                    {bottlenecks
                      .map((lane) => `${lane.label} (score ${lane.pressureScore})`)
                      .join(' | ')}
                  </p>
                </div>
              ) : null}

              {approvedQueue.length === 0 && pipelineItems.length === 0 ? (
                <OrgEmptyState
                  eyebrow="Workspace"
                  title="You're all caught up"
                  description="As the team submits work and moves content through approvals, the overview pulse will fill in here."
                />
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
