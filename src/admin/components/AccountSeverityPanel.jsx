import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import { supabase } from '../../services/supabaseClient';
import { formatRelativeTime } from '../utils/formatDate';
function buildReferenceLabel(alert, orgMap, userMap) {
  if (alert.organization_id) {
    const org = orgMap.get(alert.organization_id);
    return `Org: ${org?.name || alert.organization_id}`;
  }

  if (alert.user_id) {
    const profile = userMap.get(alert.user_id);
    return `User: ${profile?.full_name || profile?.email || alert.user_id}`;
  }

  return 'User/Org unavailable';
}

export default function AccountSeverityPanel({ enabled = false }) {
  const { navigate } = useAppNavigation();
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState([]);
  const [orgMap, setOrgMap] = useState(new Map());
  const [userMap, setUserMap] = useState(new Map());

  useEffect(() => {
    let active = true;
    if (!enabled) {
      setAlerts([]);
      setLoading(false);
      return undefined;
    }

    async function load() {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('account_severity_alerts')
          .select('id, connected_account_id, user_id, organization_id, severity, alert_type, platform, account_display_name, failure_count, message, created_at')
          .eq('is_resolved', false)
          .order('created_at', { ascending: false })
          .limit(5);

        if (error) throw error;

        const rows = data || [];
        const orgIds = [...new Set(rows.map((row) => row.organization_id).filter(Boolean))];
        const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];

        const [orgsResult, usersResult] = await Promise.all([
          orgIds.length > 0
            ? supabase.from('organizations').select('id, name').in('id', orgIds)
            : { data: [], error: null },
          userIds.length > 0
            ? supabase.from('profiles').select('id, full_name, email').in('id', userIds)
            : { data: [], error: null },
        ]);

        if (orgsResult.error) throw orgsResult.error;
        if (usersResult.error) throw usersResult.error;

        if (!active) return;
        setAlerts(rows);
        setOrgMap(new Map((orgsResult.data || []).map((org) => [org.id, org])));
        setUserMap(new Map((usersResult.data || []).map((profile) => [profile.id, profile])));
      } catch (error) {
        if (!active) return;
        console.error('Failed to load account severity alerts:', error);
        setAlerts([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    const channel = supabase
      .channel('account-severity-alerts-stage4')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'account_severity_alerts',
        },
        () => {
          void load();
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [enabled]);

  if (!enabled || loading || alerts.length === 0) {
    return null;
  }

  return (
    <section className="admin-account-alert-panel">
      <div className="admin-account-alert-header">
        <div>
          <span className="health-widget-kicker">Account Alerts</span>
          <h3>{alerts.length} connected account alert{alerts.length === 1 ? '' : 's'} require attention</h3>
        </div>
        <button
          type="button"
          className="health-widget-action"
          onClick={() => navigate('/app/admin/logs?source=connection_events')}
        >
          View all
          <ArrowUpRight size={14} />
        </button>
      </div>

      <div className="admin-account-alert-list">
        {alerts.map((alert) => (
          <div key={alert.id} className={`admin-account-alert-row severity-${alert.severity}`.trim()}>
            <div className="admin-account-alert-copy">
              <span className={`admin-account-alert-badge severity-${alert.severity}`.trim()}>
                <AlertTriangle size={12} />
                {String(alert.severity || 'warning').toUpperCase()}
              </span>
              <strong>{alert.message}</strong>
              <small>
                {buildReferenceLabel(alert, orgMap, userMap)} | {alert.platform} | {formatRelativeTime(alert.created_at)}
              </small>
            </div>
            <button
              type="button"
              className="admin-account-alert-action"
              onClick={() => navigate(`/app/admin/logs?source=connection_events&accountId=${alert.connected_account_id}`)}
            >
              Investigate
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
