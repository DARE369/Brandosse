"use client";

// src/utils/ProtectedRoute.jsx
import React from "react";
import AppRedirect from "@/next/AppRedirect";
import { useAuth } from "../Context/AuthContext";
import { useAppNavigation } from "../Context/AppNavigationContext";
import AuthLoadingOverlay from "../components/Shared/AuthLoadingOverlay";
import { useOrgContext } from "../org/hooks/useOrgContext";
import { getOrganizationHomePath } from "../org/utils/orgHomePath";
import {
  USER_HOME_PATH,
  isAdminPath,
  isAdminRole,
  normalizeRole,
} from "./authRouting";

export default function ProtectedRoute({ children, requireAdmin = false }) {
  const {
    user,
    loading: authLoading,
    accessLoading,
    resolvedRole,
    workspaceRedirectPath,
  } = useAuth();
  const { location } = useAppNavigation();

  if (authLoading || user === undefined) {
    return (
      <AuthLoadingOverlay
        title="Checking your authentication"
        description="Securing your session and loading your workspace access."
      />
    );
  }

  if (!user) {
    const intended = `${location.pathname}${location.search}${location.hash}`;
    if (intended && intended !== "/login") {
      sessionStorage.setItem("socialai-redirect-after-login", intended);
    }
    return <AppRedirect to="/login" state={{ from: location }} replace />;
  }

  if (accessLoading) {
    return (
      <AuthLoadingOverlay
        title="Preparing your workspace"
        description="Checking your role permissions before opening the correct workspace."
      />
    );
  }

  const normalizedRole = normalizeRole(resolvedRole) || "user";
  const adminUser = isAdminRole(normalizedRole);
  const onAdminPath = isAdminPath(location.pathname);
  const fallbackWorkspacePath = workspaceRedirectPath && !isAdminPath(workspaceRedirectPath)
    ? workspaceRedirectPath
    : USER_HOME_PATH;

  if (!adminUser && onAdminPath) {
    return <AppRedirect to={fallbackWorkspacePath} replace />;
  }

  if (requireAdmin && !adminUser) {
    return <AppRedirect to={fallbackWorkspacePath} replace />;
  }

  return children;
}

export function OrgMemberRoute({ children }) {
  const { location } = useAppNavigation();
  const { user, loading: authLoading, accessLoading } = useAuth();
  const { loading: orgLoading, isMember } = useOrgContext();

  if (authLoading || user === undefined || accessLoading || orgLoading) {
    return (
      <AuthLoadingOverlay
        title="Opening organization workspace"
        description="Checking your organization membership and workspace access."
      />
    );
  }

  if (!user) {
    const intended = `${location.pathname}${location.search}${location.hash}`;
    if (intended && intended !== "/login" && typeof window !== "undefined") {
      sessionStorage.setItem("socialai-redirect-after-login", intended);
    }
    return <AppRedirect to="/login" replace state={{ from: location }} />;
  }

  if (!isMember) {
    return (
      <AppRedirect
        to="/select-context"
        replace
        state={{ orgAccessDenied: true, from: location }}
      />
    );
  }

  return children;
}

export function OrgAdminRoute({ children }) {
  const { location } = useAppNavigation();
  const { user, loading: authLoading, accessLoading } = useAuth();
  const { loading: orgLoading, isMember, isOrgAdmin, organizationId, role } = useOrgContext();

  if (authLoading || user === undefined || accessLoading || orgLoading) {
    return (
      <AuthLoadingOverlay
        title="Checking organization access"
        description="Verifying your admin permissions for this workspace."
      />
    );
  }

  if (!user) {
    const intended = `${location.pathname}${location.search}${location.hash}`;
    if (intended && intended !== "/login" && typeof window !== "undefined") {
      sessionStorage.setItem("socialai-redirect-after-login", intended);
    }
    return <AppRedirect to="/login" replace state={{ from: location }} />;
  }

  if (!isMember) {
    return (
      <AppRedirect
        to="/select-context"
        replace
        state={{ orgAccessDenied: true, from: location }}
      />
    );
  }

  if (!isOrgAdmin) {
    return (
      <AppRedirect
        to={organizationId ? getOrganizationHomePath(organizationId, role) : USER_HOME_PATH}
        replace
        state={{ orgAdminDenied: true, from: location }}
      />
    );
  }

  return children;
}
