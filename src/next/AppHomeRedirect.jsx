"use client";

import React, { useEffect, useState } from "react";
import AppRedirect from "./AppRedirect";
import { useAuth } from "../Context/AuthContext";
import AuthLoadingOverlay from "../components/Shared/AuthLoadingOverlay";
import { resolvePostAuthPath, USER_HOME_PATH } from "../utils/authRouting";
import { fetchOnboardingCompleted } from "../services/userSettingsService";

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

  const redirectPath = resolvePostAuthPath({
    role: adminRole || resolvedRole || profile?.role,
    intendedPath: workspaceRedirectPath,
  });

  // Onboarding only ever intercepts the plain "no deep link, landing on your
  // own dashboard" case computed above — deep links, admin routes, and org
  // routes are untouched. One query, once, right after auth resolves.
  const shouldCheckOnboarding = Boolean(user) && redirectPath === USER_HOME_PATH;
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    if (!shouldCheckOnboarding) return undefined;
    let active = true;
    fetchOnboardingCompleted(user.id)
      .then((completed) => { if (active) setNeedsOnboarding(!completed); })
      .catch(() => { if (active) setNeedsOnboarding(false); })
      .finally(() => { if (active) setOnboardingChecked(true); });
    return () => { active = false; };
  }, [shouldCheckOnboarding, user?.id]);

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

  if (shouldCheckOnboarding && !onboardingChecked) {
    return (
      <AuthLoadingOverlay
        title="Opening your workspace"
        description="Matching your account role to the right dashboard."
      />
    );
  }

  if (shouldCheckOnboarding && needsOnboarding) {
    return <AppRedirect to="/app/onboarding" replace />;
  }

  return <AppRedirect to={redirectPath} replace />;
}
