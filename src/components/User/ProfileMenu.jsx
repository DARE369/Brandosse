// src/components/User/ProfileMenu.jsx
import React from "react";
import { User, Settings, LogOut, Sun, Moon, Coins } from "lucide-react";
import { useTheme } from "../../Context/ThemeContext";
import { useAuth } from "../../Context/AuthContext";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import WorkspaceSwitcherMenu from "../Shared/WorkspaceSwitcherMenu";
import { useLogout } from "../../hooks/useLogout";

export default function ProfileMenu({ profile, initials, videoCredits = null, onClose }) {
  const { navigate } = useAppNavigation();
  const { isDark, toggleTheme } = useTheme();
  const { availableWorkspaces = [], activeWorkspace, switchWorkspace } = useAuth();
  const { initiateLogout } = useLogout();

  const handleLogout = () => {
    onClose();
    initiateLogout();
  };

  const handleNav = (path) => {
    onClose();
    navigate(path);
  };

  const credits = profile?.credits ?? 0;
  const maxCredits = 100;
  const creditPct = Math.min((credits / maxCredits) * 100, 100);
  const canSwitchWorkspace = availableWorkspaces.length > 1;

  return (
    <div className="profile-menu" role="menu" aria-label="Profile menu">
      <div className="pm-header">
        <div className="pm-avatar">
          {profile?.avatar_url ? <img src={profile.avatar_url} alt="Avatar" /> : initials}
        </div>
        <div style={{ overflow: "hidden" }}>
          <p className="pm-name">{profile?.full_name ?? "Creator"}</p>
          <p className="pm-email">{profile?.email ?? ""}</p>
        </div>
      </div>

      <div className="pm-credits">
        <div className="pm-credits-label">
          <span className="pm-credits-text">AI credits remaining</span>
          <span className="pm-credits-count">
            {credits} / {maxCredits}
          </span>
        </div>
        <div className="pm-credits-bar">
          <div
            className="pm-credits-fill"
            style={{ width: `${creditPct}%` }}
            role="progressbar"
            aria-valuenow={credits}
            aria-valuemin={0}
            aria-valuemax={maxCredits}
          />
        </div>
      </div>

      {/* Mobile-only: the top-bar credits pill is hidden ≤720px, so surface
          video credits here to keep them accessible. */}
      <button
        type="button"
        className="pm-credits-mobile"
        role="menuitem"
        onClick={() => handleNav("/app/billing/credits")}
      >
        <span className="pm-item-icon">
          <Coins size={15} />
        </span>
        <span className="pm-credits-mobile-text">Video credits</span>
        <span className="pm-credits-mobile-count">
          {videoCredits == null ? "—" : videoCredits}
        </span>
      </button>

      {canSwitchWorkspace ? (
        <>
          <div className="pm-separator" />
          <div className="pm-section">
            <WorkspaceSwitcherMenu
              workspaces={availableWorkspaces}
              activeWorkspace={activeWorkspace}
              onSelect={async (workspace) => {
                const nextPath = await switchWorkspace(workspace);
                onClose();
                if (nextPath) navigate(nextPath);
              }}
            />
          </div>
        </>
      ) : null}

      <div className="pm-section">
        <button className="pm-item" role="menuitem" onClick={() => handleNav("/app/profile")}>
          <span className="pm-item-icon">
            <User size={15} />
          </span>
          Edit Profile
        </button>

        <button className="pm-item" role="menuitem" onClick={() => handleNav("/app/settings")}>
          <span className="pm-item-icon">
            <Settings size={15} />
          </span>
          Settings
        </button>
      </div>

      <div className="pm-separator" />

      <div className="pm-section">
        <div className="pm-theme-row">
          <span className="pm-theme-label">
            <span className="pm-item-icon">{isDark ? <Moon size={15} /> : <Sun size={15} />}</span>
            {isDark ? "Dark mode" : "Light mode"}
          </span>
          <button
            className={`pm-toggle-track ${isDark ? "active" : ""}`}
            onClick={toggleTheme}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            aria-pressed={isDark}
            type="button"
          >
            <span className="pm-toggle-thumb" />
          </button>
        </div>
      </div>

      <div className="pm-separator" />

      <div className="pm-section">
        <button className="pm-item danger" role="menuitem" onClick={handleLogout}>
          <span className="pm-item-icon">
            <LogOut size={15} />
          </span>
          Sign out
        </button>
      </div>
    </div>
  );
}
