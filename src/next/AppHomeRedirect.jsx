"use client";

import React from "react";
import AppRedirect from "./AppRedirect";
import { useAuth } from "../Context/AuthContext";
import AuthLoadingOverlay from "../components/Shared/AuthLoadingOverlay";
import { resolvePostAuthPath } from "../utils/authRouting";

export default function AppHomeRedirect() {
  const {
    user,
    loading,
    accessLoading,
    resolvedRole,
    adminRole,
    profile,
    workspaceRedirectPath,
  } = useAuth();

  if (loading || user === undefined || (user && accessLoading)) {
    return (
      <AuthLoadingOverlay
        title="Opening your workspace"
        description="Matching your account role to the right dashboard."
      />
    );
  }

  if (!user) {
    return <AppRedirect to="/login" replace />;
  }

  const redirectPath = resolvePostAuthPath({
    role: adminRole || resolvedRole || profile?.role,
    intendedPath: workspaceRedirectPath,
  });

  return <AppRedirect to={redirectPath} replace />;
}
