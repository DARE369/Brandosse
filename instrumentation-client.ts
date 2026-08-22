// instrumentation-client.ts — LOCK L0.4
//
// Browser-side init. Next.js loads this automatically on the client.
//
// This surface matters more than usual here: the application is a ~94k-line
// client SPA behind a thin App Router shell, so the majority of the product's
// logic executes in the browser. A server-only error tracker would miss most
// of what actually runs.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  sampleRate: 1.0,
  tracesSampleRate: 0.05,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || "development",
  enabled: Boolean(dsn) && process.env.NODE_ENV === "production",

  // No session replay. It records user screens — this product displays
  // unpublished content and brand assets, and replay would put that in a third
  // party. Not worth it for a solo-founder error budget.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  sendDefaultPii: false,

  ignoreErrors: [
    "ResizeObserver loop",
    "AbortError",
    "NetworkError when attempting to fetch resource",
    "Failed to fetch",              // offline / user navigated away
    "Non-Error promise rejection",  // third-party scripts
  ],
});

// Required for navigation instrumentation in the App Router.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
