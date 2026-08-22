// sentry.server.config.ts — LOCK L0.4
//
// Server-side (Node runtime) Sentry init. Loaded by instrumentation.ts.
//
// WHY THIS LOCK EXISTS
// The launch audit's root finding for P10 was not any individual bug — it was
// that the system has no capacity to report its own failures. Groq failed 100%
// of calls for days while Claude silently absorbed the cost. A job wrote
// fabricated data nightly for five months. Twenty posts froze mid-publish in
// April. Every one of these was invisible until someone read the code or
// queried the database by hand.
//
// This file is the beginning of the answer. It is deliberately configured for
// THAT problem: low noise, high signal, and never a silent no-op.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

// Fail LOUDLY rather than silently no-op. An error tracker that is quietly
// disabled is worse than none, because it manufactures false confidence — the
// exact pattern this lockdown exists to eliminate. In production a missing DSN
// is a misconfiguration and must be visible in the deploy log.
if (!dsn && process.env.NODE_ENV === "production") {
  console.error(
    "[sentry] NEXT_PUBLIC_SENTRY_DSN is not set — server errors will NOT be reported. " +
    "This disables LOCK L0.4. Set it in the deployment environment.",
  );
}

Sentry.init({
  dsn,

  // The free Developer plan allows 5,000 errors/month. At current scale (14
  // users) that is far beyond reach, so errors are sampled at 100% — every one
  // matters while the product is small. Revisit if volume ever approaches the
  // quota; sampling errors is the last thing to cut, not the first.
  sampleRate: 1.0,

  // Performance tracing is sampled hard. It burns quota fast and is not what
  // this lock is for — L0.4 is about knowing when things BREAK, not how fast
  // they are. Raise it deliberately when there is a latency question to answer.
  tracesSampleRate: 0.05,

  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",

  // Only send from real deployments. Local development noise would consume the
  // monthly quota and train everyone to ignore the inbox.
  enabled: Boolean(dsn) && process.env.NODE_ENV === "production",

  // Do not attach request bodies or headers by default — this application
  // handles brand kits, unpublished content, and OAuth state. An error tracker
  // must not become a second place user content leaks to.
  sendDefaultPii: false,

  beforeSend(event) {
    // Belt and braces: strip anything that could carry a credential even if a
    // future change starts attaching request data.
    if (event.request?.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.Authorization;
      delete event.request.headers.apikey;
      delete event.request.headers.cookie;
    }
    if (event.request?.data) delete event.request.data;
    return event;
  },

  // Noise that is not actionable.
  ignoreErrors: [
    "AbortError",              // user navigated away mid-request
    "ResizeObserver loop",     // browser quirk, never a real defect
    "NEXT_NOT_FOUND",          // Next's own 404 control flow
    "NEXT_REDIRECT",           // Next's own redirect control flow
  ],
});
