"use client";

import React from "react";
import { useAppNavigation } from "../Context/AppNavigationContext";
import { useAuth } from "../Context/AuthContext";
import AdminLayout from "../admin/AdminLayout";
import AuthLoadingOverlay from "../components/Shared/AuthLoadingOverlay";
import {
  USER_HOME_PATH,
  isAdminRole,
  normalizeRole,
} from "../utils/authRouting";

function AdminAccessGate({ children }) {
  const { user, loading, accessLoading, resolvedRole, adminRole, profile } = useAuth();
  const { navigate } = useAppNavigation();

  const adminUser = isAdminRole(normalizeRole(adminRole || resolvedRole || profile?.role));

  React.useEffect(() => {
    if (loading || accessLoading || !user || adminUser) return;
    navigate(USER_HOME_PATH, { replace: true });
  }, [accessLoading, adminUser, loading, navigate, user]);

  if (loading || accessLoading || user === undefined) {
    return (
      <AuthLoadingOverlay
        title="Checking admin access"
        description="Verifying your permissions before opening the admin workspace."
      />
    );
  }

  if (!adminUser) {
    return (
      <AuthLoadingOverlay
        title="Redirecting"
        description="Your account does not have access to the admin workspace."
      />
    );
  }

  return children;
}

export default function AdminRouteShell({ children }) {
  return (
    <AdminAccessGate>
      <AdminLayout>{children}</AdminLayout>
    </AdminAccessGate>
  );
}
