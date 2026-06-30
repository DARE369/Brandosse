"use client";

import React from "react";
import Link from "next/link";
export default function NotFoundPage() {
  return (
    <div className="notfound-page">
      <div className="notfound-page__glow" />
      <div className="notfound-content">
        <span className="notfound-kicker">SocialAI</span>
        <h1 className="notfound-title">Page not found</h1>
        <p className="notfound-message">
          The page you're looking for doesn't exist, or the route has moved to a different workspace.
        </p>
        <div className="notfound-actions">
          <Link className="notfound-link primary" href="/">
            Return Home
          </Link>
          <Link className="notfound-link" href="/login">
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
