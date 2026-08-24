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
import { AppShell, Card } from "../ui-v2";
import PersonalSettingsFoundationTab from "./Settings/PersonalSettingsFoundationTab";
import ConnectedAccountsTab from "./Settings/ConnectedAccountsTab";
import OrgAccountsReadOnlyTab from "./Settings/OrgAccountsReadOnlyTab";
import ContentDefaultsTab from "./Settings/ContentDefaultsTab";
import SecurityTab from "./Settings/SecurityTab";
import DataPrivacyTab from "./Settings/DataPrivacyTab";
import styles from "./Settings.module.css";


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

  const requestedTab = TAB_QUERY_MAP[new URLSearchParams(search).get("tab")] || "profile";
  const [activeTab, setActiveTab] = useState(requestedTab);
  const [toast, setToast] = useState(null);

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


  return (
    <AppShell
      activeKey=""
      className={styles.shell}
      mainClassName={styles.main}
    >
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
    </AppShell>
  );
}

export default function Settings() {
  return <SettingsBody />;
}
