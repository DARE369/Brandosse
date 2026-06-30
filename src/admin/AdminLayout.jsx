"use client";

import React, { useEffect, useState } from "react";
import { Toaster } from "react-hot-toast";
import AdminNavbar from "./components/AdminNavbar/AdminNavbar";
import AdminSidebar from "./components/AdminSidebar/AdminSidebar";
import { AdminLayoutProvider } from "./AdminLayoutContext";
import { useAppNavigation } from "../Context/AppNavigationContext";
import useAdminAccess from "./hooks/useAdminAccess";
import useLocalPersist from "./hooks/useLocalPersist";
const MOBILE_QUERY = "(max-width: 1024px)";
const SIDEBAR_PREF_KEY = "admin-sidebar-collapsed";

function getInitialMobileState() {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}

export default function AdminLayout({ children }) {
  const { location } = useAppNavigation();
  const { loading, access } = useAdminAccess();
  const [collapsed, setCollapsed] = useLocalPersist(SIDEBAR_PREF_KEY, false);
  const [isMobile, setIsMobile] = useState(getInitialMobileState);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const media = window.matchMedia(MOBILE_QUERY);
    const onChange = (event) => {
      setIsMobile(event.matches);
      if (!event.matches) {
        setMobileOpen(false);
      }
    };

    setIsMobile(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const sidebarCollapsed = isMobile ? false : Boolean(collapsed);
  const sidebarOpen = isMobile ? mobileOpen : true;

  const handleToggleCollapse = () => {
    if (isMobile) {
      setMobileOpen((current) => !current);
      return;
    }

    setCollapsed((current) => !current);
  };

  const handleCloseMobileSidebar = () => {
    if (isMobile) setMobileOpen(false);
  };

  return (
    <div
      className={[
        "admin-shell",
        sidebarCollapsed ? "sidebar-collapsed" : "sidebar-expanded",
        sidebarOpen ? "sidebar-open" : "sidebar-closed",
        isMobile ? "admin-shell-mobile" : "admin-shell-desktop",
      ].join(" ")}
    >
      <AdminNavbar
        access={access}
        loading={loading}
        isMobile={isMobile}
        onToggleSidebar={isMobile ? handleToggleCollapse : undefined}
      />

      <AdminSidebar
        access={access}
        collapsed={sidebarCollapsed}
        isMobile={isMobile}
        isOpen={sidebarOpen}
        loading={loading}
        onToggleCollapse={handleToggleCollapse}
        onNavigate={handleCloseMobileSidebar}
      />

      {isMobile && sidebarOpen ? (
        <button
          type="button"
          className="admin-sidebar-backdrop"
          aria-label="Close navigation panel"
          onClick={handleCloseMobileSidebar}
        />
      ) : null}

      <main className="admin-content">
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 5000,
            style: {
              borderRadius: "14px",
              border: "1px solid var(--admin-border-strong)",
              background: "var(--admin-panel-2)",
              color: "var(--admin-text-1)",
              boxShadow: "var(--admin-shadow-md)",
            },
          }}
        />
        <AdminLayoutProvider value={{ adminAccess: access }}>
          <React.Fragment key={location.pathname}>{children}</React.Fragment>
        </AdminLayoutProvider>
      </main>
    </div>
  );
}
