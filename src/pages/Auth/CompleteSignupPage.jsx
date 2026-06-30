"use client";

import React, { useEffect, useState } from "react";
import AuthLayout from "../../layouts/AuthLayout";
import AuthLoadingOverlay from "../../components/Shared/AuthLoadingOverlay";
import { useAuth } from "../../Context/AuthContext";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { APP_ROOT_PATH } from "../../utils/authRouting";
import {
  clearPendingSignupIntent,
  getPendingSignupIntent,
  provisionSelfSignupOrganization,
} from "../../services/signupIntentService";

export default function CompleteSignupPage() {
  const { navigate } = useAppNavigation();
  const { loading, accessLoading, refreshAccess } = useAuth();
  const [submitting, setSubmitting] = useState(true);
  const [error, setError] = useState("");
  const [intent, setIntent] = useState(() => getPendingSignupIntent());
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function completeSignup() {
      const activeIntent = getPendingSignupIntent();
      setIntent(activeIntent);

      if (!activeIntent) {
        navigate(APP_ROOT_PATH, { replace: true });
        return;
      }

      setSubmitting(true);
      setError("");

      try {
        const result = await provisionSelfSignupOrganization(activeIntent);
        await refreshAccess();
        if (cancelled) return;
        sessionStorage.removeItem("socialai-redirect-after-login");
        navigate(result?.redirect_to || APP_ROOT_PATH, { replace: true });
      } catch (completeError) {
        if (cancelled) return;
        setError(completeError?.message || "Could not finish setting up your organization workspace.");
        setSubmitting(false);
        setIntent(getPendingSignupIntent());
      }
    }

    if (!loading && !accessLoading) {
      void completeSignup();
    }

    return () => {
      cancelled = true;
    };
  }, [accessLoading, loading, navigate, refreshAccess, retryKey]);

  if (loading || accessLoading || submitting) {
    return (
      <AuthLoadingOverlay
        title="Setting up your organization"
        description="Finishing workspace creation and preparing your admin access."
      />
    );
  }

  return (
    <AuthLayout
      title="Finish organization setup"
      subtitle="Your account is ready. We just need a moment to complete the workspace provisioning."
    >
      {error ? (
        <div className="auth-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="auth-info" role="status">
        {intent?.organizationName
          ? `Workspace: ${intent.organizationName}`
          : "We found a pending organization signup for this account."}
      </div>

      <button
        type="button"
        className="auth-submit"
        onClick={() => {
          setSubmitting(true);
          setError("");
          setIntent(getPendingSignupIntent());
          setRetryKey((value) => value + 1);
        }}
      >
        Try Again
      </button>

      <button
        type="button"
        className="auth-oauth-btn auth-secondary-action"
        onClick={() => {
          clearPendingSignupIntent();
          sessionStorage.removeItem("socialai-redirect-after-login");
          navigate(APP_ROOT_PATH, { replace: true });
        }}
      >
        Continue without organization setup
      </button>
    </AuthLayout>
  );
}
