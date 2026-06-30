import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Menu, Repeat2, Search, ShieldCheck } from "lucide-react";
import { supabase } from "../../../services/supabaseClient";
import { useAuth } from "../../../Context/AuthContext";
import { useAppNavigation } from "../../../Context/AppNavigationContext";
import WorkspaceSwitcherMenu from "../../../components/Shared/WorkspaceSwitcherMenu";
import AdminNotificationCenter from "../AdminNotificationCenter";
import AdminProfileMenu from "../AdminProfileMenu";
import useDebouncedValue from "../../hooks/useDebouncedValue";
import {
  acknowledgeNotification,
  fetchAdminNotifications,
  markNotificationRead,
  resolveInitials,
  searchAdminWorkspace,
} from "../../utils/adminClient";
import { ADMIN_NOTIFICATION_TYPE } from "../../../constants/statuses";

function getHeader(pathname) {
  if (pathname.startsWith("/app/admin/users/")) {
    return {
      placeholder: "Search users, posts, or complaints",
    };
  }

  if (pathname.startsWith("/app/admin/users")) {
    return {
      placeholder: "Search users, email, or organization",
    };
  }

  if (pathname.startsWith("/app/admin/organizations")) {
    return {
      placeholder: "Search organizations or owners",
    };
  }

  if (pathname.startsWith("/app/admin/moderation")) {
    return {
      placeholder: "Search posts, captions, or moderation state",
    };
  }

  if (pathname.startsWith("/app/admin/complaints")) {
    return {
      placeholder: "Search complaints or linked users",
    };
  }

  if (pathname.startsWith("/app/admin/analytics")) {
    return {
      placeholder: "Search metrics, orgs, or users",
    };
  }

  if (pathname.startsWith("/app/admin/logs")) {
    return {
      placeholder: "Search event type, entity, or correlation id",
    };
  }

  if (pathname.startsWith("/app/admin/settings")) {
    return {
      placeholder: "Search settings",
    };
  }

  return {
    placeholder: "Search users, posts, or complaints",
  };
}

export default function AdminNavbar({ access, loading, isMobile = false, onToggleSidebar = null }) {
  const { location, navigate } = useAppNavigation();
  const { availableWorkspaces = [], activeWorkspace, switchWorkspace } = useAuth();
  const header = useMemo(() => getHeader(location.pathname), [location.pathname]);
  const [searchValue, setSearchValue] = useState("");
  const debouncedSearch = useDebouncedValue(searchValue, 250);
  const [results, setResults] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);
  const actionsRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    async function loadNotifications() {
      if (!access?.isAdmin) return;
      const rows = await fetchAdminNotifications({ limit: 16 });
      if (mounted) setNotifications(rows);
    }

    loadNotifications();
    return () => {
      mounted = false;
    };
  }, [access?.isAdmin, access?.organizationId, access?.user?.id]);

  useEffect(() => {
    if (!access?.isAdmin || !access?.user?.id) return undefined;

    const channel = supabase
      .channel(`admin-navbar-notifications-${access.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "admin_notifications" }, async () => {
        const rows = await fetchAdminNotifications({ limit: 16 });
        setNotifications(rows);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [access?.isAdmin, access?.user?.id]);

  useEffect(() => {
    let mounted = true;

    async function runSearch() {
      if (!debouncedSearch.trim() || !access?.isAdmin) {
        setResults([]);
        return;
      }

      const matches = await searchAdminWorkspace(debouncedSearch, access);
      if (mounted) {
        setResults(matches);
        setSearchOpen(true);
      }
    }

    runSearch();
    return () => {
      mounted = false;
    };
  }, [access, debouncedSearch]);

  useEffect(() => {
    const handleClickAway = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setSearchOpen(false);
      }
      if (actionsRef.current && !actionsRef.current.contains(event.target)) {
        setNotificationOpen(false);
        setProfileOpen(false);
        setWorkspaceOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickAway);
    return () => document.removeEventListener("mousedown", handleClickAway);
  }, []);

  const unreadCount = notifications.filter((item) => !item.read).length;
  const initials = resolveInitials(access?.profile?.full_name, access?.profile?.email || access?.user?.email);
  const canSwitchWorkspace = availableWorkspaces.length > 1;

  const refreshNotifications = async () => {
    const refreshed = await fetchAdminNotifications({ limit: 16 });
    setNotifications(refreshed);
  };

  const handleMarkAllRead = async () => {
    await Promise.all(
      notifications
        .filter((notification) => !notification.read)
        .map((notification) => (
          notification.type === ADMIN_NOTIFICATION_TYPE.RISK_ALERT && notification.severity === "very_high"
            ? acknowledgeNotification(notification.id)
            : markNotificationRead(notification.id)
        )),
    );

    refreshNotifications();
  };

  const handleMarkOneRead = async (notificationId) => {
    const target = notifications.find((notification) => notification.id === notificationId);
    if (!target) return;

    if (target.type === ADMIN_NOTIFICATION_TYPE.RISK_ALERT && target.severity === "very_high") {
      await acknowledgeNotification(notificationId);
    } else {
      await markNotificationRead(notificationId);
    }

    refreshNotifications();
  };

  const handleOpenEntity = (notification) => {
    setNotificationOpen(false);

    if (notification.type === ADMIN_NOTIFICATION_TYPE.RISK_ALERT) {
      const domain = notification.domain || notification.metadata?.domain;
      navigate(domain ? `/app/admin/logs?domain=${encodeURIComponent(domain)}&severity=error` : "/app/admin/logs");
      return;
    }

    const complaintId = notification.metadata?.complaint_id || notification.entity_id;
    if (notification.type === ADMIN_NOTIFICATION_TYPE.COMPLAINT_SUBMITTED && complaintId) {
      navigate(`/app/admin/complaints/${complaintId}`);
      return;
    }

    if (notification.entity_type === "complaint" && complaintId) {
      navigate(`/app/admin/complaints/${complaintId}`);
      return;
    }

    if (notification.entity_type === "user" && notification.entity_id) {
      navigate(`/app/admin/users/${notification.entity_id}`);
      return;
    }

    if (notification.entity_type === "organization" && notification.entity_id) {
      navigate(`/app/admin/organizations/${notification.entity_id}`);
      return;
    }

    navigate("/app/admin");
  };

  return (
    <nav className="admin-navbar">
      <div className="admin-navbar-left">
        {isMobile && onToggleSidebar ? (
          <button
            type="button"
            className="admin-nav-icon-btn admin-nav-toggle"
            aria-label="Toggle admin navigation"
            onClick={onToggleSidebar}
          >
            <Menu size={18} />
          </button>
        ) : null}

        <div className="admin-navbar-search-wrap" ref={searchRef}>
          <Search size={16} className="admin-navbar-search-icon" aria-hidden="true" />
          <input
            type="search"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            onFocus={() => setSearchOpen(true)}
            placeholder={header.placeholder}
            className="admin-navbar-search"
            aria-label={header.placeholder}
          />

          {searchOpen && searchValue.trim() ? (
            <div className="admin-search-results">
              {results.length ? (
                results.map((result) => (
                  <button
                    key={`${result.type}-${result.id}`}
                    type="button"
                    className="admin-search-result"
                    onClick={() => {
                      navigate(result.path);
                      setSearchOpen(false);
                      setSearchValue("");
                    }}
                  >
                    <strong>{result.title}</strong>
                    <span>{result.subtitle}</span>
                  </button>
                ))
              ) : (
                <div className="admin-empty-inline">No matches.</div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="admin-navbar-right" ref={actionsRef}>
        <div className="admin-navbar-status" aria-hidden="true">
          <ShieldCheck size={15} />
          {access?.scopeLabel || "Admin scope"}
        </div>

        {canSwitchWorkspace ? (
          <div className="admin-workspace-switcher">
            <button
              type="button"
              className="admin-nav-icon-btn admin-workspace-trigger"
              aria-label="Switch workspace"
              onClick={() => {
                setWorkspaceOpen((current) => !current);
                setNotificationOpen(false);
                setProfileOpen(false);
              }}
            >
              <Repeat2 size={18} />
            </button>

            {workspaceOpen ? (
              <div className="admin-workspace-popover">
                <WorkspaceSwitcherMenu
                  workspaces={availableWorkspaces}
                  activeWorkspace={activeWorkspace}
                  onSelect={async (workspace) => {
                    const nextPath = await switchWorkspace(workspace);
                    setWorkspaceOpen(false);
                    if (nextPath) navigate(nextPath);
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          className="admin-nav-icon-btn admin-notification-trigger"
          aria-label="Open notifications"
          onClick={() => {
            setNotificationOpen((current) => !current);
            setProfileOpen(false);
            setWorkspaceOpen(false);
          }}
        >
          <Bell size={19} />
          {unreadCount ? (
            <span className="admin-notification-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
          ) : null}
        </button>

        <button
          type="button"
          className="admin-navbar-avatar"
          aria-label="Open admin profile menu"
          onClick={() => {
            setProfileOpen((current) => !current);
            setNotificationOpen(false);
            setWorkspaceOpen(false);
          }}
        >
          {loading ? "..." : initials}
        </button>

        <AdminNotificationCenter
          open={notificationOpen}
          notifications={notifications}
          unreadCount={unreadCount}
          onClose={() => setNotificationOpen(false)}
          onMarkAllRead={handleMarkAllRead}
          onMarkOneRead={handleMarkOneRead}
          onOpenEntity={handleOpenEntity}
        />

        <AdminProfileMenu open={profileOpen} access={access} onClose={() => setProfileOpen(false)} />
      </div>
    </nav>
  );
}
