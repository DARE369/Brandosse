import React, { useEffect, useMemo } from "react";
import AppRedirect from "@/next/AppRedirect";
import { useAuth } from "../Context/AuthContext";
import AuthLoadingOverlay from "../components/Shared/AuthLoadingOverlay";
import { resolvePostAuthPath } from "./authRouting";
import { getPendingSignupIntent, SIGNUP_COMPLETION_PATH } from "../services/signupIntentService";

export default function PostAuthRedirect({ intendedPathOverride = null }) {
  const {
    user,
    loading: authLoading,
    accessLoading,
    resolvedRole,
    workspaceRedirectPath,
  } = useAuth();
  const intendedPath = useMemo(
    () =>
      intendedPathOverride || sessionStorage.getItem("socialai-redirect-after-login"),
    [intendedPathOverride],
  );

  useEffect(() => {
    if (!intendedPathOverride && user && !authLoading && !accessLoading) {
      sessionStorage.removeItem("socialai-redirect-after-login");
    }
  }, [accessLoading, authLoading, intendedPathOverride, user]);

  if (authLoading || (user && accessLoading)) {
    return (
      <AuthLoadingOverlay
        title="Preparing your workspace"
        description="Matching your account role and opening the right dashboard."
      />
    );
  }

  if (!user) {
    return <AppRedirect to="/login" replace />;
  }

  if (getPendingSignupIntent()) {
    return <AppRedirect to={SIGNUP_COMPLETION_PATH} replace />;
  }

  const redirectPath = resolvePostAuthPath({
    role: resolvedRole,
    intendedPath: intendedPath || workspaceRedirectPath,
  });

  return <AppRedirect to={redirectPath} replace />;
}
