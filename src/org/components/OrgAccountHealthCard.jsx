import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { normalizeConnectedAccountRow } from '../../services/platforms/platformUtils';
function startOfWeek() {
  const date = new Date();
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatRelative(value) {
  if (!value) return 'No publish activity yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No publish activity yet';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function OrgAccountHealthCard({
  organizationId,
  onManage,
}) {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [accountActivity, setAccountActivity] = useState(new Map());
  const [weeklyPublishedCount, setWeeklyPublishedCount] = useState(0);

  useEffect(() => {
    let active = true;
    if (!organizationId) {
      setAccounts([]);
      setAccountActivity(new Map());
      setWeeklyPublishedCount(0);
      setLoading(false);
      return undefined;
    }

    async function load() {
      setLoading(true);
      try {
        const { data: accountRows, error: accountError } = await supabase
          .from('connected_accounts')
          .select('id, platform, display_name, account_name, username, connection_status, health_score, consecutive_failure_count, last_failure_reason, last_successful_publish_at, total_posts_published, organization_id, scope')
          .eq('organization_id', organizationId)
          .eq('scope', 'organization')
          .order('created_at', { ascending: true });

        if (accountError) throw accountError;

        const normalized = (accountRows || [])
          .map(normalizeConnectedAccountRow)
          .filter((account) => account && account.semantic_status !== 'disconnected');

        const accountIds = normalized.map((account) => account.id);
        let activityMap = new Map();
        let weekCount = 0;

        if (accountIds.length > 0) {
          const { data: posts, error: postsError } = await supabase
            .from('posts')
            .select('account_id, user_id, published_at, status')
            .eq('organization_id', organizationId)
            .eq('status', 'published')
            .in('account_id', accountIds)
            .order('published_at', { ascending: false });

          if (postsError) throw postsError;

          const weekStart = startOfWeek();
          const uniqueUserIds = [...new Set((posts || []).map((post) => post.user_id).filter(Boolean))];
          const { data: profiles, error: profilesError } = uniqueUserIds.length > 0
            ? await supabase.from('profiles').select('id, full_name, email').in('id', uniqueUserIds)
            : { data: [], error: null };

          if (profilesError) throw profilesError;

          const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
          weekCount = (posts || []).filter((post) => post.published_at && new Date(post.published_at) >= weekStart).length;

          activityMap = new Map();
          for (const post of posts || []) {
            if (!activityMap.has(post.account_id)) {
              const profile = profileMap.get(post.user_id);
              activityMap.set(post.account_id, {
                lastPublishedAt: post.published_at,
                lastPublishedBy: profile?.full_name || profile?.email || 'Team member',
              });
            }
          }
        }

        if (!active) return;
        setAccounts(normalized);
        setAccountActivity(activityMap);
        setWeeklyPublishedCount(weekCount);
      } catch (error) {
        if (!active) return;
        console.error('Failed to load org account health:', error);
        setAccounts([]);
        setAccountActivity(new Map());
        setWeeklyPublishedCount(0);
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [organizationId]);

  const issues = useMemo(
    () => accounts.filter((account) => account.semantic_status !== 'connected' || Number(account.consecutive_failure_count || 0) > 0),
    [accounts],
  );

  return (
    <article className="health-widget-card org-account-health-card">
      <div className="health-widget-header">
        <div>
          <span className="health-widget-kicker">Org Account Health</span>
          <h3>Shared publishing accounts</h3>
        </div>
        <button type="button" className="health-widget-action" onClick={onManage}>
          Manage
          <ArrowUpRight size={14} />
        </button>
      </div>

      {loading ? (
        <div className="health-widget-empty">
          <Loader2 size={18} className="spin-indicator" />
          <span>Loading org account health…</span>
        </div>
      ) : accounts.length === 0 ? (
        <div className="health-widget-empty">
          <AlertTriangle size={18} />
          <div>
            <strong>No org-scoped accounts connected</strong>
            <p>Connect shared mock accounts from Org Settings to unlock shared publishing destinations.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="health-widget-summary">
            <div className={`health-widget-pill ${issues.length > 0 ? 'issue' : 'healthy'}`.trim()}>
              {issues.length > 0 ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
              <span>
                {issues.length > 0
                  ? `${issues.length} org account${issues.length === 1 ? '' : 's'} need attention`
                  : 'All org accounts healthy'}
              </span>
            </div>
            <small>{weeklyPublishedCount} publishes this week</small>
          </div>

          <div className="health-widget-meta-row">
            <div>
              <span>Org accounts</span>
              <strong>{accounts.length}</strong>
            </div>
            <div>
              <span>Healthy</span>
              <strong>{accounts.length - issues.length}</strong>
            </div>
            <div>
              <span>Weekly activity</span>
              <strong>{weeklyPublishedCount}</strong>
            </div>
          </div>

          <div className="org-account-health-list">
            {accounts.slice(0, 4).map((account) => {
              const activity = accountActivity.get(account.id);
              return (
                <div key={account.id} className="org-account-health-row">
                  <div>
                    <strong>{account.display_name || account.account_name || account.username || account.platform}</strong>
                    <span>{account.platform}</span>
                  </div>
                  <div className="org-account-health-row-meta">
                    <span className={`health-widget-inline-status ${account.semantic_status !== 'connected' || Number(account.consecutive_failure_count || 0) > 0 ? 'issue' : 'healthy'}`.trim()}>
                      {Number(account.health_score || 100)}%
                    </span>
                    <span>
                      {activity?.lastPublishedBy || 'No publisher yet'} · {formatRelative(activity?.lastPublishedAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </article>
  );
}
