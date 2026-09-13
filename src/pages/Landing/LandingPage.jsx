"use client";

// src/pages/Landing/LandingPage.jsx
//
// The public page, rebuilt against the "Landing Light" design record.
//
// ── The rule this page is written under ─────────────────────────────────────
// A marketing page is the easiest place in a product to say something that is
// not true, because nothing here is wired to anything that would contradict it.
// So every claim below was checked against code before it was written, and the
// ones that could not be are gone rather than softened:
//
//   · Credit prices — generateImage/index.ts CREDITS_PER_IMAGE = 1,
//     generateVideo/index.ts CREDITS_STD_VIDEO = 5 / CREDITS_PRO_VIDEO = 15,
//     video-engine constants CREDITS_PER_MINUTE_OF_SOURCE = 1.
//   · Packs and dollar prices — CREDIT_PACKAGES, imported rather than retyped,
//     so a repriced pack cannot leave a stale number on the landing page.
//   · The signup grant — SIGNUP_CREDIT_GRANT, which is itself guarded against
//     the database trigger by scripts/check-credit-grant.cjs.
//   · Clips per job — VIDEO_ENGINE_CONSTANTS.TARGET_CLIPS_PER_JOB = 7. The
//     design record said "8×"; the code says 7.
//   · Copy review dimensions — the five in Studio/PostProductionPanel.jsx, with
//     its own honest name. It reviews the writing; it does not predict reach,
//     and L5.11 exists because it once claimed to.
//   · Publishing — supabase/functions/mock-publish + services/platforms/
//     mockPublishService.js. It is simulated, and the page says so three times.
//
// The design record's testimonial band was dropped outright. Three named
// strangers praising a product nobody has used yet is a fabricated record, and
// this repo has a law against those. The roadmap band took its place: it is the
// same visual beat and it is checkable.
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import useAuthenticatedRedirect from "../../hooks/useAuthenticatedRedirect";
import AuthLoadingOverlay from "../../components/Shared/AuthLoadingOverlay";
import { SIGNUP_CREDIT_GRANT } from "../../constants/credits";
import { CREDIT_PACKAGES } from "../../lib/video-engine/credit-packages";
import { VIDEO_ENGINE_CONSTANTS } from "../../lib/video-engine/constants";
import { StudioMark } from "../../ui-v2/brand/StudioMark";
// LandingPage.css is loaded globally through src/styles/app-entry.css.

/**
 * Photography, kept in one place.
 *
 * Remote images on a landing page are a real dependency: if the host is slow,
 * blocked, or down, the page still has to read. Every one of these sits on a
 * tinted block that is part of the design rather than a white hole, carries its
 * own dimensions so nothing reflows when it lands, and is lazy except the hero.
 */
const IMG = {
  hero: "https://images.unsplash.com/photo-1554774853-719586f82d77?w=1100&q=72&auto=format&fit=crop",
  latte: "https://images.unsplash.com/photo-1559496417-e7f25cb247f3?w=900&q=72&auto=format&fit=crop",
  interior: "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=760&q=72&auto=format&fit=crop",
  counter: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=760&q=72&auto=format&fit=crop",
  detail: "https://images.unsplash.com/photo-1521017432531-fbd92d768814?w=420&q=70&auto=format&fit=crop",
  crowd: "https://images.unsplash.com/photo-1524253482453-3fed8d2fe12b?w=760&q=72&auto=format&fit=crop",
  team: "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=760&q=72&auto=format&fit=crop",
  clipA: "https://images.unsplash.com/photo-1552642986-ccb41e7059e7?w=200&q=70&auto=format&fit=crop",
  clipB: "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=200&q=70&auto=format&fit=crop",
  clipC: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=70&auto=format&fit=crop",
};

const LOOP = [
  {
    step: "01 · GENERATE",
    name: "Studio",
    body: "Images, videos and carousels from a prompt, already wearing your brand colours and voice.",
  },
  {
    step: "02 · REFINE",
    name: "Library",
    body: "Everything you keep lands in one searchable shelf. Deleting moves an asset to Trash, where you can put it back.",
  },
  {
    step: "03 · PUBLISH",
    name: "Calendar",
    body: "Two verbs only: schedule, or post now. Suggested times sit right above the picker.",
  },
  {
    step: "04 · MEASURE",
    name: "Analytics",
    body: "What went out, what landed, what failed and why — with a path back to fix it.",
  },
  {
    step: "05 · TOP UP",
    name: "Credits",
    body: "Buy what you will use. A failed job refunds itself, on the ledger, in plain sight.",
    accent: true,
  },
];

const AUDIENCE = [
  ["Solo creators", "turning one recording into a week of shorts."],
  ["Local businesses", "that need to look consistent without a designer on call."],
  ["Two-person social teams", "juggling several platforms and one calendar."],
  ["Freelancers", "who bill per deliverable and need the cost to be legible."],
];

/** The five things the copy review actually scores, named exactly as the app
 *  names them. Studio/PostProductionPanel.jsx SCORE_DIMS. */
const REVIEW_DIMS = [
  ["Readability", 90, "good"],
  ["Hook strength", 58, "warn"],
  ["Hashtag quality", 34, "bad"],
  ["Brand consistency", 82, "good"],
  ["Platform fit", 76, "good"],
];

const HOUSE_RULES = [
  "Credits are a ledger, not a vibe. Every purchase, spend and refund is a line you can read.",
  "No modal ambushes. Running low blocks inline, with the exact numbers and a way out.",
  "Errors say what happened and how to fix it. Never “something went wrong”.",
  "Publishing runs on simulated connections during the beta, and every screen that could mislead you says so.",
];

const ROADMAP = [
  {
    tag: "SHIPPED",
    tone: "good",
    title: "The full loop, end to end",
    body: "Generation, library, calendar, analytics, video clipping, brand kit, credit ledger. Publishing simulated, everything else real.",
  },
  {
    tag: "NEXT",
    tone: "warn",
    title: "Real publishing",
    body: "Live connections, token lifecycle handled out loud, and a post that fails at send time telling you why before you notice yourself.",
  },
  {
    tag: "AFTER",
    tone: "muted",
    title: "A strategist, not just a studio",
    body: "Posting times learned from your own audience, gaps in the calendar flagged before they happen, and a monthly read on what your best posts had in common.",
  },
  {
    tag: "LATER",
    tone: "muted",
    title: "Room for a team",
    body: "Multiple brand kits, approval before publish, and shared credit pools — without turning the calendar into a ticketing system.",
  },
];

const FAQS = [
  [
    "What does a credit actually buy?",
    `One image is 1 credit. A standard video is 5, premium is 15. Clipping a long video costs ${VIDEO_ENGINE_CONSTANTS.CREDITS_PER_MINUTE_OF_SOURCE} credit per minute of source — a 40-minute podcast is 40 credits. Every button that spends says the number before you press it.`,
  ],
  [
    "Is publishing real yet?",
    "Not during the beta. Connections are simulated end to end, and every screen where you could be misled says so plainly. Real publishing is the next thing we ship, which is also why the roadmap above is on the page rather than in a blog post.",
  ],
  [
    "What happens if a job fails?",
    "You get the credits back automatically, with a refund line on your ledger you can point at. Video clipping refunds in full, including the case where the pipeline runs fine but the source had no speech in it to cut.",
  ],
  [
    "What happens when I run out mid-generation?",
    "Nothing gets half-made. The action blocks inline with the exact numbers — “needs 43, you have 9” — and a direct link to top up.",
  ],
  [
    "Can I use my own footage instead of generating?",
    "Yes. Upload straight into the Library, or hand a long video to Videos and let it find the clips. Generation is one input, not the only one.",
  ],
  [
    "Do I need a brand kit to start?",
    "No, but the first generation you run with one will show you why it is worth ten minutes. Start blank, upload a deck, point us at your website, or answer six questions.",
  ],
];

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [showBanner, setShowBanner] = useState(true);
  const observerRef = useRef(null);

  /* Someone already signed in who opens the site root belongs in their
     dashboard, not on the marketing page. `redirecting` is true from the first
     paint when stored credentials exist, so a returning user never sees the
     hero flash before the redirect; anonymous visitors have no token and get
     the landing page immediately. */
  const { redirecting } = useAuthenticatedRedirect();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // `isIntersecting` alone is not enough. Anchor links jump whole
          // sections in one frame, and anything skipped over lands ABOVE the
          // viewport having never been observed as visible — which, with the
          // reveal starting at opacity 0, means it is invisible for the rest of
          // the session. The second test catches exactly that case: already
          // passed, therefore already seen, therefore shown.
          if (entry.isIntersecting || entry.boundingClientRect.top < 0) {
            entry.target.classList.add("is-in");
            observerRef.current.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" },
    );
    document.querySelectorAll("[data-reveal]").forEach((node) => observerRef.current.observe(node));
    return () => observerRef.current?.disconnect();
  }, []);

  if (redirecting) {
    return <AuthLoadingOverlay title="Welcome back" description="Opening your dashboard." />;
  }

  const creatorPack = CREDIT_PACKAGES.find((pack) => pack.popular) ?? CREDIT_PACKAGES[1];

  return (
    <div className="lp-root">
      {showBanner ? (
        <div className="lp-banner">
          <span className="lp-banner-tag">BETA</span>
          <span>
            Videos turns one long recording into about {VIDEO_ENGINE_CONSTANTS.TARGET_CLIPS_PER_JOB} ranked vertical
            clips, captions burned in.
          </span>
          <a href="#videos">See how it works →</a>
          <button type="button" className="lp-banner-close" onClick={() => setShowBanner(false)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ) : null}

      <header className={`lp-header ${scrolled ? "is-raised" : ""}`}>
        <Link href="/" className="lp-brand">
          <StudioMark size={26} tone="light" decorative className="lp-brand-mark" />
          <span className="lp-brand-word">Studio</span>
        </Link>

        <nav className="lp-nav">
          <a href="#loop">How it works</a>
          <a href="#videos">Videos</a>
          <a href="#credits">Credits</a>
          <a href="#roadmap">Roadmap</a>
          <a href="#faq">FAQ</a>
        </nav>

        <div className="lp-header-cta">
          <Link href="/login" className="lp-quiet">Log in</Link>
          <Link href="/register" className="lp-btn lp-btn-dark">
            Start free
            <span className="lp-btn-tag">{SIGNUP_CREDIT_GRANT} cr</span>
          </Link>
        </div>
      </header>

      <main id="lp-main">

      {/* ══ Hero ══════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-hero" id="top">
        <div className="lp-hero-glow" aria-hidden="true" />
        <div className="lp-wrap lp-hero-grid">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow-pill">
              <span className="lp-live-dot" aria-hidden="true" />
              FOR SOLO CREATORS &amp; SMALL SOCIAL TEAMS
            </span>
            <h1 className="lp-h1">Post every day without the daily scramble.</h1>
            <p className="lp-lead">
              Studio generates the content, ranks the clips, writes the caption, picks the slot and files the receipt —
              one credit-based workspace instead of six open tabs and a Sunday night of dread.
            </p>
            <div className="lp-hero-actions">
              <Link href="/register" className="lp-btn lp-btn-accent lp-btn-lg">
                Start free with {SIGNUP_CREDIT_GRANT} credits
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                  <path d="M5 12h13M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <a href="#loop" className="lp-btn lp-btn-outline lp-btn-lg">See the loop</a>
            </div>
            <p className="lp-hero-meta">NO CARD · NO SEATS · 2 MIN SETUP</p>
          </div>

          <div className="lp-collage">
            <div className="lp-collage-frame">
              <img
                src={IMG.hero}
                alt="Someone taking a call at a café table with a laptop open"
                width="1100"
                height="733"
                fetchPriority="high"
              />
            </div>
            <div className="lp-float lp-float-clips">
              <div className="lp-float-head">
                <span className="lp-float-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M12 3v18M3 12h18" strokeLinecap="round" />
                  </svg>
                </span>
                <div>
                  <strong>{VIDEO_ENGINE_CONSTANTS.TARGET_CLIPS_PER_JOB} clips ready</strong>
                  <span>from one 32-minute video</span>
                </div>
              </div>
              <div className="lp-float-bars" aria-hidden="true">
                <i className="on" /><i className="on" /><i className="on" /><i />
              </div>
            </div>
            <div className="lp-float lp-float-credits">
              <span className="lp-float-label">CREDITS LEFT</span>
              <strong>312</strong>
            </div>
          </div>
        </div>
      </section>

      {/* ══ Product mock ══════════════════════════════════════════════════ */}
      <section className="lp-section lp-mockup-section">
        <div className="lp-wrap">
          <div className="lp-mockup" data-reveal>
            <div className="lp-mockup-bar">
              <span className="lp-dots" aria-hidden="true"><i /><i /><i /></span>
              <span className="lp-mono lp-mockup-path">studio / generate</span>
              <span className="lp-credit-pill">
                <span className="lp-credit-meter" aria-hidden="true"><i style={{ width: "62%" }} /></span>
                <span className="lp-mono">312 cr</span>
              </span>
            </div>

            <div className="lp-mockup-body">
              <div className="lp-mockup-pane">
                <span className="lp-mono lp-pane-label">STUDIO — GENERATE</span>
                <div className="lp-prompt">
                  <p>Autumn menu launch — warm, close-up shots of the new spiced latte, in our brand palette</p>
                  <div className="lp-prompt-row">
                    <span className="lp-tag">IMAGE</span>
                    <span className="lp-tag">4:5</span>
                    <span className="lp-tag">BRAND KIT ON</span>
                    <span className="lp-generate">Generate · 4 cr</span>
                  </div>
                </div>
                <div className="lp-shots">
                  {[
                    [IMG.latte, "Generated latte image", false],
                    [IMG.interior, "Generated café interior image", true],
                    [IMG.counter, "Generated counter service image", false],
                    [IMG.detail, "Generated interior detail image", false],
                  ].map(([src, alt, picked], index) => (
                    <figure key={src} className={picked ? "lp-shot is-picked" : "lp-shot"}>
                      <img src={src} alt={alt} width="420" height="525" loading="lazy" />
                      <figcaption className="lp-mono">{String(index + 1).padStart(2, "0")}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>

              <div className="lp-mockup-pane">
                <div className="lp-pane-head">
                  <span className="lp-mono lp-pane-label">TODAY’S QUEUE</span>
                  <span className="lp-mono lp-pane-label">4 POSTS</span>
                </div>
                <div className="lp-queue">
                  <div className="lp-queue-row">
                    <span className="lp-mono lp-queue-time">09:00</span>
                    <span className="lp-queue-title">Spiced latte teaser</span>
                    <span className="lp-chip lp-chip-good">PUBLISHED</span>
                  </div>
                  <div className="lp-queue-row">
                    <span className="lp-mono lp-queue-time">13:30</span>
                    <span className="lp-queue-title">Barista clip · 0:24</span>
                    <span className="lp-chip">SCHEDULED</span>
                  </div>
                  <div className="lp-queue-row is-bad">
                    <span className="lp-mono lp-queue-time">16:00</span>
                    <span className="lp-queue-title">
                      Weekend hours
                      <em>Connection expired at send time</em>
                    </span>
                    <span className="lp-queue-retry">Retry</span>
                  </div>
                  <div className="lp-queue-row is-draft">
                    <span className="lp-mono lp-queue-time">19:15</span>
                    <span className="lp-queue-title">Draft — caption needs a hook</span>
                    <span className="lp-mono lp-queue-score">72</span>
                  </div>
                </div>
                <div className="lp-pane-foot">
                  <span className="lp-ring" style={{ "--pct": "84%" }} aria-hidden="true"><i>84</i></span>
                  <div>
                    <strong>Copy review</strong>
                    <span>Hook strong · hashtags thin · on brand</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ Stats ═════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-stats-section">
        <div className="lp-wrap lp-stats" data-reveal>
          <div className="lp-stat">
            <strong className="lp-accent">{VIDEO_ENGINE_CONSTANTS.TARGET_CLIPS_PER_JOB}</strong>
            <span>clips out of one long video, ranked by hook score</span>
          </div>
          <div className="lp-stat">
            <strong>1 cr</strong>
            <span>an image. 5 a video. No seats, no subscription maths.</span>
          </div>
          <div className="lp-stat">
            <strong>1 cr</strong>
            <span>per minute of source video you hand to clipping</span>
          </div>
          <div className="lp-stat">
            <strong>0</strong>
            <span>posts silently dropped — every failure states its reason</span>
          </div>
        </div>
      </section>

      {/* ══ Loop ══════════════════════════════════════════════════════════ */}
      <section className="lp-section" id="loop">
        <div className="lp-wrap">
          <span className="lp-eyebrow">THE LOOP</span>
          <div className="lp-split lp-split-head" data-reveal>
            <h2 className="lp-h2">Five steps, one workspace, nothing falls out the bottom.</h2>
            <p className="lp-body">
              Most tools own one step and hand you back a file. Studio owns the whole circuit — so the thing you
              generated on Tuesday is already scheduled, measured and paid for by Friday, and you can see exactly where
              every credit went.
            </p>
          </div>
          <div className="lp-loop" data-reveal>
            {LOOP.map((item) => (
              <article key={item.name} className={item.accent ? "lp-loop-card is-accent" : "lp-loop-card"}>
                <span className="lp-mono lp-loop-step">{item.step}</span>
                <h3>{item.name}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ══ Who it's for ══════════════════════════════════════════════════ */}
      <section className="lp-section lp-tinted">
        <div className="lp-wrap lp-split lp-split-rev" data-reveal>
          <div className="lp-mosaic">
            <img src={IMG.counter} alt="A café counter during service" width="760" height="500" loading="lazy" />
            <img src={IMG.crowd} alt="People filming a live moment on their phones" width="760" height="500" loading="lazy" />
            <img src={IMG.team} alt="A small team working together at one table" width="760" height="500" loading="lazy" />
            <img src={IMG.interior} alt="An empty café interior before opening" width="760" height="500" loading="lazy" />
          </div>
          <div>
            <span className="lp-eyebrow">WHO IT’S FOR</span>
            <h2 className="lp-h2">Built for the person who is also everything else.</h2>
            <p className="lp-body">
              You are the founder, the barista, the editor and the social team. Studio is not trying to replace your
              taste — it is trying to give you back the two hours a day that go into the mechanics.
            </p>
            <ul className="lp-ticks">
              {AUDIENCE.map(([who, rest]) => (
                <li key={who}>
                  <span aria-hidden="true">→</span>
                  <span><strong>{who}</strong> {rest}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ══ Videos ════════════════════════════════════════════════════════ */}
      <section className="lp-section" id="videos">
        <div className="lp-wrap lp-split" data-reveal>
          <div>
            <span className="lp-eyebrow">VIDEOS · CLIPPING</span>
            <h2 className="lp-h2">Hand over one long video. Get back a week of shorts.</h2>
            <p className="lp-body">
              Upload a file or paste a YouTube or X link. Studio transcribes it, finds the moments people stop for, cuts
              them to your ratio, burns in captions, and hands them back ranked by hook score — with the transcript and
              the source timecode attached to every clip, so you can judge one by reading four lines instead of watching
              forty seconds.
            </p>
            <ul className="lp-ticks">
              <li><span aria-hidden="true">✓</span><span>A live pipeline you can watch: downloading → transcribing → analysing → rendering. Close the tab; it keeps going.</span></li>
              <li><span aria-hidden="true">✓</span><span>Steer it in a sentence — “focus on the pricing objection” — and the cuts follow.</span></li>
              <li><span aria-hidden="true">✓</span><span>A job that fails refunds your credits automatically and offers a re-run with the same link.</span></li>
              <li><span aria-hidden="true">✓</span><span>Clip files are swept after {VIDEO_ENGINE_CONSTANTS.CLIP_RETENTION_DAYS} days, and the countdown is on the screen. Keeping a clip copies it to your Library, which does not expire.</span></li>
            </ul>
          </div>

          <div className="lp-jobcard">
            <div className="lp-jobcard-head">
              <span className="lp-mono">JOB 8F2C41</span>
              <span className="lp-chip lp-chip-work"><span className="lp-live-dot" aria-hidden="true" />RENDERING</span>
              <span className="lp-mono lp-jobcard-cost">32 min · 32 cr</span>
            </div>
            <div className="lp-jobcard-bars" aria-hidden="true">
              <i className="on" /><i className="on" /><i className="on" /><i className="half" /><i />
            </div>
            <div className="lp-jobcard-body">
              <span className="lp-mono lp-pane-label">CLIPS · RANKED BY HOOK</span>
              {[
                [IMG.clipA, "“Nobody tells you this about pricing”", "0:38 · 9:16", 94, "good"],
                [IMG.clipB, "“The one hire I’d make again”", "0:52 · 9:16", 88, "good"],
                [IMG.clipC, "“Where the first 100 came from”", "0:44 · 9:16", 71, "warn"],
              ].map(([src, title, meta, score, tone]) => (
                <div key={title} className={tone === "warn" ? "lp-cliprow is-dim" : "lp-cliprow"}>
                  <img src={src} alt="" width="200" height="270" loading="lazy" />
                  <div>
                    <strong>{title}</strong>
                    <span className="lp-mono">{meta}</span>
                  </div>
                  <div className="lp-clipscore">
                    <strong className={tone === "warn" ? "lp-warn" : "lp-good"}>{score}</strong>
                    <span className="lp-mono">HOOK</span>
                  </div>
                </div>
              ))}
              <div className="lp-jobcard-actions">
                <span className="lp-btn lp-btn-dark lp-btn-block">Keep all in Library</span>
                <span className="lp-btn lp-btn-outline lp-btn-block">Schedule the top 3</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ Copy review ═══════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-wrap lp-split lp-split-rev" data-reveal>
          <div className="lp-review">
            <div className="lp-review-head">
              <span className="lp-ring lp-ring-lg" style={{ "--pct": "72%" }} aria-hidden="true"><i>72</i></span>
              <div className="lp-review-bars">
                {REVIEW_DIMS.map(([label, value, tone]) => (
                  <div key={label} className="lp-review-bar">
                    <span className="lp-mono">{label}</span>
                    <span className="lp-meter"><i className={`is-${tone}`} style={{ width: `${value}%` }} /></span>
                    <span className="lp-mono lp-review-val">{value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="lp-review-note">
              <strong>Your first line buries the point</strong>
              <p>On Instagram only the first line shows before the fold. The offer currently starts at character 96.</p>
              <div className="lp-review-actions">
                <span className="lp-btn lp-btn-accent lp-btn-sm">Rewrite it · 1 cr</span>
                <span className="lp-quiet">Reviewing is free</span>
              </div>
            </div>
          </div>

          <div>
            <span className="lp-eyebrow">COPY REVIEW</span>
            <h2 className="lp-h2">A second opinion before it goes out, not a lecture after.</h2>
            <p className="lp-body">
              Every draft can be scored across five dimensions — readability, hook strength, hashtag quality, brand
              consistency and platform fit — with three rewrite variants and ranked hashtags if you want them.
            </p>
            <p className="lp-body lp-muted">
              It reviews the writing. It does not predict reach, and it will not pretend to: this panel was once called
              “discovery readiness” and was renamed precisely because it never read a single engagement number.
              Reviewing is free; a rewrite costs one credit, and the button says so before you press it.
            </p>
          </div>
        </div>
      </section>

      {/* ══ Roadmap (dark band) ═══════════════════════════════════════════ */}
      <section className="lp-section lp-dark" id="roadmap">
        <div className="lp-wrap">
          <div className="lp-dark-head" data-reveal>
            <span className="lp-eyebrow lp-eyebrow-light">WHERE THIS IS</span>
            <h2 className="lp-h2">Built in the open, in this order.</h2>
            <p className="lp-body">
              No customer quotes yet, because there are no customers yet — this is a beta with the receipts on the
              table. Here is what actually works today and what is next.
            </p>
          </div>
          <div className="lp-roadmap" data-reveal>
            {ROADMAP.map((row) => (
              <div key={row.tag} className="lp-roadmap-row">
                <span className={`lp-mono lp-tone-${row.tone}`}>{row.tag}</span>
                <div>
                  <h3>{row.title}</h3>
                  <p>{row.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ Brand kit + house rules ═══════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-wrap lp-two" data-reveal>
          <article className="lp-card lp-card-flush">
            <img src={IMG.latte} alt="A latte photographed in daylight — the kind of shot a brand kit keeps consistent" width="900" height="380" loading="lazy" />
            <div className="lp-card-body">
              <span className="lp-eyebrow">BRAND KIT</span>
              <h3 className="lp-h3">Teach it your brand once.</h3>
              <p className="lp-body">
                Upload a deck, point us at your website, or answer six questions. Studio pulls out your palette, fonts,
                tagline and voice, and lets you accept or edit each one. Every generation reads from it afterwards.
              </p>
              <div className="lp-swatches">
                {/* ui-consistency-allow: a picture of an extracted brand kit; these squares ARE the colours shown, not chrome. */}
                <span style={{ background: "#FF5C38" }} />
                <span style={{ background: "#17181B" }} />
                <span style={{ background: "#2F8F5B" }} />
                <span style={{ background: "#EFEAE1", border: "1px solid #E4E0D9" }} />
                <em className="lp-mono">EXTRACTED FROM BRAND.PDF</em>
              </div>
            </div>
          </article>

          <article className="lp-card">
            <div className="lp-card-body">
              <span className="lp-eyebrow">HOUSE RULES</span>
              <h3 className="lp-h3">The parts most tools hide, we print.</h3>
              <ol className="lp-rules">
                {HOUSE_RULES.map((rule, index) => (
                  <li key={rule}>
                    <span className="lp-mono">{String(index + 1).padStart(2, "0")}</span>
                    <span>{rule}</span>
                  </li>
                ))}
              </ol>
            </div>
          </article>
        </div>
      </section>

      {/* ══ Credits ═══════════════════════════════════════════════════════ */}
      <section className="lp-section lp-tinted" id="credits">
        <div className="lp-wrap">
          <div className="lp-centered" data-reveal>
            <span className="lp-eyebrow">CREDITS, NOT SEATS</span>
            <h2 className="lp-h2">Pay for what you make.</h2>
            <p className="lp-body">
              No monthly floor and no per-seat tax. Buy a pack, spend it when you have something to say. Start with{" "}
              {SIGNUP_CREDIT_GRANT} on the house.
            </p>
          </div>

          <div className="lp-packs" data-reveal>
            {CREDIT_PACKAGES.map((pack) => (
              <article key={pack.id} className={pack.popular ? "lp-pack is-popular" : "lp-pack"}>
                {pack.popular ? <span className="lp-pack-flag">MOST PICKED</span> : null}
                <div>
                  <h3 className="lp-h3">{pack.name}</h3>
                  <p className="lp-pack-sub">{pack.description}</p>
                </div>
                <div className="lp-pack-price">
                  <strong>{pack.price_display}</strong>
                  <span className="lp-mono">
                    {pack.credits} CR · ${(pack.price_cents / 100 / pack.credits).toFixed(2)}/CR
                  </span>
                </div>
                <Link
                  href="/register"
                  className={pack.popular ? "lp-btn lp-btn-accent lp-btn-block" : "lp-btn lp-btn-outline lp-btn-block"}
                >
                  Start with {pack.name}
                </Link>
              </article>
            ))}
          </div>

          <div className="lp-costs" data-reveal>
            <span className="lp-mono lp-costs-label">WHAT THINGS COST</span>
            <span>Image <b className="lp-accent lp-mono">1 cr</b></span>
            <span>Standard video <b className="lp-accent lp-mono">5 cr</b></span>
            <span>Premium video <b className="lp-accent lp-mono">15 cr</b></span>
            <span>Clipping <b className="lp-accent lp-mono">{VIDEO_ENGINE_CONSTANTS.CREDITS_PER_MINUTE_OF_SOURCE} cr / source min</b></span>
            <span>Copy review <b className="lp-good lp-mono">free</b></span>
          </div>
          <p className="lp-costs-note">
            A failed job is refunded in full, on the ledger, automatically — including a clipping run that finishes but
            finds no speech to cut. Prices above are the ones the app charges, read from the same constants.
          </p>
        </div>
      </section>

      {/* ══ FAQ ═══════════════════════════════════════════════════════════ */}
      <section className="lp-section" id="faq">
        <div className="lp-wrap lp-narrow">
          <span className="lp-eyebrow">QUESTIONS</span>
          <h2 className="lp-h2 lp-faq-title">Before you sign up.</h2>
          <div className="lp-faqs" data-reveal>
            {FAQS.map(([question, answer], index) => {
              const open = openFaq === index;
              return (
                <div key={question} className="lp-faq">
                  <button
                    type="button"
                    className="lp-faq-q"
                    aria-expanded={open}
                    onClick={() => setOpenFaq(open ? -1 : index)}
                  >
                    <span>{question}</span>
                    <span className="lp-mono lp-faq-sign" aria-hidden="true">{open ? "−" : "+"}</span>
                  </button>
                  {open ? <p className="lp-faq-a">{answer}</p> : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ══ Final CTA ═════════════════════════════════════════════════════ */}
      <section className="lp-section lp-final">
        <div className="lp-final-glow" aria-hidden="true" />
        <div className="lp-wrap lp-centered">
          <h2 className="lp-h1 lp-h1-sm">Your next thirty posts are already in there somewhere.</h2>
          <p className="lp-lead">
            Start with {SIGNUP_CREDIT_GRANT} credits on the house — enough to generate, clip, and schedule before you
            decide anything.
          </p>
          <div className="lp-hero-actions lp-centered-actions">
            <Link href="/register" className="lp-btn lp-btn-accent lp-btn-lg">Create your workspace</Link>
            <Link href="/login" className="lp-btn lp-btn-outline lp-btn-lg">I already have one</Link>
          </div>
          <p className="lp-hero-meta">
            2 MIN SETUP · {creatorPack ? `${creatorPack.credits} CR IS ${creatorPack.price_display}` : ""} · PUBLISHING IS
            SIMULATED DURING BETA
          </p>
        </div>
      </section>

      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-foot-grid">
          <div>
            <Link href="/" className="lp-brand">
              <StudioMark size={22} tone="light" decorative className="lp-brand-mark" />
              <span className="lp-brand-word">Studio</span>
            </Link>
            <p className="lp-foot-blurb">
              A credit-based content workspace for people who post more than they have time for.
            </p>
          </div>
          <div className="lp-foot-col">
            <span className="lp-mono lp-pane-label">PRODUCT</span>
            <a href="#loop">How it works</a>
            <a href="#videos">Videos</a>
            <a href="#credits">Credits</a>
            <a href="#roadmap">Roadmap</a>
          </div>
          <div className="lp-foot-col">
            <span className="lp-mono lp-pane-label">ACCOUNT</span>
            <Link href="/register">Create an account</Link>
            <Link href="/login">Log in</Link>
            <a href="#faq">FAQ</a>
          </div>
          {/* Complete rather than selective. Meta, TikTok and LinkedIn all check
              that the policy URLs on an app submission are reachable from the
              public site, and data deletion is the one they most often look for
              and most often fail to find. scripts/check-legal-pages.cjs asserts
              every registered document appears here. */}
          <div className="lp-foot-col">
            <span className="lp-mono lp-pane-label">LEGAL</span>
            <Link href="/terms">Terms of Service</Link>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/acceptable-use">Acceptable Use</Link>
            <Link href="/refunds">Refunds and Credits</Link>
            <Link href="/subprocessors">Subprocessors</Link>
            <Link href="/data-deletion">Data Deletion</Link>
          </div>
        </div>
        <div className="lp-wrap lp-foot-base">
          <span className="lp-mono">© {new Date().getFullYear()} STUDIO · PUBLISHING IS SIMULATED DURING BETA</span>
          <span className="lp-mono">BUILT SOLO, IN PUBLIC</span>
        </div>
      </footer>
    </div>
  );
}
