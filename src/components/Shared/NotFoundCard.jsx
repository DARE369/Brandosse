import React, { useMemo } from "react";
import { ADMIN_HOME_PATH, USER_HOME_PATH, isAdminRole, normalizeRole } from "../../utils/authRouting";
import { useAuth } from "../../Context/AuthContext";
import { useAppNavigation } from "../../Context/AppNavigationContext";
export default function NotFoundCard() {
  const { navigate } = useAppNavigation();
  const { resolvedRole, adminRole, profile } = useAuth();
  const adminUser = useMemo(
    () => isAdminRole(normalizeRole(adminRole || resolvedRole || profile?.role)),
    [adminRole, profile?.role, resolvedRole],
  );

  const destination = adminUser ? ADMIN_HOME_PATH : USER_HOME_PATH;
  const label = adminUser ? "Return to Admin Dashboard" : "Return to Dashboard";

  return (
    <div className="not-found-card">
      <span className="not-found-card__code">404</span>
      <h2>Page not found</h2>
      <p>This page doesn't exist or you don't have access to it.</p>
      <button type="button" className="not-found-card__action" onClick={() => navigate(destination, { replace: true })}>
        {label}
      </button>
    </div>
  );
}
