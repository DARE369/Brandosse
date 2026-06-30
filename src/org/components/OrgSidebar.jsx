import React, { useEffect, useState } from 'react';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import {
  Activity,
  Archive,
  Calendar,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Home,
  LayoutDashboard,
  MessageSquare,
  Palette,
  Settings,
  Shield,
  Users,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import useOrgContext from '../hooks/useOrgContext';
import usePipelineTaskBadgeCount from '../hooks/usePipelineTaskBadgeCount';

function buildNavItems({
  organizationId,
  isOrgAdmin,
  canEdit,
  pipelineBadgeCount = 0,
}) {
  const base = [
    { label: 'My Workspace', path: `/app/org/${organizationId}/workspace`, icon: Home },
    { label: 'My Office', path: `/app/org/${organizationId}/office`, icon: LayoutDashboard },
    {
      label: 'Pipeline',
      path: `/app/org/${organizationId}/pipeline`,
      icon: GitBranch,
      badgeCount: Number(pipelineBadgeCount) > 0 ? pipelineBadgeCount : 0,
    },
    { label: 'Calendar', path: `/app/org/${organizationId}/calendar`, icon: Calendar },
    { label: 'Asset Library', path: `/app/org/${organizationId}/library`, icon: Archive },
    { label: 'Common Room', path: `/app/org/${organizationId}/common-room`, icon: MessageSquare },
  ];

  if (isOrgAdmin) {
    base.unshift({ label: 'Overview', path: `/app/org/${organizationId}/overview`, icon: Activity });
  }

  if (canEdit) {
    base.push({ label: 'Team Activity', path: `/app/org/${organizationId}/team-activity`, icon: Activity });
  }

  const admin = isOrgAdmin ? [
    { label: 'Members', path: `/app/org/${organizationId}/admin/members`, icon: Users },
    { label: 'Brand Kit', path: `/app/org/${organizationId}/admin/brand-kit`, icon: Palette },
    { label: 'Roles & Permissions', path: `/app/org/${organizationId}/admin/roles`, icon: Shield },
    { label: 'Pipelines', path: `/app/org/${organizationId}/admin/pipelines`, icon: Workflow },
    { label: 'Credit Management', path: `/app/org/${organizationId}/admin/credits`, icon: Zap },
    { label: 'Org Settings', path: `/app/org/${organizationId}/admin/settings`, icon: Settings },
  ] : [];

  return { base, admin };
}

export default function OrgSidebar({
  mobileOpen = false,
  onCloseMobile,
  onNavigate,
}) {
  const { navigate, location } = useAppNavigation();
  const { organizationId, organization, isOrgAdmin, role } = useOrgContext();
  const pipelineBadgeCount = usePipelineTaskBadgeCount();
  const [collapsed, setCollapsed] = useState(false);
  const storageKey = `org-sidebar-${organizationId || 'workspace'}-collapsed`;
  const roleLabel = String(role || 'member').replace(/_/g, ' ');
  const effectiveCollapsed = collapsed && !mobileOpen;

  useEffect(() => {
    setCollapsed(localStorage.getItem(storageKey) === '1');
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, collapsed ? '1' : '0');
  }, [collapsed, storageKey]);

  const nav = buildNavItems({
    organizationId,
    isOrgAdmin,
    canEdit: ['org_owner', 'org_admin', 'editor'].includes(role),
    pipelineBadgeCount,
  });

  const renderItem = (item) => {
    const Icon = item.icon;
    const active = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);

    return (
      <button
        key={item.path}
        type="button"
        className={`org-sidebar-link ${active ? 'active' : ''}`}
        onClick={() => {
          navigate(item.path);
          onNavigate?.();
        }}
        title={effectiveCollapsed ? item.label : undefined}
      >
        <Icon size={16} aria-hidden="true" />
        {effectiveCollapsed ? null : <span>{item.label}</span>}
        {item.badgeCount > 0 ? (
          <small className={`org-sidebar-link-badge ${effectiveCollapsed ? 'collapsed' : ''}`.trim()}>
            {item.badgeCount > 99 ? '99+' : item.badgeCount}
          </small>
        ) : null}
      </button>
    );
  };

  return (
    <aside className={`org-sidebar ${effectiveCollapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`.trim()}>
      <div className="org-sidebar-top-controls">
        <button
          type="button"
          className={`org-sidebar-collapse ${mobileOpen ? 'mobile-close' : ''}`.trim()}
          onClick={() => {
            if (mobileOpen) {
              onCloseMobile?.();
              return;
            }
            setCollapsed((value) => !value);
          }}
          aria-label={mobileOpen ? 'Close organization navigation' : effectiveCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {mobileOpen ? <X size={15} /> : effectiveCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>

      <div className="org-sidebar-header">
        <div className="org-sidebar-brand">
          <span className="org-sidebar-brand-mark">SA</span>
          <div className="org-sidebar-brand-copy">
            <span className="org-sidebar-brand-name">SocialAI</span>
            <span className="org-sidebar-brand-badge">Org Workspace</span>
          </div>
        </div>
      </div>

      <div className="org-sidebar-scope-card">
        <span className="org-sidebar-section-title">Current org</span>
        <strong>{organization?.name || 'Organization'}</strong>
        {effectiveCollapsed ? null : <p>{roleLabel}</p>}
      </div>

      <nav className="org-sidebar-nav">
        {nav.base.map(renderItem)}
      </nav>

      {nav.admin.length ? (
        <div className="org-sidebar-admin">
          {effectiveCollapsed ? null : <span className="org-sidebar-section-title">Admin</span>}
          {nav.admin.map(renderItem)}
        </div>
      ) : null}
    </aside>
  );
}
