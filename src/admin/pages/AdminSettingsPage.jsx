"use client";

import React from "react";
import toast from "react-hot-toast";
import { useAdminLayoutContext } from "../AdminLayoutContext";
import { useMutableSearchParams } from "../../next/useMutableSearchParams";
import useLocalPersist from "../hooks/useLocalPersist";
import { getAdminRoleLabel, getAdminScopeLabel } from "../utils/rbac";
import { supabase } from "../../services/supabaseClient";

const TABS = [
  ["profile", "Profile"],
  ["security", "Security"],
  ["preferences", "Preferences"],
  ["notifications", "Notifications"],
];

const NOTIFICATION_TYPES = [
  "complaint_assigned",
  "publish_failure",
  "flagged_content",
  "low_quality_generation",
  "password_reset_completed",
  "suspension_expiring",
  "platform_connection_broken",
  "deletion_request_pending",
  "approval_required",
];

export default function AdminSettingsPage() {
  const { adminAccess } = useAdminLayoutContext();
  const [searchParams, setSearchParams] = useMutableSearchParams();
  const activeTab = TABS.some(([value]) => value === searchParams.get("tab"))
    ? searchParams.get("tab")
    : "profile";
  const [preferences, setPreferences] = useLocalPersist("socialai-admin-settings", {
    theme: "system",
    realtimeNotifications: true,
    showUnreadOnly: false,
    defaultPageSize: 25,
    notificationTypes: Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, true])),
  });

  const profile = adminAccess?.profile || {};
  const scopeLabel = adminAccess?.scopeLabel || getAdminScopeLabel(adminAccess);

  const setActiveTab = (tab) => setSearchParams({ tab });
  const togglePreference = (key) =>
    setPreferences((current) => ({
      ...current,
      [key]: !current[key],
    }));
  const toggleNotificationType = (type) =>
    setPreferences((current) => ({
      ...current,
      notificationTypes: {
        ...current.notificationTypes,
        [type]: !current.notificationTypes[type],
      },
    }));

  const handleSendSelfReset = async () => {
    if (!adminAccess?.user?.email) return;
    try {
      await supabase.auth.resetPasswordForEmail(adminAccess.user.email, {
        redirectTo: `${window.location.origin}/login`,
      });
      toast.success(`Password reset email sent to ${adminAccess.user.email}.`);
    } catch (error) {
      console.error("Failed to send self reset email:", error);
      toast.error("Failed to send the password reset email.");
    }
  };

  return (
    <section className="admin-page">
      <header className="admin-page-header">
        <div>
          <span className="admin-section-kicker">Admin Workspace</span>
          <h2 className="admin-page-title">Settings</h2>
          <p className="admin-page-subtext">
            Profile, security, preferences, and admin notification settings stay inside the admin workspace.
          </p>
        </div>
      </header>

      <div className="admin-settings-tabs">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`admin-settings-tab${activeTab === value ? " active" : ""}`}
            onClick={() => setActiveTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "profile" ? (
        <div className="admin-section-grid admin-section-grid-wide">
          <div className="admin-panel admin-settings-profile-card">
            <div className="admin-user-identity-row">
              <div className="admin-avatar admin-avatar-xl">
                {(profile.full_name || profile.email || "AD").slice(0, 2).toUpperCase()}
              </div>
              <div className="admin-user-identity-copy">
                <h3>{profile.full_name || "Admin"}</h3>
                <p>{profile.email || adminAccess?.user?.email || "-"}</p>
                <div className="admin-tag-row">
                  <span className="admin-role-tag">{getAdminRoleLabel(adminAccess?.adminRole)}</span>
                  <span className="admin-tag">Scope: {scopeLabel}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="admin-panel">
            <h3>Profile</h3>
            <div className="admin-form-grid">
              <label>
                Display name
                <input className="admin-input" value={profile.full_name || ""} readOnly />
              </label>
              <label>
                Email
                <input className="admin-input" value={profile.email || adminAccess?.user?.email || ""} readOnly />
              </label>
              <label className="admin-form-grid-span">
                Avatar upload
                <input className="admin-input" type="file" disabled />
                <span className="admin-field-footnote">Avatar upload wiring is still pending backend storage support.</span>
              </label>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "security" ? (
        <div className="admin-section-grid admin-section-grid-wide">
          <div className="admin-panel">
            <h3>Security</h3>
            <div className="admin-list-stack">
              <div className="admin-list-item">
                <strong>Last sign-in</strong>
                <span>{adminAccess?.user?.last_sign_in_at ? new Date(adminAccess.user.last_sign_in_at).toLocaleString() : "-"}</span>
              </div>
              <div className="admin-list-item">
                <strong>Password</strong>
                <span>Password resets are handled through Supabase auth.</span>
              </div>
            </div>
            <div className="admin-header-actions">
              <button type="button" className="admin-secondary-button" onClick={handleSendSelfReset}>
                Send password reset
              </button>
              <button type="button" className="admin-secondary-button" disabled>
                2FA setup
              </button>
            </div>
          </div>

          <div className="admin-panel">
            <h3>Active Sessions</h3>
            <div className="admin-empty-inline">
              Session management remains auth-provider backed. A richer session list can be layered in after the admin auth model is finalized.
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "preferences" ? (
        <div className="admin-section-grid admin-section-grid-wide">
          <div className="admin-panel">
            <h3>Preferences</h3>
            <div className="admin-form-grid">
              <label>
                Theme
                <select
                  className="admin-select"
                  value={preferences.theme}
                  onChange={(event) =>
                    setPreferences((current) => ({ ...current, theme: event.target.value }))
                  }
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <label>
                Default page size
                <select
                  className="admin-select"
                  value={preferences.defaultPageSize}
                  onChange={(event) =>
                    setPreferences((current) => ({
                      ...current,
                      defaultPageSize: Number(event.target.value),
                    }))
                  }
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
            </div>
          </div>

          <div className="admin-panel">
            <h3>Workspace Toggles</h3>
            <label className="admin-toggle-row">
              <span>Realtime notifications</span>
              <input
                type="checkbox"
                checked={preferences.realtimeNotifications}
                onChange={() => togglePreference("realtimeNotifications")}
              />
            </label>
            <label className="admin-toggle-row">
              <span>Unread only by default</span>
              <input
                type="checkbox"
                checked={preferences.showUnreadOnly}
                onChange={() => togglePreference("showUnreadOnly")}
              />
            </label>
          </div>
        </div>
      ) : null}

      {activeTab === "notifications" ? (
        <div className="admin-panel">
          <h3>Notification Types</h3>
          <div className="admin-checkbox-list">
            {NOTIFICATION_TYPES.map((type) => (
              <label key={type} className="admin-toggle-row">
                <span>{type.replaceAll("_", " ")}</span>
                <input
                  type="checkbox"
                  checked={Boolean(preferences.notificationTypes[type])}
                  onChange={() => toggleNotificationType(type)}
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
