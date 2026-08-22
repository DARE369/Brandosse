// instrumentation.ts — LOCK L0.4
//
// Next.js calls register() once per runtime at startup, and routes server-side
// errors through onRequestError.
//
// ── COVERAGE GAP, STATED PLAINLY ────────────────────────────────────────────
// This instruments the NEXT.JS application only: server components, route
// handlers, server actions, middleware, and the browser.
//
// It does NOT instrument:
//   • Supabase Edge Functions (Deno, 51 of them) — including the
//     `llm_provider_fallback` tripwire added under L4.7, which is the single
//     alert most likely to have caught the Groq outage. Those need either the
//     Sentry Deno SDK or a direct POST to the DSN's store endpoint.
//   • video-worker (Python, on Railway today, Fly after Wave 7) — needs
//     sentry-sdk.
//
// So L0.4 is PARTIALLY closed by this file. The two Regression Register guards
// that wait on it — provider-fallback alerting and cost-deviation alerting —
// both live in the uncovered surfaces and remain unarmed. Recorded honestly
// rather than marked done.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures errors thrown from route handlers, server actions, server
// components and middleware. Requires @sentry/nextjs >= 8.28 and Next >= 15.
export { captureRequestError as onRequestError } from "@sentry/nextjs";
