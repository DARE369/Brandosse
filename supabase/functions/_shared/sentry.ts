/**
 * sentry.ts — error reporting for Supabase Edge Functions (LOCK L0.4).
 *
 * ── Why this is hand-rolled rather than the Sentry SDK ──────────────────────
 * These functions run on Deno Deploy, are bundled per-function, and are
 * deployed 51 times. Pulling a full SDK into every one of them costs cold-start
 * time on every invocation to gain features this codebase does not need:
 * breadcrumbs, tracing, integrations, session tracking.
 *
 * What is actually needed is one thing — "tell me when something broke" — and
 * Sentry's envelope endpoint is a plain HTTP POST. So this is ~60 lines with no
 * dependency, no cold-start cost, and no version to keep current.
 *
 * ── Why it exists at all ────────────────────────────────────────────────────
 * The Next.js SDK (instrumentation.ts) does NOT cover these functions. Without
 * this file, the single most valuable alert in the system — the
 * llm_provider_fallback tripwire added under L4.7 — writes to a console nobody
 * reads. Groq failed 100% of calls for days and the Claude fallback silently
 * absorbed it; the cost architecture inverted with no signal at all. That is
 * precisely the event this reports.
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 * NEVER throws and NEVER blocks. Reporting a failure must not be able to cause
 * one, and must not add latency to a user's request. If the DSN is unset it
 * silently does nothing — the one place a silent no-op is correct, because a
 * local dev run should not need Sentry configured to work.
 */

import { readEnv } from "./env.ts";

type ReportContext = {
  /** Short machine-readable event name, e.g. "llm_provider_fallback". */
  event: string;
  /** Anything useful for diagnosis. Must not contain user content or secrets. */
  extra?: Record<string, unknown>;
  level?: "error" | "warning" | "info";
};

let cachedDsn: { key: string; host: string; projectId: string } | null | undefined;

function parseDsn() {
  if (cachedDsn !== undefined) return cachedDsn;
  const raw = readEnv("SENTRY_DSN", false) || "";
  const match = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(raw.trim());
  cachedDsn = match ? { key: match[1], host: match[2], projectId: match[3] } : null;
  return cachedDsn;
}

/**
 * Report an error or a notable event to Sentry.
 *
 * Fire-and-forget by design: the returned promise is not meant to be awaited on
 * a request path. Await it only in a context that is already terminating.
 */
export async function reportToSentry(
  error: unknown,
  context: ReportContext,
): Promise<void> {
  try {
    const dsn = parseDsn();
    if (!dsn) return;  // not configured — correct to do nothing

    const eventId = crypto.randomUUID().replace(/-/g, "");
    const now = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error ?? context.event);

    const event = {
      event_id: eventId,
      timestamp: now,
      platform: "javascript",
      level: context.level ?? "error",
      environment: readEnv("SENTRY_ENVIRONMENT", false) || "production",
      server_name: "supabase-edge",
      logger: "edge-function",
      transaction: context.event,
      exception: {
        values: [{
          type: error instanceof Error ? error.name : context.event,
          value: message.slice(0, 500),
        }],
      },
      // Tagged so alert rules can target a specific tripwire — e.g. notify on
      // event:llm_provider_fallback without drowning in every edge error.
      tags: { event: context.event, runtime: "supabase-edge" },
      extra: context.extra ?? {},
    };

    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: now, dsn: `https://${dsn.key}@${dsn.host}/${dsn.projectId}` }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(event),
    ].join("\n") + "\n";

    await fetch(`https://${dsn.host}/api/${dsn.projectId}/envelope/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=brandosse-edge/1.0, sentry_key=${dsn.key}`,
      },
      body: envelope,
      // LOCK L5.9 — even the error reporter is bounded. A hung Sentry must not
      // hold a request open.
      signal: AbortSignal.timeout(5_000),
    });
  } catch (reportingError) {
    // Reporting a failure must never cause one. Log and move on.
    console.error("[sentry] could not report event:", reportingError);
  }
}
