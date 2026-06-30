"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import AuthLayout from "../../layouts/AuthLayout";
import { useAuth } from "../../Context/AuthContext";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { supabase } from "../../services/supabaseClient";

export default function ResetPassword() {
  const { navigate } = useAppNavigation();
  const { updatePassword } = useAuth();
  const [checkingLink, setCheckingLink] = useState(true);
  const [validRecovery, setValidRecovery] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapRecoverySession() {
      try {
        setCheckingLink(true);
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (code) {
          await supabase.auth.exchangeCodeForSession(code);
        }

        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");

        if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (sessionError) {
            throw sessionError;
          }

          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${window.location.search}`,
          );
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!cancelled) {
          setValidRecovery(Boolean(session?.user));
          if (!session?.user) {
            setError("Recovery link is invalid or has expired. Request a new one.");
          }
        }
      } catch (bootstrapError) {
        if (!cancelled) {
          setValidRecovery(false);
          setError(bootstrapError?.message || "Could not validate recovery link.");
        }
      } finally {
        if (!cancelled) {
          setCheckingLink(false);
        }
      }
    }

    bootstrapRecoverySession();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await updatePassword(password);
      setCompleted(true);
      await supabase.auth.signOut().catch(() => {});
      navigate("/login", {
        replace: true,
        state: { message: "Password updated. Sign in with your new password." },
      });
    } catch (submitError) {
      setError(submitError?.message || "Could not reset password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="Use a strong password with at least 8 characters."
    >
      {checkingLink ? (
        <div className="auth-info">Validating recovery link...</div>
      ) : null}

      {error ? (
        <div className="auth-error" role="alert">
          {error}
        </div>
      ) : null}

      {completed ? (
        <div className="auth-info" role="status">
          Password updated. Redirecting to login...
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate>
        <div className="auth-field">
          <label className="auth-label" htmlFor="reset-password">New password</label>
          <div className="auth-input-wrap">
            <input
              id="reset-password"
              type="password"
              className="auth-input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              disabled={!validRecovery || checkingLink || submitting}
            />
          </div>
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="reset-password-confirm">Confirm password</label>
          <div className="auth-input-wrap">
            <input
              id="reset-password-confirm"
              type="password"
              className="auth-input"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              disabled={!validRecovery || checkingLink || submitting}
            />
          </div>
        </div>

        <button
          type="submit"
          className="auth-submit"
          disabled={!validRecovery || checkingLink || submitting}
        >
          {submitting ? "Updating..." : "Update password"}
        </button>
      </form>

      <p className="auth-footer">
        Need another link?{" "}
        <Link href="/forgot-password" className="auth-link">Request reset email</Link>
      </p>
    </AuthLayout>
  );
}
