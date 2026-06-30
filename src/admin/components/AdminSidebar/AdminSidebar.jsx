import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  MessagesSquare,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Wifi,
} from "lucide-react";
import { getAdminNavItems } from "../../utils/rbac";

const ICON_MAP = {
  "layout-dashboard": LayoutDashboard,
  users: Users,
  "building-2": Building2,
  "shield-check": ShieldCheck,
  "messages-square": MessagesSquare,
  wifi: Wifi,
  "bar-chart-3": BarChart3,
  "scroll-text": ScrollText,
  settings: Settings,
};

export default function AdminSidebar({
  access,
  collapsed,
  isMobile,
  isOpen,
  loading,
  onToggleCollapse,
  onNavigate,
}) {
  const pathname = usePathname();
  const navItems = getAdminNavItems(access?.adminRole);
  const isActive = (path) => (
    path === "/app/admin"
      ? pathname === path
      : pathname === path || pathname?.startsWith(`${path}/`)
  );

  return (
    <aside
      className={[
        "admin-sidebar",
        collapsed ? "collapsed" : "",
        isMobile ? "mobile" : "",
        isOpen ? "open" : "closed",
      ].join(" ")}
      aria-label="Admin navigation"
    >
      <div className="admin-sidebar-header">
        <div className="admin-sidebar-header-row">
          <div className="admin-sidebar-brand">
            <span className="admin-sidebar-brand-mark">SA</span>
            <div className="admin-sidebar-brand-copy">
              <span className="admin-sidebar-brand-name">SocialAI</span>
              <span className="admin-sidebar-brand-badge">Admin Workspace</span>
            </div>
          </div>

          <button
            type="button"
            className={`sidebar-toggle-btn ${collapsed || (isMobile && !isOpen) ? "collapsed" : ""}`}
            onClick={onToggleCollapse}
            aria-label={collapsed || (isMobile && !isOpen) ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed || (isMobile && !isOpen) ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed || (isMobile && !isOpen) ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        </div>
      </div>

      {access?.isOrgAdmin ? (
        <div className="admin-sidebar-scope-card">
          <span className="admin-section-label">Current org</span>
          <strong>{access.organization?.name || "Scoped organization"}</strong>
          {!collapsed ? <p>{access.scopeLabel}</p> : null}
        </div>
      ) : null}

      <nav className="admin-sidebar-nav">
        {loading ? <div className="admin-empty-inline">Loading navigation…</div> : null}
        {navItems.map((item) => {
          const Icon = ICON_MAP[item.icon] || LayoutDashboard;

          return (
            <Link
              key={item.path}
              href={item.path}
              data-tooltip={item.label}
              className={`admin-sidebar-link${isActive(item.path) ? " active" : ""}`}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              aria-current={isActive(item.path) ? "page" : undefined}
            >
              <span className="admin-sidebar-link-icon" aria-hidden="true">
                <Icon size={17} />
              </span>
              <span className="admin-sidebar-link-copy">
                <span className="admin-sidebar-link-label">{item.label}</span>
                <span className="admin-sidebar-link-description">{item.description}</span>
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
