"use client";

// src/pages/Landing/LandingPage.jsx
import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { BarChart3, CalendarDays, LayoutDashboard, Minus, Plus, Settings, Sparkles } from "lucide-react";
const FEATURES = [
  {
    icon: (
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
        <path d="M13 2L23 7.5V18.5L13 24L3 18.5V7.5L13 2Z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <circle cx="13" cy="13" r="3.5" fill="currentColor" opacity="0.25"/>
        <path d="M13 9.5V13L16 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    title: "AI Content Engine",
    desc: "Generate platform-optimised captions, hashtags, and visuals in seconds. Trained on what actually performs.",
  },
  {
    icon: (
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
        <rect x="2" y="4" width="22" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <path d="M2 9H24" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M8 2V6M18 2V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <rect x="7" y="13" width="4" height="4" rx="1" fill="currentColor" opacity="0.4"/>
        <rect x="15" y="13" width="4" height="4" rx="1" fill="currentColor" opacity="0.25"/>
      </svg>
    ),
    title: "Smart Scheduler",
    desc: "AI analyses your audience activity and schedules posts at the exact moments they're most likely to engage.",
  },
  {
    icon: (
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
        <path d="M3 19L9 13L13 17L19 9L23 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="23" cy="13" r="2" fill="currentColor" opacity="0.4"/>
        <path d="M3 23H23" stroke="currentColor" strokeWidth="1" opacity="0.25"/>
      </svg>
    ),
    title: "Unified Analytics",
    desc: "One dashboard for all platforms. Track reach, engagement, and content performance without switching tabs.",
  },
  {
    icon: (
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
        <path d="M5 8H21M5 13H15M5 18H18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="20" cy="18" r="3" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <path d="M20 16.5V18L21 19" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    ),
    title: "Content Pipeline",
    desc: "Drafts, approvals, scheduling - all in a single visual pipeline. No more chasing content through spreadsheets.",
  },
  {
    icon: (
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
        <rect x="3" y="6" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <rect x="9" y="12" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.5"/>
        <path d="M9 10V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
      </svg>
    ),
    title: "Multi-Platform",
    desc: "Instagram, TikTok, Facebook, LinkedIn, YouTube - publish everywhere from one place with platform-specific formatting.",
  },
  {
    icon: (
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
        <path d="M4 13C4 13 7.5 6 13 6C18.5 6 22 13 22 13C22 13 18.5 20 13 20C7.5 20 4 13 4 13Z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <circle cx="13" cy="13" r="3" fill="currentColor" opacity="0.3"/>
        <circle cx="13" cy="13" r="1.5" fill="currentColor"/>
      </svg>
    ),
    title: "Live Preview",
    desc: "See exactly how your post looks on each platform before it goes live. Catch formatting issues before they're published.",
  },
];

const PLATFORMS = [
  { name: "Instagram", brandColor: "#E1306C" },
  { name: "TikTok", brandColor: "#69C9D0" },
  { name: "Facebook", brandColor: "#1877F2" },
  { name: "LinkedIn", brandColor: "#0A66C2" },
  { name: "YouTube", brandColor: "#FF0000" },
  { name: "X / Twitter", brandColor: "#94a3b8" },
];

const TESTIMONIALS = [
  {
    quote: "We cut content production time by 70%. SocialAI handles the heavy lifting so our team focuses on strategy.",
    name: "Amara Osei",
    role: "Head of Marketing, Kojo Retail",
    initials: "AO",
    tone: "primary",
  },
  {
    quote: "Finally, one tool that actually understands social media. The AI suggestions are eerily good - it knows our brand voice.",
    name: "Leilani Kahale",
    role: "Founder, Pono Wellness",
    initials: "LK",
    tone: "purple",
  },
  {
    quote: "Managing 8 client accounts used to be a nightmare. Now I schedule a full week of content in under an hour.",
    name: "Marcus Ferreira",
    role: "Digital Agency Owner",
    initials: "MF",
    tone: "soft",
  },
];

const FAQS = [
  {
    q: "How does SocialAI generate content for my brand?",
    a: "During onboarding, you tell us your industry, target audience, and brand tone. SocialAI uses this context every time it generates content, so posts always match your voice - not a generic AI template.",
  },
  {
    q: "Which social platforms are supported?",
    a: "Instagram, TikTok, Facebook, LinkedIn, and YouTube are fully supported at launch. X (Twitter) is in beta. More platforms are added regularly.",
  },
  {
    q: "Can I edit AI-generated content before it posts?",
    a: "Always. Every piece of AI output goes into your review queue first. You can edit, approve, reject, or request a variation before anything is scheduled or published.",
  },
  {
    q: "Is there a free plan?",
    a: "Yes - new accounts start with 100 free AI credits, enough to generate and schedule your first week of content. Paid plans unlock higher limits and automation features.",
  },
  {
    q: "How does smart scheduling work?",
    a: "SocialAI analyses your historical engagement data and audience activity patterns to recommend the optimal posting times. You can accept the suggestion, set your own time, or enable fully automated scheduling.",
  },
];

const MOCK_NAV = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Generate", icon: Sparkles, active: true },
  { label: "Calendar", icon: CalendarDays },
  { label: "Analytics", icon: BarChart3 },
  { label: "Settings", icon: Settings },
];

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);
  const [visible, setVisible] = useState({});
  const observerRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible((prev) => ({ ...prev, [entry.target.dataset.section]: true }));
          }
        });
      },
      { threshold: 0.12 }
    );
    document.querySelectorAll("[data-section]").forEach((el) =>
      observerRef.current.observe(el)
    );
    return () => observerRef.current?.disconnect();
  }, []);

  return (
    <div className="lp-root">
      <nav className={`lp-nav ${scrolled ? "lp-nav--raised" : ""}`}>
        <div className="lp-nav-inner">
          <Link href="/" className="lp-logo">
            <div className="lp-logo-mark">
              <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                <path d="M11 2L20 7V15L11 20L2 15V7L11 2Z" fill="url(#g1)"/>
                <circle cx="11" cy="11" r="3" fill="white" opacity="0.9"/>
                <defs>
                  <linearGradient id="g1" x1="2" y1="2" x2="20" y2="20">
                    <stop stopColor="var(--public-accent-light)"/>
                    <stop offset="1" stopColor="var(--public-accent)"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <span>SocialAI</span>
          </Link>

          <div className="lp-nav-links">
            <a href="#features">Features</a>
            <a href="#platforms">Platforms</a>
            <a href="#faq">FAQ</a>
          </div>

          <div className="lp-nav-cta">
            <Link href="/login" className="lp-nav-login">Log in</Link>
            <Link href="/register" className="lp-btn lp-btn--sm lp-btn--primary">
              Get started free
            </Link>
          </div>
        </div>
      </nav>

      <section className="lp-hero">
        <div className="lp-hero-glow lp-hero-glow--a" aria-hidden="true"/>
        <div className="lp-hero-glow lp-hero-glow--b" aria-hidden="true"/>
        <div className="lp-hero-grid" aria-hidden="true"/>

        <div className="lp-hero-content">
          <div className="lp-eyebrow">
            <span className="lp-eyebrow-dot"/>
            AI-powered social media for growing teams
          </div>

          <h1 className="lp-hero-h1">
            Create. Schedule.
            <br/>
            <span className="lp-gradient-text">Publish everywhere.</span>
          </h1>

          <p className="lp-hero-p">
            SocialAI turns your ideas into platform-ready content - captions, visuals,
            hashtags - then schedules everything at the perfect time.
            One workspace. Every platform.
          </p>

          <div className="lp-hero-actions">
            <Link href="/register" className="lp-btn lp-btn--lg lp-btn--primary">
              Start for free
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                <path d="M2.5 7.5H12.5M8.5 3.5L12.5 7.5L8.5 11.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
            <Link href="/login" className="lp-btn lp-btn--lg lp-btn--ghost">
              Log in to dashboard
            </Link>
          </div>

          <p className="lp-hero-note">
            No credit card required | 100 free AI credits on signup
          </p>
        </div>

        <div className="lp-mockup-wrap">
          <div className="lp-mockup">
            <div className="lp-mockup-titlebar">
              <div className="lp-mockup-dots" aria-hidden="true">
                <span/><span/><span/>
              </div>
              <div className="lp-mockup-url">app.socialai.io | Generate</div>
            </div>
            <div className="lp-mockup-layout">
              <div className="lp-mockup-sidebar">
                {MOCK_NAV.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className={`lp-mock-nav ${item.active ? "active" : ""}`}>
                      <span className="lp-mock-nav-icon">
                        <Icon size={14} aria-hidden="true" />
                      </span>
                      <span>{item.label}</span>
                    </div>
                  );
                })}
              </div>

              <div className="lp-mockup-main">
                <div className="lp-mock-heading">AI Content Studio</div>

                <div className="lp-mock-prompt">
                  <div className="lp-mock-prompt-inner">
                    New skincare line launch - highlight glow serum...
                    <span className="lp-mock-cursor"/>
                  </div>
                </div>

                <div className="lp-mock-chips">
                  <span className="lp-chip lp-chip--blue">Instagram</span>
                  <span className="lp-chip lp-chip--teal">TikTok</span>
                  <span className="lp-chip lp-chip--purple">Professional</span>
                  <span className="lp-chip lp-chip--dim">Drive Engagement</span>
                </div>

                <div className="lp-mock-output">
                  <div className="lp-mock-output-header">
                    <div className="lp-mock-pulse"/>
                    AI is drafting 3 variants...
                  </div>
                  <div className="lp-mock-skeleton">
                    <div className="lp-sk-line lp-sk-line--full"/>
                    <div className="lp-sk-line lp-sk-line--80"/>
                    <div className="lp-sk-line lp-sk-line--60"/>
                  </div>
                </div>

                <div className="lp-mock-kpis">
                  <div className="lp-mock-kpi">
                    <span className="lp-mock-kpi-val">48</span>
                    <span className="lp-mock-kpi-label">Scheduled</span>
                  </div>
                  <div className="lp-mock-kpi">
                    <span className="lp-mock-kpi-val">96%</span>
                    <span className="lp-mock-kpi-label">Published</span>
                  </div>
                  <div className="lp-mock-kpi">
                    <span className="lp-mock-kpi-val">320</span>
                    <span className="lp-mock-kpi-label">Credits</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="lp-mockup-shadow"/>
        </div>
      </section>

      <section id="platforms" className="lp-platforms-section">
        <div
          className={`lp-platforms-inner lp-animate ${visible["platforms"] ? "lp-in" : ""}`}
          data-section="platforms"
        >
          <p className="lp-platforms-label">Publish natively to every major platform</p>
          <div className="lp-platforms-row">
            {PLATFORMS.map((p) => (
              <div key={p.name} className="lp-platform-pill" style={{ "--pc": p.brandColor }}>
                <span className="lp-platform-dot"/>
                {p.name}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="lp-features-section">
        <div
          className={`lp-section-wrap lp-animate ${visible["features"] ? "lp-in" : ""}`}
          data-section="features"
        >
          <div className="lp-section-label">Features</div>
          <h2 className="lp-section-h2">Everything you need to run social at scale</h2>
          <p className="lp-section-lead">
            Built for businesses that need to move fast without sacrificing quality or consistency.
          </p>
          <div className="lp-features-grid">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="lp-feature-card"
                style={{ animationDelay: `${i * 55}ms` }}
              >
                <div className="lp-feature-icon-wrap">{f.icon}</div>
                <h3 className="lp-feature-name">{f.title}</h3>
                <p className="lp-feature-body">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-how-section">
        <div
          className={`lp-section-wrap lp-animate ${visible["how"] ? "lp-in" : ""}`}
          data-section="how"
        >
          <div className="lp-section-label">How it works</div>
          <h2 className="lp-section-h2">From idea to published post in minutes</h2>
          <div className="lp-steps">
            {[
              {
                n: "01",
                title: "Set up your brand",
                desc: "Tell SocialAI your industry, audience, and tone. Takes 2 minutes and makes every piece of AI output feel like you wrote it yourself.",
              },
              {
                n: "02",
                title: "Generate content",
                desc: "Enter a topic or campaign idea. SocialAI produces platform-ready captions, hashtags, and image prompts for every channel - all at once.",
              },
              {
                n: "03",
                title: "Review & publish",
                desc: "Preview how each post looks on every platform. Approve what you like and set your schedule - or let the AI handle the timing automatically.",
              },
            ].map((s, i) => (
              <div key={s.n} className="lp-step">
                <div className="lp-step-number">{s.n}</div>
                <div className="lp-step-text">
                  <h3 className="lp-step-title">{s.title}</h3>
                  <p className="lp-step-desc">{s.desc}</p>
                </div>
                {i < 2 && <div className="lp-step-line" aria-hidden="true"/>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-testimonials-section">
        <div
          className={`lp-section-wrap lp-animate ${visible["testimonials"] ? "lp-in" : ""}`}
          data-section="testimonials"
        >
          <div className="lp-section-label">Social proof</div>
          <h2 className="lp-section-h2">Teams that made the switch</h2>
          <div className="lp-testimonials-grid">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="lp-testimonial">
                <p className="lp-testimonial-text">"{t.quote}"</p>
                <div className="lp-testimonial-author">
                  <div className={`lp-testimonial-avatar lp-testimonial-avatar--${t.tone}`}>
                    {t.initials}
                  </div>
                  <div>
                    <div className="lp-testimonial-name">{t.name}</div>
                    <div className="lp-testimonial-role">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="lp-faq-section">
        <div
          className={`lp-section-wrap lp-animate ${visible["faq"] ? "lp-in" : ""}`}
          data-section="faq"
        >
          <div className="lp-section-label">FAQ</div>
          <h2 className="lp-section-h2">Common questions</h2>
          <div className="lp-faq-list">
            {FAQS.map((item, i) => {
              const open = openFaq === i;
              const answerId = `lp-faq-answer-${i}`;
              return (
                <div key={item.q} className={`lp-faq-item ${open ? "lp-faq-item--open" : ""}`}>
                  <button
                    type="button"
                    className="lp-faq-q"
                    aria-expanded={open}
                    aria-controls={answerId}
                    onClick={() => setOpenFaq(open ? null : i)}
                  >
                    <span>{item.q}</span>
                    <span className="lp-faq-toggle" aria-hidden="true">
                      {open ? <Minus size={18} /> : <Plus size={18} />}
                    </span>
                  </button>
                  <div id={answerId} className="lp-faq-a-wrap">
                    <div className="lp-faq-a">{item.a}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="lp-cta-section">
        <div
          className={`lp-cta-inner lp-animate ${visible["cta"] ? "lp-in" : ""}`}
          data-section="cta"
        >
          <div className="lp-cta-glow" aria-hidden="true"/>
          <h2 className="lp-cta-h2">Ready to stop manually posting?</h2>
          <p className="lp-cta-p">
            Join teams already using SocialAI to ship consistent, high-quality content - without the grind.
          </p>
          <Link href="/register" className="lp-btn lp-btn--lg lp-btn--primary">
            Create your free account
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <path d="M2.5 7.5H12.5M8.5 3.5L12.5 7.5L8.5 11.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
          <p className="lp-cta-note">No credit card required | Cancel anytime</p>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <Link href="/" className="lp-logo">
              <div className="lp-logo-mark">
                <svg width="18" height="18" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                  <path d="M11 2L20 7V15L11 20L2 15V7L11 2Z" fill="url(#g2)"/>
                  <circle cx="11" cy="11" r="3" fill="white" opacity="0.9"/>
                  <defs>
                    <linearGradient id="g2" x1="2" y1="2" x2="20" y2="20">
                      <stop stopColor="var(--public-accent-light)"/>
                      <stop offset="1" stopColor="var(--public-accent)"/>
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <span>SocialAI</span>
            </Link>
            <p className="lp-footer-tagline">
              The content operations engine for modern social teams.
            </p>
          </div>

          <div className="lp-footer-links">
            <div className="lp-footer-col">
              <p className="lp-footer-col-title">Product</p>
              <a href="#features">Features</a>
              <a href="#platforms">Platforms</a>
              <a href="#faq">FAQ</a>
            </div>
            <div className="lp-footer-col">
              <p className="lp-footer-col-title">Account</p>
              <Link href="/login">Log in</Link>
              <Link href="/register">Sign up free</Link>
            </div>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <span>{new Date().getFullYear()} SocialAI | All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
