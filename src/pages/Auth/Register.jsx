"use client";

// src/pages/Auth/Register.jsx
import React, { useState } from "react";
import Link from "next/link";
import { useAuth } from "../../Context/AuthContext";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import AuthLayout from "../../layouts/AuthLayout";
import { APP_ROOT_PATH } from "../../utils/authRouting";
import {
  buildPendingSignupIntent,
  clearPendingSignupIntent,
  isOrganizationPlanKey,
  savePendingSignupIntent,
  SIGNUP_COMPLETION_PATH,
} from "../../services/signupIntentService";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M22 6L12 13 2 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className="auth-alert-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v5M12 16.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon({ valid }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {valid ? (
        <path d="M5 13L9 17L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      )}
    </svg>
  );
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [planKey, setPlanKey] = useState("individual");
  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(""); // "email" | "google" | ""

  const { register, loginWithGoogle } = useAuth();
  const { navigate } = useAppNavigation();

  const passwordValid = password.length >= 6;
  const busy = !!loading;
  const orgSignup = isOrganizationPlanKey(planKey);

  const validateOrganizationFields = () => {
    if (!orgSignup) return true;
    if (!String(organizationName || "").trim()) {
      setError("Organization name is required for organization signup.");
      return false;
    }
    if (!String(organizationSlug || "").trim()) {
      setError("Organization URL slug is required for organization signup.");
      return false;
    }
    return true;
  };

  const getPendingIntent = () => {
    if (!orgSignup) return null;
    return buildPendingSignupIntent({
      planKey,
      organizationName,
      organizationSlug,
    });
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    if (!passwordValid) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (!validateOrganizationFields()) {
      return;
    }

    setError("");
    setLoading("email");

    try {
      const pendingIntent = getPendingIntent();
      const signupData = await register(email, password, {
        planKey,
        organizationName,
        organizationSlug,
        signupRequestId: pendingIntent?.signupRequestId || null,
      });
      console.info(
        "[ProfileProvisioning][register-email] signup completed",
        signupData?.user?.id
          ? { userId: signupData.user.id }
          : { userId: null, note: "confirmation flow may delay user availability" },
      );
      if (signupData?.organizationProvision?.redirect_to) {
        navigate(signupData.organizationProvision.redirect_to, { replace: true });
        return;
      }

      if (signupData?.organizationProvisionPending) {
        if (signupData?.hasActiveSession) {
          navigate(SIGNUP_COMPLETION_PATH, { replace: true });
          return;
        }

        navigate("/login", {
          replace: true,
          state: {
            message: "Check your email, confirm your account, then sign in to finish creating your organization workspace.",
          },
        });
        return;
      }

      if (!signupData?.hasActiveSession) {
        navigate("/login", {
          replace: true,
          state: {
            message: "Check your email to confirm your account, then sign in to continue.",
          },
        });
        return;
      }

      navigate(APP_ROOT_PATH, { replace: true });
    } catch (err) {
      console.error("[ProfileProvisioning][register-email] signup failed:", err?.message || err);
      setError(err.message || "Failed to create account. Please try again.");
    } finally {
      setLoading("");
    }
  };

  const handleGoogle = async () => {
    setError("");
    if (!validateOrganizationFields()) {
      return;
    }
    setLoading("google");
    try {
      if (orgSignup) {
        const pendingIntent = getPendingIntent();
        savePendingSignupIntent(pendingIntent);
        sessionStorage.setItem("socialai-redirect-after-login", SIGNUP_COMPLETION_PATH);
      } else {
        clearPendingSignupIntent();
        sessionStorage.removeItem("socialai-redirect-after-login");
      }
      await loginWithGoogle();
      // For Google OAuth, navigation happens after auth callback.
    } catch (err) {
      setError(err?.message || "Couldn't connect with Google. Please try again.");
      setLoading("");
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start automating your social media today. Free to get started."
    >
      <div className="auth-credits-badge">
        <span className="auth-credits-icon">*</span>
        <span>100 free AI credits included on signup</span>
      </div>

      <div className="auth-field auth-field-plan">
        <label className="auth-label">Account type</label>
        <div className="auth-plan-grid" role="radiogroup" aria-label="Choose account type">
          {[
            {
              value: "individual",
              title: "Individual",
              description: "Personal workspace with your existing generate, calendar, and library flow.",
            },
            {
              value: "organization",
              title: "Organization",
              description: "One brand with a shared team workspace, approval pipeline, and org admin tools.",
            },
            {
              value: "agency",
              title: "Agency",
              description: "Multi-brand workspace with brand projects and agency-level oversight.",
            },
          ].map((option) => (
            <label
              key={option.value}
              className={`auth-plan-card ${planKey === option.value ? "is-active" : ""}`}
            >
              <input
                type="radio"
                name="planKey"
                value={option.value}
                checked={planKey === option.value}
                onChange={(event) => {
                  const nextPlan = event.target.value;
                  setPlanKey(nextPlan);
                  setError("");
                }}
                disabled={busy}
              />
              <span className="auth-plan-title">{option.title}</span>
              <span className="auth-plan-copy">{option.description}</span>
            </label>
          ))}
        </div>
      </div>

      {orgSignup ? (
        <>
          <div className="auth-field">
            <label className="auth-label" htmlFor="reg-org-name">Organization name</label>
            <div className="auth-input-wrap">
              <input
                id="reg-org-name"
                type="text"
                className="auth-input"
                placeholder="Acme Studio"
                value={organizationName}
                onChange={(event) => {
                  const nextName = event.target.value;
                  setOrganizationName(nextName);
                  if (!slugTouched) {
                    setOrganizationSlug(slugify(nextName));
                  }
                }}
                autoComplete="organization"
                required
                disabled={busy}
              />
            </div>
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="reg-org-slug">Workspace slug</label>
            <div className="auth-input-wrap">
              <input
                id="reg-org-slug"
                type="text"
                className="auth-input"
                placeholder="acme-studio"
                value={organizationSlug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setOrganizationSlug(slugify(event.target.value));
                }}
                autoComplete="off"
                required
                disabled={busy}
              />
            </div>
            <div className="auth-hint">
              This becomes your workspace URL slug and will be made unique if needed.
            </div>
          </div>
        </>
      ) : null}

      <button
        type="button"
        className="auth-oauth-btn auth-oauth-btn--spaced"
        onClick={handleGoogle}
        disabled={busy}
      >
        {loading === "google" ? (
          <svg className="auth-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeDasharray="28 56" strokeLinecap="round" />
          </svg>
        ) : (
          <GoogleIcon />
        )}
        {loading === "google" ? "Connecting..." : "Sign up with Google"}
      </button>

      <div className="auth-divider"><span>or register with email</span></div>

      {error && (
        <div className="auth-error" role="alert">
          <AlertIcon />
          {error}
        </div>
      )}

      <form onSubmit={handleEmailSubmit} noValidate>
        <div className="auth-field">
          <label className="auth-label" htmlFor="reg-email">Email address</label>
          <div className="auth-input-wrap">
            <span className="auth-input-icon"><MailIcon /></span>
            <input
              id="reg-email"
              type="email"
              className="auth-input"
              placeholder="name@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              disabled={busy}
            />
          </div>
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="reg-password">Password</label>
          <div className="auth-input-wrap">
            <span className="auth-input-icon"><LockIcon /></span>
            <input
              id="reg-password"
              type="password"
              className="auth-input"
              placeholder="Create a password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
              disabled={busy}
            />
          </div>
          <div className={`auth-hint ${passwordValid ? "valid" : ""}`}>
            <CheckIcon valid={passwordValid} />
            At least 6 characters
          </div>
        </div>

        <button
          type="submit"
          className="auth-submit auth-submit--spaced"
          disabled={busy}
        >
          {loading === "email" ? (
            <>
              <svg className="auth-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeDasharray="28 56" strokeLinecap="round" />
              </svg>
              Creating account...
            </>
          ) : "Create Account"}
        </button>
      </form>

      <p className="auth-terms">
        By creating an account you agree to our{" "}
        <a href="#" className="auth-link">Terms of Service</a> and{" "}
        <a href="#" className="auth-link">Privacy Policy</a>.
      </p>

      <p className="auth-footer">
        Already have an account?{" "}
        <Link href="/login" className="auth-link">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
