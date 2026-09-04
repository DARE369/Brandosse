// src/layouts/AuthLayout.jsx
import React from "react";
import Link from "next/link";
import ThemeToggle from "../components/Shared/ThemeToggle";
import { StudioMark } from "../ui-v2/brand/StudioMark";
export default function AuthLayout({ children, title, subtitle }) {
  return (
    <div className="auth-root">

      <aside className="auth-panel" aria-hidden="true">
        <div className="auth-panel-glow auth-panel-glow--a" />
        <div className="auth-panel-glow auth-panel-glow--b" />
        <div className="auth-panel-grid" />

        <div className="auth-panel-inner">
          <Link href="/" className="auth-panel-logo">
            <span className="auth-panel-logo-mark">
<StudioMark size={20} decorative />
            </span>
            SocialAI
          </Link>

          <div className="auth-panel-copy">
            <h2 className="auth-panel-h2">
              Your content.<br/>
              <span className="auth-panel-gradient">Automated.</span>
            </h2>
            <p className="auth-panel-sub">
              Generate, schedule, and publish across every platform,
              all from one intelligent workspace.
            </p>
          </div>

          <ul className="auth-panel-features">
            {[
              "AI captions, hashtags & visuals in seconds",
              "Smart scheduling at your audience's peak times",
              "Instagram, TikTok, LinkedIn, Facebook & YouTube",
              "Full pipeline - from draft to published",
            ].map((f) => (
              <li key={f}>
                <span className="auth-panel-check">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
                {f}
              </li>
            ))}
          </ul>

          <div className="auth-panel-testimonial">
            <p>"We cut content production time by 70%. SocialAI just gets our brand."</p>
            <div className="auth-panel-tauthor">
              <div className="auth-panel-tavatar">AO</div>
              <div>
                <strong>Amara Osei</strong>
                <span>Head of Marketing, Kojo Retail</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className="auth-form-side">

        <div className="auth-topbar">
          <Link href="/" className="auth-back">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <path d="M9.5 3L5 7.5L9.5 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back to home
          </Link>
          <ThemeToggle />
        </div>

        <div className="auth-form-wrap">
          <Link href="/" className="auth-mobile-logo">
            <span className="auth-panel-logo-mark">
<StudioMark size={18} tone="light" decorative />
            </span>
            SocialAI
          </Link>

          <header className="auth-form-header">
            <h1 className="auth-form-title">{title}</h1>
            {subtitle && <p className="auth-form-subtitle">{subtitle}</p>}
          </header>

          {children}

          {/* Page chrome, not consent. Register.jsx carries the actual
              agreement sentence inside the form; this is the standing route to
              the documents from every other auth screen — login, forgot
              password, reset password — which previously had none at all.
              Plain <a> rather than <Link>: these are static pages outside the
              client-routed app, and a full navigation is the cheaper path. */}
          <nav className="auth-legal" aria-label="Legal">
            <a href="/terms">Terms</a>
            <span aria-hidden="true">·</span>
            <a href="/privacy">Privacy</a>
            <span aria-hidden="true">·</span>
            <a href="/legal">All policies</a>
          </nav>
        </div>
      </main>
    </div>
  );
}
