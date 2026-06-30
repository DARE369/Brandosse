import React from "react";
export default function AuthLoadingOverlay({
  title = "Checking your access",
  description = "Please wait a moment while we secure your workspace.",
}) {
  return (
    <div className="auth-loading-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="auth-loading-card">
        <div className="auth-loading-spinner" aria-hidden="true" />
        <p className="auth-loading-title">{title}</p>
        <p className="auth-loading-description">{description}</p>
      </div>
    </div>
  );
}
