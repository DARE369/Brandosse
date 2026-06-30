import React from "react";
import { ChevronRight, LogOut, Settings, Shield, UserCircle2 } from "lucide-react";
import { useAuth } from "../../Context/AuthContext";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import WorkspaceSwitcherMenu from "../../components/Shared/WorkspaceSwitcherMenu";
import { useLogout } from "../../hooks/useLogout";
import { formatShortDateTime } from "../utils/formatDate";
import { getAdminRoleLabel, getAdminScopeLabel } from "../utils/rbac";
import { resolveInitials } from "../utils/adminClient";

export default function AdminProfileMenu({ open, access, onClose }) {
  const { navigate } = useAppNavigation();
  const { availableWorkspaces = [], activeWorkspace, switchWorkspace } = useAuth();
  const { initiateLogout } = useLogout();

  if (!open || !access?.user) return null;

  const profile = access.profile || {};
  const initials = resolveInitials(profile.full_name, profile.email);
  const scopeLabel = getAdminScopeLabel(access);
  const canSwitchWorkspace = availableWorkspaces.length > 1;

  const handleLogout = () => {
    onClose();
    initiateLogout();
  };

  const handleNavigate = (path) => {
    onClose();
    navigate(path);
  };

  return (
    <div className="admin-popover admin-profile-menu" role="menu" aria-label="Admin profile menu">
      <div className="admin-profile-card">
        <div className="admin-profile-avatar">
          {profile.avatar_url ? <img src={profile.avatar_url} alt={profile.full_name || "Admin"} /> : initials}
        </div>
        <div className="admin-profile-copy">
          <h3>{profile.full_name || "Admin"}</h3>
          <p>{profile.email || access.user.email || ""}</p>
          <span className="admin-role-tag">{getAdminRoleLabel(access.adminRole)}</span>
          <span className="admin-profile-scope">Scope: {scopeLabel}</span>
        </div>
      </div>

      {canSwitchWorkspace ? (
        <div className="admin-profile-section">
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
      ) : null}

      <div className="admin-profile-section">
        <span className="admin-popover-subheader">Permissions</span>
        <div className="admin-tag-row">
          {(access.permissionGroups || []).map((group) => (
            <span key={group} className="admin-tag">
              {group}
            </span>
          ))}
        </div>
      </div>

      <div className="admin-profile-section">
        <button type="button" className="admin-menu-item" onClick={() => handleNavigate("/app/admin/settings?tab=preferences")}>
          <Settings size={16} />
          Preferences
          <ChevronRight size={15} className="admin-menu-item-chevron" />
        </button>
        <button type="button" className="admin-menu-item" onClick={() => handleNavigate("/app/admin/settings?tab=security")}>
          <Shield size={16} />
          Security Settings
          <ChevronRight size={15} className="admin-menu-item-chevron" />
        </button>
        <button type="button" className="admin-menu-item" onClick={() => handleNavigate("/app/admin/settings?tab=profile")}>
          <UserCircle2 size={16} />
          Profile Settings
          <ChevronRight size={15} className="admin-menu-item-chevron" />
        </button>
      </div>

      <div className="admin-profile-footnote">
        Last sign-in: {formatShortDateTime(access.user.last_sign_in_at)}
      </div>

      <button type="button" className="admin-menu-item admin-menu-item-danger" onClick={handleLogout}>
        <LogOut size={16} />
        Logout
      </button>
    </div>
  );
}
