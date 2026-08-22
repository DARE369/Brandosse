// sentry.edge.config.ts — LOCK L0.4
//
// Edge runtime (middleware and edge routes). Loaded by instrumentation.ts.
//
// NOTE: this is the NEXT.JS edge runtime, NOT Supabase Edge Functions. The
// Supabase functions are Deno and are not covered by this SDK — see the
// "Coverage gap" note in instrumentation.ts. That distinction matters, because
// the llm_provider_fallback tripwire added under L4.7 lives in a Supabase
// function and is therefore NOT captured here.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  sampleRate: 1.0,
  tracesSampleRate: 0.05,
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
  enabled: Boolean(dsn) && process.env.NODE_ENV === "production",
  sendDefaultPii: false,
  ignoreErrors: ["AbortError", "NEXT_NOT_FOUND", "NEXT_REDIRECT"],
});
