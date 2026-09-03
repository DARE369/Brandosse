import React, { useEffect, useSyncExternalStore } from "react";
import AppRedirect from "@/next/AppRedirect";
import { useAuth } from "../Context/AuthContext";
import AuthLoadingOverlay from "../components/Shared/AuthLoadingOverlay";
import { resolvePostAuthPath } from "./authRouting";
import { getPendingSignupIntent, SIGNUP_COMPLETION_PATH } from "../services/signupIntentService";

const REDIRECT_INTENT_KEY = "socialai-redirect-after-login";

/** No-op: the value is read at hydration and once after; nothing observes it. */
const subscribeToStoredIntent = () => () => {};

const getStoredIntent = () => {
  try {
    return window.sessionStorage?.getItem(REDIRECT_INTENT_KEY) ?? null;
  } catch {
    return null;
  }
};

/** Must be a stable value, or useSyncExternalStore re-renders forever. */
const getStoredIntentServerSnapshot = () => null;

export default function PostAuthRedirect({ intendedPathOverride = null }) {
  const {
    user,
    loading: authLoading,
    accessLoading,
    resolvedRole,
    workspaceRedirectPath,
  } = useAuth();
  // Read through useSyncExternalStore, not useMemo.
  //
  // `sessionStorage.getItem(...)` in a useMemo runs DURING RENDER, where the
  // server has no sessionStorage at all — so this was a ReferenceError waiting
  // for the first time this component was rendered on the server, not merely a
  // hydration mismatch. And `intendedPath` decides which route is redirected
  // to, so it is exactly the kind of value that must agree between server and
  // client.
  //
  // The server snapshot is null: with no storage there can be no stored intent,
  // and the caller's explicit override still wins below.
  const storedIntent = useSyncExternalStore(
    subscribeToStoredIntent,
    getStoredIntent,
    getStoredIntentServerSnapshot,
  );
  const intendedPath = intendedPathOverride || storedIntent;

  useEffect(() => {
    if (!intendedPathOverride && user && !authLoading && !accessLoading) {
      try { window.sessionStorage?.removeItem(REDIRECT_INTENT_KEY); } catch { /* storage unavailable */ }
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
