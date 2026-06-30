// src/components/User/UserSidebar.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  Sparkles,
  Calendar,
  BarChart2,
  Coins,
  Settings,
  Layers,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Image,
  CircleHelp,
  Video,
} from "lucide-react";
import useBrandKitStore from "../../stores/BrandKitStore";
import useHelpStore from "../../stores/HelpStore";
import { BRAND_KIT_STATUS } from "../../constants/statusEnums";
import { useAuth } from "../../Context/AuthContext";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useLogout } from "../../hooks/useLogout";
import HelpPanel from "../HelpPanel/HelpPanel";
const SIDEBAR_COLLAPSE_KEY = "socialai-sidebar-collapsed";

const NAV_ITEMS = [
  {
    section: "Command",
    items: [
      {
        name: "Command Center",
        mobileLabel: "Command",
        path: "/app/dashboard",
        icon: LayoutDashboard,
        mobilePrimary: true,
      },
      {
        name: "AI Studio",
        mobileLabel: "Generate",
        path: "/app/generate",
        icon: Sparkles,
        badge: "AI",
        mobilePrimary: true,
      },
      {
        name: "Content Library",
        mobileLabel: "Library",
        path: "/app/library",
        icon: Image,
        mobilePrimary: true,
      },
      { name: "Video Lab", path: "/app/video/jobs", icon: Video, badge: "BETA" },
    ],
  },
  {
    section: "Publish",
    items: [
      {
        name: "Content Calendar",
        mobileLabel: "Calendar",
        path: "/app/calendar",
        icon: Calendar,
        mobilePrimary: true,
      },
      {
        name: "Insights",
        path: "/app/analytics",
        icon: BarChart2,
        mobilePrimary: true,
      },
      { name: "Credits", path: "/app/billing/credits", icon: Coins },
    ],
  },
  {
    section: "System",
    items: [
      { name: "Settings", path: "/app/settings", icon: Settings },
      { name: "Brand Kit", path: "/app/settings/brand-kit", icon: Layers, badge: "NEW" },
    ],
  },
];

export default function UserSidebar() {
  const { navigate, pathname } = useAppNavigation();
  const { user, profile, isAdmin } = useAuth();
  const brandKitStatus = useBrandKitStore((s) => s.status);
  const brandKitConfigured = brandKitStatus === BRAND_KIT_STATUS.CONFIGURED;
  const loadBrandKit = useBrandKitStore((s) => s.loadBrandKit);
  const helpComplaints = useHelpStore((s) => s.complaints);
  const fetchUserComplaints = useHelpStore((s) => s.fetchUserComplaints);
  const { initiateLogout } = useLogout();
  const [helpOpen, setHelpOpen] = useState(false);
  const helpUnreadCount = useMemo(() => {
    return helpComplaints.reduce((count, item) => (
      ["resolved", "closed"].includes(item.status) && !item.user_notified_at ? count + 1 : count
    ), 0);
  }, [helpComplaints]);

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined" || !window.localStorage) return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
  });

  // Persist collapsed state so sidebar behavior stays consistent across routes.
  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    if (!user?.id) return undefined;

    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(() => {
        loadBrandKit(user.id);
      });

      return () => {
        window.cancelIdleCallback?.(idleId);
      };
    }

    const timeoutId = window.setTimeout(() => {
      loadBrandKit(user.id);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadBrandKit, user?.id]);

  useEffect(() => {
    if (!user?.id) return undefined;
    fetchUserComplaints().catch(() => {});
    return undefined;
  }, [fetchUserComplaints, user?.id]);

  const handleLogout = () => initiateLogout();

  const isActive = (path) => {
    if (path === "/app/settings") return pathname === path;
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  const initials = profile?.full_name
    ? profile.full_name
        .trim()
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "?";

  return (
    <aside className={`app-sidebar ${collapsed ? "collapsed" : ""}`} aria-label="Main navigation">
      <div className="sidebar-top-controls">
        <button
          className={`sidebar-toggle-btn ${collapsed ? "collapsed" : ""}`}
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          type="button"
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>

      <div className="sidebar-user">
        <div className="sidebar-user-avatar">
          {profile?.avatar_url ? <img src={profile.avatar_url} alt="Your avatar" /> : initials}
        </div>

        {!collapsed && (
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{profile?.full_name ?? "Creator"}</span>
            <span className="sidebar-user-role">
              {isAdmin ? "Admin command access" : "Personal command"}
            </span>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="sidebar-command-card" aria-label="Workspace status">
          <span className="sidebar-command-icon" aria-hidden="true">
            <Sparkles size={16} />
          </span>
          <span className="sidebar-command-copy">
            <span className="sidebar-command-title">Content OS</span>
            <span className="sidebar-command-sub">Generate, schedule, publish</span>
          </span>
          <span className="sidebar-command-status">Ready</span>
        </div>
      )}

      <nav className="sidebar-nav" aria-label="Sidebar navigation">
        {NAV_ITEMS.map(({ section, items }) => (
          <div key={section}>
            {!collapsed && <span className="sidebar-section-label">{section}</span>}
            {collapsed && <div className="sidebar-section-gap" />}

            {items.map(({ name, mobileLabel, path, icon: Icon, badge, mobilePrimary }) => (
              <button
                key={name}
                className={`sidebar-nav-item ${isActive(path) ? "active" : ""}`}
                onClick={() => navigate(path)}
                title={collapsed ? name : undefined}
                aria-current={isActive(path) ? "page" : undefined}
                data-mobile-nav={mobilePrimary ? "primary" : "secondary"}
                type="button"
              >
                <span className="nav-icon">
                  <Icon size={17} aria-hidden="true" />
                </span>

                {!collapsed && (
                  <>
                    <span className="nav-label">
                      <span className="nav-label-full">{name}</span>
                      <span className="nav-label-short">{mobileLabel ?? name}</span>
                    </span>
                    {name === "Brand Kit" && !brandKitConfigured && (
                      <span
                        className="nav-status-dot incomplete"
                        aria-label="Brand Kit not configured"
                        title="Complete your Brand Kit for better results"
                      />
                    )}
                    {badge && <span className="nav-badge">{badge}</span>}
                  </>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button
          className="sidebar-nav-item"
          onClick={() => setHelpOpen(true)}
          title={collapsed ? "Help & Support" : undefined}
          aria-label="Help & Support"
          type="button"
        >
          <span className="nav-icon">
            <CircleHelp size={17} aria-hidden="true" />
          </span>
          {!collapsed && <span className="nav-label">Help & Support</span>}
          {helpUnreadCount > 0 && <span className="nav-badge">{helpUnreadCount > 9 ? "9+" : helpUnreadCount}</span>}
        </button>

        <button
          className="sidebar-logout-btn"
          onClick={handleLogout}
          title={collapsed ? "Sign out" : undefined}
          aria-label="Sign out"
          type="button"
        >
          <span className="nav-icon">
            <LogOut size={17} aria-hidden="true" />
          </span>
          {!collapsed && <span className="nav-label">Sign out</span>}
        </button>
      </div>

      {helpOpen ? <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} /> : null}
    </aside>
  );
}
