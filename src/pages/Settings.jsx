"use client";

// src/pages/Settings.jsx
// ui-v2 rebuild of Settings (see docs mockup "Settings.dc.html"). Existing
// tabs (Profile/Preferences/Notifications/Connected Accounts/Organization
// Accounts) are real and untouched at the data layer — only the shell around
// them changed. Three new tabs close the mockup gap: Content defaults,
// Security, Data & privacy (see ContentDefaultsTab/SecurityTab/DataPrivacyTab).
import { useEffect, useState } from "react";
import { useAuth } from "../Context/AuthContext";
import { useAppNavigation } from "../Context/AppNavigationContext";
import { useCreditBalance } from "../hooks/useCreditBalance";
import {
  UiV2ThemeProvider, useUiV2Theme, AppHeader, CreditPill, IconButton,
  Card, Skeleton, Button, MobileNavDrawer, NotificationBell, AvatarMenu,
} from "../ui-v2";
import PersonalSettingsFoundationTab from "./Settings/PersonalSettingsFoundationTab";
import ConnectedAccountsTab from "./Settings/ConnectedAccountsTab";
import OrgAccountsReadOnlyTab from "./Settings/OrgAccountsReadOnlyTab";
import ContentDefaultsTab from "./Settings/ContentDefaultsTab";
import SecurityTab from "./Settings/SecurityTab";
import DataPrivacyTab from "./Settings/DataPrivacyTab";
import styles from "./Settings.module.css";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", href: "/app/dashboard" },
  { key: "studio", label: "Studio", href: "/app/generate" },
  { key: "library", label: "Library", href: "/app/library" },
  { key: "calendar", label: "Calendar", href: "/app/calendar" },
  { key: "analytics", label: "Analytics", href: "/app/analytics" },
  { key: "brand-kit", label: "Brand Kit", href: "/app/settings/brand-kit" },
];

function ThemeToggleButton() {
  const { isDark, toggleTheme } = useUiV2Theme();
  return (
    <IconButton title={isDark ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleTheme}>
      {isDark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" strokeLinecap="round" />
          <circle cx="12" cy="12" r="4.5" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 14.5A8.5 8.5 0 119.5 4a7 7 0 0010.5 10.5z" />
        </svg>
      )}
    </IconButton>
  );
}

const TAB_QUERY_MAP = {
  connected: "connected",
  security: "security",
  privacy: "privacy",
  content: "content",
  organization: "organization",
};

function SettingsBody() {
  const { navigate, search } = useAppNavigation();
  const { user, profile, orgMemberships = [], accessLoading } = useAuth();
  const userId = user?.id ?? null;
  const credits = useCreditBalance(userId);

  const requestedTab = TAB_QUERY_MAP[new URLSearchParams(search).get("tab")] || "profile";
  const [activeTab, setActiveTab] = useState(requestedTab);
  const [toast, setToast] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setActiveTab(requestedTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    // Guarded on accessLoading — org memberships haven't necessarily arrived
    // yet on first render, and bouncing a valid ?tab=organization deep link
    // back to "profile" before they load is a real (if narrow) race.
    if (!accessLoading && orgMemberships.length === 0 && activeTab === "organization") setActiveTab("profile");
  }, [accessLoading, activeTab, orgMemberships.length]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const showToast = (message, type = "info") => setToast({ message, type });

  const tabOptions = [
    { id: "profile", label: "Profile" },
    { id: "preferences", label: "Preferences" },
    { id: "notifications", label: "Notifications" },
    { id: "content", label: "Content defaults" },
    { id: "connected", label: "Connected accounts" },
    { id: "security", label: "Security" },
    { id: "privacy", label: "Data & privacy" },
    ...(orgMemberships.length > 0 ? [{ id: "organization", label: "Organization accounts" }] : []),
  ];

  const creditPct = credits.lifetimePurchased > 0
    ? Math.max(0, Math.min(100, Math.round((credits.balance / credits.lifetimePurchased) * 100)))
    : 100;
  const userInitials = ((profile?.full_name ? profile.full_name[0] : "U") + (profile?.full_name?.split(" ")[1]?.[0] ?? "")).toUpperCase();

  return (
    <>
      <AppHeader
        navItems={NAV_ITEMS}
        activeKey=""
        onNavClick={(item) => navigate(item.href)}
        onBurgerClick={() => setMobileNavOpen(true)}
        right={(
          <>
            {credits.ready ? (
              <CreditPill pct={`${creditPct}%`} label={`${credits.balance.toLocaleString()} cr`} />
            ) : (
              <Skeleton width="76px" height="26px" radius="999px" />
            )}
            <ThemeToggleButton />
            <NotificationBell userId={userId} onNavigate={navigate} />
            <AvatarMenu initials={userInitials || "U"} name={profile?.full_name} email={user?.email} onNavigate={navigate} />
          </>
        )}
      />

      <MobileNavDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} navItems={NAV_ITEMS} activeKey="" onNavClick={(item) => navigate(item.href)} />

      <main className={styles.main}>
        <div className={styles.canvas}>
          <div className={styles.headRow}>
            <div>
              <div className={styles.title}>Settings</div>
              <div className={styles.sub}>Manage your profile, defaults, security, and connected publishing accounts.</div>
            </div>
          </div>

          {toast ? (
            <div className={[styles.toast, toast.type === "error" ? styles.toastError : toast.type === "success" ? styles.toastSuccess : ""].join(" ")}>
              {toast.message}
            </div>
          ) : null}

          <div className={styles.tabBar}>
            {tabOptions.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={[styles.tabBtn, activeTab === tab.id ? styles.tabBtnActive : ""].join(" ")}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {!user ? (
            <Card><div className={styles.signInRequired}>Sign in to manage your settings.</div></Card>
          ) : (
            <>
              {(activeTab === "profile" || activeTab === "preferences" || activeTab === "notifications") ? (
                <Card>
                  <PersonalSettingsFoundationTab section={activeTab} onToast={showToast} />
                </Card>
              ) : null}

              {activeTab === "content" ? <ContentDefaultsTab userId={userId} onToast={showToast} /> : null}

              {activeTab === "connected" ? <ConnectedAccountsTab onToast={showToast} /> : null}

              {activeTab === "security" ? <SecurityTab user={user} onToast={showToast} /> : null}

              {activeTab === "privacy" ? <DataPrivacyTab userId={userId} onToast={showToast} /> : null}

              {activeTab === "organization" ? (
                <OrgAccountsReadOnlyTab onToast={showToast} />
              ) : null}
            </>
          )}
        </div>
      </main>
    </>
  );
}

export default function Settings() {
  return (
    <UiV2ThemeProvider className={styles.shell}>
      <SettingsBody />
    </UiV2ThemeProvider>
  );
}
