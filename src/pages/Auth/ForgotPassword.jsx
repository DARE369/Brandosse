"use client";

import React, { useState } from "react";
import Link from "next/link";
import AuthLayout from "../../layouts/AuthLayout";
import { useAuth } from "../../Context/AuthContext";

export default function ForgotPassword() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSent(false);
    setSubmitting(true);

    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (submitError) {
      setError(submitError?.message || "Could not send reset email.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your email and we will send a recovery link."
    >
      {error ? (
        <div className="auth-error" role="alert">
          {error}
        </div>
      ) : null}

      {sent ? (
        <div className="auth-info" role="status">
          Password reset link sent. Check your inbox and open the link on this device.
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate>
        <div className="auth-field">
          <label className="auth-label" htmlFor="forgot-email">Email address</label>
          <div className="auth-input-wrap">
            <input
              id="forgot-email"
              type="email"
              className="auth-input"
              placeholder="name@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              disabled={submitting}
            />
          </div>
        </div>

        <button type="submit" className="auth-submit" disabled={submitting}>
          {submitting ? "Sending..." : "Send reset link"}
        </button>
      </form>

      <p className="auth-footer">
        Remembered your password?{" "}
        <Link href="/login" className="auth-link">Back to sign in</Link>
      </p>
    </AuthLayout>
  );
}
