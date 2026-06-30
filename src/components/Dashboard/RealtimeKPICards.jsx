import React from 'react';
import { Activity, CalendarDays, FileImage, Zap } from 'lucide-react';
import { useAuth } from '../../Context/AuthContext';
import { useRealtimeKPIs } from '../../hooks/useRealtimeKPIs';

const KPI_CONFIG = [
  {
    key: 'totalGenerated',
    label: 'Total Generated',
    icon: FileImage,
    tone: 'brand',
  },
  {
    key: 'scheduledPosts',
    label: 'Scheduled Posts',
    icon: CalendarDays,
    tone: 'accent',
  },
  {
    key: 'published',
    label: 'Published',
    icon: Activity,
    tone: 'signal',
  },
  {
    key: 'creditsLeft',
    label: 'Credits Left',
    icon: Zap,
    tone: 'danger',
  },
];

function KPISkeletonCard() {
  return (
    <div className="rtk-kpi-card rtk-kpi-card--skeleton">
      <div className="rtk-kpi-skeleton-icon" />
      <div className="rtk-kpi-skeleton-value" />
      <div className="rtk-kpi-skeleton-label" />
    </div>
  );
}

export default function RealtimeKPICards({ userId: userIdProp }) {
  const { user } = useAuth();
  const userId = userIdProp ?? user?.id ?? null;
  const { kpis, isLoading } = useRealtimeKPIs(userId);

  if (isLoading) {
    return (
      <div className="rtk-kpi-grid">
        {KPI_CONFIG.map((config) => (
          <KPISkeletonCard key={config.key} />
        ))}
      </div>
    );
  }

  return (
    <div className="rtk-kpi-grid">
      {KPI_CONFIG.map((config) => {
        const Icon = config.icon;
        const value = Number(kpis?.[config.key] ?? 0).toLocaleString();

        return (
          <div key={config.key} className="rtk-kpi-card" data-tone={config.tone}>
            <div className="rtk-kpi-card-header">
              <div className="rtk-kpi-icon">
                <Icon size={18} />
              </div>
              <span className="rtk-kpi-live-dot" title="Real-time data" aria-label="Live" />
            </div>
            <div className="rtk-kpi-value">{value}</div>
            <div className="rtk-kpi-label">{config.label}</div>
          </div>
        );
      })}
    </div>
  );
}
